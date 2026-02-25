import asyncio
import logging
import time

from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.plugins import deepgram, silero

load_dotenv()

logger = logging.getLogger("voice-agent")
logger.setLevel(logging.INFO)

SILENCE_TIMEOUT = 20
SILENCE_MSG = "Are you still there? Feel free to say something!"


class EchoLLMStream(llm.LLMStream):
    """Streams back a single 'You said: ...' chunk."""

    def __init__(self, echo_llm, *, chat_ctx, tools, conn_options, text):
        super().__init__(echo_llm, chat_ctx=chat_ctx, tools=tools, conn_options=conn_options)
        self._text = text

    async def _run(self):
        self._event_ch.send_nowait(
            llm.ChatChunk(
                id="echo",
                delta=llm.ChoiceDelta(role="assistant", content=self._text),
            )
        )


class EchoLLM(llm.LLM):
    """
    Minimal LLM replacement — just echoes back what the user said.
    No external API call needed.
    """

    def __init__(self):
        super().__init__()

    def chat(self, *, chat_ctx, tools=None, conn_options=DEFAULT_API_CONNECT_OPTIONS, **kwargs):
        # grab the last thing the user said from chat context
        user_text = ""
        for msg in reversed(chat_ctx.items):
            if getattr(msg, "type", None) == "message" and getattr(msg, "role", None) == "user":
                for c in msg.content:
                    if isinstance(c, str) and c.strip():
                        user_text = c.strip()
                        break
                if user_text:
                    break

        response = f"You said: {user_text}" if user_text else "I didn't catch that."
        logger.info("echo response: %s", response)

        return EchoLLMStream(
            self, chat_ctx=chat_ctx, tools=tools or [],
            conn_options=conn_options, text=response,
        )


class EchoAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions="Echo back what the user says, prefixed with 'You said: '.",
        )


class SilenceMonitor:
    """
    Watches for prolonged silence. If nobody speaks for 20 seconds
    it plays a short reminder — once. Resets when the user speaks again.
    """

    def __init__(self, session):
        self._session = session
        self._last_active = time.time()
        self._sent = False
        self._task = None

    def reset(self):
        self._last_active = time.time()
        self._sent = False

    def start(self):
        self._task = asyncio.create_task(self._loop())

    async def _loop(self):
        while True:
            await asyncio.sleep(5)
            if self._sent:
                continue
            if time.time() - self._last_active >= SILENCE_TIMEOUT:
                logger.info("silence detected, sending reminder")
                try:
                    await self._session.say(SILENCE_MSG, add_to_chat_ctx=False)
                except RuntimeError:
                    pass
                self._sent = True


async def entrypoint(ctx: JobContext):
    logger.info("connecting to room...")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("connected to room %s", ctx.room.name)

    session = AgentSession(
        vad=silero.VAD.load(min_silence_duration=1.0),
        stt=deepgram.STT(),
        llm=EchoLLM(),
        tts=deepgram.TTS(),
    )

    monitor = SilenceMonitor(session)

    @session.on("user_speech_committed")
    def _on_user(*a):
        monitor.reset()

    @session.on("agent_speech_committed")
    def _on_agent(*a):
        monitor.reset()

    monitor.start()

    await session.start(room=ctx.room, agent=EchoAgent())
    logger.info("agent is live")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voice-agent"))