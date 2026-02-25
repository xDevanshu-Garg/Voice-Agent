# RevRag Voice Agent

Real-time voice agent built with [LiveKit](https://livekit.io/). Joins a LiveKit room and echoes back whatever the user says via audio.

**How it works:** Deepgram transcribes user speech → agent constructs a `"You said: <text>"` response → Deepgram TTS speaks it back into the room.

## Features

- **STT → Response → TTS** — speech is transcribed, processed, and spoken back
- **No overlap** — Silero VAD ensures the agent stays silent while the user talks. If interrupted mid-response, it stops immediately.
- **Silence handling** — after 20 seconds of no speech, the agent plays a one-time reminder ("Are you still there?"). Doesn't loop.

## Demo

[Watch the demo video](https://youtu.be/wSKl3BbwLvc)

## Setup

**Requirements:** Python 3.10+

```bash
git clone https://github.com/xDevanshu-Garg/Voice-Agent.git
cd Voice-Agent
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
```

## Environment Variables

Create a `.env` file:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
DEEPGRAM_API_KEY=...
```

- **LiveKit** — sign up at [cloud.livekit.io](https://cloud.livekit.io) (free tier)
- **Deepgram** — sign up at [console.deepgram.com](https://console.deepgram.com/signup) (free credit)

## Running

```bash
# download VAD model (first time only)
python agent.py download-files

# start in dev mode
python agent.py dev
```

Then open [agents-playground.livekit.io](https://agents-playground.livekit.io), set agent name to `voice-agent`, connect, and start talking.

## How No-Overlap Works

Silero VAD runs on incoming audio and detects when the user is speaking. The `AgentSession` uses this to hold agent output during user speech — if the agent is already talking and the user starts speaking, it cuts off immediately. The agent only responds once VAD signals the user has stopped.

## How Silence Handling Works

A background task checks every 5 seconds if the last activity (user or agent speech) was more than 20 seconds ago. If so, it uses `session.say()` to speak a reminder directly through TTS — bypassing the echo pipeline. A flag prevents it from repeating; it resets when the user speaks again.

## SDK & Services

| Component | Service |
|---|---|
| Agent framework | livekit-agents 1.4 |
| VAD | Silero (local, no API key) |
| STT | Deepgram |
| TTS | Deepgram |

## Known Limitations

- VAD may split long sentences if there's a natural pause — `min_silence_duration` is set to 1s to reduce this but it can still happen
- Deepgram free tier has usage limits
- "You said: ..." response is hardcoded — no LLM reasoning
- Requires internet (Deepgram STT/TTS are cloud services)
