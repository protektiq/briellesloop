import { query } from "../db.js";

const toUtcDateKey = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }
  return "";
};

const utcTodayKey = () => new Date().toISOString().slice(0, 10);

const addUtcDays = (isoDateKey, deltaDays) => {
  const [y, m, d] = isoDateKey.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return "";
  }
  const base = Date.UTC(y, m - 1, d);
  const next = new Date(base + deltaDays * 86_400_000);
  return next.toISOString().slice(0, 10);
};

/**
 * Counts consecutive UTC calendar days with at least one completed session,
 * anchored on the most recent practice day (today or yesterday).
 */
export const computePracticeStreakDays = async (studentId) => {
  const result = await query(
    `
      SELECT DISTINCT ((s.ended_at AT TIME ZONE 'UTC')::date) AS day
      FROM sessions s
      WHERE s.student_id = $1::uuid
        AND s.ended_at IS NOT NULL
        AND s.ended_at >= ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '800 days')
      ORDER BY day DESC
    `,
    [studentId],
  );

  const dayKeys = new Set(
    result.rows.map((row) => toUtcDateKey(row.day)).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
  );

  const todayKey = utcTodayKey();
  const yesterdayKey = addUtcDays(todayKey, -1);

  if (!dayKeys.has(todayKey) && !dayKeys.has(yesterdayKey)) {
    return 0;
  }

  let cursor = dayKeys.has(todayKey) ? todayKey : yesterdayKey;
  let streak = 0;

  while (cursor && dayKeys.has(cursor)) {
    streak += 1;
    cursor = addUtcDays(cursor, -1);
  }

  return streak;
};
