import cron from "node-cron";
import { query } from "../db.js";
import { resolveStudentId } from "./student-resolve.js";
import { runCalibrationAgent } from "../agents/calibration-agent.js";
import { runContentAgent } from "../agents/content-agent.js";
import { runFrustrationAgent } from "../agents/frustration-agent.js";
import { runInsightAgent } from "../agents/insight-agent.js";

const RUNNERS = {
  calibration: runCalibrationAgent,
  content: runContentAgent,
  frustration: runFrustrationAgent,
  insight: runInsightAgent,
};

const parseStudentIdQuery = (queryValue) => {
  if (typeof queryValue !== "string" || queryValue.trim().length === 0) {
    return undefined;
  }
  return queryValue;
};

export const scheduleAgentCronJobs = () => {
  const enabled = process.env.AGENT_SYSTEM_ENABLED !== "false";
  if (!enabled) {
    console.log("[agents] Cron scheduling skipped (AGENT_SYSTEM_ENABLED=false).");
    return;
  }

  let scheduled = 0;

  (async () => {
    try {
      const studentId = await resolveStudentId();
      if (!studentId) {
        console.warn("[agents] No student found; skipping cron registration.");
        return;
      }

      const result = await query(
        `SELECT name, schedule_cron, enabled FROM agents ORDER BY id`,
      );

      for (const row of result.rows) {
        if (row.enabled !== true) {
          continue;
        }
        const name = String(row.name);
        const expr = String(row.schedule_cron ?? "").trim();
        const runner = RUNNERS[name];
        if (!runner || !expr) {
          continue;
        }
        if (!cron.validate(expr)) {
          console.warn(`[agents] Invalid cron for ${name}: ${expr}`);
          continue;
        }
        cron.schedule(expr, () => {
          runner(studentId).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[agents] Scheduled run failed (${name}):`, msg);
          });
        });
        scheduled += 1;
        console.log(`[agents] Registered cron for ${name}: ${expr}`);
      }

      if (scheduled === 0) {
        console.log("[agents] No enabled agents with valid cron in database.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[agents] Failed to register cron:", msg);
    }
  })();
};

export const dispatchManualAgentRun = async (agentName, studentIdFromQuery) => {
  const runner = RUNNERS[agentName];
  if (!runner) {
    throw new Error(`Unknown agent: ${agentName}`);
  }
  const studentId =
    (await resolveStudentId(parseStudentIdQuery(studentIdFromQuery))) ??
    (await resolveStudentId());
  if (!studentId) {
    throw new Error("No student found.");
  }
  return runner(studentId);
};
