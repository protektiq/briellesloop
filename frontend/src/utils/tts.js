import { API_BASE_URL } from '../constants/api'

const MAX_TTS_CHARS = 2000

/**
 * @param {{ text: string, voice?: string }} params
 * @returns {Promise<{ audio: HTMLAudioElement, objectUrl: string, revoke: () => void }>}
 */
export const fetchTtsAudio = async ({ text, voice }) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('TTS text is required.')
  }
  const trimmed = text.trim()
  if (trimmed.length > MAX_TTS_CHARS) {
    throw new Error(`TTS text must be at most ${MAX_TTS_CHARS} characters.`)
  }
  const params = new URLSearchParams()
  params.set('text', trimmed)
  if (typeof voice === 'string' && voice.trim().length > 0) {
    params.set('voice', voice.trim())
  }
  const response = await fetch(`${API_BASE_URL}/api/tts?${params.toString()}`)
  if (!response.ok) {
    const message = `TTS request failed (${response.status})`
    throw new Error(message)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const audio = new Audio(objectUrl)
  const revoke = () => {
    try {
      audio.pause()
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(objectUrl)
  }
  return { audio, objectUrl, revoke }
}
