import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  MathSkillView,
  ReadingSkillView,
  SpellingSkillView,
  TypingSkillView,
  WritingSkillView,
  poolDisplayName,
  useTypingLiveStats,
} from '../components/practice/PracticeSkillViews.jsx'
import { API_BASE_URL } from '../constants/api'
import { fetchTtsAudio } from '../utils/tts.js'
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
  if (skill === 'writing') {
    return 'Writing · Paragraph'
  }
  if (skill === 'jiujitsu') {
    return 'Jiu Jitsu · Knowledge'
  }
  if (skill === 'programming') {
    return 'Programming · Concepts'
  }
  return 'Practice'
}

const parseFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const countWords = (text) => {
  if (typeof text !== 'string') {
    return 0
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }
  return trimmed.split(/\s+/).filter((entry) => entry.length > 0).length
}

const normalizeFrustrationTuningRows = (value) => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      parameter_name:
        typeof row.parameter_name === 'string' ? row.parameter_name.trim() : '',
      current_value: parseFiniteNumber(row.current_value),
    }))
    .filter((row) => row.parameter_name.length > 0 && row.current_value !== null)
}

const evaluateFrustrationSignals = (tuningRows, sessionState) => {
  try {
    if (!Array.isArray(tuningRows) || !sessionState || typeof sessionState !== 'object') {
      return { shouldOffer: false, reason: null }
    }

    const consecutiveWrong = parseFiniteNumber(sessionState.consecutiveWrong)
    const secondsOnCurrentItem = parseFiniteNumber(sessionState.secondsOnCurrentItem)
    const sessionAttemptCount = parseFiniteNumber(sessionState.sessionAttemptCount)

    if (
      consecutiveWrong === null ||
      secondsOnCurrentItem === null ||
      sessionAttemptCount === null
    ) {
      return { shouldOffer: false, reason: null }
    }

    for (const row of tuningRows) {
      if (!row.parameter_name.startsWith('frustration_signal:')) {
        continue
      }
      const signalType = row.parameter_name.slice('frustration_signal:'.length).trim().toLowerCase()
      const threshold = parseFiniteNumber(row.current_value)
      if (threshold === null) {
        continue
      }

      if ((signalType === 'consecutive_wrong' || signalType === 'wrong_streak') && consecutiveWrong >= threshold) {
        return { shouldOffer: true, reason: 'agent_predicted' }
      }
      if (
        (signalType === 'seconds_on_item' ||
          signalType === 'slow_item_seconds' ||
          signalType === 'time_on_item') &&
        secondsOnCurrentItem >= threshold
      ) {
        return { shouldOffer: true, reason: 'agent_predicted' }
      }
      if (signalType === 'session_attempts' && sessionAttemptCount >= threshold) {
        return { shouldOffer: true, reason: 'agent_predicted' }
      }
      if (
        signalType !== 'consecutive_wrong' &&
        signalType !== 'wrong_streak' &&
        signalType !== 'seconds_on_item' &&
        signalType !== 'slow_item_seconds' &&
        signalType !== 'time_on_item' &&
        signalType !== 'session_attempts'
      ) {
        console.warn(`Unknown frustration signal type: ${signalType}`)
      }
    }
    return { shouldOffer: false, reason: null }
  } catch {
    return { shouldOffer: false, reason: null }
  }
}

const DEFAULT_COACH_TITLE = "You're in your seat. That's the hardest part."
const DEFAULT_COACH_BODY =
  'Take your time. Read it twice if you need to — there is no timer here.'

/** Legacy typing grader sent metrics JSON here; never show that to learners. */
const isTypingMetricsJsonString = (value) => {
  if (typeof value !== 'string') {
    return false
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) {
    return false
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') {
      return false
    }
    return 'wpm' in parsed && 'accuracy' in parsed
  } catch {
    return false
  }
}

