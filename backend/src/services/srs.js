const TIER_MIN = 0;
const TIER_MAX = 4;
const RESPONSE_TIME_MIN = 0;
const RESPONSE_TIME_MAX = 600;

const REVIEW_INTERVAL_DAYS_BY_TIER = {
  0: 1,
  1: 1,
  2: 3,
  3: 7,
  4: 30,
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const assertIntegerInRange = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
};

const assertNumberInRange = (value, min, max, label) => {
  if (!isFiniteNumber(value) || value < min || value > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  }
};

const normalizeMasteryStats = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("masteryStats must be an object.");
  }

  const masteryStats = {
    consecutive_correct: Number.parseInt(String(value.consecutive_correct), 10),
    total_correct: Number.parseInt(String(value.total_correct), 10),
    distinct_sessions_correct: Number.parseInt(String(value.distinct_sessions_correct), 10),
    all_responses_under_20s: value.all_responses_under_20s,
  };

  if (
    !Number.isInteger(masteryStats.consecutive_correct) ||
    masteryStats.consecutive_correct < 0 ||
    !Number.isInteger(masteryStats.total_correct) ||
    masteryStats.total_correct < 0 ||
    !Number.isInteger(masteryStats.distinct_sessions_correct) ||
    masteryStats.distinct_sessions_correct < 0 ||
    typeof masteryStats.all_responses_under_20s !== "boolean"
  ) {
    throw new Error("masteryStats fields are invalid.");
  }

  return masteryStats;
};

const getNumericTuningValue = (tuning, names, label) => {
  if (!tuning || typeof tuning !== "object") {
    throw new Error("tuning must be an object.");
  }

  for (const name of names) {
    const candidate = tuning[name];
    if (isFiniteNumber(candidate)) {
      return candidate;
    }
  }

  throw new Error(`${label} is missing in tuning.`);
};

const normalizeAdvanceTuning = (tuning) => ({
  tierAdvanceAccuracy: getNumericTuningValue(
    tuning,
    ["tierAdvanceAccuracy", "tier_advance_accuracy"],
    "tier_advance_accuracy",
  ),
  tierAdvanceResponseTime: getNumericTuningValue(
    tuning,
    ["tierAdvanceResponseTime", "tier_advance_response_time"],
    "tier_advance_response_time",
  ),
});

const normalizeDropTuning = (tuning) => ({
  weeklyDropAccuracy: getNumericTuningValue(
    tuning,
    ["weeklyDropAccuracy", "weekly_drop_accuracy", "tier_drop_accuracy"],
    "weekly_drop_accuracy",
  ),
});

const getOptionalNumericTuningValue = (tuning, names, fallback) => {
  if (!tuning || typeof tuning !== "object") {
    return fallback;
  }
  for (const name of names) {
    const candidate = tuning[name];
    if (isFiniteNumber(candidate)) {
      return candidate;
    }
  }
  return fallback;
};

const normalizeSkillAdvancementTuning = (tuning) => ({
  tierAdvanceAccuracy: getOptionalNumericTuningValue(
    tuning,
    ["tierAdvanceAccuracy", "tier_advance_accuracy"],
    80,
  ),
  tierAdvanceResponseTime: getOptionalNumericTuningValue(
    tuning,
    ["tierAdvanceResponseTime", "tier_advance_response_time"],
    30,
  ),
  tierAdvanceMinItems: getOptionalNumericTuningValue(
    tuning,
    ["tierAdvanceMinItems", "tier_advance_min_items"],
    10,
  ),
});

