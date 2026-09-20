import { SUPABASE_URL, SUPABASE_ANON } from './supabase'

// כתובת פונקציית ה-Edge שמדברת עם Gemini (המפתח נשמר צד-שרת, לא נחשף לדפדפן).
const FN_URL =
  import.meta.env.VITE_GEMINI_FN_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/gemini` : '')

async function callGemini(payload) {
  if (!FN_URL) throw new Error('Gemini function URL is not configured')
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON || ''}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Gemini error ${res.status}: ${t}`)
  }
  return res.json()
}

// ניתוח חומר שהועלה (תמונה/PDF/טקסט) → נושא + סיכום + שאלות תרגול.
export function analyzeMaterial({ text, imageBase64, mimeType, subjectName, knownTopics = [] }) {
  return callGemini({
    task: 'analyze_material',
    text,
    imageBase64,
    mimeType,
    subjectName,
    knownTopics,
  })
}

// יצירת עוד שאלות תרגול מנושא/חומר.
export function generateQuestions({ subjectName, topic, sourceText, count = 5, difficulty }) {
  return callGemini({ task: 'generate_questions', subjectName, topic, sourceText, count, difficulty })
}

// "תסביר לי" — שאלה חופשית בהקשר של החומר.
export function explain({ subjectName, context, question }) {
  return callGemini({ task: 'explain', subjectName, context, question })
}

// בדיקת תרגיל שפתר מצילום — צעד-אחר-צעד.
export function checkExercise({ imageBase64, mimeType, subjectName }) {
  return callGemini({ task: 'check_exercise', imageBase64, mimeType, subjectName })
}
