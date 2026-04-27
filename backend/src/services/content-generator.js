import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeClient, claudeModel } from "./claude.js";
import { query } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "math-generator.md");
const PURPOSE = "math_generate";
const MAX_TOKENS = 800;

const PROMPT_MAX_LEN = 400;
const STEP_LABEL_MAX_LEN = 40;
const STEP_CONTENT_MAX_LEN = 160;
const ANSWER_MAX_LEN = 60;
const ANSWER_UNIT_MAX_LEN = 24;
const STEPS_MIN = 2;
const STEPS_MAX = 4;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedSystemPrompt = null;

const loadSystemPrompt = async () => {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt;
  }
  const contents = await fs.readFile(PROMPT_PATH, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error("math-generator.md prompt is missing or too short.");
  }
  cachedSystemPrompt = contents;
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

const assertOptionalString = (value, max, label) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`${label} must be a string ≤ ${max} characters.`);
  }
  return value;
};

const sanitizeStudent = (student) => {
  if (!student || typeof student !== "object") {
    throw new Error("student must be an object.");
  }
  if (typeof student.id !== "string" || !UUID_REGEX.test(student.id)) {
    throw new Error("student.id must be a UUID.");
  }
  const name = typeof student.name === "string" ? student.name.trim().slice(0, 60) : "Brielle";
  const grade = Number.parseInt(String(student.grade), 10);
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
    throw new Error("student.grade must be an integer between 1 and 12.");
  }
  const mathLevel = Number.parseInt(String(student.math_level), 10);
  if (!Number.isInteger(mathLevel) || mathLevel < 1 || mathLevel > 10) {
    throw new Error("student.math_level must be an integer between 1 and 10.");
  }
  const interests = Array.isArray(student.interests)
    ? student.interests
        .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 40))
        .slice(0, 8)
    : [];
  const iepGoal =
    typeof student.iep_goal === "string" ? student.iep_goal.trim().slice(0, 400) : "";
  const recentMisses = Array.isArray(student.recent_misses)
    ? student.recent_misses
        .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 200))
        .slice(0, 10)
    : [];

  return { id: student.id, name, grade, mathLevel, interests, iepGoal, recentMisses };
};

const buildUserMessage = (sanitized, nonce) => {
  return JSON.stringify(
    {
      student_name: sanitized.name,
      grade: sanitized.grade,
      math_level: sanitized.mathLevel,
      interests: sanitized.interests,
      iep_goal: sanitized.iepGoal,
      recent_misses: sanitized.recentMisses,
      nonce,
    },
    null,
    2,
  );
};

const hashInput = (systemPrompt, userMessage) => {
  const hasher = crypto.createHash("sha256");
  hasher.update(claudeModel);
  hasher.update("\u0000");
  hasher.update(systemPrompt);
  hasher.update("\u0000");
  hasher.update(userMessage);
  return hasher.digest("hex");
};

