-- Academic Brazilian Jiu-Jitsu knowledge skill (terminology, etiquette, safety — not physical coaching).
-- Starting level 2: experienced on the mat; academic quiz track begins here.

INSERT INTO skills (name, iep_goal_text, iep_target_pct)
VALUES (
  'jiujitsu',
  'Goal: 80% accuracy on age-appropriate academic BJJ knowledge (safety, etiquette, basic positions and vocabulary). This supplements—not replaces—qualified instruction on the mat.',
  80
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO student_skill_levels (student_id, skill_id, level, updated_at)
SELECT
  s.id,
  sk.id,
  2,
  NOW()
FROM students s
INNER JOIN skills sk
  ON sk.name = 'jiujitsu'
WHERE NOT EXISTS (
  SELECT 1
  FROM student_skill_levels ssl
  WHERE ssl.student_id = s.id
    AND ssl.skill_id = sk.id
);

INSERT INTO items (skill_id, level, item_type, prompt, answer, metadata, ai_generated)
SELECT
  (SELECT id FROM skills WHERE name = 'jiujitsu' LIMIT 1),
  v.level,
  'jiujitsu_quiz',
  jsonb_build_object('text', v.prompt_text),
  jsonb_build_object('text', v.answer_text),
  jsonb_build_object('seed_source', '20260503120000_jiujitsu_skill', 'topic', v.topic),
  FALSE
FROM (
  VALUES
    -- Level 1 — fundamentals
    (
      1,
      'When someone taps during practice, what are they usually telling their partner?' || E'\n\n' ||
      'A) Go faster' || E'\n' ||
      'B) Stop or yield so pressure eases' || E'\n' ||
      'C) Switch sides only for style points' || E'\n' ||
      'D) Ignore safety rules',
      'b',
      'safety'
    ),
    (
      1,
      'Many gyms ask students to bow when stepping on or off the mat mainly as a sign of:' || E'\n\n' ||
      'A) Showing off' || E'\n' ||
      'B) Respect for the training space and partners' || E'\n' ||
      'C) Racing teammates' || E'\n' ||
      'D) Avoiding warm-ups',
      'b',
      'etiquette'
    ),
    (
      1,
      'If something hurts or feels unsafe during class, what is the best first step?' || E'\n\n' ||
      'A) Stay silent so you look tough' || E'\n' ||
      'B) Wait a month and hope it stops' || E'\n' ||
      'C) Tell the coach right away' || E'\n' ||
      'D) Only mention it at home days later',
      'c',
      'safety'
    ),
    (
      1,
      'Which picture matches “mount” best for beginners?' || E'\n\n' ||
      'A) Both people standing with helmets' || E'\n' ||
      'B) Top person sitting on torso with knees toward the floor on either side of bottom partner''s torso' || E'\n' ||
      'C) Swimming laps' || E'\n' ||
      'D) Doing homework',
      'b',
      'positions'
    ),
    (
      1,
      'The word “gi” in Brazilian Jiu-Jitsu usually names:' || E'\n\n' ||
      'A) The timer on the wall' || E'\n' ||
      'B) The jacket-and-pants uniform used in many classes' || E'\n' ||
      'C) A trophy shelf' || E'\n' ||
      'D) A snack break',
      'b',
      'vocabulary'
    ),
    (
      1,
      'Why do coaches remind students to drink water during hard classes?' || E'\n\n' ||
      'A) Water replaces fluids lost when you sweat' || E'\n' ||
      'B) Water raises your grade in math class' || E'\n' ||
      'C) Water replaces sleeping at night' || E'\n' ||
      'D) Water fixes broken electronics',
      'a',
      'health'
    ),
    -- Level 2
    (
      2,
      '“Open guard” often describes:' || E'\n\n' ||
      'A) Standing clinch only' || E'\n' ||
      'B) Bottom player using legs and feet between themselves and the partner to frame and control distance' || E'\n' ||
      'C) Leaving class early' || E'\n' ||
      'D) Sprinting drills only',
      'b',
      'positions'
    ),
    (
      2,
      '“Side control” generally means:' || E'\n\n' ||
      'A) Both athletes standing at shake-hands distance' || E'\n' ||
      'B) Chest-to-chest control on the side with the top athlete pinning the bottom athlete' || E'\n' ||
      'C) Jumping jacks in the lobby' || E'\n' ||
      'D) Tag game',
      'b',
      'positions'
    ),
    (
      2,
      'A rear naked choke is usually applied:' || E'\n\n' ||
      'A) From under both feet' || E'\n' ||
      'B) From behind with arms wrapped around the neck for a controlled choke' || E'\n' ||
      'C) While doing cartwheels' || E'\n' ||
      'D) Only before class starts',
      'b',
      'vocabulary'
    ),
    (
      2,
      'Which choice shows poor partner care?' || E'\n\n' ||
      'A) Matching intensity safely' || E'\n' ||
      'B) Ignoring taps and keeping pressure on' || E'\n' ||
      'C) Saying thank you after a round' || E'\n' ||
      'D) Listening to the coach',
      'b',
      'etiquette'
    ),
    (
      2,
      'When coaches say “rolling,” they usually mean:' || E'\n\n' ||
      'A) Doing somersault races only' || E'\n' ||
      'B) Live rounds where partners try techniques safely with resistance' || E'\n' ||
      'C) Sleeping on the mat' || E'\n' ||
      'D) Eating during instruction',
      'b',
      'vocabulary'
    ),
    (
      2,
      'In many kids programs, stripes or belt colors like yellow-white often mark:' || E'\n\n' ||
      'A) Coach-only ranks' || E'\n' ||
      'B) Progress along the academy curriculum—not how tough someone is' || E'\n' ||
      'C) Tournament referees only' || E'\n' ||
      'D) Parents who watch class',
      'b',
      'culture'
    ),
    -- Level 3
    (
      3,
      'Brazilian Jiu-Jitsu is best grouped as:' || E'\n\n' ||
      'A) A jumping sport like high jump' || E'\n' ||
      'B) A grappling art focused on leverage, positions, and submissions on the ground' || E'\n' ||
      'C) A swimming stroke' || E'\n' ||
      'D) A typing contest',
      'b',
      'culture'
    ),
    (
      3,
      'From guard, a “sweep” often aims to:' || E'\n\n' ||
      'A) Mop only the corners' || E'\n' ||
      'B) Reverse who is on top using leverage so the bottom athlete improves position' || E'\n' ||
      'C) Leave the mat without telling anyone' || E'\n' ||
      'D) Skip drills',
      'b',
      'vocabulary'
    ),
    (
      3,
      'Bridging your hips off the mat while pinned often helps you:' || E'\n\n' ||
      'A) Take a nap' || E'\n' ||
      'B) Create space or change angle so escapes can start' || E'\n' ||
      'C) Tie shoes faster' || E'\n' ||
      'D) Ignore frames',
      'b',
      'positions'
    ),
    (
      3,
      'Schools teach tapping early mainly because:' || E'\n\n' ||
      'A) It looks flashy on video' || E'\n' ||
      'B) It gives a fast, clear signal when someone needs pressure to stop' || E'\n' ||
      'C) It replaces coaches'' voices' || E'\n' ||
      'D) It guarantees tournament medals',
      'b',
      'safety'
    ),
    (
      3,
      'Paying attention to small details in a technique matters because:' || E'\n\n' ||
      'A) Details change angles, leverage, and safety for you and your partner' || E'\n' ||
      'B) Details remove the need to warm up' || E'\n' ||
      'C) Details mean you never need a partner' || E'\n' ||
      'D) Details cancel gym rules',
      'a',
      'learning'
    ),
    (
      3,
      '“Positional sparring” usually starts partners:' || E'\n\n' ||
      'A) Running laps outside' || E'\n' ||
      'B) From an agreed position so one skill can be practiced under resistance' || E'\n' ||
      'C) Ignoring positions entirely' || E'\n' ||
      'D) Doing unrelated homework',
      'b',
      'vocabulary'
    ),
    (
      3,
      'Which statement fits hygiene respect on the mat?' || E'\n\n' ||
      'A) Wear a clean uniform and trim nails to reduce scrapes and infections' || E'\n' ||
      'B) Share damp gear on purpose to save laundry' || E'\n' ||
      'C) Skip showers after hot classes' || E'\n' ||
      'D) Hide cuts from coaches',
      'a',
      'etiquette'
    )
) AS v(level, prompt_text, answer_text, topic);
