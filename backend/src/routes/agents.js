import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getClient, query } from "../db.js";
import {
  dispatchManualAgentRun,
  dispatchSimulateAgentRun,
  scheduleAgentCronJobs,
} from "../services/agent-scheduler.js";

const router = Router();
const __dirnameRoute = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirnameRoute, "../agents/prompts");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AGENT_NAMES = new Set(["calibration", "content", "frustration", "insight", "curriculum"]);

const ISO_CAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseSimulateDateRange = (body) => {
  const dateFrom = typeof body?.date_from === "string" ? body.date_from.trim() : "";
  const dateTo = typeof body?.date_to === "string" ? body.date_to.trim() : "";
  if (!ISO_CAL_DATE.test(dateFrom) || !ISO_CAL_DATE.test(dateTo)) {
    return { error: "date_from and date_to must be YYYY-MM-DD values." };
  }
  const tStart = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const tEndDay = Date.parse(`${dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(tStart) || !Number.isFinite(tEndDay)) {
    return { error: "Invalid calendar dates." };
  }
  if (tStart >= tEndDay) {
    return { error: "date_from must be before date_to." };
  }
  const inclusiveDays = Math.floor((tEndDay - tStart) / 86400000) + 1;
  if (inclusiveDays > 90) {
    return { error: "Date range must be at most 90 calendar days." };
  }
  return { dateFrom, dateTo };
};

const simulationBoundsIso = (dateFrom, dateTo) => {
  const simulationStart = `${dateFrom}T00:00:00.000Z`;
  const endDay = new Date(`${dateTo}T00:00:00.000Z`);
  endDay.setUTCDate(endDay.getUTCDate() + 1);
  const simulationEnd = endDay.toISOString();
  return { simulationStart, simulationEnd };
};

const parseStudentIdQuery = (queryValue) => {
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) {
    return undefined;
  }
  return queryValue;
};

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value.trim());

const parseLimit = (raw, def, max) => {
  const n = Number.parseInt(String(raw ?? def), 10);
  if (!Number.isInteger(n) || n < 1) {
    return def;
  }
  return Math.min(n, max);
};

export { scheduleAgentCronJobs };

router.get("/", async (req, res, next) => {
  try {
    const r = await query(
      `
        SELECT id, name, description, schedule_cron, enabled, last_run_at, next_run_at
        FROM agents
        ORDER BY id
      `,
    );
    return res.json({ agents: r.rows, generated_at: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:name/enabled", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent name." });
    }
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "Body must include enabled: boolean." });
    }
    const r = await query(
      `
        UPDATE agents
        SET enabled = $2
        WHERE name = $1
        RETURNING name, enabled
      `,
      [name, req.body.enabled],
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Agent not found." });
    }
    return res.json(r.rows[0]);
  } catch (error) {
    return next(error);
  }
});

const parseYearMonth = (raw) => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const m = raw.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    return null;
  }
  const y = Number.parseInt(m[1], 10);
  const mo = Number.parseInt(m[2], 10);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) {
    return null;
  }
  return { y, mo };
};

router.get("/cost-summary", async (req, res, next) => {
  try {
    const now = new Date();
    const parsed = parseYearMonth(typeof req.query.month === "string" ? req.query.month : "");
    const y = parsed ? parsed.y : now.getUTCFullYear();
    const mo = parsed ? parsed.mo : now.getUTCMonth() + 1;
    const start = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, mo, 1, 0, 0, 0, 0));

    const [agentSum, aiSum, byAgent] = await Promise.all([
      query(
        `
          SELECT COALESCE(SUM(cost_usd), 0)::decimal AS total
          FROM agent_runs
          WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz
        `,
        [start.toISOString(), end.toISOString()],
      ),
      query(
        `
          SELECT COALESCE(SUM(cost_usd), 0)::decimal AS total
          FROM ai_generations
          WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
        `,
        [start.toISOString(), end.toISOString()],
      ),
      query(
        `
          SELECT a.name AS agent_name, COALESCE(SUM(ar.cost_usd), 0)::decimal AS total_usd
          FROM agent_runs ar
          INNER JOIN agents a ON a.id = ar.agent_id
          WHERE ar.started_at >= $1::timestamptz AND ar.started_at < $2::timestamptz
          GROUP BY a.name
          ORDER BY a.name ASC
        `,
        [start.toISOString(), end.toISOString()],
      ),
    ]);

    const agentsUsd = Number(agentSum.rows[0]?.total ?? 0);
    const syncAiUsd = Number(aiSum.rows[0]?.total ?? 0);
    const breakdown = byAgent.rows.map((row) => ({
      agent_name: row.agent_name,
      total_usd: Number(row.total_usd ?? 0),
    }));

    return res.json({
      month: `${y}-${String(mo).padStart(2, "0")}`,
      range_start: start.toISOString(),
      range_end_exclusive: end.toISOString(),
      agent_runs_usd: agentsUsd,
      ai_generations_usd: syncAiUsd,
      total_usd: agentsUsd + syncAiUsd,
      agent_runs_by_agent: breakdown,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/runs", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 40, 200);
    const r = await query(
      `
        SELECT
          ar.id,
          ar.agent_id,
          a.name AS agent_name,
          ar.started_at,
          ar.ended_at,
          ar.status,
          ar.observations,
          ar.reasoning,
          ar.tokens_used,
          ar.cost_usd,
          ar.error_message,
          ar.dry_run
        FROM agent_runs ar
        INNER JOIN agents a ON a.id = ar.agent_id
        ORDER BY ar.started_at DESC
        LIMIT $1::int
      `,
      [limit],
    );
    return res.json({ runs: r.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/actions", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 80, 300);
    const pendingOnly = req.query.pending === "1" || req.query.pending === "true";
    const r = await query(
      `
        SELECT
          aa.id,
          aa.agent_run_id,
          aa.action_type,
          aa.target,
          aa.before_value,
          aa.after_value,
          aa.rationale,
          aa.requires_approval,
          aa.approved,
          aa.approved_at,
          aa.applied,
          aa.applied_at,
          aa.reverted,
          aa.created_at,
          ar.started_at AS run_started_at,
          a.name AS agent_name,
          ar.reasoning AS run_reasoning
        FROM agent_actions aa
        INNER JOIN agent_runs ar ON ar.id = aa.agent_run_id
        INNER JOIN agents a ON a.id = ar.agent_id
        WHERE CASE WHEN $2::boolean THEN aa.requires_approval = TRUE AND aa.approved IS NULL ELSE TRUE END
        ORDER BY aa.created_at DESC
        LIMIT $1::int
      `,
      [limit, pendingOnly],
    );
    return res.json({ actions: r.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/notes", async (_req, res, next) => {
  try {
    const r = await query(
      `
        SELECT
          n.id,
          n.from_agent_id,
          n.to_agent_id,
          n.note_type,
          n.content,
          n.created_at,
          n.read_at,
          fa.name AS from_agent_name,
          ta.name AS to_agent_name
        FROM agent_notes n
        LEFT JOIN agents fa ON fa.id = n.from_agent_id
        LEFT JOIN agents ta ON ta.id = n.to_agent_id
        ORDER BY n.created_at DESC
        LIMIT 20
      `,
    );
    return res.json({ notes: r.rows });
  } catch (error) {
    return next(error);
  }
});

router.get("/:name/prompt", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent name." });
    }
    const filePath = path.join(PROMPTS_DIR, `${name}.md`);
    const promptText = await fs.readFile(filePath, "utf8");
    return res.json({ name, prompt_text: promptText });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === "ENOENT") {
      return res.status(404).json({ error: "Prompt file not found." });
    }
    return next(error);
  }
});

router.put("/:name/prompt/restore", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent name." });
    }
    const mdPath = path.join(PROMPTS_DIR, `${name}.md`);
    const bakPath = path.join(PROMPTS_DIR, `${name}.md.bak`);
    try {
      await fs.access(bakPath);
    } catch {
      return res.status(404).json({ error: "No backup file to restore." });
    }
    await fs.copyFile(bakPath, mdPath);
    const promptText = await fs.readFile(mdPath, "utf8");
    return res.json({ name, prompt_text: promptText, restored: true });
  } catch (error) {
    return next(error);
  }
});

router.put("/:name/prompt", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent name." });
    }
    const promptText = req.body?.prompt_text;
    if (typeof promptText !== "string" || promptText.trim().length === 0) {
      return res.status(400).json({ error: "prompt_text must be a non-empty string." });
    }
    if (promptText.length > 500_000) {
      return res.status(400).json({ error: "prompt_text is too long." });
    }
    const mdPath = path.join(PROMPTS_DIR, `${name}.md`);
    const bakPath = path.join(PROMPTS_DIR, `${name}.md.bak`);
    try {
      const current = await fs.readFile(mdPath, "utf8");
      await fs.writeFile(bakPath, current, "utf8");
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e)?.code !== "ENOENT") {
        throw e;
      }
    }
    await fs.writeFile(mdPath, promptText, "utf8");
    return res.json({ name, saved: true });
  } catch (error) {
    return next(error);
  }
});

const fetchAction = async (id) => {
  const r = await query(
    `
      SELECT
        aa.*,
        a.name AS agent_name,
        ar.agent_id AS run_agent_id
      FROM agent_actions aa
      INNER JOIN agent_runs ar ON ar.id = aa.agent_run_id
      INNER JOIN agents a ON a.id = ar.agent_id
      WHERE aa.id = $1::uuid
      LIMIT 1
    `,
    [id],
  );
  return r.rows[0] ?? null;
};

router.post("/actions/:id/approve", async (req, res, next) => {
  let client;
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: "Invalid action id." });
    }

    const row = await fetchAction(id.trim());
    if (!row) {
      return res.status(404).json({ error: "Action not found." });
    }
    if (!row.requires_approval) {
      return res.status(400).json({ error: "This action does not require approval." });
    }
    if (row.approved !== null) {
      return res.status(400).json({ error: "Action already reviewed." });
    }

    const actionType = row.action_type;
    const after = row.after_value;
    const agentIdForRow =
      typeof row.run_agent_id === "number" && Number.isInteger(row.run_agent_id)
        ? row.run_agent_id
        : null;

    client = await getClient();
    await client.query("BEGIN");

    if (actionType === "propose_tuning_change") {
      const sid = after?.student_id;
      const param = after?.parameter_name;
      const proposed = after?.proposed_value;
      if (
        typeof sid !== "string" ||
        !isUuid(sid) ||
        typeof param !== "string" ||
        !Number.isFinite(Number(proposed))
      ) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid stored proposal payload." });
      }
      await client.query(
        `
          UPDATE student_tuning
          SET
            current_value = $3::decimal,
            last_changed_at = NOW(),
            changed_by_agent = COALESCE($4::int, (SELECT id FROM agents WHERE name = 'calibration' LIMIT 1))
          WHERE student_id = $1::uuid AND parameter_name = $2
        `,
        [sid, param, proposed, agentIdForRow],
      );
    } else if (actionType === "iep_goal_update") {
      const skillId = Number(after?.skill_id);
      const proposedText = typeof after?.proposed === "string" ? after.proposed.trim() : "";
      if (!Number.isInteger(skillId) || skillId < 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid stored IEP goal proposal." });
      }
      if (proposedText.length < 4 || proposedText.length > 8000) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid proposed goal text length." });
      }
      const chk = await client.query(`SELECT id FROM skills WHERE id = $1 LIMIT 1`, [skillId]);
      if (chk.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Unknown skill in proposal." });
      }
      await client.query(`UPDATE skills SET iep_goal_text = $1 WHERE id = $2`, [proposedText, skillId]);
    } else if (actionType === "level_override") {
      const sid = after?.student_id;
      const skillId = Number(after?.skill_id);
      const proposedLevel = Number(after?.proposed);
      if (typeof sid !== "string" || !isUuid(sid)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid stored level override (student)." });
      }
      if (!Number.isInteger(skillId) || skillId < 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid stored level override (skill)." });
      }
      if (!Number.isInteger(proposedLevel) || proposedLevel < 1 || proposedLevel > 10) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid stored level override (level)." });
      }
      const u = await client.query(
        `
          UPDATE student_skill_levels
          SET level = $1::int, updated_at = NOW()
          WHERE student_id = $2::uuid AND skill_id = $3
        `,
        [proposedLevel, sid, skillId],
      );
      if (u.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No matching student_skill_levels row to update." });
      }
    } else {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Unsupported action type for approval." });
    }

    await client.query(
      `
        UPDATE agent_actions
        SET
          approved = TRUE,
          approved_at = NOW(),
          applied = TRUE,
          applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [id.trim()],
    );

    await client.query("COMMIT");
    return res.json({
      status: "approved",
      action_id: id.trim(),
      reviewed_at: new Date().toISOString(),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/actions/:id/reject", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: "Invalid action id." });
    }

    const row = await fetchAction(id.trim());
    if (!row) {
      return res.status(404).json({ error: "Action not found." });
    }
    if (!row.requires_approval || row.approved !== null) {
      return res.status(400).json({ error: "Action cannot be rejected in this state." });
    }

    await query(
      `
        UPDATE agent_actions
        SET approved = FALSE, approved_at = NOW()
        WHERE id = $1::uuid
      `,
      [id.trim()],
    );

    return res.json({
      status: "rejected",
      action_id: id.trim(),
      reviewed_at: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/actions/:id/revert", async (req, res, next) => {
  let client;
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: "Invalid action id." });
    }

    const row = await fetchAction(id.trim());
    if (!row) {
      return res.status(404).json({ error: "Action not found." });
    }
    if (row.reverted === true) {
      return res.status(400).json({ error: "Already reverted." });
    }
    if (!row.applied) {
      return res.status(400).json({ error: "Action was not applied." });
    }

    const type = row.action_type;
    const before = row.before_value;
    const after = row.after_value;

    if (type === "request_new_items") {
      return res.status(400).json({
        error: "Item generation cannot be automatically reverted.",
      });
    }

    client = await getClient();
    await client.query("BEGIN");

    if (type === "curate_queue") {
      const sid = before?.student_id ?? after?.student_id;
      const skillId = Number(before?.skill_id ?? after?.skill_id);
      const itemIds = Array.isArray(before?.item_ids) ? before.item_ids : [];
      if (typeof sid !== "string" || !Number.isInteger(skillId)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing queue snapshot for revert." });
      }
      await client.query(`DELETE FROM next_session_queue WHERE student_id = $1::uuid AND skill_id = $2`, [
        sid,
        skillId,
      ]);
      let order = 0;
      for (const itemId of itemIds) {
        if (typeof itemId === "string" && isUuid(itemId)) {
          await client.query(
            `
              INSERT INTO next_session_queue (student_id, skill_id, item_id, queue_order)
              VALUES ($1::uuid, $2, $3::uuid, $4)
            `,
            [sid, skillId, itemId.trim(), order],
          );
          order += 1;
        }
      }
    } else if (type === "update_frustration_signals") {
      const sid = before?.student_id ?? after?.student_id;
      const pname = after?.parameter_name ?? before?.parameter_name;
      if (typeof sid !== "string" || typeof pname !== "string") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing tuning snapshot." });
      }
      if (before === null || before.current_value === undefined) {
        await client.query(
          `DELETE FROM student_tuning WHERE student_id = $1::uuid AND parameter_name = $2`,
          [sid, pname],
        );
      } else {
        await client.query(
          `
            UPDATE student_tuning
            SET current_value = $3::decimal, last_changed_at = NOW()
            WHERE student_id = $1::uuid AND parameter_name = $2
          `,
          [sid, pname, before.current_value],
        );
      }
    } else if (type === "write_weekly_insight") {
      const sid = after?.student_id;
      const ws = after?.week_start;
      if (typeof sid !== "string" || typeof ws !== "string") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing insight metadata." });
      }
      if (before === null) {
        await client.query(
          `DELETE FROM weekly_insights WHERE student_id = $1::uuid AND week_start = $2::date`,
          [sid, ws],
        );
      } else {
        await client.query(
          `
            UPDATE weekly_insights
            SET
              insight_text = $3,
              suggested_adjustment = $4,
              applied = TRUE
            WHERE student_id = $1::uuid AND week_start = $2::date
          `,
          [sid, ws, before.insight_text ?? null, before.suggested_adjustment ?? null],
        );
      }
    } else if (type === "flag_iep_concern") {
      const concernId = after?.concern_id;
      if (concernId === undefined || concernId === null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing concern id." });
      }
      await client.query(`DELETE FROM iep_concern_flags WHERE id = $1::uuid`, [String(concernId)]);
    } else if (type === "propose_tuning_change") {
      if (row.approved !== true) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Only approved tuning proposals can be reverted." });
      }
      const sid = before?.student_id;
      const pname = before?.parameter_name;
      const cv = before?.current_value;
      if (typeof sid !== "string" || typeof pname !== "string" || !Number.isFinite(Number(cv))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing tuning snapshot for revert." });
      }
      await client.query(
        `
          UPDATE student_tuning
          SET current_value = $3::decimal, last_changed_at = NOW(), changed_by_agent = NULL
          WHERE student_id = $1::uuid AND parameter_name = $2
        `,
        [sid, pname, cv],
      );
    } else if (type === "iep_goal_update") {
      if (row.approved !== true) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Only approved proposals can be reverted." });
      }
      const skillId = Number(after?.skill_id);
      const prev =
        before?.current === undefined || before?.current === null
          ? ""
          : String(before.current);
      if (!Number.isInteger(skillId) || skillId < 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing skill id for revert." });
      }
      await client.query(`UPDATE skills SET iep_goal_text = $1 WHERE id = $2`, [prev, skillId]);
    } else if (type === "level_override") {
      if (row.approved !== true) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Only approved proposals can be reverted." });
      }
      const sid = after?.student_id;
      const skillId = Number(after?.skill_id);
      const prevLevel = Number(before?.current);
      if (typeof sid !== "string" || !isUuid(sid) || !Number.isInteger(skillId) || !Number.isInteger(prevLevel)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Missing level override snapshot for revert." });
      }
      await client.query(
        `
          UPDATE student_skill_levels
          SET level = $1::int, updated_at = NOW()
          WHERE student_id = $2::uuid AND skill_id = $3
        `,
        [prevLevel, sid, skillId],
      );
    } else {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Unknown action type for revert." });
    }

    await client.query(
      `
        UPDATE agent_actions
        SET reverted = TRUE
        WHERE id = $1::uuid
      `,
      [id.trim()],
    );

    await client.query("COMMIT");
    return res.json({
      status: "reverted",
      action_id: id.trim(),
      reverted_at: new Date().toISOString(),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    return next(error);
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.post("/:name/simulate", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent." });
    }

    const agentRow = await query(`SELECT enabled FROM agents WHERE name = $1 LIMIT 1`, [name]);
    if (agentRow.rowCount === 0) {
      return res.status(404).json({ error: "Agent not found." });
    }
    if (agentRow.rows[0].enabled !== true) {
      return res.status(403).json({ error: "Agent is disabled in settings." });
    }

    const parsed = parseSimulateDateRange(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const rawSid =
      typeof req.body?.student_id === "string" ? req.body.student_id : parseStudentIdQuery(req.query.student_id);

    const { simulationStart, simulationEnd } = simulationBoundsIso(parsed.dateFrom, parsed.dateTo);

    const result = await dispatchSimulateAgentRun(name, rawSid, {
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
    });

    if (result?.skipped) {
      return res.json({
        ok: true,
        agent: name,
        skipped: true,
        reason: result.reason,
        run: null,
        simulated_actions: [],
        actual_actions: [],
        finished_at: new Date().toISOString(),
      });
    }

    const runRes = await query(
      `
        SELECT
          ar.id,
          ar.agent_id,
          a.name AS agent_name,
          ar.started_at,
          ar.ended_at,
          ar.status,
          ar.observations,
          ar.reasoning,
          ar.tokens_used,
          ar.cost_usd,
          ar.error_message,
          ar.dry_run
        FROM agent_runs ar
        INNER JOIN agents a ON a.id = ar.agent_id
        WHERE ar.id = $1::uuid
        LIMIT 1
      `,
      [result.agent_run_id],
    );

    const actionsRes = await query(
      `
        SELECT
          aa.id,
          aa.agent_run_id,
          aa.action_type,
          aa.target,
          aa.before_value,
          aa.after_value,
          aa.rationale,
          aa.requires_approval,
          aa.approved,
          aa.applied,
          aa.created_at,
          a.name AS agent_name
        FROM agent_actions aa
        INNER JOIN agent_runs ar ON ar.id = aa.agent_run_id
        INNER JOIN agents a ON a.id = ar.agent_id
        WHERE aa.created_at >= $1::timestamptz
          AND aa.created_at < $2::timestamptz
          AND COALESCE(ar.dry_run, false) = false
          AND ar.status IS DISTINCT FROM 'simulation'
        ORDER BY aa.created_at DESC
        LIMIT 100
      `,
      [simulationStart, simulationEnd],
    );

    return res.json({
      ok: true,
      agent: name,
      run: runRes.rows[0] ?? null,
      simulated_actions: Array.isArray(result.simulated_actions) ? result.simulated_actions : [],
      actual_actions: actionsRes.rows,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Simulation failed.";
    return res.status(500).json({ ok: false, error: msg });
  }
});

router.post("/:name/run", async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!AGENT_NAMES.has(String(name))) {
      return res.status(404).json({ error: "Unknown agent." });
    }

    const agentRow = await query(`SELECT enabled FROM agents WHERE name = $1 LIMIT 1`, [name]);
    if (agentRow.rowCount === 0) {
      return res.status(404).json({ error: "Agent not found." });
    }
    if (agentRow.rows[0].enabled !== true) {
      return res.status(403).json({ error: "Agent is disabled in settings." });
    }

    const rawSid =
      typeof req.body?.student_id === "string" ? req.body.student_id : parseStudentIdQuery(req.query.student_id);

    const result = await dispatchManualAgentRun(name, rawSid);
    return res.json({
      ok: true,
      agent: name,
      ...result,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Agent run failed.";
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
