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
const READING_GRADER_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "reading-grader.md");
const READING_HINT_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "reading-hint.md");
const WRITING_GRADER_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "writing-grader.md");
const JIUJITSU_HINT_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "jiujitsu-hint.md");
const PROGRAMMING_HINT_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "programming-hint.md");

const GRADER_PURPOSE = "math_grade";
const HINT_PURPOSE = "math_hint";
const READING_GRADER_PURPOSE = "reading_grade";
const READING_HINT_PURPOSE = "reading_hint";
const WRITING_GRADER_PURPOSE = "writing_grade";
const JIUJITSU_HINT_PURPOSE = "jiujitsu_hint";
const PROGRAMMING_HINT_PURPOSE = "programming_hint";

const GRADER_MAX_TOKENS = 400;
const HINT_MAX_TOKENS = 400;
const READING_GRADER_MAX_TOKENS = 500;
const WRITING_GRADER_MAX_TOKENS = 700;

const FEEDBACK_MAX_LEN = 280;
const EXPLANATION_MAX_LEN = 280;
const HINT_MAX_LEN = 480;

const RESPONSE_MAX_LEN = 2_000;
const RESPONSE_TIME_MIN = 0;
const RESPONSE_TIME_MAX = 600;

const TYPING_ACCURACY_THRESHOLD = 0.8;
const WRITING_RESPONSE_MAX_LEN = 4_000;

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

const normalizeSpelling = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.normalize("NFKC").trim().toLowerCase();
};

const levenshtein = (a, b) => {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j += 1) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
};

