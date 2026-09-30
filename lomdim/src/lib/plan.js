import { supabase } from './supabase'
import { mastery, STRONG } from './mastery'
import { matchScopeTopics } from './gemini'

// ── תוכנית הלמידה למבחן (משותף למתכנן ולבדיקת "סיימת את היום בתוכנית") ──

// כמה ימים לפני מתחילים ללמוד — מבדק קצר יותר, מבחן מסכם ארוך יותר
export const LEAD_DEFAULT = { 'מבדק': 4, 'מבחן מסכם': 8 }

const DAY = 86400000
// תאריך "2026-10-08" נקרא כחצות לפי שעון ישראל (ולא UTC — שאחרת יוצא 03:00 ומעגל ליום נוסף)
export const parseDay = (d) => {
  if (!d) return null
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d)
}
// כמה ימים עד התאריך (0 = היום). אותו חישוב בכל המסכים
export const daysUntil = (d) => d ? Math.round((parseDay(d) - new Date(new Date().toDateString())) / DAY) : null
export const addDays = (d) => { const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() + d); return dt }

// הסוג הקרוב יותר מבין מבדק/מבחן שכבר הוגדר לו תאריך
export function nearestKind(subject) {
  const qd = daysUntil(subject?.quiz_date), ed = daysUntil(subject?.exam_date)
  return (qd != null && qd >= 0 && (ed == null || ed < 0 || qd <= ed)) ? 'מבדק' : 'מבחן מסכם'
}

// ── מבחן/מבדק שעבר: מאפסים תאריך ומיקוד, ומעדכנים את סימון הנושאים ──
// אחרי האיפוס: אם נשאר מבחן קרוב עם מיקוד — הנושאים מסומנים לפיו; אחרת "מבדק" הוא על כל החומר.
// נשמר סימון מקומי כדי להציג במסך המקצוע "המבחן עבר — העלו חומר חדש".
export const PASSED_KEY = (id) => `lomdim-exam-passed:${id}`
export async function expirePastExams(subjects) {
  const out = []
  for (const s of subjects || []) {
    const patch = {}
    let passedKind = null
    if (s.quiz_date && daysUntil(s.quiz_date) < 0) { patch.quiz_date = null; patch.quiz_scope_text = null; passedKind = 'מבדק' }
    if (s.exam_date && daysUntil(s.exam_date) < 0) { patch.exam_date = null; patch.exam_scope_text = null; passedKind = passedKind || 'מבחן מסכם' }
    if (!passedKind) { out.push(s); continue }
    const next = { ...s, ...patch }
    try {
      await supabase.from('subjects').update(patch).eq('id', s.id)
      await refreshScopeTopics(next)
      try { localStorage.setItem(PASSED_KEY(s.id), JSON.stringify({ kind: passedKind, ts: Date.now() })) } catch { /* */ }
    } catch { /* ננסה בפעם הבאה */ }
    out.push(next)
  }
  return out
}

// סימון "במבחן" לפי המיקוד של המבחן הקרוב; בלי מיקוד — אף נושא לא מסומן (= כל החומר)
export async function refreshScopeTopics(subject) {
  const kind = nearestKind(subject)
  const date = kind === 'מבדק' ? subject.quiz_date : subject.exam_date
  const scope = String((kind === 'מבדק' ? subject.quiz_scope_text : subject.exam_scope_text) || '').trim()
  const { data: topics } = await supabase.from('topics').select('id, name').eq('subject_id', subject.id)
  if (!topics?.length) return null
  let set = new Set()
  if (date && daysUntil(date) >= 0 && scope) {
    const { in_exam } = await matchScopeTopics({ subjectName: subject.name, scopeText: scope, knownTopics: topics.map((t) => t.name) })
    set = new Set(in_exam || [])
  }
  await Promise.all(topics.map((t) => supabase.from('topics').update({ in_exam: set.has(t.name) }).eq('id', t.id)))
  return set
}

