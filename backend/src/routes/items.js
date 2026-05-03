import { Router } from "express";
import { buildSessionQueue } from "../services/queue-builder.js";
import { ensureMathQueueItems, ensureWritingQueueItems } from "../services/content-generator.js";
import {
  ensureReadingQueueItems,
  ensureSpellingQueueItems,
  ensureTypingQueueItems,
} from "../services/skills-queue.js";
import { gradeAttempt } from "../services/grader.js";
import {
  calculateNextReviewAt,
  calculateNextTier,
  checkSkillLevelAdvancement,
  MIN_WEEKLY_ATTEMPTS_FOR_LEVEL_DROP,
  shouldDropSkillLevel,
} from "../services/srs.js";
import {
  formatUtcDateString,
  toUtcRange,
  utcMondayOfContainingWeek,
} from "../services/dashboard-week.js";
import { getClient, query } from "../db.js";
import { normalizeSkillsTableId } from "../utils/postgres-ids.js";

const router = Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_REGEX = /^[a-z]{2,24}$/;

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value.trim());
const isSkillName = (value) => typeof value === "string" && SKILL_NAME_REGEX.test(value.trim().toLowerCase());

const clampInteger = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

const getSessionItemCountForSkill = (tuning, skillName) => {
  const normalized = typeof skillName === "string" ? skillName.trim().toLowerCase() : "";
  if (normalized === "writing") {
    return clampInteger(tuning.session_item_count_writing, 1, 3, 1);
  }
  return clampInteger(tuning.session_item_count, 3, 10, 5);
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
        "session_item_count_writing",
        "weekly_drop_accuracy",
        "tier_advance_min_items",
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
    const requestedCount = getSessionItemCountForSkill(tuning, sessionContext.skill_name);
    const skillPrimaryKey = normalizeSkillsTableId(sessionContext.skill_id, "session.skill_id");

    if (sessionContext.skill_name === "math") {
      await ensureMathQueueItems(sessionContext.student_id, skillPrimaryKey, requestedCount);
    }
    if (sessionContext.skill_name === "reading") {
      await ensureReadingQueueItems(sessionContext.student_id, skillPrimaryKey, requestedCount);
    }
    if (sessionContext.skill_name === "typing") {
      await ensureTypingQueueItems(sessionContext.student_id, skillPrimaryKey, requestedCount);
    }
    if (sessionContext.skill_name === "spelling") {
      await ensureSpellingQueueItems(sessionContext.student_id, skillPrimaryKey, requestedCount);
    }
    if (sessionContext.skill_name === "writing") {
      await ensureWritingQueueItems(sessionContext.student_id, skillPrimaryKey, requestedCount);
    }

    const queue = await buildSessionQueue(sessionContext.student_id, skillPrimaryKey, requestedCount);

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
      response_seconds: responseSeconds,
      session_id: rawSessionId,
      reading_question_index: rawReadingQuestionIndex,
    } = req.body ?? {};

    if (!isUuid(id)) {
      return res.status(400).json({
        error: "Invalid item id.",
        field: "id must be a valid UUID.",
      });
    }

    if (!isNonEmptyString(answer, 3_000)) {
      return res.status(400).json({
        error: "Invalid attempt payload.",
        fields: {
          answer: "Required non-empty string up to 3000 chars.",
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
        SELECT
          i.id,
          i.skill_id,
          i.level,
          i.item_type,
          i.prompt,
          i.answer,
          i.metadata,
          sk.name AS skill_name
        FROM items i
        INNER JOIN skills sk
          ON sk.id = i.skill_id
        WHERE i.id = $1
          AND i.skill_id = $2
        LIMIT 1
      `,
      [id.trim(), sessionContext.skill_id],
    );

    if (itemResult.rowCount === 0) {
      return res.status(400).json({
        error: "Item does not belong to the active session skill.",
      });
    }

    const itemRow = itemResult.rows[0];

    let readingQuestionIndexParsed = null;
    if (rawReadingQuestionIndex !== undefined && rawReadingQuestionIndex !== null) {
      const parsedIdx = Number.parseInt(String(rawReadingQuestionIndex), 10);
      if (!Number.isInteger(parsedIdx) || parsedIdx < 0 || parsedIdx > 2) {
        return res.status(400).json({
          error: "Invalid reading_question_index.",
          field: "reading_question_index must be an integer between 0 and 2.",
        });
      }
      readingQuestionIndexParsed = parsedIdx;
    }

    if (itemRow.item_type === "reading_passage") {
      if (readingQuestionIndexParsed === null) {
        return res.status(400).json({
          error: "Missing reading_question_index.",
          field: "reading_question_index is required for reading passages.",
        });
      }
    }

    let gradedResult;
    try {
      gradedResult = await gradeAttempt(itemRow, answer.trim(), parsedResponseSeconds, {
        skillName: itemRow.skill_name ?? sessionContext.skill_name,
        readingQuestionIndex: readingQuestionIndexParsed,
      });
    } catch (gradeError) {
      const message = gradeError instanceof Error ? gradeError.message : "Grading failed.";
      return res.status(502).json({
        error: "Grader unavailable.",
        message,
      });
    }

    const writingRubric =
      itemRow.skill_name === "writing" &&
      gradedResult &&
      typeof gradedResult === "object" &&
      gradedResult.writing_rubric &&
      typeof gradedResult.writing_rubric === "object"
        ? gradedResult.writing_rubric
        : null;

    const isCorrect = gradedResult.correct;
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
      itemRow.skill_name ?? sessionContext.skill_name,
    );

    let attemptUserResponse;
    if (itemRow.item_type === "reading_passage" && readingQuestionIndexParsed !== null) {
      attemptUserResponse = {
        answer: answer.trim(),
        reading_question_index: readingQuestionIndexParsed,
      };
    } else if (writingRubric) {
      attemptUserResponse = { answer: answer.trim(), writing_rubric: writingRubric };
    } else {
      attemptUserResponse = { answer: answer.trim() };
    }

    const attemptInsertResult = await client.query(
      `
        INSERT INTO attempts (
          session_id,
          item_id,
          user_response,
          is_correct,
          response_time_seconds,
          ai_feedback
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
        RETURNING id, attempted_at, user_response
      `,
      [
        sessionContext.id,
        id.trim(),
        JSON.stringify(attemptUserResponse),
        isCorrect,
        parsedResponseSeconds,
        gradedResult.feedback,
      ],
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

    const skillItemMasteryResult = await client.query(
      `
        SELECT
          im.tier,
          im.total_correct,
          im.total_attempts,
          im.avg_response_time_seconds
        FROM item_mastery im
        INNER JOIN items i
          ON i.id = im.item_id
        WHERE im.student_id = $1
          AND i.skill_id = $2
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    const advancementDecision = checkSkillLevelAdvancement(
      skillItemMasteryResult.rows,
      tuning,
    );
    const tunedMinItems = Number.parseInt(
      String(tuning.tier_advance_min_items ?? 10),
      10,
    );
    const minItems = Number.isInteger(tunedMinItems) ? tunedMinItems : 10;
    const shouldAdvance =
      advancementDecision.shouldAdvance &&
      advancementDecision.eligibleCount >= minItems;

    console.debug(
      "[SRS] Skill-level advancement decision",
      {
        studentId: sessionContext.student_id,
        skillId: sessionContext.skill_id,
        shouldAdvance,
        eligibleCount: advancementDecision.eligibleCount,
        avgAccuracy: advancementDecision.avgAccuracy,
        avgResponseTime: advancementDecision.avgResponseTime,
        tierAdvanceMinItems: minItems,
        tierAdvanceAccuracy: Number(tuning.tier_advance_accuracy ?? 80),
        tierAdvanceResponseTime: Number(tuning.tier_advance_response_time ?? 30),
      },
    );

    const weekMonday = utcMondayOfContainingWeek();
    const currentWeekMondayStr = formatUtcDateString(weekMonday);
    const { startIso, endIso } = toUtcRange(currentWeekMondayStr);

    const weeklyAccuracyResult = await client.query(
      `
        SELECT
          COUNT(*)::INT AS attempt_count,
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
          AND a.attempted_at >= $3::timestamptz
          AND a.attempted_at < $4::timestamptz
      `,
      [sessionContext.student_id, sessionContext.skill_id, startIso, endIso],
    );

    const weeklyAttemptCount = Number(weeklyAccuracyResult.rows[0]?.attempt_count ?? 0);
    const weeklyAccuracyRaw = weeklyAccuracyResult.rows[0]?.weekly_accuracy;
    const weeklyAccuracy =
      weeklyAccuracyRaw === null || weeklyAccuracyRaw === undefined
        ? null
        : Number(weeklyAccuracyRaw);

    const dropEligible =
      weeklyAccuracy !== null &&
      weeklyAttemptCount >= MIN_WEEKLY_ATTEMPTS_FOR_LEVEL_DROP &&
      shouldDropSkillLevel(weeklyAccuracy, tuning);

    await client.query(
      `
        INSERT INTO student_skill_levels (student_id, skill_id, level, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (student_id, skill_id)
        DO NOTHING
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    const skillLevelRow = await client.query(
      `
        SELECT last_weekly_drop_week_start
        FROM student_skill_levels
        WHERE student_id = $1
          AND skill_id = $2
        LIMIT 1
      `,
      [sessionContext.student_id, sessionContext.skill_id],
    );

    const lastDropWeekStart = skillLevelRow.rows[0]?.last_weekly_drop_week_start;
    const lastDropWeekStr =
      lastDropWeekStart instanceof Date
        ? formatUtcDateString(lastDropWeekStart)
        : typeof lastDropWeekStart === "string"
          ? lastDropWeekStart.slice(0, 10)
          : null;

    const alreadyDroppedThisUtcWeek =
      lastDropWeekStr !== null && lastDropWeekStr === currentWeekMondayStr;

    const shouldApplyDrop = dropEligible && !alreadyDroppedThisUtcWeek;

    let levelDelta = 0;
    if (shouldApplyDrop) {
      levelDelta = -1;
    } else if (shouldAdvance) {
      levelDelta = 1;
    }

    if (levelDelta !== 0) {
      await client.query(
        `
          UPDATE student_skill_levels
          SET level = LEAST(
            10,
            GREATEST(
              1,
              level + $3
            )
          ),
          last_weekly_drop_week_start = CASE
            WHEN $4::boolean THEN $5::date
            ELSE last_weekly_drop_week_start
          END,
          updated_at = NOW()
          WHERE student_id = $1
            AND skill_id = $2
        `,
        [
          sessionContext.student_id,
          sessionContext.skill_id,
          levelDelta,
          shouldApplyDrop,
          currentWeekMondayStr,
        ],
      );
    }

    if (shouldApplyDrop) {
      await client.query(
        `
          UPDATE item_mastery im
          SET next_review_at = NOW(),
              last_seen_at = COALESCE(im.last_seen_at, NOW())
          FROM items i
          WHERE im.item_id = i.id
            AND im.student_id = $1
            AND i.skill_id = $2
            AND im.item_id IN (
              SELECT DISTINCT a.item_id
              FROM attempts a
              INNER JOIN sessions s ON s.id = a.session_id
              INNER JOIN items ii ON ii.id = a.item_id
              WHERE s.student_id = $1
                AND ii.skill_id = $2
                AND a.is_correct = FALSE
                AND a.attempted_at >= NOW() - INTERVAL '14 days'
            )
        `,
        [sessionContext.student_id, sessionContext.skill_id],
      );
    }

    const sessionAttemptCountResult = await client.query(
      `
        SELECT COUNT(*)::INT AS attempt_count
        FROM attempts
        WHERE session_id = $1
      `,
      [sessionContext.id],
    );
    const sessionAttemptCount = Number(sessionAttemptCountResult.rows[0]?.attempt_count ?? 0);
    const sessionTargetCount = getSessionItemCountForSkill(tuning, sessionContext.skill_name);
    // Reading uses three attempts per queued passage (one per comprehension question).
    const effectiveSessionTarget =
      sessionContext.skill_name === "reading" ? sessionTargetCount * 3 : sessionTargetCount;
    const sessionComplete = sessionAttemptCount >= effectiveSessionTarget;

    await client.query("COMMIT");

    const nextQueue = sessionComplete
      ? []
      : await buildSessionQueue(sessionContext.student_id, sessionContext.skill_id, 2);
    const nextItem = nextQueue.find((item) => item.item_id !== id.trim()) ?? null;

    const priorTier = Number(existingMastery.tier);
    const tierChanged = priorTier !== nextTier;

    return res.status(201).json({
      attempt_id: attemptInsertResult.rows[0].id,
      session_id: sessionContext.id,
      item_id: id.trim(),
      is_correct: isCorrect,
      response_seconds: parsedResponseSeconds,
      recorded_at: attemptedAt,
      user_response: attemptInsertResult.rows[0].user_response,
      feedback: gradedResult.feedback,
      explanation: gradedResult.explanation,
      ...(writingRubric ? { writing_rubric: writingRubric, encouragement: gradedResult.encouragement } : {}),
      mastery: {
        prior_tier: priorTier,
        next_tier: nextTier,
        next_review_at: nextReviewAt,
        tier_changed: tierChanged,
        tier_advanced: nextTier > priorTier,
      },
      ...(nextItem && !sessionComplete ? { next_item: nextItem } : { sessionComplete: true }),
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
