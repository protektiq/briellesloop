import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { query } from "./src/db.js";

const app = express();
const rawPort = process.env.PORT ?? "3001";
const port = Number.parseInt(rawPort, 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

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

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
