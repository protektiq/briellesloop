import { Router } from "express";
import {
  generateHint,
  generateJiujitsuHint,
  generateProgrammingHint,
  generateReadingHint,
} from "../services/grader.js";
import { query } from "../db.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNonEmptyString = (value, maxLength = 2_000) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value.trim());

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
    const {
      item_id: itemId,
      response_so_far: rawResponseSoFar,
      reading_question_index: rawReadingQuestionIndex,
    } = req.body ?? {};

    if (!isUuid(itemId)) {
      return res.status(400).json({
        error: "Invalid hint payload.",
        field: "item_id must be a valid UUID.",
      });
    }

    let responseSoFar = "";
    if (rawResponseSoFar !== undefined && rawResponseSoFar !== null) {
      if (typeof rawResponseSoFar !== "string" || rawResponseSoFar.length > 2_000) {
        return res.status(400).json({
          error: "Invalid response_so_far.",
          field: "response_so_far must be a string up to 2000 chars when provided.",
        });
      }
      responseSoFar = rawResponseSoFar;
    }

    const itemResult = await query(
      `
        SELECT i.id, i.skill_id, i.level, i.item_type, i.prompt, i.answer, i.metadata, sk.name AS skill_name
        FROM items i
        INNER JOIN skills sk ON sk.id = i.skill_id
        WHERE i.id = $1
        LIMIT 1
      `,
      [itemId.trim()],
    );

    if (itemResult.rowCount === 0) {
      return res.status(404).json({
        error: "Item not found.",
      });
    }

    const itemRow = itemResult.rows[0];
    if (
      itemRow.skill_name !== "math" &&
      itemRow.skill_name !== "reading" &&
      itemRow.skill_name !== "jiujitsu" &&
      itemRow.skill_name !== "programming"
    ) {
      return res.status(400).json({
        error: "Hints are available for math, reading, jiu-jitsu, and programming items only.",
      });
    }

    let readingQuestionIndex = 0;
    if (itemRow.skill_name === "reading") {
      if (rawReadingQuestionIndex === undefined || rawReadingQuestionIndex === null) {
        return res.status(400).json({
          error: "Missing reading_question_index.",
          field: "reading_question_index is required for reading items.",
        });
      }
      const parsedIdx = Number.parseInt(String(rawReadingQuestionIndex), 10);
      if (!Number.isInteger(parsedIdx) || parsedIdx < 0 || parsedIdx > 2) {
        return res.status(400).json({
          error: "Invalid reading_question_index.",
          field: "reading_question_index must be an integer between 0 and 2.",
        });
      }
      readingQuestionIndex = parsedIdx;
    }

    let hint;
    try {
      if (itemRow.skill_name === "reading") {
        hint = await generateReadingHint(itemRow, responseSoFar, readingQuestionIndex);
      } else if (itemRow.skill_name === "jiujitsu") {
        hint = await generateJiujitsuHint(itemRow, responseSoFar);
      } else if (itemRow.skill_name === "programming") {
        hint = await generateProgrammingHint(itemRow, responseSoFar);
      } else {
        hint = await generateHint(itemRow, responseSoFar);
      }
    } catch (hintError) {
      const message = hintError instanceof Error ? hintError.message : "Hint generation failed.";
      return res.status(502).json({
        error: "Hint unavailable.",
        message,
      });
    }

    return res.json({
      item_id: itemRow.id,
      hint_text: hint.hint_text,
      hint_level: hint.hint_level,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
