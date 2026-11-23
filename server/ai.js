/**
 * The ONLY file that knows which LLM vendor we use.
 *
 * Contract: `complete({ system, user })` -> string, or throws.
 * Set AI_PROVIDER=groq|gemini and the matching key. With no key configured,
 * `enabled` is false and callers fall back to deterministic text — the app is
 * fully functional without AI, just less chatty.
 */

const PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase()
const GROQ_KEY = process.env.GROQ_API_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

export function aiEnabled() {
  if (PROVIDER === 'groq') return Boolean(GROQ_KEY)
  if (PROVIDER === 'gemini') return Boolean(GEMINI_KEY)
  return false
}

export function aiProvider() {
  return aiEnabled() ? PROVIDER : null
}

async function groqComplete({ system, user, maxTokens }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens ?? 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.choices?.[0]?.message?.content?.trim()
}

async function geminiComplete({ system, user, maxTokens }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens ?? 400 },
    }),
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim()
}

export async function complete(opts) {
  if (!aiEnabled()) throw new Error('AI provider not configured')
  const text = PROVIDER === 'gemini' ? await geminiComplete(opts) : await groqComplete(opts)
  if (!text) throw new Error('empty completion')
  return text
}

// ---------------------------------------------------------------- prompts --

const SUMMARY_SYSTEM = `You are a clinical scribe assisting a doctor in India who has just
opened a patient's record with the patient's consent. Condense the record into a briefing
the doctor can read in 15 seconds.

Rules:
- 4 to 6 short bullet points, each one line, starting with "- ".
- Lead with anything that changes prescribing: allergies, active medications, anticoagulation.
- Then active problems, then the trajectory of past visits, then outstanding tests.
- State only what the record contains. Never invent findings, values, or diagnoses.
- No preamble, no closing advice, no markdown headings. Bullets only.`

const SAFETY_SYSTEM = `You are a clinical pharmacology assistant. A deterministic rules engine
has ALREADY detected a prescribing conflict; your only job is to explain it to the prescribing
doctor in ONE sentence (max 30 words).

Rules:
- Say what the risk is and why, in plain clinical language.
- Do not hedge, do not add disclaimers, do not suggest contacting anyone.
- Do not question or re-litigate the flag — it is established.
- One sentence. No bullet points, no preamble.`

export async function summarize(record) {
  return complete({ system: SUMMARY_SYSTEM, user: JSON.stringify(record, null, 1), maxTokens: 350 })
}

export async function explainFlag(flag, context) {
  const user = [
    `Flag type: ${flag.type}`,
    `Prescribed: ${flag.medicine} (${flag.composition})`,
    `Conflicts with: ${flag.conflicts_with}`,
    `Rules-engine message: ${flag.message}`,
    context?.allergies?.length ? `Patient allergies: ${context.allergies.join(', ')}` : null,
    context?.medications?.length ? `Active medications: ${context.medications.join(', ')}` : null,
    context?.age ? `Patient age: ${context.age}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return complete({ system: SAFETY_SYSTEM, user, maxTokens: 120 })
}
