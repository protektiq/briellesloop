import {
  buildKickoff,
  loadPromptFile,
  pickToolSchemas,
  runAgentConversation,
} from "./agent-common.js";

const TOOL_NAMES = [
  "query_recent_attempts",
  "query_skill_progression",
  "query_current_tuning",
  "read_agent_notes",
  "propose_tuning_change",
  "write_agent_note",
];

export const runCalibrationAgent = async (studentId, opts = {}) => {
  const { dryRun, simulationStart, simulationEnd } = opts;
  const systemPrompt = await loadPromptFile("calibration.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const simHint =
    dryRun && simulationStart && simulationEnd
      ? ` SIMULATION: use only data in [${simulationStart}, ${simulationEnd}) UTC; writes are mocked.`
      : "";
  const userMessage = buildKickoff(
    studentId,
    `Run a calibration pass for the last 14 days. Use propose_tuning_change for evidence-backed adjustments only; each proposal must stay within min/max and needs parent approval.${simHint}`,
  );
  return runAgentConversation({
    agentName: "calibration",
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
