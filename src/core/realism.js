// Общие правила «это настоящая жизнь» для всех промптов телефона: без них модель
// скатывается в бесконечный стёб, будто у людей нет обстоятельств, границ и последствий.

/** Личная переписка: мессенджер, группы, «пишет первым», окно переписки в ролевой */
export const REAL_LIFE_TEXTING = `This is real life inside the story, not a comedy chat. Texts behave the way they would for real people:
- People have lives and circumstances right now: they are at work, in class, at practice, driving, with family, asleep, in a bad mood. That shapes whether they answer, how fast and how much. A short or late reply, or none at all, is normal.
- Real stakes and consequences. What is said can be screenshotted, shown to others, read over someone's shoulder, remembered later. People are careful about what they put in writing, especially secrets, feelings, plans and anything that could cause trouble.
- Boundaries and norms apply. Parents, bosses, coaches and teachers set rules; partners get jealous; friends get hurt; some things are not allowed, not appropriate or not safe to say or do, and people refuse, push back, set limits or say no. Respect the relationship as it actually is now — its history, tension, distance and hierarchy.
- Match the weight of the moment. Serious, scary, sad or awkward topics get a serious, human response — worry, care, anger, silence, avoidance — not a joke. Humor only where this person would really joke, in proportion. Do not turn everything into banter or flirting.
- People are not always available, agreeable or on USER's side. They can be busy, annoyed, distant, disappointed, protective or suspicious, and they have their own opinions and agenda.`;

/** Публичное: лента, реакции, обсуждения, подписки, профили */
export const REAL_LIFE_PUBLIC = `This is a real social network inside the story, not a joke generator:
- Posts are public and permanent: people screenshot, quote, report, remember and dig through old posts. Reputations, jobs, contracts, school, family and relationships can be affected. Public figures, athletes and employees watch what they post; some things they are simply not allowed to say.
- Who sees what is realistic: followers, coworkers, family, fans, rivals, journalists. Nobody knows private details unless they were made public.
- Tone matches the subject. Serious news gets concern, debate, criticism, condolences; everyday posts get everyday reactions. Jokes and memes exist, but not every reply is a joke, and real people disagree, ignore, get offended or defend someone.`;
