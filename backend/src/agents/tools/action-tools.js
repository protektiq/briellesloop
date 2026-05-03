import { getClient, query } from "../../db.js";
import { parseAndValidateWeekStart, toUtcRange } from "../../services/dashboard-week.js";
import { ensureMathQueueItems } from "../../services/content-generator.js";
import {
  ensureReadingQueueItems,
  ensureSpellingQueueItems,
  ensureTypingQueueItems,
} from "../../services/skills-queue.js";
import { assertUuid, clampInt } from "./validators.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CALIBRATION_PARAMS = new Set([
  "tier_advance_accuracy",
  "tier_advance_response_time",
  "session_item_count",
  "frustration_wrong_threshold",
  "frustration_time_threshold",
]);

const resolveSkillId = async (q, skillNameRaw) => {
  const skillName =
    typeof skillNameRaw === "string" ? skillNameRaw.trim().toLowerCase() : "";
  const allowed = ["reading", "math", "spelling", "typing"];
  if (!allowed.includes(skillName)) {
    throw new Error("skill_name must be reading, math, spelling, or typing.");
  }
  const r = await q(`SELECT id FROM skills WHERE name = $1 LIMIT 1`, [skillName]);
  if (r.rowCount === 0) {
    throw new Error(`Skill not found: ${skillName}`);
  }
  return { skillName, skillId: r.rows[0].id };
};

const insertActionRow = async (q, row) => {
  const r = await q(
    `
      INSERT INTO agent_actions (
        agent_run_id,
        action_type,
        target,
        before_value,
        after_value,
        rationale,
        requires_approval,
        approved,
        applied,
        applied_at
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9,
        CASE WHEN $9 = TRUE THEN NOW() ELSE NULL END
      )
      RETURNING id
    `,
    [
      row.agent_run_id,
      row.action_type,
      row.target,
      row.before_value ? JSON.stringify(row.before_value) : null,
      row.after_value ? JSON.stringify(row.after_value) : null,
      row.rationale ?? null,
      row.requires_approval,
      row.approved,
      row.applied,
    ],
  );
  return r.rows[0].id;
};

export const handleProposeTuningChange = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const parameterName =
    typeof input.parameter_name === "string" ? input.parameter_name.trim() : "";
  if (!CALIBRATION_PARAMS.has(parameterName)) {
    throw new Error(`parameter_name must be one of: ${[...CALIBRATION_PARAMS].join(", ")}`);
  }
  const newValue = Number(input.new_value);
  if (!Number.isFinite(newValue)) {
    throw new Error("new_value must be a finite number.");
  }
  const rationale =
    typeof input.rationale === "string" ? input.rationale.trim().slice(0, 4000) : "";

  const tun = await query(
    `
      SELECT parameter_name, current_value, default_value, min_value, max_value
      FROM student_tuning
      WHERE student_id = $1::uuid AND parameter_name = $2
      LIMIT 1
    `,
    [studentId, parameterName],
  );
  if (tun.rowCount === 0) {
    throw new Error(`Unknown tuning parameter: ${parameterName}`);
  }
  const row = tun.rows[0];
  const min = Number(row.min_value);
  const max = Number(row.max_value);
  if (newValue < min || newValue > max) {
    throw new Error(`new_value must be between ${min} and ${max} for ${parameterName}.`);
  }

  const beforeValue = {
    student_id: studentId,
    parameter_name: parameterName,
    current_value: Number(row.current_value),
    default_value: Number(row.default_value),
    min_value: min,
    max_value: max,
  };
  const afterValue = {
    student_id: studentId,
    parameter_name: parameterName,
    proposed_value: newValue,
  };

  const actionId = await insertActionRow(query, {
    agent_run_id: ctx.agentRunId,
    action_type: "propose_tuning_change",
    target: `student_tuning:${parameterName}`,
    before_value: beforeValue,
    after_value: afterValue,
    rationale,
    requires_approval: true,
    approved: null,
    applied: false,
  });

  return {
    ok: true,
    pending_parent_approval: true,
    action_id: actionId,
    message:
      "Proposal logged. Parent must approve in the dashboard before student_tuning updates.",
  };
};