// topics: [{ id, name, in_exam, att: [{ correct, difficulty, ts }] }] · allTs: זמני כל התשובות במקצוע
export function buildStudyPlan({ examDays, leadDays, topics, allTs }) {
  if (examDays == null || examDays < 1) return { days: [], startsInDays: null }
  // חלון הלמידה קבוע לפי תאריך המבחן (גם ימים שכבר עברו נשארים בתוכנית, מסומנים)
  const startOffset = examDays - leadDays
  const startMs = addDays(startOffset).getTime()
  // סדר "חלשים קודם" לפי השליטה כפי שהייתה בתחילת החלון — כך התוכנית לא מתערבבת תוך כדי תרגול
  const inExam = topics.filter((t) => t.in_exam)
  const ordered = [...(inExam.length ? inExam : topics)]
    .map((t) => ({ ...t, m0: mastery(t.att.filter((a) => a.ts < startMs)) }))
    .sort((a, b) => (a.m0.pct ?? 50) - (b.m0.pct ?? 50))

  // נושא "בוצע": לפי התרגול מאז תחילת החלון, הנושא ברמת "חזק" (לפחות 5 תשובות, 80%+ נכונות)
  const topicDone = (t) => (mastery(t.att.filter((a) => a.ts >= startMs)).pct ?? 0) >= STRONG
  // יום החזרה "בוצע": באותו יום ענה על לפחות 10 שאלות במקצוע
  const reviewDone = (dt) => {
    const from = dt.getTime(), to = from + DAY
    return allTs.filter((ts) => ts >= from && ts < to).length >= 10
  }

  const studyOffsets = []
  for (let d = startOffset; d <= examDays - 2; d++) studyOffsets.push(d)
  const days = []
  const n = studyOffsets.length
  const perDay = n > 0 ? Math.max(1, Math.ceil(ordered.length / n)) : 0
  let ti = 0
  studyOffsets.forEach((d, idx) => {
    const day = []
    for (let k = 0; k < perDay && ti < ordered.length; k++) day.push(ordered[ti++])
    if (day.length === 0 && ordered.length) day.push(ordered[idx % ordered.length])
    const topicsOfDay = day.map((t) => ({ ...t, done: topicDone(t) }))
    days.push({ dt: addDays(d), off: d, topics: topicsOfDay, done: topicsOfDay.length > 0 && topicsOfDay.every((t) => t.done) })
  })
  if (examDays >= 2) { const dt = addDays(examDays - 1); days.push({ dt, off: examDays - 1, review: true, done: reviewDone(dt) }) }
  days.push({ dt: addDays(examDays), off: examDays, exam: true })
  return { days, startsInDays: startOffset > 1 ? startOffset : null }
}

// אחרי סבב: האם היום של היום בתוכנית הושלם עכשיו (ועוד לא חגגנו אותו)? מחזיר פרטים לחגיגה או null.
export async function checkPlanDayDone(subjectId) {
  try {
    const [{ data: s }, { data: tp }, { data: at }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', subjectId).single(),
      supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', subjectId),
    ])
    if (!s) return null
    const kind = nearestKind(s)
    const examDays = daysUntil(kind === 'מבדק' ? s.quiz_date : s.exam_date)
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
    }
    const topics = (tp || []).map((t) => ({ ...t, att: byTopic[t.id] || [] }))
    const allTs = (at || []).map((a) => new Date(a.created_at).getTime())
    const { days } = buildStudyPlan({ examDays, leadDays: LEAD_DEFAULT[kind], topics, allTs })
    const today = days.find((d) => d.off === 0 && !d.exam)
    if (!today?.done) return null
    // חוגגים כל יום פעם אחת בלבד
    const key = `lomdim-planday:${subjectId}:${today.dt.toDateString()}`
    try { if (localStorage.getItem(key)) return null; localStorage.setItem(key, '1') } catch { /* בלי אחסון — חוגגים */ }
    return { kind, examDays, subjectName: s.name, review: !!today.review }
  } catch { return null }
}
