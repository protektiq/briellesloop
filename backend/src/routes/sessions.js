import { Router } from "express";
import { query } from "../db.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_REGEX = /^[a-z]{2,24}$/;
const MOOD_EMOJI_SET = new Set(["😢", "😟", "😐", "🙂", "😄"]);
const BRAIN_BREAK_TRIGGER_SET = new Set([
  "auto_two_wrong",
  "auto_slow",
  "user_button",
  "low_mood",
  "agent_predicted",
]);

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

const parseUuid = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!UUID_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const parseSkillName = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!SKILL_NAME_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const parseMoodEmoji = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!MOOD_EMOJI_SET.has(trimmed)) {
    return null;
  }

  return trimmed;
};

const parseMoodScore = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 0 || parsed > 10) {
    return null;
  }

  return parsed;
};

const parseReflection = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_000) {
    return null;
  }

  return trimmed;
};

const parseDurationSeconds = (value) => {
  if (value === undefined || value === null) {
    return 180;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 0 || parsed > 1_800) {
    return null;
  }

  return parsed;
};

const parseBrainBreakTrigger = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!BRAIN_BREAK_TRIGGER_SET.has(trimmed)) {
    return null;
  }

  return trimmed;
};

router.post("/start", async (req, res, next) => {
  try {
    const {
      student_id: rawStudentId,
      skill: rawSkill,
      pre_mood_emoji: rawPreMoodEmoji,
      pre_mood_score: rawPreMoodScore,
    } = req.body ?? {};

    const studentId = parseUuid(rawStudentId);
    const skillName = parseSkillName(rawSkill);
    const preMoodEmoji = parseMoodEmoji(rawPreMoodEmoji);
    const preMoodScore = parseMoodScore(rawPreMoodScore);

    if (!studentId || !skillName || !preMoodEmoji || preMoodScore === null) {
      return res.status(400).json({
        error: "Invalid request body.",
        fields: {
          student_id: "Required UUID string.",
          skill: "Required skill name, 2-24 lowercase letters.",
          pre_mood_emoji: "Required mood emoji from 😢 😟 😐 🙂 😄.",
          pre_mood_score: "Required integer from 0 to 10.",
        },
      });
    }

    const skillLookupResult = await query(
      `
        SELECT id, name
        FROM skills
        WHERE name = $1
        LIMIT 1
      `,
      [skillName],
    );

    const matchedSkill = skillLookupResult.rows[0];
    if (!matchedSkill) {
      return res.status(404).json({
        error: "Unknown skill.",
        field: "skill",
      });
    }

    const insertResult = await query(
      `
        INSERT INTO sessions (
          student_id,
          skill_id,
          pre_mood_emoji,
          pre_mood_score
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, started_at
      `,
      [studentId, matchedSkill.id, preMoodEmoji, preMoodScore],
    );

    const insertedSession = insertResult.rows[0];
    return res.status(201).json({
      session_id: insertedSession.id,
      student_id: studentId,
      skill_name: matchedSkill.name,
      pre_mood_emoji: preMoodEmoji,
      pre_mood_score: preMoodScore,
      status: "active",
      started_at: insertedSession.started_at,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/end", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body ?? {};

    const sessionId = parseUuid(id);
    if (!sessionId) {
      return res.status(400).json({
        error: "Invalid session id.",
        field: "id must be a valid UUID.",
      });
    }

    if (reason !== undefined && !isNonEmptyString(reason, 120)) {
      return res.status(400).json({
        error: "Invalid reason.",
        field: "reason must be a non-empty string up to 120 chars when provided.",
      });
    }

    // Idempotent: COALESCE preserves the original ended_at when called twice.
    // items_attempted / items_correct are recomputed from the source of truth (attempts).
    const updateResult = await query(
      `
        UPDATE sessions
        SET ended_at = COALESCE(ended_at, NOW()),
            items_attempted = (
              SELECT COUNT(*) FROM attempts WHERE session_id = $1
            ),
            items_correct = (
              SELECT COUNT(*) FROM attempts WHERE session_id = $1 AND is_correct = TRUE
            )
        WHERE id = $1
        RETURNING id, started_at, ended_at, items_attempted, items_correct
      `,
      [sessionId],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({
        error: "Session not found.",
      });
    }

    const row = updateResult.rows[0];
    return res.json({
      session_id: row.id,
      status: "completed",
      started_at: row.started_at,
      ended_at: row.ended_at,
      reason: reason?.trim() ?? "completed_target",
      summary: {
        items_attempted: Number(row.items_attempted ?? 0),
        items_correct: Number(row.items_correct ?? 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/post-checkout", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      post_mood_emoji: rawPostMoodEmoji,
      post_mood_score: rawPostMoodScore,
      reflection: rawReflection,
    } = req.body ?? {};

    const sessionId = parseUuid(id);
    const postMoodEmoji = parseMoodEmoji(rawPostMoodEmoji);
    const postMoodScore = parseMoodScore(rawPostMoodScore);
    const reflection = parseReflection(rawReflection);

    if (!sessionId) {
      return res.status(400).json({
        error: "Invalid session id.",
        field: "id must be a valid UUID.",
      });
    }

    if (!postMoodEmoji || postMoodScore === null || !reflection) {
      return res.status(400).json({
        error: "Invalid post-checkout payload.",
        fields: {
          post_mood_emoji: "Required mood emoji from 😢 😟 😐 🙂 😄.",
          post_mood_score: "Required integer from 0 to 10.",
          reflection: "Required non-empty string up to 2000 chars.",
        },
      });
    }

    const updateResult = await query(
      `
        UPDATE sessions
        SET post_mood_emoji = $2,
            post_mood_score = $3,
            reflection = $4
        WHERE id = $1
        RETURNING id, ended_at, post_mood_emoji, post_mood_score, reflection
      `,
      [sessionId, postMoodEmoji, postMoodScore, reflection],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({
        error: "Session not found.",
      });
    }

    const row = updateResult.rows[0];
    return res.json({
      session_id: row.id,
      ended_at: row.ended_at,
      post_mood_emoji: row.post_mood_emoji,
      post_mood_score: Number(row.post_mood_score),
      reflection: row.reflection,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/brain-break", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      triggered_by: rawTriggeredBy,
      duration_seconds: rawDurationSeconds,
    } = req.body ?? {};
    const sessionId = parseUuid(id);
    const triggeredBy = parseBrainBreakTrigger(rawTriggeredBy);
    const durationSeconds = parseDurationSeconds(rawDurationSeconds);

    if (!sessionId) {
      return res.status(400).json({
        error: "Invalid session id.",
        field: "id must be a valid UUID.",
      });
    }

    if (!triggeredBy || durationSeconds === null) {
      return res.status(400).json({
        error: "Invalid brain break payload.",
        fields: {
          triggered_by:
            "Required value from auto_two_wrong, auto_slow, user_button, low_mood, agent_predicted.",
          duration_seconds: "Optional integer from 0 to 1800.",
        },
      });
    }

    const sessionResult = await query(
      `
        SELECT id, ended_at
        FROM sessions
        WHERE id = $1
        LIMIT 1
      `,
      [sessionId],
    );

    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) {
      return res.status(404).json({
        error: "Session not found.",
      });
    }

    if (sessionRow.ended_at) {
      return res.status(400).json({
        error: "Session already ended.",
        field: "brain breaks can only be logged for active sessions.",
      });
    }

    const insertResult = await query(
      `
        INSERT INTO brain_breaks (
          session_id,
          triggered_by,
          duration_seconds
        )
        VALUES ($1, $2, $3)
        RETURNING id, taken_at
      `,
      [sessionId, triggeredBy, durationSeconds],
    );

    const insertedRow = insertResult.rows[0];
    return res.status(201).json({
      brain_break_id: insertedRow.id,
      session_id: sessionId,
      triggered_by: triggeredBy,
      duration_seconds: durationSeconds,
      taken_at: insertedRow.taken_at,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
