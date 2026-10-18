// עוד שאלות לנושא קיים — מהסיכום שלו, בלי לחזור על שאלות שכבר יש.
// משמש את "עוד שאלות לנושא" (כלים לנושא) ואת ההשלמה האוטומטית אחרי העלאה (נושא עם מעט שאלות).
import { supabase } from './supabase'
import { generateQuestions, filterNewQuestions, stripNotebookWarnings } from './gemini'

export const MIN_QUESTIONS = 6
const SKIP = ['note', 'style', 'check']

const norm = (t) => String(t || '').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 1))
// שאלה כמעט זהה (80% מהמילים משותפות)
export const similarQ = (a, b) => {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return false
  let n = 0; for (const w of A) if (B.has(w)) n++
  return n / Math.min(A.size, B.size) >= 0.8
}
export const normText = norm

// מסנן שאלות חדשות מול הקיימות בנושא: AI (מה באמת לא מתורגל מספיק), ובלי AI — לפחות בלי כמעט-זהות
export async function keepNew({ subjectName, topicName, existing, fresh, soft = false }) {
  if (!existing.length) return fresh
  try {
    const { keep } = await filterNewQuestions({ subjectName, topicName, existing, fresh: fresh.map((q, i) => ({ i: i + 1, q: q.q })), soft })
    if (Array.isArray(keep)) { const set = new Set(keep.map(Number)); return fresh.filter((_, i) => set.has(i + 1)) }
  } catch { /* */ }
  return fresh.filter((q) => !existing.some((e) => similarQ(q.q, e)))
}

// יוצר עוד count שאלות לנושא ושומר אותן. מחזיר { n: כמה נוספו, dropped: כמה נפסלו כחזרה על קיימות }.
// סינון רך (רק אותה שאלה בניסוח אחר נפסלת); אם נשארו פחות מ-count — סבב השלמה אחד.
export async function addMoreQuestions({ subjectId, subjectName, topicId, topicName, learner, count = 8 }) {
  const [{ data: mats }, { data: ex }] = await Promise.all([
    supabase.from('materials').select('kind, summary_md, source_text').eq('topic_id', topicId),
    supabase.from('questions').select('q').eq('topic_id', topicId).limit(300),
  ])
  const merged = (mats || []).find((m) => m.kind === 'summary' && m.summary_md)
  const source = merged
    ? stripNotebookWarnings(merged.summary_md)
    : (mats || []).filter((m) => !SKIP.includes(m.kind)).map((m) => [stripNotebookWarnings(m.summary_md), m.source_text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n---\n\n')
  if (!source.trim()) throw new Error('no_source')
  const existing = (ex || []).map((r) => r.q).filter(Boolean)
  const added = []
  let dropped = 0
  for (let round = 0; round < 2 && added.length < count; round++) {
    const known = [...existing, ...added.map((q) => q.q)]
    const avoid = known.length ? `\n\nשאלות שכבר יש לנושא — אל תחזור/י עליהן; צור/י שאלות עם מקרים, נתונים ודוגמאות אחרים, ובדוק/י גם חלקים אחרים בחומר:\n${known.slice(-60).map((q) => `- ${String(q).slice(0, 160)}`).join('\n')}` : ''
    const need = count - added.length
    const { questions = [] } = await generateQuestions({ subjectName, topic: topicName, sourceText: String(source).slice(0, 12000) + avoid, count: need + (round ? 0 : 2), learner })
    const fresh = await keepNew({ subjectName, topicName, existing: known, fresh: questions, soft: true })
    dropped += Math.max(0, questions.length - fresh.length)
    added.push(...fresh.slice(0, need))
  }
  if (added.length) {
    await supabase.from('questions').insert(added.map((q) => ({
      subject_id: subjectId, topic_id: topicId,
      q: q.q, choices: q.choices, answer: q.answer,
      difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
    })))
  }
  return { n: added.length, dropped }
}
