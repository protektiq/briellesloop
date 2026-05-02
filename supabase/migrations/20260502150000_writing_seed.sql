-- Seed writing prompt templates for levels 1-4.

WITH writing_skill AS (
  SELECT id
  FROM skills
  WHERE name = 'writing'
  LIMIT 1
),
templates(level, topic_template, min_words, max_words, rubric_focus) AS (
  VALUES
    (1, 'Write a paragraph about your favorite {interest_topic}. Include at least two details.', 40, 120, ARRAY['main_idea', 'detail']),
    (1, 'Write about a time you felt proud while doing {interest_topic}. Tell what happened first, next, and last.', 40, 120, ARRAY['main_idea', 'detail']),
    (1, 'Write a paragraph that teaches someone one simple rule for {interest_topic}.', 40, 120, ARRAY['main_idea', 'conventions']),
    (1, 'Write a paragraph about why {interest_topic} is important to you. Include two reasons.', 40, 120, ARRAY['main_idea', 'detail']),
    (1, 'Describe one object you use for {interest_topic}. Explain what it does and why it helps.', 40, 120, ARRAY['detail', 'conventions']),
    (1, 'Write about your best day doing {interest_topic}. Include where you were and who was there.', 40, 120, ARRAY['main_idea', 'detail']),
    (2, 'Explain how to get ready for {interest_topic}. Use clear steps in one paragraph.', 45, 120, ARRAY['main_idea', 'sentence_variety']),
    (2, 'Write a paragraph about a challenge in {interest_topic} and how you solved it.', 45, 120, ARRAY['main_idea', 'detail']),
    (2, 'Write a paragraph describing what makes someone a good teammate during {interest_topic}.', 45, 120, ARRAY['detail', 'conventions']),
    (2, 'Write a paragraph about one thing you want to improve in {interest_topic} and how you will practice.', 45, 120, ARRAY['main_idea', 'detail']),
    (2, 'Describe a place where people enjoy {interest_topic}. Include at least three describing words.', 45, 120, ARRAY['detail', 'sentence_variety']),
    (3, 'Write a paragraph explaining whether practicing alone or with a group is better for {interest_topic}. Use one transition word.', 50, 120, ARRAY['main_idea', 'sentence_variety']),
    (3, 'Compare two ways to enjoy {interest_topic}. Explain which one you prefer and why.', 50, 120, ARRAY['main_idea', 'detail']),
    (3, 'Write an opinion paragraph: should beginners start with easy or hard {interest_topic} tasks? Support your answer.', 50, 120, ARRAY['main_idea', 'detail']),
    (3, 'Write a paragraph describing a problem someone could face during {interest_topic}, then explain one good solution.', 50, 120, ARRAY['sentence_variety', 'detail']),
    (3, 'Explain how {interest_topic} can help someone feel calm or focused. Use at least one transition word.', 50, 120, ARRAY['main_idea', 'conventions']),
    (4, 'Write a paragraph arguing which season is best for {interest_topic}. Use a clear claim and supporting details.', 55, 120, ARRAY['main_idea', 'detail']),
    (4, 'Write a paragraph comparing learning {interest_topic} at home versus at school. Use transition words to connect ideas.', 55, 120, ARRAY['sentence_variety', 'conventions']),
    (4, 'Write a paragraph about a goal for {interest_topic} this year. Explain why it matters and how you will reach it.', 55, 120, ARRAY['main_idea', 'detail']),
    (4, 'Write an opinion paragraph: should people spend more free time on {interest_topic} or on a different hobby? Explain your choice.', 55, 120, ARRAY['main_idea', 'sentence_variety'])
)
INSERT INTO items (
  skill_id,
  level,
  item_type,
  prompt,
  answer,
  metadata,
  ai_generated
)
SELECT
  ws.id,
  t.level,
  'writing_prompt',
  jsonb_build_object(
    'topic_template', t.topic_template,
    'min_words', t.min_words,
    'max_words', t.max_words,
    'rubric_focus', to_jsonb(t.rubric_focus)
  ),
  jsonb_build_object('text', ''),
  jsonb_build_object(
    'seed_source', '20260502150000_writing_seed',
    'kind', 'template'
  ),
  FALSE
FROM templates t
CROSS JOIN writing_skill ws
WHERE NOT EXISTS (
  SELECT 1
  FROM items i
  WHERE i.skill_id = ws.id
    AND i.item_type = 'writing_prompt'
    AND i.level = t.level
    AND i.prompt ->> 'topic_template' = t.topic_template
);
