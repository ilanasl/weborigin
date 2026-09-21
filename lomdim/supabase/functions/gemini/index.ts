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

async function gemini(parts: unknown[], wantJson: boolean) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: wantJson
        ? { temperature: 0.4, responseMimeType: 'application/json' }
        : { temperature: 0.6 },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!API_KEY) return json({ error: 'GEMINI_API_KEY missing' }, 500)

  try {
    const body = await req.json()
    if (!Array.isArray(body.parts)) return json({ error: 'missing_parts' }, 400)
    const text = await gemini(body.parts, !!body.wantJson)
    return json({ text })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
