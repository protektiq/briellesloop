import { Router } from "express";

const router = Router();

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

router.post("/start", async (req, res, next) => {
  try {
    const { student_id: studentId, skill_focus: skillFocus } = req.body ?? {};

    if (!isNonEmptyString(studentId, 64) || !isNonEmptyString(skillFocus, 80)) {
      return res.status(400).json({
        error: "Invalid request body.",
        fields: {
          student_id: "Required non-empty string up to 64 chars.",
          skill_focus: "Required non-empty string up to 80 chars.",
        },
      });
    }

    return res.status(201).json({
      session_id: "sess_8f2d7c58",
      student_id: studentId.trim(),
      skill_focus: skillFocus.trim(),
      status: "active",
      started_at: new Date().toISOString(),
      target_duration_minutes: 20,
      queue_snapshot: {
        due_items: 14,
        new_items: 6,
        projected_mastery_gain: 0.12,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/end", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body ?? {};

    if (!isNonEmptyString(id, 64)) {
      return res.status(400).json({
        error: "Invalid session id.",
        field: "id must be a non-empty string up to 64 chars.",
      });
    }

    if (reason !== undefined && !isNonEmptyString(reason, 120)) {
      return res.status(400).json({
        error: "Invalid reason.",
        field: "reason must be a non-empty string up to 120 chars when provided.",
      });
    }

    return res.json({
      session_id: id.trim(),
      status: "completed",
      ended_at: new Date().toISOString(),
      reason: reason?.trim() ?? "completed_target",
      summary: {
        attempts: 18,
        correct: 13,
        hints_used: 3,
        average_response_seconds: 9.6,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
