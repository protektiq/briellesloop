import { query } from '../db.js'

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const SAFE_SKILL_NAME_REGEX = /^[a-z]{2,24}$/

const normalizeSkillName = (value) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  if (!SAFE_SKILL_NAME_REGEX.test(trimmed)) {
    return null
  }

  return trimmed
}

const hasSuggestedSkillColumn = async () => {
  const columnResult = await query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'suggested_skill'
      ) AS has_column
    `,
  )

  return columnResult.rows[0]?.has_column === true
}

const getAgentSuggestedSkill = async (studentId) => {
  const hasColumn = await hasSuggestedSkillColumn()
  if (!hasColumn) {
    return null
  }

  const suggestionResult = await query(
    `
      SELECT suggested_skill
      FROM students
      WHERE id = $1
      LIMIT 1
    `,
    [studentId],
  )

  return normalizeSkillName(suggestionResult.rows[0]?.suggested_skill ?? null)
}

export const getSuggestedSkill = async (studentId) => {
  if (!isUuid(studentId)) {
    return 'reading'
  }

  // TODO(PRD §11.2.1): Replace this v1 heuristic with Content Agent output once Task 12 writes canonical suggestions.
  const agentSuggestedSkill = await getAgentSuggestedSkill(studentId)
  if (agentSuggestedSkill) {
    return agentSuggestedSkill
  }

  const lowestAccuracyResult = await query(
    `
      SELECT s.name
      FROM student_skill_levels ssl
      JOIN skills s ON s.id = ssl.skill_id
      WHERE ssl.student_id = $1
      ORDER BY
        CASE WHEN ssl.current_accuracy IS NULL THEN 1 ELSE 0 END ASC,
        ssl.current_accuracy ASC,
        s.name ASC
      LIMIT 1
    `,
    [studentId],
  )

  const lowestAccuracySkill = normalizeSkillName(lowestAccuracyResult.rows[0]?.name ?? null)
  if (lowestAccuracySkill) {
    return lowestAccuracySkill
  }

  const dueItemsResult = await query(
    `
      SELECT s.name, COUNT(*)::INT AS due_count
      FROM item_mastery im
      JOIN items i ON i.id = im.item_id
      JOIN skills s ON s.id = i.skill_id
      WHERE im.student_id = $1
        AND im.next_review_at IS NOT NULL
        AND im.next_review_at <= NOW()
      GROUP BY s.name
      ORDER BY due_count DESC, s.name ASC
      LIMIT 1
    `,
    [studentId],
  )

  return normalizeSkillName(dueItemsResult.rows[0]?.name ?? null) ?? 'reading'
}
