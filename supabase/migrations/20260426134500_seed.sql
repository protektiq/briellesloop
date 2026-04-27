INSERT INTO skills (name, iep_goal_text)
VALUES
  ('reading', 'Goal 80% accuracy on grade-level texts (main idea, supporting details, inferences)'),
  ('math', 'Goal: complete multi-step word problems accurately without time pressure'),
  ('spelling', 'Focus on multisyllabic words, r-controlled vowels, and variant vowels'),
  ('typing', 'Goal grade-level written expression conventions at 80% accuracy')
ON CONFLICT (name) DO NOTHING;

INSERT INTO students (name, grade, date_of_birth, interests)
VALUES ('Brielle', 5, '2014-12-21', ARRAY['dogs', 'art']);

INSERT INTO agents (name, description, schedule_cron, enabled)
VALUES
  ('calibration', 'Personalizes SRS thresholds from observed performance trends.', '0 2 * * *', TRUE),
  ('content', 'Pre-builds next session queues with deliberate item curation.', '0 3 * * *', TRUE),
  ('frustration', 'Learns personal frustration precursors from session patterns.', '0 1 * * 0', TRUE),
  ('insight', 'Writes weekly parent-facing progress insights and adjustment suggestions.', '0 23 * * 0', TRUE)
ON CONFLICT (name) DO NOTHING;

WITH student_row AS (
  SELECT id
  FROM students
  ORDER BY created_at ASC
  LIMIT 1
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
  student_row.id,
  tuning.parameter_name,
  tuning.current_value,
  tuning.default_value,
  tuning.min_value,
  tuning.max_value,
  NOW(),
  NULL
FROM student_row
CROSS JOIN (
  VALUES
    ('tier_advance_accuracy', 80.00::DECIMAL(8,2), 80.00::DECIMAL(8,2), 60.00::DECIMAL(8,2), 95.00::DECIMAL(8,2)),
    ('tier_advance_response_time', 30.00::DECIMAL(8,2), 30.00::DECIMAL(8,2), 10.00::DECIMAL(8,2), 90.00::DECIMAL(8,2)),
    ('session_item_count', 5.00::DECIMAL(8,2), 5.00::DECIMAL(8,2), 3.00::DECIMAL(8,2), 10.00::DECIMAL(8,2)),
    ('frustration_wrong_threshold', 2.00::DECIMAL(8,2), 2.00::DECIMAL(8,2), 1.00::DECIMAL(8,2), 5.00::DECIMAL(8,2)),
    ('frustration_time_threshold', 60.00::DECIMAL(8,2), 60.00::DECIMAL(8,2), 20.00::DECIMAL(8,2), 180.00::DECIMAL(8,2))
) AS tuning(parameter_name, current_value, default_value, min_value, max_value);
