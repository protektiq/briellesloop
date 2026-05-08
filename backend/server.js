import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { query } from "./src/db.js";
import sessionsRouter from "./src/routes/sessions.js";
import itemsRouter from "./src/routes/items.js";
import aiRouter from "./src/routes/ai.js";
import dashboardRouter from "./src/routes/dashboard.js";
import agentsRouter, { scheduleAgentCronJobs } from "./src/routes/agents.js";
import exportRouter from "./src/routes/export.js";
import settingsRouter from "./src/routes/settings.js";
import studentProfileRouter from "./src/routes/student-profile.js";
import parentRouter from "./src/routes/parent.js";
import shareRouter from "./src/routes/share.js";
import iepRouter from "./src/routes/iep.js";
import ttsRouter from "./src/routes/tts.js";
import { createUrlLengthGuard } from "./src/services/http-security.js";

const app = express();
const rawPort = process.env.PORT ?? "3001";
const port = Number.parseInt(rawPort, 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);
app.use(express.json());
app.use(createUrlLengthGuard(2048));

app.get("/", (_req, res) => {
  res.send("Hello World");
});

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    return res.json({ db: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ db: "error", message });
  }
});

app.use("/api/session", sessionsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/export", exportRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/settings", studentProfileRouter);
app.use("/api/student", studentProfileRouter);
app.use("/api/parent", parentRouter);
app.use("/api/share", shareRouter);
app.use("/api/iep", iepRouter);
app.use("/api/tts", ttsRouter);

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return res.status(500).json({
    error: "InternalServerError",
    message,
  });
});

const startServer = async () => {
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
    const agentFlag = process.env.AGENT_SYSTEM_ENABLED ?? "true";
    console.log(`AGENT_SYSTEM_ENABLED=${agentFlag}`);
    scheduleAgentCronJobs();
  });
};

void startServer();
