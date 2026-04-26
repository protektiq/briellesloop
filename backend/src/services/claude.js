import Anthropic from "@anthropic-ai/sdk";

const MIN_API_KEY_LENGTH = 20;
const MAX_MODEL_LENGTH = 120;

const validateEnvString = (value, name, minLength, maxLength) => {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new Error(`${name} must be between ${minLength} and ${maxLength} characters.`);
  }

  return trimmed;
};

const apiKey = validateEnvString(
  process.env.ANTHROPIC_API_KEY,
  "ANTHROPIC_API_KEY",
  MIN_API_KEY_LENGTH,
  200,
);

export const claudeModel = validateEnvString(
  process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
  "ANTHROPIC_MODEL",
  3,
  MAX_MODEL_LENGTH,
);

const timeoutRaw = process.env.ANTHROPIC_TIMEOUT_MS ?? "10000";
const timeoutMs = Number(timeoutRaw);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  throw new Error("ANTHROPIC_TIMEOUT_MS must be an integer between 1000 and 120000.");
}

export const claudeClient = new Anthropic({
  apiKey,
  timeout: timeoutMs,
});
