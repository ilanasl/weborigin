// ── Supabase Edge Function: gemini ──
// מתווך דק בין הדפדפן ל-Gemini API. מפתח ה-API נשמר כאן כ-Secret ולא נחשף ללקוח.
// הלקוח בונה את כל הפרומפט (parts) ושולח אותו; השרת רק מוסיף את המפתח וקורא ל-Gemini.
// כך כל הלוגיקה חיה בצד הלקוח ומתעדכנת אוטומטית — אין צורך לפרוס את הפונקציה שוב.
//
// פריסה (רק פעם אחת):
//   Supabase → Edge Functions → gemini → Code → הדביקו → Deploy
//   Secret נדרש: GEMINI_API_KEY

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'
const API_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// grounded=true מפעיל חיפוש-ברשת אמיתי (Google Search) — למשל להבאת נוסח מדויק של שיר/פסוקים
async function gemini(parts: unknown[], wantJson: boolean, grounded: boolean) {
  const reqBody: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: wantJson && !grounded
      ? { temperature: 0.4, responseMimeType: 'application/json' }
      : { temperature: grounded ? 0.2 : 0.6 },
  }
  if (grounded) reqBody.tools = [{ google_search: {} }]
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('')
  // deno-lint-ignore no-explicit-any
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  // deno-lint-ignore no-explicit-any
  const sources = chunks.map((c: any) => c?.web?.uri).filter(Boolean)
  return { text, sources }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!API_KEY) return json({ error: 'GEMINI_API_KEY missing' }, 500)

  try {
    const body = await req.json()
    if (!Array.isArray(body.parts)) return json({ error: 'missing_parts' }, 400)
    const { text, sources } = await gemini(body.parts, !!body.wantJson, !!body.grounded)
    return json({ text, sources })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
