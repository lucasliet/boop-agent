/**
 * Skill constants ported from the-agency OpenCode project.
 * Each constant is injected directly into execution agent task prompts.
 */

export const SKILL_AUTHOR_PERSONA = `
## Snapshot

- Name: Lucas Souza de Oliveira
- Pronouns (optional): He/Him
- Current role: Full Stack Engineer (with focus on backend)
- Industry/domain: Public Security
- One-liner: I build software for police force using Java and Angular

## What I Do (in plain English)

<2-4 sentences describing what you actually do day-to-day and what you're known for>

## Experience (credibility anchors)

- <role/company/project> - <what you did> - <outcome (no invented numbers)>
- <role/company/project> - <what you did> - <outcome>
- <role/company/project> - <what you did> - <outcome>

## Expertise

### Primary strengths

- java backend with spring boot
- testing with junit and mockito

### Stacks I can speak about confidently

- Languages: Java
- Frameworks: Spring
- Cloud/infra: GCP
- Data:
- Observability: Dynatrace and Grafana

### Familiar but not expert (use careful language)

- Frontend
- Angular
- React
- AWS Cloud

### Topics I avoid claiming expertise in

- Python
- Scala

## Point of View (opinions I actually believe)

- "AI won't replace devs"
- "if you don't monitore your environment you are blind"
- "clean code matters"
- "I don't like AI hype too much"

## Audience and Intent

- Primary audience: junior, mid-level, senior devs and architects
- Reader pain I address most: senior devs
- What I want readers to do after reading: think about and test

## Voice and Style

- Tone: (e.g., pragmatic, slightly opinionated, calm)
- Humor: (none / light / dry / sarcastic; keep professional)
- Reading level: (simple / moderate / advanced)
- Typical post length: (e.g., 180-280 words)
- Formatting preferences: (bullets, short paragraphs, emojis/no emojis, hashtags yes/no)
- Words/phrases I like:
- Words/phrases I avoid:

## Reusable Stories (proof points)

Provide 3-6 mini stories the agents can reuse as examples. Keep each one to 3-6 lines.

### Story 1: <title>

- Context:
- What went wrong / the tension:
- What I did:
- Lesson:
- Safe-to-share? (yes/no)

### Story 2: <title>

- Context:
- What went wrong / the tension:
- What I did:
- Lesson:
- Safe-to-share? (yes/no)

## Boundaries and Safety

- Confidentiality: what I must NOT mention (companies, clients, incidents, internal metrics, etc.):
- Sensitive topics to avoid:
- Disclosures I want when relevant: (e.g., "opinions are my own")

## "Needs verification" rules for me

List what the agents must label as "Needs verification" unless you provide a source or confirm details.

- Benchmarks, percentages, and numeric claims
- Security/compliance claims
- Version-specific behavior of tools/frameworks
- Quotes and attribution
- Any claim about companies/people

## Call To Action (my preferred CTA patterns)

- Ask for counterexamples: "What's the trade-off you've seen in practice?"
- Ask for war stories: "What's the most painful incident you've debugged in this area?"
- Invite a simple reply: "If you had to pick one rule here, what would it be?"
`;

export const SKILL_LINKEDIN_POST = `
## What I optimize for
- A hook that earns attention without clickbait.
- Short paragraphs and whitespace for mobile reading.
- Clear, single-thread narrative (one main idea).
- Concrete takeaways the reader can apply.

## Suggested structure
- 1-2 line hook
- Quick context (why this matters)
- Main idea (the "rule")
- Example (realistic, not contrived)
- Don't write code as examples
- Takeaways (3-5 bullets)
- CTA (a question or prompt)

## Practical rules
- Keep sentences short.
- Prefer verbs over adjectives.
- Avoid "game changer", "revolutionary", and hype language.
- Avoid long intro paragraphs.
- Use bullets when listing more than 3 items.

## Hashtags
- Optional.
- If used: 3-5, relevant, no spam.
`;

export const SKILL_STYLE_GUIDE = `
## Voice
- clear, concise, direct
- No corporate fluff.

## Formatting
- Keep paragraphs to 1-3 lines.
- Use bullets for takeaways.
- Use simple punctuation; don't use em-dash.

## Content length
- Keep it short to medium.

## Word choices to avoid
- "game changer", "unprecedented", "revolutionary", "crushing it", "10x"

## CTA guidance
- Ask one specific question.
- Invite experiences or counterexamples.
- Does not ask for information to help people. Ex.: And if you want, reply with your stack (Java/Kotlin + Gradle/Maven + CI platform), and I'll share a small starter ruleset tailored to it.
`;

export const SKILL_TECHNICAL_ACCURACY = `
## Rules
- Do not invent numbers, benchmarks, quotes, or "studies say" claims.
- If a claim depends on context (stack, version, environment), state the condition.
- If unsure, label it "Needs verification" and suggest what to verify.
- Prefer "typically", "often", "in many cases" when absolutes are unjustified.

## Verification prompts (examples)
- "Needs verification: exact behavior differs between X and Y versions."
- "Needs verification: confirm default timeout/limit for <tool/library>."

## Editing checklist
- Acronyms defined on first use.
- Code-level claims match the described language/runtime.
- Trade-offs are stated (not one-sided).
`;

