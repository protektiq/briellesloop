import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

const API_BASE_URL = 'http://localhost:3001'
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value.trim())

const sanitizeSkillName = (value) => {
  if (typeof value !== 'string') {
    return 'unknown'
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 48) {
    return 'unknown'
  }

  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '')
  return normalized.length > 0 ? normalized : 'unknown'
}

const skillDisplayLabel = (skill) => {
  if (skill === 'math') {
    return 'Math · Word Problem'
  }
  if (skill === 'reading') {
    return 'Reading · Comprehension'
  }
  if (skill === 'spelling') {
    return 'Spelling · Pattern'
  }
  if (skill === 'typing') {
    return 'Typing · Sentence'
  }
  return 'Practice'
}

const DEFAULT_COACH_TITLE = "You're in your seat. That's the hardest part."
const DEFAULT_COACH_BODY =
  'Take your time. Read it twice if you need to — there is no timer here.'

const PracticePage = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { skillName } = useParams()
  const safeSkillName = sanitizeSkillName(skillName)
  const sessionId = useMemo(
    () => (isUuid(location.state?.sessionId) ? location.state.sessionId.trim() : ''),
    [location.state?.sessionId],
  )

  const [queue, setQueue] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [isLoadingQueue, setIsLoadingQueue] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingHint, setIsLoadingHint] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [coachState, setCoachState] = useState({
    tone: 'default',
    label: "★ Today's coach",
    title: DEFAULT_COACH_TITLE,
    body: DEFAULT_COACH_BODY,
  })
  const [tierChanges, setTierChanges] = useState([])
  const [attemptStats, setAttemptStats] = useState({ correct: 0, attempted: 0 })
  const [sessionStartedAtMs] = useState(() => Date.now())
  const [itemRenderedAtMs, setItemRenderedAtMs] = useState(() => Date.now())
  const inputRef = useRef(null)

  const totalCount = queue.length
  const currentItem = queue[currentIndex] ?? null
  const isBusy = isSubmitting || isLoadingHint
  const promptText =
    typeof currentItem?.prompt?.text === 'string' ? currentItem.prompt.text : ''
  const structuredSteps = useMemo(() => {
    const steps = currentItem?.metadata?.structured_steps
    if (!Array.isArray(steps)) {
      return []
    }
    return steps.filter(
      (step) => step && typeof step === 'object' && typeof step.label === 'string',
    )
  }, [currentItem])

  useEffect(() => {
    let isMounted = true

    const loadQueue = async () => {
      if (!sessionId || safeSkillName === 'unknown') {
        setErrorMessage('Missing valid session context. Please restart from Today.')
        return
      }

      try {
        setIsLoadingQueue(true)
        setErrorMessage('')
        const response = await fetch(
          `${API_BASE_URL}/api/items/queue/${safeSkillName}?session_id=${encodeURIComponent(sessionId)}`,
        )
        if (!response.ok) {
          throw new Error(`Queue request failed with ${response.status}`)
        }

        const payload = await response.json()
        const normalizedQueue = Array.isArray(payload?.queue) ? payload.queue : []
        if (!isMounted) {
          return
        }

        setQueue(normalizedQueue)
        setCurrentIndex(0)
      } catch (error) {
        if (!isMounted) {
          return
        }
        const message =
          error instanceof Error ? error.message : 'Could not load queue.'
        setErrorMessage(message)
      } finally {
        if (isMounted) {
          setIsLoadingQueue(false)
        }
      }
    }

    loadQueue()
    return () => {
      isMounted = false
    }
  }, [safeSkillName, sessionId])

  useEffect(() => {
    if (!currentItem) {
      return
    }
    setAnswer('')
    setItemRenderedAtMs(Date.now())
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [currentItem?.item_id])

  const computeResponseSeconds = useCallback(() => {
    const elapsed = Math.round((Date.now() - itemRenderedAtMs) / 1000)
    if (!Number.isFinite(elapsed)) {
      return 0
    }
    return Math.min(600, Math.max(0, elapsed))
  }, [itemRenderedAtMs])

  const navigateToComplete = useCallback(
    (extraStats) => {
      const elapsedSec = Math.max(
        0,
        Math.round((Date.now() - sessionStartedAtMs) / 1000),
      )
      navigate(`/practice/${safeSkillName}/complete`, {
        state: {
          sessionId,
          skillName: safeSkillName,
          summary: {
            items_attempted: extraStats.attempted,
            items_correct: extraStats.correct,
            elapsed_seconds: elapsedSec,
            tier_changes: tierChanges,
          },
        },
      })
    },
    [navigate, safeSkillName, sessionId, sessionStartedAtMs, tierChanges],
  )

  const handleSubmitAttempt = async () => {
    if (!currentItem || !sessionId || isBusy) {
      return
    }
    const trimmed = answer.trim()
    if (trimmed.length === 0) {
      return
    }

    const elapsedSeconds = computeResponseSeconds()

    try {
      setIsSubmitting(true)
      setErrorMessage('')
      const response = await fetch(
        `${API_BASE_URL}/api/items/${encodeURIComponent(currentItem.item_id)}/attempt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            answer: trimmed,
            response_seconds: elapsedSeconds,
          }),
        },
      )

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message =
          typeof payload?.message === 'string' && payload.message.length > 0
            ? payload.message
            : typeof payload?.error === 'string'
              ? payload.error
              : `Attempt request failed with ${response.status}`
        setCoachState({
          tone: 'error',
          label: 'Hmm, retry',
          title: 'I could not grade that one.',
          body: message,
        })
        return
      }

      const wasCorrect = Boolean(payload.is_correct)
      const nextAttempted = attemptStats.attempted + 1
      const nextCorrect = attemptStats.correct + (wasCorrect ? 1 : 0)
      setAttemptStats({ attempted: nextAttempted, correct: nextCorrect })

      const masteryInfo = payload.mastery ?? null
      if (masteryInfo?.tier_advanced) {
        setTierChanges((prev) => [
          ...prev,
          {
            item_id: currentItem.item_id,
            prompt_text: promptText,
            prior_tier: Number(masteryInfo.prior_tier ?? 0),
            next_tier: Number(masteryInfo.next_tier ?? 0),
          },
        ])
      }

      const feedbackText =
        typeof payload.feedback === 'string' && payload.feedback.length > 0
          ? payload.feedback
          : wasCorrect
            ? 'Nice work — that one is correct.'
            : 'Not quite — let us look at it together.'
      const explanationText =
        typeof payload.explanation === 'string' ? payload.explanation : ''
      setCoachState({
        tone: wasCorrect ? 'correct' : 'incorrect',
        label: wasCorrect ? '✓ Coach says' : '↺ Coach says',
        title: feedbackText,
        body: explanationText,
      })

      const isComplete =
        Boolean(payload.sessionComplete) || !payload.next_item || currentIndex + 1 >= totalCount

      if (isComplete) {
        navigateToComplete({ attempted: nextAttempted, correct: nextCorrect })
        return
      }

      setCurrentIndex((index) => index + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not submit attempt.'
      setCoachState({
        tone: 'error',
        label: 'Hmm, retry',
        title: 'Something went wrong submitting that.',
        body: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleHint = async () => {
    if (!currentItem || isBusy) {
      return
    }

    try {
      setIsLoadingHint(true)
      setErrorMessage('')
      const response = await fetch(`${API_BASE_URL}/api/ai/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: currentItem.item_id,
          response_so_far: answer,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message =
          typeof payload?.message === 'string' && payload.message.length > 0
            ? payload.message
            : typeof payload?.error === 'string'
              ? payload.error
              : `Hint request failed with ${response.status}`
        setCoachState({
          tone: 'error',
          label: 'Hmm, retry',
          title: 'I could not get a hint right now.',
          body: message,
        })
        return
      }

      const hintText =
        typeof payload.hint_text === 'string' && payload.hint_text.length > 0
          ? payload.hint_text
          : "Let's slow it down. Read the question one more time and tell me what you know first."
      setCoachState({
        tone: 'hint',
        label: "Let's break it smaller",
        title: 'Try this next.',
        body: hintText,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load a hint.'
      setCoachState({
        tone: 'error',
        label: 'Hmm, retry',
        title: 'Something went wrong fetching a hint.',
        body: message,
      })
    } finally {
      setIsLoadingHint(false)
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmitAttempt()
    }
  }

  const progressPercent = totalCount === 0
    ? 0
    : Math.round(((currentIndex + (currentItem ? 0 : 1)) / totalCount) * 100)

  const renderStepBoxes = () => {
    if (!currentItem) {
      return null
    }

    if (structuredSteps.length === 0) {
      return (
        <div className="step-row">
          <div className={`step-box${isBusy ? ' loading' : ' active'}`}>
            <div className="step-label">Step — What we&apos;re finding</div>
            <div className="step-content placeholder">
              {isBusy ? 'thinking…' : 'Type your answer below 👇'}
            </div>
          </div>
        </div>
      )
    }

    const lastIndex = structuredSteps.length - 1
    return (
      <div className="step-row">
        {structuredSteps.map((step, index) => {
          const isLast = index === lastIndex
          let className = 'step-box'
          if (isLast) {
            className += isBusy ? ' loading' : ' active'
          } else {
            className += ' done'
          }
          return (
            <div key={`${step.label}-${index}`} className={className}>
              <div className="step-label">
                {!isLast ? <span className="check" aria-hidden="true">✓</span> : null}
                <span>{step.label}</span>
              </div>
              <div className={`step-content${isLast && isBusy ? ' thinking' : ''}`}>
                {isLast && isBusy ? 'thinking…' : step.content}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const renderSessionDots = () => {
    const dots = []
    const dotCount = Math.max(totalCount, 1)
    for (let index = 0; index < dotCount; index += 1) {
      let className = 'session-dot'
      if (index < currentIndex) {
        className += ' done'
      } else if (index === currentIndex && currentItem) {
        className += ' current'
      }
      dots.push(<div key={`dot-${index}`} className={className} />)
    }
    return dots
  }

  if (errorMessage && queue.length === 0 && !isLoadingQueue) {
    return (
      <section className="activity-section">
        <div className="activity-frame">
          <div className="activity-main">
            <div className="activity-header">
              <span className="activity-tag">{skillDisplayLabel(safeSkillName)}</span>
              <span className="progress-pill">Trouble loading</span>
            </div>
            <div className="activity-question">{errorMessage}</div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/')}
              >
                Back to Today
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const coachClassName =
    coachState.tone === 'error'
      ? 'coach-card error'
      : 'coach-card'

  return (
    <section className="activity-section">
      <div className="activity-frame">
        <div className="activity-main">
          <div className="activity-header">
            <span className="activity-tag">{skillDisplayLabel(safeSkillName)}</span>
            <span className="progress-pill">
              {totalCount === 0
                ? 'Loading…'
                : `Question ${Math.min(currentIndex + 1, totalCount)} of ${totalCount} · No timer`}
            </span>
          </div>

          <div className="progress-bar">
            <div style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="activity-question">
            {isLoadingQueue
              ? 'Picking the first question for you…'
              : promptText || 'Ready when you are.'}
          </div>

          {renderStepBoxes()}

          <input
            ref={inputRef}
            type="text"
            className="input-line"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer here"
            aria-label="Your answer"
            disabled={!currentItem || isBusy}
            autoFocus
          />

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleHint}
              disabled={!currentItem || isBusy}
            >
              {isLoadingHint ? 'Thinking…' : 'Hint'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmitAttempt}
              disabled={!currentItem || isBusy || answer.trim().length === 0}
            >
              {isSubmitting ? 'Checking…' : 'Check my answer →'}
            </button>
          </div>

          <div className="stuck-row">
            <span>Brain feeling foggy?</span>
            <button
              type="button"
              className="stuck-btn"
              onClick={handleHint}
              disabled={!currentItem || isBusy}
            >
              I&apos;m stuck — break it smaller
            </button>
          </div>
        </div>

        <aside className="activity-sidebar">
          <div className={coachClassName}>
            <div className="label">{coachState.label}</div>
            <h4>{coachState.title}</h4>
            {coachState.body ? <p>{coachState.body}</p> : null}
          </div>

          <div className="coach-card brain-break">
            <div className="label">When you need it</div>
            <h4>Brain break, ready to go.</h4>
            <p>
              If your brain gets noisy or tired, tap the button above. Three minutes,
              then we come right back.
            </p>
            <div className="breath-mini">
              <div className="breath-orb" aria-hidden="true" />
              <span className="breath-mini-label">breathe</span>
            </div>
          </div>

          <div className="session-progress">
            <h5>Today&apos;s session</h5>
            <div className="session-dots">{renderSessionDots()}</div>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default PracticePage
