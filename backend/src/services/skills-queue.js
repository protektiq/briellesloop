import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeClient, claudeModel } from "./claude.js";
import { query } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const READING_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "reading-generator.md");
const TYPING_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "typing-generator.md");
const SPELLING_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "spelling-generator.md");

const READING_PURPOSE = "reading_generate";
const TYPING_PURPOSE = "typing_generate";
const SPELLING_PURPOSE = "spelling_generate";

const READING_MAX_TOKENS = 3_000;
const TYPING_MAX_TOKENS = 800;
const SPELLING_MAX_TOKENS = 600;

const SPELLING_POOLS = new Set(["multisyllabic", "r_controlled", "variant_vowel"]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let readingPromptCache = null;
let typingPromptCache = null;
let spellingPromptCache = null;

const loadReadingPrompt = async () => {
  if (readingPromptCache) {
    return readingPromptCache;
  }
  const contents = await fs.readFile(READING_PROMPT_PATH, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error("reading-generator.md prompt is missing or too short.");
  }
  readingPromptCache = contents;
  return readingPromptCache;
};

const loadTypingPrompt = async () => {
  if (typingPromptCache) {
    return typingPromptCache;
  }
  const contents = await fs.readFile(TYPING_PROMPT_PATH, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error("typing-generator.md prompt is missing or too short.");
  }
  typingPromptCache = contents;
  return typingPromptCache;
};

const loadSpellingPrompt = async () => {
  if (spellingPromptCache) {
    return spellingPromptCache;
  }
  const contents = await fs.readFile(SPELLING_PROMPT_PATH, "utf8");
  if (typeof contents !== "string" || contents.trim().length < 100) {
    throw new Error("spelling-generator.md prompt is missing or too short.");
  }
  spellingPromptCache = contents;
  return spellingPromptCache;
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

const wordCount = (text) => {
  if (typeof text !== "string") {
    return 0;
  }
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
};

const assertString = (value, max, label) => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.length === 0 || value.length > max) {
    throw new Error(`${label} must be 1-${max} characters.`);
  }
};

const validateReadingGenerated = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated reading item must be an object.");
  }
  assertString(parsed.title, 120, "title");
  assertString(parsed.passage, 12_000, "passage");
  const wc = wordCount(parsed.passage);
  if (wc < 100 || wc > 300) {
    throw new Error(`passage must be 100-300 words (got ${wc}).`);
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 3) {
    throw new Error("questions must be an array of length 3.");
  }
  const expectedOrder = ["main_idea", "supporting_detail", "inference"];
  const cleaned = parsed.questions.map((q, index) => {
    if (!q || typeof q !== "object") {
      throw new Error(`questions[${index}] must be an object.`);
    }
    const type = typeof q.type === "string" ? q.type.trim() : "";
    if (type !== expectedOrder[index]) {
      throw new Error(`questions[${index}].type must be "${expectedOrder[index]}".`);
    }
    assertString(q.text, 400, `questions[${index}].text`);
    assertString(q.expected_answer, 500, `questions[${index}].expected_answer`);
    return {
      type,
      text: q.text.trim(),
      expected_answer: q.expected_answer.trim(),
    };
  });
  return {
    title: parsed.title.trim(),
    passage: parsed.passage.trim(),
    questions: cleaned,
  };
};

const validateTypingGenerated = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated typing item must be an object.");
  }
  assertString(parsed.sentence, 2_000, "sentence");
  const wc = wordCount(parsed.sentence);
  if (wc < 10 || wc > 25) {
    throw new Error(`sentence must be 10-25 words (got ${wc}).`);
  }
  return { sentence: parsed.sentence.trim() };
};

const validateSpellingGenerated = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated spelling item must be an object.");
  }
  const rawWord =
    typeof parsed.word === "string" ? parsed.word.trim().toLowerCase().slice(0, 40) : "";
  if (rawWord.length < 2 || rawWord.length > 32) {
    throw new Error("word must be 2-32 characters.");
  }
  if (!/^[a-z]+$/.test(rawWord)) {
    throw new Error("word must contain letters a-z only.");
  }
  const pool = typeof parsed.pool === "string" ? parsed.pool.trim() : "";
  if (!SPELLING_POOLS.has(pool)) {
    throw new Error("pool must be multisyllabic, r_controlled, or variant_vowel.");
  }
  let promptText =
    typeof parsed.prompt_text === "string" ? parsed.prompt_text.trim().slice(0, 120) : "";
  if (promptText.length === 0) {
    promptText = "Listen and spell the word.";
  }
  return { word: rawWord, pool, prompt_text: promptText };
};

