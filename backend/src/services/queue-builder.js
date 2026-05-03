import { query } from "../db.js";
import { normalizeSkillsTableId } from "../utils/postgres-ids.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertUuid = (value, label) => {
  if (typeof value !== "string" || !UUID_REGEX.test(value.trim())) {
    throw new Error(`${label} must be a valid UUID.`);
  }

  return value.trim();
};

const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${label} must be an integer between 1 and 100.`);
  }
};

const normalizeItemRow = (row) => ({
  item_id: row.item_id,
  skill_id: row.skill_id,
  level: row.level,
  item_type: row.item_type,
  prompt: row.prompt,
  answer: row.answer,
  metadata: row.metadata,
  tier: row.tier ?? 0,
  next_review_at: row.next_review_at,
});

const getRatioTargets = (count) => {
  const targets = [
    { name: "review", ratio: 0.6, raw: count * 0.6 },
    { name: "learning", ratio: 0.25, raw: count * 0.25 },
    { name: "new", ratio: 0.15, raw: count * 0.15 },
  ].map((entry) => ({
    ...entry,
    floor: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));

  let assigned = targets.reduce((sum, entry) => sum + entry.floor, 0);
  const sortedByRemainder = [...targets].sort((a, b) => b.remainder - a.remainder);

  for (let index = 0; assigned < count; index += 1) {
    sortedByRemainder[index % sortedByRemainder.length].floor += 1;
    assigned += 1;
  }

  return {
    review: targets.find((entry) => entry.name === "review").floor,
    learning: targets.find((entry) => entry.name === "learning").floor,
    new: targets.find((entry) => entry.name === "new").floor,
  };
};

const pullItems = (pool, amount) => {
  if (amount <= 0 || pool.length === 0) {
    return [];
  }
  return pool.splice(0, amount);
};

const tableExists = async (tableName) => {
  const result = await query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(result.rows[0]?.table_name);
};

const getCachedQueueIfAvailable = async (studentId, skillId, count) => {
  const exists = await tableExists("public.next_session_queue");
  if (!exists) {
    return [];
  }

  // Keep this query permissive because the cache schema will evolve later.
  let cachedResult;
  try {
    cachedResult = await query(
      `
        SELECT item_id, queue_order
        FROM next_session_queue
        WHERE student_id = $1
          AND skill_id = $2
        ORDER BY queue_order ASC
        LIMIT $3
      `,
      [studentId, skillId, count],
    );
  } catch {
    return [];
  }

  if (cachedResult.rowCount === 0) {
    return [];
  }

  const orderedItemIds = cachedResult.rows
    .map((row) => row.item_id)
    .filter((value) => typeof value === "string");

  if (orderedItemIds.length === 0) {
    return [];
  }

  const itemRowsResult = await query(
    `
      SELECT
        i.id AS item_id,
        i.skill_id,
        i.level,
        i.item_type,
        i.prompt,
        i.answer,
        i.metadata,
        COALESCE(im.tier, 0) AS tier,
        im.next_review_at
      FROM items i
      LEFT JOIN item_mastery im
        ON im.item_id = i.id
       AND im.student_id = $1
      WHERE i.id = ANY($2::uuid[])
      ORDER BY array_position($2::uuid[], i.id)
    `,
    [studentId, orderedItemIds],
  );

  return itemRowsResult.rows.map(normalizeItemRow);
};

const queryPool = async (studentId, skillId, tierFilter, limit) => {
  const result = await query(
    `
      SELECT
        i.id AS item_id,
        i.skill_id,
        i.level,
        i.item_type,
        i.prompt,
        i.answer,
        i.metadata,
        im.tier,
        im.next_review_at
      FROM item_mastery im
      INNER JOIN items i
        ON i.id = im.item_id
      WHERE im.student_id = $1
        AND i.skill_id = $2
        AND im.tier = ANY($3::int[])
        AND (im.next_review_at IS NULL OR im.next_review_at <= NOW())
      ORDER BY im.next_review_at ASC NULLS FIRST, im.tier DESC, i.created_at ASC
      LIMIT $4
    `,
    [studentId, skillId, tierFilter, limit],
  );

  return result.rows.map(normalizeItemRow);
};

const queryNewPool = async (studentId, skillId, limit) => {
  // Prefer AI-generated items over placeholder seed rows; among AI items, prefer
  // the freshest. Placeholders rank last so they only appear if there aren't
  // enough real items.
  const result = await query(
    `
      SELECT
        i.id AS item_id,
        i.skill_id,
        i.level,
        i.item_type,
        i.prompt,
        i.answer,
        i.metadata,
        COALESCE(im.tier, 0) AS tier,
        im.next_review_at
      FROM items i
      LEFT JOIN item_mastery im
        ON im.item_id = i.id
       AND im.student_id = $1
      WHERE i.skill_id = $2
        AND (im.item_id IS NULL OR im.tier = 0)
        AND NOT (
          i.item_type = 'writing_prompt'
          AND COALESCE(i.metadata ->> 'kind', '') = 'template'
        )
      ORDER BY
        CASE
          WHEN i.metadata ->> 'seed_source' = '006_item_seed' THEN 1
          ELSE 0
        END ASC,
        i.ai_generated DESC,
        i.created_at DESC
      LIMIT $3
    `,
    [studentId, skillId, limit],
  );

  return result.rows.map(normalizeItemRow);
};

export const buildSessionQueue = async (studentId, skillId, count) => {
  const safeStudentId = assertUuid(studentId, "studentId");
  const safeSkillId = normalizeSkillsTableId(skillId, "skillId");
  assertPositiveInteger(count, "count");

  const cachedQueue = await getCachedQueueIfAvailable(safeStudentId, safeSkillId, count);
  if (cachedQueue.length > 0) {
    return cachedQueue.slice(0, count);
  }

  const ratioTargets = getRatioTargets(count);
  const reviewPool = await queryPool(safeStudentId, safeSkillId, [3, 4], count * 2);
  const learningPool = await queryPool(safeStudentId, safeSkillId, [1, 2], count * 2);
  const newPool = await queryNewPool(safeStudentId, safeSkillId, count * 2);

  const queue = [
    ...pullItems(reviewPool, ratioTargets.review),
    ...pullItems(learningPool, ratioTargets.learning),
    ...pullItems(newPool, ratioTargets.new),
  ];

  const fallbackPools = [reviewPool, learningPool, newPool];
  while (queue.length < count && fallbackPools.some((pool) => pool.length > 0)) {
    for (const pool of fallbackPools) {
      if (queue.length >= count) {
        break;
      }
      const nextItem = pool.shift();
      if (nextItem) {
        queue.push(nextItem);
      }
    }
  }

  return queue.slice(0, count);
};
