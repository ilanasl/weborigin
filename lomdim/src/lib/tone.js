// צבעי המקצועות בעיצוב החדש (נועז · ליים).
// מקצועות ישנים שמורים עם פסטל — ממפים אותם לגוון המקביל כדי לא לגעת בנתונים.
// bg = מילוי הכרטיס · color = גוון עמוק (טקסט/חץ על המילוי) · chart = קו בגרף על רקע כהה
export const TONES = [
  { bg: '#FFB28A', color: '#B8501C', chart: '#cf6e36' }, // אפרסק
  { bg: '#9CC8FF', color: '#2356A8', chart: '#3f7fd0' }, // תכלת
  { bg: '#D4F46A', color: '#5E7A00', chart: '#85a000' }, // ליים
  { bg: '#B7A5FF', color: '#5A43D1', chart: '#856ad6' }, // סגול
  { bg: '#7FDCCB', color: '#167A69', chart: '#0c9b8a' }, // אקווה
  { bg: '#FFA3C4', color: '#B02E62', chart: '#c2477a' }, // ורוד
]

const LEGACY = ['#EFE6DE', '#E4E8F3', '#E4EDDF', '#EAE4F1', '#E7EEF0', '#F1E7E9']

export function toneOf(s) {
  const key = (s?.bg || '').toUpperCase()
  const i = LEGACY.indexOf(key)
  if (i >= 0) return TONES[i]
  const t = TONES.find((x) => x.bg.toUpperCase() === key)
  return t || { bg: s?.bg || TONES[2].bg, color: s?.color || TONES[2].color, chart: s?.color || TONES[2].chart }
}

export const withTone = (s) => (s ? { ...s, ...toneOf(s) } : s)
