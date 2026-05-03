import {
  buildKickoff,
  loadPromptFile,
  pickToolSchemas,
  runAgentConversation,
} from "./agent-common.js";

const TOOL_NAMES = [
  "query_due_items",
  "query_recent_misses",
  "query_interests",
  "query_iep_goals",
  "read_agent_notes",
  "curate_queue",
  "request_new_items",
  "write_agent_note",
];

export const runContentAgent = async (studentId, opts = {}) => {
  const { dryRun, simulationStart, simulationEnd } = opts;
  const systemPrompt = await loadPromptFile("content.md");
  const tools = pickToolSchemas(TOOL_NAMES);
  const allowedToolNames = new Set(TOOL_NAMES);
  const simHint =
    dryRun && simulationStart && simulationEnd
      ? ` SIMULATION: use only data in [${simulationStart}, ${simulationEnd}) UTC; writes are mocked.`
      : "";
  const userMessage = buildKickoff(
    studentId,
    `Prepare next-session queue caches: for each core skill (reading, math, spelling, typing), query due items and misses, then curate_queue with real item UUIDs only. If pools are thin, request_new_items with small counts.${simHint}`,
  );
  return runAgentConversation({
    agentName: "content",
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
