// ── מערכת מטבעות ותגמול ──
// היתרה = סכום כל שורות coin_events (רווח חיובי, פדיון שלילי). שורות לא נמחקות → מטבעות לא נעלמים.
import { supabase } from './supabase'
import { mastery } from './mastery'

export const DAILY_GOAL = 10        // כמה שאלות ביום נחשבות "משימת היום"
export const DAILY_BONUS = 10       // בונוס על השלמת היעד היומי
export const MASTERY_BONUS = 25     // נושא שהגיע לראשונה לרמת "חזק"
const STRONG = 75

const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// בונוס רצף: יום 3 → 5, יום 7 → 15, וכל 7 ימים רצופים אח"כ → 20
function streakBonus(s) {
  if (s === 3) return 5
  if (s === 7) return 15
  if (s > 7 && s % 7 === 0) return 20
  return 0
}

// כמה מטבעות יש כרגע
export async function coinBalance() {
  const { data } = await supabase.from('coin_events').select('amount')
  return (data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
}

// תמונת מצב לחנות: יתרה, כמה "תפוסים" בבקשות ממתינות, וכמה זמין לפדיון
export async function coinSummary() {
  const [{ data: ev }, { data: pend }] = await Promise.all([
    supabase.from('coin_events').select('amount, reason, label, created_at').order('created_at', { ascending: false }),
    supabase.from('redemptions').select('cost').eq('status', 'pending'),
  ])
  const balance = (ev || []).reduce((s, e) => s + Number(e.amount || 0), 0)
  const reserved = (pend || []).reduce((s, r) => s + Number(r.cost || 0), 0)
  return { balance, reserved, available: balance - reserved, recent: (ev || []).slice(0, 12) }
}

// רצף ימים רצופים (כולל היום) שבהם הושג היעד היומי — נגזר מיומן התשובות
async function streakDays() {
  const since = new Date(); since.setDate(since.getDate() - 90)
  const { data } = await supabase.from('attempts').select('created_at').gte('created_at', since.toISOString())
  const perDay = {}
  for (const a of data || []) { const k = dayKey(a.created_at); perDay[k] = (perDay[k] || 0) + 1 }
  let s = 0
  const d = startOfToday()
  for (;;) {
    if ((perDay[dayKey(d)] || 0) >= DAILY_GOAL) { s++; d.setDate(d.getDate() - 1) }
    else break
  }
  return s
}

async function topicPct(subjectId, topicId) {
  const { data } = await supabase.from('attempts')
    .select('correct, difficulty, created_at').eq('subject_id', subjectId).eq('topic_id', topicId)
  const att = (data || []).map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() }))
  return mastery(att).pct
}

// נקרא בסוף סבב תרגול/מבחן/חיזוק. מזכה במטבעות ומחזיר מה נצבר להצגה.
// { subjectId, topicId?, correctCount }
export async function settleSession({ subjectId, topicId, correctCount = 0 }) {
  const inserts = []

  // מיקוד מבחן → מטבעות כפולים על התרגול הזה
  let focus = false
  if (topicId) {
    const { data: t } = await supabase.from('topics').select('in_exam').eq('id', topicId).maybeSingle()
    focus = !!t?.in_exam
  }
  if (correctCount > 0) {
    const amt = focus ? correctCount * 2 : correctCount
    inserts.push({
      amount: amt, reason: 'practice',
      label: focus ? `${correctCount} נכונות ×2 (מיקוד מבחן)` : `${correctCount} תשובות נכונות`,
    })
  }

  // יעד יומי + רצף — פעם אחת ביום
  const { count: todayCount } = await supabase.from('attempts')
    .select('id', { count: 'exact', head: true }).gte('created_at', startOfToday().toISOString())
  if ((todayCount || 0) >= DAILY_GOAL) {
    const { data: gotToday } = await supabase.from('coin_events')
      .select('id').eq('reason', 'daily_goal').gte('created_at', startOfToday().toISOString()).maybeSingle()
    if (!gotToday) {
      inserts.push({ amount: DAILY_BONUS, reason: 'daily_goal', label: 'השלמת יעד יומי 🎯' })
      const s = await streakDays()
      const bonus = streakBonus(s)
      if (bonus) inserts.push({ amount: bonus, reason: 'streak', label: `רצף ${s} ימים 🔥` })
    }
  }

  // אבן דרך: נושא שהגיע לראשונה לרמת "חזק"
  if (topicId) {
    const { data: had } = await supabase.from('coin_events')
      .select('id').eq('reason', 'mastery').eq('ref', topicId).maybeSingle()
    if (!had) {
      const pct = await topicPct(subjectId, topicId)
      if (pct != null && pct >= STRONG) {
        inserts.push({ amount: MASTERY_BONUS, reason: 'mastery', ref: topicId, label: 'נושא חדש בשליטה מלאה 💎' })
      }
    }
  }

  if (!inserts.length) return { earned: 0, events: [] }
  const { error } = await supabase.from('coin_events').insert(inserts)
  if (error) return { earned: 0, events: [] }
  return { earned: inserts.reduce((a, b) => a + b.amount, 0), events: inserts }
}
