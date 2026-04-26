const sanitizeText = (value, maxLength = 80) => {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ''
  }

  return trimmed.slice(0, maxLength)
}

const sanitizeInteger = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

const TodayPlanCard = ({ skillName, level, durationMinutes, moodIsSet, onStart, disabled = false }) => {
  const safeSkillName = sanitizeText(skillName, 40) || 'Skill'
  const safeLevel = sanitizeInteger(level, 1, 10, 1)
  const safeDuration = sanitizeInteger(durationMinutes, 1, 120, 10)
  const safeOnStart = typeof onStart === 'function' ? onStart : null
  const isDisabled = Boolean(disabled || !moodIsSet || !safeOnStart)

  const handleStart = () => {
    if (isDisabled) {
      return
    }

    safeOnStart()
  }

  return (
    <section className="today-plan" aria-label="Today's session plan">
      <div className="label">Today's session</div>
      <h2>
        {safeSkillName} <em>practice</em>
      </h2>
      <div className="plan-meta">
        <span>
          <strong>~{safeDuration} min</strong> total
        </span>
        <span>
          <strong>1</strong> skill
        </span>
        <span>
          <strong>Level {safeLevel}</strong>
        </span>
      </div>
      <button
        type="button"
        className="start-btn"
        disabled={isDisabled}
        aria-label="Start today's session"
        onClick={handleStart}
      >
        Let's go →
      </button>
    </section>
  )
}

export default TodayPlanCard
