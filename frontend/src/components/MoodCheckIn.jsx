import { useEffect, useMemo, useState } from 'react'

const MOOD_OPTIONS = [
  { emoji: '😢', score: 1, label: 'Very sad' },
  { emoji: '😟', score: 3, label: 'Worried' },
  { emoji: '😐', score: 5, label: 'Neutral' },
  { emoji: '🙂', score: 6, label: 'Okay' },
  { emoji: '😄', score: 8, label: 'Great' },
]

const clampMoodScore = (value) => {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed)) {
    return 0
  }

  return Math.min(10, Math.max(0, parsed))
}

const isValidEmoji = (value) =>
  typeof value === 'string' && MOOD_OPTIONS.some((option) => option.emoji === value)

const findClosestMoodEmoji = (score) => {
  const safeScore = clampMoodScore(score)
  return MOOD_OPTIONS.reduce((closestOption, currentOption) => {
    const currentDistance = Math.abs(currentOption.score - safeScore)
    const closestDistance = Math.abs(closestOption.score - safeScore)
    return currentDistance < closestDistance ? currentOption : closestOption
  }, MOOD_OPTIONS[0]).emoji
}

const MoodCheckIn = ({ onChange, initialEmoji = null, initialScore = null }) => {
  const safeInitialEmoji = isValidEmoji(initialEmoji) ? initialEmoji : null
  const [selectedEmoji, setSelectedEmoji] = useState(safeInitialEmoji)
  const [score, setScore] = useState(() =>
    initialScore === null ? null : clampMoodScore(initialScore),
  )

  const safeOnChange = typeof onChange === 'function' ? onChange : null

  const moodState = useMemo(
    () => ({
      emoji: selectedEmoji,
      score,
      isSet: selectedEmoji !== null && score !== null,
    }),
    [score, selectedEmoji],
  )

  useEffect(() => {
    if (!safeOnChange) {
      return
    }

    safeOnChange(moodState)
  }, [moodState, safeOnChange])

  const handleEmojiSelect = (emoji) => {
    if (!isValidEmoji(emoji)) {
      return
    }

    const matchedOption = MOOD_OPTIONS.find((option) => option.emoji === emoji)
    if (!matchedOption) {
      return
    }

    setSelectedEmoji(matchedOption.emoji)
    setScore(matchedOption.score)
  }

  const handleSliderChange = (event) => {
    const nextScore = clampMoodScore(event?.target?.value)
    setScore(nextScore)

    if (selectedEmoji !== null) {
      return
    }

    setSelectedEmoji(findClosestMoodEmoji(nextScore))
  }

  return (
    <section className="mood-block" aria-label="Mood check-in">
      <h3>How are you feeling right now?</h3>
      <div className="emoji-row">
        {MOOD_OPTIONS.map((option) => (
          <button
            key={option.emoji}
            type="button"
            className={`emoji-btn${selectedEmoji === option.emoji ? ' selected' : ''}`}
            aria-label={option.label}
            aria-pressed={selectedEmoji === option.emoji}
            onClick={() => handleEmojiSelect(option.emoji)}
          >
            {option.emoji}
          </button>
        ))}
      </div>
      <div className="slider-row">
        <span aria-hidden="true">0</span>
        <input
          className="mood-slider-input"
          type="range"
          min="0"
          max="10"
          step="1"
          value={score ?? 0}
          aria-label="Mood score from 0 to 10"
          onChange={handleSliderChange}
        />
        <span aria-hidden="true">10</span>
      </div>
    </section>
  )
}

export default MoodCheckIn
