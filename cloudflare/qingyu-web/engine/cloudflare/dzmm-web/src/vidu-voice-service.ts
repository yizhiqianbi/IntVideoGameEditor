import { WorkerEntrypoint } from "cloudflare:workers";
import { generateViduCharacterVoice, viduVoiceConfigured, type ViduVoiceEnvironment } from "./vidu-character-voice";
/** Only the backend's named service binding can call these methods. There is no public HTTP generation endpoint. */
export class ViduVoiceService extends WorkerEntrypoint<ViduVoiceEnvironment> {
  async configured() { return viduVoiceConfigured(this.env); }
  async generate(input: { text: string; voiceId: string }) { return generateViduCharacterVoice(this.env, input); }
  async fetch() { return new Response(null, { status: 404 }); }
}