export const handleCurateQueue = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const { skillName, skillId } = await resolveSkillId(query, input.skill_name);
  const rawIds = input.item_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error("item_ids must be a non-empty array of UUIDs.");
  }
  if (rawIds.length > 24) {
    throw new Error("item_ids must have at most 24 entries.");
  }
  const itemIds = rawIds.map((id, i) => {
    if (typeof id !== "string" || !UUID_REGEX.test(id.trim())) {
      throw new Error(`item_ids[${i}] must be a UUID.`);
    }
    return id.trim();
  });

  const rationale =
    typeof input.rationale === "string" ? input.rationale.trim().slice(0, 4000) : "";

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const beforeRows = await client.query(
      `
        SELECT item_id, queue_order
        FROM next_session_queue
        WHERE student_id = $1::uuid AND skill_id = $2
        ORDER BY queue_order ASC
      `,
      [studentId, skillId],
    );
    const beforeValue = {
      student_id: studentId,
      skill_name: skillName,
      skill_id: skillId,
      item_ids: beforeRows.rows.map((r) => r.item_id),
    };

    const verify = await client.query(
      `
        SELECT COUNT(*)::int AS n
        FROM items
        WHERE skill_id = $1
          AND id = ANY($2::uuid[])
      `,
      [skillId, itemIds],
    );
    const okCount = Number.parseInt(String(verify.rows[0]?.n ?? 0), 10);
    if (okCount !== itemIds.length) {
      throw new Error("Every item_id must belong to the selected skill.");
    }

    const afterValue = {
      student_id: studentId,
      skill_name: skillName,
      skill_id: skillId,
      item_ids: itemIds,
    };

    const actionId = await insertActionRow(client, {
      agent_run_id: ctx.agentRunId,
      action_type: "curate_queue",
      target: `next_session_queue:${skillName}`,
      before_value: beforeValue,
      after_value: afterValue,
      rationale,
      requires_approval: false,
      approved: true,
      applied: false,
    });

    await client.query(`DELETE FROM next_session_queue WHERE student_id = $1::uuid AND skill_id = $2`, [
      studentId,
      skillId,
    ]);

    let order = 0;
    for (const itemId of itemIds) {
      await client.query(
        `
          INSERT INTO next_session_queue (student_id, skill_id, item_id, queue_order)
          VALUES ($1::uuid, $2, $3::uuid, $4)
        `,
        [studentId, skillId, itemId, order],
      );
      order += 1;
    }

    await client.query(
      `
        UPDATE agent_actions
        SET applied = TRUE, applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [actionId],
    );

    await client.query("COMMIT");

    return {
      ok: true,
      action_id: actionId,
      skill_name: skillName,
      item_count: itemIds.length,
      message: "Session queue cache updated for this skill.",
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

export const handleRequestNewItems = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const { skillName, skillId } = await resolveSkillId(query, input.skill_name);
  clampInt(input.level, 1, 10, "level");
  const count = clampInt(input.count, 1, 8, "count");
  const topic =
    typeof input.topic === "string" ? input.topic.trim().slice(0, 200) : "";

  const afterValue = {
    student_id: studentId,
    skill_name: skillName,
    level: input.level,
    count,
    topic,
  };

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actionId = await insertActionRow(client, {
      agent_run_id: ctx.agentRunId,
      action_type: "request_new_items",
      target: `items:${skillName}`,
      before_value: null,
      after_value: afterValue,
      rationale: topic ? `Topic hint: ${topic}` : null,
      requires_approval: false,
      approved: true,
      applied: false,
    });

    let outcomeMessage = "";
    if (skillName === "math") {
      await ensureMathQueueItems(studentId, skillId, count);
      outcomeMessage = `Requested math queue expansion (+${count}).`;
    } else if (skillName === "reading") {
      await ensureReadingQueueItems(studentId, skillId, count);
      outcomeMessage = `Requested reading queue expansion (+${count}).`;
    } else if (skillName === "typing") {
      await ensureTypingQueueItems(studentId, skillId, count);
      outcomeMessage = `Requested typing queue expansion (+${count}).`;
    } else if (skillName === "spelling") {
      await ensureSpellingQueueItems(studentId, skillId, count);
      outcomeMessage = `Requested spelling queue expansion (+${count}).`;
    }

    await client.query(
      `
        UPDATE agent_actions
        SET applied = TRUE, applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [actionId],
    );

    await client.query("COMMIT");

    return {
      ok: true,
      action_id: actionId,
      message: outcomeMessage,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

export const handleUpdateFrustrationSignals = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const signalType =
    typeof input.signal_type === "string" ? input.signal_type.trim().slice(0, 120) : "";
  if (signalType.length < 1) {
    throw new Error("signal_type is required.");
  }
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("threshold must be a finite number.");
  }
  const parameterName = `frustration_signal:${signalType}`;
  const rationale =
    typeof input.rationale === "string" ? input.rationale.trim().slice(0, 4000) : "";

  const existing = await query(
    `
      SELECT current_value, min_value, max_value, default_value
      FROM student_tuning
      WHERE student_id = $1::uuid AND parameter_name = $2
      LIMIT 1
    `,
    [studentId, parameterName],
  );

  const client = await getClient();
  try {
    await client.query("BEGIN");

    let beforeValue = null;
    if (existing.rowCount > 0) {
      const er = existing.rows[0];
      beforeValue = {
        student_id: studentId,
        parameter_name: parameterName,
        current_value: Number(er.current_value),
      };
    }

    const actionId = await insertActionRow(client, {
      agent_run_id: ctx.agentRunId,
      action_type: "update_frustration_signals",
      target: parameterName,
      before_value: beforeValue,
      after_value: { student_id: studentId, parameter_name: parameterName, threshold },
      rationale,
      requires_approval: false,
      approved: true,
      applied: false,
    });

    if (existing.rowCount > 0) {
      await client.query(
        `
          UPDATE student_tuning
          SET current_value = $3::decimal,
              last_changed_at = NOW(),
              changed_by_agent = $4::int
          WHERE student_id = $1::uuid AND parameter_name = $2
        `,
        [studentId, parameterName, threshold, ctx.agentId],
      );
    } else {
      await client.query(
        `
          INSERT INTO student_tuning (
            student_id,
            parameter_name,
            current_value,
            default_value,
            min_value,
            max_value,
            last_changed_at,
            changed_by_agent
          )
          VALUES ($1::uuid, $2, $3::decimal, $3::decimal, 0::decimal, 500::decimal, NOW(), $4::int)
        `,
        [studentId, parameterName, threshold, ctx.agentId],
      );
    }

    await client.query(
      `
        UPDATE agent_actions
        SET applied = TRUE, applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [actionId],
    );

    await client.query("COMMIT");
    return { ok: true, action_id: actionId, parameter_name: parameterName, threshold };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

export const handleWriteWeeklyInsight = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const insightText =
    typeof input.insight_text === "string" ? input.insight_text.trim().slice(0, 12_000) : "";
  const suggested =
    typeof input.suggested_adjustment === "string"
      ? input.suggested_adjustment.trim().slice(0, 12_000)
      : "";
  if (!insightText && !suggested) {
    throw new Error("Provide insight_text and/or suggested_adjustment.");
  }

  const weekStart =
    typeof input.week_start === "string" && input.week_start.trim().length > 0
      ? parseAndValidateWeekStart(input.week_start.trim())
      : parseAndValidateWeekStart("");
  const { weekEndDisplay } = toUtcRange(weekStart);

  const prev = await query(
    `
      SELECT insight_text, suggested_adjustment
      FROM weekly_insights
      WHERE student_id = $1::uuid AND week_start = $2::date
      LIMIT 1
    `,
    [studentId, weekStart],
  );

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const beforeValue =
      prev.rowCount > 0
        ? {
            student_id: studentId,
            week_start: weekStart,
            insight_text: prev.rows[0].insight_text,
            suggested_adjustment: prev.rows[0].suggested_adjustment,
          }
        : null;

    const actionId = await insertActionRow(client, {
      agent_run_id: ctx.agentRunId,
      action_type: "write_weekly_insight",
      target: `weekly_insights:${weekStart}`,
      before_value: beforeValue,
      after_value: {
        student_id: studentId,
        week_start: weekStart,
        week_end: weekEndDisplay,
        insight_text: insightText || null,
        suggested_adjustment: suggested || null,
      },
      rationale: null,
      requires_approval: false,
      approved: true,
      applied: false,
    });

    await client.query(
      `
        INSERT INTO weekly_insights (
          student_id,
          week_start,
          week_end,
          insight_text,
          suggested_adjustment,
          applied
        )
        VALUES ($1::uuid, $2::date, $3::date, $4, $5, TRUE)
        ON CONFLICT (student_id, week_start) DO UPDATE SET
          week_end = EXCLUDED.week_end,
          insight_text = EXCLUDED.insight_text,
          suggested_adjustment = EXCLUDED.suggested_adjustment,
          applied = TRUE
      `,
      [studentId, weekStart, weekEndDisplay, insightText || null, suggested || null],
    );

    await client.query(
      `
        UPDATE agent_actions
        SET applied = TRUE, applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [actionId],
    );

    await client.query("COMMIT");
    return { ok: true, action_id: actionId, week_start: weekStart };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

const MAX_IEP_GOAL_CHARS = 8000;

export const handleProposeIepGoalUpdate = async (input, ctx) => {
  const skillId = Number(input.skill_id);
  if (!Number.isInteger(skillId) || skillId < 1) {
    throw new Error("skill_id must be a positive integer.");
  }
  const proposed =
    typeof input.proposed_goal_text === "string" ? input.proposed_goal_text.trim() : "";
  if (proposed.length < 4) {
    throw new Error("proposed_goal_text must be at least 4 characters.");
  }
  if (proposed.length > MAX_IEP_GOAL_CHARS) {
    throw new Error(`proposed_goal_text must be at most ${MAX_IEP_GOAL_CHARS} characters.`);
  }
  const rationale =
    typeof input.rationale === "string" ? input.rationale.trim().slice(0, 4000) : "";

  const skill = await query(`SELECT id, iep_goal_text FROM skills WHERE id = $1 LIMIT 1`, [skillId]);
  if (skill.rowCount === 0) {
    throw new Error("Unknown skill_id.");
  }
  const currentText = skill.rows[0].iep_goal_text ?? "";
  const beforeValue = { current: currentText };
  const afterValue = { skill_id: skillId, proposed };

  const actionId = await insertActionRow(query, {
    agent_run_id: ctx.agentRunId,
    action_type: "iep_goal_update",
    target: `skills:iep_goal_text:${skillId}`,
    before_value: beforeValue,
    after_value: afterValue,
    rationale,
    requires_approval: true,
    approved: null,
    applied: false,
  });

  return {
    ok: true,
    pending_parent_approval: true,
    action_id: actionId,
    message:
      "IEP goal update proposed. Parent must approve in Agent Activity before skills.iep_goal_text changes.",
  };
};

export const handleProposeLevelOverride = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  const skillId = Number(input.skill_id);
  if (!Number.isInteger(skillId) || skillId < 1) {
    throw new Error("skill_id must be a positive integer.");
  }
  const newLevel = Number(input.new_level);
  if (!Number.isInteger(newLevel) || newLevel < 1 || newLevel > 10) {
    throw new Error("new_level must be an integer from 1 to 10.");
  }
  const rationale =
    typeof input.rationale === "string" ? input.rationale.trim().slice(0, 4000) : "";

  const ssl = await query(
    `
      SELECT level
      FROM student_skill_levels
      WHERE student_id = $1::uuid AND skill_id = $2
      LIMIT 1
    `,
    [studentId, skillId],
  );
  if (ssl.rowCount === 0) {
    throw new Error("No student_skill_levels row for this student and skill.");
  }
  const currentLevel = Number(ssl.rows[0].level);
  if (!Number.isFinite(currentLevel)) {
    throw new Error("Could not read current level.");
  }

  const beforeValue = { current: currentLevel };
  const afterValue = { student_id: studentId, skill_id: skillId, proposed: newLevel };

  const actionId = await insertActionRow(query, {
    agent_run_id: ctx.agentRunId,
    action_type: "level_override",
    target: `student_skill_levels:${skillId}`,
    before_value: beforeValue,
    after_value: afterValue,
    rationale,
    requires_approval: true,
    approved: null,
    applied: false,
  });

  return {
    ok: true,
    pending_parent_approval: true,
    action_id: actionId,
    message:
      "Level override proposed. Parent must approve in Agent Activity before student_skill_levels updates.",
  };
};

