import { Router } from "express";
import { TTS_VOICE_OPTIONS } from "../constants/tts-voices.js";
import { getClient, query } from "../db.js";
import { resolveStudentId } from "../services/student-resolve.js";

const router = Router();

const MAX_INTERESTS = 8;
const MAX_INTEREST_LEN = 40;
const MAX_IEP_LEN = 2000;
const MIN_LEVEL = 1;
const MAX_LEVEL = 10;
const MIN_SESSION_ITEMS = 3;
const MAX_SESSION_ITEMS = 10;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseStudentIdQuery = (queryValue) => {
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) {
    return undefined;
  }
  return queryValue;
};

const sanitizeInterests = (raw) => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return null;
    }
    const t = entry.trim();
    if (t.length === 0) {
      continue;
    }
    if (t.length > MAX_INTEREST_LEN) {
      return null;
    }
    out.push(t);
    if (out.length > MAX_INTERESTS) {
      return null;
    }
  }
  return out;
};

const sanitizeIepGoals = (raw, allowedNames) => {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const set = new Set(allowedNames);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!set.has(key)) {
      return null;
    }
    if (typeof value !== "string") {
      return null;
    }
    if (value.length > MAX_IEP_LEN) {
      return null;
    }
    out[key] = value;
  }
  return out;
};

const sanitizeSkillLevels = (raw, allowedNames) => {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const set = new Set(allowedNames);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!set.has(key)) {
      return null;
    }
    const n = Number.parseInt(String(value), 10);
    if (!Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL) {
      return null;
    }
    out[key] = n;
  }
  return out;
};

const clampSessionItemCount = (raw) => {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < MIN_SESSION_ITEMS || n > MAX_SESSION_ITEMS) {
    return null;
  }
  return n;
};

const TTS_VOICE_SET = new Set(TTS_VOICE_OPTIONS);

const sanitizeOptionalBoolean = (raw) => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  return null;
};

const sanitizeTtsVoice = (raw) => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!TTS_VOICE_SET.has(trimmed)) {
    return null;
  }
  return trimmed;
};

const parseUuidParam = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
};

