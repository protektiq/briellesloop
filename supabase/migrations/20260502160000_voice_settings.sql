ALTER TABLE parent_settings
  ADD COLUMN IF NOT EXISTS voice_math_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS voice_spelling_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tts_voice TEXT NOT NULL DEFAULT 'af_sky';

COMMENT ON COLUMN parent_settings.voice_math_enabled IS 'When true, show voice input on math practice (if browser supports SpeechRecognition).';
COMMENT ON COLUMN parent_settings.voice_spelling_enabled IS 'When true, prefer microphone for spelling (Say it back).';
COMMENT ON COLUMN parent_settings.tts_voice IS 'Kokoro TTS voice id (e.g. af_sky).';
