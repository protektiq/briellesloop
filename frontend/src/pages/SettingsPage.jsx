import { useCallback, useEffect, useState } from 'react'

const API_BASE_URL = 'http://localhost:3001'
const PIN_REGEX = /^\d{4}$/

const SettingsPage = () => {
  const [configured, setConfigured] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

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
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not save PIN.')
      } finally {
        setIsSaving(false)
      }
    },
    [pin, confirmPin, studentId],
  )

  return (
    <section className="settings-section">
      <div className="settings-card">
        <h1 className="settings-title">Settings</h1>
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
    </section>
  )
}

export default SettingsPage