export const handleFlagIepConcern = async (input, ctx) => {
  const studentId = assertUuid(input.student_id, "student_id");
  let skillId = null;
  if (input.skill_name !== undefined && input.skill_name !== null && input.skill_name !== "") {
    const r = await resolveSkillId(query, input.skill_name);
    skillId = r.skillId;
  }
  const concernText =
    typeof input.concern_text === "string" ? input.concern_text.trim().slice(0, 4000) : "";
  if (concernText.length < 4) {
    throw new Error("concern_text must be at least 4 characters.");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actionId = await insertActionRow(client, {
      agent_run_id: ctx.agentRunId,
      action_type: "flag_iep_concern",
      target: "iep_concern_flags:pending",
      before_value: null,
      after_value: { student_id: studentId, pending: true },
      rationale: concernText,
      requires_approval: false,
      approved: true,
      applied: false,
    });

    const flagResult = await client.query(
      `
        INSERT INTO iep_concern_flags (student_id, skill_id, concern_text)
        VALUES ($1::uuid, $2::int, $3)
        RETURNING id
      `,
      [studentId, skillId, concernText],
    );
    const flagId = flagResult.rows[0].id;

    await client.query(
      `
        UPDATE agent_actions
        SET
          target = $2,
          after_value = $3::jsonb,
          applied = TRUE,
          applied_at = NOW()
        WHERE id = $1::uuid
      `,
      [
        actionId,
        `iep_concern_flags:${flagId}`,
        JSON.stringify({
          student_id: studentId,
          concern_id: flagId,
          skill_id: skillId,
          concern_text: concernText,
        }),
      ],
    );

    await client.query("COMMIT");
    return { ok: true, action_id: actionId, concern_id: flagId };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

const AGENT_NOTE_TYPES = new Set(["observation", "flag", "suggestion"]);

export const handleWriteAgentNote = async (input, ctx) => {
  const fromAgentId = ctx?.agentId;
  if (typeof fromAgentId !== "number" || !Number.isInteger(fromAgentId) || fromAgentId < 1) {
    throw new Error("Agent context missing for write_agent_note.");
  }
  const noteType =
    typeof input.note_type === "string" ? input.note_type.trim().toLowerCase() : "";
  if (!AGENT_NOTE_TYPES.has(noteType)) {
    throw new Error("note_type must be observation, flag, or suggestion.");
  }
  const content = input.content;
  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("content must be a JSON object.");
  }
  let toAgentId = null;
  if (input.to_agent_id !== undefined && input.to_agent_id !== null) {
    const n = Number(input.to_agent_id);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("to_agent_id must be a positive integer or null for broadcast.");
    }
    toAgentId = n;
  }
  const r = await query(
    `
      INSERT INTO agent_notes (from_agent_id, to_agent_id, note_type, content)
      VALUES ($1::int, $2::int, $3, $4::jsonb)
      RETURNING id
    `,
    [fromAgentId, toAgentId, noteType, JSON.stringify(content)],
  );
  return { success: true, id: r.rows[0].id };
};

