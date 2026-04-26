import { Router } from "express";

const router = Router();

const isNonEmptyString = (value, maxLength = 2_000) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

router.post("/generate", async (req, res, next) => {
  try {
    const { skill_id: skillId, difficulty } = req.body ?? {};

    if (!isNonEmptyString(skillId, 64) || !isNonEmptyString(difficulty, 24)) {
      return res.status(400).json({
        error: "Invalid generate payload.",
        fields: {
          skill_id: "Required non-empty string up to 64 chars.",
          difficulty: "Required non-empty string up to 24 chars.",
        },
      });
    }

    return res.status(201).json({
      request_id: "gen_6a55fa7d",
      skill_id: skillId.trim(),
      difficulty: difficulty.trim(),
      item: {
        stem: "Solve 24 / 6 and explain your reasoning.",
        answer_key: "4 because 6 groups of 4 equals 24.",
        rubric: ["Correct quotient", "Uses multiplication inverse explanation"],
      },
      model: "claude-stub",
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/grade", async (req, res, next) => {
  try {
    const { item_id: itemId, response } = req.body ?? {};

    if (!isNonEmptyString(itemId, 64) || !isNonEmptyString(response, 2_000)) {
      return res.status(400).json({
        error: "Invalid grade payload.",
        fields: {
          item_id: "Required non-empty string up to 64 chars.",
          response: "Required non-empty string up to 2000 chars.",
        },
      });
    }

    return res.json({
      request_id: "grd_838f6b39",
      item_id: itemId.trim(),
      score: 0.8,
      is_correct: true,
      feedback: "Great use of inverse operations; include one more concrete example next time.",
      graded_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/hint", async (req, res, next) => {
  try {
    const { item_id: itemId, response_so_far: responseSoFar } = req.body ?? {};

    if (!isNonEmptyString(itemId, 64) || !isNonEmptyString(responseSoFar, 2_000)) {
      return res.status(400).json({
        error: "Invalid hint payload.",
        fields: {
          item_id: "Required non-empty string up to 64 chars.",
          response_so_far: "Required non-empty string up to 2000 chars.",
        },
      });
    }

    return res.json({
      request_id: "hnt_33946c61",
      item_id: itemId.trim(),
      hint: "Try rewriting division as repeated subtraction or as the inverse of multiplication.",
      hint_level: 1,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
