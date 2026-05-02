import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentConversation } from "../services/agent-runner.js";
import { dbToolSchemas } from "./tools/db-tools.js";
import { actionToolSchemas } from "./tools/action-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "prompts");

export const loadPromptFile = async (filename) => {
  const fullPath = path.resolve(PROMPTS_DIR, filename);
  const text = await fs.readFile(fullPath, "utf8");
  if (typeof text !== "string" || text.trim().length < 40) {
    throw new Error(`Prompt file missing or too short: ${filename}`);
  }
  return text.trim();
};

export const pickToolSchemas = (names) => {
  const set = new Set(names);
  const fromDb = dbToolSchemas.filter((t) => set.has(t.name));
  const fromAct = actionToolSchemas.filter((t) => set.has(t.name));
  const merged = [...fromDb, ...fromAct];
  if (merged.length !== names.length) {
    const got = new Set(merged.map((m) => m.name));
    const missing = names.filter((n) => !got.has(n));
    throw new Error(`Missing tool schemas: ${missing.join(", ")}`);
  }
  return merged;
};

export const buildKickoff = (studentId, body) =>
  `Student UUID for every tool call (student_id): ${studentId}\n\n${body}`;

export { runAgentConversation, dbToolSchemas, actionToolSchemas };
