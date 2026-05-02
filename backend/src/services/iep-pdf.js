import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { query } from "../db.js";
import {
  addDaysUtc,
  fetchSkillAccuracy,
  fetchWeeklyStats,
  parseAndValidateWeekStart,
  toUtcRange,
} from "./dashboard-week.js";

const require = createRequire(import.meta.url);

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 14;
const TOP_ACCENT_BAR = 7;

/** Matches frontend/src/styles/tokens.css */
const hex = (h) => {
  const n = h.replace("#", "");
  return rgb(
    Number.parseInt(n.slice(0, 2), 16) / 255,
    Number.parseInt(n.slice(2, 4), 16) / 255,
    Number.parseInt(n.slice(4, 6), 16) / 255,
  );
};

const BRAND = {
  bg: hex("#fff8ee"),
  ink: hex("#2a2118"),
  inkSoft: hex("#5c4f3f"),
  inkFaint: hex("#8a7b68"),
  accent: hex("#e85d2f"),
  accentDeep: hex("#c44318"),
  green: hex("#5c8f4c"),
  blue: hex("#3b6e91"),
};

/**
 * Embedded fonts support full Unicode glyphs; keep sanitizing astral-plane emoji
 * and math symbols that caused WinAnsi issues when we used Helvetica.
 */
export const sanitizePdfText = (text) =>
  String(text ?? "")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2260/g, "!=")
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, "''")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "");

const sanitizePdfTextAggressive = (text) =>
  sanitizePdfText(text).replace(/[^\u0009\u000a\u000d\u0020-\u024f]/g, "?");

const loadFontBytes = (pkgSubpath) => readFileSync(require.resolve(pkgSubpath));

const embedBrandFonts = async (pdfDoc) => {
  pdfDoc.registerFontkit(fontkit);
  const [nunito, nunitoBold, frauncesHeavy] = await Promise.all([
    pdfDoc.embedFont(loadFontBytes("@fontsource/nunito/files/nunito-latin-400-normal.woff2")),
    pdfDoc.embedFont(loadFontBytes("@fontsource/nunito/files/nunito-latin-700-normal.woff2")),
    pdfDoc.embedFont(loadFontBytes("@fontsource/fraunces/files/fraunces-latin-800-normal.woff2")),
  ]);
  return {
    body: nunito,
    bodyBold: nunitoBold,
    displayHeavy: frauncesHeavy,
  };
};

const fetchStudentName = async (studentId) => {
  const result = await query(`SELECT name FROM students WHERE id = $1::uuid`, [studentId]);
  const name = result.rows[0]?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : "Student";
};

const fetchItemsMasteredSnapshot = async (studentId) => {
  const result = await query(
    `
      SELECT COUNT(*)::int AS cnt
      FROM item_mastery
      WHERE student_id = $1::uuid
        AND tier >= 3
    `,
    [studentId],
  );
  return Number.parseInt(String(result.rows[0]?.cnt ?? 0), 10) || 0;
};

const fetchWeeklyInsightsInRange = async (studentId, oldestWeekStart, newestWeekStart) => {
  const result = await query(
    `
      SELECT week_start, insight_text, suggested_adjustment
      FROM weekly_insights
      WHERE student_id = $1::uuid
        AND week_start >= $2::date
        AND week_start <= $3::date
      ORDER BY week_start ASC
    `,
    [studentId, oldestWeekStart, newestWeekStart],
  );

  return result.rows.map((row) => {
    const ws = row.week_start;
    const weekStr =
      ws instanceof Date ? ws.toISOString().slice(0, 10) : String(ws).slice(0, 10);
    return {
      week_start: weekStr,
      insight_text:
        typeof row.insight_text === "string" ? row.insight_text.trim() : "",
      suggested_adjustment:
        typeof row.suggested_adjustment === "string"
          ? row.suggested_adjustment.trim()
          : "",
    };
  });
};

const wrapText = (text, maxCharsPerLine) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current.length > 0) {
        lines.push(current);
      }
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
      while (current.length > maxCharsPerLine) {
        lines.push(current.slice(0, maxCharsPerLine));
        current = current.slice(maxCharsPerLine);
      }
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

const paintPageCanvas = (page) => {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    color: BRAND.bg,
    borderWidth: 0,
  });
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - TOP_ACCENT_BAR,
    width: A4_WIDTH,
    height: TOP_ACCENT_BAR,
    color: BRAND.accent,
    borderWidth: 0,
  });
};

