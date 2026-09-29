// ── מודל השליטה (אלגוריתם פנימי) ──
// אחוז שליטה בנושא = אחוז התשובות הנכונות מתוך 20 התשובות האחרונות על הנושא.
//  • שאלה קשה שוקלת קצת יותר (קל 1 · בינוני 1.2 · קשה 1.4)
//  • בלי "תיקון ניחוש" — 8 מתוך 10 נכונות = 80%, מספר שילד והורה מבינים
//  • פחות מ-5 תשובות → null ("עוד לא תורגל")
//  • מדרגות: חזק ≥80 · בדרך 60–79 · לתרגל <60
//  • חזרה מרווחת — due כשעבר זמן רב מהתרגול האחרון, לפי רמת השליטה

const DIFF_W = { קל: 1, בינוני: 1.2, קשה: 1.4 }
const WINDOW = 20   // כמה תשובות אחרונות נספרות
export const MIN_N = 5     // מתחת לזה — עוד לא תורגל מספיק
export const STRONG = 80
export const MID = 60
export const level = (pct) => (pct == null ? 'new' : pct >= STRONG ? 'strong' : pct >= MID ? 'mid' : 'weak')
export const LEVEL_LABEL = { strong: 'חזק', mid: 'בדרך', weak: 'לתרגל', new: 'עוד לא תורגל' }
export const GRAD = 3 // הצלחות שנדרשות כדי שפריט "ייטמע" (עקומת למידה איטית יותר)

// וריאציות = תרגול עזר סביב טעות: מעטות, יוצאות אחרי הצלחה אחת, ונמחקות כשהשאלה המקורית נטמעת.
// מסומנות ב-review_items כ-kind = "var:<מזהה השאלה המקורית>"
export const VARIATIONS = 2
export const VAR_GRAD = 1
export const varKind = (parentId) => `var:${parentId}`
export const isVarKind = (k) => typeof k === 'string' && k.startsWith('var:')

// attempts: [{ correct: bool, difficulty: 'קל'|'בינוני'|'קשה', ts: number(ms) }]
// ref = "עכשיו" לחישוב — ברירת מחדל הרגע הנוכחי; מאפשר לחשב שליטה היסטורית לנקודת זמן.
export function mastery(attempts = [], ref = Date.now()) {
  const recent = attempts.filter((a) => a.ts <= ref).sort((a, b) => a.ts - b.ts).slice(-WINDOW)
  if (!recent.length) return { pct: null, state: 'new', due: false, n: 0 }
  const last = recent[recent.length - 1].ts
  if (recent.length < MIN_N) return { pct: null, state: 'collecting', due: false, n: recent.length, last }
  let wsum = 0, wc = 0
  for (const a of recent) {
    const w = DIFF_W[a.difficulty] || 1
    wsum += w
    if (a.correct) wc += w
  }
  const pct = Math.round((wc / wsum) * 100)
  const interval = pct >= 90 ? 7 : pct >= STRONG ? 4 : pct >= MID ? 2 : 1
  return { pct, state: 'ok', due: (ref - last) / 86400000 >= interval, n: recent.length, last }
}

// מוכנות למבחן: ממוצע על נושאי המבחן (לפי המיקוד; אם לא הוגדר — כל הנושאים).
// נושא שעוד לא תורגל נספר כ-0 — כך המוכנות לא מתנפחת כשמתרגלים רק חלק מהחומר.
// topics: [{ in_exam, pct }] → { pct, practiced, total } · pct=null אם עוד לא תורגל אף נושא
export function examReadiness(topics = []) {
  const inExam = topics.filter((t) => t.in_exam)
  const scope = inExam.length ? inExam : topics
  const practiced = scope.filter((t) => t.pct != null).length
  if (!scope.length || !practiced) return { pct: null, practiced, total: scope.length }
  const sum = scope.reduce((a, t) => a + (t.pct ?? 0), 0)
  return { pct: Math.round(sum / scope.length), practiced, total: scope.length }
}
