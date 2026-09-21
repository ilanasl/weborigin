import { SUPABASE_URL, SUPABASE_ANON } from './supabase'

// ── שני מצבים ──
// 1) מצב "ישיר" (הכי קל להרצה): אם הוגדר VITE_GEMINI_API_KEY, קוראים ל-Gemini
//    ישירות מהדפדפן. נוח לפיתוח/בדיקה מקומית. ⚠️ אל תפרסו כך לאתר ציבורי —
//    המפתח נחשף בקוד. לפרודקשן השתמשו בפונקציית ה-Edge (מצב 2).
// 2) מצב "פונקציה" (מאובטח): קריאה לפונקציית ה-Edge של Supabase שמסתירה את המפתח.

const DIRECT_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.6-flash'
const FN_URL =
  import.meta.env.VITE_GEMINI_FN_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/gemini` : '')

// כללים שחוזרים בכמה משימות
const HEB_RULE = 'כתוב אך ורק בעברית תקינה. מותר להשתמש באנגלית רק כשהיא חלק מהמקצוע. אסור להשתמש באותיות משפות אחרות (למשל גאורגית, רוסית, יוונית) — אם הזדהו כאלה, התעלם מהן.'
const VARY_RULE = 'פזר/י את התשובה הנכונה בין המיקומים — לא תמיד האפשרות הראשונה.'

// ── בניית הפרומפט לכל משימה (משותף לשני המצבים) ──
function buildParts(payload) {
  const { task } = payload
  const parts = []
  const img = (b64, mt) => ({ inlineData: { mimeType: mt || 'image/jpeg', data: b64 } })

  if (task === 'analyze_material') {
    const { text, imageBase64, mimeType, subjectName, knownTopics = [] } = payload
    parts.push({ text:
      `אתה עוזר לימוד לתלמיד/ה בכיתה ט' במקצוע "${subjectName}". לפניך חומר לימוד. ` +
      (knownTopics.length ? `נושאים קיימים: ${knownTopics.join(', ')}. אם מתאים לאחד — החזר אותו שם בדיוק. ` : '') +
      `החזר JSON בלבד: {"topic":"שם נושא קצר","summary_md":"סיכום ב-Markdown עם כותרות ונקודות",` +
      `"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"קל|בינוני|קשה","explain":"","hint":""}],` +
      `"flashcards":[{"front":"מושג","back":"הגדרה"}]}. צור 5 שאלות (4 מסיחים) ו-4 כרטיסיות. ` +
      HEB_RULE + ` ` + VARY_RULE +
      ` אם החומר הוא תחביר / ניתוח משפט — כלול שאלות שבהן נתון משפט והתלמיד/ה בוחר/ת מה התפקיד התחבירי של מילה מסוימת בו (נושא, נשוא, מושא, לוואי וכו').` })
    if (text) parts.push({ text: `\nהטקסט:\n${text}` })
    if (imageBase64) parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: true }
  }
  if (task === 'generate_questions') {
    const { subjectName, topic, sourceText, count = 5, difficulty } = payload
    parts.push({ text:
      `צור ${count} שאלות אמריקאיות למקצוע "${subjectName}"${topic ? `, נושא "${topic}"` : ''}${difficulty ? `, קושי ${difficulty}` : ''}. ` +
      `החזר JSON: {"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"","explain":"","hint":""}]}. ` +
      HEB_RULE + ` ` + VARY_RULE + ` ` +
      (sourceText ? `לפי החומר:\n${sourceText}` : '') })
    return { parts, wantJson: true }
  }
  if (task === 'explain') {
    const { subjectName, context, question } = payload
    parts.push({ text:
      `את/ה מורה סבלני/ת ל"${subjectName}". הסבר/י בפשטות ובקצרה, ברמת כיתה ט'. ` +
      (context ? `הקשר: ${context}\n` : '') + `שאלה: ${question}` })
    return { parts, wantJson: false }
  }
  if (task === 'check_exercise') {
    const { imageBase64, mimeType, subjectName } = payload
    parts.push({ text:
      `צילום של תרגיל שנפתר במחברת (מקצוע ${subjectName}). בדוק/י וזהה/י איפה הטעות. ` +
      `החזר/י JSON: {"exercise":"","correct":true,"steps":[{"text":"","ok":true}],"feedback":"","reteach":""}` })
    parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: true }
  }
  return { parts: [{ text: 'unknown task' }], wantJson: false }
}

function parseJson(text) {
  const c = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const i = c.indexOf('{'); const j = c.indexOf('[')
  const from = i === -1 ? j : j === -1 ? i : Math.min(i, j)
  if (from < 0) return null
  const open = c[from]
  const close = open === '{' ? '}' : ']'
  // ניסיון 1: מהסוגר הראשון עד הסוף
  try { return JSON.parse(c.slice(from)) } catch { /* ננסה לגזור עד הסוגר התואם האחרון */ }
  const last = c.lastIndexOf(close)
  if (last > from) { try { return JSON.parse(c.slice(from, last + 1)) } catch { /* fallthrough */ } }
  return null
}

// ערבוב מסיחים כדי שהתשובה הנכונה לא תהיה תמיד באותו מקום
function shuffleQuestions(list) {
  if (!Array.isArray(list)) return list
  return list.map((q) => {
    if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
    const correct = q.choices[q.answer]
    const order = q.choices.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) { const k = Math.random() * (i + 1) | 0;[order[i], order[k]] = [order[k], order[i]] }
    const choices = order.map((i) => q.choices[i])
    return { ...q, choices, answer: choices.indexOf(correct) }
  })
}

async function callDirect(payload) {
  const { parts, wantJson } = buildParts(payload)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${DIRECT_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: wantJson ? { temperature: 0.4, responseMimeType: 'application/json' } : { temperature: 0.6 },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!wantJson) return { answer: out }
  const parsed = parseJson(out)
  if (!parsed) throw new Error('parse_failed')
  return parsed
}

async function callFn(payload) {
  if (!FN_URL) throw new Error('Gemini function URL is not configured')
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON || ''}` },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

const call = (payload) => (DIRECT_KEY ? callDirect(payload) : callFn(payload))

export const analyzeMaterial = async (p) => {
  const out = await call({ task: 'analyze_material', ...p })
  return { ...out, questions: shuffleQuestions(out.questions) }
}
export const generateQuestions = async (p) => {
  const out = await call({ task: 'generate_questions', ...p })
  return { ...out, questions: shuffleQuestions(out.questions) }
}
export const explain = (p) => call({ task: 'explain', ...p })
export const checkExercise = (p) => call({ task: 'check_exercise', ...p })

// חתימת תוכן של קובץ (SHA-256) — לזיהוי קובץ שכבר הועלה
export async function fileHash(file) {
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}
