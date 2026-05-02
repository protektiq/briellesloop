-- FR-16: idempotent weekly skill-level drop (at most one drop per UTC calendar week per skill).
ALTER TABLE student_skill_levels
ADD COLUMN IF NOT EXISTS last_weekly_drop_week_start DATE;

COMMENT ON COLUMN student_skill_levels.last_weekly_drop_week_start IS
  'UTC Monday of the calendar week when an FR-16 accuracy-based level drop was last applied for this skill.';
