import { describe, expect, it } from "vitest";
import { evaluateFrustrationOffer } from "./frustration-eval.js";

const baseTuning = {
  frustrationWrongThreshold: 2,
  frustrationTimeThreshold: 60,
  signals: [{ type: "session_attempts", threshold: 20 }],
};

describe("evaluateFrustrationOffer", () => {
  it("prefers static consecutive-wrong over slower signals", () => {
    const r = evaluateFrustrationOffer(
      {
        consecutive_wrong: 2,
        seconds_on_current_item: 5,
        session_attempt_count: 25,
      },
      baseTuning,
    );
    expect(r.offer_break).toBe(true);
    expect(r.brain_break_trigger).toBe("auto_two_wrong");
  });

  it("uses slow threshold when wrong streak is below cap", () => {
    const r = evaluateFrustrationOffer(
      {
        consecutive_wrong: 0,
        seconds_on_current_item: 70,
        session_attempt_count: 3,
      },
      baseTuning,
    );
    expect(r.offer_break).toBe(true);
    expect(r.brain_break_trigger).toBe("auto_slow");
  });

  it("fires agent signal when static rules pass", () => {
    const r = evaluateFrustrationOffer(
      {
        consecutive_wrong: 0,
        seconds_on_current_item: 10,
        session_attempt_count: 25,
      },
      baseTuning,
    );
    expect(r.offer_break).toBe(true);
    expect(r.brain_break_trigger).toBe("agent_predicted");
  });

  it("returns no offer when metrics are calm", () => {
    const r = evaluateFrustrationOffer(
      {
        consecutive_wrong: 1,
        seconds_on_current_item: 30,
        session_attempt_count: 5,
      },
      baseTuning,
    );
    expect(r.offer_break).toBe(false);
  });
});
