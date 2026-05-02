-- Less frequent "need a break?" prompts: default slow-item threshold 60s -> 180s; allow tuning up to 600s.
UPDATE student_tuning
SET max_value = 600.00::DECIMAL(8,2)
WHERE parameter_name = 'frustration_time_threshold'
  AND max_value < 600.00::DECIMAL(8,2);

UPDATE student_tuning
SET
  current_value = 180.00::DECIMAL(8,2),
  default_value = 180.00::DECIMAL(8,2)
WHERE parameter_name = 'frustration_time_threshold'
  AND current_value = 60.00::DECIMAL(8,2)
  AND default_value = 60.00::DECIMAL(8,2);
