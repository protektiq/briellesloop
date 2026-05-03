/**
 * Short comprehension passages adapted from well-known public-domain children's literature.
 * Each entry matches the shape expected by insertReadingItemRow (title, passage, questions).
 * Word counts are kept within the reading generator band (100–300 words) for consistency with graders.
 */

const CLASSIC_READING_EXCERPTS = [
  {
    title: "Down the Rabbit-Hole (excerpt)",
    book_attribution: "From Alice's Adventures in Wonderland by Lewis Carroll (1865), public domain.",
    passage:
      "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversation?' So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her. There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, 'Oh dear! Oh dear! I shall be late!' (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.",
    questions: [
      {
        type: "main_idea",
        text: "At the start of the passage, how does Alice feel about sitting with her sister?",
        expected_answer:
          "She feels bored and sleepy; she is tired of having nothing interesting to do.",
      },
      {
        type: "supporting_detail",
        text: "What does the White Rabbit say that surprises Alice a little?",
        expected_answer: "The Rabbit says, 'Oh dear! Oh dear! I shall be late!'",
      },
      {
        type: "inference",
        text: "Why do you think Alice runs after the Rabbit?",
        expected_answer:
          "She is curious because the Rabbit behaves like a person—talking, checking a watch, and wearing a waistcoat.",
      },
    ],
    source: "classic_excerpt",
  },
  {
    title: "Dorothy and the Cyclone (excerpt)",
    book_attribution: "From The Wonderful Wizard of Oz by L. Frank Baum (1900), public domain.",
    passage:
      "Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles. There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds. Uncle Henry and Aunt Em had a big bed in one corner, and Dorothy a little bed in another corner. There was no garret at all, and no cellar—except a small hole dug in the ground, called a cyclone cellar, where the family could go in case one of those great whirlwinds arose, mighty enough to crush any building in its path. It was reached by a trap door in the middle of the floor, from which a ladder led down into the small, dark hole. When Dorothy stood in the doorway and looked around, she could see nothing but the great gray prairie on every side. Not a tree nor a house broke the broad sweep of flat country that reached to the edge of the sky in all directions. The sun had baked the plowed land into a gray mass, with little cracks running through it. Even the grass was not green, for the sun burned the tops of the long blades until they were the same gray color to be seen everywhere. Once the house had been painted, but the sun blistered the paint and the rains washed it away, and now the house was as dull and gray as everything else.",
    questions: [
      {
        type: "main_idea",
        text: "What is this passage mostly describing?",
        expected_answer:
          "It describes Dorothy's home on the Kansas prairie and how plain, small, and gray everything looks.",
      },
      {
        type: "supporting_detail",
        text: "What is a cyclone cellar, according to the passage?",
        expected_answer:
          "It is a small hole dug in the ground with a trap door and ladder, where the family can go if a dangerous whirlwind comes.",
      },
      {
        type: "inference",
        text: "Why might Dorothy feel that the prairie looks lonely or empty?",
        expected_answer:
          "There are no trees or houses breaking the view—only flat gray land stretching to the sky in every direction.",
      },
    ],
    source: "classic_excerpt",
  },
  {
    title: "The Lion and the Mouse (excerpt)",
    book_attribution: "From Aesop's Fables (traditional), public domain retelling.",
    passage:
      "A Lion lay asleep in the forest, his great head on his paws. A timid little Mouse came upon him unexpectedly, and in her fright and haste to get away, ran across the Lion's nose. Roused from his nap, the Lion laid his huge paw angrily on the tiny creature to kill her. 'Spare me!' begged the poor Mouse. 'Please let me go and some day I will surely repay you.' The Lion was much amused to think that a Mouse could ever help him. But he was generous and finally let the Mouse go. Some days later, while stalking his prey in the forest, the Lion was caught in the toils of a hunter's net. Unable to free himself, he filled the forest with his angry roaring. The Mouse knew the voice and quickly found the Lion struggling in the net. Running to one of the great ropes that bound him, she gnawed it until it parted, and soon the Lion was free. 'You laughed when I said I would repay you,' said the Mouse. 'Now you see that even a Mouse can help a Lion.'",
    questions: [
      {
        type: "main_idea",
        text: "What lesson does this story suggest about kindness?",
        expected_answer:
          "Even small friends can help in a big way, so it is wise to be kind instead of cruel.",
      },
      {
        type: "supporting_detail",
        text: "How does the Mouse help the Lion later on?",
        expected_answer: "She gnaws through the rope of the hunter's net so the Lion can escape.",
      },
      {
        type: "inference",
        text: "Why did the Lion probably decide to spare the Mouse at first?",
        expected_answer:
          "He may have felt amused that such a tiny creature promised to help him someday, and he chose to be merciful.",
      },
    ],
    source: "classic_excerpt",
  },
  {
    title: "The Emperor's New Clothes (excerpt)",
    book_attribution: "From The Emperor's New Clothes by Hans Christian Andersen (1837), public domain.",
    passage:
      "Many years ago there was an Emperor so exceedingly fond of new clothes that he spent all his money on dress. He did not care for his soldiers, and the theatre did not amuse him; the only thing, in fact, he thought anything of was to drive out and show a new suit of clothes. He had a coat for every hour of the day; and instead of saying, as one might, about any other ruler, 'The King's in council,' here they always said, 'The Emperor's in his dressing room.' One day two swindlers came to this city; they made people believe that they were weavers, and declared they could manufacture the finest cloth to be imagined. Not only were their colors and patterns uncommonly beautiful, but the clothes made of their cloth had a wonderful way of becoming invisible to anyone who was unfit for his office, or who was unusually stupid. 'Those must, indeed, be splendid clothes!' thought the Emperor. 'Had I such a suit, I might at once find out what men in my empire are unfit for their places, and I could tell the clever men from the stupid ones.' So he gave the swindlers large sums of money, that they might begin their work at once.",
    questions: [
      {
        type: "main_idea",
        text: "What does the Emperor care about more than anything else in the passage?",
        expected_answer: "He cares most about getting new clothes and showing them off.",
      },
      {
        type: "supporting_detail",
        text: "What special power do the swindlers claim their cloth has?",
        expected_answer:
          "They say clothes made from the cloth are invisible to anyone who is unfit for his office or unusually stupid.",
      },
      {
        type: "inference",
        text: "Why might the Emperor want a suit made from that cloth?",
        expected_answer:
          "He believes it will help him discover who in his empire is unfit for their job or not very clever.",
      },
    ],
    source: "classic_excerpt",
  },
  {
    title: "Whitewashing the Fence (excerpt)",
    book_attribution: "From The Adventures of Tom Sawyer by Mark Twain (1876), public domain.",
    passage:
      "Tom appeared on the sidewalk with a bucket of whitewash and a long-handled brush. He regarded the fence thoughtfully, and his face grew longer and longer as he measured the work ahead. Thirty yards of board fence nine feet high felt like a mountain. Life to him seemed hollow, and existence but a burden. Still, Aunt Polly expected results, so he dipped his brush and dragged it along the topmost plank, then again, and again. The new white streak looked terribly small beside the long stretch that still waited, gray and stubborn. He sat down on a tree-stump and sighed. Presently Ben Rogers came skipping along the street, eating an apple and planning a swim. Tom pretended not to notice. When Ben jeered at him for working on a Saturday, Tom answered calmly, as if whitewashing were a rare treat only a chosen artist could be trusted to do. Ben slowed down, curious. Tom kept painting with great seriousness, and the more he acted as if the job were special, the more Ben wanted to try it himself.",
    questions: [
      {
        type: "main_idea",
        text: "How does Tom feel about the fence at the beginning of the passage?",
        expected_answer:
          "He feels discouraged and overwhelmed because the fence is huge and the painted part looks tiny.",
      },
      {
        type: "supporting_detail",
        text: "What does Tom bring with him when he starts working?",
        expected_answer: "A bucket of whitewash and a long-handled brush.",
      },
      {
        type: "inference",
        text: "Why does Ben Rogers become interested in Tom's work?",
        expected_answer:
          "Tom pretends whitewashing is an important privilege, so Ben begins to think painting the fence might be fun instead of a chore.",
      },
    ],
    source: "classic_excerpt",
  },
];

export const pickClassicReadingExcerpt = ({ index = 0 } = {}) => {
  if (!Number.isInteger(index) || index < 0) {
    return CLASSIC_READING_EXCERPTS[0];
  }
  return CLASSIC_READING_EXCERPTS[index % CLASSIC_READING_EXCERPTS.length];
};

export const classicReadingExcerptCount = () => CLASSIC_READING_EXCERPTS.length;
