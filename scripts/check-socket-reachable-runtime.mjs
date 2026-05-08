import fs from "node:fs";
import path from "node:path";

const readJson = (filePath) => {
  const resolved = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw);
};

const normalizePackageName = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  return value.trim().replace(/^pkg:npm\//, "").split("@")[0];
};

const getScoreRows = (report) => {
  if (Array.isArray(report?.scores)) {
    return report.scores;
  }
  if (Array.isArray(report?.packages)) {
    return report.packages;
  }
  if (Array.isArray(report)) {
    return report;
  }
  return [];
};

const getVulnerabilityScore = (row) => {
  if (typeof row?.vulnerability === "number") {
    return row.vulnerability;
  }
  if (typeof row?.scores?.vulnerability === "number") {
    return row.scores.vulnerability;
  }
  return null;
};

const getPackageName = (row) => {
  return (
    normalizePackageName(row?.package) ||
    normalizePackageName(row?.purl) ||
    normalizePackageName(row?.name) ||
    normalizePackageName(row?.depname)
  );
};

const reportPath = process.env.SOCKET_REPORT_PATH ?? "socket-report.json";
const reachablePath = process.env.REACHABLE_RUNTIME_PATH ?? "security/reachable-runtime-packages.json";
const minScoreRaw = process.env.SOCKET_MIN_VULNERABILITY_SCORE ?? "90";
const minScore = Number.parseInt(minScoreRaw, 10);
if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) {
  throw new Error("SOCKET_MIN_VULNERABILITY_SCORE must be an integer between 1 and 100.");
}

const reachableConfig = readJson(reachablePath);
const reachableList = Array.isArray(reachableConfig?.packages) ? reachableConfig.packages : [];
const reachableRuntime = new Set(reachableList.map((entry) => normalizePackageName(entry?.name)).filter(Boolean));
if (reachableRuntime.size === 0) {
  throw new Error("reachable-runtime-packages.json is empty; cannot enforce Socket policy.");
}

const socketReport = readJson(reportPath);
const rows = getScoreRows(socketReport);
if (rows.length === 0) {
  throw new Error("Socket report did not contain any package scores.");
}

const violating = [];
for (const row of rows) {
  const pkg = getPackageName(row);
  if (!pkg || !reachableRuntime.has(pkg)) {
    continue;
  }
  const vulnerability = getVulnerabilityScore(row);
  if (typeof vulnerability !== "number") {
    violating.push({ pkg, vulnerability: null, reason: "missing vulnerability score" });
    continue;
  }
  if (vulnerability < minScore) {
    violating.push({ pkg, vulnerability, reason: `score below ${minScore}` });
  }
}

if (violating.length > 0) {
  console.error("Socket reachable-runtime vulnerability policy failed:");
  for (const item of violating) {
    console.error(`- ${item.pkg}: ${item.vulnerability ?? "N/A"} (${item.reason})`);
  }
  process.exit(1);
}

console.log(
  `Socket policy passed. Reachable runtime packages checked: ${reachableRuntime.size}. Min vulnerability score: ${minScore}.`,
);
