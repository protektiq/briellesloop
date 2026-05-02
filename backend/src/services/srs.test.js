import { describe, expect, it } from "vitest";
import {
  checkSkillLevelAdvancement,
  calculateNextReviewAt,
  calculateNextTier,
  shouldAdvanceSkillLevel,
  shouldDropSkillLevel,
} from "./srs.js";

const defaultTuning = {
  tier_advance_accuracy: 80,
  tier_advance_response_time: 30,
  tier_advance_min_items: 10,
  weekly_drop_accuracy: 60,
};

const baseStats = {
  consecutive_correct: 0,
  total_correct: 0,
  distinct_sessions_correct: 0,
  all_responses_under_20s: true,
};

describe("calculateNextTier", () => {
  it("promotes tier 0 to tier 1 on correct answer", () => {
    const nextTier = calculateNextTier(0, true, 20, baseStats, defaultTuning);
    expect(nextTier).toBe(1);
  });

  it("promotes tier 1 to tier 2 when second consecutive correct is reached", () => {
    const nextTier = calculateNextTier(
      1,
      true,
      20,
      { ...baseStats, consecutive_correct: 1 },
      defaultTuning,
    );
    expect(nextTier).toBe(2);
  });

  it("promotes tier 2 to tier 3 when fourth consecutive correct and speed threshold are met", () => {
    const nextTier = calculateNextTier(
      2,
      true,
      29.9,
      { ...baseStats, consecutive_correct: 3 },
      defaultTuning,
    );
    expect(nextTier).toBe(3);
  });

  it("promotes tier 3 to tier 4 when total correct and session requirements are met", () => {
    const nextTier = calculateNextTier(
      3,
      true,
      15,
      {
        ...baseStats,
        total_correct: 5,
        distinct_sessions_correct: 3,
        all_responses_under_20s: true,
      },
      defaultTuning,
    );
    expect(nextTier).toBe(4);
  });

  it("drops any tier to tier 1 on a wrong answer", () => {
    expect(calculateNextTier(0, false, 10, baseStats, defaultTuning)).toBe(1);
    expect(calculateNextTier(1, false, 10, baseStats, defaultTuning)).toBe(1);
    expect(calculateNextTier(2, false, 10, baseStats, defaultTuning)).toBe(1);
    expect(calculateNextTier(3, false, 10, baseStats, defaultTuning)).toBe(1);
    expect(calculateNextTier(4, false, 10, baseStats, defaultTuning)).toBe(1);
  });

  it("enforces response-time threshold edge for tier 2 to tier 3 promotion", () => {
    const equalThresholdTier = calculateNextTier(
      2,
      true,
      30,
      { ...baseStats, consecutive_correct: 3 },
      defaultTuning,
    );
    const belowThresholdTier = calculateNextTier(
      2,
      true,
      29.99,
      { ...baseStats, consecutive_correct: 3 },
      defaultTuning,
    );

    expect(equalThresholdTier).toBe(2);
    expect(belowThresholdTier).toBe(3);
  });
});

describe("calculateNextReviewAt", () => {
  it("uses FR-13 tier intervals", () => {
    const now = "2026-04-26T00:00:00.000Z";
    expect(calculateNextReviewAt(1, now)).toBe("2026-04-27T00:00:00.000Z");
    expect(calculateNextReviewAt(2, now)).toBe("2026-04-29T00:00:00.000Z");
    expect(calculateNextReviewAt(3, now)).toBe("2026-05-03T00:00:00.000Z");
    expect(calculateNextReviewAt(4, now)).toBe("2026-05-26T00:00:00.000Z");
  });
});

describe("skill-level rules", () => {
  it("advances at exactly 80% when average response time is below 30s", () => {
    const recentAttempts = [
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: true, response_time_seconds: 29 },
      { tier: 3, is_correct: false, response_time_seconds: 29 },
      { tier: 3, is_correct: false, response_time_seconds: 29 },
    ];

    expect(shouldAdvanceSkillLevel(recentAttempts, defaultTuning)).toBe(true);
  });

  it("does not advance when average response time is exactly 30s", () => {
    const recentAttempts = [
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: true, response_time_seconds: 30 },
      { tier: 3, is_correct: false, response_time_seconds: 30 },
      { tier: 3, is_correct: false, response_time_seconds: 30 },
    ];

    expect(shouldAdvanceSkillLevel(recentAttempts, defaultTuning)).toBe(false);
  });

  it("drops when weekly accuracy is below tuned threshold", () => {
    expect(shouldDropSkillLevel(59.99, defaultTuning)).toBe(true);
    expect(shouldDropSkillLevel(60, defaultTuning)).toBe(false);
  });
});

describe("checkSkillLevelAdvancement", () => {
  it("returns shouldAdvance false when eligible Tier-3 item count is below 10", () => {
    const itemMasteryRows = Array.from({ length: 5 }, () => ({
      tier: 3,
      total_correct: 8,
      total_attempts: 10,
      avg_response_time_seconds: 25,
    }));

    const result = checkSkillLevelAdvancement(itemMasteryRows, defaultTuning);
    expect(result.eligibleCount).toBe(5);
    expect(result.shouldAdvance).toBe(false);
  });

  it("returns shouldAdvance true when item count and thresholds are satisfied", () => {
    const itemMasteryRows = Array.from({ length: 10 }, () => ({
      tier: 3,
      total_correct: 8,
      total_attempts: 10,
      avg_response_time_seconds: 20,
    }));

    const result = checkSkillLevelAdvancement(itemMasteryRows, defaultTuning);
    expect(result.eligibleCount).toBe(10);
    expect(result.avgAccuracy).toBe(80);
    expect(result.avgResponseTime).toBe(20);
    expect(result.shouldAdvance).toBe(true);
  });

  it("respects tuning overrides for min items and thresholds", () => {
    const itemMasteryRows = Array.from({ length: 8 }, () => ({
      tier: 3,
      total_correct: 7,
      total_attempts: 10,
      avg_response_time_seconds: 24,
    }));

    const result = checkSkillLevelAdvancement(itemMasteryRows, {
      ...defaultTuning,
      tier_advance_accuracy: 70,
      tier_advance_response_time: 25,
      tier_advance_min_items: 8,
    });

    expect(result.eligibleCount).toBe(8);
    expect(result.avgAccuracy).toBe(70);
    expect(result.avgResponseTime).toBe(24);
    expect(result.shouldAdvance).toBe(true);
  });
});
