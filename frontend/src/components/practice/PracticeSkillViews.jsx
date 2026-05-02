import { useEffect, useMemo, useRef } from 'react'

export const MathSkillView = ({
  currentItem,
  structuredSteps,
  promptText,
  isBusy,
  answer,
  onAnswerChange,
  onKeyDown,
  inputRef,
  inputDisabled,
}) => {
  const renderStepBoxes = () => {
    if (!currentItem) {
      return null
    }

    if (structuredSteps.length === 0) {
      return (
        <div className="step-row">
          <div className={`step-box${isBusy ? ' loading' : ' active'}`}>
            <div className="step-label">Step — What we&apos;re finding</div>
            <div className="step-content placeholder">
              {isBusy ? 'thinking…' : 'Type your answer below 👇'}
            </div>
          </div>
        </div>
      )
    }

    const lastIndex = structuredSteps.length - 1
    return (
      <div className="step-row">
        {structuredSteps.map((step, index) => {
          const isLast = index === lastIndex
          let className = 'step-box'
          if (isLast) {
            className += isBusy ? ' loading' : ' active'
          } else {
            className += ' done'
          }
          return (
            <div key={`${step.label}-${index}`} className={className}>
              <div className="step-label">
                {!isLast ? <span className="check" aria-hidden="true">✓</span> : null}
                <span>{step.label}</span>
              </div>
              <div className={`step-content${isLast && isBusy ? ' thinking' : ''}`}>
                {isLast && isBusy ? 'thinking…' : step.content}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="activity-question">{promptText || 'Ready when you are.'}</div>
      {renderStepBoxes()}
      <input
        ref={inputRef}
        type="text"
        className="input-line"
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type your answer here"
        aria-label="Your answer"
        disabled={inputDisabled}
        autoFocus
      />
    </>
  )
}

export const ReadingSkillView = ({
  passage,
  questionText,
  readingQuestionIndex,
  passageTitle,
  answer,
  onAnswerChange,
  onKeyDown,
  inputRef,
  inputDisabled,
}) => {
  return (
    <>
      <div className="reading-passage-block">
        {passageTitle ? (
          <h3 className="reading-passage-title">{passageTitle}</h3>
        ) : null}
        <div className="reading-passage-text" aria-label="Reading passage">
          {passage}
        </div>
      </div>
      <div className="activity-question reading-question-label">
        Question {readingQuestionIndex + 1} of 3 · {questionText || 'Answer in your own words.'}
      </div>
      <textarea
        ref={inputRef}
        className="input-line reading-textarea"
        rows={3}
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type your answer here"
        aria-label="Your answer"
        disabled={inputDisabled}
      />
    </>
  )
}

export const SpellingSkillView = ({
  poolLabel,
  answer,
  onAnswerChange,
  onKeyDown,
  inputRef,
  inputDisabled,
}) => {
  return (
    <>
      <div className="activity-question">
        Listen to the word, then spell it. Use Hear again in the row below if you need a replay.
      </div>
      {poolLabel ? (
        <p className="spelling-pool-tag" aria-label="Word pattern">
          Pattern: {poolLabel}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        className="input-line"
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type the word"
        aria-label="Spell the word you heard"
        disabled={inputDisabled}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
    </>
  )
}

export const TypingSkillView = ({
  targetSentence,
  liveWpm,
  liveAccuracy,
  answer,
  onAnswerChange,
  onKeyDown,
  inputRef,
  inputDisabled,
}) => {
  return (
    <>
      <div className="typing-target-label">Type this sentence:</div>
      <div className="typing-target-sentence" aria-label="Sentence to type">
        {targetSentence}
      </div>
      <div className="typing-live-stats" aria-live="polite">
        <span>Live · about {liveWpm} WPM</span>
        <span> · {liveAccuracy}% match</span>
      </div>
      <textarea
        ref={inputRef}
        className="input-line typing-textarea"
        rows={3}
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type here…"
        aria-label="Typing practice input"
        disabled={inputDisabled}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
      />
    </>
  )
}

const getWordCount = (text) => {
  if (typeof text !== 'string') {
    return 0
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }
  return trimmed.split(/\s+/).filter((chunk) => chunk.length > 0).length
}

export const WritingSkillView = ({
  promptText,
  wordCountGuidance,
  answer,
  onAnswerChange,
  onKeyDown,
  inputRef,
  inputDisabled,
  writingRubric,
  encouragement,
}) => {
  const currentWordCount = getWordCount(answer)
  const hasRubric = Boolean(writingRubric && typeof writingRubric === 'object')
  const rubricCriteria = hasRubric
    ? [
        ['Conventions', writingRubric.criteria?.conventions ?? 0],
        ['Sentence Variety', writingRubric.criteria?.sentence_variety ?? 0],
        ['Main Idea', writingRubric.criteria?.main_idea ?? 0],
        ['Detail', writingRubric.criteria?.detail ?? 0],
      ]
    : []

  return (
    <>
      <div className="activity-question">{promptText || 'Write one clear paragraph in your own words.'}</div>
      <textarea
        ref={inputRef}
        className="input-line writing-textarea"
        rows={7}
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write your paragraph here…"
        aria-label="Writing response"
        disabled={inputDisabled}
      />
      <div className="writing-meta-row">
        <span className="writing-word-count">Words: {currentWordCount}</span>
        <span className="writing-word-guidance">{wordCountGuidance || 'Aim for 40-120 words.'}</span>
      </div>
      {hasRubric ? (
        <div className="writing-rubric" aria-label="Writing rubric results">
          <h4>Rubric score</h4>
          {rubricCriteria.map(([label, score]) => {
            const normalizedScore = Math.max(0, Math.min(25, Number(score) || 0))
            const pct = Math.round((normalizedScore / 25) * 100)
            return (
              <div key={label} className="writing-rubric-row">
                <div className="writing-rubric-header">
                  <span>{label}</span>
                  <span>{normalizedScore}/25</span>
                </div>
                <div className="writing-rubric-track">
                  <div className="writing-rubric-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
          <div className="writing-rubric-total">
            Total: <strong>{Math.max(0, Math.min(100, Number(writingRubric.total) || 0))}/100</strong>
          </div>
          {typeof encouragement === 'string' && encouragement.trim().length > 0 ? (
            <p className="writing-encouragement">{encouragement.trim()}</p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export const poolDisplayName = (pool) => {
  if (pool === 'multisyllabic') {
    return 'Multisyllabic'
  }
  if (pool === 'r_controlled') {
    return 'R-controlled vowels'
  }
  if (pool === 'variant_vowel') {
    return 'Variant vowels'
  }
  return ''
}

export const useSpellingSpeech = (wordForSpeech, itemId) => {
  const lastSpokenRef = useRef('')

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return
    }
    if (!wordForSpeech || !itemId) {
      return
    }
    const key = `${itemId}:${wordForSpeech}`
    if (lastSpokenRef.current === key) {
      return
    }
    lastSpokenRef.current = key
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(wordForSpeech)
    utter.rate = 0.92
    window.speechSynthesis.speak(utter)
  }, [wordForSpeech, itemId])
}

export const useTypingLiveStats = (answer, targetSentence, itemRenderedAtMs) => {
  return useMemo(() => {
    const target = typeof targetSentence === 'string' ? targetSentence : ''
    const typed = typeof answer === 'string' ? answer : ''
    if (!target || target.length === 0) {
      return { liveWpm: 0, liveAccuracy: 100 }
    }
    let matches = 0
    const len = Math.min(typed.length, target.length)
    for (let i = 0; i < len; i += 1) {
      if (typed[i] === target[i]) {
        matches += 1
      }
    }
    const accuracy =
      target.length > 0 ? Math.round((matches / target.length) * 1000) / 10 : 100
    const elapsedSec = Math.max(1, Math.round((Date.now() - itemRenderedAtMs) / 1000))
    const minutes = elapsedSec / 60
    const grossWpm = typed.length > 0 ? typed.length / 5 / minutes : 0
    const liveWpm = Math.round(grossWpm * 10) / 10
    return { liveWpm, liveAccuracy: accuracy }
  }, [answer, targetSentence, itemRenderedAtMs])
}
