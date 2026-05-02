import { Router } from "express";
import {
  AVAILABLE_VOICES,
  ensureTtsReady,
  isAllowedVoice,
  isTtsReady,
  synthesize,
} from "../services/tts.js";

const router = Router();

const MAX_TEXT_LEN = 2_000;

const validateText = (raw) => {
  if (typeof raw !== "string") {
    return { error: "text must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { error: "text must be non-empty." };
  }
  if (trimmed.length > MAX_TEXT_LEN) {
    return { error: `text must be at most ${MAX_TEXT_LEN} characters.` };
  }
  return { text: trimmed };
};

router.get("/voices", (_req, res) => {
  return res.json(AVAILABLE_VOICES);
});

router.get("/", async (req, res, next) => {
  try {
    try {
      await ensureTtsReady();
    } catch {
      return res.status(503).json({
        error: "TTS unavailable",
        message: "Kokoro TTS failed to load. Check server logs and disk/network for model fetch.",
      });
    }

    if (!isTtsReady()) {
      return res.status(503).json({
        error: "TTS unavailable",
        message: "Kokoro TTS is not ready.",
      });
    }

    const validation = validateText(req.query?.text ?? "");
    if (validation.error) {
      return res.status(400).json({ error: "InvalidRequest", message: validation.error });
    }

    const rawVoice = req.query?.voice;
    let voice = "af_sky";
    if (rawVoice !== undefined && rawVoice !== null && String(rawVoice).trim() !== "") {
      const v = String(rawVoice).trim();
      if (!isAllowedVoice(v)) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: `voice must be one of: ${AVAILABLE_VOICES.join(", ")}.`,
        });
      }
      voice = v;
    }

    const wav = await synthesize(validation.text, voice);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(wav);
  } catch (error) {
    return next(error);
  }
});

export default router;
