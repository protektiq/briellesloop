-- Lower the default math/session item count to 5 (matches the desktop mockup and
-- the FR-3 "starting at 5 with tuning-driven adjustment" decision in PRD §10).
-- Idempotent: re-running this migration is a no-op if the values already match.
UPDATE student_tuning
SET current_value = 5.00,
    default_value = 5.00,
    min_value = 3.00,
    max_value = 10.00,
    last_changed_at = NOW()
WHERE parameter_name = 'session_item_count';
