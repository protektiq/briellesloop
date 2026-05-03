import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../db.js";
import { resolveStudentId } from "../services/student-resolve.js";

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IEP_DATA_DIR = path.resolve(__dirname, "..", "..", "data", "iep");
const MAX_BYTES = 10 * 1024 * 1024;

const parseStudentIdQuery = (queryValue) => {
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) {
    return undefined;
  }
  return queryValue;
};

const ensureIepDir = async () => {
  await fs.mkdir(IEP_DATA_DIR, { recursive: true });
};

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureIepDir();
      cb(null, IEP_DATA_DIR);
    } catch (err) {
      cb(err, IEP_DATA_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext === ".pdf" ? ".pdf" : ".pdf";
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const name = String(file.originalname || "").toLowerCase();
    if (mime !== "application/pdf" && mime !== "application/x-pdf") {
      return cb(new Error("Only PDF files are allowed."));
    }
    if (!name.endsWith(".pdf")) {
      return cb(new Error("File must have a .pdf extension."));
    }
    cb(null, true);
  },
});

const preview300 = (text) => {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  return text.length <= 300 ? text : text.slice(0, 300);
};

router.get("/document", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(parseStudentIdQuery(req.query.student_id));
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const r = await query(
      `
        SELECT id, uploaded_at, extracted_text
        FROM iep_documents
        WHERE student_id = $1::uuid AND active = TRUE
        LIMIT 1
      `,
      [studentId],
    );

    if (r.rowCount === 0) {
      return res.json({ document: null });
    }

    const row = r.rows[0];
    return res.json({
      document: {
        id: row.id,
        uploaded_at: row.uploaded_at,
        extracted_text_preview: preview300(row.extracted_text ?? ""),
      },
    });
  } catch (error) {
    return next(error);
  }
});

const uploadSinglePdf = (req, res, next) => {
  upload.single("iep_pdf")(req, res, (err) => {
    if (!err) {
      return next();
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "FileTooLarge",
          message: "PDF must be at most 10 MB.",
        });
      }
      return res.status(400).json({
        error: "UploadError",
        message: err.message || "Invalid upload.",
      });
    }
    return res.status(400).json({
      error: "InvalidUpload",
      message: err instanceof Error ? err.message : "Invalid upload.",
    });
  });
};

router.post("/upload", uploadSinglePdf, async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      if (filePath) {
        await fs.unlink(filePath).catch(() => {});
      }
      return res.status(404).json({ error: "No student found." });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Missing file",
        message: "Multipart form must include field iep_pdf with a PDF file.",
      });
    }

    let extractedText = "";
    try {
      const buf = await fs.readFile(req.file.path);
      const parser = new PDFParse({ data: buf });
      try {
        const textResult = await parser.getText();
        extractedText = typeof textResult.text === "string" ? textResult.text : "";
      } finally {
        await parser.destroy();
      }
    } catch {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        error: "InvalidPdf",
        message: "Could not read this PDF. It may be corrupted or password-protected.",
      });
    }

    const relativePath = path.relative(path.resolve(__dirname, "..", ".."), req.file.path);

    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE iep_documents SET active = FALSE WHERE student_id = $1::uuid`, [
        studentId,
      ]);
      const ins = await client.query(
        `
          INSERT INTO iep_documents (student_id, file_path, extracted_text, active)
          VALUES ($1::uuid, $2, $3, TRUE)
          RETURNING id, uploaded_at
        `,
        [studentId, relativePath.replace(/\\/g, "/"), extractedText],
      );
      await client.query("COMMIT");
      const rowOut = ins.rows[0];
      return res.json({
        id: rowOut.id,
        uploaded_at: rowOut.uploaded_at,
        extracted_text_preview: preview300(extractedText),
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      await fs.unlink(req.file.path).catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

export default router;