const gradeMathAttempt = async (item, studentResponse, responseSeconds) => {
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
      // fall through
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

const getReadingQuestion = (item, readingQuestionIndex) => {
  const questions = Array.isArray(item.metadata?.questions) ? item.metadata.questions : [];
  const q = questions[readingQuestionIndex];
  if (!q || typeof q !== "object") {
    throw new Error("Reading item missing question metadata for this index.");
  }
  const text = typeof q.text === "string" ? q.text : "";
  const expected = typeof q.expected_answer === "string" ? q.expected_answer : "";
  const type = typeof q.type === "string" ? q.type : "";
  if (!text || !expected) {
    throw new Error("Invalid reading question entry.");
  }
  const passage =
    typeof item.metadata?.passage === "string" ? item.metadata.passage : "";
  if (!passage) {
    throw new Error("Reading item missing passage.");
  }
  return { passage, questionText: text, questionType: type, expectedAnswer: expected };
};

const gradeReadingAttempt = async (item, studentResponse, responseSeconds, readingQuestionIndex) => {
  const idx = Number.parseInt(String(readingQuestionIndex), 10);
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
    throw new Error("readingQuestionIndex must be 0, 1, or 2.");
  }
  const cleanResponse = sanitizeStudentResponse(studentResponse);
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);
  const rq = getReadingQuestion(item, idx);

  const systemPrompt = await loadPrompt(READING_GRADER_PROMPT_PATH, "reading-grader.md");
  const userMessage = JSON.stringify(
    {
      passage: rq.passage,
      question_text: rq.questionText,
      question_type: rq.questionType,
      expected_answer: rq.expectedAnswer,
      student_response: cleanResponse,
      response_time_seconds: cleanSeconds,
    },
    null,
    2,
  );
  const inputHash = hashInput(READING_GRADER_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(READING_GRADER_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateGraderOutput(cached, cleanSeconds);
    } catch {
      // fall through
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaude(
    systemPrompt,
    userMessage,
    READING_GRADER_MAX_TOKENS,
  );
  const validated = validateGraderOutput(parsed, cleanSeconds);

  await recordGeneration({
    purpose: READING_GRADER_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

const gradeSpellingLocal = (item, studentResponse, responseSeconds) => {
  const cleanResponse = sanitizeStudentResponse(studentResponse);
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);
  const expectedRaw =
    typeof item.answer?.text === "string"
      ? item.answer.text
      : typeof item.answer === "string"
        ? item.answer
        : "";
  if (!expectedRaw) {
    throw new Error("Spelling item missing expected word.");
  }
  const correct = normalizeSpelling(cleanResponse) === normalizeSpelling(expectedRaw);
  const feedback = correct
    ? "That matches — nice spelling."
    : `Not quite. The word was “${expectedRaw.trim()}”.`;
  return {
    correct,
    feedback: feedback.slice(0, FEEDBACK_MAX_LEN),
    explanation: correct ? "" : "Listen again and try letter sounds one chunk at a time.",
    response_time_seconds: cleanSeconds,
  };
};

const stripMcqNoise = (value) => {
  let s = value.normalize("NFKC").trim().toLowerCase();
  s = s.replace(/^[“”"']+|[“”"']+$/g, "");
  s = s.replace(/^(answer|choice|option|letter)\s*[:#.)-]?\s*/i, "");
  s = s.replace(/[.!?,;:)\]}]+$/g, "");
  return s.trim();
};

const extractMcqLetter = (value) => {
  const stripped = stripMcqNoise(value);
  if (stripped.length === 1 && /^[a-d]$/i.test(stripped)) {
    return stripped;
  }
  const boundary = stripped.match(/\b([a-d])\b/i);
  if (boundary) {
    return boundary[1].toLowerCase();
  }
  const suffix = stripped.match(/([a-d])\s*[.)]?\s*$/i);
  if (suffix) {
    return suffix[1].toLowerCase();
  }
  return stripped;
};

/** Local grade for A–D multiple-choice items (jiu-jitsu knowledge, programming MCQ). */
const gradeLetterMcqItem = (item, studentResponse, responseSeconds, feedbackPair) => {
  const cleanResponse = sanitizeStudentResponse(studentResponse);
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);
  const expectedRaw =
    typeof item.answer?.text === "string"
      ? item.answer.text
      : typeof item.answer === "string"
        ? item.answer
        : "";
  if (!expectedRaw || expectedRaw.trim().length === 0) {
    throw new Error("MCQ item missing expected answer.");
  }

  const expectedNorm = stripMcqNoise(expectedRaw);
  const studentNorm = stripMcqNoise(cleanResponse);
  const studentLetter = extractMcqLetter(cleanResponse);

  let correct = false;
  if (expectedNorm.length === 1 && /^[a-d]$/i.test(expectedNorm)) {
    correct = studentLetter === expectedNorm || studentNorm === expectedNorm;
  } else {
    correct = studentNorm === expectedNorm;
  }

  const feedback = correct ? feedbackPair.correct : feedbackPair.incorrect;
  return {
    correct,
    feedback: feedback.slice(0, FEEDBACK_MAX_LEN),
    explanation: correct ? "" : feedbackPair.explanationWrong,
    response_time_seconds: cleanSeconds,
  };
};

const gradeJiujitsuLocal = (item, studentResponse, responseSeconds) =>
  gradeLetterMcqItem(item, studentResponse, responseSeconds, {
    correct: "That matches the best answer here—nice recall.",
    incorrect:
      "Not quite. Read each choice slowly and pick the one that fits safety, respect, or the definition best.",
    explanationWrong: "Compare the stem to each line before you choose.",
  });

const gradeProgrammingMcqLocal = (item, studentResponse, responseSeconds) =>
  gradeLetterMcqItem(item, studentResponse, responseSeconds, {
    correct: "Yes — that matches the best answer.",
    incorrect: "Not quite. Walk through each choice against the steps, then try again.",
    explanationWrong: "Use the step boxes to eliminate choices that do not fit.",
  });

const gradeTypingLocal = (item, studentResponse, responseSeconds) => {
  const cleanResponse = sanitizeStudentResponse(studentResponse);
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);
  const target =
    typeof item.answer?.text === "string"
      ? item.answer.text
      : typeof item.prompt?.text === "string"
        ? item.prompt.text
        : "";
  if (!target) {
    throw new Error("Typing item missing target sentence.");
  }
  const normTarget = target.normalize("NFKC").trim();
  const normStudent = cleanResponse.normalize("NFKC").trim();
  const maxLen = Math.max(normStudent.length, normTarget.length, 1);
  const dist = levenshtein(normStudent, normTarget);
  const accuracy = 1 - dist / maxLen;
  const correct = accuracy >= TYPING_ACCURACY_THRESHOLD;
  const minutes = cleanSeconds > 0 ? cleanSeconds / 60 : 0;
  const grossWpm = minutes > 0 ? cleanResponse.length / 5 / minutes : 0;
  const roundedWpm = Math.round(grossWpm * 10) / 10;
  const roundedAcc = Math.round(accuracy * 1000) / 1000;
  const pctMatch = Math.round(roundedAcc * 100);
  const feedback = correct
    ? `Strong typing — about ${roundedWpm} WPM, ${pctMatch}% match.`
    : `Keep practicing — ${pctMatch}% character match (goal 80%). About ${roundedWpm} WPM.`;
  const explanation = correct
    ? `That run counted as correct: about ${pctMatch}% of characters matched the goal line.`
    : `About ${pctMatch}% of characters matched so far (${dist} letter edits from the goal). Compare slowly to the sentence above, then try again.`;
  return {
    correct,
    feedback: feedback.slice(0, FEEDBACK_MAX_LEN),
    explanation: explanation.slice(0, EXPLANATION_MAX_LEN),
    response_time_seconds: cleanSeconds,
  };
};

const sanitizeWritingRendition = (item) => {
  const renderedPrompt = typeof item.prompt?.text === "string" ? item.prompt.text.trim() : "";
  if (renderedPrompt.length === 0 || renderedPrompt.length > 800) {
    throw new Error("Writing prompt text is missing.");
  }
  const wordCountGuidance =
    typeof item.prompt?.word_count_guidance === "string"
      ? item.prompt.word_count_guidance.trim().slice(0, 160)
      : "";
  const rubricCriteria = Array.isArray(item.metadata?.rubric_criteria)
    ? item.metadata.rubric_criteria
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name.trim().slice(0, 60) : "",
          description:
            typeof entry.description === "string" ? entry.description.trim().slice(0, 200) : "",
          max_points: Number.parseInt(String(entry.max_points), 10),
        }))
        .filter((entry) => entry.name.length > 0 && entry.description.length > 0 && entry.max_points > 0)
        .slice(0, 8)
    : [];
  return { renderedPrompt, wordCountGuidance, rubricCriteria };
};