const actionToolHandlers = {
  propose_tuning_change: handleProposeTuningChange,
  propose_iep_goal_update: handleProposeIepGoalUpdate,
  propose_level_override: handleProposeLevelOverride,
  curate_queue: handleCurateQueue,
  request_new_items: handleRequestNewItems,
  update_frustration_signals: handleUpdateFrustrationSignals,
  write_weekly_insight: handleWriteWeeklyInsight,
  flag_iep_concern: handleFlagIepConcern,
  write_agent_note: handleWriteAgentNote,
};

export const runActionTool = async (name, input, ctx) => {
  const handler = actionToolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown action tool: ${name}`);
  }
  return handler(input ?? {}, ctx);
};

export const actionToolSchemas = [
  {
    name: "propose_tuning_change",
    description:
      "Propose changing one student_tuning parameter. Requires parent approval before applying.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        parameter_name: {
          type: "string",
          enum: [
            "tier_advance_accuracy",
            "tier_advance_response_time",
            "session_item_count",
            "frustration_wrong_threshold",
            "frustration_time_threshold",
          ],
        },
        new_value: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["student_id", "parameter_name", "new_value", "rationale"],
    },
  },
  {
    name: "curate_queue",
    description:
      "Replace the cached next_session_queue for one skill with ordered item UUIDs (applied immediately).",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_name: { type: "string", enum: ["reading", "math", "spelling", "typing"] },
        item_ids: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
      required: ["student_id", "skill_name", "item_ids"],
    },
  },
  {
    name: "request_new_items",
    description:
      "Ask the content pipeline to ensure more generated items exist for a skill/level.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_name: { type: "string", enum: ["reading", "math", "spelling", "typing"] },
        level: { type: "integer" },
        topic: { type: "string" },
        count: { type: "integer" },
      },
      required: ["student_id", "skill_name", "level", "count"],
    },
  },
  {
    name: "update_frustration_signals",
    description:
      "Store a learned frustration precursor as a student_tuning row frustration_signal:{type}.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        signal_type: { type: "string" },
        threshold: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["student_id", "signal_type", "threshold"],
    },
  },
  {
    name: "write_weekly_insight",
    description: "Upsert the weekly_insights row for a week (UTC Monday week_start).",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        week_start: { type: "string", description: "YYYY-MM-DD Monday UTC; omit for current week" },
        insight_text: { type: "string" },
        suggested_adjustment: { type: "string" },
      },
      required: ["student_id"],
    },
  },
  {
    name: "flag_iep_concern",
    description: "Insert a parent-visible IEP concern flag.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_name: { type: "string", enum: ["reading", "math", "spelling", "typing"] },
        concern_text: { type: "string" },
      },
      required: ["student_id", "concern_text"],
    },
  },
  {
    name: "propose_iep_goal_update",
    description:
      "Propose updating skills.iep_goal_text for one skill to align with the uploaded IEP. Requires parent approval.",
    input_schema: {
      type: "object",
      properties: {
        skill_id: { type: "integer", description: "skills.id" },
        proposed_goal_text: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["skill_id", "proposed_goal_text", "rationale"],
    },
  },
  {
    name: "propose_level_override",
    description:
      "Propose changing student_skill_levels.level for one skill. Requires parent approval; use only when performance clearly warrants it.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        skill_id: { type: "integer" },
        new_level: { type: "integer", description: "1–10" },
        rationale: { type: "string" },
      },
      required: ["student_id", "skill_id", "new_level", "rationale"],
    },
  },
  {
    name: "write_agent_note",
    description:
      "Write a note to a specific agent by id, or broadcast (to_agent_id null) for all agents to read.",
    input_schema: {
      type: "object",
      properties: {
        to_agent_id: {
          type: "integer",
          description: "Target agents.id; omit for broadcast to all agents",
        },
        note_type: { type: "string", enum: ["observation", "flag", "suggestion"] },
        content: { type: "object", description: "Structured note payload (JSON object)" },
      },
      required: ["note_type", "content"],
    },
  },
];