const callClaudeJson = async (systemPrompt, userMessage, maxTokens) => {
  const response = await claudeClient.messages.create({
    model: claudeModel,
    max_tokens: maxTokens,
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
      `Could not parse Claude output as JSON: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  return {
    parsed,
    tokensIn: response.usage?.input_tokens ?? null,
    tokensOut: response.usage?.output_tokens ?? null,
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

const fetchSkillRow = async (name) => {
  const result = await query(
    `
      SELECT id, iep_goal_text
      FROM skills
      WHERE name = $1
      LIMIT 1
    `,
    [name],
  );
  if (result.rowCount === 0) {
    throw new Error(`Skill ${name} missing from skills table.`);
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

const fetchRecentMissesForSkill = async (studentId, skillName) => {
  const result = await query(
    `
      SELECT
        CASE
          WHEN i.item_type = 'spelling_word' THEN
            COALESCE(NULLIF(TRIM(i.metadata ->> 'word'), ''), i.answer ->> 'text', i.prompt ->> 'text')
          ELSE i.prompt ->> 'text'
        END AS miss_text
      FROM attempts a
      INNER JOIN sessions s ON s.id = a.session_id
      INNER JOIN items i ON i.id = a.item_id
      INNER JOIN skills sk ON sk.id = i.skill_id
      WHERE s.student_id = $1
        AND sk.name = $2
        AND a.is_correct = FALSE
        AND a.attempted_at >= NOW() - INTERVAL '14 days'
      ORDER BY a.attempted_at DESC
      LIMIT 8
    `,
    [studentId, skillName],
  );
  return result.rows
    .map((row) => row.miss_text)
    .filter((value) => typeof value === "string" && value.trim().length > 0);
};

const fetchSessionItemCount = async (studentId) => {
  const result = await query(
    `
      SELECT current_value
      FROM student_tuning
      WHERE student_id = $1::uuid
        AND parameter_name = 'session_item_count'
      LIMIT 1
    `,
    [studentId],
  );
  const raw = result.rows[0]?.current_value;
  const n = Number.parseInt(String(raw ?? "5"), 10);
  if (Number.isInteger(n) && n >= 3 && n <= 10) {
    return n;
  }
  return 5;
};

export const buildStudentContextForReading = async (studentId) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const [studentRow, skillRow, readingLevel, recentMisses, sessionItemCount] = await Promise.all([
    fetchStudentRow(studentId),
    fetchSkillRow("reading"),
    fetchStudentSkillLevel(studentId, "reading"),
    fetchRecentMissesForSkill(studentId, "reading"),
    fetchSessionItemCount(studentId),
  ]);

  return {
    id: studentRow.id,
    name: typeof studentRow.name === "string" ? studentRow.name.trim().slice(0, 60) : "Brielle",
    grade: Number.parseInt(String(studentRow.grade), 10),
    interests: Array.isArray(studentRow.interests) ? studentRow.interests : [],
    reading_level: readingLevel,
    iep_goal: skillRow.iep_goal_text ?? "",
    recent_misses: recentMisses,
    session_item_count: sessionItemCount,
  };
};

export const buildStudentContextForTyping = async (studentId) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const [studentRow, skillRow, typingLevel, sessionItemCount] = await Promise.all([
    fetchStudentRow(studentId),
    fetchSkillRow("typing"),
    fetchStudentSkillLevel(studentId, "typing"),
    fetchSessionItemCount(studentId),
  ]);

  return {
    id: studentRow.id,
    name: typeof studentRow.name === "string" ? studentRow.name.trim().slice(0, 60) : "Brielle",
    grade: Number.parseInt(String(studentRow.grade), 10),
    interests: Array.isArray(studentRow.interests) ? studentRow.interests : [],
    typing_level: typingLevel,
    iep_goal: skillRow.iep_goal_text ?? "",
    session_item_count: sessionItemCount,
  };
};

const buildStudentContextForSpelling = async (studentId) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  const [studentRow, skillRow, spellingLevel, recentMisses, sessionItemCount] = await Promise.all([
    fetchStudentRow(studentId),
    fetchSkillRow("spelling"),
    fetchStudentSkillLevel(studentId, "spelling"),
    fetchRecentMissesForSkill(studentId, "spelling"),
    fetchSessionItemCount(studentId),
  ]);

  return {
    id: studentRow.id,
    name: typeof studentRow.name === "string" ? studentRow.name.trim().slice(0, 60) : "Brielle",
    grade: Number.parseInt(String(studentRow.grade), 10),
    interests: Array.isArray(studentRow.interests) ? studentRow.interests : [],
    spelling_level: spellingLevel,
    iep_goal: skillRow.iep_goal_text ?? "",
    recent_misses: recentMisses,
    session_item_count: sessionItemCount,
  };
};

export const generateReadingItem = async (student, options = {}) => {
  if (!student || typeof student !== "object") {
    throw new Error("student must be an object.");
  }
  const systemPrompt = await loadReadingPrompt();
  const nonce =
    typeof options.nonce === "string" && options.nonce.length > 0 && options.nonce.length <= 64
      ? options.nonce
      : crypto.randomBytes(8).toString("hex");
  const userMessage = JSON.stringify(
    {
      student_name: student.name,
      grade: student.grade,
      reading_level: student.reading_level,
      interests: student.interests,
      iep_goal: student.iep_goal,
      recent_misses: student.recent_misses ?? [],
      session_item_count: student.session_item_count ?? 5,
      nonce,
    },
    null,
    2,
  );
  const inputHash = hashInput(READING_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(READING_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateReadingGenerated(cached);
    } catch {
      // regenerate
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaudeJson(systemPrompt, userMessage, READING_MAX_TOKENS);
  const validated = validateReadingGenerated(parsed);

  await recordGeneration({
    purpose: READING_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const generateTypingItem = async (student, options = {}) => {
  if (!student || typeof student !== "object") {
    throw new Error("student must be an object.");
  }
  const systemPrompt = await loadTypingPrompt();
  const nonce =
    typeof options.nonce === "string" && options.nonce.length > 0 && options.nonce.length <= 64
      ? options.nonce
      : crypto.randomBytes(8).toString("hex");
  const userMessage = JSON.stringify(
    {
      student_name: student.name,
      grade: student.grade,
      typing_level: student.typing_level,
      interests: student.interests,
      iep_goal: student.iep_goal,
      session_item_count: student.session_item_count ?? 5,
      nonce,
    },
    null,
    2,
  );
  const inputHash = hashInput(TYPING_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(TYPING_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateTypingGenerated(cached);
    } catch {
      // regenerate
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaudeJson(systemPrompt, userMessage, TYPING_MAX_TOKENS);
  const validated = validateTypingGenerated(parsed);

  await recordGeneration({
    purpose: TYPING_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

export const generateSpellingItem = async (student, options = {}) => {
  if (!student || typeof student !== "object") {
    throw new Error("student must be an object.");
  }
  const systemPrompt = await loadSpellingPrompt();
  const nonce =
    typeof options.nonce === "string" && options.nonce.length > 0 && options.nonce.length <= 64
      ? options.nonce
      : crypto.randomBytes(8).toString("hex");
  const userMessage = JSON.stringify(
    {
      student_name: student.name,
      grade: student.grade,
      spelling_level: student.spelling_level,
      interests: student.interests,
      iep_goal: student.iep_goal,
      recent_misses: student.recent_misses ?? [],
      session_item_count: student.session_item_count ?? 5,
      nonce,
    },
    null,
    2,
  );
  const inputHash = hashInput(SPELLING_PURPOSE, systemPrompt, userMessage);

  const cached = await findCachedGeneration(SPELLING_PURPOSE, inputHash);
  if (cached) {
    try {
      return validateSpellingGenerated(cached);
    } catch {
      /* regenerate */
    }
  }

  const { parsed, tokensIn, tokensOut } = await callClaudeJson(
    systemPrompt,
    userMessage,
    SPELLING_MAX_TOKENS,
  );
  const validated = validateSpellingGenerated(parsed);

  await recordGeneration({
    purpose: SPELLING_PURPOSE,
    inputPrompt: userMessage,
    inputHash,
    output: validated,
    tokensIn,
    tokensOut,
  });

  return validated;
};

const insertReadingItemRow = async (studentId, readingSkillId, readingLevel, generated) => {
  const firstAnswer = generated.questions[0]?.expected_answer ?? "";
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
      VALUES ($1, $2, 'reading_passage', $3::jsonb, $4::jsonb, $5::jsonb, TRUE)
      RETURNING id
    `,
    [
      readingSkillId,
      readingLevel,
      JSON.stringify({ text: generated.title }),
      JSON.stringify({ text: firstAnswer }),
      JSON.stringify({
        passage: generated.passage,
        title: generated.title,
        questions: generated.questions,
        generated_at: new Date().toISOString(),
        source: "reading_generator_v1",
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

const insertTypingItemRow = async (studentId, typingSkillId, typingLevel, generated) => {
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
      VALUES ($1, $2, 'typing_sentence', $3::jsonb, $4::jsonb, $5::jsonb, TRUE)
      RETURNING id
    `,
    [
      typingSkillId,
      typingLevel,
      JSON.stringify({ text: generated.sentence }),
      JSON.stringify({ text: generated.sentence }),
      JSON.stringify({
        generated_at: new Date().toISOString(),
        source: "typing_generator_v1",
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

const insertSpellingItemRow = async (studentId, spellingSkillId, spellingLevel, generated) => {
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
      VALUES ($1, $2, 'spelling_word', $3::jsonb, $4::jsonb, $5::jsonb, TRUE)
      RETURNING id
    `,
    [
      spellingSkillId,
      spellingLevel,
      JSON.stringify({ text: generated.prompt_text }),
      JSON.stringify({ text: generated.word }),
      JSON.stringify({
        pool: generated.pool,
        word: generated.word,
        generated_at: new Date().toISOString(),
        source: "spelling_generator_v1",
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

const countQueueEligibleAiItems = async (studentId, skillId, skillLevel) => {
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
    [studentId, skillId, skillLevel],
  );
  return Number(result.rows[0]?.eligible_count ?? 0);
};

const countQueueEligibleSpellingItems = async (studentId, spellingSkillId, spellingLevel) => {
  const result = await query(
    `
      SELECT COUNT(*)::INT AS eligible_count
      FROM items i
      LEFT JOIN item_mastery im
        ON im.item_id = i.id
       AND im.student_id = $1
      WHERE i.skill_id = $2
        AND i.level = $3
        AND i.item_type = 'spelling_word'
        AND (im.tier IS NULL OR im.tier <= 2)
        AND (im.next_review_at IS NULL OR im.next_review_at <= NOW())
    `,
    [studentId, spellingSkillId, spellingLevel],
  );
  return Number(result.rows[0]?.eligible_count ?? 0);
};

export const ensureReadingQueueItems = async (studentId, readingSkillId, requiredCount) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  if (!Number.isInteger(readingSkillId) || readingSkillId < 1) {
    throw new Error("readingSkillId must be a positive integer.");
  }
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 20) {
    throw new Error("requiredCount must be an integer between 1 and 20.");
  }

  const studentContext = await buildStudentContextForReading(studentId);
  const readingLevel = studentContext.reading_level;
  const eligible = await countQueueEligibleAiItems(studentId, readingSkillId, readingLevel);
  const shortfall = Math.max(0, requiredCount - eligible);
  if (shortfall === 0) {
    return { generated: 0, eligibleBefore: eligible, eligibleAfter: eligible };
  }

  const generationPromises = [];
  for (let index = 0; index < shortfall; index += 1) {
    const nonce = `${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString("hex")}`;
    generationPromises.push(generateReadingItem(studentContext, { nonce }));
  }
  const generated = await Promise.all(generationPromises);

  for (const item of generated) {
    await insertReadingItemRow(studentId, readingSkillId, readingLevel, item);
  }

  return {
    generated: generated.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generated.length,
  };
};

export const ensureTypingQueueItems = async (studentId, typingSkillId, requiredCount) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  if (!Number.isInteger(typingSkillId) || typingSkillId < 1) {
    throw new Error("typingSkillId must be a positive integer.");
  }
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 20) {
    throw new Error("requiredCount must be an integer between 1 and 20.");
  }

  const studentContext = await buildStudentContextForTyping(studentId);
  const typingLevel = studentContext.typing_level;
  const eligible = await countQueueEligibleAiItems(studentId, typingSkillId, typingLevel);
  const shortfall = Math.max(0, requiredCount - eligible);
  if (shortfall === 0) {
    return { generated: 0, eligibleBefore: eligible, eligibleAfter: eligible };
  }

  const generationPromises = [];
  for (let index = 0; index < shortfall; index += 1) {
    const nonce = `${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString("hex")}`;
    generationPromises.push(generateTypingItem(studentContext, { nonce }));
  }
  const generated = await Promise.all(generationPromises);

  for (const item of generated) {
    await insertTypingItemRow(studentId, typingSkillId, typingLevel, item);
  }

  return {
    generated: generated.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generated.length,
  };
};

export const ensureSpellingQueueItems = async (studentId, spellingSkillId, requiredCount) => {
  if (typeof studentId !== "string" || !UUID_REGEX.test(studentId)) {
    throw new Error("studentId must be a valid UUID.");
  }
  if (!Number.isInteger(spellingSkillId) || spellingSkillId < 1) {
    throw new Error("spellingSkillId must be a positive integer.");
  }
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 20) {
    throw new Error("requiredCount must be an integer between 1 and 20.");
  }

  const studentContext = await buildStudentContextForSpelling(studentId);
  const spellingLevel = studentContext.spelling_level;
  const eligible = await countQueueEligibleSpellingItems(studentId, spellingSkillId, spellingLevel);
  const shortfall = Math.max(0, requiredCount - eligible);
  if (shortfall === 0) {
    return { generated: 0, eligibleBefore: eligible, eligibleAfter: eligible };
  }

  const generationPromises = [];
  for (let index = 0; index < shortfall; index += 1) {
    const nonce = `${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString("hex")}`;
    generationPromises.push(generateSpellingItem(studentContext, { nonce }));
  }
  const generated = await Promise.all(generationPromises);

  for (const item of generated) {
    await insertSpellingItemRow(studentId, spellingSkillId, spellingLevel, item);
  }

  return {
    generated: generated.length,
    eligibleBefore: eligible,
    eligibleAfter: eligible + generated.length,
  };
};