const normalizeItemMasteryRow = (row) => {
  if (!row || typeof row !== "object") {
    throw new Error("Each item mastery row must be an object.");
  }

  const normalizedTier = Number.parseInt(String(row.tier), 10);
  const normalizedTotalCorrect = Number(row.total_correct);
  const normalizedTotalAttempts = Number(row.total_attempts);
  const normalizedAvgResponseTime = Number(row.avg_response_time_seconds);

  if (!Number.isInteger(normalizedTier) || normalizedTier < TIER_MIN || normalizedTier > TIER_MAX) {
    throw new Error("Each item mastery row must include a valid tier.");
  }
  if (!isFiniteNumber(normalizedTotalCorrect) || normalizedTotalCorrect < 0) {
    throw new Error("Each item mastery row must include a valid total_correct.");
  }
  if (!isFiniteNumber(normalizedTotalAttempts) || normalizedTotalAttempts < 0) {
    throw new Error("Each item mastery row must include a valid total_attempts.");
  }
  if (!isFiniteNumber(normalizedAvgResponseTime) || normalizedAvgResponseTime < 0) {
    throw new Error("Each item mastery row must include a valid avg_response_time_seconds.");
  }

  return {
    tier: normalizedTier,
    totalCorrect: normalizedTotalCorrect,
    totalAttempts: normalizedTotalAttempts,
    avgResponseTimeSeconds: normalizedAvgResponseTime,
  };
};

export const calculateNextTier = (
  currentTier,
  isCorrect,
  responseTimeSeconds,
  masteryStats,
  tuning,
  skillType = "math",
) => {
  assertIntegerInRange(currentTier, TIER_MIN, TIER_MAX, "currentTier");
  if (typeof isCorrect !== "boolean") {
    throw new Error("isCorrect must be a boolean.");
  }
  assertNumberInRange(
    responseTimeSeconds,
    RESPONSE_TIME_MIN,
    RESPONSE_TIME_MAX,
    "responseTimeSeconds",
  );

  const normalizedMasteryStats = normalizeMasteryStats(masteryStats);
  const normalizedSkillType =
    typeof skillType === "string" ? skillType.trim().toLowerCase() : "math";
  const { tierAdvanceResponseTime } = normalizeAdvanceTuning(tuning);
  if (tierAdvanceResponseTime <= 0 || tierAdvanceResponseTime > RESPONSE_TIME_MAX) {
    throw new Error("tier_advance_response_time must be between 0 and 600.");
  }

  if (!isCorrect) {
    return 1;
  }

  const projectedConsecutiveCorrect = normalizedMasteryStats.consecutive_correct + 1;
  const projectedTotalCorrect = normalizedMasteryStats.total_correct + 1;

  if (currentTier === 0) {
    return 1;
  }

  if (currentTier === 1) {
    return projectedConsecutiveCorrect >= 2 ? 2 : 1;
  }

  if (currentTier === 2) {
    if (projectedConsecutiveCorrect >= 4 && responseTimeSeconds < tierAdvanceResponseTime) {
      return 3;
    }
    return 2;
  }

  if (currentTier === 3) {
    const allowTier4ByTime =
      normalizedSkillType === "writing" ? true : normalizedMasteryStats.all_responses_under_20s;
    if (
      projectedTotalCorrect >= 6 &&
      normalizedMasteryStats.distinct_sessions_correct >= 3 &&
      allowTier4ByTime
    ) {
      return 4;
    }
    return 3;
  }

  return 4;
};

export const calculateNextReviewAt = (tier, lastSeenAt) => {
  assertIntegerInRange(tier, TIER_MIN, TIER_MAX, "tier");

  const lastSeenDate = new Date(lastSeenAt);
  if (Number.isNaN(lastSeenDate.getTime())) {
    throw new Error("lastSeenAt must be a valid date/time value.");
  }

  const intervalDays = REVIEW_INTERVAL_DAYS_BY_TIER[tier];
  const intervalMilliseconds = intervalDays * 24 * 60 * 60 * 1000;
  const nextReviewDate = new Date(lastSeenDate.getTime() + intervalMilliseconds);
  return nextReviewDate.toISOString();
};