router.get("/profile", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(parseStudentIdQuery(req.query.student_id));
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const [studentRow, skillsRows, levelsRows, tuningRow, psRow] = await Promise.all([
      query(`SELECT id, name, interests FROM students WHERE id = $1 LIMIT 1`, [studentId]),
      query(`SELECT id, name, iep_goal_text FROM skills ORDER BY name ASC`),
      query(`SELECT skill_id, level FROM student_skill_levels WHERE student_id = $1`, [studentId]),
      query(
        `
          SELECT current_value
          FROM student_tuning
          WHERE student_id = $1 AND parameter_name = 'session_item_count'
          LIMIT 1
        `,
        [studentId],
      ),
      query(
        `
          SELECT
            onboarding_completed_at,
            voice_math_enabled,
            voice_spelling_enabled,
            tts_voice
          FROM parent_settings
          WHERE student_id = $1
          LIMIT 1
        `,
        [studentId],
      ),
    ]);

    const s = studentRow.rows[0];
    if (!s) {
      return res.status(404).json({ error: "No student found." });
    }

    const skillNames = skillsRows.rows.map((r) => r.name).filter((n) => typeof n === "string");
    const levelsByName = {};
    const idToName = new Map(skillsRows.rows.map((r) => [r.id, r.name]));
    for (const row of levelsRows.rows) {
      const name = idToName.get(row.skill_id);
      if (typeof name === "string") {
        levelsByName[name] = Number.parseInt(String(row.level), 10);
      }
    }

    const rawTuning = tuningRow.rows[0]?.current_value;
    let sessionItemCount = 5;
    if (rawTuning !== undefined && rawTuning !== null) {
      const parsed = Number.parseInt(String(rawTuning), 10);
      if (Number.isInteger(parsed)) {
        sessionItemCount = Math.min(MAX_SESSION_ITEMS, Math.max(MIN_SESSION_ITEMS, parsed));
      }
    }

    const skillsPayload = skillsRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      iep_goal_text: row.iep_goal_text ?? "",
      level: Number.isInteger(levelsByName[row.name]) ? levelsByName[row.name] : 1,
    }));

    const ps = psRow.rows[0] ?? null;

    return res.json({
      student_id: studentId,
      student_name: s.name,
      interests: Array.isArray(s.interests) ? s.interests : [],
      skills: skillsPayload,
      session_item_count: sessionItemCount,
      onboarding_completed_at: ps?.onboarding_completed_at ?? null,
      voice_math_enabled: ps?.voice_math_enabled ?? true,
      voice_spelling_enabled: ps?.voice_spelling_enabled ?? false,
      tts_voice:
        typeof ps?.tts_voice === "string" && TTS_VOICE_SET.has(ps.tts_voice.trim())
          ? ps.tts_voice.trim()
          : "af_sky",
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    const skillsResult = await query(`SELECT id, name FROM skills ORDER BY name ASC`);
    const allowedNames = skillsResult.rows.map((r) => r.name);
    const nameToId = new Map(skillsResult.rows.map((r) => [r.name, r.id]));

    const interests = sanitizeInterests(req.body?.interests);
    const iepGoals = sanitizeIepGoals(req.body?.iep_goals, allowedNames);
    const skillLevels = sanitizeSkillLevels(req.body?.skill_levels, allowedNames);
    const sessionItemCount = clampSessionItemCount(req.body?.session_item_count);
    const voiceMathEnabled = sanitizeOptionalBoolean(req.body?.voice_math_enabled);
    const voiceSpellingEnabled = sanitizeOptionalBoolean(req.body?.voice_spelling_enabled);
    const ttsVoice = sanitizeTtsVoice(req.body?.tts_voice);

    if (req.body?.interests !== undefined && interests === null) {
      return res.status(400).json({ error: "Invalid interests (max 8, ≤40 chars each)." });
    }
    if (req.body?.iep_goals !== undefined && iepGoals === null) {
      return res.status(400).json({ error: "Invalid iep_goals." });
    }
    if (req.body?.skill_levels !== undefined && skillLevels === null) {
      return res.status(400).json({ error: "Invalid skill_levels (1–10 per skill)." });
    }
    if (req.body?.session_item_count !== undefined && sessionItemCount === null) {
      return res.status(400).json({ error: `session_item_count must be ${MIN_SESSION_ITEMS}–${MAX_SESSION_ITEMS}.` });
    }
    if (req.body?.voice_math_enabled !== undefined && voiceMathEnabled === null) {
      return res.status(400).json({ error: "voice_math_enabled must be a boolean." });
    }
    if (req.body?.voice_spelling_enabled !== undefined && voiceSpellingEnabled === null) {
      return res.status(400).json({ error: "voice_spelling_enabled must be a boolean." });
    }
    if (req.body?.tts_voice !== undefined && ttsVoice === null) {
      return res.status(400).json({
        error: `tts_voice must be one of: ${TTS_VOICE_OPTIONS.join(", ")}.`,
      });
    }

    if (
      interests === undefined &&
      iepGoals === undefined &&
      skillLevels === undefined &&
      sessionItemCount === undefined &&
      voiceMathEnabled === undefined &&
      voiceSpellingEnabled === undefined &&
      ttsVoice === undefined
    ) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      if (interests !== undefined) {
        await client.query(`UPDATE students SET interests = $2::text[] WHERE id = $1::uuid`, [
          studentId,
          interests,
        ]);
      }

      if (iepGoals !== undefined) {
        for (const [skillName, text] of Object.entries(iepGoals)) {
          await client.query(`UPDATE skills SET iep_goal_text = $2 WHERE name = $1`, [skillName, text]);
        }
      }

      if (skillLevels !== undefined) {
        for (const [skillName, lvl] of Object.entries(skillLevels)) {
          const sid = nameToId.get(skillName);
          if (sid === undefined) {
            continue;
          }
          await client.query(
            `
              INSERT INTO student_skill_levels (student_id, skill_id, level, updated_at)
              VALUES ($1::uuid, $2::int, $3::int, NOW())
              ON CONFLICT (student_id, skill_id)
              DO UPDATE SET level = EXCLUDED.level, updated_at = NOW()
            `,
            [studentId, sid, lvl],
          );
        }
      }

      if (sessionItemCount !== undefined) {
        await client.query(
          `
            UPDATE student_tuning
            SET current_value = $2::decimal, last_changed_at = NOW(), changed_by_agent = NULL
            WHERE student_id = $1::uuid AND parameter_name = 'session_item_count'
          `,
          [studentId, sessionItemCount],
        );
      }

      if (
        voiceMathEnabled !== undefined ||
        voiceSpellingEnabled !== undefined ||
        ttsVoice !== undefined
      ) {
        const existingPs = await client.query(
          `
            SELECT voice_math_enabled, voice_spelling_enabled, tts_voice
            FROM parent_settings
            WHERE student_id = $1::uuid
            LIMIT 1
          `,
          [studentId],
        );
        const row = existingPs.rows[0];
        const nextMath = voiceMathEnabled !== undefined ? voiceMathEnabled : Boolean(row?.voice_math_enabled ?? true);
        const nextSpell =
          voiceSpellingEnabled !== undefined ? voiceSpellingEnabled : Boolean(row?.voice_spelling_enabled ?? false);
        const nextVoice =
          ttsVoice !== undefined
            ? ttsVoice
            : typeof row?.tts_voice === "string" && TTS_VOICE_SET.has(row.tts_voice.trim())
              ? row.tts_voice.trim()
              : "af_sky";

        await client.query(
          `
            INSERT INTO parent_settings (
              student_id,
              voice_math_enabled,
              voice_spelling_enabled,
              tts_voice,
              updated_at
            )
            VALUES ($1::uuid, $2::boolean, $3::boolean, $4::text, NOW())
            ON CONFLICT (student_id) DO UPDATE SET
              voice_math_enabled = EXCLUDED.voice_math_enabled,
              voice_spelling_enabled = EXCLUDED.voice_spelling_enabled,
              tts_voice = EXCLUDED.tts_voice,
              updated_at = NOW()
          `,
          [studentId, nextMath, nextSpell, nextVoice],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }

    const refreshed = await query(
      `
        SELECT s.id, s.name, s.interests
        FROM students s
        WHERE s.id = $1
        LIMIT 1
      `,
      [studentId],
    );

    return res.json({
      ok: true,
      student_id: studentId,
      updated_at: new Date().toISOString(),
      student: refreshed.rows[0] ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/onboarding/complete", async (req, res, next) => {
  try {
    const studentId = await resolveStudentId(
      typeof req.body?.student_id === "string" ? req.body.student_id : undefined,
    );
    if (!studentId) {
      return res.status(404).json({ error: "No student found." });
    }

    await query(
      `
        INSERT INTO parent_settings (student_id, onboarding_completed_at, updated_at)
        VALUES ($1::uuid, NOW(), NOW())
        ON CONFLICT (student_id) DO UPDATE SET
          onboarding_completed_at = NOW(),
          updated_at = NOW()
      `,
      [studentId],
    );

    return res.json({
      ok: true,
      student_id: studentId,
      onboarding_completed_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:studentId/tuning", async (req, res, next) => {
  try {
    const studentId = parseUuidParam(req.params.studentId);
    if (!studentId) {
      return res.status(400).json({
        error: "Invalid student id.",
        field: "studentId must be a valid UUID.",
      });
    }

    const tuningResult = await query(
      `
        SELECT parameter_name, current_value
        FROM student_tuning
        WHERE student_id = $1::uuid
        ORDER BY parameter_name ASC
      `,
      [studentId],
    );

    return res.json({
      student_id: studentId,
      tuning: tuningResult.rows.map((row) => ({
        parameter_name: row.parameter_name,
        current_value: Number(row.current_value),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
