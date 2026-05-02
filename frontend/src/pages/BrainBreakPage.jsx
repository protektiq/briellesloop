import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const API_BASE_URL = 'http://localhost:3001'
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_TRIGGERS = new Set([
  'auto_two_wrong',
  'auto_slow',
  'user_button',
  'low_mood',
  'agent_predicted',
])

const clampSeconds = (value, fallback = 180) => {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed)) {
    return fallback
  }
  return Math.min(1800, Math.max(0, parsed))
}

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value.trim())

const sanitizeTrigger = (value, fallback = 'user_button') => {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (!ALLOWED_TRIGGERS.has(normalized)) {
    return fallback
  }
  return normalized
}

const sanitizeRoute = (value, fallback = '/') => {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 120 || !trimmed.startsWith('/')) {
    return fallback
  }
  return trimmed
}

const formatTimer = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const BrainBreakPage = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const loggedRef = useRef(false)
  const breakState = location.state ?? {}

  const sessionId = useMemo(
    () => (isUuid(breakState.sessionId) ? breakState.sessionId.trim() : ''),
    [breakState.sessionId],
  )
  const triggerReason = useMemo(
    () => sanitizeTrigger(breakState.triggeredBy, 'user_button'),
    [breakState.triggeredBy],
  )
  const returnTo = useMemo(() => sanitizeRoute(breakState.returnTo, '/'), [breakState.returnTo])
  const skillName = useMemo(
    () => sanitizeRoute(`/practice/${String(breakState.skillName ?? '').trim()}`, '/'),
    [breakState.skillName],
  )
  const isLowMoodBreak = triggerReason === 'low_mood'
  const continueToPractice = Boolean(breakState.continueToPractice)
  const initialDurationSeconds = useMemo(
    () => clampSeconds(breakState.durationSeconds, 180),
    [breakState.durationSeconds],
  )

  const [remainingSeconds, setRemainingSeconds] = useState(initialDurationSeconds)
  const [didLogBreak, setDidLogBreak] = useState(false)
  const [breakLogError, setBreakLogError] = useState('')

  useEffect(() => {
    if (remainingSeconds <= 0) {
      return
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return seconds - 1
      })
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [remainingSeconds])

  useEffect(() => {
    if (!sessionId || loggedRef.current) {
      return
    }
    loggedRef.current = true

    const logBreak = async () => {
      try {
        setBreakLogError('')
        const response = await fetch(
          `${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/brain-break`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              triggered_by: triggerReason,
              duration_seconds: initialDurationSeconds,
            }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : `Break logging failed with ${response.status}`
          setBreakLogError(message)
          return
        }
        setDidLogBreak(true)
      } catch (error) {
        setBreakLogError(error instanceof Error ? error.message : 'Could not log break.')
      }
    }

    logBreak()
  }, [initialDurationSeconds, sessionId, triggerReason])

  const handleResumePractice = () => {
    if (continueToPractice) {
      navigate(skillName, { state: { sessionId } })
      return
    }

    if (returnTo !== '/') {
      navigate(returnTo, { state: { sessionId } })
      return
    }

    navigate('/', { replace: true })
  }

  const handleDoneForNow = () => {
    navigate('/', { replace: true })
  }

  const pageTitle = isLowMoodBreak ? "Let's breathe for a bit." : "Let's take a brain break."
  const pageBody = isLowMoodBreak
    ? "Tough start to today — let's just breathe for a bit. In, then out. Practice is optional after this."
    : "You've been working hard. Breathe with the circle. In, then out. The work will still be here."
  const continueLabel = "I'm ready to keep going →"

  return (
    <section className="break-section">
      <div className="break-frame">
        <div className="break-content">
          <div className="break-eyebrow">— A pause, just for you —</div>
          <h1>{pageTitle}</h1>
          <p>{pageBody}</p>

          <div className="breath-stage">
            <div className="breath-circle" aria-hidden="true">
              <span className="breath-text">breathe in</span>
            </div>
            <div className="timer-block" aria-live="polite">
              <div className="timer">{formatTimer(remainingSeconds)}</div>
              <div className="timer-label">Time remaining</div>
            </div>
          </div>

          {isLowMoodBreak ? (
            <div className="break-offer-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResumePractice}
                aria-label="Try practice now"
              >
                Try practice now
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDoneForNow}
                aria-label="Done for now"
              >
                Done for now
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="skip-link"
              onClick={handleResumePractice}
              aria-label={continueLabel}
            >
              {continueLabel}
            </button>
          )}

          <div className="break-footnote">
            {didLogBreak ? 'Break logged.' : 'Logging break…'}
            {breakLogError ? ` ${breakLogError}` : ''}
          </div>
        </div>
      </div>
    </section>
  )
}

export default BrainBreakPage
