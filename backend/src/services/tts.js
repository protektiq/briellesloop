import { TTS_VOICE_OPTIONS } from "../constants/tts-voices.js";

/**
 * Load kokoro-js only when TTS is needed. A static import pulls in @huggingface/transformers at
 * process start and triggers many TimeoutOverflowWarning lines (hub uses >32-bit timer delays).
 */
const loadKokoroTts = async () => {
  const { KokoroTTS } = await import("kokoro-js");
  return KokoroTTS;
};

/** Hugging Face model id supported by kokoro-js 1.x */
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Voices exposed by the API (subset of kokoro-js VOICES). */
export const AVAILABLE_VOICES = TTS_VOICE_OPTIONS;

const VOICE_SET = new Set(AVAILABLE_VOICES);

let initPromise = null;
let ttsInstance = null;
let ttsReady = false;

/**
 * Loads Kokoro once, warms with a short string, logs readiness.
 * Safe to call multiple times; subsequent calls await the same init.
 */
export const ensureTtsReady = async () => {
  if (ttsReady && ttsInstance) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const KokoroTTS = await loadKokoroTts();
      const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "cpu",
      });
      await instance.generate("Hi.", { voice: "af_sky" });
      ttsInstance = instance;
      ttsReady = true;
      console.log("Kokoro TTS ready");
    })().catch((error) => {
      initPromise = null;
      ttsReady = false;
      ttsInstance = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Kokoro TTS initialization failed:", message);
      throw error;
    });
  }
  await initPromise;
};

export const isTtsReady = () => ttsReady && Boolean(ttsInstance);

/**
 * @param {string} text
 * @param {string} [voice='af_sky']
 * @returns {Promise<Buffer>}
 */
export const synthesize = async (text, voice = "af_sky") => {
  if (!isTtsReady() || !ttsInstance) {
    throw new Error("TTS engine is not ready.");
  }
  const v = typeof voice === "string" && VOICE_SET.has(voice) ? voice : "af_sky";
  const raw = await ttsInstance.generate(text, { voice: v });
  const wav = raw.toWav();
  return Buffer.from(wav);
};

export const isAllowedVoice = (voice) => typeof voice === "string" && VOICE_SET.has(voice);
