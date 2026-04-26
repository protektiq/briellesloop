import { Router } from "express";
import { query } from "../db.js";
import { getSuggestedSkill } from "../services/skill-suggester.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_REGEX = /^[a-z]{2,24}$/;

const normalizeSkillName = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!SKILL_NAME_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const parseUuidFromInput = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!UUID_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const resolveStudentId = async (studentIdFromQuery) => {
  const validatedStudentId = parseUuidFromInput(studentIdFromQuery);
  if (validatedStudentId) {
    return validatedStudentId;
  }

  const studentResult = await query(
    `
      SELECT id
      FROM students
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );

  return studentResult.rows[0]?.id ?? null;
};

router.get("/week", async (_req, res, next) => {
  try {
    return res.json({
      week_start: "2026-04-20",
      week_end: "2026-04-26",
      totals: {
        sessions: 6,
        minutes: 128,
        attempts: 134,
        accuracy: 0.79,
      },
      trend: [
        { day: "Mon", minutes: 18, accuracy: 0.75 },
        { day: "Tue", minutes: 22, accuracy: 0.8 },
        { day: "Wed", minutes: 15, accuracy: 0.73 },
        { day: "Thu", minutes: 24, accuracy: 0.81 },
        { day: "Fri", minutes: 19, accuracy: 0.78 },
        { day: "Sat", minutes: 14, accuracy: 0.82 },
        { day: "Sun", minutes: 16, accuracy: 0.84 },
      ],
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/skills", async (_req, res, next) => {
  try {
    const studentId = await resolveStudentId(_req.query.student_id);
    if (!studentId) {
      return res.status(404).json({
        error: "No student found.",
      });
    }

    const skillsResult = await query(
      `
        SELECT
          s.name AS skill_name,
          COALESCE(ssl.level, 1)::INT AS level,
          ssl.current_accuracy,
          COALESCE(due_counts.items_due, 0)::INT AS items_due
        FROM skills s
        LEFT JOIN student_skill_levels ssl
          ON ssl.skill_id = s.id
         AND ssl.student_id = $1
        LEFT JOIN (
          SELECT
            i.skill_id,
            COUNT(*)::INT AS items_due
          FROM item_mastery im
          JOIN items i ON i.id = im.item_id
          WHERE im.student_id = $1
            AND im.next_review_at IS NOT NULL
            AND im.next_review_at <= NOW()
          GROUP BY i.skill_id
        ) AS due_counts ON due_counts.skill_id = s.id
        ORDER BY s.name ASC
      `,
      [studentId],
    );

    const suggestedSkillName = await getSuggestedSkill(studentId);
    const skills = skillsResult.rows
      .map((row) => {
        const normalizedName = normalizeSkillName(row.skill_name);
        if (!normalizedName) {
          return null;
        }

        const safeLevel = Number.parseInt(String(row.level), 10);
        const safeItemsDue = Number.parseInt(String(row.items_due), 10);
        const safeAccuracy =
          row.current_accuracy === null
            ? null
            : Math.max(0, Math.min(1, Number.parseFloat(String(row.current_accuracy))));

        return {
          skill_name: normalizedName,
          level: Number.isInteger(safeLevel) ? Math.min(Math.max(safeLevel, 1), 10) : 1,
          current_accuracy: Number.isFinite(safeAccuracy) ? safeAccuracy : null,
          items_due: Number.isInteger(safeItemsDue) ? Math.max(safeItemsDue, 0) : 0,
          duration_minutes: 8 + (Number.isInteger(safeLevel) ? Math.min(Math.max(safeLevel, 1), 10) : 1),
        };
      })
      .filter(Boolean);

    return res.json({
      student_id: studentId,
      suggested_skill_name: suggestedSkillName,
      skills,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
