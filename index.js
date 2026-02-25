import { connect } from "livekit-client";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import gTTS from "gtts";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath.path);

let isUserSpeaking = false;
let isBotSpeaking = false;
let lastSpeechTime = Date.now();

let audioChunks = [];

// ------------------ STT ------------------
async function speechToText(filePath) {
  const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
    body: fs.readFileSync(filePath),
  });
  const { upload_url } = await uploadRes.json();

  const transcriptRes = await fetch(
    "https://api.assemblyai.com/v2/transcript",
    {
      method: "POST",
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audio_url: upload_url }),
    },
  );

  const { id } = await transcriptRes.json();

  while (true) {
    const polling = await fetch(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      },
    );

    const data = await polling.json();
    if (data.status === "completed") return data.text;
    if (data.status === "error") throw new Error(data.error);

    await new Promise((res) => setTimeout(res, 2000));
  }
}

// ------------------ TTS ------------------
function textToSpeech(text, outputFile) {
  return new Promise((resolve, reject) => {
    const gtts = new gTTS(text, "en");
    gtts.save(outputFile, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ------------------ AUDIO PROCESS ------------------
function saveAudioToFile(buffer, filename) {
  fs.writeFileSync(filename, Buffer.concat(buffer));
}

// ------------------ MAIN ------------------
async function startAgent() {
  const room = await connect(process.env.LIVEKIT_URL, {
    token: "YOUR_GENERATED_TOKEN",
  });

  console.log("Connected to room");

  room.on("trackSubscribed", (track) => {
    if (track.kind === "audio") {
      const reader = track.createReader();

      reader.on("data", async (chunk) => {
        const volume =
          chunk.reduce((sum, v) => sum + Math.abs(v), 0) / chunk.length;

        if (volume > 0.02) {
          isUserSpeaking = true;
          lastSpeechTime = Date.now();

          if (isBotSpeaking) {
            console.log("User interrupted → stop bot");
            isBotSpeaking = false;
          }

          audioChunks.push(Buffer.from(chunk));
        } else {
          if (isUserSpeaking) {
            isUserSpeaking = false;

            console.log("User stopped speaking → processing");

            const filename = "input.wav";
            saveAudioToFile(audioChunks, filename);
            audioChunks = [];

            try {
              const text = await speechToText(filename);
              console.log("User said:", text);

              const response = `You said: ${text}`;

              const outputFile = "output.mp3";
              await textToSpeech(response, outputFile);

              isBotSpeaking = true;

              console.log("Bot speaking:", response);

              // NOTE: Simplified playback (you can improve)
              // For now just log — real publish needs audio track
            } catch (e) {
              console.error(e);
            }
          }
        }
      });
    }
  });

  // ------------------ SILENCE HANDLING ------------------
  setInterval(async () => {
    if (Date.now() - lastSpeechTime > 20000 && !isBotSpeaking) {
      console.log("Silence detected → reminder");

      const msg = "Are you still there?";
      await textToSpeech(msg, "reminder.mp3");

      isBotSpeaking = true;
    }
  }, 5000);
}

startAgent();
