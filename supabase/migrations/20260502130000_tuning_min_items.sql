-- FR-15: add the cross-item minimum Tier-3 count gate for skill-level advancement.
-- Inserts one tuning row per existing student, without hardcoded UUIDs.
INSERT INTO student_tuning (
  student_id,
  parameter_name,
  current_value,
  default_value,
  min_value,
  max_value
)
SELECT
  s.id,
  'tier_advance_min_items',
  10.00,
  10.00,
  5.00,
  20.00
FROM students s
WHERE NOT EXISTS (
  SELECT 1
  FROM student_tuning st
  WHERE st.student_id = s.id
    AND st.parameter_name = 'tier_advance_min_items'
);
