import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'

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

const API_BASE_URL = 'http://localhost:3001'
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value.trim())

const PracticePage = () => {
  const location = useLocation()
  const { skillName } = useParams()
  const safeSkillName = sanitizeSkillName(skillName)
  const sessionId = useMemo(
    () => (isUuid(location.state?.sessionId) ? location.state.sessionId.trim() : ''),
    [location.state?.sessionId],
  )
  const [queue, setQueue] = useState([])
  const [currentItem, setCurrentItem] = useState(null)
  const [answer, setAnswer] = useState('')
  const [isCorrect, setIsCorrect] = useState(true)
  const [isLoadingQueue, setIsLoadingQueue] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSessionComplete, setIsSessionComplete] = useState(false)

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
        const normalizedQueue = Array.isArray(payload.queue) ? payload.queue : []
        if (!isMounted) {
          return
        }

        setQueue(normalizedQueue)
        setCurrentItem(normalizedQueue[0] ?? null)
        setStartedAtMs(Date.now())
        setIsSessionComplete(normalizedQueue.length === 0)
      } catch (error) {
        if (!isMounted) {
          return
        }
        setErrorMessage(error instanceof Error ? error.message : 'Could not load queue.')
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

  const handleSubmitAttempt = async () => {
    if (!currentItem || !sessionId || isSubmitting || answer.trim().length === 0) {
      return
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000))

    try {
      setIsSubmitting(true)
      setErrorMessage('')
      const response = await fetch(`${API_BASE_URL}/api/items/${currentItem.item_id}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          answer: answer.trim(),
          is_correct: isCorrect,
          response_seconds: elapsedSeconds,
        }),
      })

      if (!response.ok) {
        throw new Error(`Attempt request failed with ${response.status}`)
      }

      const payload = await response.json()
      if (payload?.sessionComplete) {
        setCurrentItem(null)
        setIsSessionComplete(true)
        return
      }

      const nextItem = payload?.next_item ?? null
      setCurrentItem(nextItem)
      setAnswer('')
      setStartedAtMs(Date.now())
      if (!nextItem) {
        setIsSessionComplete(true)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not submit attempt.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="card-surface">
      <h1>Practice: {safeSkillName}</h1>
      <p>Session: {sessionId || 'missing'}</p>

      {isLoadingQueue ? <p>Loading queue…</p> : null}
      {errorMessage ? <p>{errorMessage}</p> : null}

      {!isLoadingQueue && !errorMessage && currentItem ? (
        <>
          <p>{currentItem.prompt?.text ?? 'No prompt text.'}</p>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Type your answer"
            rows={4}
          />
          <label htmlFor="attempt-is-correct">
            <input
              id="attempt-is-correct"
              type="checkbox"
              checked={isCorrect}
              onChange={(event) => setIsCorrect(event.target.checked)}
            />
            Mark as correct
          </label>
          <button type="button" onClick={handleSubmitAttempt} disabled={isSubmitting || answer.trim().length === 0}>
            {isSubmitting ? 'Submitting…' : 'Submit attempt'}
          </button>
        </>
      ) : null}

      {isSessionComplete ? <p>Session complete.</p> : null}
      {!currentItem && queue.length === 0 && !isLoadingQueue && !errorMessage ? (
        <p>No items available in this queue yet.</p>
      ) : null}
    </section>
  )
}

export default PracticePage
