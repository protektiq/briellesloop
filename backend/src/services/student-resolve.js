import { query } from "../db.js";

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseUuidFromInput = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!UUID_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

export const resolveStudentId = async (studentIdFromQuery) => {
  const validatedStudentId = parseUuidFromInput(studentIdFromQuery);
  if (validatedStudentId) {
    return validatedStudentId;
  }

  const studentResult = await query(
    `
      SELECT id
      FROM students
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );

  return studentResult.rows[0]?.id ?? null;
};
