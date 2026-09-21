// ── Supabase Edge Function: gemini ──
// מתווך בין הדפדפן ל-Gemini API. מפתח ה-API נשמר כאן כ-Secret ולא נחשף ללקוח.
// פריסה:
//   supabase functions deploy gemini --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=xxxx
//
// (אפשר גם עם JWT; --no-verify-jwt מקל בשלב ההתחלה. אפשר לאמת ידנית בהמשך.)

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

const HEB_RULE = 'כתוב אך ורק בעברית תקינה. מותר להשתמש באנגלית רק כשהיא חלק מהמקצוע. אסור להשתמש באותיות משפות אחרות (למשל גאורגית, רוסית, יוונית).'
const VARY_RULE = 'פזר/י את התשובה הנכונה בין המיקומים — לא תמיד האפשרות הראשונה.'

// חילוץ JSON מתשובת המודל (מסיר ```json גדרות אם יש)
function parseJson(text: string) {
  const c = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = c.indexOf('{')
  const arrStart = c.indexOf('[')
  const from = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart)
  if (from < 0) return null
  const close = c[from] === '{' ? '}' : ']'
  try { return JSON.parse(c.slice(from)) } catch { /* try trimmed */ }
  const last = c.lastIndexOf(close)
  if (last > from) { try { return JSON.parse(c.slice(from, last + 1)) } catch { /* fallthrough */ } }
  return null
}

// deno-lint-ignore no-explicit-any
function shuffleQuestions(list: any) {
  if (!Array.isArray(list)) return list
  return list.map((q) => {
    if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
    const correct = q.choices[q.answer]
    const order = q.choices.map((_: unknown, i: number) => i)
    for (let i = order.length - 1; i > 0; i--) { const k = (Math.random() * (i + 1)) | 0;[order[i], order[k]] = [order[k], order[i]] }
    const choices = order.map((i: number) => q.choices[i])
    return { ...q, choices, answer: choices.indexOf(correct) }
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

function imagePart(imageBase64: string, mimeType: string) {
  return { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!API_KEY) return json({ error: 'GEMINI_API_KEY missing' }, 500)

  try {
    const body = await req.json()

    // ── מצב "צינור דק" ──
    // הלקוח בונה את הפרומפט (parts) ושולח אותו; השרת רק מוסיף את המפתח וקורא ל-Gemini.
    // כך כל הלוגיקה חיה בצד הלקוח (מתעדכן אוטומטית) ואין צורך לפרוס את הפונקציה שוב.
    if (Array.isArray(body.parts)) {
      const text = await gemini(body.parts, !!body.wantJson)
      return json({ text })
    }

    // ── מצב ישן (תאימות לאחור) ──
    const { task } = body

    if (task === 'analyze_material') {
      const { text, imageBase64, mimeType, subjectName, knownTopics = [] } = body
      const prompt =
        `אתה עוזר לימוד לתלמיד/ה בכיתה ט' במקצוע "${subjectName}". ` +
        `לפניך חומר לימוד (תמונה מהמחברת / דף עבודה / טקסט). ` +
        (knownTopics.length ? `נושאים קיימים במקצוע: ${knownTopics.join(', ')}. אם החומר מתאים לאחד מהם, החזר אותו שם בדיוק. ` : '') +
        `החזר JSON בלבד במבנה:\n` +
        `{"topic": "שם הנושא הקצר", "summary_md": "סיכום קצר וברור ב-Markdown עם כותרות ונקודות", ` +
        `"questions": [{"q":"שאלה","choices":["א","ב","ג","ד"],"answer":0,"difficulty":"קל|בינוני|קשה","explain":"הסבר קצר למה זו התשובה","hint":"רמז שלא מגלה את התשובה"}], ` +
        `"flashcards": [{"front":"מושג","back":"הגדרה קצרה"}]}\n` +
        `צור 5 שאלות אמריקאיות (4 מסיחים כל אחת, מגוון קושי) ו-4 כרטיסיות. ` + HEB_RULE + ' ' + VARY_RULE +
        ` אם החומר הוא תחביר / ניתוח משפט — כלול שאלות שבהן נתון משפט והתלמיד/ה בוחר/ת מה התפקיד התחבירי של מילה מסוימת בו (נושא, נשוא, מושא, לוואי וכו').`
      const parts: unknown[] = [{ text: prompt }]
      if (text) parts.push({ text: `\nהטקסט:\n${text}` })
      if (imageBase64) parts.push(imagePart(imageBase64, mimeType))
      const out = await gemini(parts, true)
      const parsed = parseJson(out)
      if (!parsed) return json({ error: 'parse_failed', raw: out }, 502)
      parsed.questions = shuffleQuestions(parsed.questions)
      return json(parsed)
    }

    if (task === 'generate_questions') {
      const { subjectName, topic, sourceText, count = 5, difficulty } = body
      const prompt =
        `צור ${count} שאלות אמריקאיות למקצוע "${subjectName}"${topic ? `, נושא "${topic}"` : ''}` +
        `${difficulty ? `, ברמת קושי ${difficulty}` : ''}. בסגנון מבחנים אמיתיים. ` +
        `החזר JSON: {"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"","explain":"","hint":""}]}. ` +
        HEB_RULE + ' ' + VARY_RULE + ' ' +
        (sourceText ? `בהתבסס על החומר:\n${sourceText}` : '')
      const out = await gemini([{ text: prompt }], true)
      const parsed = parseJson(out)
      if (!parsed) return json({ error: 'parse_failed', raw: out }, 502)
      parsed.questions = shuffleQuestions(parsed.questions)
      return json(parsed)
    }

    if (task === 'explain') {
      const { subjectName, context, question } = body
      const prompt =
        `את/ה מורה סבלני/ת למקצוע "${subjectName}". הסבר/י בפשטות ובעברית, בקצרה, ברמת כיתה ט'. ` +
        (context ? `הקשר החומר: ${context}\n` : '') +
        `שאלת התלמיד/ה: ${question}`
      const out = await gemini([{ text: prompt }], false)
      return json({ answer: out })
    }

    if (task === 'check_exercise') {
      const { imageBase64, mimeType, subjectName } = body
      const prompt =
        `לפניך צילום של תרגיל שתלמיד/ה בכיתה ט' פתר/ה במחברת (מקצוע ${subjectName}). ` +
        `קרא/י את הפתרון, בדוק/י אותו, וזהה/י איפה נפלה הטעות (אם יש). ` +
        `החזר/י JSON: {"exercise":"התרגיל שזוהה","correct":true/false,` +
        `"steps":[{"text":"שלב","ok":true/false}],"feedback":"הסבר איפה הטעות ואיך לתקן","reteach":"מה חשוב לזכור"}`
      const out = await gemini([{ text: prompt }, imagePart(imageBase64, mimeType)], true)
      const parsed = parseJson(out)
      if (!parsed) return json({ error: 'parse_failed', raw: out }, 502)
      return json(parsed)
    }

    return json({ error: 'unknown_task' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
