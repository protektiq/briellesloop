import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../constants/api'
import { notifyProfileChanged } from '../hooks/useBodyFontPreference'

const PIN_REGEX = /^\d{4}$/

const splitInterests = (raw) => {
  if (typeof raw !== 'string') {
    return []
  }
  const parts = raw.split(/[,|\n]/).map((s) => s.trim()).filter(Boolean)
  return parts.slice(0, 8).map((s) => s.slice(0, 40))
}

const OnboardingPage = () => {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [studentId, setStudentId] = useState('')
  const [interestsRaw, setInterestsRaw] = useState('dogs, art')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [sessionItems, setSessionItems] = useState(6)
  const [errorMessage, setErrorMessage] = useState('')
  const [isBooting, setIsBooting] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
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
        if (Array.isArray(data.interests) && data.interests.length > 0) {
          setInterestsRaw(data.interests.join(', '))
        }
        const count = Number.parseInt(String(data.session_item_count), 10)
        if (Number.isInteger(count) && count >= 3 && count <= 10) {
          setSessionItems(count)
        }
        if (data.onboarding_completed_at != null) {
          navigate('/', { replace: true })
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not load.')
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const handlePinChange = useCallback((event) => {
    const digits = String(event?.target?.value ?? '').replace(/\D/g, '').slice(0, 4)
    setPin(digits)
    setErrorMessage('')
  }, [])

  const handleConfirmChange = useCallback((event) => {
    const digits = String(event?.target?.value ?? '').replace(/\D/g, '').slice(0, 4)
    setConfirmPin(digits)
    setErrorMessage('')
  }, [])

  const handleSessionItemsChange = useCallback((event) => {
    const v = Number.parseInt(String(event.target.value), 10)
    if (!Number.isInteger(v)) {
      return
    }
    setSessionItems(Math.min(10, Math.max(3, v)))
  }, [])

  const handleFinish = useCallback(async () => {
    setErrorMessage('')
    const interests = splitInterests(interestsRaw)
    if (interests.length === 0) {
      setErrorMessage('Add at least one interest (e.g. dogs, drawing).')
      return
    }
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
      const sidPayload = studentId ? { student_id: studentId } : {}

      const patchResponse = await fetch(`${API_BASE_URL}/api/settings/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...sidPayload,
          interests,
          session_item_count: sessionItems,
        }),
      })
      const patchBody = await patchResponse.json().catch(() => ({}))
      if (!patchResponse.ok) {
        throw new Error(patchBody.error ?? `Profile save failed (${patchResponse.status})`)
      }

      const pinResponse = await fetch(`${API_BASE_URL}/api/settings/parent-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin,
          confirm_pin: confirmPin,
          ...sidPayload,
        }),
      })
      const pinBody = await pinResponse.json().catch(() => ({}))
      if (!pinResponse.ok) {
        throw new Error(pinBody.message ?? `PIN save failed (${pinResponse.status})`)
      }

      const doneResponse = await fetch(`${API_BASE_URL}/api/settings/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sidPayload),
      })
      if (!doneResponse.ok) {
        const doneBody = await doneResponse.json().catch(() => ({}))
        throw new Error(doneBody.error ?? `Onboarding finalize failed (${doneResponse.status})`)
      }

      notifyProfileChanged()
      navigate('/', { replace: true })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not finish setup.')
    } finally {
      setIsSaving(false)
    }
  }, [confirmPin, interestsRaw, navigate, pin, sessionItems, studentId])

  const handleNext = useCallback(() => {
    setErrorMessage('')
    if (step === 0) {
      const interests = splitInterests(interestsRaw)
      if (interests.length === 0) {
        setErrorMessage('Add at least one interest.')
        return
      }
      setStep(1)
      return
    }
    if (step === 1) {
      if (!PIN_REGEX.test(pin) || !PIN_REGEX.test(confirmPin)) {
        setErrorMessage('PIN and confirmation must be exactly 4 digits.')
        return
      }
      if (pin !== confirmPin) {
        setErrorMessage('PIN and confirmation do not match.')
        return
      }
      setStep(2)
    }
  }, [confirmPin, interestsRaw, pin, step])

  const handleBack = useCallback(() => {
    setErrorMessage('')
    setStep((s) => Math.max(0, s - 1))
  }, [])

  if (isBooting) {
    return (
      <section className="onboarding-section" aria-busy="true">
        <p role="status">Loading setup…</p>
      </section>
    )
  }

  return (
    <section className="onboarding-section">
      <div className="onboarding-card">
        <h1 className="settings-title">Welcome — let&apos;s set things up</h1>
        <p className="settings-lead">
          This short setup is for the grown-up on this computer: Brielle can skip it once it&apos;s
          done. Start with her interests, then a parent PIN, then how many practice items feel right
          for about ten minutes (you can change this anytime in Settings).
        </p>

        <div className="onboarding-steps" aria-live="polite">
          {step === 0 ? (
            <div>
              <label className="settings-label" htmlFor="onboarding-interests">
                Brielle&apos;s interests (comma-separated, up to eight)
              </label>
              <textarea
                id="onboarding-interests"
                className="settings-input onboarding-textarea"
                rows={3}
                value={interestsRaw}
                onChange={(e) => setInterestsRaw(e.target.value)}
                aria-required="true"
              />
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <label className="settings-label" htmlFor="onboarding-pin">
                Parent PIN (4 digits, unlocks the parent dashboard)
              </label>
              <input
                id="onboarding-pin"
                className="settings-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={pin}
                onChange={handlePinChange}
                aria-required="true"
              />
              <label className="settings-label" htmlFor="onboarding-pin-confirm">
                Confirm PIN
              </label>
              <input
                id="onboarding-pin-confirm"
                className="settings-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={confirmPin}
                onChange={handleConfirmChange}
                aria-required="true"
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <label className="settings-label" htmlFor="onboarding-session-items">
                Items per session (about 10 minutes — adjust anytime)
              </label>
              <input
                id="onboarding-session-items"
                className="settings-input"
                type="number"
                min={3}
                max={10}
                step={1}
                value={sessionItems}
                onChange={handleSessionItemsChange}
                aria-valuemin={3}
                aria-valuemax={10}
              />
              <p className="settings-lead" style={{ marginTop: 12 }}>
                Fewer items for lighter days; more when she has energy. The app uses this count when
                building each practice session.
              </p>
            </div>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="settings-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="ghost-btn" onClick={handleBack} disabled={isSaving}>
              Back
            </button>
          ) : null}
          {step < 2 ? (
            <button type="button" className="primary-btn" onClick={handleNext} disabled={isSaving}>
              Continue
            </button>
          ) : (
            <button type="button" className="primary-btn" onClick={handleFinish} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>

        <p className="settings-lead" style={{ marginTop: 24 }}>
          Need to pause? You can finish later from{' '}
          <Link to="/settings" className="inline-link">
            Settings
          </Link>
          .
        </p>
      </div>
    </section>
  )
}

export default OnboardingPage