export const shouldAdvanceSkillLevel = (recentAttempts, currentTuning) => {
  if (!Array.isArray(recentAttempts)) {
    throw new Error("recentAttempts must be an array.");
  }

  const { tierAdvanceAccuracy, tierAdvanceResponseTime } = normalizeAdvanceTuning(currentTuning);
  if (tierAdvanceAccuracy < 0 || tierAdvanceAccuracy > 100) {
    throw new Error("tier_advance_accuracy must be between 0 and 100.");
  }
  if (tierAdvanceResponseTime <= 0 || tierAdvanceResponseTime > RESPONSE_TIME_MAX) {
    throw new Error("tier_advance_response_time must be between 0 and 600.");
  }

  const tier3Attempts = recentAttempts
    .filter((attempt) => attempt && typeof attempt === "object" && Number(attempt.tier) === 3)
    .map((attempt) => {
      const isCorrect = attempt.is_correct;
      const responseTimeSeconds = Number(attempt.response_time_seconds);
      if (typeof isCorrect !== "boolean" || !isFiniteNumber(responseTimeSeconds) || responseTimeSeconds < 0) {
        throw new Error("Each Tier-3 attempt must include valid is_correct and response_time_seconds values.");
      }
      return { isCorrect, responseTimeSeconds };
    });

  if (tier3Attempts.length < 10) {
    return false;
  }

  const totalCorrect = tier3Attempts.reduce((sum, attempt) => sum + (attempt.isCorrect ? 1 : 0), 0);
  const accuracyPercent = (totalCorrect / tier3Attempts.length) * 100;
  const avgResponseSeconds =
    tier3Attempts.reduce((sum, attempt) => sum + attempt.responseTimeSeconds, 0) /
    tier3Attempts.length;

  return accuracyPercent >= tierAdvanceAccuracy && avgResponseSeconds < tierAdvanceResponseTime;
};

export const checkSkillLevelAdvancement = (itemMasteryRows, tuning) => {
  if (!Array.isArray(itemMasteryRows)) {
    throw new Error("itemMasteryRows must be an array.");
  }

  const {
    tierAdvanceAccuracy,
    tierAdvanceResponseTime,
    tierAdvanceMinItems,
  } = normalizeSkillAdvancementTuning(tuning);

  if (tierAdvanceAccuracy < 0 || tierAdvanceAccuracy > 100) {
    throw new Error("tier_advance_accuracy must be between 0 and 100.");
  }
  if (tierAdvanceResponseTime <= 0 || tierAdvanceResponseTime > RESPONSE_TIME_MAX) {
    throw new Error("tier_advance_response_time must be between 0 and 600.");
  }
  if (!Number.isInteger(tierAdvanceMinItems) || tierAdvanceMinItems < 1 || tierAdvanceMinItems > 1000) {
    throw new Error("tier_advance_min_items must be an integer between 1 and 1000.");
  }

  const tier3Rows = itemMasteryRows
    .map(normalizeItemMasteryRow)
    .filter((row) => row.tier === 3);

  const eligibleCount = tier3Rows.length;
  if (eligibleCount === 0) {
    return {
      shouldAdvance: false,
      eligibleCount: 0,
      avgAccuracy: 0,
      avgResponseTime: 0,
    };
  }

  const totalCorrect = tier3Rows.reduce((sum, row) => sum + row.totalCorrect, 0);
  const totalAttempts = tier3Rows.reduce((sum, row) => sum + row.totalAttempts, 0);
  const avgAccuracy = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 0;
  const avgResponseTime =
    tier3Rows.reduce((sum, row) => sum + row.avgResponseTimeSeconds, 0) / eligibleCount;

  const shouldAdvance =
    eligibleCount >= tierAdvanceMinItems &&
    avgAccuracy >= tierAdvanceAccuracy &&
    avgResponseTime < tierAdvanceResponseTime;

  return {
    shouldAdvance,
    eligibleCount,
    avgAccuracy,
    avgResponseTime,
  };
};

export const shouldDropSkillLevel = (weeklyAccuracy, currentTuning) => {
  assertNumberInRange(weeklyAccuracy, 0, 100, "weeklyAccuracy");
  const { weeklyDropAccuracy } = normalizeDropTuning(currentTuning);
  if (weeklyDropAccuracy < 0 || weeklyDropAccuracy > 100) {
    throw new Error("weekly_drop_accuracy must be between 0 and 100.");
  }

  return weeklyAccuracy < weeklyDropAccuracy;
};

/** Minimum graded attempts in the current UTC calendar week before FR-16 drop can apply. */
export const MIN_WEEKLY_ATTEMPTS_FOR_LEVEL_DROP = 5;
