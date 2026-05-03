import { Router } from "express";
import { query } from "../db.js";
import { getSuggestedSkill } from "../services/skill-suggester.js";
import { resolveStudentId } from "../services/student-resolve.js";
import { computePracticeStreakDays } from "../services/dashboard-streak.js";
import { getDashboardWeekPayload } from "../services/dashboard-week.js";

const router = Router();

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

router.get("/week", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.query.student_id === "string" ? req.query.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const weekStartRaw =
      typeof req.query.week_start === "string" ? req.query.week_start.trim() : "";

    const payload = await getDashboardWeekPayload(studentId, weekStartRaw);
    return res.json(payload);
  } catch (error) {
    if (error && error.code === "INVALID_WEEK_START") {
      return res.status(400).json({
        error: "InvalidWeekStart",
        message: error.message ?? "Invalid week_start.",
      });
    }
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
    const practiceStreakDays = await computePracticeStreakDays(studentId);
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
      practice_streak_days: practiceStreakDays,
      skills,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
