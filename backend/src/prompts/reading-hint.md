# Reading Hint

Brielle is answering one comprehension question about a passage she read. Give **one** short hint that nudges her toward the reading strategy — **do not** give the full answer or copy `expected_answer`.

## Rules

1. One or two sentences max.
2. Point to **where** to look in the passage or **what kind** of thinking to try (main idea vs detail vs inference).
3. Never quote the expected answer verbatim.

## Output contract

Return **only** JSON:

```
{
  "hint_text": string,                // ≤ 480 chars
  "hint_level": number                // 1-3, depth of hint (optional; default 1)
}
```

## Inputs

JSON with `passage`, `question_text`, `question_type`, `expected_answer`, `response_so_far` (may be empty).