const sanitizeWritingResponse = (value) => {
  if (typeof value !== "string") {
    throw new Error("studentResponse must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > WRITING_RESPONSE_MAX_LEN) {
    throw new Error(`studentResponse must be 1-${WRITING_RESPONSE_MAX_LEN} characters.`);
  }
  return trimmed;
};

const validateWritingGraderOutput = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Writing grader output must be an object.");
  }
  const total = Number.parseInt(String(parsed.total), 10);
  if (!Number.isInteger(total) || total < 0 || total > 100) {
    throw new Error("Writing grader total must be an integer between 0 and 100.");
  }
  if (!parsed.criteria || typeof parsed.criteria !== "object") {
    throw new Error("Writing grader criteria are missing.");
  }
  const criteria = {
    conventions: Number.parseInt(String(parsed.criteria.conventions), 10),
    sentence_variety: Number.parseInt(String(parsed.criteria.sentence_variety), 10),
    main_idea: Number.parseInt(String(parsed.criteria.main_idea), 10),
    detail: Number.parseInt(String(parsed.criteria.detail), 10),
  };
  const values = Object.values(criteria);
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 25)) {
    throw new Error("Writing criteria must be integers between 0 and 25.");
  }
  const computedTotal = values.reduce((sum, value) => sum + value, 0);
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
  const encouragement = typeof parsed.encouragement === "string" ? parsed.encouragement.trim() : "";
  if (feedback.length === 0 || feedback.length > 360) {
    throw new Error("Writing feedback must be 1-360 characters.");
  }
  if (encouragement.length === 0 || encouragement.length > 200) {
    throw new Error("Writing encouragement must be 1-200 characters.");
  }
  return {
    total: computedTotal,
    criteria,
    feedback,
    encouragement,
  };
};

