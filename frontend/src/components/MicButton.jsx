import { useEffect, useRef } from 'react'
import { useSpeechInput } from '../hooks/useSpeechInput.js'

const MicIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V20H8v2h8v-2h-3v-2.08A7 7 0 0 0 19 11h-2z" />
  </svg>
)

/**
 * @param {{ onTranscript: (text: string, meta?: { response_time_seconds: number }) => void, disabled?: boolean }} props
 */
export const MicButton = ({ onTranscript, disabled = false }) => {
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
    error,
    getLastListenSeconds,
  } = useSpeechInput()
  const wasListeningRef = useRef(false)

  useEffect(() => {
    if (wasListeningRef.current && !isListening) {
      const t = transcript.trim()
      if (t.length > 0) {
        onTranscript(t, { response_time_seconds: getLastListenSeconds() })
      }
    }
    wasListeningRef.current = isListening
  }, [getLastListenSeconds, isListening, onTranscript, transcript])

  if (!isSupported) {
    return null
  }

  const handleClick = () => {
    if (disabled) {
      return
    }
    if (isListening) {
      stopListening()
      return
    }
    startListening()
  }

  let stateClass = 'mic-btn-idle'
  if (error) {
    stateClass = 'mic-btn-error'
  } else if (isListening) {
    stateClass = 'mic-btn-listening'
  }

  const label = isListening ? 'Stop listening' : 'Speak your answer'

  return (
    <div className="mic-btn-wrap">
      <button
        type="button"
        className={`mic-btn ${stateClass}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isListening}
      >
        <MicIcon />
        <span className="mic-btn-label">{isListening ? 'Listening…' : 'Use microphone'}</span>
      </button>
      {error ? (
        <p className="mic-btn-error-text" role="status">
          {error === 'not-allowed'
            ? 'Microphone permission denied.'
            : error === 'no-speech'
              ? 'No speech detected — try again.'
              : error === 'audio-capture'
                ? 'No microphone found.'
                : 'Voice input had a problem.'}
        </p>
      ) : null}
    </div>
  )
}
