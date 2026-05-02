import { Router } from "express";
import { resolveStudentId } from "../services/student-resolve.js";
import { buildIepPdfBuffer } from "../services/iep-pdf.js";

const router = Router();

router.get("/iep-pdf", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.query.student_id === "string" ? req.query.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const weekStartRaw =
      typeof req.query.week_start === "string" ? req.query.week_start.trim() : "";

    const buffer = await buildIepPdfBuffer(studentId, weekStartRaw);
    const safeDate = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="iep-review-${safeDate}.pdf"`,
    );
    return res.send(buffer);
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

export default router;