const coachBodyAfterAttempt = (skillName, rawExplanation) => {
  if (skillName === 'typing') {
    return ''
  }
  const trimmed = typeof rawExplanation === 'string' ? rawExplanation.trim() : ''
  if (trimmed.length === 0 || isTypingMetricsJsonString(trimmed)) {
    return ''
  }
  return trimmed
}

const COACH_TTS_MAX_CHARS = 2000

const awaitCoachSpeakOrCap = async (speakPromise) => {
  await Promise.race([
    speakPromise,
    new Promise((resolve) => {
      window.setTimeout(resolve, 45_000)
    }),
  ])
}

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
  const [readingQuestionIndex, setReadingQuestionIndex] = useState(0)
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
  const [consecutiveWrongCount, setConsecutiveWrongCount] = useState(0)
  const [breakOfferReason, setBreakOfferReason] = useState('')
  const [frustrationTimeMs, setFrustrationTimeMs] = useState(180_000)
  const [sessionStudentId, setSessionStudentId] = useState('')
  const [writingRubric, setWritingRubric] = useState(null)
  const [writingEncouragement, setWritingEncouragement] = useState('')
  const [writingSubmissionComplete, setWritingSubmissionComplete] = useState(false)
  const [voiceMathEnabled, setVoiceMathEnabled] = useState(true)
  const [voiceSpellingEnabled, setVoiceSpellingEnabled] = useState(false)
  const [ttsVoice, setTtsVoice] = useState('af_sky')
  const [spellingUseKeyboard, setSpellingUseKeyboard] = useState(false)
  const slowTriggerItemIdRef = useRef('')
  const spellingReplayRef = useRef({ audio: null, revoke: null })
  const coachTtsRevokeRef = useRef(null)
  const inputRef = useRef(null)
  const breakOfferReasonRef = useRef('')
  const attemptStatsRef = useRef({ correct: 0, attempted: 0 })
  const consecutiveWrongRef = useRef(0)
  const itemRenderedAtMsRef = useRef(Date.now())
  const tuningRowsRef = useRef([])
  const hintUsedForCurrentItemRef = useRef(false)

  useEffect(() => {
    breakOfferReasonRef.current = breakOfferReason
  }, [breakOfferReason])

  useEffect(() => {
    attemptStatsRef.current = attemptStats
  }, [attemptStats])

  useEffect(() => {
    consecutiveWrongRef.current = consecutiveWrongCount
  }, [consecutiveWrongCount])

  useEffect(() => {
    itemRenderedAtMsRef.current = itemRenderedAtMs
  }, [itemRenderedAtMs])

  useEffect(() => {
    let isMounted = true

    const loadTuningRows = async () => {
      if (!isUuid(sessionStudentId)) {
        tuningRowsRef.current = []
        return
      }
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/student/${encodeURIComponent(sessionStudentId)}/tuning`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!isMounted || !response.ok) {
          return
        }
        tuningRowsRef.current = normalizeFrustrationTuningRows(payload?.tuning)
      } catch {
        if (!isMounted) {
          return
        }
        tuningRowsRef.current = []
      }
    }

    void loadTuningRows()
    return () => {
      isMounted = false
    }
  }, [sessionStudentId])

  useEffect(() => {
    let cancelled = false
    const loadVoiceSettings = async () => {
      if (!isUuid(sessionStudentId)) {
        return
      }
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/settings/profile?student_id=${encodeURIComponent(sessionStudentId)}`,
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) {
          return
        }
        if (typeof data.voice_math_enabled === 'boolean') {
          setVoiceMathEnabled(data.voice_math_enabled)
        }
        if (typeof data.voice_spelling_enabled === 'boolean') {
          setVoiceSpellingEnabled(data.voice_spelling_enabled)
        }
        if (typeof data.tts_voice === 'string' && data.tts_voice.trim().length > 0) {
          setTtsVoice(data.tts_voice.trim())
        }
      } catch {
        /* keep defaults */
      }
    }
    void loadVoiceSettings()
    return () => {
      cancelled = true
    }
  }, [sessionStudentId])

  useEffect(() => {
    return () => {
      const prev = spellingReplayRef.current
      if (prev.revoke) {
        prev.revoke()
      }
      spellingReplayRef.current = { audio: null, revoke: null }
      const coachRevoke = coachTtsRevokeRef.current
      if (typeof coachRevoke === 'function') {
        coachTtsRevokeRef.current = null
        coachRevoke()
      }
    }
  }, [])

  const totalCount = queue.length
  const currentItem = queue[currentIndex] ?? null

  useEffect(() => {
    hintUsedForCurrentItemRef.current = false
  }, [currentItem?.item_id])

  const isBusy = isSubmitting || isLoadingHint
  const promptText =
    typeof currentItem?.prompt?.text === 'string' ? currentItem.prompt.text : ''
  const writingWordCountGuidance =
    typeof currentItem?.prompt?.word_count_guidance === 'string'
      ? currentItem.prompt.word_count_guidance
      : 'Aim for 40-120 words.'
  const structuredSteps = useMemo(() => {
    const steps = currentItem?.metadata?.structured_steps
    if (!Array.isArray(steps)) {
      return []
    }
    return steps.filter(
      (step) => step && typeof step === 'object' && typeof step.label === 'string',
    )
  }, [currentItem])

  const readingPassage = useMemo(() => {
    const p = currentItem?.metadata?.passage
    return typeof p === 'string' ? p : ''
  }, [currentItem])

  const readingTitle = useMemo(() => {
    const t = currentItem?.metadata?.title
    return typeof t === 'string' ? t : ''
  }, [currentItem])

  const readingBookAttribution = useMemo(() => {
    const a = currentItem?.metadata?.book_attribution
    return typeof a === 'string' ? a.trim() : ''
  }, [currentItem])

  const readingQuestions = useMemo(() => {
    const q = currentItem?.metadata?.questions
    return Array.isArray(q) ? q : []
  }, [currentItem])

  const currentReadingQuestionText = useMemo(() => {
    const rq = readingQuestions[readingQuestionIndex]
    if (rq && typeof rq.text === 'string') {
      return rq.text
    }
    return ''
  }, [readingQuestions, readingQuestionIndex])

  const spellingWord = useMemo(() => {
    if (safeSkillName !== 'spelling') return ''
    const meta = currentItem?.metadata
    if (meta && typeof meta.word === 'string') {
      return meta.word
    }
    return typeof currentItem?.answer?.text === 'string' ? currentItem.answer.text : ''
  }, [safeSkillName, currentItem])

  const spellingPoolLabel = useMemo(() => {
    const p = currentItem?.metadata?.pool
    return typeof p === 'string' ? poolDisplayName(p) : ''
  }, [currentItem])

  const speechRecognitionSupported = useMemo(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  }, [])

  const { liveWpm, liveAccuracy } = useTypingLiveStats(answer, promptText, itemRenderedAtMs)

  const speakSpellingWord = useCallback(async () => {
    if (!spellingWord) {
      return
    }
    const prev = spellingReplayRef.current
    if (prev.revoke) {
      prev.revoke()
    }
    spellingReplayRef.current = { audio: null, revoke: null }
    try {
      const { audio, revoke } = await fetchTtsAudio({ text: spellingWord, voice: ttsVoice })
      spellingReplayRef.current = { audio, revoke }
      audio.onended = () => {
        revoke()
        spellingReplayRef.current = { audio: null, revoke: null }
      }
      await audio.play()
    } catch {
      /* ignore */
    }
  }, [spellingWord, ttsVoice])

  const stopCoachTts = useCallback(() => {
    const revoke = coachTtsRevokeRef.current
    if (typeof revoke === 'function') {
      coachTtsRevokeRef.current = null
      revoke()
    }
  }, [])

  const speakCoachAfterAttempt = useCallback(
    async (titleText, bodyText) => {
      stopCoachTts()
      const title = typeof titleText === 'string' ? titleText.trim() : ''
      const body = typeof bodyText === 'string' ? bodyText.trim() : ''
      if (!title && !body) {
        return
      }
      const narrative = [title, body].filter(Boolean).join('. ')
      let text = narrative.replace(/\s+/g, ' ').trim()
      if (text.length > COACH_TTS_MAX_CHARS) {
        text = text.slice(0, COACH_TTS_MAX_CHARS)
      }
      const voice =
        typeof ttsVoice === 'string' && ttsVoice.trim().length > 0 ? ttsVoice.trim() : 'af_sky'
      try {
        const { audio, revoke } = await fetchTtsAudio({ text, voice })
        coachTtsRevokeRef.current = revoke
        await new Promise((resolve) => {
          let settled = false
          const finish = () => {
            if (settled) {
              return
            }
            settled = true
            if (coachTtsRevokeRef.current === revoke) {
              coachTtsRevokeRef.current = null
            }
            try {
              revoke()
            } catch {
              /* ignore */
            }
            resolve()
          }
          audio.addEventListener('ended', finish, { once: true })
          audio.addEventListener('error', finish, { once: true })
          void audio.play().catch(finish)
        })
      } catch {
        coachTtsRevokeRef.current = null
      }
    },
    [stopCoachTts, ttsVoice],
  )

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
        const [response, frustrationResponse] = await Promise.all([
          fetch(
            `${API_BASE_URL}/api/items/queue/${safeSkillName}?session_id=${encodeURIComponent(sessionId)}`,
          ),
          fetch(
            `${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/frustration-context`,
          ),
        ])

        if (!response.ok) {
          throw new Error(`Queue request failed with ${response.status}`)
        }

        const frustrationPayload = await frustrationResponse.json().catch(() => ({}))
        const nextStudentId =
          typeof frustrationPayload?.student_id === 'string' &&
          isUuid(frustrationPayload.student_id)
            ? frustrationPayload.student_id.trim()
            : ''
        if (frustrationResponse.ok && nextStudentId) {
          setSessionStudentId(nextStudentId)
        }
        if (
          frustrationResponse.ok &&
          typeof frustrationPayload?.frustration_time_threshold_seconds === 'number'
        ) {
          const sec = Math.min(
            600,
            Math.max(20, frustrationPayload.frustration_time_threshold_seconds),
          )
          setFrustrationTimeMs(sec * 1000)
        }

        const payload = await response.json()
        const normalizedQueue = Array.isArray(payload?.queue) ? payload.queue : []
        if (!isMounted) {
          return
        }

        if (normalizedQueue.length === 0) {
          setErrorMessage(
            'No practice problems were ready. Check your connection or start again from Today.',
          )
          setQueue([])
          setCurrentIndex(0)
          return
        }

        setQueue(normalizedQueue)
        setCurrentIndex(0)
      } catch (error) {
        if (!isMounted) {
          return
        }
        let message = error instanceof Error ? error.message : 'Could not load queue.'
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          message =
            'You appear to be offline. Connect to the internet, then try loading again from Today.'
        }
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

  const runFrustrationEval = useCallback(async (metrics) => {
    if (!sessionId || breakOfferReasonRef.current) {
      return
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/frustration-eval`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metrics),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.offer_break) {
        return
      }
      const trigger = payload.brain_break_trigger
      if (
        trigger === 'auto_two_wrong' ||
        trigger === 'auto_slow' ||
        trigger === 'agent_predicted'
      ) {
        setBreakOfferReason(trigger)
      }
    } catch {
      /* ignore */
    }
  }, [sessionId])

  const applyLocalFrustrationOffer = useCallback((sessionState) => {
    if (breakOfferReasonRef.current) {
      return false
    }
    const result = evaluateFrustrationSignals(tuningRowsRef.current, sessionState)
    if (!result.shouldOffer || typeof result.reason !== 'string') {
      return false
    }
    setBreakOfferReason(result.reason)
    return true
  }, [])

  useEffect(() => {
    if (!currentItem) {
      return
    }
    setAnswer('')
    setWritingRubric(null)
    setWritingEncouragement('')
    setWritingSubmissionComplete(false)
    setReadingQuestionIndex(0)
    setItemRenderedAtMs(Date.now())
    slowTriggerItemIdRef.current = ''
    setSpellingUseKeyboard(false)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [currentItem?.item_id])

  useEffect(() => {
    if (safeSkillName !== 'reading') {
      return
    }
    setAnswer('')
    setItemRenderedAtMs(Date.now())
    slowTriggerItemIdRef.current = ''
  }, [readingQuestionIndex, safeSkillName])

  useEffect(() => {
    if (!currentItem || breakOfferReason) {
      return
    }

    const timer = window.setTimeout(() => {
      const rqKey =
        safeSkillName === 'reading'
          ? `${currentItem.item_id}-${readingQuestionIndex}`
          : currentItem.item_id
      if (slowTriggerItemIdRef.current === rqKey) {
        return
      }
      slowTriggerItemIdRef.current = rqKey
      const elapsed = Math.min(
        600,
        Math.max(
          0,
          Math.round((Date.now() - itemRenderedAtMsRef.current) / 1000),
        ),
      )
      const sessionState = {
        consecutiveWrong: consecutiveWrongRef.current,
        secondsOnCurrentItem: elapsed,
        sessionAttemptCount: attemptStatsRef.current.attempted,
      }
      const localTriggered = applyLocalFrustrationOffer(sessionState)
      if (!localTriggered) {
        void runFrustrationEval({
        consecutive_wrong: consecutiveWrongRef.current,
        seconds_on_current_item: elapsed,
        session_attempt_count: attemptStatsRef.current.attempted,
        })
      }
    }, frustrationTimeMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    breakOfferReason,
    currentItem?.item_id,
    frustrationTimeMs,
    readingQuestionIndex,
    runFrustrationEval,
    applyLocalFrustrationOffer,
    safeSkillName,
  ])

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
            writing_rubric: writingRubric,
            writing_encouragement: writingEncouragement,
          },
        },
      })
    },
    [navigate, safeSkillName, sessionId, sessionStartedAtMs, tierChanges, writingRubric, writingEncouragement],
  )

  const handleSubmitAttempt = async () => {
    if (!currentItem || !sessionId || isBusy) {
      return
    }
    if (safeSkillName === 'writing' && writingSubmissionComplete) {
      navigateToComplete({ attempted: attemptStats.attempted, correct: attemptStats.correct })
      return
    }
    const trimmed = answer.trim()
    if (trimmed.length === 0) {
      return
    }
    if (safeSkillName === 'writing' && countWords(trimmed) <= 10) {
      return
    }

    const elapsedSeconds = computeResponseSeconds()

    const body = {
      session_id: sessionId,
      answer: trimmed,
      response_seconds: elapsedSeconds,
    }
    if (safeSkillName === 'reading') {
      body.reading_question_index = readingQuestionIndex
    }
    if (
      safeSkillName === 'math' ||
      safeSkillName === 'reading' ||
      safeSkillName === 'jiujitsu' ||
      safeSkillName === 'programming'
    ) {
      body.hint_used = Boolean(hintUsedForCurrentItemRef.current)
    }

    try {
      setIsSubmitting(true)
      setErrorMessage('')
      const response = await fetch(
        `${API_BASE_URL}/api/items/${encodeURIComponent(currentItem.item_id)}/attempt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
      const nextWrongCount = wasCorrect ? 0 : consecutiveWrongCount + 1
      setConsecutiveWrongCount(nextWrongCount)

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
      const explanationText = coachBodyAfterAttempt(
        safeSkillName,
        typeof payload.explanation === 'string' ? payload.explanation : '',
      )
      setCoachState({
        tone: wasCorrect ? 'correct' : 'incorrect',
        label: wasCorrect ? '✓ Coach says' : '↺ Coach says',
        title: feedbackText,
        body: explanationText,
      })

      const speakPromise = speakCoachAfterAttempt(feedbackText, explanationText)

      if (safeSkillName === 'writing') {
        const rubricFromAttempt =
          payload?.user_response?.writing_rubric &&
          typeof payload.user_response.writing_rubric === 'object'
            ? payload.user_response.writing_rubric
            : null
        if (rubricFromAttempt) {
          setWritingRubric(rubricFromAttempt)
        } else if (payload?.writing_rubric && typeof payload.writing_rubric === 'object') {
          setWritingRubric(payload.writing_rubric)
        }
        setWritingEncouragement(
          typeof payload?.encouragement === 'string' ? payload.encouragement : '',
        )
      }

      if (Boolean(payload.sessionComplete)) {
        if (safeSkillName === 'writing') {
          setWritingSubmissionComplete(true)
          void speakPromise
          return
        }
        await awaitCoachSpeakOrCap(speakPromise)
        navigateToComplete({ attempted: nextAttempted, correct: nextCorrect })
        return
      }

      const queueExhausted =
        safeSkillName !== 'reading' &&
        (!payload.next_item || currentIndex + 1 >= totalCount)

      if (queueExhausted) {
        await awaitCoachSpeakOrCap(speakPromise)
        navigateToComplete({ attempted: nextAttempted, correct: nextCorrect })
        return
      }

      const stayOnPassage =
        safeSkillName === 'reading' && readingQuestionIndex < 2 && totalCount > 0

      if (stayOnPassage) {
        void speakPromise
        setReadingQuestionIndex((index) => index + 1)
        const sessionState = {
          consecutiveWrong: nextWrongCount,
          secondsOnCurrentItem: elapsedSeconds,
          sessionAttemptCount: nextAttempted,
        }
        const localTriggered = applyLocalFrustrationOffer(sessionState)
        if (!localTriggered) {
          await runFrustrationEval({
            consecutive_wrong: nextWrongCount,
            seconds_on_current_item: elapsedSeconds,
            session_attempt_count: nextAttempted,
          })
        }
        return
      }

      void speakPromise
      setReadingQuestionIndex(0)
      setCurrentIndex((index) => index + 1)
      const sessionState = {
        consecutiveWrong: nextWrongCount,
        secondsOnCurrentItem: elapsedSeconds,
        sessionAttemptCount: nextAttempted,
      }
      const localTriggered = applyLocalFrustrationOffer(sessionState)
      if (!localTriggered) {
        await runFrustrationEval({
          consecutive_wrong: nextWrongCount,
          seconds_on_current_item: elapsedSeconds,
          session_attempt_count: nextAttempted,
        })
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Could not submit attempt.'
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        message =
          'You appear to be offline. Reconnect, then try checking your answer again.'
      }
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

  const hintEligible =
    safeSkillName === 'math' ||
    safeSkillName === 'reading' ||
    safeSkillName === 'jiujitsu' ||
    safeSkillName === 'programming'

  const handleHint = async () => {
    if (!currentItem || isBusy || !hintEligible) {
      return
    }

    try {
      setIsLoadingHint(true)
      setErrorMessage('')
      const hintBody = {
        item_id: currentItem.item_id,
        response_so_far: answer,
      }
      if (safeSkillName === 'reading') {
        hintBody.reading_question_index = readingQuestionIndex
      }
      const response = await fetch(`${API_BASE_URL}/api/ai/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hintBody),
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
        label: 'One step at a time',
        title: 'Try this next.',
        body: hintText,
      })
      hintUsedForCurrentItemRef.current = true
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

  const handleStuckClick = async () => {
    if (!currentItem || isBusy) {
      return
    }

    if (hintEligible) {
      await handleHint()
      return
    }

    if (safeSkillName === 'spelling' && spellingWord.trim().length > 0) {
      const w = spellingWord.trim()
      const first = w.slice(0, 1).toUpperCase()
      setCoachState({
        tone: 'hint',
        label: 'One step at a time',
        title: 'Spell it one piece at a time.',
        body: `This word has ${w.length} letters. It starts with “${first}”. Tap Hear again, say the sounds slowly, then try typing again.`,
      })
      return
    }

    if (safeSkillName === 'typing') {
      setCoachState({
        tone: 'hint',
        label: 'One step at a time',
        title: 'Chunk the sentence.',
        body: 'Type the first few words, then the next group. You can delete and rebuild—this is practice.',
      })
      return
    }

    if (safeSkillName === 'writing') {
      setCoachState({
        tone: 'hint',
        label: 'One step at a time',
        title: 'Start with one sentence.',
        body: 'Answer the prompt with just your first sentence. When that feels okay, add the next.',
      })
      return
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmitAttempt()
    }
  }

  const handleTakeBrainBreak = () => {
    if (!sessionId) {
      return
    }
    navigate('/break', {
      state: {
        sessionId,
        skillName: safeSkillName,
        returnTo: `/practice/${safeSkillName}`,
        triggeredBy: breakOfferReason || 'user_button',
        durationSeconds: 180,
      },
    })
  }

  const handleSkipBrainBreak = () => {
    setBreakOfferReason('')
  }

  const progressPercent = useMemo(() => {
    if (totalCount === 0) {
      return 0
    }
    if (safeSkillName === 'reading') {
      const step = currentIndex * 3 + readingQuestionIndex + 1
      const totalSteps = totalCount * 3
      return Math.round((step / totalSteps) * 100)
    }
    return Math.round(((currentIndex + (currentItem ? 0 : 1)) / totalCount) * 100)
  }, [
    currentIndex,
    currentItem,
    readingQuestionIndex,
    safeSkillName,
    totalCount,
  ])

  const progressPillText = useMemo(() => {
    if (totalCount === 0) {
      return 'Loading…'
    }
    if (safeSkillName === 'reading') {
      return `Passage ${Math.min(currentIndex + 1, totalCount)} of ${totalCount} · Question ${readingQuestionIndex + 1} of 3 · No timer`
    }
    return `Question ${Math.min(currentIndex + 1, totalCount)} of ${totalCount} · No timer`
  }, [currentIndex, readingQuestionIndex, safeSkillName, totalCount])

  const renderSessionDots = () => {
    const dotCount =
      safeSkillName === 'reading' ? Math.max(totalCount * 3, 1) : Math.max(totalCount, 1)
    const activeStep =
      safeSkillName === 'reading' ? currentIndex * 3 + readingQuestionIndex : currentIndex
    const dots = []
    for (let index = 0; index < dotCount; index += 1) {
      let className = 'session-dot'
      if (index < activeStep) {
        className += ' done'
      } else if (index === activeStep && currentItem) {
        className += ' current'
      }
      dots.push(<div key={`dot-${index}`} className={className} />)
    }
    return dots
  }

  const inputDisabled = !currentItem || isBusy
  const writingWordCount = countWords(answer)
  const submitDisabled =
    !currentItem ||
    isBusy ||
    (safeSkillName === 'writing'
      ? (writingSubmissionComplete ? false : writingWordCount <= 10)
      : answer.trim().length === 0)

  const renderSkillBody = () => {
    if (!currentItem || isLoadingQueue) {
      return (
        <div className="activity-question">Picking your problems…</div>
      )
    }

    if (safeSkillName === 'math') {
      return (
        <MathSkillView
          currentItem={currentItem}
          structuredSteps={structuredSteps}
          promptText={promptText}
          isBusy={isBusy}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
          voiceMathEnabled={Boolean(voiceMathEnabled && speechRecognitionSupported)}
        />
      )
    }

    if (safeSkillName === 'jiujitsu') {
      return (
        <MathSkillView
          currentItem={currentItem}
          structuredSteps={structuredSteps}
          promptText={promptText}
          isBusy={isBusy}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
          voiceMathEnabled={false}
        />
      )
    }

    if (safeSkillName === 'programming') {
      return (
        <MathSkillView
          currentItem={currentItem}
          structuredSteps={structuredSteps}
          promptText={promptText}
          isBusy={isBusy}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
          voiceMathEnabled={false}
        />
      )
    }

    if (safeSkillName === 'reading') {
      return (
        <ReadingSkillView
          passage={readingPassage}
          questionText={currentReadingQuestionText}
          readingQuestionIndex={readingQuestionIndex}
          passageTitle={readingTitle}
          bookAttribution={readingBookAttribution}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
        />
      )
    }

    if (safeSkillName === 'spelling') {
      return (
        <SpellingSkillView
          poolLabel={spellingPoolLabel}
          wordToSpell={spellingWord}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
          spellWithVoiceOnly={Boolean(
            voiceSpellingEnabled && speechRecognitionSupported && !spellingUseKeyboard,
          )}
          onRequestTypingFallback={() => {
            setSpellingUseKeyboard(true)
          }}
        />
      )
    }

    if (safeSkillName === 'typing') {
      return (
        <TypingSkillView
          targetSentence={promptText}
          liveWpm={liveWpm}
          liveAccuracy={liveAccuracy}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled}
        />
      )
    }

    if (safeSkillName === 'writing') {
      return (
        <WritingSkillView
          promptText={promptText}
          wordCountGuidance={writingWordCountGuidance}
          answer={answer}
          onAnswerChange={setAnswer}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          inputDisabled={inputDisabled || writingSubmissionComplete}
          writingRubric={writingRubric}
          encouragement={writingEncouragement}
        />
      )
    }

    return (
      <div className="activity-question">{promptText || 'Ready when you are.'}</div>
    )
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
            <span className="progress-pill">{progressPillText}</span>
          </div>

          <div className="progress-bar">
            <div style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="learner-text-scope">
            {renderSkillBody()}

            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={safeSkillName === 'spelling' ? speakSpellingWord : handleHint}
                disabled={!currentItem || isBusy || (safeSkillName === 'spelling' ? false : !hintEligible)}
              >
                {safeSkillName === 'spelling'
                  ? 'Hear again'
                  : isLoadingHint
                    ? 'Finding a hint…'
                    : 'Hint'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmitAttempt}
                disabled={submitDisabled}
              >
                {isSubmitting
                  ? 'Checking your answer…'
                  : writingSubmissionComplete
                    ? 'Finish session →'
                    : 'Check my answer →'}
              </button>
            </div>

            <div className="stuck-row">
              <span>Brain feeling foggy?</span>
              <button
                type="button"
                className="stuck-btn"
                onClick={handleStuckClick}
                disabled={!currentItem || isBusy}
                aria-label="Stuck? Get help with just one small step instead of the whole thing at once"
              >
                Stuck? Help one step at a time
              </button>
            </div>
          </div>
        </div>

        <aside className="activity-sidebar">
          <div className="learner-text-scope">
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
            <button
              type="button"
              className="btn btn-secondary brain-break-card-btn"
              onClick={() => setBreakOfferReason('user_button')}
            >
              Take a brain break
            </button>
          </div>
          </div>

          <div className="session-progress">
            <h5>Today&apos;s session</h5>
            <div className="session-dots">{renderSessionDots()}</div>
          </div>
        </aside>
      </div>
      {breakOfferReason ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="break-offer-modal learner-text-scope"
            role="dialog"
            aria-modal="true"
            aria-label="Take a quick brain break"
          >
            <h3>Want a quick brain break?</h3>
            <p>
              {breakOfferReason === 'auto_two_wrong'
                ? 'Two tough questions in a row can happen. A 3-minute breathing break may help.'
                : breakOfferReason === 'auto_slow'
                  ? "You've been on this one for a while. Want a short reset?"
                  : breakOfferReason === 'agent_predicted'
                    ? 'Patterns from your sessions suggest a short breathing break might help right now.'
                    : 'If your brain feels tired, we can pause for a quick breathing break.'}
            </p>
            <div className="break-offer-actions">
              <button type="button" className="btn btn-primary" onClick={handleTakeBrainBreak}>
                Take a break
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleSkipBrainBreak}>
                Keep going
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default PracticePage
