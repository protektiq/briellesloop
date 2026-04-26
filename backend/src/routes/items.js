import { Router } from "express";
import { buildSessionQueue } from "../services/queue-builder.js";
import {
  calculateNextReviewAt,
  calculateNextTier,
  shouldAdvanceSkillLevel,
  shouldDropSkillLevel,
} from "../services/srs.js";
import { getClient, query } from "../db.js";

const router = Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_REGEX = /^[a-z]{2,24}$/;

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

const isBoolean = (value) => typeof value === "boolean";
const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value.trim());
const isSkillName = (value) => typeof value === "string" && SKILL_NAME_REGEX.test(value.trim().toLowerCase());

const clampInteger = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

const fetchSessionContext = async (sessionId) => {
  const sessionResult = await query(
    `
      SELECT
        s.id,
        s.student_id,
        s.skill_id,
        s.ended_at,
        sk.name AS skill_name
      FROM sessions s
      INNER JOIN skills sk
        ON sk.id = s.skill_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [sessionId],
  );

  return sessionResult.rows[0] ?? null;
};

const fetchStudentTuning = async (studentId) => {
  const tuningRows = await query(
    `
      SELECT parameter_name, current_value
      FROM student_tuning
      WHERE student_id = $1
        AND parameter_name = ANY($2::text[])
    `,
    [
      studentId,
      [
        "tier_advance_accuracy",
        "tier_advance_response_time",
        "session_item_count",
        "weekly_drop_accuracy",
      ],
    ],
  );

  return tuningRows.rows.reduce((acc, row) => {
    acc[row.parameter_name] = Number(row.current_value);
    return acc;
  }, {});
};

router.get("/queue/:skill_id", async (req, res, next) => {
  try {
    const { skill_id: skillId } = req.params;
    const { session_id: rawSessionId } = req.query;

    if (!isSkillName(skillId)) {
      return res.status(400).json({
        error: "Invalid skill id.",
        field: "skill_id must be a skill name (2-24 lowercase letters).",
      });
    }

    if (!isUuid(rawSessionId)) {
      return res.status(400).json({
        error: "Missing or invalid session_id.",
        field: "session_id query parameter must be a valid UUID.",
      });
    }

    const sessionContext = await fetchSessionContext(rawSessionId.trim());
    if (!sessionContext) {
      return res.status(400).json({
        error: "Invalid session_id.",
        field: "session does not exist.",
      });
    }

    if (sessionContext.ended_at) {
      return res.status(400).json({
        error: "Session already ended.",
        field: "session_id must reference an active session.",
      });
    }

    if (sessionContext.skill_name !== skillId.trim().toLowerCase()) {
      return res.status(400).json({
        error: "Skill mismatch for session.",
        field: "skill_id must match the active session skill.",
      });
    }

    const tuning = await fetchStudentTuning(sessionContext.student_id);
    const requestedCount = clampInteger(tuning.session_item_count, 5, 8, 6);
    const queue = await buildSessionQueue(sessionContext.student_id, sessionContext.skill_id, requestedCount);

    return res.json({
      session_id: sessionContext.id,
      skill_id: sessionContext.skill_name,
      generated_at: new Date().toISOString(),
      queue,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/attempt", async (req, res, next) => {
  let client;
  try {
    const { id } = req.params;
    const {
      answer,
      is_correct: isCorrect,
      response_seconds: responseSeconds,
      session_id: rawSessionId,
    } = req.body ?? {};

    if (!isUuid(id)) {
      return res.status(400).json({
        error: "Invalid item id.",
        field: "id must be a valid UUID.",
      });
    }

    if (!isNonEmptyString(answer, 1_000) || !isBoolean(isCorrect)) {
      return res.status(400).json({
        error: "Invalid attempt payload.",
        fields: {
          answer: "Required non-empty string up to 1000 chars.",
          is_correct: "Required boolean.",
        },
      });
    }

    const parsedResponseSeconds = Number(responseSeconds);
    if (!Number.isFinite(parsedResponseSeconds) || parsedResponseSeconds < 0 || parsedResponseSeconds > 600) {
      return res.status(400).json({
        error: "Invalid response_seconds.",
        field: "response_seconds must be a number between 0 and 600.",
      });
    }

    if (!isUuid(rawSessionId)) {
      return res.status(400).json({
        error: "Missing or invalid session_id.",
        field: "session_id must be a valid UUID.",
      });
    }

    const sessionContext = await fetchSessionContext(rawSessionId.trim());
    if (!sessionContext) {
      return res.status(400).json({
        error: "Invalid session_id.",
        field: "session does not exist.",
      });
    }

    if (sessionContext.ended_at) {
      return res.status(400).json({
        error: "Session already ended.",
        field: "session_id must reference an active session.",
      });
    }

    const itemResult = await query(
      `
        SELECT id
        FROM items
        WHERE id = $1
          AND skill_id = $2
        LIMIT 1
      `,
      [id.trim(), sessionContext.skill_id],
    );

    if (itemResult.rowCount === 0) {
      return res.status(400).json({
        error: "Item does not belong to the active session skill.",
      });
    }

    const tuning = await fetchStudentTuning(sessionContext.student_id);
    client = await getClient();
    await client.query("BEGIN");

    const masteryResult = await client.query(
      `
        SELECT
          tier,
          consecutive_correct,
          total_attempts,
          total_correct,
          avg_response_time_seconds
        FROM item_mastery
        WHERE student_id = $1
          AND item_id = $2
        FOR UPDATE
      `,
      [sessionContext.student_id, id.trim()],
    );

    const existingMastery = masteryResult.rows[0] ?? {
      tier: 0,
      consecutive_correct: 0,
      total_attempts: 0,
      total_correct: 0,
      avg_response_time_seconds: null,
    };

    const historicalStatsResult = await client.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE a.is_correct) AS total_correct,
          COUNT(DISTINCT a.session_id) FILTER (WHERE a.is_correct) AS distinct_sessions_correct,
          COALESCE(BOOL_AND(a.response_time_seconds < 20) FILTER (WHERE a.is_correct), TRUE) AS all_responses_under_20s,
          COALESCE(BOOL_OR(a.session_id = $3 AND a.is_correct), FALSE) AS has_correct_in_current_session
        FROM attempts a
        INNER JOIN sessions s
          ON s.id = a.session_id
        WHERE a.item_id = $1
          AND s.student_id = $2
      `,
      [id.trim(), sessionContext.student_id, sessionContext.id],
    );

    const historicalStats = historicalStatsResult.rows[0];
    const projectedDistinctSessions =
      Number(historicalStats.distinct_sessions_correct ?? 0) +
      (isCorrect && !historicalStats.has_correct_in_current_session ? 1 : 0);
    const projectedAllUnder20 =
      Boolean(historicalStats.all_responses_under_20s) && (!isCorrect || parsedResponseSeconds < 20);

    const masteryStats = {
      consecutive_correct: Number(existingMastery.consecutive_correct),
      total_correct: Number(existingMastery.total_correct),
      distinct_sessions_correct: projectedDistinctSessions,
      all_responses_under_20s: projectedAllUnder20,
    };

    const nextTier = calculateNextTier(
      Number(existingMastery.tier),
      isCorrect,
      parsedResponseSeconds,
      masteryStats,
      tuning,
    );

    const attemptInsertResult = await client.query(
      `
        INSERT INTO attempts (
          session_id,
          item_id,
          user_response,
          is_correct,
          response_time_seconds
        )
        VALUES ($1, $2, $3::jsonb, $4, $5)
        RETURNING id, attempted_at
      `,
      [sessionContext.id, id.trim(), JSON.stringify({ answer: answer.trim() }), isCorrect, parsedResponseSeconds],
    );

    const attemptedAt = attemptInsertResult.rows[0].attempted_at;
    const nextReviewAt = calculateNextReviewAt(nextTier, attemptedAt);
    const newTotalAttempts = Number(existingMastery.total_attempts) + 1;
    const newTotalCorrect = Number(existingMastery.total_correct) + (isCorrect ? 1 : 0);
    const newConsecutiveCorrect = isCorrect ? Number(existingMastery.consecutive_correct) + 1 : 0;
    const priorAverage = Number(existingMastery.avg_response_time_seconds ?? 0);
    const newAverageResponseSeconds =
      Number(existingMastery.total_attempts) > 0
        ? (priorAverage * Number(existingMastery.total_attempts) + parsedResponseSeconds) / newTotalAttempts
        : parsedResponseSeconds;

    await client.query(
      `
        INSERT INTO item_mastery (
          student_id,
          item_id,
          tier,
          consecutive_correct,
          total_attempts,
          total_correct,
          avg_response_time_seconds,
          next_review_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (student_id, item_id)
        DO UPDATE SET
          tier = EXCLUDED.tier,
          consecutive_correct = EXCLUDED.consecutive_correct,
          total_attempts = EXCLUDED.total_attempts,
          total_correct = EXCLUDED.total_correct,
          avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
          next_review_at = EXCLUDED.next_review_at,
          last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        sessionContext.student_id,
        id.trim(),
        nextTier,
        newConsecutiveCorrect,
        newTotalAttempts,
        newTotalCorrect,
        newAverageResponseSeconds,
        nextReviewAt,
        attemptedAt,
      ],
    );

    const recentTier3AttemptsResult = await client.query(
      `
        SELECT
          im.tier,
          a.is_correct,
          a.response_time_seconds
        FROM attempts a
        INNER JOIN sessions s
          ON s.id = a.session_id
        INNER JOIN item_mastery im
          ON im.item_id = a.item_id
         AND im.student_id = s.student_id
        INNER JOIN items i
          ON i.id = a.item_id
        WHERE s.student_id = $1
          AND i.skill_id = $2
        ORDER BY a.attempted_at DESC
        LIMIT 100
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    const shouldAdvance = shouldAdvanceSkillLevel(recentTier3AttemptsResult.rows, tuning);

    const weeklyAccuracyResult = await client.query(
      `
        SELECT
          CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE (COUNT(*) FILTER (WHERE a.is_correct)::DECIMAL / COUNT(*)) * 100
          END AS weekly_accuracy
        FROM attempts a
        INNER JOIN sessions s
          ON s.id = a.session_id
        INNER JOIN items i
          ON i.id = a.item_id
        WHERE s.student_id = $1
          AND i.skill_id = $2
          AND a.attempted_at >= NOW() - INTERVAL '7 days'
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    const weeklyAccuracy = Number(weeklyAccuracyResult.rows[0]?.weekly_accuracy ?? 100);
    const shouldDrop = shouldDropSkillLevel(weeklyAccuracy, tuning);

    await client.query(
      `
        INSERT INTO student_skill_levels (student_id, skill_id, level, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (student_id, skill_id)
        DO NOTHING
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    if (shouldAdvance || shouldDrop) {
      await client.query(
        `
          UPDATE student_skill_levels
          SET level = LEAST(
            10,
            GREATEST(
              1,
              level + CASE WHEN $3 THEN 1 WHEN $4 THEN -1 ELSE 0 END
            )
          ),
          updated_at = NOW()
          WHERE student_id = $1
            AND skill_id = $2
        `,
        [sessionContext.student_id, sessionContext.skill_id, shouldAdvance, shouldDrop],
      );
    }

    await client.query("COMMIT");

    const nextQueue = await buildSessionQueue(sessionContext.student_id, sessionContext.skill_id, 2);
    const nextItem = nextQueue.find((item) => item.item_id !== id.trim()) ?? null;

    return res.status(201).json({
      attempt_id: attemptInsertResult.rows[0].id,
      session_id: sessionContext.id,
      item_id: id.trim(),
      is_correct: isCorrect,
      response_seconds: parsedResponseSeconds,
      recorded_at: attemptedAt,
      mastery: {
        prior_tier: Number(existingMastery.tier),
        next_tier: nextTier,
        next_review_at: nextReviewAt,
      },
      ...(nextItem ? { next_item: nextItem } : { sessionComplete: true }),
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
    }
    return next(error);
  } finally {
    client?.release();
  }
});

export default router;
