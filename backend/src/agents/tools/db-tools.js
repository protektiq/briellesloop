import { query } from "../../db.js";
import { parseAndValidateWeekStart, toUtcRange } from "../../services/dashboard-week.js";
import { assertUuid, clampInt, optionalIsoDate } from "./validators.js";

const SKILL_NAMES = new Set(["reading", "math", "spelling", "typing"]);

const resolveSkillId = async (skillNameRaw) => {
  const skillName =
    typeof skillNameRaw === "string" ? skillNameRaw.trim().toLowerCase() : "";
  if (!SKILL_NAMES.has(skillName)) {
    throw new Error("skill_name must be one of: reading, math, spelling, typing.");
  }
  const r = await query(`SELECT id FROM skills WHERE name = $1 LIMIT 1`, [skillName]);
  if (r.rowCount === 0) {
    throw new Error(`Skill not found: ${skillName}`);
  }
  return { skillName, skillId: r.rows[0].id };
};

export const handleQueryRecentAttempts = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const days = clampInt(input.days, 1, 90, "days");
  const r = await query(
    `
      SELECT
        a.id,
        a.is_correct,
        a.response_time_seconds,
        a.attempted_at,
        sk.name AS skill_name
      FROM attempts a
      INNER JOIN sessions s ON s.id = a.session_id
      INNER JOIN items i ON i.id = a.item_id
      INNER JOIN skills sk ON sk.id = i.skill_id
      WHERE s.student_id = $1::uuid
        AND a.attempted_at >= NOW() - ($2::text || ' days')::interval
      ORDER BY a.attempted_at DESC
      LIMIT 200
    `,
    [studentId, String(days)],
  );
  return { attempts: r.rows, count: r.rowCount };
};

export const handleQuerySkillProgression = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const { skillId, skillName } = await resolveSkillId(input.skill_name);
  const r = await query(
    `
      SELECT
        date_trunc('week', s.started_at AT TIME ZONE 'UTC')::date AS week_start,
        SUM(s.items_correct)::float / NULLIF(SUM(s.items_attempted), 0) AS accuracy,
        AVG(a.response_time_seconds)::float AS avg_response_time,
        COUNT(DISTINCT s.id)::int AS sessions_count
      FROM sessions s
      LEFT JOIN attempts a ON a.session_id = s.id
      WHERE s.student_id = $1::uuid
        AND s.skill_id = $2
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
    `,
    [studentId, skillId],
  );
  return { skill_name: skillName, weeks: r.rows };
};

export const handleQueryDueItems = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const { skillId, skillName } = await resolveSkillId(input.skill_name);
  const r = await query(
    `
      SELECT
        i.id AS item_id,
        im.tier,
        im.next_review_at,
        i.item_type
      FROM item_mastery im
      INNER JOIN items i ON i.id = im.item_id
      WHERE im.student_id = $1::uuid
        AND i.skill_id = $2
        AND (im.next_review_at IS NULL OR im.next_review_at <= NOW() + INTERVAL '2 days')
      ORDER BY im.next_review_at ASC NULLS FIRST, im.tier DESC
      LIMIT 80
    `,
    [studentId, skillId],
  );
  return { skill_name: skillName, due_items: r.rows, count: r.rowCount };
};

export const handleQueryRecentMisses = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const days = clampInt(input.days, 1, 90, "days");
  const r = await query(
    `
      SELECT
        a.id,
        a.attempted_at,
        sk.name AS skill_name,
        i.item_type,
        i.metadata
      FROM attempts a
      INNER JOIN sessions s ON s.id = a.session_id
      INNER JOIN items i ON i.id = a.item_id
      INNER JOIN skills sk ON sk.id = i.skill_id
      WHERE s.student_id = $1::uuid
        AND a.is_correct = FALSE
        AND a.attempted_at >= NOW() - ($2::text || ' days')::interval
      ORDER BY a.attempted_at DESC
      LIMIT 60
    `,
    [studentId, String(days)],
  );
  return { misses: r.rows, count: r.rowCount };
};

