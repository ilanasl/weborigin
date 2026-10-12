import { supabase } from './supabase'
import { fetchAll } from './fetchAll'
import { mastery, STRONG } from './mastery'
import { matchScopeTopics, orderTopics, scopeGaps, topicSummary, generateQuestions } from './gemini'

// ── תוכנית הלמידה למבחן (משותף למתכנן ולבדיקת "סיימת את היום בתוכנית") ──

// כמה ימים לפני מתחילים ללמוד — מבדק קצר יותר, מבחן מסכם ארוך יותר
export const LEAD_DEFAULT = { 'מבדק': 4, 'מבחן מסכם': 8 }

const DAY = 86400000
const ROUND = 10 // סבב שאלות על נושא — פותח את הנושא הבא בתוכנית
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
    let passedDate = null   // תאריך המבחן שעבר — כדי שבמסך "מבחנים שעברו" לא יצטרכו להזין אותו שוב
    if (s.quiz_date && daysUntil(s.quiz_date) < 0) { patch.quiz_date = null; patch.quiz_scope_text = null; passedKind = 'מבדק'; passedDate = s.quiz_date }
    if (s.exam_date && daysUntil(s.exam_date) < 0) {
      patch.exam_date = null; patch.exam_scope_text = null
      if (!passedDate || s.exam_date > passedDate) { passedKind = 'מבחן מסכם'; passedDate = s.exam_date }
    }
    if (!passedKind) { out.push(s); continue }
    const next = { ...s, ...patch }
    try {
      await supabase.from('subjects').update(patch).eq('id', s.id)
      await refreshScopeTopics(next)
      try { localStorage.setItem(PASSED_KEY(s.id), JSON.stringify({ kind: passedKind, date: passedDate, ts: Date.now() })) } catch { /* */ }
    } catch { /* ננסה בפעם הבאה */ }
    out.push(next)
  }
  return out
}

// מיקוד שאומר "כל החומר" ("הכול", "כל הנושאים"...) — בלי החרגות ("חוץ מ…") ובלי פירוט של חומר מסוים.
// נחשב כמו בלי מיקוד: אף נושא לא מסומן, וכך גם נושאים שיועלו אחר כך נכנסים אוטומטית.
export const isAllScope = (text) => {
  const t = String(text || '').trim()
  if (!t || t.length > 60) return false
  // החרגה או חומר מסוים ("כל החומר של פרק ב׳") — לא "כל החומר"
  if (/\d|חוץ|מלבד|בלי |ללא|פרט ל|פרק|פסוק|עמ|יחיד|שיר|סיפור|עד /.test(t)) return false
  return /כל החומר|כל הנושאים|^(על )?הכו?ל[.!]?$/.test(t)
}

