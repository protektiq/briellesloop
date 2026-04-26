const sanitizeText = (value, maxLength = 32) => {
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

const SkillTile = ({
  icon,
  name,
  level,
  durationMinutes,
  selected = false,
  suggestedToday = false,
  onSelect,
}) => {
  const safeName = sanitizeText(name, 40)
  const safeIcon = sanitizeText(icon, 6) || '📚'
  const safeLevel = sanitizeInteger(level, 1, 10, 1)
  const safeDuration = sanitizeInteger(durationMinutes, 1, 120, 10)
  const safeOnSelect = typeof onSelect === 'function' ? onSelect : null

  const handleSelect = () => {
    if (!safeOnSelect || !safeName) {
      return
    }

    safeOnSelect(safeName)
  }

  if (!safeName) {
    return null
  }

  return (
    <button
      type="button"
      className={`skill-tile${selected ? ' selected' : ''}${suggestedToday ? ' suggested' : ''}`}
      aria-label={`Choose ${safeName}`}
      aria-pressed={selected}
      onClick={handleSelect}
    >
      {suggestedToday ? <span className="skill-suggested-badge">Suggested today</span> : null}
      <span className="icon" aria-hidden="true">
        {safeIcon}
      </span>
      <span className="name">{safeName}</span>
      <span className="meta">
        Level {safeLevel} · {safeDuration} min
      </span>
    </button>
  )
}

export default SkillTile
