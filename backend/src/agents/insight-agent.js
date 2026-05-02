import {
  buildKickoff,
  loadPromptFile,
  pickToolSchemas,
  runAgentConversation,
} from "./agent-common.js";

const TOOL_NAMES = [
  "query_week_summary",
  "query_skill_trends",
  "query_iep_alignment",
  "query_recent_reflections",
  "query_other_agent_activity",
  "query_recent_attempts",
  "query_brain_break_history",
  "write_weekly_insight",
  "flag_iep_concern",
];

export const runInsightAgent = async (studentId) => {
  const systemPrompt = await loadPromptFile("insight.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const userMessage = buildKickoff(
    studentId,
    "Run the weekly insight workflow: gather data with read tools, then call write_weekly_insight for the current UTC week. Use flag_iep_concern only when a skill is clearly below IEP expectations across multiple weeks.",
  );
  return runAgentConversation({
    agentName: "insight",
    studentId,
    tools,
    allowedToolNames,
    systemPrompt,
    userMessage,
  });
};