export const buildIepPdfBuffer = async (studentId, weekStartInput) => {
  const weekStartDateStr = parseAndValidateWeekStart(weekStartInput);

  const oldestWeekStart = addDaysUtc(weekStartDateStr, -(11 * 7));

  const weeklyRows = [];
  for (let i = 0; i < 12; i += 1) {
    const ws = addDaysUtc(oldestWeekStart, i * 7);
    const { startIso, endIso } = toUtcRange(ws);
    const stats = await fetchWeeklyStats(studentId, startIso, endIso);
    const skills = await fetchSkillAccuracy(studentId, startIso, endIso);
    weeklyRows.push({ week_start: ws, stats, skills });
  }

  const [studentName, itemsMastered, insights] = await Promise.all([
    fetchStudentName(studentId),
    fetchItemsMasteredSnapshot(studentId),
    fetchWeeklyInsightsInRange(studentId, oldestWeekStart, weekStartDateStr),
  ]);

  const pdfDoc = await PDFDocument.create();
  const fonts = await embedBrandFonts(pdfDoc);

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  paintPageCanvas(page);
  let cursorY = A4_HEIGHT - MARGIN;

  const ensureSpace = (minYFromBottom) => {
    if (cursorY < minYFromBottom) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      paintPageCanvas(page);
      cursorY = A4_HEIGHT - MARGIN;
    }
  };

  const drawTextSafe = (text, opts) => {
    const safe = sanitizePdfText(text);
    try {
      page.drawText(safe, opts);
    } catch (firstError) {
      const message = firstError instanceof Error ? firstError.message : "";
      if (!message.includes("cannot encode") && !message.includes("WinAnsi")) {
        throw firstError;
      }
      page.drawText(sanitizePdfTextAggressive(text), opts);
    }
  };

  const drawLine = (
    text,
    size = 11,
    {
      font = fonts.body,
      color = BRAND.ink,
      lineFactor = 1,
    } = {},
  ) => {
    ensureSpace(MARGIN + LINE_HEIGHT * 4);
    drawTextSafe(text, {
      x: MARGIN,
      y: cursorY,
      size,
      font,
      color,
    });
    cursorY -= LINE_HEIGHT * lineFactor * (size / 11);
  };

  const drawParagraph = (label, body, maxWidthChars = 85) => {
    drawLine(label, 11, { font: fonts.displayHeavy, color: BRAND.accent, lineFactor: 1.1 });
    const lines = wrapText(body || "(none)", maxWidthChars);
    for (const line of lines) {
      drawLine(line, 10, { color: BRAND.inkSoft, lineFactor: 1.05 });
    }
    cursorY -= 6;
  };

  /* Title — Fraunces / accent matches marketing header */
  ensureSpace(MARGIN + 56);
  const titleSize = 20;
  const titleA = "IEP review export ";
  const titleB = "— Brielle's Loop";
  const sA = sanitizePdfText(titleA);
  const sB = sanitizePdfText(titleB);
  drawTextSafe(sA, {
    x: MARGIN,
    y: cursorY,
    size: titleSize,
    font: fonts.displayHeavy,
    color: BRAND.ink,
  });
  const wA = fonts.displayHeavy.widthOfTextAtSize(sA, titleSize);
  drawTextSafe(sB, {
    x: MARGIN + wA,
    y: cursorY,
    size: titleSize,
    font: fonts.displayHeavy,
    color: BRAND.accent,
  });
  cursorY -= LINE_HEIGHT * 1.35 * (titleSize / 11);
  cursorY -= 8;

  drawLine(`Student: ${studentName}`, 13, { font: fonts.bodyBold, color: BRAND.ink, lineFactor: 1.15 });
  drawLine(
    `Reporting window: ${oldestWeekStart} through week ending ${addDaysUtc(weekStartDateStr, 6)} (UTC weeks)`,
    10,
    { color: BRAND.inkSoft, lineFactor: 1.05 },
  );
  drawLine(
    "Items at strong mastery tier (tier >= 3): snapshot at export time — see SRS tiers in app.",
    10,
    { color: BRAND.inkSoft, lineFactor: 1.05 },
  );
  drawLine(`Count: ${itemsMastered}`, 11, { font: fonts.bodyBold, color: BRAND.green, lineFactor: 1.1 });
  cursorY -= 12;

  drawLine("12-week summary (by week)", 14, {
    font: fonts.displayHeavy,
    color: BRAND.accentDeep,
    lineFactor: 1.15,
  });
  cursorY -= 4;
  for (const row of weeklyRows) {
    const acc = row.stats.avg_accuracy;
    const mood = row.stats.avg_mood;
    const accStr = acc === null ? "—" : `${(acc * 100).toFixed(1)}%`;
    const moodStr = mood === null ? "—" : mood.toFixed(1);
    drawLine(
      `${row.week_start}: accuracy ${accStr} · days ${row.stats.days_practiced}/7 · breaks ${row.stats.brain_breaks} · avg mood ${moodStr}`,
      9,
      { color: BRAND.ink, lineFactor: 1.02 },
    );
  }
  cursorY -= 10;

  const skillNames = weeklyRows[11]?.skills?.map((s) => s.skill_name) ?? [];
  drawLine("Per-skill accuracy (last column = selected week)", 14, {
    font: fonts.displayHeavy,
    color: BRAND.accentDeep,
    lineFactor: 1.15,
  });
  cursorY -= 4;
  for (const skillName of skillNames) {
    const trendParts = [];
    for (const row of weeklyRows) {
      const sk = row.skills.find((s) => s.skill_name === skillName);
      const a = sk?.accuracy;
      trendParts.push(a === null ? "—" : `${(a * 100).toFixed(0)}%`);
    }
    drawLine(`${skillName}: ${trendParts.join(" → ")}`, 8.5, {
      color: BRAND.inkSoft,
      lineFactor: 1.02,
    });
  }
  cursorY -= 12;

  drawLine("Weekly AI insights (stored)", 14, {
    font: fonts.displayHeavy,
    color: BRAND.blue,
    lineFactor: 1.15,
  });
  cursorY -= 4;
  if (insights.length === 0) {
    drawLine("No weekly insights in this period yet — agents not running or no data.", 10, {
      color: BRAND.inkSoft,
      lineFactor: 1.05,
    });
  } else {
    for (const ins of insights) {
      const body = [ins.insight_text, ins.suggested_adjustment].filter(Boolean).join(" — ");
      drawParagraph(`Week of ${ins.week_start}`, body || "(empty)");
    }
  }

  cursorY -= 6;
  drawLine(
    "Mood & brain breaks: see weekly table above (avg mood = mean post-session mood score).",
    9,
    { color: BRAND.inkFaint, lineFactor: 1.05 },
  );

  cursorY -= 10;
  ensureSpace(MARGIN + 28);
  drawLine("Generated by Brielle's Loop · local IEP review packet", 9, {
    font: fonts.bodyBold,
    color: BRAND.blue,
    lineFactor: 1,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};