const gradeWritingAttempt = async (item, studentResponse, responseSeconds) => {
  const cleanSeconds = sanitizeResponseSeconds(responseSeconds);
  const rendition = sanitizeWritingRendition(item);
  const cleanResponse = sanitizeWritingResponse(studentResponse);
  const systemPrompt = await loadPrompt(WRITING_GRADER_PROMPT_PATH, "writing-grader.md");
  const userMessage = JSON.stringify(
    {
      rendered_prompt: rendition.renderedPrompt,
      word_count_guidance: rendition.wordCountGuidance,
      rubric_criteria: rendition.rubricCriteria,
      student_response: cleanResponse,
      response_time_seconds: cleanSeconds,
    },
    null,
    2,
  );
  const inputHash = hashInput(WRITING_GRADER_PURPOSE, systemPrompt, userMessage);
  const cached = await findCachedGeneration(WRITING_GRADER_PURPOSE, inputHash);
  if (cached) {
    try {
      const validatedCached = validateWritingGraderOutput(cached);
      return {
        correct: validatedCached.total >= 70,
        feedback: validatedCached.feedback,
        explanation: `Rubric total ${validatedCached.total}/100.`,
        encouragement: validatedCached.encouragement,
        writing_rubric: validatedCached,
        response_time_seconds: cleanSeconds,
      };
    } catch {
      // regenerate
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaude(
    systemPrompt,
    userMessage,
    WRITING_GRADER_MAX_TOKENS,
  );
  const validated = validateWritingGraderOutput(parsed);
  await recordGeneration({
    purpose: WRITING_GRADER_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return {
    correct: validated.total >= 70,
    feedback: validated.feedback,
    explanation: `Rubric total ${validated.total}/100.`,
    encouragement: validated.encouragement,
    writing_rubric: validated,
    response_time_seconds: cleanSeconds,
  };
};

export const gradeAttempt = async (item, studentResponse, responseSeconds, options = {}) => {
  const skillName = typeof options.skillName === "string" ? options.skillName.trim().toLowerCase() : "math";

  if (skillName === "spelling") {
    return gradeSpellingLocal(item, studentResponse, responseSeconds);
  }
  if (skillName === "typing") {
    return gradeTypingLocal(item, studentResponse, responseSeconds);
  }
  if (skillName === "reading") {
    return gradeReadingAttempt(item, studentResponse, responseSeconds, options.readingQuestionIndex);
  }
  if (skillName === "writing") {
    return gradeWritingAttempt(item, studentResponse, responseSeconds);
  }
  if (skillName === "jiujitsu") {
    return gradeJiujitsuLocal(item, studentResponse, responseSeconds);
  }
  if (skillName === "programming") {
    return gradeProgrammingMcqLocal(item, studentResponse, responseSeconds);
  }
  return gradeMathAttempt(item, studentResponse, responseSeconds);
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

export const generateReadingHint = async (item, responseSoFar, readingQuestionIndex) => {
  const cleanSoFar = sanitizeResponseSoFar(responseSoFar);
  const idx = Number.parseInt(String(readingQuestionIndex), 10);
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
    throw new Error("reading_question_index must be 0, 1, or 2.");
  }
  const rq = getReadingQuestion(item, idx);

  const systemPrompt = await loadPrompt(READING_HINT_PROMPT_PATH, "reading-hint.md");
  const userMessage = JSON.stringify(
    {
      passage: rq.passage,
      question_text: rq.questionText,
      question_type: rq.questionType,
      expected_answer: rq.expectedAnswer,
      response_so_far: cleanSoFar,
    },
    null,
    2,
  );
  const inputHash = hashInput(READING_HINT_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(READING_HINT_PURPOSE, inputHash);
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
    purpose: READING_HINT_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const generateJiujitsuHint = async (item, responseSoFar) => {
  const sanitizedItem = sanitizeItem(item);
  const cleanSoFar = sanitizeResponseSoFar(responseSoFar);

  const systemPrompt = await loadPrompt(JIUJITSU_HINT_PROMPT_PATH, "jiujitsu-hint.md");
  const userMessage = JSON.stringify(
    {
      prompt: sanitizedItem.prompt,
      expected_answer: sanitizedItem.expected_answer,
      response_so_far: cleanSoFar,
    },
    null,
    2,
  );
  const inputHash = hashInput(JIUJITSU_HINT_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(JIUJITSU_HINT_PURPOSE, inputHash);
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
    purpose: JIUJITSU_HINT_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const generateProgrammingHint = async (item, responseSoFar) => {
  const sanitizedItem = sanitizeItem(item);
  const cleanSoFar = sanitizeResponseSoFar(responseSoFar);

  const systemPrompt = await loadPrompt(PROGRAMMING_HINT_PROMPT_PATH, "programming-hint.md");
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
  const inputHash = hashInput(PROGRAMMING_HINT_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(PROGRAMMING_HINT_PURPOSE, inputHash);
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
    purpose: PROGRAMMING_HINT_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};
