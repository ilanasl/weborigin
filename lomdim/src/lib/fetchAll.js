// השרת (PostgREST) מחזיר עד 1000 שורות לבקשה — בלי זה, אחרי 1000 תשובות האחוזים מחושבים רק על חלק.
// מביאים בדפים של 1000 עד הסוף. make = פונקציה שבונה את השאילתה מחדש (כל דף צריך בונה חדש).
const PAGE = 1000
export async function fetchAll(make) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    // מיון לפי id כשובר שוויון — כדי שהדפים לא יחפפו ולא ידלגו על שורות
    const { data, error } = await make().order('id').range(from, from + PAGE - 1)
    if (error) return { data: out.length ? out : null, error }
    out.push(...(data || []))
    if (!data || data.length < PAGE) return { data: out, error: null }
  }
}
