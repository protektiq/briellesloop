import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { resolveStudentId } from "../services/student-resolve.js";

const router = Router();

const PIN_REGEX = /^\d{4}$/;
const BCRYPT_ROUNDS = 12;

const parseStudentIdQuery = (queryValue) => {
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) {
    return undefined;
  }
  return queryValue;
};

router.get("/parent-pin", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(parseStudentIdQuery(req.query.student_id));
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const result = await query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM parent_settings
          WHERE student_id = $1
            AND parent_pin_hash IS NOT NULL
        ) AS configured
      `,
      [studentId],
    );

    const configured = result.rows[0]?.configured === true;
    return res.json({ configured, student_id: studentId });
  } catch (error) {
    return next(error);
  }
});

router.post("/parent-pin", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const pin = req.body?.pin;
    const confirmPin = req.body?.confirm_pin;

    if (typeof pin !== "string" || typeof confirmPin !== "string") {
      return res.status(400).json({
        error: "InvalidRequest",
        message: "pin and confirm_pin must be strings.",
      });
    }

    if (!PIN_REGEX.test(pin) || !PIN_REGEX.test(confirmPin)) {
      return res.status(400).json({
        error: "InvalidPin",
        message: "PIN must be exactly 4 digits.",
      });
    }

    if (pin !== confirmPin) {
      return res.status(400).json({
        error: "PinMismatch",
        message: "PIN and confirmation do not match.",
      });
    }

    const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    await query(
      `
        INSERT INTO parent_settings (student_id, parent_pin_hash, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (student_id) DO UPDATE SET
          parent_pin_hash = EXCLUDED.parent_pin_hash,
          updated_at = NOW()
      `,
      [studentId, hash],
    );

    return res.json({ ok: true, student_id: studentId, updated_at: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

export default router;
