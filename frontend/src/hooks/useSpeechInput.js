import { useCallback, useEffect, useRef, useState } from 'react'

const SILENCE_MS = 10_000

const getRecognitionCtor = () => {
  if (typeof window === 'undefined') {
    return null
  }
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

/**
 * Browser SpeechRecognition wrapper.
 * @returns {{ isListening: boolean, transcript: string, startListening: () => void, stopListening: () => void, isSupported: boolean, error: string }}
 */
export const useSpeechInput = () => {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [listenElapsedSeconds, setListenElapsedSeconds] = useState(0)
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const transcriptPartsRef = useRef([])
  const listenStartMsRef = useRef(0)
  const lastListenSecRef = useRef(0)
  const ctor = typeof window !== 'undefined' ? getRecognitionCtor() : null
  const isSupported = Boolean(ctor)

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stopListening = useCallback(() => {
    clearSilenceTimer()
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      try {
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        rec.onspeechstart = null
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    setIsListening(false)
  }, [clearSilenceTimer])

  useEffect(() => {
    return () => {
      stopListening()
    }
  }, [stopListening])

  const armSilenceTimer = useCallback(
    (rec) => {
      clearSilenceTimer()
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }, SILENCE_MS)
    },
    [clearSilenceTimer],
  )

  const startListening = useCallback(() => {
    const Recognition = getRecognitionCtor()
    if (!Recognition) {
      setError('not-supported')
      return
    }
    stopListening()
    setError('')
    setTranscript('')
    setListenElapsedSeconds(0)
    transcriptPartsRef.current = []
    listenStartMsRef.current = Date.now()

    const rec = new Recognition()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onstart = () => {
      armSilenceTimer(rec)
    }

    rec.onresult = (event) => {
      armSilenceTimer(rec)
      let piece = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        piece += event.results[i][0].transcript
      }
      if (piece.length > 0) {
        transcriptPartsRef.current.push(piece)
        setTranscript(transcriptPartsRef.current.join('').trim())
      }
    }

    const finishElapsed = () => {
      const rawMs = Date.now() - listenStartMsRef.current
      const sec = Math.min(600, Math.max(0, Math.round(rawMs / 1000)))
      lastListenSecRef.current = sec
      setListenElapsedSeconds(sec)
    }

    rec.onerror = (event) => {
      const code = typeof event.error === 'string' ? event.error : ''
      if (code === 'not-allowed' || code === 'no-speech' || code === 'audio-capture') {
        setError(code)
      } else if (code === 'aborted') {
        /* user stopped */
      } else if (code) {
        setError(code)
      }
      clearSilenceTimer()
      finishElapsed()
      recognitionRef.current = null
      setIsListening(false)
    }

    rec.onend = () => {
      clearSilenceTimer()
      finishElapsed()
      recognitionRef.current = null
      setIsListening(false)
    }

    recognitionRef.current = rec
    setIsListening(true)
    try {
      rec.start()
    } catch {
      setIsListening(false)
      setError('audio-capture')
    }
  }, [armSilenceTimer, clearSilenceTimer, stopListening])

  const getLastListenSeconds = useCallback(() => lastListenSecRef.current, [])

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
    error,
    listenElapsedSeconds,
    getLastListenSeconds,
  }
}
