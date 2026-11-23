/**
 * Thin server function fronting the AI layer.
 *
 * It exists for exactly one reason: the LLM API key must never reach a browser.
 * It holds no patient data, keeps no state, and the app degrades gracefully if
 * this process is not running at all.
 */
import 'dotenv/config'
import express from 'express'
import { aiEnabled, aiProvider, summarize, explainFlag } from './ai.js'

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/api/ai/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), provider: aiProvider() })
})

app.post('/api/ai/summary', async (req, res) => {
  if (!aiEnabled()) {
    return res.json({ ok: false, text: 'AI summary unavailable — no provider key configured.' })
  }
  try {
    const text = await summarize(req.body?.record ?? {})
    res.json({ ok: true, text, provider: aiProvider() })
  } catch (err) {
    console.error('[ai/summary]', err.message)
    res.json({ ok: false, text: 'AI summary unavailable — showing the full record below.' })
  }
})

app.post('/api/ai/safety', async (req, res) => {
  const flag = req.body?.flag ?? {}
  // The rules engine already produced a usable sentence; the LLM only enriches it.
  const fallback = flag.message ? `${flag.message}. Review before prescribing.` : 'Prescribing conflict detected.'
  if (!aiEnabled()) return res.json({ ok: false, text: fallback })
  try {
    const text = await explainFlag(flag, req.body?.context ?? {})
    res.json({ ok: true, text, provider: aiProvider() })
  } catch (err) {
    console.error('[ai/safety]', err.message)
    res.json({ ok: false, text: fallback })
  }
})

const port = process.env.API_PORT || 8787
app.listen(port, () => {
  console.log(
    `[health-stack] AI service on :${port} — provider: ${aiProvider() ?? 'none (graceful fallback active)'}`,
  )
})
