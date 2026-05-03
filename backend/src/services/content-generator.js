import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeClient, claudeModel } from "./claude.js";
import { query } from "../db.js";
import { normalizeSkillsTableId } from "../utils/postgres-ids.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "math-generator.md");
const WRITING_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "writing-generator.md");
const PURPOSE = "math_generate";
const WRITING_PURPOSE = "writing_generate";
const MAX_TOKENS = 800;
const WRITING_MAX_TOKENS = 1_000;

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
let cachedWritingPrompt = null;

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

const loadWritingPrompt = async () => {
  if (cachedWritingPrompt) {
    return cachedWritingPrompt;
  }
  const contents = await fs.readFile(WRITING_PROMPT_PATH, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error("writing-generator.md prompt is missing or too short.");
  }
  cachedWritingPrompt = contents;
  return cachedWritingPrompt;
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

const fetchSkillRow = async (skillName) => {
  const result = await query(
    `
      SELECT id, iep_goal_text
      FROM skills
      WHERE name = $1
      LIMIT 1
    `,
    [skillName],
  );
  if (result.rowCount === 0) {
    throw new Error(`Skill ${skillName} missing from skills table.`);
  }
  return result.rows[0];
};

const fetchStudentSkillLevel = async (studentId, skillName) => {
  const result = await query(
    `
      SELECT ssl.level
      FROM student_skill_levels ssl
      INNER JOIN skills s ON s.id = ssl.skill_id
      WHERE ssl.student_id = $1
        AND s.name = $2
      LIMIT 1
    `,
    [studentId, skillName],
  );
  const level = Number.parseInt(String(result.rows[0]?.level), 10);
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    return 1;
  }
  return level;
};

