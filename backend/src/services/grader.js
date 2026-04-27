import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeClient, claudeModel } from "./claude.js";
import { query } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRADER_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "math-grader.md");
const HINT_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "math-hint.md");

const GRADER_PURPOSE = "math_grade";
const HINT_PURPOSE = "math_hint";

const GRADER_MAX_TOKENS = 400;
const HINT_MAX_TOKENS = 400;

const FEEDBACK_MAX_LEN = 280;
const EXPLANATION_MAX_LEN = 280;
const HINT_MAX_LEN = 480;

const RESPONSE_MAX_LEN = 2_000;
const RESPONSE_TIME_MIN = 0;
const RESPONSE_TIME_MAX = 600;

const promptCache = new Map();

const loadPrompt = async (promptPath, label) => {
  if (promptCache.has(promptPath)) {
    return promptCache.get(promptPath);
  }
  const contents = await fs.readFile(promptPath, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error(`${label} prompt file is missing or too short.`);
  }
  promptCache.set(promptPath, contents);
  return contents;
};

const assertString = (value, max, label) => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.length === 0 || value.length > max) {
    throw new Error(`${label} must be 1-${max} characters.`);
  }
};

const sanitizeItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new Error("item must be an object.");
  }
  const promptText =
    typeof item.prompt === "string"
      ? item.prompt
      : typeof item.prompt?.text === "string"
        ? item.prompt.text
        : null;
  if (typeof promptText !== "string" || promptText.length === 0) {
    throw new Error("item.prompt.text must be a non-empty string.");
  }
  const expectedAnswerRaw =
    typeof item.answer === "string"
      ? item.answer
      : typeof item.answer?.text === "string"
        ? item.answer.text
        : null;
  if (typeof expectedAnswerRaw !== "string" || expectedAnswerRaw.length === 0) {
    throw new Error("item.answer.text must be a non-empty string.");
  }
  const expectedUnit =
    typeof item.answer?.unit === "string"
      ? item.answer.unit
      : typeof item.metadata?.answer_unit === "string"
        ? item.metadata.answer_unit
        : "";
  const structuredSteps = Array.isArray(item.metadata?.structured_steps)
    ? item.metadata.structured_steps
        .filter((step) => step && typeof step === "object")
        .map((step) => ({
          label: typeof step.label === "string" ? step.label.slice(0, 80) : "",
          content: typeof step.content === "string" ? step.content.slice(0, 240) : "",
        }))
        .slice(0, 6)
    : [];

  return {
    prompt: promptText,
    expected_answer: expectedAnswerRaw,
    expected_unit: expectedUnit,
    structured_steps: structuredSteps,
  };
};

const sanitizeStudentResponse = (value) => {
  if (typeof value !== "string") {
    throw new Error("studentResponse must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > RESPONSE_MAX_LEN) {
    throw new Error(`studentResponse must be 1-${RESPONSE_MAX_LEN} characters.`);
  }
  return trimmed;
};

const sanitizeResponseSeconds = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < RESPONSE_TIME_MIN || num > RESPONSE_TIME_MAX) {
    throw new Error(
      `responseSeconds must be a number between ${RESPONSE_TIME_MIN} and ${RESPONSE_TIME_MAX}.`,
    );
  }
  return num;
};

const sanitizeResponseSoFar = (value) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error("responseSoFar must be a string when provided.");
  }
  if (value.length > RESPONSE_MAX_LEN) {
    throw new Error(`responseSoFar must be ≤ ${RESPONSE_MAX_LEN} characters.`);
  }
  return value;
};

const hashInput = (purpose, systemPrompt, userMessage) => {
  const hasher = crypto.createHash("sha256");
  hasher.update(claudeModel);
  hasher.update("\u0000");
  hasher.update(purpose);
  hasher.update("\u0000");
  hasher.update(systemPrompt);
  hasher.update("\u0000");
  hasher.update(userMessage);
  return hasher.digest("hex");
};

