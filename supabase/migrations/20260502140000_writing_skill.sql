-- Add writing skill and per-student defaults for v3 writing flow.

INSERT INTO skills (name, iep_goal_text, iep_target_pct)
VALUES (
  'writing',
  'Grade-level paragraphs with proper conventions (capitalization, punctuation, sentence variety) at 80% rubric score. SBAC Level 1 -> Level 2 target.',
  70
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO student_skill_levels (student_id, skill_id, level, updated_at)
SELECT
  s.id,
  sk.id,
  1,
  NOW()
FROM students s
INNER JOIN skills sk
  ON sk.name = 'writing'
WHERE NOT EXISTS (
  SELECT 1
  FROM student_skill_levels ssl
  WHERE ssl.student_id = s.id
    AND ssl.skill_id = sk.id
);

-- Writing sessions are one prompt at a time.
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
  s.id,
  'session_item_count_writing',
  1.00,
  1.00,
  1.00,
  3.00,
  NOW(),
  NULL
FROM students s
WHERE NOT EXISTS (
  SELECT 1
  FROM student_tuning st
  WHERE st.student_id = s.id
    AND st.parameter_name = 'session_item_count_writing'
);
