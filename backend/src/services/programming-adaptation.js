/**
 * Adjusts programming scaffolding tier (1 = max support, 5 = lighter) from real attempt data.
 */

const clampTier = (value) => {
  const n = Math.floor(Number(value));
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    return 1;
  }
  return Math.min(5, Math.max(1, n));
};

/**
 * @param {import("pg").PoolClient} client
 * @param {string} studentId
 * @param {{ isCorrect: boolean; responseSeconds: number; hintUsed: boolean }} params
 */
export const updateProgrammingScaffoldingAfterAttempt = async (client, studentId, params) => {
  const { isCorrect, responseSeconds, hintUsed } = params;
  const seconds = Number(responseSeconds);
  const safeSeconds = Number.isFinite(seconds) ? Math.min(600, Math.max(0, seconds)) : 0;

  const lockResult = await client.query(
    `
      SELECT current_value
      FROM student_tuning
      WHERE student_id = $1::uuid
        AND parameter_name = 'programming_scaffolding'
      FOR UPDATE
    `,
    [studentId],
  );

  if (lockResult.rowCount === 0) {
    return { prior_tier: 1, next_tier: 1, updated: false };
  }

  let tier = clampTier(lockResult.rows[0]?.current_value ?? 1);

  const shouldDecrease = !isCorrect || Boolean(hintUsed) || safeSeconds > 90;
  if (shouldDecrease) {
    const nextTier = Math.max(1, tier - 1);
    await client.query(
      `
        UPDATE student_tuning
        SET current_value = $2::decimal,
            last_changed_at = NOW()
        WHERE student_id = $1::uuid
          AND parameter_name = 'programming_scaffolding'
      `,
      [studentId, nextTier],
    );
    return { prior_tier: tier, next_tier: nextTier, updated: nextTier !== tier };
  }

  const recentResult = await client.query(
    `
      SELECT
        a.is_correct,
        COALESCE(a.hint_used, FALSE) AS hint_used,
        a.response_time_seconds
      FROM attempts a
      INNER JOIN sessions s
        ON s.id = a.session_id
      INNER JOIN items i
        ON i.id = a.item_id
      INNER JOIN skills sk
        ON sk.id = i.skill_id
      WHERE s.student_id = $1::uuid
        AND sk.name = 'programming'
      ORDER BY a.attempted_at DESC
      LIMIT 3
    `,
    [studentId],
  );

  const rows = recentResult.rows;
  if (rows.length < 3) {
    return { prior_tier: tier, next_tier: tier, updated: false };
  }

  const allStrong = rows.every(
    (row) =>
      row.is_correct === true &&
      row.hint_used !== true &&
      Number(row.response_time_seconds) <= 60,
  );

  if (allStrong && tier < 5) {
    const nextTier = tier + 1;
    await client.query(
      `
        UPDATE student_tuning
        SET current_value = $2::decimal,
            last_changed_at = NOW()
        WHERE student_id = $1::uuid
          AND parameter_name = 'programming_scaffolding'
      `,
      [studentId, nextTier],
    );
    return { prior_tier: tier, next_tier: nextTier, updated: true };
  }

  return { prior_tier: tier, next_tier: tier, updated: false };
};
