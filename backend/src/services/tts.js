import { TTS_VOICE_OPTIONS } from "../constants/tts-voices.js";

const VOXTRAL_URL = process.env.VOXTRAL_URL ?? "http://localhost:8001";
const MODEL_ID = "mistralai/Voxtral-4B-TTS-2603";
const DEFAULT_VOICE = "en_paul_neutral";

export const AVAILABLE_VOICES = TTS_VOICE_OPTIONS;
const VOICE_SET = new Set(AVAILABLE_VOICES);

export const isAllowedVoice = (voice) => typeof voice === "string" && VOICE_SET.has(voice);

/**
 * Pings the vLLM server. Throws if unreachable.
 */
export const ensureTtsReady = async () => {
  try {
    const res = await fetch(`${VOXTRAL_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`vLLM health check returned ${res.status}`);
  } catch (err) {
    throw new Error(`Voxtral vLLM server unreachable at ${VOXTRAL_URL}: ${err.message}`);
  }
};

/**
 * @param {string} text
 * @param {string} [voice]
 * @returns {Promise<Buffer>}
 */
export const synthesize = async (text, voice = DEFAULT_VOICE) => {
  const v = isAllowedVoice(voice) ? voice : DEFAULT_VOICE;

  const res = await fetch(`${VOXTRAL_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL_ID, input: text, voice: v, response_format: "wav" }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voxtral TTS error ${res.status}: ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
};