// המיקוד כולל "כל החומר" (גם אם יש בו בנוסף רשימת נושאים) — כל מה שהועלה בפנים, בלי סימונים
export const scopeIncludesAll = (text) => String(text || '').split(/\n+/).some((l) => isAllScope(l.replace(/[*_#]/g, '')))

// סימון "במבחן" לפי המיקוד של המבחן הקרוב; בלי מיקוד — אף נושא לא מסומן (= כל החומר)
export async function refreshScopeTopics(subject) {
  const kind = nearestKind(subject)
  const date = kind === 'מבדק' ? subject.quiz_date : subject.exam_date
  const scope = String((kind === 'מבדק' ? subject.quiz_scope_text : subject.exam_scope_text) || '').trim()
  const { data: topics } = await supabase.from('topics').select('id, name').eq('subject_id', subject.id)
  if (!topics?.length) return null
  let set = new Set()
  if (date && daysUntil(date) >= 0 && scope && !scopeIncludesAll(scope)) {
    const { in_exam } = await matchScopeTopics({ subjectName: subject.name, scopeText: scope, knownTopics: topics.map((t) => t.name) })
    set = new Set(in_exam || [])
  }
  await Promise.all(topics.map((t) => supabase.from('topics').update({ in_exam: set.has(t.name) }).eq('id', t.id)))
  return set
}

// ── מה מהמיקוד עוד אין עליו חומר ──
// נשמר ב-subjects.scope_gaps (וגם במכשיר, למקרה שהעמודה עוד לא נוספה): { kind, scope, ts, covered:[{part,topic}], missing:[{name,part}] }
export const GEN_MARK = '🌐 נכתב מהידע הכללי'
const GAPS_KEY = (id) => `lomdim-scope-gaps:${id}`

function scopeOf(subject) {
  const kind = nearestKind(subject)
  return { kind, scope: String((kind === 'מבדק' ? subject.quiz_scope_text : subject.exam_scope_text) || '').trim() }
}

async function saveGaps(subjectId, g) {
  try { localStorage.setItem(GAPS_KEY(subjectId), JSON.stringify(g)) } catch { /* */ }
  try { await supabase.from('subjects').update({ scope_gaps: g }).eq('id', subjectId) } catch { /* העמודה עוד לא נוספה */ }
}

// הבדיקה האחרונה — רק אם היא עדיין על אותו מיקוד של המבחן הקרוב
export function readGaps(subject) {
  if (!subject) return null
  let local = null
  try { local = JSON.parse(localStorage.getItem(GAPS_KEY(subject.id)) || 'null') } catch { /* */ }
  const db = subject.scope_gaps || null
  // הגרסה העדכנית מבין השתיים (המסד משותף למכשירים; המכשיר — אם העמודה עוד לא נוספה)
  const g = !db ? local : !local ? db : (local.ts > db.ts ? local : db)
  const { kind, scope } = scopeOf(subject)
  if (!g || !scope || g.kind !== kind || g.scope !== scope) return null
  return g
}

// נוסף נושא אחרי הבדיקה האחרונה → כדאי לבדוק שוב (אולי הוא מכסה חלק חסר)
export const gapsStale = (g, topics = []) => !!g && topics.some((t) => new Date(t.created_at).getTime() > g.ts)

export async function checkScopeGaps(subject) {
  const { kind, scope } = scopeOf(subject)
  const date = kind === 'מבדק' ? subject.quiz_date : subject.exam_date
  if (!scope || isAllScope(scope) || !date || daysUntil(date) < 0) { await saveGaps(subject.id, null); return null }
  const [{ data: topics }, { data: mats }] = await Promise.all([
    supabase.from('topics').select('id, name').eq('subject_id', subject.id),
    supabase.from('materials').select('topic_id, kind, summary_md').eq('subject_id', subject.id).not('summary_md', 'is', null),
  ])
  const sum = {}
  for (const m of mats || []) {
    if (!m.topic_id || m.kind === 'style') continue
    if (m.kind === 'summary' || !sum[m.topic_id]) sum[m.topic_id] = m.summary_md
  }
  const out = await scopeGaps({ subjectName: subject.name, scopeText: scope, topics: (topics || []).map((t) => ({ name: t.name, summary: sum[t.id] })) })
  const names = new Set((topics || []).map((t) => t.name.trim()))
  const g = {
    kind, scope, ts: Date.now(),
    covered: (out.covered || []).filter((c) => c?.part && names.has(String(c.topic || '').trim())),
    missing: (out.missing || []).filter((m) => m?.name && !names.has(String(m.name).trim())),
  }
  await saveGaps(subject.id, g)
  // נושא שמכסה חלק מהמיקוד — מסומן "במיקוד" (כדי שלא יישאר מחוץ לתוכנית). ב"כל החומר" — אין סימונים.
  if (!scopeIncludesAll(scope) && g.covered.length) {
    const ids = (topics || []).filter((t) => g.covered.some((c) => String(c.topic).trim() === t.name.trim())).map((t) => t.id)
    if (ids.length) await supabase.from('topics').update({ in_exam: true }).in('id', ids)
  }
  return g
}

// נושא חדש מהידע הכללי לחלק חסר במיקוד: סיכום (עם תגית) + שאלות תרגול, במיקוד
export async function createTopicFromGeneral({ subject, item, learner }) {
  const name = String(item.name).trim()
  // "במיקוד" רק כשהמיקוד מפורט; ב"כל החומר" — בלי סימון (אחרת רק הנושא הזה ייחשב במבחן)
  const inExam = !scopeIncludesAll(scopeOf(subject).scope)
  const { data: tp, error } = await supabase.from('topics').insert({ subject_id: subject.id, name, origin: 'השנה', in_exam: inExam }).select('*').single()
  if (error || !tp) throw new Error('topic')
  const { summary_md } = await topicSummary({ subjectName: subject.name, topicName: name, learner, focus: item.part })
  const { data: mat } = await supabase.from('materials').insert({
    subject_id: subject.id, topic_id: tp.id, title: 'נכתב מהידע הכללי', kind: 'summary', summary_md: `${GEN_MARK}\n\n${summary_md}`,
  }).select('id').single()
  const { questions = [] } = await generateQuestions({ subjectName: subject.name, topic: name, sourceText: summary_md, count: 10, learner })
  if (questions.length) {
    await supabase.from('questions').insert(questions.map((q) => ({
      subject_id: subject.id, topic_id: tp.id, material_id: mat?.id,
      q: q.q, choices: q.choices, answer: q.answer,
      difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
    })))
  }
  // החלק עבר מ"חסר" ל"יש"
  const g = readGaps(subject)
  if (g) {
    await saveGaps(subject.id, {
      ...g, ts: Date.now(),
      missing: g.missing.filter((m) => m.name !== item.name),
      covered: [...g.covered, { part: item.part, topic: name }],
    })
  }
  return { topic: tp, qCount: questions.length }
}

// סדר לימוד הגיוני לנושאי המקצוע (לתוכנית לפי ימים) — נשמר ב-topics.plan_order.
// נכשל בשקט (למשל אם העמודה עוד לא נוספה במסד) — ואז התוכנית נשארת "חלשים קודם".
export async function orderPlanTopics(subject) {
  try {
    const [{ data: topics }, { data: mats }] = await Promise.all([
      supabase.from('topics').select('id, name').eq('subject_id', subject.id),
      supabase.from('materials').select('topic_id, kind, summary_md').eq('subject_id', subject.id).not('summary_md', 'is', null),
    ])
    if (!topics || topics.length < 2) return false
    const sum = {}
    for (const m of mats || []) {
      if (!m.topic_id || m.kind === 'style') continue
      if (m.kind === 'summary' || !sum[m.topic_id]) sum[m.topic_id] = m.summary_md
    }
    const { order } = await orderTopics({ subjectName: subject.name, topics: topics.map((t) => ({ name: t.name, summary: sum[t.id] })) })
    if (!Array.isArray(order) || !order.length) return false
    const rank = new Map(order.map((n, i) => [String(n).trim(), i]))
    const res = await Promise.all(topics.map((t) => supabase.from('topics').update({ plan_order: rank.get(t.name.trim()) ?? order.length }).eq('id', t.id)))
    return !res.some((r) => r.error)
  } catch { return false }
}

// topics: [{ id, name, in_exam, att: [{ correct, difficulty, ts }] }] · allTs: זמני כל התשובות במקצוע
export function buildStudyPlan({ examDays, leadDays, topics, allTs }) {
  if (examDays == null || examDays < 1) return { days: [], startsInDays: null }
  // חלון הלמידה קבוע לפי תאריך המבחן (גם ימים שכבר עברו נשארים בתוכנית, מסומנים)
  const startOffset = examDays - leadDays
  const startMs = addDays(startOffset).getTime()
  // סדר הלימוד: לפי plan_order (המערכת קובעת סדר הגיוני בשמירת התוכנית); נושא בלי סדר — בסוף, חלשים קודם
  // (לפי השליטה בתחילת החלון — כך התוכנית לא מתערבבת תוך כדי תרגול)
  const inExam = topics.filter((t) => t.in_exam)
  const ordered = [...(inExam.length ? inExam : topics)]
    .map((t) => ({ ...t, m0: mastery(t.att.filter((a) => a.ts < startMs)) }))
    .sort((a, b) => (a.plan_order ?? 1e9) - (b.plan_order ?? 1e9) || (a.m0.pct ?? 50) - (b.m0.pct ?? 50))

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
  // השלמה: נושאים מימים שעברו בתוכנית ולא בוצעו — עוברים להיום (לפני הנושאים של היום).
  // הימים שפוספסו מסומנים "הועבר להיום". ביום החזרה אין העברה — הוא ממילא על כל החומר.
  const todayDay = days.find((d) => d.off === 0)
  if (todayDay) {
    const have = new Set(todayDay.topics.map((t) => t.id))
    const carried = []
    for (const d of days.filter((x) => x.off < 0 && !x.done)) {
      for (const t of d.topics.filter((x) => !x.done)) {
        t.movedToToday = true
        if (!have.has(t.id)) { have.add(t.id); carried.push({ ...t, movedToToday: false, carriedFrom: d.dt, carriedOff: d.off }) }
      }
    }
    todayDay.topics = [...carried, ...todayDay.topics]
    todayDay.done = todayDay.topics.length > 0 && todayDay.topics.every((t) => t.done)
  }
  // נעילה לפי הסדר: נושא בתוכנית נפתח רק אחרי שעבר את כל הנושאים שלפניו
  // ("עבר" = חזק, או סבב של ROUND שאלות לפחות מאז תחילת החלון — כדי לא להיתקע בנושא קשה).
  // רק בתוכנית — התרגול החופשי פתוח תמיד.
  const passed = (t) => t.done || t.att.filter((a) => a.ts >= startMs).length >= ROUND
  const seq = []
  { const seen = new Set(); for (const d of days) for (const t of d.topics) if (!t.movedToToday && !seen.has(t.id)) { seen.add(t.id); seq.push(t) } }
  const unlocked = new Set()
  let current = null
  for (const t of seq) { unlocked.add(t.id); if (!passed(t)) { current = { id: t.id, name: t.name }; break } }
  for (const d of days) for (const t of d.topics) { t.passed = passed(t); t.locked = !unlocked.has(t.id) }
  // יום חזרה — היום שלפני המבחן. נשאר בתוכנית גם כשהוא היום עצמו (יום לפני המבחן)
  { const dt = addDays(examDays - 1); days.push({ dt, off: examDays - 1, review: true, done: reviewDone(dt) }) }
  days.push({ dt: addDays(examDays), off: examDays, exam: true })
  return { days, startsInDays: startOffset > 1 ? startOffset : null, current, ordered: ordered.some((t) => t.plan_order != null) }
}

// היום של היום בתוכנית הלמידה של מקצוע (או null): { s, kind, examDays, today }
export async function planToday(subjectId) {
  const [{ data: s }, { data: tp }, { data: at }] = await Promise.all([
    supabase.from('subjects').select('*').eq('id', subjectId).single(),
    supabase.from('topics').select('*').eq('subject_id', subjectId),
    fetchAll(() => supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', subjectId)),
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
  const today = days.find((d) => d.off === 0 && !d.exam) || null
  return { s, kind, examDays, today, days }
}

// אחרי סבב: האם היום של היום בתוכנית הושלם עכשיו (ועוד לא חגגנו אותו)? מחזיר פרטים לחגיגה או null.
export async function checkPlanDayDone(subjectId) {
  try {
    const p = await planToday(subjectId)
    const today = p?.today
    if (!today?.done) return null
    // חוגגים כל יום פעם אחת בלבד
    const key = `lomdim-planday:${subjectId}:${today.dt.toDateString()}`
    try { if (localStorage.getItem(key)) return null; localStorage.setItem(key, '1') } catch { /* בלי אחסון — חוגגים */ }
    // סיום התוכנית: יום החזרה (היום האחרון לפני המבחן) הושלם, או שכל ימי התרגול הושלמו → הזמן לסימולציה
    const planComplete = !!today.review || (p.days || []).filter((d) => !d.exam).every((d) => d.done)
    return { kind: p.kind, examDays: p.examDays, subjectName: p.s.name, review: !!today.review, planComplete }
  } catch { return null }
}

// ── משימת היום (הכרטיס "שאלות היום" בבית): לאן הוא מוביל ──
// 1) יש היום יום בתוכנית למבחן → הנושא של היום (הראשון שעוד לא הושלם); ביום חזרה — תרגול של המקצוע.
// 2) אין → המקצוע שתורגל הכי מעט בשבוע האחרון, ובו הנושא החלש ביותר (נושא שלא תורגל נחשב חלש).
export async function dailyTarget() {
  const { data: subs } = await supabase.from('subjects').select('id, name, exam_date, quiz_date').order('created_at')
  const upcoming = (subs || [])
    .map((s) => ({ s, d: Math.min(...[s.quiz_date, s.exam_date].map(daysUntil).filter((x) => x != null && x >= 0)) }))
    .filter((x) => Number.isFinite(x.d)).sort((a, b) => a.d - b.d)
  for (const { s } of upcoming) {
    const p = await planToday(s.id)
    const day = p?.today
    if (!day) continue
    if (day.review) return { subjectId: s.id, subjectName: s.name }
    // הנושא הפתוח הראשון שעוד לא עבר (לפי הסדר — כולל מה שפוספס), אחריו — פתוח שעוד לא חזק
    const open = day.topics.filter((x) => !x.locked)
    const t = open.find((x) => !x.passed) || open.find((x) => !x.done) || open[0] || day.topics[0]
    if (t) return { subjectId: s.id, subjectName: s.name, topicId: t.id, topicName: t.name }
  }
  // בלי תוכנית להיום — מקצוע שתורגל הכי מעט + נושא חלש
  const [{ data: qs }, { data: tp }, { data: at }] = await Promise.all([
    fetchAll(() => supabase.from('questions').select('topic_id, subject_id')),
    supabase.from('topics').select('id, name, subject_id'),
    fetchAll(() => supabase.from('attempts').select('topic_id, subject_id, correct, difficulty, created_at')),
  ])
  const withQ = new Set((qs || []).map((q) => q.topic_id).filter(Boolean))
  const topics = (tp || []).filter((t) => withQ.has(t.id))
  if (!topics.length) return subs?.[0] ? { subjectId: subs[0].id, subjectName: subs[0].name } : null
  const weekAgo = Date.now() - 7 * DAY
  const recent = {}
  for (const a of at || []) if (new Date(a.created_at).getTime() >= weekAgo) recent[a.subject_id] = (recent[a.subject_id] || 0) + 1
  const subjIds = [...new Set(topics.map((t) => t.subject_id))]
  subjIds.sort((a, b) => (recent[a] || 0) - (recent[b] || 0))
  const sid = subjIds[0]
  const byTopic = {}
  for (const a of at || []) {
    if (!a.topic_id) continue
    ;(byTopic[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
  }
  const weakest = topics.filter((t) => t.subject_id === sid)
    .map((t) => ({ t, pct: mastery(byTopic[t.id] || []).pct ?? 0 }))
    .sort((a, b) => a.pct - b.pct)[0].t
  const subj = (subs || []).find((s) => s.id === sid)
  return { subjectId: sid, subjectName: subj?.name || '', topicId: weakest.id, topicName: weakest.name }
}