const findCachedGeneration = async (purpose, inputHash) => {
  const result = await query(
    `
      SELECT output
      FROM ai_generations
      WHERE purpose = $1
        AND input_hash = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [purpose, inputHash],
  );
  return result.rows[0]?.output ?? null;
};

const recordGeneration = async ({ purpose, inputPrompt, inputHash, output, tokensIn, tokensOut }) => {
  await query(
    `
      INSERT INTO ai_generations (
        purpose,
        input_prompt,
        input_hash,
        model,
        output,
        tokens_in,
        tokens_out
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `,
    [purpose, inputPrompt, inputHash, claudeModel, JSON.stringify(output), tokensIn, tokensOut],
  );
};

const extractTextFromResponse = (response) => {
  if (!response || !Array.isArray(response.content)) {
    throw new Error("Claude response missing content array.");
  }
  const textBlock = response.content.find(
    (block) => block?.type === "text" && typeof block.text === "string",
  );
  if (!textBlock) {
    throw new Error("Claude response did not include a text block.");
  }
  return textBlock.text.trim();
};

const stripCodeFences = (text) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const withoutFirst = trimmed.replace(/^```[a-zA-Z]*\n?/, "");
    return withoutFirst.replace(/\n?```\s*$/, "").trim();
  }
  return trimmed;
};

const callClaude = async (systemPrompt, userMessage, maxTokens) => {
  const response = await claudeClient.messages.create({
    model: claudeModel,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });
  const text = extractTextFromResponse(response);
  const stripped = stripCodeFences(text);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    throw new Error(
      `Could not parse Claude output as JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return {
    parsed,
    tokensIn: response.usage?.input_tokens ?? null,
    tokensOut: response.usage?.output_tokens ?? null,
  };
};

const validateGraderOutput = (parsed, echoSeconds) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Grader output must be an object.");
  }
  if (typeof parsed.correct !== "boolean") {
    throw new Error("Grader output 'correct' must be a boolean.");
  }
  assertString(parsed.feedback, FEEDBACK_MAX_LEN, "feedback");
  assertString(parsed.explanation, EXPLANATION_MAX_LEN, "explanation");

  let echo = Number(parsed.response_time_seconds);
  if (!Number.isFinite(echo) || echo < RESPONSE_TIME_MIN || echo > RESPONSE_TIME_MAX) {
    echo = echoSeconds;
  }

  return {
    correct: parsed.correct,
    feedback: parsed.feedback.trim(),
    explanation: parsed.explanation.trim(),
    response_time_seconds: echo,
  };
};

const validateHintOutput = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Hint output must be an object.");
  }
  assertString(parsed.hint_text, HINT_MAX_LEN, "hint_text");
  let level = Number.parseInt(String(parsed.hint_level), 10);
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    level = 1;
  }
  return {
    hint_text: parsed.hint_text.trim(),
    hint_level: level,
  };
};

export const gradeAttempt = async (item, studentResponse, responseSeconds) => {
  const sanitizedItem = sanitizeItem(item);
  const cleanResponse = sanitizeStudentResponse(studentResponse);
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);

  const systemPrompt = await loadPrompt(GRADER_PROMPT_PATH, "math-grader.md");
  const userMessage = JSON.stringify(
    {
      prompt: sanitizedItem.prompt,
      structured_steps: sanitizedItem.structured_steps,
      expected_answer: sanitizedItem.expected_answer,
      expected_unit: sanitizedItem.expected_unit,
      student_response: cleanResponse,
      response_time_seconds: cleanSeconds,
    },
    null,
    2,
  );
  const inputHash = hashInput(GRADER_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(GRADER_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateGraderOutput(cached, cleanSeconds);
    } catch {
      // fall through and re-grade
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaude(systemPrompt, userMessage, GRADER_MAX_TOKENS);
  const validated = validateGraderOutput(parsed, cleanSeconds);

  await recordGeneration({
    purpose: GRADER_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const generateHint = async (item, responseSoFar) => {
  const sanitizedItem = sanitizeItem(item);
  const cleanSoFar = sanitizeResponseSoFar(responseSoFar);

  const systemPrompt = await loadPrompt(HINT_PROMPT_PATH, "math-hint.md");
  const userMessage = JSON.stringify(
    {
      prompt: sanitizedItem.prompt,
      structured_steps: sanitizedItem.structured_steps,
      expected_answer: sanitizedItem.expected_answer,
      response_so_far: cleanSoFar,
    },
    null,
    2,
  );
  const inputHash = hashInput(HINT_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(HINT_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateHintOutput(cached);
    } catch {
      // fall through
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaude(systemPrompt, userMessage, HINT_MAX_TOKENS);
  const validated = validateHintOutput(parsed);

  await recordGeneration({
    purpose: HINT_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};
