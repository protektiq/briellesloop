import { query } from "../db.js";
import {
  buildKickoff,
  loadPromptFile,
  pickToolSchemas,
  runAgentConversation,
} from "./agent-common.js";

const TOOL_NAMES = [
  "query_iep_document",
  "query_iep_goals",
  "query_skill_trends",
  "query_week_summary",
  "read_agent_notes",
  "propose_iep_goal_update",
  "propose_level_override",
  "write_agent_note",
];

export const runCurriculumAgent = async (studentId, opts = {}) => {
  const { dryRun, simulationStart, simulationEnd } = opts;
  const docCheck = await query(
    `
      SELECT 1
      FROM iep_documents
      WHERE student_id = $1::uuid AND active = TRUE
      LIMIT 1
    `,
    [studentId],
  );
  if (docCheck.rowCount === 0) {
    console.log("No IEP document uploaded; skipping run");
    return { skipped: true, reason: "no_iep_document" };
  }

  const systemPrompt = await loadPromptFile("curriculum.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const simHint =
    dryRun && simulationStart && simulationEnd
      ? ` SIMULATION: use only data in [${simulationStart}, ${simulationEnd}) UTC; writes are mocked.`
      : "";
  const userMessage = buildKickoff(
    studentId,
    `Compare the uploaded IEP text to query_iep_goals and recent performance (query_skill_trends, query_week_summary). Be conservative: note uncertainty rather than guessing. Use propose_iep_goal_update or propose_level_override only when the IEP text or data clearly supports a change; every rationale must state that the parent must approve before anything applies.${simHint}`,
  );
  return runAgentConversation({
    agentName: "curriculum",
    studentId,
    tools,
    allowedToolNames,
    systemPrompt,
    userMessage,
    dryRun: Boolean(dryRun),
    simulationStart: dryRun ? simulationStart : undefined,
    simulationEnd: dryRun ? simulationEnd : undefined,
  });
};