export const handleQueryBrainBreakHistory = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const weeks = clampInt(input.weeks, 1, 52, "weeks");
  const r = await query(
    `
      SELECT
        bb.id,
        bb.triggered_by,
        bb.duration_seconds,
        bb.taken_at,
        s.started_at AS session_started_at
      FROM brain_breaks bb
      INNER JOIN sessions s ON s.id = bb.session_id
      WHERE s.student_id = $1::uuid
        AND bb.taken_at >= NOW() - ($2::text || ' weeks')::interval
      ORDER BY bb.taken_at DESC
      LIMIT 100
    `,
    [studentId, String(weeks)],
  );
  return { brain_breaks: r.rows, count: r.rowCount };
};

export const handleQuerySessionOutcomes = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const weeks = clampInt(input.weeks, 1, 52, "weeks");
  const r = await query(
    `
      SELECT
        s.id,
        s.started_at,
        s.ended_at,
        s.pre_mood_score,
        s.post_mood_score,
        s.reflection,
        s.items_attempted,
        s.items_correct,
        sk.name AS skill_name
      FROM sessions s
      INNER JOIN skills sk ON sk.id = s.skill_id
      WHERE s.student_id = $1::uuid
        AND s.started_at >= NOW() - ($2::text || ' weeks')::interval
      ORDER BY s.started_at DESC
      LIMIT 80
    `,
    [studentId, String(weeks)],
  );
  return { sessions: r.rows, count: r.rowCount };
};

export const handleQueryWeekSummary = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const weekStart = optionalIsoDate(input.week_start, "week_start");
  const ws = weekStart ? parseAndValidateWeekStart(weekStart) : parseAndValidateWeekStart("");
  const { startIso, endIso, weekEndDisplay } = toUtcRange(ws);
  const stats = await query(
    `
      SELECT
        COALESCE(
          SUM(s.items_correct)::float / NULLIF(SUM(s.items_attempted), 0),
          NULL
        ) AS avg_accuracy,
        COUNT(DISTINCT (s.started_at AT TIME ZONE 'UTC')::date)::int AS days_practiced,
        AVG(s.post_mood_score)::float AS avg_post_mood,
        SUM(s.items_attempted)::int AS items_attempted,
        SUM(s.items_correct)::int AS items_correct
      FROM sessions s
      WHERE s.student_id = $1::uuid
        AND s.started_at >= $2::timestamptz
        AND s.started_at < $3::timestamptz
    `,
    [studentId, startIso, endIso],
  );
  const bb = await query(
    `
      SELECT COUNT(*)::int AS n
      FROM brain_breaks bb
      INNER JOIN sessions s ON s.id = bb.session_id
      WHERE s.student_id = $1::uuid
        AND bb.taken_at >= $2::timestamptz
        AND bb.taken_at < $3::timestamptz
    `,
    [studentId, startIso, endIso],
  );
  const row = stats.rows[0];
  return {
    week_start: ws,
    week_end_display: weekEndDisplay,
    avg_accuracy: row.avg_accuracy === null ? null : Number.parseFloat(String(row.avg_accuracy)),
    days_practiced: Number.parseInt(String(row.days_practiced ?? 0), 10),
    avg_post_mood:
      row.avg_post_mood === null ? null : Number.parseFloat(String(row.avg_post_mood)),
    items_attempted: Number.parseInt(String(row.items_attempted ?? 0), 10),
    items_correct: Number.parseInt(String(row.items_correct ?? 0), 10),
    brain_breaks: Number.parseInt(String(bb.rows[0]?.n ?? 0), 10),
  };
};

export const handleQuerySkillTrends = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const weeks = clampInt(input.weeks, 2, 24, "weeks");
  const r = await query(
    `
      SELECT
        date_trunc('week', s.started_at AT TIME ZONE 'UTC')::date AS week_start,
        sk.name AS skill_name,
        SUM(s.items_correct)::float / NULLIF(SUM(s.items_attempted), 0) AS accuracy
      FROM sessions s
      INNER JOIN skills sk ON sk.id = s.skill_id
      WHERE s.student_id = $1::uuid
        AND s.started_at >= NOW() - ($2::text || ' weeks')::interval
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
      LIMIT 200
    `,
    [studentId, String(weeks)],
  );
  return { trends: r.rows };
};

