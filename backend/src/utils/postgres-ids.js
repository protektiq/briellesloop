/**
 * Normalize a Postgres integer primary key (e.g. skills.id) for Node drivers that
 * may return INT as string or BIGINT as bigint.
 */
export const normalizeSkillsTableId = (value, label = "skillId") => {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber) || asNumber < 1) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return asNumber;
  }

  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
};