const fetchWritingSessionItemCount = async (studentId) => {
  const result = await query(
    `
      SELECT current_value
      FROM student_tuning
      WHERE student_id = $1::uuid
        AND parameter_name = ANY($2::text[])
      ORDER BY CASE WHEN parameter_name = 'session_item_count_writing' THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [studentId, ["session_item_count_writing", "session_item_count"]],
  );
  const raw = result.rows[0]?.current_value;
  const n = Number.parseInt(String(raw ?? "1"), 10);
  if (Number.isInteger(n) && n >= 1 && n <= 3) {
    return n;
  }
  return 1;
};

const sanitizeWritingTemplate = (template) => {
  if (!template || typeof template !== "object") {
    throw new Error("writing template must be an object.");
  }
  const topicTemplate =
    typeof template.topic_template === "string" ? template.topic_template.trim() : "";
  if (topicTemplate.length < 8 || topicTemplate.length > 320) {
    throw new Error("topic_template must be 8-320 characters.");
  }
  const minWords = Number.parseInt(String(template.min_words), 10);
  const maxWords = Number.parseInt(String(template.max_words), 10);
  if (!Number.isInteger(minWords) || !Number.isInteger(maxWords) || minWords < 20 || maxWords > 200) {
    throw new Error("min_words/max_words are out of bounds.");
  }
  if (minWords > maxWords) {
    throw new Error("min_words cannot be greater than max_words.");
  }
  const rubricFocus = Array.isArray(template.rubric_focus)
    ? template.rubric_focus
        .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().toLowerCase().slice(0, 40))
        .slice(0, 8)
    : [];

  return {
    topic_template: topicTemplate,
    min_words: minWords,
    max_words: maxWords,
    rubric_focus: rubricFocus,
  };
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

  const cached = await findCachedGeneration(PURPOSE, inputHash);
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
    purpose: PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const buildStudentContextForWriting = async (studentId) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const [studentRow, writingSkill, writingLevel, sessionItemCount] = await Promise.all([
    fetchStudentRow(studentId),
    fetchSkillRow("writing"),
    fetchStudentSkillLevel(studentId, "writing"),
    fetchWritingSessionItemCount(studentId),
  ]);
  return {
    id: studentRow.id,
    name: typeof studentRow.name === "string" ? studentRow.name.trim().slice(0, 60) : "Brielle",
    grade: Number.parseInt(String(studentRow.grade), 10),
    interests: Array.isArray(studentRow.interests) ? studentRow.interests : [],
    writing_level: writingLevel,
    iep_goal_text: typeof writingSkill.iep_goal_text === "string" ? writingSkill.iep_goal_text.slice(0, 800) : "",
    session_item_count: sessionItemCount,
  };
};

const validateWritingRendition = (parsed, template) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated writing rendition must be an object.");
  }
  assertString(parsed.rendered_prompt, 420, "rendered_prompt");
  assertString(parsed.word_count_guidance, 120, "word_count_guidance");
  if (!Array.isArray(parsed.rubric_criteria) || parsed.rubric_criteria.length !== 4) {
    throw new Error("rubric_criteria must contain 4 entries.");
  }
  const allowedNames = new Set(["Conventions", "Sentence Variety", "Main Idea", "Detail"]);
  const criteria = parsed.rubric_criteria.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`rubric_criteria[${index}] must be an object.`);
    }
    assertString(entry.name, 60, `rubric_criteria[${index}].name`);
    assertString(entry.description, 200, `rubric_criteria[${index}].description`);
    const maxPoints = Number.parseInt(String(entry.max_points), 10);
    if (!Number.isInteger(maxPoints) || maxPoints !== 25) {
      throw new Error(`rubric_criteria[${index}].max_points must be 25.`);
    }
    if (!allowedNames.has(entry.name.trim())) {
      throw new Error(`rubric_criteria[${index}].name is invalid.`);
    }
    return {
      name: entry.name.trim(),
      description: entry.description.trim(),
      max_points: maxPoints,
    };
  });

  return {
    rendered_prompt: parsed.rendered_prompt.trim(),
    word_count_guidance: parsed.word_count_guidance.trim(),
    rubric_criteria: criteria,
    min_words: template.min_words,
    max_words: template.max_words,
    rubric_focus: template.rubric_focus,
    topic_template: template.topic_template,
  };
};

export const generateWritingRendition = async (template, student, options = {}) => {
  const sanitizedTemplate = sanitizeWritingTemplate(template);
  if (!student || typeof student !== "object") {
    throw new Error("student must be an object.");
  }
  const writingLevel = Number.parseInt(String(student.writing_level), 10);
  if (!Number.isInteger(writingLevel) || writingLevel < 1 || writingLevel > 10) {
    throw new Error("student.writing_level must be an integer between 1 and 10.");
  }
  const systemPrompt = await loadWritingPrompt();
  const nonce =
    typeof options.nonce === "string" && options.nonce.length > 0 && options.nonce.length <= 64
      ? options.nonce
      : crypto.randomBytes(8).toString("hex");
  const userMessage = JSON.stringify(
    {
      student_name: typeof student.name === "string" ? student.name.trim().slice(0, 60) : "Brielle",
      grade: Number.parseInt(String(student.grade), 10),
      writing_level: writingLevel,
      interests: Array.isArray(student.interests)
        ? student.interests
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim().slice(0, 40))
            .slice(0, 8)
        : [],
      iep_goal_text: typeof student.iep_goal_text === "string" ? student.iep_goal_text.slice(0, 800) : "",
      topic_template: sanitizedTemplate.topic_template,
      min_words: sanitizedTemplate.min_words,
      max_words: sanitizedTemplate.max_words,
      rubric_focus: sanitizedTemplate.rubric_focus,
      nonce,
    },
    null,
    2,
  );
  const inputHash = hashInput(systemPrompt, `${WRITING_PURPOSE}\u0000${userMessage}`);

  const cached = await findCachedGeneration(WRITING_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateWritingRendition(cached, sanitizedTemplate);
    } catch {
      // regenerate
    }
  }

  const response = await claudeClient.messages.create({
    model: claudeModel,
    max_tokens: WRITING_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = extractTextFromResponse(response);
  const stripped = stripCodeFences(text);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    throw new Error(
      `Could not parse Claude writing output as JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  const validated = validateWritingRendition(parsed, sanitizedTemplate);
  await recordGeneration({
    purpose: WRITING_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn: response.usage?.input_tokens ?? null,
    tokensOut: response.usage?.output_tokens ?? null,
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
  const mathSkillPk = normalizeSkillsTableId(mathSkillId, "mathSkillId");
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 20) {
    throw new Error("requiredCount must be an integer between 1 and 20.");
  }

  const studentContext = await buildStudentContextForMath(studentId);
  const mathLevel = studentContext.math_level;
  const eligible = await countQueueEligibleMathItems(studentId, mathSkillPk, mathLevel);
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
    await insertGeneratedItem(studentId, mathSkillPk, mathLevel, item);
  }

  return {
    generated: generated.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generated.length,
  };
};

const fetchWritingTemplateRows = async (writingSkillId, writingLevel) => {
  const result = await query(
    `
      SELECT id, prompt
      FROM items
      WHERE skill_id = $1
        AND level = $2
        AND item_type = 'writing_prompt'
        AND COALESCE(metadata ->> 'kind', '') = 'template'
      ORDER BY created_at ASC
    `,
    [writingSkillId, writingLevel],
  );
  return result.rows;
};

const countQueueEligibleWritingItems = async (studentId, writingSkillId, writingLevel) => {
  const result = await query(
    `
      SELECT COUNT(*)::INT AS eligible_count
      FROM items i
      LEFT JOIN item_mastery im
        ON im.item_id = i.id
       AND im.student_id = $1
      WHERE i.skill_id = $2
        AND i.level = $3
        AND i.item_type = 'writing_prompt'
        AND i.ai_generated = TRUE
        AND COALESCE(i.metadata ->> 'kind', '') = 'rendered'
        AND (im.tier IS NULL OR im.tier <= 2)
        AND (im.next_review_at IS NULL OR im.next_review_at <= NOW())
    `,
    [studentId, writingSkillId, writingLevel],
  );
  return Number(result.rows[0]?.eligible_count ?? 0);
};

const insertGeneratedWritingItem = async (studentId, writingSkillId, writingLevel, rendition) => {
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
      VALUES ($1, $2, 'writing_prompt', $3::jsonb, $4::jsonb, $5::jsonb, TRUE)
      RETURNING id
    `,
    [
      writingSkillId,
      writingLevel,
      JSON.stringify({
        text: rendition.rendered_prompt,
        min_words: rendition.min_words,
        max_words: rendition.max_words,
        word_count_guidance: rendition.word_count_guidance,
      }),
      JSON.stringify({ text: "" }),
      JSON.stringify({
        kind: "rendered",
        rubric_criteria: rendition.rubric_criteria,
        rubric_focus: rendition.rubric_focus,
        topic_template: rendition.topic_template,
        generated_at: new Date().toISOString(),
        source: "writing_generator_v1",
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

export const ensureWritingQueueItems = async (studentId, writingSkillId, requiredCount) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const writingSkillPk = normalizeSkillsTableId(writingSkillId, "writingSkillId");
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 5) {
    throw new Error("requiredCount must be an integer between 1 and 5.");
  }

  const studentContext = await buildStudentContextForWriting(studentId);
  const writingLevel = studentContext.writing_level;
  const eligible = await countQueueEligibleWritingItems(studentId, writingSkillPk, writingLevel);
  const shortfall = Math.max(0, requiredCount - eligible);
  if (shortfall === 0) {
    return { generated: 0, eligibleBefore: eligible, eligibleAfter: eligible };
  }

  const templateRows = await fetchWritingTemplateRows(writingSkillPk, writingLevel);
  if (templateRows.length === 0) {
    throw new Error("No writing prompt templates available for the student's level.");
  }

  const generatedItems = [];
  for (let index = 0; index < shortfall; index += 1) {
    const templateRow = templateRows[index % templateRows.length];
    const templatePrompt = templateRow.prompt && typeof templateRow.prompt === "object" ? templateRow.prompt : {};
    const nonce = `${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString("hex")}`;
    const rendition = await generateWritingRendition(templatePrompt, studentContext, { nonce });
    generatedItems.push(rendition);
  }

  for (const item of generatedItems) {
    await insertGeneratedWritingItem(studentId, writingSkillPk, writingLevel, item);
  }

  return {
    generated: generatedItems.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generatedItems.length,
  };
};
