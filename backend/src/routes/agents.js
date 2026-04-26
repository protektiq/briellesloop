import { Router } from "express";

const router = Router();

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

router.get("/", async (_req, res, next) => {
  try {
    return res.json({
      agents: [
        { id: "calibration-agent", status: "idle", last_run_at: new Date(Date.now() - 120_000).toISOString() },
        { id: "content-agent", status: "running", last_run_at: new Date(Date.now() - 20_000).toISOString() },
        { id: "frustration-agent", status: "idle", last_run_at: new Date(Date.now() - 240_000).toISOString() },
        { id: "insight-agent", status: "idle", last_run_at: new Date(Date.now() - 300_000).toISOString() },
      ],
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/runs", async (_req, res, next) => {
  try {
    return res.json({
      runs: [
        {
          run_id: "run_001",
          agent_id: "content-agent",
          started_at: new Date(Date.now() - 60_000).toISOString(),
          ended_at: null,
          status: "running",
        },
        {
          run_id: "run_000",
          agent_id: "calibration-agent",
          started_at: new Date(Date.now() - 300_000).toISOString(),
          ended_at: new Date(Date.now() - 240_000).toISOString(),
          status: "succeeded",
        },
      ],
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/actions/pending", async (_req, res, next) => {
  try {
    return res.json({
      pending_actions: [
        {
          action_id: "act_101",
          agent_id: "frustration-agent",
          action_type: "schedule_break",
          risk_level: "low",
          requested_at: new Date(Date.now() - 30_000).toISOString(),
          payload: { suggested_minutes: 5 },
        },
      ],
      count: 1,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/actions/:id/approve", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reviewer_note: reviewerNote } = req.body ?? {};

    if (!isNonEmptyString(id, 64)) {
      return res.status(400).json({
        error: "Invalid action id.",
        field: "id must be a non-empty string up to 64 chars.",
      });
    }

    if (reviewerNote !== undefined && !isNonEmptyString(reviewerNote, 500)) {
      return res.status(400).json({
        error: "Invalid reviewer note.",
        field: "reviewer_note must be a non-empty string up to 500 chars when provided.",
      });
    }

    return res.json({
      action_id: id.trim(),
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewer_note: reviewerNote?.trim() ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/actions/:id/revert", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body ?? {};

    if (!isNonEmptyString(id, 64) || !isNonEmptyString(reason, 500)) {
      return res.status(400).json({
        error: "Invalid revert payload.",
        fields: {
          id: "id must be a non-empty string up to 64 chars.",
          reason: "reason is required and must be up to 500 chars.",
        },
      });
    }

    return res.json({
      action_id: id.trim(),
      status: "reverted",
      reason: reason.trim(),
      reverted_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
