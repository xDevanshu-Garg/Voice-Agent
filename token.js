import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";

dotenv.config();

const at = new AccessToken(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
  { identity: "voice-agent" },
);

at.addGrant({ roomJoin: true, room: "test-room" });

console.log(at.toJwt());