export const handleQueryIepAlignment = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const r = await query(
    `
      SELECT
        sk.name AS skill_name,
        sk.iep_target_pct,
        COALESCE(
          SUM(s.items_correct)::float / NULLIF(SUM(s.items_attempted), 0),
          NULL
        ) AS recent_accuracy
      FROM skills sk
      LEFT JOIN sessions s
        ON s.skill_id = sk.id
       AND s.student_id = $1::uuid
       AND s.started_at >= NOW() - INTERVAL '28 days'
      GROUP BY sk.id, sk.name, sk.iep_target_pct
      ORDER BY sk.name
    `,
    [studentId],
  );
  return {
    skills: r.rows.map((row) => ({
      skill_name: row.skill_name,
      iep_target_pct: row.iep_target_pct,
      recent_accuracy_28d:
        row.recent_accuracy === null ? null : Number.parseFloat(String(row.recent_accuracy)),
    })),
  };
};

export const handleQueryRecentReflections = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const weeks = clampInt(input.weeks, 1, 52, "weeks");
  const r = await query(
    `
      SELECT s.reflection, s.started_at, sk.name AS skill_name
      FROM sessions s
      INNER JOIN skills sk ON sk.id = s.skill_id
      WHERE s.student_id = $1::uuid
        AND s.reflection IS NOT NULL
        AND trim(s.reflection) <> ''
        AND s.started_at >= NOW() - ($2::text || ' weeks')::interval
      ORDER BY s.started_at DESC
      LIMIT 40
    `,
    [studentId, String(weeks)],
  );
  return { reflections: r.rows };
};

export const handleQueryOtherAgentActivity = async (input, ctx) => {
  const weekStart = optionalIsoDate(input.week_start, "week_start");
  const ws = weekStart ? parseAndValidateWeekStart(weekStart) : parseAndValidateWeekStart("");
  const { startIso, endIso } = toUtcRange(ws);
  const excludeId = ctx?.agentId;
  const r = await query(
    `
      SELECT
        a.name AS agent_name,
        ar.id AS run_id,
        ar.started_at,
        ar.status,
        ar.reasoning,
        ar.cost_usd
      FROM agent_runs ar
      INNER JOIN agents a ON a.id = ar.agent_id
      WHERE ar.started_at >= $1::timestamptz
        AND ar.started_at < $2::timestamptz
        AND ($3::int IS NULL OR ar.agent_id <> $3::int)
      ORDER BY ar.started_at DESC
      LIMIT 40
    `,
    [startIso, endIso, excludeId ?? null],
  );
  return { week_start: ws, runs: r.rows };
};

export const handleQueryCurrentTuning = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const r = await query(
    `
      SELECT parameter_name, current_value, default_value, min_value, max_value, last_changed_at
      FROM student_tuning
      WHERE student_id = $1::uuid
      ORDER BY parameter_name
    `,
    [studentId],
  );
  return { tuning: r.rows };
};

export const handleQueryInterests = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const r = await query(`SELECT interests FROM students WHERE id = $1::uuid LIMIT 1`, [studentId]);
  const interests = Array.isArray(r.rows[0]?.interests) ? r.rows[0].interests : [];
  return { interests };
};

export const handleQueryIepGoals = async () => {
  const r = await query(`SELECT id, name, iep_goal_text, iep_target_pct FROM skills ORDER BY id`);
  return { skills: r.rows };
};

export const handleQueryAttemptsBeforeBreaks = async (input) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const r = await query(
    `
      WITH breaks AS (
        SELECT bb.id AS break_id, bb.taken_at, s.id AS session_id
        FROM brain_breaks bb
        INNER JOIN sessions s ON s.id = bb.session_id
        WHERE s.student_id = $1::uuid
        ORDER BY bb.taken_at DESC
        LIMIT 25
      )
      SELECT
        b.break_id,
        b.taken_at,
        (
          SELECT json_agg(row ORDER BY row.attempted_at DESC)
          FROM (
            SELECT
              a.id,
              a.is_correct,
              a.response_time_seconds,
              a.hint_used,
              a.attempted_at
            FROM attempts a
            WHERE a.session_id = b.session_id
              AND a.attempted_at <= b.taken_at
            ORDER BY a.attempted_at DESC
            LIMIT 5
          ) row
        ) AS attempts_before
      FROM breaks b
    `,
    [studentId],
  );
  return { samples: r.rows };
};

