import { randomBytes } from "node:crypto";
import { Router } from "express";
import { query } from "../db.js";
import { fetchReadingFluencySeries } from "../services/dashboard-fluency.js";
import { getDashboardWeekPayload } from "../services/dashboard-week.js";
import { resolveStudentId, UUID_REGEX } from "../services/student-resolve.js";

const router = Router();

const TOKEN_HEX_REGEX = /^[a-f0-9]{64}$/i;

const parseShareToken = (raw) => {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!TOKEN_HEX_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const clampShareDays = (raw) => {
  if (raw === null || raw === undefined) {
    return 30;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n)) {
    return 30;
  }
  return Math.min(90, Math.max(1, n));
};

const firstNameFromFullName = (name) => {
  if (typeof name !== "string" || name.trim().length === 0) {
    return "Student";
  }
  const first = name.trim().split(/\s+/)[0];
  return first.length > 0 ? first.slice(0, 64) : "Student";
};

const loadActiveShareRow = async (token) => {
  const result = await query(
    `
      SELECT
        st.id,
        st.student_id,
        st.expires_at,
        st.revoked_at,
        s.name AS student_full_name
      FROM share_tokens st
      INNER JOIN students s ON s.id = st.student_id
      WHERE st.token = $1
      LIMIT 1
    `,
    [token],
  );
  return result.rows[0] ?? null;
};

const isRowActive = (row) => {
  if (!row || row.revoked_at != null) {
    return false;
  }
  const exp = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  return exp.getTime() > Date.now();
};

router.post("/token", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const days = clampShareDays(req.body?.days);
    const token = randomBytes(32).toString("hex");

    const insert = await query(
      `
        INSERT INTO share_tokens (student_id, token, scope, expires_at)
        VALUES ($1::uuid, $2, 'read_only', NOW() + ($3::int * INTERVAL '1 day'))
        RETURNING id, expires_at
      `,
      [studentId, token, days],
    );

    const row = insert.rows[0];
    const expiresAt =
      row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at);

    const frontendOrigin =
      typeof process.env.FRONTEND_ORIGIN === "string" && process.env.FRONTEND_ORIGIN.trim().length > 0
        ? process.env.FRONTEND_ORIGIN.trim().replace(/\/$/, "")
        : "http://localhost:5173";

    return res.status(201).json({
      token,
      url: `${frontendOrigin}/share/${token}`,
      expires_at: expiresAt,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/tokens", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.query.student_id === "string" ? req.query.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const result = await query(
      `
        SELECT
          id,
          created_at,
          expires_at,
          last_accessed_at,
          revoked_at,
          scope
        FROM share_tokens
        WHERE student_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [studentId],
    );

    return res.json({ tokens: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.delete("/token/:id", async (req, res, next) => {
  try {
    const idParam = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!UUID_REGEX.test(idParam)) {
      return res.status(400).json({ error: "InvalidId", message: "Token id must be a UUID." });
    }

    const studentId = await resolveStudentId(
      typeof req.query.student_id === "string" ? req.query.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const updated = await query(
      `
        UPDATE share_tokens
        SET revoked_at = NOW()
        WHERE id = $1::uuid
          AND student_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING id
      `,
      [idParam, studentId],
    );

    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "NotFound", message: "Token not found or already revoked." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/validate/:token", async (req, res, next) => {
  try {
    const token = parseShareToken(req.params.token);
    if (!token) {
      return res.json({ valid: false });
    }

    const row = await loadActiveShareRow(token);
    if (!row || !isRowActive(row)) {
      return res.json({ valid: false });
    }

    await query(
      `
        UPDATE share_tokens
        SET last_accessed_at = NOW()
        WHERE id = $1::uuid
      `,
      [row.id],
    );

    const studentName = firstNameFromFullName(row.student_full_name);
    return res.json({ valid: true, student_name: studentName });
  } catch (error) {
    return next(error);
  }
});

router.get("/week/:token", async (req, res, next) => {
  try {
    const token = parseShareToken(req.params.token);
    if (!token) {
      return res.status(401).json({
        error: "InvalidShareToken",
        message: "This link has expired or is not valid.",
      });
    }

    const row = await loadActiveShareRow(token);
    if (!row || !isRowActive(row)) {
      return res.status(401).json({
        error: "InvalidShareToken",
        message: "This link has expired or is not valid.",
      });
    }

    await query(
      `
        UPDATE share_tokens
        SET last_accessed_at = NOW()
        WHERE id = $1::uuid
      `,
      [row.id],
    );

    const weekStartRaw =
      typeof req.query.week_start === "string" ? req.query.week_start.trim() : "";

    let payload;
    try {
      payload = await getDashboardWeekPayload(row.student_id, weekStartRaw);
    } catch (error) {
      if (error && error.code === "INVALID_WEEK_START") {
        return res.status(400).json({
          error: "InvalidWeekStart",
          message: error.message ?? "Invalid week_start.",
        });
      }
      return next(error);
    }

    const { agent_activity: _a, student_id: _s, ...rest } = payload;
    const fluency_series = await fetchReadingFluencySeries(row.student_id);

    return res.json({
      ...rest,
      fluency_series,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
