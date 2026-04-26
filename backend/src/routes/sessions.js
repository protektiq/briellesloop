import { Router } from "express";
import { query } from "../db.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_REGEX = /^[a-z]{2,24}$/;
const MOOD_EMOJI_SET = new Set(["😢", "😟", "😐", "🙂", "😄"]);

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

    if (!isNonEmptyString(id, 64)) {
      return res.status(400).json({
        error: "Invalid session id.",
        field: "id must be a non-empty string up to 64 chars.",
      });
    }

    if (reason !== undefined && !isNonEmptyString(reason, 120)) {
      return res.status(400).json({
        error: "Invalid reason.",
        field: "reason must be a non-empty string up to 120 chars when provided.",
      });
    }

    return res.json({
      session_id: id.trim(),
      status: "completed",
      ended_at: new Date().toISOString(),
      reason: reason?.trim() ?? "completed_target",
      summary: {
        attempts: 18,
        correct: 13,
        hints_used: 3,
        average_response_seconds: 9.6,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
