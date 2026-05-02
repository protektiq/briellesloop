import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import MoodCheckIn from '../components/MoodCheckIn'

const API_BASE_URL = 'http://localhost:3001'
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value.trim())

const formatMinutes = (totalSeconds) => {
  const seconds = Number(totalSeconds)
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0 min'
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} sec`
  }
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

const safePromptText = (value) => {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (trimmed.length <= 80) {
    return trimmed
  }
  return `${trimmed.slice(0, 77)}…`
}

const SessionCompletePage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { skillName } = useParams()

  const sessionId = useMemo(
    () => (isUuid(location.state?.sessionId) ? location.state.sessionId.trim() : ''),
    [location.state?.sessionId],
  )
  const summary = location.state?.summary ?? null

  const [mood, setMood] = useState({ emoji: null, score: null, isSet: false })
  const [reflection, setReflection] = useState('')
  const [isEnding, setIsEnding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [endError, setEndError] = useState('')

  useEffect(() => {
    if (!sessionId) {
      navigate('/', { replace: true })
    }
  }, [sessionId, navigate])

  useEffect(() => {
    let isMounted = true

    const finalizeSession = async () => {
      if (!sessionId) {
        return
      }
      try {
        setIsEnding(true)
        setEndError('')
        const response = await fetch(
          `${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/end`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'completed_target' }),
          },
        )
        if (!response.ok && isMounted) {
          const payload = await response.json().catch(() => ({}))
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : `End-session request failed with ${response.status}`
          setEndError(message)
        }
      } catch (error) {
        if (isMounted) {
          const message = error instanceof Error ? error.message : 'Could not end the session.'
          setEndError(message)
        }
      } finally {
        if (isMounted) {
          setIsEnding(false)
        }
      }
    }

    finalizeSession()
    return () => {
      isMounted = false
    }
  }, [sessionId])

  const handleDoneForToday = async () => {
    if (isSaving || isEnding) {
      return
    }
    if (!sessionId) {
      navigate('/', { replace: true })
      return
    }
    const trimmedReflection = reflection.trim()
    if (!mood.isSet || trimmedReflection.length === 0 || trimmedReflection.length > 2000) {
      return
    }

    try {
      setIsSaving(true)
      setEndError('')
      const response = await fetch(
        `${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/post-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            post_mood_emoji: mood.emoji,
            post_mood_score: mood.score,
            reflection: trimmedReflection,
          }),
        },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : `Post-checkout request failed with ${response.status}`
        setEndError(message)
        return
      }
      navigate('/', { replace: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save post-session check-out.'
      setEndError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const itemsAttempted = Number(summary?.items_attempted ?? 0)
  const itemsCorrect = Number(summary?.items_correct ?? 0)
  const elapsedSeconds = Number(summary?.elapsed_seconds ?? 0)
  const tierChanges = Array.isArray(summary?.tier_changes) ? summary.tier_changes : []

  return (
    <section className="session-complete-section">
      <div className="session-complete-card">
        <h1>Session complete!</h1>
        <p className="accuracy-line">
          {itemsCorrect} correct out of {itemsAttempted} ·{' '}
          {formatMinutes(elapsedSeconds)} focused on{' '}
          <em>{typeof skillName === 'string' ? skillName : 'practice'}</em>.
        </p>

        <div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '18px', marginBottom: '12px' }}>
            What moved up a tier
          </h2>
          {tierChanges.length === 0 ? (
            <p className="tier-empty">
              No tier changes this session — that&apos;s normal. Steady reps build mastery.
            </p>
          ) : (
            <ul className="tier-list">
              {tierChanges.map((change, index) => (
                <li key={`${change.item_id ?? 'item'}-${index}`}>
                  <span className="tier-pill">
                    Tier {Number(change.prior_tier ?? 0)} → {Number(change.next_tier ?? 0)}
                  </span>
                  <span>{safePromptText(change.prompt_text)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="post-checkout-block">
          <h2>How are you feeling now?</h2>
          <MoodCheckIn onChange={setMood} />
          <label htmlFor="reflection-input" className="reflection-label">
            What was something hard? What was something you did well?
          </label>
          <textarea
            id="reflection-input"
            className="reflection-input"
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            maxLength={2000}
            aria-label="Post-session reflection"
            placeholder="Write one sentence about what felt hard and one thing you did well."
          />
        </div>

        {endError ? <span className="end-error">{endError}</span> : null}

        <div className="complete-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDoneForToday}
            disabled={
              isEnding || isSaving || !mood.isSet || reflection.trim().length === 0
            }
          >
            {isSaving ? 'Saving…' : 'Done for today'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default SessionCompletePage
