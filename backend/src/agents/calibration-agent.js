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
  "propose_tuning_change",
];

export const runCalibrationAgent = async (studentId) => {
  const systemPrompt = await loadPromptFile("calibration.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const userMessage = buildKickoff(
    studentId,
    "Run a calibration pass for the last 14 days. Use propose_tuning_change for evidence-backed adjustments only; each proposal must stay within min/max and needs parent approval.",
  );
  return runAgentConversation({
    agentName: "calibration",
    studentId,
    tools,
    allowedToolNames,
    systemPrompt,
    userMessage,
  });
};
