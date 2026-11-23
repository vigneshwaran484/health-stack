/**
 * Thin client for the AI layer. Everything provider-specific lives in
 * server/ai.js behind /api — swapping Groq for Gemini touches one file and
 * never touches the UI.
 *
 * Every function here degrades gracefully: if the server is down or no API key
 * is configured, callers get { ok: false, text: <fallback> } and the app
 * carries on with rules-only behaviour.
 */

async function post(path, body, fallback) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, text: fallback }
    const json = await res.json()
    if (!json?.ok || !json?.text) return { ok: false, text: json?.text || fallback }
    return { ok: true, text: json.text, provider: json.provider }
  } catch {
    return { ok: false, text: fallback }
  }
}

/** One-tap condensation of a patient's raw record. */
export function summarizeRecord(record) {
  return post('/api/ai/summary', { record }, 'AI summary unavailable — showing the full record below.')
}

/** Plain-English explanation of a safety flag the rules engine already raised. */
export function explainSafetyFlag(flag, context) {
  return post(
    '/api/ai/safety',
    { flag, context },
    `${flag.message}. Review before prescribing.`,
  )
}

export async function aiStatus() {
  try {
    const res = await fetch('/api/ai/status', { signal: AbortSignal.timeout(3000) })
    return await res.json()
  } catch {
    return { enabled: false, provider: null }
  }
}
