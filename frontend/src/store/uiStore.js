import { create } from 'zustand'

const clampStreak = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  const bounded = Math.max(0, Math.min(999, Math.floor(value)))
  return bounded
}

export const useUiStore = create((set) => ({
  streakCount: 7,
  setStreakCount: (nextValue) =>
    set(() => ({
      streakCount: clampStreak(nextValue),
    })),
}))
