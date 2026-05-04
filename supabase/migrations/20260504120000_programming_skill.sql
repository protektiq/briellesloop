-- Introductory programming / computational thinking skill with adaptive scaffolding (tuning-driven).

INSERT INTO skills (name, iep_goal_text, iep_target_pct)
VALUES (
  'programming',
  'Supplemental goal: age-appropriate computational thinking and intro programming concepts (patterns, sequencing, simple logic) at 75% accuracy on in-app checks. Does not replace formal CS curriculum.',
  75
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
  ON sk.name = 'programming'
WHERE NOT EXISTS (
  SELECT 1
  FROM student_skill_levels ssl
  WHERE ssl.student_id = s.id
    AND ssl.skill_id = sk.id
);

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
  'programming_scaffolding',
  1.00,
  1.00,
  1.00,
  5.00,
  NOW(),
  NULL
FROM students s
WHERE NOT EXISTS (
  SELECT 1
  FROM student_tuning st
  WHERE st.student_id = s.id
    AND st.parameter_name = 'programming_scaffolding'
);

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
  'session_item_count_programming',
  2.00,
  2.00,
  1.00,
  3.00,
  NOW(),
  NULL
FROM students s
WHERE NOT EXISTS (
  SELECT 1
  FROM student_tuning st
  WHERE st.student_id = s.id
    AND st.parameter_name = 'session_item_count_programming'
);