const findCachedGeneration = async (inputHash) => {
  const result = await query(
    `
      SELECT output
      FROM ai_generations
      WHERE purpose = $1
        AND input_hash = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [PURPOSE, inputHash],
  );
  return result.rows[0]?.output ?? null;
};

const recordGeneration = async ({ inputPrompt, inputHash, output, tokensIn, tokensOut }) => {
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
    [PURPOSE, inputPrompt, inputHash, claudeModel, JSON.stringify(output), tokensIn, tokensOut],
  );
};

const extractTextFromResponse = (response) => {
  if (!response || !Array.isArray(response.content)) {
    throw new Error("Claude response missing content array.");
  }
  const textBlock = response.content.find((block) => block?.type === "text" && typeof block.text === "string");
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

const validateGeneratedItem = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated item must be an object.");
  }
  assertString(parsed.prompt, PROMPT_MAX_LEN, "prompt");
  if (!Array.isArray(parsed.structured_steps)) {
    throw new Error("structured_steps must be an array.");
  }
  if (parsed.structured_steps.length < STEPS_MIN || parsed.structured_steps.length > STEPS_MAX) {
    throw new Error(`structured_steps must have between ${STEPS_MIN} and ${STEPS_MAX} entries.`);
  }
  const cleanedSteps = parsed.structured_steps.map((step, index) => {
    if (!step || typeof step !== "object") {
      throw new Error(`structured_steps[${index}] must be an object.`);
    }
    assertString(step.label, STEP_LABEL_MAX_LEN, `structured_steps[${index}].label`);
    assertString(step.content, STEP_CONTENT_MAX_LEN, `structured_steps[${index}].content`);
    return { label: step.label.trim(), content: step.content.trim() };
  });
  assertString(parsed.answer, ANSWER_MAX_LEN, "answer");
  const answerUnit = assertOptionalString(parsed.answer_unit, ANSWER_UNIT_MAX_LEN, "answer_unit");

  return {
    prompt: parsed.prompt.trim(),
    structured_steps: cleanedSteps,
    answer: parsed.answer.trim(),
    answer_unit: answerUnit.trim(),
  };
};

const callClaude = async (systemPrompt, userMessage) => {
  const response = await claudeClient.messages.create({
    model: claudeModel,
    max_tokens: MAX_TOKENS,
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
    throw new Error(`Could not parse Claude generator output as JSON: ${(error instanceof Error ? error.message : "unknown error")}`);
  }
  return {
    parsed,
    tokensIn: response.usage?.input_tokens ?? null,
    tokensOut: response.usage?.output_tokens ?? null,
  };
};

const fetchMathSkillContext = async () => {
  const result = await query(
    `
      SELECT id, iep_goal_text
      FROM skills
      WHERE name = 'math'
      LIMIT 1
    `,
  );
  if (result.rowCount === 0) {
    throw new Error("Math skill row missing from skills table.");
  }
  return result.rows[0];
};

const fetchStudentMathLevel = async (studentId) => {
  const result = await query(
    `
      SELECT level
      FROM student_skill_levels ssl
      INNER JOIN skills s ON s.id = ssl.skill_id
      WHERE ssl.student_id = $1
        AND s.name = 'math'
      LIMIT 1
    `,
    [studentId],
  );
  const level = Number.parseInt(String(result.rows[0]?.level), 10);
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    return 1;
  }
  return level;
};

const fetchRecentMisses = async (studentId) => {
  const result = await query(
    `
      SELECT i.prompt ->> 'text' AS prompt_text
      FROM attempts a
      INNER JOIN sessions s ON s.id = a.session_id
      INNER JOIN items i ON i.id = a.item_id
      INNER JOIN skills sk ON sk.id = i.skill_id
      WHERE s.student_id = $1
        AND sk.name = 'math'
        AND a.is_correct = FALSE
        AND a.attempted_at >= NOW() - INTERVAL '14 days'
      ORDER BY a.attempted_at DESC
      LIMIT 8
    `,
    [studentId],
  );
  return result.rows
    .map((row) => row.prompt_text)
    .filter((value) => typeof value === "string" && value.trim().length > 0);
};

const fetchStudentRow = async (studentId) => {
  const result = await query(
    `
      SELECT id, name, grade, interests
      FROM students
      WHERE id = $1
      LIMIT 1
    `,
    [studentId],
  );
  if (result.rowCount === 0) {
    throw new Error("Student not found.");
  }
  return result.rows[0];
};

export const buildStudentContextForMath = async (studentId) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const [studentRow, mathSkill, mathLevel, recentMisses] = await Promise.all([
    fetchStudentRow(studentId),
    fetchMathSkillContext(),
    fetchStudentMathLevel(studentId),
    fetchRecentMisses(studentId),
  ]);

  return {
    id: studentRow.id,
    name: studentRow.name,
    grade: studentRow.grade,
    interests: Array.isArray(studentRow.interests) ? studentRow.interests : [],
    math_level: mathLevel,
    iep_goal: mathSkill.iep_goal_text ?? "",
    recent_misses: recentMisses,
  };
};

export const generateMathItem = async (student, options = {}) => {
  const sanitized = sanitizeStudent(student);
  const systemPrompt = await loadSystemPrompt();
  const nonce =
    typeof options.nonce === "string" && options.nonce.length > 0 && options.nonce.length <= 64
      ? options.nonce
      : crypto.randomBytes(8).toString("hex");
  const userMessage = buildUserMessage(sanitized, nonce);
  const inputHash = hashInput(systemPrompt, userMessage);

  const cached = await findCachedGeneration(inputHash);
  if (cached) {
    try {
      return validateGeneratedItem(cached);
    } catch {
      // Fall through to a fresh generation if the cached row is somehow malformed.
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaude(systemPrompt, userMessage);
  const validated = validateGeneratedItem(parsed);

  await recordGeneration({
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

const insertGeneratedItem = async (studentId, mathSkillId, mathLevel, generated) => {
  const itemResult = await query(
    `
      INSERT INTO items (
        skill_id,
        level,
        item_type,
        prompt,
        answer,
        metadata,
        ai_generated
      )
      VALUES ($1, $2, 'word_problem', $3::jsonb, $4::jsonb, $5::jsonb, TRUE)
      RETURNING id
    `,
    [
      mathSkillId,
      mathLevel,
      JSON.stringify({ text: generated.prompt }),
      JSON.stringify({ text: generated.answer, unit: generated.answer_unit }),
      JSON.stringify({
        structured_steps: generated.structured_steps,
        answer_unit: generated.answer_unit,
        generated_at: new Date().toISOString(),
        source: "math_generator_v1",
      }),
    ],
  );
  const itemId = itemResult.rows[0].id;

  await query(
    `
      INSERT INTO item_mastery (
        student_id,
        item_id,
        tier,
        consecutive_correct,
        total_attempts,
        total_correct,
        next_review_at
      )
      VALUES ($1, $2, 0, 0, 0, 0, NOW())
      ON CONFLICT (student_id, item_id) DO NOTHING
    `,
    [studentId, itemId],
  );

  return itemId;
};

const countQueueEligibleMathItems = async (studentId, mathSkillId, mathLevel) => {
  const result = await query(
    `
      SELECT COUNT(*)::INT AS eligible_count
      FROM items i
      LEFT JOIN item_mastery im
        ON im.item_id = i.id
       AND im.student_id = $1
      WHERE i.skill_id = $2
        AND i.level = $3
        AND i.ai_generated = TRUE
        AND (im.tier IS NULL OR im.tier <= 2)
        AND (im.next_review_at IS NULL OR im.next_review_at <= NOW())
    `,
    [studentId, mathSkillId, mathLevel],
  );
  return Number(result.rows[0]?.eligible_count ?? 0);
};

export const ensureMathQueueItems = async (studentId, mathSkillId, requiredCount) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  if (!Number.isInteger(mathSkillId) || mathSkillId < 1) {
    throw new Error("mathSkillId must be a positive integer.");
  }
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 20) {
    throw new Error("requiredCount must be an integer between 1 and 20.");
  }

  const studentContext = await buildStudentContextForMath(studentId);
  const mathLevel = studentContext.math_level;
  const eligible = await countQueueEligibleMathItems(studentId, mathSkillId, mathLevel);
  const shortfall = Math.max(0, requiredCount - eligible);
  if (shortfall === 0) {
    return { generated: 0, eligibleBefore: eligible, eligibleAfter: eligible };
  }

  const generationPromises = [];
  for (let index = 0; index < shortfall; index += 1) {
    const nonce = `${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString("hex")}`;
    generationPromises.push(generateMathItem(studentContext, { nonce }));
  }
  const generated = await Promise.all(generationPromises);

  for (const item of generated) {
    await insertGeneratedItem(studentId, mathSkillId, mathLevel, item);
  }

  return {
    generated: generated.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generated.length,
  };
};
