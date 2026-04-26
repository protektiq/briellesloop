WITH target_skills AS (
  SELECT id, name
  FROM skills
  WHERE name IN ('reading', 'math', 'spelling', 'typing')
),
generated_items AS (
  SELECT
    ts.id AS skill_id,
    ts.name AS skill_name,
    gs.item_number,
    CONCAT(UPPER(SUBSTRING(ts.name, 1, 1)), SUBSTRING(ts.name FROM 2), ' placeholder item ', gs.item_number) AS prompt_text,
    CONCAT('Placeholder answer ', gs.item_number) AS answer_text
  FROM target_skills ts
  CROSS JOIN generate_series(1, 50) AS gs(item_number)
)
INSERT INTO items (
  skill_id,
  level,
  item_type,
  prompt,
  answer,
  metadata,
  ai_generated
)
SELECT
  gi.skill_id,
  1,
  'practice',
  jsonb_build_object('text', gi.prompt_text),
  jsonb_build_object('text', gi.answer_text),
  jsonb_build_object('seed_source', '006_item_seed', 'skill', gi.skill_name),
  FALSE
FROM generated_items gi
WHERE NOT EXISTS (
  SELECT 1
  FROM items i
  WHERE i.skill_id = gi.skill_id
    AND i.level = 1
    AND i.prompt ->> 'text' = gi.prompt_text
);

WITH student_rows AS (
  SELECT id
  FROM students
)
INSERT INTO student_tuning (
  student_id,
  parameter_name,
  current_value,
  default_value,
  min_value,
  max_value,
  last_changed_at,
  changed_by_agent
)
SELECT
  student_rows.id,
  'weekly_drop_accuracy',
  60.00::DECIMAL(8,2),
  60.00::DECIMAL(8,2),
  40.00::DECIMAL(8,2),
  90.00::DECIMAL(8,2),
  NOW(),
  NULL
FROM student_rows
ON CONFLICT (student_id, parameter_name) DO NOTHING;
