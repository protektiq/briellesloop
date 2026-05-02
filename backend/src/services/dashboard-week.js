import { query } from "../db.js";

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Week boundaries use UTC date-only: [weekStartInclusive, weekStartInclusive + 7 days). */
export const utcMondayOfContainingWeek = (referenceDate = new Date()) => {
  const y = referenceDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth();
  const d = referenceDate.getUTCDate();
  const day = referenceDate.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(y, m, d + diffToMonday));
  return monday;
};

export const formatUtcDateString = (date) => date.toISOString().slice(0, 10);

export const parseAndValidateWeekStart = (input) => {
  if (typeof input !== "string" || input.trim().length === 0) {
    return formatUtcDateString(utcMondayOfContainingWeek());
  }

  const trimmed = input.trim();
  const match = ISO_DATE_REGEX.exec(trimmed);
  if (!match) {
    const err = new Error("week_start must be YYYY-MM-DD.");
    err.code = "INVALID_WEEK_START";
    throw err;
  }

  const y = Number.parseInt(match[1], 10);
  const mo = Number.parseInt(match[2], 10);
  const d = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCDay() !== 1) {
    const err = new Error("week_start must be a Monday (UTC).");
    err.code = "INVALID_WEEK_START";
    throw err;
  }

  return trimmed;
};

export const addDaysUtc = (dateStr, days) => {
  const [y, m, d] = dateStr.split("-").map((x) => Number.parseInt(x, 10));
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return formatUtcDateString(next);
};

