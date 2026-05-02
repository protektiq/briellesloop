import { query } from "../db.js";

const DEFAULT_WRONG = 2;
const DEFAULT_TIME_SEC = 180;

/**
 * Known frustration_signal:{type} keys that the practice UI can evaluate server-side.
 * Unknown types are ignored until registered (Frustration Agent may propose new types later).
 */
const evaluateRegisteredSignal = (signalType, threshold, metrics) => {
  const t = Number(threshold);
  if (!Number.isFinite(t)) {
    return false;
  }

  switch (signalType) {
    case "consecutive_wrong":
    case "wrong_streak":
      return (
        Number.isFinite(metrics.consecutive_wrong) && metrics.consecutive_wrong >= t
      );
    case "seconds_on_item":
    case "slow_item_seconds":
    case "time_on_item":
      return (
        Number.isFinite(metrics.seconds_on_current_item) &&
        metrics.seconds_on_current_item >= t
      );
    case "session_attempts":
      return (
        Number.isFinite(metrics.session_attempt_count) &&
        metrics.session_attempt_count >= t
      );
    default:
      return false;
  }
};

const parseTuningRows = (rows) => {
  let frustrationWrongThreshold = DEFAULT_WRONG;
  let frustrationTimeThreshold = DEFAULT_TIME_SEC;
  const signals = [];

  for (const row of rows) {
    const name = typeof row.parameter_name === "string" ? row.parameter_name : "";
    const val = Number(row.current_value);
    if (!Number.isFinite(val)) {
      continue;
    }
    if (name === "frustration_wrong_threshold") {
      frustrationWrongThreshold = Math.round(
        Math.min(5, Math.max(1, val)),
      );
    } else if (name === "frustration_time_threshold") {
      frustrationTimeThreshold = Math.min(600, Math.max(20, val));
    } else if (name.startsWith("frustration_signal:")) {
      const type = name.slice("frustration_signal:".length).trim();
      if (type.length > 0) {
        signals.push({ type, threshold: val });
      }
    }
  }

  return { frustrationWrongThreshold, frustrationTimeThreshold, signals };
};

export const fetchFrustrationTuning = async (studentId) => {
  const result = await query(
    `
      SELECT parameter_name, current_value
      FROM student_tuning
      WHERE student_id = $1::uuid
        AND (
          parameter_name IN ('frustration_wrong_threshold', 'frustration_time_threshold')
          OR parameter_name LIKE 'frustration_signal:%'
        )
    `,
    [studentId],
  );

  return parseTuningRows(result.rows);
};

/**
 * @param {{ consecutive_wrong: number, seconds_on_current_item: number, session_attempt_count: number }} metrics
 * @param {{ frustrationWrongThreshold: number, frustrationTimeThreshold: number, signals: Array<{ type: string, threshold: number }> }} tuning
 */
export const evaluateFrustrationOffer = (metrics, tuning) => {
  const wrongTh = tuning.frustrationWrongThreshold;
  const timeTh = tuning.frustrationTimeThreshold;

  if (
    Number.isFinite(metrics.consecutive_wrong) &&
    metrics.consecutive_wrong >= wrongTh
  ) {
    return {
      offer_break: true,
      reason: "static_wrong",
      brain_break_trigger: "auto_two_wrong",
    };
  }

  if (
    Number.isFinite(metrics.seconds_on_current_item) &&
    metrics.seconds_on_current_item >= timeTh
  ) {
    return {
      offer_break: true,
      reason: "static_slow",
      brain_break_trigger: "auto_slow",
    };
  }

  for (const sig of tuning.signals) {
    if (evaluateRegisteredSignal(sig.type, sig.threshold, metrics)) {
      return {
        offer_break: true,
        reason: "agent_predicted",
        brain_break_trigger: "agent_predicted",
      };
    }
  }

  return {
    offer_break: false,
    reason: null,
    brain_break_trigger: null,
  };
};