export const SKILL_AVOID_AI_WRITING = `
You are editing content to remove AI writing patterns ("AI-isms") that make text sound machine-generated.
Use rewrite mode: flag AI-isms and rewrite the text to fix them.

## Tier 1 — Always replace

| Replace | With |
|---|---|
| delve / delve into | explore, dig into, look at |
| landscape (metaphor) | field, space, industry, world |
| tapestry | (describe the actual complexity) |
| realm | area, field, domain |
| paradigm | model, approach, framework |
| embark | start, begin |
| beacon | (rewrite entirely) |
| testament to | shows, proves, demonstrates |
| robust | strong, reliable, solid |
| comprehensive | thorough, complete, full |
| cutting-edge | latest, newest, advanced |
| leverage (verb) | use |
| pivotal | important, key, critical |
| underscores | highlights, shows |
| meticulous / meticulously | careful, detailed, precise |
| seamless / seamlessly | smooth, easy, without friction |
| game-changer / game-changing | describe what specifically changed and why it matters |
| utilize | use |
| nestled | is located, sits, is in |
| vibrant | (describe what makes it active, or cut) |
| deep dive / dive into | look at, examine, explore |
| unpack / unpacking | explain, break down, walk through |
| intricate / intricacies | complex, detailed (or name the specific complexity) |
| ever-evolving | changing, growing (or describe how) |
| holistic / holistically | complete, full, whole |
| actionable | practical, useful, concrete |
| impactful | effective, significant |
| learnings | lessons, findings, takeaways |
| best practices | what works, proven methods, standard approach |
| at its core | (cut) |
| synergy / synergies | (describe the actual combined effect) |
| in order to | to |
| due to the fact that | because |
| serves as | is |
| features (verb) | has, includes |
| boasts | has |
| commence | start, begin |
| utilize | use |

## Tier 2 — Flag when 2+ appear in the same paragraph

harness, navigate, foster, elevate, unleash, streamline, empower, bolster, spearhead, revolutionize, facilitate, nuanced, crucial, multifaceted, ecosystem (metaphor), myriad, plethora, encompass, catalyze, reimagine, cultivate, illuminate, transformative, cornerstone, paramount, poised

## Phrases to remove
- "Moreover" / "Furthermore" / "Additionally"
- "In today's [X]" / "In an era where"
- "It's worth noting that"
- "Here's what's interesting" / "Here's what caught my eye"
- "In conclusion" / "In summary"
- "When it comes to"
- "At the end of the day"
- "Let's explore," "Let's take a look," "Let's dive in!"
- "Whether you're [X] or [Y]"
- "I recently had the pleasure of [verb]-ing"

## Formatting fixes
- Em dashes (— and --): replace with commas, periods, or rewrite as two sentences.
- Bold overuse: strip bold from most phrases.
- Avoid chatbot artifacts: "I hope this helps!", "Great question!", "Certainly!"

## Rhythm
- Vary sentence length: mix short (3-8 words) with longer ones.
- Vary paragraph length: some 1-sentence paragraphs, some longer.
- If every paragraph is the same size, fix it.

## Context profile: linkedin
- Emoji in headers: relaxed (1-2 end-of-line OK)
- Excessive bullets: skip (lists work on LinkedIn)
- Transition phrases: skip (short-form)
- Rhetorical questions: relaxed (1 as hook OK)
`;

export const LINKEDIN_QA_CHECKLIST = `
## LinkedIn Article QA Checklist

- Hook: first 1-2 lines create curiosity and set context.
- Audience: clearly implied (who this is for) within first 5-8 lines.
- One idea: the post has a single primary takeaway.
- Claims: no invented stats, quotes, or benchmarks; questionable items are labeled "Needs verification".
- Structure: short paragraphs, whitespace, and skimmable bullets where appropriate.
- Jargon: acronyms defined once; technical terms used only when necessary.
- Examples: at least one concrete example, anti-pattern, or mini case study.
- Actionability: reader can do something with it (steps, checklist, decision rule).
- Tone: confident but not absolute; avoids dunking; avoids hype.
- CTA: a simple prompt (question, ask for experiences, or invite discussion).
- Hashtags: optional; if present, keep to 3-5 and relevant.
- Length: fits a typical LinkedIn post (aim ~150-350 words unless requested otherwise).
`;

export const BRIEF_TEMPLATE = `
# Brief: <title>

## Metadata
- Working title:
- Target audience:
- Reader pain / motivation:
- Key takeaway:
- Tone:
- CTA:

## Angle
<1-2 sentences describing the perspective>

## Outline
1) Hook
2) Context
3) Main idea
4) Example / story
5) Takeaways
6) CTA

## Must-include details
-

## Terms to define
-

## Sources / links (optional)
-

## Assumptions / needs verification
-
`;

/**
 * Wraps skill content in a labeled block for injection into agent task prompts.
 */
export function skillBlock(label: string, content: string): string {
  return `\n\n---\n## SKILL: ${label}\n${content}\n---\n`;
}
