import { parseUuidFromInput } from "../../services/student-resolve.js";

export const assertUuid = (value, field) => {
  const id = parseUuidFromInput(typeof value === "string" ? value : "");
  if (!id) {
    throw new Error(`${field} must be a valid UUID string.`);
  }
  return id;
};

export const clampInt = (value, min, max, field) => {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  }
  return n;
};

export const optionalIsoDate = (value, field) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value.trim())) {
    throw new Error(`${field} must be YYYY-MM-DD when provided.`);
  }
  return value.trim();
};
