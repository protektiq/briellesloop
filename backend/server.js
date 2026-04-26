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
import agentsRouter from "./src/routes/agents.js";
import exportRouter from "./src/routes/export.js";

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

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return res.status(500).json({
    error: "InternalServerError",
    message,
  });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
