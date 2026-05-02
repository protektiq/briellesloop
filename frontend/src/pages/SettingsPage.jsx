import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL, FONT_STEP_STORAGE_KEY, FONT_STEPS } from '../constants/api'
import {
  applyFontStepToDocument,
  getStoredFontStep,
  notifyProfileChanged,
} from '../hooks/useBodyFontPreference'

const PIN_REGEX = /^\d{4}$/

const splitInterests = (raw) => {
  if (typeof raw !== 'string') {
    return []
  }
  return raw
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((s) => s.slice(0, 40))
}

const skillTitle = (name) => {
  if (typeof name !== 'string' || name.length === 0) {
    return 'Skill'
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const FONT_OPTIONS = [
  { step: '0', label: 'Standard' },
  { step: '1', label: 'Larger' },
  { step: '2', label: 'Large' },
  { step: '3', label: 'Extra large' },
]

const SettingsPage = () => {
  const [fontStep, setFontStep] = useState(() => getStoredFontStep())
  const [configured, setConfigured] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [agentsList, setAgentsList] = useState([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState('')
  const [agentBusy, setAgentBusy] = useState('')

  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [interestsRaw, setInterestsRaw] = useState('')
  const [iepBySkill, setIepBySkill] = useState(() => ({}))
  const [levelBySkill, setLevelBySkill] = useState(() => ({}))
  const [sessionItems, setSessionItems] = useState(5)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`${API_BASE_URL}/api/settings/parent-pin`)
        if (!response.ok) {
          throw new Error(`Could not load settings (${response.status})`)
        }
        const data = await response.json()
        if (cancelled) {
          return
        }
        setConfigured(data.configured === true)
        if (typeof data.student_id === 'string') {
          setStudentId(data.student_id)
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      try {
        setProfileLoading(true)
        setProfileError('')
        const response = await fetch(`${API_BASE_URL}/api/settings/profile`)
        if (!response.ok) {
          throw new Error(`Could not load profile (${response.status})`)
        }
        const data = await response.json()
        if (cancelled) {
          return
        }
        if (typeof data.student_id === 'string') {
          setStudentId(data.student_id)
        }
        const interests = Array.isArray(data.interests) ? data.interests : []
        setInterestsRaw(interests.join(', '))
        const iep = {}
        const lvl = {}
        if (Array.isArray(data.skills)) {
          for (const row of data.skills) {
            if (row && typeof row.name === 'string') {
              iep[row.name] = typeof row.iep_goal_text === 'string' ? row.iep_goal_text : ''
              const lv = Number.parseInt(String(row.level), 10)
              lvl[row.name] = Number.isInteger(lv) ? lv : 1
            }
          }
        }
        setIepBySkill(iep)
        setLevelBySkill(lvl)
        const count = Number.parseInt(String(data.session_item_count), 10)
        setSessionItems(Number.isInteger(count) ? Math.min(10, Math.max(3, count)) : 5)
      } catch (err) {
        if (!cancelled) {
          setProfileError(err instanceof Error ? err.message : 'Profile unavailable.')
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false)
        }
      }
    }

    loadProfile()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadAgents = async () => {
      try {
        setAgentsLoading(true)
        setAgentsError('')
        const response = await fetch(`${API_BASE_URL}/api/agents`)
        if (!response.ok) {
          throw new Error(`Could not load agents (${response.status})`)
        }
        const data = await response.json()
        if (!cancelled && Array.isArray(data.agents)) {
          setAgentsList(data.agents)
        }
      } catch (err) {
        if (!cancelled) {
          setAgentsError(err instanceof Error ? err.message : 'Agents unavailable.')
        }
      } finally {
        if (!cancelled) {
          setAgentsLoading(false)
        }
      }
    }

    loadAgents()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePinChange = useCallback((event) => {
    const digits = String(event?.target?.value ?? '').replace(/\D/g, '').slice(0, 4)
    setPin(digits)
    setMessage('')
    setErrorMessage('')
  }, [])

  const handleConfirmChange = useCallback((event) => {
    const digits = String(event?.target?.value ?? '').replace(/\D/g, '').slice(0, 4)
    setConfirmPin(digits)
    setMessage('')
    setErrorMessage('')
  }, [])

  const handleAgentToggle = useCallback(async (name, nextEnabled) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length < 2 || trimmed.length > 24) {
      return
    }
    setAgentBusy(trimmed)
    setAgentsError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/${trimmed}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error ?? `Update failed (${response.status})`)
      }
      setAgentsList((prev) =>
        prev.map((row) =>
          row.name === trimmed ? { ...row, enabled: body.enabled === true } : row,
        ),
      )
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : 'Could not update agent.')
    } finally {
      setAgentBusy('')
    }
  }, [])

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      setMessage('')
      setErrorMessage('')

      if (!PIN_REGEX.test(pin) || !PIN_REGEX.test(confirmPin)) {
        setErrorMessage('PIN and confirmation must be exactly 4 digits.')
        return
      }

      if (pin !== confirmPin) {
        setErrorMessage('PIN and confirmation do not match.')
        return
      }

      try {
        setIsSaving(true)
        const body = { pin, confirm_pin: confirmPin }
        if (studentId) {
          body.student_id = studentId
        }
        const response = await fetch(`${API_BASE_URL}/api/settings/parent-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.message ?? `Save failed (${response.status})`)
        }

        setMessage('PIN saved. Parent view will ask for it until you unlock once per browser.')
        setConfigured(true)
        setPin('')
        setConfirmPin('')
        if (typeof data.student_id === 'string') {
          setStudentId(data.student_id)
        }
        notifyProfileChanged()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not save PIN.')
      } finally {
        setIsSaving(false)
      }
    },
    [pin, confirmPin, studentId],
  )

  const handleFontStepClick = useCallback((step) => {
    const safe = FONT_STEPS.includes(String(step)) ? String(step) : '0'
    setFontStep(safe)
    try {
      window.localStorage.setItem(FONT_STEP_STORAGE_KEY, safe)
    } catch {
      /* ignore */
    }
    applyFontStepToDocument(safe)
  }, [])

  const handleSaveLearnerProfile = useCallback(async () => {
    setProfileMessage('')
    setProfileError('')
    const interests = splitInterests(interestsRaw)

    const iep_goals = {}
    const skill_levels = {}
    for (const key of Object.keys(iepBySkill)) {
      iep_goals[key] = iepBySkill[key] ?? ''
    }
    for (const key of Object.keys(levelBySkill)) {
      const n = Number.parseInt(String(levelBySkill[key]), 10)
      if (Number.isInteger(n) && n >= 1 && n <= 10) {
        skill_levels[key] = n
      }
    }

    try {
      setProfileSaving(true)
      const payload = {
        interests,
        iep_goals,
        skill_levels,
        session_item_count: sessionItems,
      }
      if (studentId) {
        payload.student_id = studentId
      }
      const response = await fetch(`${API_BASE_URL}/api/settings/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? `Save failed (${response.status})`)
      }
      setProfileMessage('Learner profile saved.')
      notifyProfileChanged()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not save profile.')
    } finally {
      setProfileSaving(false)
    }
  }, [iepBySkill, interestsRaw, levelBySkill, sessionItems, studentId])

  const handleSessionItemsChange = useCallback((event) => {
    const v = Number.parseInt(String(event.target.value), 10)
    if (!Number.isInteger(v)) {
      return
    }
    setSessionItems(Math.min(10, Math.max(3, v)))
  }, [])

  const skillNames = Object.keys(iepBySkill).sort()

  return (
    <section className="settings-section">
      <div className="settings-card settings-card-wide">
        <h1 className="settings-title">Learner profile</h1>
        <p className="settings-lead">
          Interests feed AI prompts. IEP goal text is shown on exports and to agents. Level is the
          difficulty band for each skill (you can still change it anytime). Session length is how
          many items load per practice session (about ten minutes when set to six for most days).
        </p>

        {profileLoading ? (
          <p role="status">Loading learner profile…</p>
        ) : (
          <>
            {profileError ? (
              <p className="settings-error" role="alert">
                {profileError}
              </p>
            ) : null}
            {profileMessage ? (
              <p className="settings-success" role="status">
                {profileMessage}
              </p>
            ) : null}

            <label className="settings-label" htmlFor="settings-interests">
              Interests (comma-separated, up to eight)
            </label>
            <textarea
              id="settings-interests"
              className="settings-input settings-input-wide settings-textarea"
              rows={2}
              value={interestsRaw}
              onChange={(e) => setInterestsRaw(e.target.value)}
            />

            <div className="settings-field-row">
              <div>
                <label className="settings-label" htmlFor="settings-session-items">
                  Items per session (3–10)
                </label>
                <input
                  id="settings-session-items"
                  className="settings-input"
                  type="number"
                  min={3}
                  max={10}
                  value={sessionItems}
                  onChange={handleSessionItemsChange}
                />
              </div>
              <div>
                <span className="settings-label" id="settings-font-label">
                  Reading size for practice text only
                </span>
                <div className="settings-font-row" role="group" aria-labelledby="settings-font-label">
                  {FONT_OPTIONS.map((opt) => (
                    <button
                      key={opt.step}
                      type="button"
                      className={fontStep === opt.step ? 'primary-btn' : 'ghost-btn'}
                      aria-pressed={fontStep === opt.step}
                      onClick={() => handleFontStepClick(opt.step)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {skillNames.map((name) => (
              <div key={name} className="settings-skill-block">
                <div className="settings-skill-heading">
                  <h2 className="settings-skill-title">{skillTitle(name)}</h2>
                  <label className="settings-inline-label" htmlFor={`level-${name}`}>
                    Level (1–10)
                  </label>
                  <input
                    id={`level-${name}`}
                    className="settings-input settings-input-narrow"
                    type="number"
                    min={1}
                    max={10}
                    value={levelBySkill[name] ?? 1}
                    onChange={(e) => {
                      const v = Number.parseInt(e.target.value, 10)
                      setLevelBySkill((prev) => ({
                        ...prev,
                        [name]: Number.isInteger(v) ? Math.min(10, Math.max(1, v)) : 1,
                      }))
                    }}
                  />
                </div>
                <label className="settings-label" htmlFor={`iep-${name}`}>
                  IEP goal text
                </label>
                <textarea
                  id={`iep-${name}`}
                  className="settings-input settings-input-wide settings-textarea"
                  rows={3}
                  value={iepBySkill[name] ?? ''}
                  onChange={(e) =>
                    setIepBySkill((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                />
              </div>
            ))}

            <button
              type="button"
              className="primary-btn settings-submit"
              onClick={handleSaveLearnerProfile}
              disabled={profileSaving}
            >
              {profileSaving ? 'Saving…' : 'Save learner profile'}
            </button>
          </>
        )}
      </div>

      <div className="settings-card settings-card-wide" style={{ marginTop: 28 }}>
        <h2 className="settings-title">Parent PIN</h2>
        <p className="settings-lead">
          Parent PIN protects <strong>/parent</strong> on this browser. It is hashed on the server;
          clear session storage or the PIN here if you forget it.
        </p>

        {isLoading ? (
          <p role="status">Loading…</p>
        ) : (
          <form className="settings-form" onSubmit={handleSubmit}>
            <p className="settings-status">
              Parent PIN:{' '}
              <strong>{configured ? 'On file' : 'Not set yet'}</strong>
            </p>

            <label className="settings-label" htmlFor="settings-pin">
              New PIN (4 digits)
            </label>
            <input
              id="settings-pin"
              className="settings-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={pin}
              onChange={handlePinChange}
              aria-required="true"
            />

            <label className="settings-label" htmlFor="settings-pin-confirm">
              Confirm PIN
            </label>
            <input
              id="settings-pin-confirm"
              className="settings-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={confirmPin}
              onChange={handleConfirmChange}
              aria-required="true"
            />

            {errorMessage ? (
              <p className="settings-error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            {message ? (
              <p className="settings-success" role="status">
                {message}
              </p>
            ) : null}

            <button type="submit" className="primary-btn settings-submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save parent PIN'}
            </button>
          </form>
        )}
      </div>

      <div className="settings-card settings-card-wide" style={{ marginTop: 28 }}>
        <h2 className="settings-title">Background agents</h2>
        <p className="settings-lead">
          Turn individual agents off if you want to pause automated scheduling. The daily practice
          loop still works; disabling stops cron-triggered runs until you turn them back on. Manual
          test runs from the developer API still respect each agent&apos;s enabled flag.
        </p>
        {agentsLoading ? <p role="status">Loading agents…</p> : null}
        {agentsError ? (
          <p className="settings-error" role="alert">
            {agentsError}
          </p>
        ) : null}
        {!agentsLoading && agentsList.length > 0 ? (
          <ul className="settings-agent-list">
            {agentsList.map((agent) => (
              <li key={agent.name} className="settings-agent-row">
                <div>
                  <div className="settings-agent-name">{agent.name}</div>
                  <div className="settings-agent-meta">
                    Schedule <code>{agent.schedule_cron}</code>
                  </div>
                </div>
                <button
                  type="button"
                  className={agent.enabled === false ? 'ghost-btn' : 'primary-btn'}
                  disabled={agentBusy === agent.name}
                  aria-pressed={agent.enabled === true}
                  aria-label={`Toggle ${agent.name} agent`}
                  onClick={() => handleAgentToggle(agent.name, agent.enabled !== true)}
                >
                  {agent.enabled === false ? 'Enable' : 'Disable'}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

export default SettingsPage
