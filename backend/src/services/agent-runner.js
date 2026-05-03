import { randomUUID } from "node:crypto";
import { claudeClient, claudeModel } from "./claude.js";
import { query } from "../db.js";
import { runDbTool, isDbToolName } from "../agents/tools/db-tools.js";
import { runActionTool } from "../agents/tools/action-tools.js";

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_AGENT_STEPS = 36;

/** @type {Set<string>} */
const DRY_RUN_WRITE_TOOLS = new Set([
  "propose_tuning_change",
  "curate_queue",
  "request_new_items",
  "update_frustration_signals",
  "write_weekly_insight",
  "flag_iep_concern",
  "propose_iep_goal_update",
  "propose_level_override",
  "write_agent_note",
]);

/** Claude Sonnet-class approximate pricing ($/token) — aligns with PRD cost tracking; tune via env if needed */
const INPUT_USD_PER_TOKEN = Number(process.env.ANTHROPIC_INPUT_USD_PER_TOKEN ?? 3 / 1_000_000);
const OUTPUT_USD_PER_TOKEN = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_TOKEN ?? 15 / 1_000_000);

const estimateCostUsd = (usage) => {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  return input * INPUT_USD_PER_TOKEN + output * OUTPUT_USD_PER_TOKEN;
};

const summarizeObservations = (entries) => ({
  tool_calls: entries.slice(-40),
});

/**
 * Runs a Claude tool-use loop for one agent, logging agent_runs.
 * @param {object} params
 * @param {string} params.agentName - agents.name (calibration|content|frustration|insight|curriculum)
 * @param {string} params.studentId - UUID
 * @param {import('@anthropic-ai/sdk').Tool[]} params.tools
 * @param {Set<string>} params.allowedToolNames
 * @param {string} params.systemPrompt
 * @param {string} params.userMessage
 * @param {boolean} [params.dryRun]
 * @param {string} [params.simulationStart] - ISO timestamptz, inclusive
 * @param {string} [params.simulationEnd] - ISO timestamptz, exclusive
 */
export const runAgentConversation = async ({
  agentName,
  studentId,
  tools,
  allowedToolNames,
  systemPrompt,
  userMessage,
  dryRun = false,
  simulationStart,
  simulationEnd,
}) => {
  const agentRow = await query(`SELECT id FROM agents WHERE name = $1 LIMIT 1`, [agentName]);
  if (agentRow.rowCount === 0) {
    throw new Error(`Unknown agent: ${agentName}`);
  }
  const agentId = agentRow.rows[0].id;

  const runInsert = await query(
    `
      INSERT INTO agent_runs (agent_id, status, observations, reasoning, dry_run)
      VALUES ($1::int, 'running', '{}'::jsonb, '', $2::boolean)
      RETURNING id
    `,
    [agentId, dryRun],
  );
  const agentRunId = runInsert.rows[0].id;

  const ctx = {
    agentRunId,
    agentId,
    studentId,
    agentName,
    dryRun,
    simulationStart: typeof simulationStart === "string" ? simulationStart : undefined,
    simulationEnd: typeof simulationEnd === "string" ? simulationEnd : undefined,
  };

  let messages = [
    {
      role: "user",
      content: userMessage,
    },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  const reasoningParts = [];
  const observationLog = [];
  /** @type {{ tool: string, input: object, result: object }[]} */
  const simulatedActions = [];

  const executeTool = async (name, rawInput) => {
    if (!allowedToolNames.has(name)) {
      throw new Error(`Tool ${name} is not enabled for this agent.`);
    }
    let parsedInput = rawInput;
    if (typeof rawInput === "string") {
      try {
        parsedInput = JSON.parse(rawInput);
      } catch {
        parsedInput = {};
      }
    }
    if (typeof parsedInput !== "object" || parsedInput === null) {
      parsedInput = {};
    }
    if (dryRun && DRY_RUN_WRITE_TOOLS.has(name)) {
      const id = randomUUID();
      const result = { success: true, id, dry_run: true };
      simulatedActions.push({ tool: name, input: parsedInput, result });
      observationLog.push({ tool: name, ok: true, dry_run: true });
      return result;
    }
    if (isDbToolName(name)) {
      const out = await runDbTool(name, parsedInput, ctx);
      observationLog.push({ tool: name, ok: true });
      return out;
    }
    const out = await runActionTool(name, parsedInput, ctx);
    observationLog.push({
      tool: name,
      ok: true,
      summary: typeof out?.message === "string" ? out.message : null,
    });
    return out;
  };

  let lastError = null;

  try {
    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const response = await claudeClient.messages.create(
        {
          model: claudeModel,
          max_tokens: 8192,
          system: systemPrompt,
          tools,
          messages,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      totalInput += response.usage?.input_tokens ?? 0;
      totalOutput += response.usage?.output_tokens ?? 0;

      const parts = Array.isArray(response.content) ? response.content : [];
      for (const block of parts) {
        if (block.type === "text" && typeof block.text === "string") {
          reasoningParts.push(block.text);
        }
      }

      const toolUses = parts.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) {
        if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
          break;
        }
        break;
      }

      const toolResultBlocks = [];
      for (const tu of toolUses) {
        const id = tu.id;
        const name = tu.name;
        let payload = tu.input;
        try {
          const result = await executeTool(name, payload);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: id,
            content: JSON.stringify(result ?? {}),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: id,
            is_error: true,
            content: msg.slice(0, 8000),
          });
        }
      }

      messages = [...messages, { role: "assistant", content: parts }, { role: "user", content: toolResultBlocks }];
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    reasoningParts.push(`\n[agent error] ${lastError}`);
  }

  const reasoning = reasoningParts.join("\n").trim().slice(0, 120_000);
  const tokensUsed = totalInput + totalOutput;
  const costUsd = estimateCostUsd({
    input_tokens: totalInput,
    output_tokens: totalOutput,
  });

  const finalStatus = lastError ? "failed" : dryRun ? "simulation" : "completed";

  await query(
    `
      UPDATE agent_runs
      SET
        ended_at = NOW(),
        status = $2,
        error_message = $3,
        observations = $4::jsonb,
        reasoning = $5,
        tokens_used = $6::int,
        cost_usd = $7::decimal,
        dry_run = $8::boolean
      WHERE id = $1::uuid
    `,
    [
      agentRunId,
      finalStatus,
      lastError,
      JSON.stringify(summarizeObservations(observationLog)),
      reasoning || null,
      tokensUsed,
      costUsd.toFixed(6),
      dryRun,
    ],
  );

  if (!dryRun) {
    await query(`UPDATE agents SET last_run_at = NOW() WHERE id = $1::int`, [agentId]);
  }

  if (lastError) {
    throw new Error(lastError);
  }

  const base = {
    agent_run_id: agentRunId,
    tokens_used: tokensUsed,
    cost_usd: Number(costUsd.toFixed(6)),
  };
  if (dryRun) {
    return { ...base, simulated_actions: simulatedActions };
  }
  return base;
};
