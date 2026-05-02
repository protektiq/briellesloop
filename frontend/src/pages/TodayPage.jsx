import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MoodCheckIn from '../components/MoodCheckIn'
import SkillTile from '../components/SkillTile'
import TodayPlanCard from '../components/TodayPlanCard'
import { API_BASE_URL } from '../constants/api'
const LOW_MOOD_EMOJIS = new Set(['😢', '😟'])
const SKILL_ICON_BY_NAME = {
  reading: '📖',
  math: '🔢',
  spelling: '✏️',
  typing: '⌨️',
}

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

const sanitizeSkillName = (value) => {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim().toLowerCase()
  if (!/^[a-z]{2,24}$/.test(trimmed)) {
    return ''
  }

  return trimmed
}

const normalizeSkill = (rawSkill) => {
  if (!rawSkill || typeof rawSkill !== 'object') {
    return null
  }

  const name = sanitizeSkillName(rawSkill.skill_name)
  if (!name) {
    return null
  }

  return {
    name,
    level: clampNumber(rawSkill.level, 1, 10, 1),
    durationMinutes: clampNumber(rawSkill.duration_minutes, 1, 60, 10),
    itemsDue: clampNumber(rawSkill.items_due, 0, 500, 0),
    currentAccuracy:
      typeof rawSkill.current_accuracy === 'number' && rawSkill.current_accuracy >= 0
        ? Math.min(rawSkill.current_accuracy, 1)
        : null,
  }
}

const normalizeSkillsResponse = (payload) => {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.skills)) {
    return null
  }

  const skills = payload.skills.map(normalizeSkill).filter(Boolean)
  if (skills.length === 0) {
    return null
  }

  const suggestedSkillName = sanitizeSkillName(payload.suggested_skill_name)
  const studentId =
    typeof payload.student_id === 'string' && payload.student_id.length >= 36
      ? payload.student_id
      : null

  return { skills, suggestedSkillName, studentId }
}

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const TodayPage = () => {
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [selectedSkillName, setSelectedSkillName] = useState('')
  const [suggestedSkillName, setSuggestedSkillName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [mood, setMood] = useState({ emoji: null, score: null, isSet: false })
  const [isLoadingSkills, setIsLoadingSkills] = useState(true)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadSkills = async () => {
      try {
        setIsLoadingSkills(true)
        setErrorMessage('')
        const response = await fetch(`${API_BASE_URL}/api/dashboard/skills`)
        if (!response.ok) {
          throw new Error(`Skills request failed with ${response.status}`)
        }

        const payload = await response.json()
        const normalized = normalizeSkillsResponse(payload)
        if (!normalized) {
          throw new Error('Skills payload was invalid.')
        }

        if (!isMounted) {
          return
        }

        setSkills(normalized.skills)
        setSuggestedSkillName(normalized.suggestedSkillName)
        if (normalized.studentId) {
          setStudentId(normalized.studentId)
        }

        const preferredSkill = normalized.skills.find(
          (skill) => skill.name === normalized.suggestedSkillName,
        )
        setSelectedSkillName(preferredSkill?.name ?? normalized.skills[0].name)
      } catch (error) {
        if (!isMounted) {
          return
        }

        let msg = error instanceof Error ? error.message : 'Could not load today plan.'
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          msg =
            'You appear to be offline. Connect to the internet, then refresh this page or try again.'
        }
        setErrorMessage(msg)
      } finally {
        if (isMounted) {
          setIsLoadingSkills(false)
        }
      }
    }

    loadSkills()
    return () => {
      isMounted = false
    }
  }, [])

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.name === selectedSkillName) ?? null,
    [selectedSkillName, skills],
  )

  const handleStartSession = async () => {
    if (isStartingSession || !mood.isSet || !selectedSkill || !isUuid(studentId)) {
      return
    }

    try {
      setIsStartingSession(true)
      setErrorMessage('')
      const response = await fetch(`${API_BASE_URL}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          skill: selectedSkill.name,
          pre_mood_emoji: mood.emoji,
          pre_mood_score: mood.score,
        }),
      })

      if (!response.ok) {
        throw new Error(`Start session failed with ${response.status}`)
      }

      const payload = await response.json()
      if (!payload || typeof payload !== 'object' || !isUuid(payload.session_id)) {
        throw new Error('Invalid session response payload.')
      }

      const moodIsLow =
        typeof mood.score === 'number' &&
        (mood.score <= 3 || (typeof mood.emoji === 'string' && LOW_MOOD_EMOJIS.has(mood.emoji)))

      if (moodIsLow) {
        navigate('/break', {
          state: {
            continueToPractice: false,
            skillName: selectedSkill.name,
            returnTo: `/practice/${selectedSkill.name}`,
            sessionId: payload.session_id,
            triggeredBy: 'low_mood',
            durationSeconds: 180,
          },
        })
        return
      }

      navigate(`/practice/${selectedSkill.name}`, {
        state: { sessionId: payload.session_id },
      })
    } catch (error) {
      let msg = error instanceof Error ? error.message : 'Could not start session.'
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        msg =
          'You appear to be offline. Connect to the internet before starting a session.'
      }
      setErrorMessage(msg)
    } finally {
      setIsStartingSession(false)
    }
  }

  return (
    <section className="session-hero">
      <div className="hero-left learner-text-scope">
        <div className="hero-meta">Today</div>
        <h1 className="hero-greeting">
          Hi, <em>Brielle.</em>
        </h1>
        <p className="hero-sub">Let&apos;s check in before we start.</p>
        <MoodCheckIn onChange={setMood} />
      </div>

      <div className="hero-right">
        <TodayPlanCard
          skillName={selectedSkill?.name ?? 'Reading'}
          level={selectedSkill?.level ?? 1}
          durationMinutes={selectedSkill?.durationMinutes ?? 10}
          moodIsSet={mood.isSet}
          disabled={isLoadingSkills || Boolean(errorMessage)}
          onStart={handleStartSession}
        />

        {isLoadingSkills ? (
          <div className="card-surface" role="status">
            Gathering your plan for today…
          </div>
        ) : null}

        {!isLoadingSkills && errorMessage ? <div className="card-surface">{errorMessage}</div> : null}

        {!isLoadingSkills && !errorMessage ? (
          <div className="skill-picker">
            {skills.map((skill) => (
              <SkillTile
                key={skill.name}
                icon={SKILL_ICON_BY_NAME[skill.name] ?? '📘'}
                name={skill.name}
                level={skill.level}
                durationMinutes={skill.durationMinutes}
                selected={skill.name === selectedSkillName}
                suggestedToday={skill.name === suggestedSkillName}
                onSelect={setSelectedSkillName}
              />
            ))}
          </div>
        ) : null}

        {isStartingSession ? <p className="today-inline-note">Starting your session…</p> : null}
      </div>
    </section>
  )
}

export default TodayPage
