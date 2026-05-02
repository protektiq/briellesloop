import { query } from "../db.js";

const clampNumber = (value, min, max) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, value));
};

/**
 * Last 7 reading sessions that have fluency JSON on at least one attempt (one point per session).
 * Ordered oldest-first for chart X axis.
 */
export const fetchReadingFluencySeries = async (studentId) => {
  const result = await query(
    `
      WITH ranked AS (
        SELECT
          s.started_at,
          (a.user_response->'fluency'->>'words_per_minute')::float AS wpm,
          (a.user_response->'fluency'->>'accuracy_pct')::float AS acc,
          ROW_NUMBER() OVER (PARTITION BY a.session_id ORDER BY a.attempted_at DESC) AS rn
        FROM attempts a
        INNER JOIN sessions s ON s.id = a.session_id
        INNER JOIN skills sk ON sk.id = s.skill_id
        WHERE s.student_id = $1::uuid
          AND sk.name = 'reading'
          AND a.user_response ? 'fluency'
      ),
      per_session AS (
        SELECT started_at, wpm, acc
        FROM ranked
        WHERE rn = 1
        ORDER BY started_at DESC
        LIMIT 7
      )
      SELECT started_at, wpm, acc
      FROM per_session
      ORDER BY started_at ASC
    `,
    [studentId],
  );

  const rows = result.rows ?? [];
  return rows.map((row, idx) => {
    const d = row.started_at instanceof Date ? row.started_at : new Date(row.started_at);
    const label = Number.isNaN(d.getTime())
      ? `S${idx + 1}`
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const wpm = clampNumber(row.wpm, 0, 500);
    const accuracy_pct = clampNumber(row.acc, 0, 100);
    return {
      label,
      words_per_minute: wpm,
      accuracy_pct,
    };
  });
};
