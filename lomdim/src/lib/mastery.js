// ── מודל השליטה (אלגוריתם פנימי) ──
// מחשב אחוז שליטה בנושא מתוך יומן התשובות:
//  • שקלול לפי זמן (recency half-life) — אחרונות שוקלות יותר, ישנות דועכות
//  • שקלול לפי קושי — הצלחה בשאלה קשה שווה יותר
//  • תיקון ניחוש — באמריקאי ~25% הצלחה במקרה, מנוכים
//  • שער ביטחון — מתחת למינימום נתונים מחזיר null → "אוספים נתונים"
//  • חזרה מרווחת — due כשעבר זמן רב מהתרגול האחרון, לפי רמת השליטה

const DIFF_W = { קל: 1, בינוני: 1.4, קשה: 1.8 }
const REC_HALFLIFE = 14 // ימים
const GUESS = 0.25
const MIN_EFF = 3
export const GRAD = 2 // הצלחות שנדרשות כדי שפריט "ייטמע"

// attempts: [{ correct: bool, difficulty: 'קל'|'בינוני'|'קשה', ts: number(ms) }]
export function mastery(attempts = []) {
  if (!attempts.length) return { pct: null, state: 'new', due: false }
  const now = Date.now()
  let wsum = 0, wc = 0, last = 0
  for (const a of attempts) {
    const ageDays = Math.max(0, (now - a.ts) / 86400000)
    const w = Math.pow(0.5, ageDays / REC_HALFLIFE) * (DIFF_W[a.difficulty] || 1)
    wsum += w
    wc += w * (a.correct ? 1 : 0)
    if (a.ts > last) last = a.ts
  }
  if (wsum < MIN_EFF) return { pct: null, state: 'collecting', due: false }
  const raw = wc / wsum
  const pct = Math.round(Math.max(0, (raw - GUESS) / (1 - GUESS)) * 100)
  const interval = pct >= 85 ? 7 : pct >= 70 ? 4 : pct >= 50 ? 2 : 1
  return { pct, state: 'ok', due: (now - last) / 86400000 >= interval, last }
}

// ממוצע מוכנות על פני מספר נושאים (מדלג על נושאים בלי מספיק נתונים)
export function readiness(topicAttemptsList = []) {
  const vals = topicAttemptsList.map((att) => mastery(att).pct).filter((v) => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}
