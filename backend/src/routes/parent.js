import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { resolveStudentId } from "../services/student-resolve.js";

const router = Router();

const PIN_REGEX = /^\d{4}$/;

router.post("/verify-pin", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const settingsResult = await query(
      `
        SELECT parent_pin_hash
        FROM parent_settings
        WHERE student_id = $1
      `,
      [studentId],
    );

    const storedHash = settingsResult.rows[0]?.parent_pin_hash;

    if (!storedHash || typeof storedHash !== "string") {
      return res.json({
        unlocked: true,
        skipped: true,
        student_id: studentId,
      });
    }

    const pin = req.body?.pin;
    if (typeof pin !== "string" || !PIN_REGEX.test(pin)) {
      return res.status(400).json({
        error: "InvalidPin",
        message: "PIN must be exactly 4 digits.",
      });
    }

    const match = await bcrypt.compare(pin, storedHash);
    if (!match) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Incorrect PIN.",
      });
    }

    return res.json({
      unlocked: true,
      skipped: false,
      student_id: studentId,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
