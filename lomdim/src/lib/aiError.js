// שגיאת AI בשפה פשוטה — במקום JSON ארוך של Google
export function aiErrorReason(err) {
  const e = String(err || '')
  if (/credit|billing|prepa|insufficient|exhausted|quota|\b402\b/i.test(e)) return 'נגמרו הקרדיטים בחשבון Google Gemini — צריך להטעין קרדיטים ב-Google AI Studio, ואז לנסות שוב.'
  if (/timeout|504|deadline|timed out/i.test(e)) return 'לקח יותר מדי זמן. נסו שוב.'
  if (/413|too large|payload/i.test(e)) return 'הקובץ גדול מדי. נסו לצלם מחדש.'
  if (/429|rate|overload|503|unavailable/i.test(e)) return 'השירות עמוס כרגע. נסו שוב בעוד דקה.'
  if (/network|failed to fetch|load failed/i.test(e)) return 'בעיית חיבור לאינטרנט. נסו שוב.'
  if (/parse|json/i.test(e)) return 'התשובה מה-AI הגיעה חתוכה. נסו שוב.'
  if (/safety|blocked|recitation/i.test(e)) return 'ה-AI סירב לעבד את זה. נסו לנסח או לצלם אחרת.'
  return null
}
// הודעה מלאה: פתיח + סיבה פשוטה (או קוד קצר כשהסיבה לא מוכרת)
export const aiErrorText = (prefix, err) => `${prefix} ${aiErrorReason(err) || `נסו שוב עוד רגע. (${String(err || '').slice(0, 80)})`}`