export const toUtcRange = (weekStartDateStr) => {
  const startIso = `${weekStartDateStr}T00:00:00.000Z`;
  const endDateStr = addDaysUtc(weekStartDateStr, 7);
  const endIso = `${endDateStr}T00:00:00.000Z`;
  return { startIso, endIso, weekEndDisplay: addDaysUtc(weekStartDateStr, 6) };
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const fetchWeeklyStats = async (studentId, startIso, endIso) => {
  const sessionAgg = await query(
    `
      SELECT
        COALESCE(
          SUM(s.items_correct)::float / NULLIF(SUM(s.items_attempted), 0),
          NULL
        ) AS avg_accuracy,
        COUNT(DISTINCT (s.started_at AT TIME ZONE 'UTC')::date)::int AS days_practiced,
        AVG(s.post_mood_score)::float AS avg_mood
      FROM sessions s
      WHERE s.student_id = $1::uuid
        AND s.started_at >= $2::timestamptz
        AND s.started_at < $3::timestamptz
    `,
    [studentId, startIso, endIso],
  );

  const brainResult = await query(
    `
      SELECT COUNT(*)::int AS brain_breaks
      FROM brain_breaks bb
      INNER JOIN sessions s ON s.id = bb.session_id
      WHERE s.student_id = $1::uuid
        AND bb.taken_at >= $2::timestamptz
        AND bb.taken_at < $3::timestamptz
    `,
    [studentId, startIso, endIso],
  );

  const row = sessionAgg.rows[0];
  const avgAccuracy =
    row.avg_accuracy === null || row.avg_accuracy === undefined
      ? null
      : Number.parseFloat(String(row.avg_accuracy));
  const avgMood =
    row.avg_mood === null || row.avg_mood === undefined ? null : Number.parseFloat(String(row.avg_mood));

  return {
    avg_accuracy: Number.isFinite(avgAccuracy) ? avgAccuracy : null,
    days_practiced: Number.parseInt(String(row.days_practiced ?? 0), 10) || 0,
    brain_breaks: Number.parseInt(String(brainResult.rows[0]?.brain_breaks ?? 0), 10) || 0,
    avg_mood: Number.isFinite(avgMood) ? avgMood : null,
  };
};

export const fetchSkillAccuracy = async (studentId, startIso, endIso) => {
  const result = await query(
    `
      SELECT
        sk.name AS skill_name,
        sk.iep_target_pct::int AS iep_target_pct,
        CASE
          WHEN COALESCE(SUM(s.items_attempted), 0) = 0 THEN NULL
          ELSE (SUM(s.items_correct)::float / SUM(s.items_attempted)::float)
        END AS accuracy
      FROM skills sk
      LEFT JOIN sessions s
        ON s.skill_id = sk.id
       AND s.student_id = $1::uuid
       AND s.started_at >= $2::timestamptz
       AND s.started_at < $3::timestamptz
      GROUP BY sk.id, sk.name, sk.iep_target_pct
      ORDER BY sk.name ASC
    `,
    [studentId, startIso, endIso],
  );

  return result.rows.map((row) => {
    const acc =
      row.accuracy === null || row.accuracy === undefined
        ? null
        : Number.parseFloat(String(row.accuracy));
    const iep = Number.parseInt(String(row.iep_target_pct ?? 80), 10);
    return {
      skill_name: String(row.skill_name),
      accuracy: Number.isFinite(acc) ? acc : null,
      iep_target_pct: Number.isInteger(iep) ? Math.min(100, Math.max(0, iep)) : 80,
    };
  });
};

const fetchMoodDayAggregates = async (studentId, startIso, endIso) => {
  const result = await query(
    `
      SELECT
        (s.started_at AT TIME ZONE 'UTC')::date AS day_date,
        AVG(s.pre_mood_score)::float AS pre_mood,
        AVG(s.post_mood_score)::float AS post_mood
      FROM sessions s
      WHERE s.student_id = $1::uuid
        AND s.started_at >= $2::timestamptz
        AND s.started_at < $3::timestamptz
      GROUP BY (s.started_at AT TIME ZONE 'UTC')::date
      ORDER BY day_date ASC
    `,
    [studentId, startIso, endIso],
  );

  const map = new Map();
  for (const row of result.rows) {
    const rawDate = row.day_date;
    const key =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : String(rawDate).slice(0, 10);
    const pre =
      row.pre_mood === null || row.pre_mood === undefined
        ? null
        : Number.parseFloat(String(row.pre_mood));
    const post =
      row.post_mood === null || row.post_mood === undefined
        ? null
        : Number.parseFloat(String(row.post_mood));
    map.set(key, {
      pre_mood: Number.isFinite(pre) ? pre : null,
      post_mood: Number.isFinite(post) ? post : null,
    });
  }
  return map;
};

const buildMoodSeries = (weekStartDateStr, moodByDate) => {
  const series = [];
  for (let i = 0; i < 7; i += 1) {
    const dateStr = addDaysUtc(weekStartDateStr, i);
    const data = moodByDate.get(dateStr) ?? { pre_mood: null, post_mood: null };
    const pre = data.pre_mood;
    const post = data.post_mood;
    const roughDay =
      pre !== null && pre <= 3 ? true : pre !== null && post !== null && post - pre < 0.5 && pre <= 4;

    series.push({
      weekday_index: i,
      label: WEEKDAY_LABELS[i],
      date: dateStr,
      pre_mood: pre,
      post_mood: post,
      rough_day: Boolean(roughDay),
    });
  }
  return series;
};

const computeDelta = (current, previous) => {
  if (current === null || previous === null) {
    return null;
  }
  return current - previous;
};

const fetchWeeklyInsight = async (studentId, weekStartDateStr) => {
  const result = await query(
    `
      SELECT insight_text, suggested_adjustment
      FROM weekly_insights
      WHERE student_id = $1::uuid
        AND week_start = $2::date
      LIMIT 1
    `,
    [studentId, weekStartDateStr],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const text =
    typeof row.insight_text === "string" && row.insight_text.trim().length > 0
      ? row.insight_text.trim()
      : null;
  const suggested =
    typeof row.suggested_adjustment === "string" && row.suggested_adjustment.trim().length > 0
      ? row.suggested_adjustment.trim()
      : null;

  if (!text && !suggested) {
    return null;
  }

  return {
    insight_text: text,
    suggested_adjustment: suggested,
  };
};

const fetchAgentActivityForWeek = async (weekStartDateStr) => {
  const { startIso, endIso } = toUtcRange(weekStartDateStr);
  const runs = await query(
    `
      SELECT
        ar.id,
        ar.reasoning,
        ar.cost_usd,
        ar.started_at,
        ar.status,
        a.name AS agent_name
      FROM agent_runs ar
      INNER JOIN agents a ON a.id = ar.agent_id
      WHERE ar.started_at >= $1::timestamptz
        AND ar.started_at < $2::timestamptz
      ORDER BY ar.started_at DESC
      LIMIT 12
    `,
    [startIso, endIso],
  );

  const pending = await query(
    `
      SELECT
        aa.id,
        aa.action_type,
        aa.rationale,
        aa.created_at,
        a.name AS agent_name
      FROM agent_actions aa
      INNER JOIN agent_runs ar ON ar.id = aa.agent_run_id
      INNER JOIN agents a ON a.id = ar.agent_id
      WHERE aa.requires_approval = TRUE
        AND aa.approved IS NULL
        AND aa.created_at >= $1::timestamptz
        AND aa.created_at < $2::timestamptz
      ORDER BY aa.created_at DESC
      LIMIT 8
    `,
    [startIso, endIso],
  );

  const feed = [];

  for (const row of pending.rows) {
    feed.push({
      id: `pending-${row.id}`,
      agent_name: row.agent_name,
      summary: `${row.action_type}: awaiting approval`,
      reasoning: typeof row.rationale === "string" ? row.rationale : null,
      requires_action: true,
      action_id: row.id,
    });
  }

  for (const row of runs.rows) {
    const summary =
      row.status === "failed"
        ? `${row.agent_name} run failed`
        : `${row.agent_name} completed`;
    feed.push({
      id: String(row.id),
      agent_name: row.agent_name,
      summary,
      reasoning:
        typeof row.reasoning === "string" && row.reasoning.trim().length > 0
          ? row.reasoning.trim().slice(0, 280)
          : null,
      requires_action: false,
      cost_usd: row.cost_usd,
    });
  }

  if (feed.length === 0) {
    return [];
  }

  return feed;
};

export const getDashboardWeekPayload = async (studentId, weekStartInput) => {
  let weekStartDateStr;
  try {
    weekStartDateStr = parseAndValidateWeekStart(weekStartInput);
  } catch (e) {
    if (e && e.code === "INVALID_WEEK_START") {
      throw e;
    }
    throw e;
  }

  const prevWeekStart = addDaysUtc(weekStartDateStr, -7);
  const { startIso, endIso, weekEndDisplay } = toUtcRange(weekStartDateStr);
  const prevRange = toUtcRange(prevWeekStart);

  const [currentStats, previousStats, moodMap, insight, agentActivity] = await Promise.all([
    fetchWeeklyStats(studentId, startIso, endIso),
    fetchWeeklyStats(studentId, prevRange.startIso, prevRange.endIso),
    fetchMoodDayAggregates(studentId, startIso, endIso),
    fetchWeeklyInsight(studentId, weekStartDateStr),
    fetchAgentActivityForWeek(weekStartDateStr),
  ]);

  const [skillAccuracy] = await Promise.all([
    fetchSkillAccuracy(studentId, startIso, endIso),
  ]);

  const mood_series = buildMoodSeries(weekStartDateStr, moodMap);

  const deltas = {
    avg_accuracy: computeDelta(currentStats.avg_accuracy, previousStats.avg_accuracy),
    days_practiced: computeDelta(currentStats.days_practiced, previousStats.days_practiced),
    brain_breaks: computeDelta(currentStats.brain_breaks, previousStats.brain_breaks),
    avg_mood: computeDelta(currentStats.avg_mood, previousStats.avg_mood),
  };

  return {
    student_id: studentId,
    week_start: weekStartDateStr,
    week_end: weekEndDisplay,
    timezone_note: "Week boundaries are UTC (Monday 00:00 through Sunday, exclusive end).",
    weekly_stats: {
      current: currentStats,
      previous: previousStats,
      deltas,
    },
    skill_accuracy: skillAccuracy,
    mood_series,
    weekly_insight: insight,
    agent_activity: agentActivity,
    generated_at: new Date().toISOString(),
  };
};
