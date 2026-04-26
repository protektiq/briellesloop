import { Router } from "express";

const router = Router();

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
    return res.json({
      skills: [
        { skill_id: "math-multiplication", mastery: 0.71, due_items: 8, streak_days: 3 },
        { skill_id: "reading-inference", mastery: 0.64, due_items: 6, streak_days: 2 },
        { skill_id: "writing-grammar", mastery: 0.83, due_items: 3, streak_days: 5 },
      ],
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
