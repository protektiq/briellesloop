import {
  buildKickoff,
  loadPromptFile,
  pickToolSchemas,
  runAgentConversation,
} from "./agent-common.js";

const TOOL_NAMES = [
  "query_brain_break_history",
  "query_attempts_before_breaks",
  "query_session_outcomes",
  "query_current_tuning",
  "read_agent_notes",
  "update_frustration_signals",
  "write_agent_note",
];

export const runFrustrationAgent = async (studentId, opts = {}) => {
  const { dryRun, simulationStart, simulationEnd } = opts;
  const systemPrompt = await loadPromptFile("frustration.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const simHint =
    dryRun && simulationStart && simulationEnd
      ? ` SIMULATION: use only data in [${simulationStart}, ${simulationEnd}) UTC; writes are mocked.`
      : "";
  const userMessage = buildKickoff(
    studentId,
    `Analyze roughly the last 4 weeks of breaks and sessions. If you find a repeatable precursor pattern, record one frustration_signal via update_frustration_signals with a justified numeric threshold.${simHint}`,
  );
  return runAgentConversation({
    agentName: "frustration",
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