const dbToolHandlers = {
  query_recent_attempts: handleQueryRecentAttempts,
  query_skill_progression: handleQuerySkillProgression,
  query_due_items: handleQueryDueItems,
  query_recent_misses: handleQueryRecentMisses,
  query_brain_break_history: handleQueryBrainBreakHistory,
  query_session_outcomes: handleQuerySessionOutcomes,
  query_week_summary: handleQueryWeekSummary,
  query_skill_trends: handleQuerySkillTrends,
  query_iep_alignment: handleQueryIepAlignment,
  query_recent_reflections: handleQueryRecentReflections,
  query_other_agent_activity: handleQueryOtherAgentActivity,
  query_current_tuning: handleQueryCurrentTuning,
  query_interests: handleQueryInterests,
  query_iep_goals: handleQueryIepGoals,
  query_attempts_before_breaks: handleQueryAttemptsBeforeBreaks,
};

export const runDbTool = async (name, input, ctx) => {
  const handler = dbToolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown database tool: ${name}`);
  }
  return handler(input ?? {}, ctx);
};

export const dbToolSchemas = [
  {
    name: "query_recent_attempts",
    description: "Recent item attempts with skill, correctness, and timing.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string", description: "Student UUID" },
        days: { type: "integer", description: "Lookback days (1-90)" },
      },
      required: ["student_id", "days"],
    },
  },
  {
    name: "query_skill_progression",
    description: "Weekly aggregates of accuracy and response time for one skill.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_name: { type: "string", enum: ["reading", "math", "spelling", "typing"] },
      },
      required: ["student_id", "skill_name"],
    },
  },
  {
    name: "query_due_items",
    description: "SRS items due or soon due for a skill.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_name: { type: "string", enum: ["reading", "math", "spelling", "typing"] },
      },
      required: ["student_id", "skill_name"],
    },
  },
  {
    name: "query_recent_misses",
    description: "Incorrect attempts in the lookback window.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        days: { type: "integer" },
      },
      required: ["student_id", "days"],
    },
  },
  {
    name: "query_brain_break_history",
    description: "Brain breaks with triggers over recent weeks.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        weeks: { type: "integer" },
      },
      required: ["student_id", "weeks"],
    },
  },
  {
    name: "query_session_outcomes",
    description: "Sessions with mood and reflection in recent weeks.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        weeks: { type: "integer" },
      },
      required: ["student_id", "weeks"],
    },
  },
  {
    name: "query_week_summary",
    description: "Aggregated stats for a UTC week (optional week_start Monday).",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        week_start: { type: "string", description: "YYYY-MM-DD Monday UTC; omit for current week" },
      },
      required: ["student_id"],
    },
  },
  {
    name: "query_skill_trends",
    description: "Per-week accuracy trend split by skill.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        weeks: { type: "integer" },
      },
      required: ["student_id", "weeks"],
    },
  },
  {
    name: "query_iep_alignment",
    description: "28-day accuracy vs IEP target per skill.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      required: ["student_id"],
    },
  },
  {
    name: "query_recent_reflections",
    description: "Recent session reflection texts.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        weeks: { type: "integer" },
      },
      required: ["student_id", "weeks"],
    },
  },
  {
    name: "query_other_agent_activity",
    description: "Agent runs in the given UTC week (other agents when excluded by runner).",
    input_schema: {
      type: "object",
      properties: {
        week_start: { type: "string", description: "YYYY-MM-DD Monday UTC" },
      },
      required: [],
    },
  },
  {
    name: "query_current_tuning",
    description: "Current student_tuning parameter rows.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      required: ["student_id"],
    },
  },
  {
    name: "query_interests",
    description: "Configured student interests.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      required: ["student_id"],
    },
  },
  {
    name: "query_iep_goals",
    description: "IEP goal text and targets per skill.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_attempts_before_breaks",
    description: "Up to 5 attempts before each recent brain break.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      required: ["student_id"],
    },
  },
];
