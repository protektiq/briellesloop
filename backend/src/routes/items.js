import { Router } from "express";

const router = Router();

const isNonEmptyString = (value, maxLength = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

const isBoolean = (value) => typeof value === "boolean";

router.get("/queue/:skill_id", async (req, res, next) => {
  try {
    const { skill_id: skillId } = req.params;

    if (!isNonEmptyString(skillId, 64)) {
      return res.status(400).json({
        error: "Invalid skill id.",
        field: "skill_id must be a non-empty string up to 64 chars.",
      });
    }

    return res.json({
      skill_id: skillId.trim(),
      generated_at: new Date().toISOString(),
      queue: [
        {
          item_id: "itm_1001",
          prompt: "What is 7 x 8?",
          type: "multiple_choice",
          choices: ["54", "56", "58", "64"],
          due_at: new Date(Date.now() - 60_000).toISOString(),
          ease_factor: 2.4,
        },
        {
          item_id: "itm_1002",
          prompt: "Explain regrouping in subtraction.",
          type: "short_answer",
          due_at: new Date(Date.now() + 120_000).toISOString(),
          ease_factor: 2.1,
        },
      ],
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/attempt", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { answer, is_correct: isCorrect, response_seconds: responseSeconds } = req.body ?? {};

    if (!isNonEmptyString(id, 64)) {
      return res.status(400).json({
        error: "Invalid item id.",
        field: "id must be a non-empty string up to 64 chars.",
      });
    }

    if (!isNonEmptyString(answer, 1_000) || !isBoolean(isCorrect)) {
      return res.status(400).json({
        error: "Invalid attempt payload.",
        fields: {
          answer: "Required non-empty string up to 1000 chars.",
          is_correct: "Required boolean.",
        },
      });
    }

    const parsedResponseSeconds = Number(responseSeconds);
    if (!Number.isFinite(parsedResponseSeconds) || parsedResponseSeconds < 0 || parsedResponseSeconds > 600) {
      return res.status(400).json({
        error: "Invalid response_seconds.",
        field: "response_seconds must be a number between 0 and 600.",
      });
    }

    return res.status(201).json({
      attempt_id: "att_09f0c23d",
      item_id: id.trim(),
      answer: answer.trim(),
      is_correct: isCorrect,
      response_seconds: parsedResponseSeconds,
      recorded_at: new Date().toISOString(),
      next_review_at: new Date(Date.now() + 86_400_000).toISOString(),
      srs_update: {
        prior_ease_factor: 2.3,
        new_ease_factor: isCorrect ? 2.36 : 2.1,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
