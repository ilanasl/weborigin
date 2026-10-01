// ── שאלות זיהוי מכרטיסיות (מושג ↔ הגדרה) ──
// משמש גם במסך הכרטיסיות וגם בתרגול הרגיל (2–3 שאלות הגדרה בכל סבב)
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

// השוואה בלי ניקוד, פיסוק ורווחים — כדי ש"שם עצם" ו"שֵׁם עֶצֶם" לא יופיעו כשתי תשובות
const norm = (s) => String(s || '').replace(/[\u0591-\u05C7]/g, '').replace(/[\s"'׳״.,:;!?()\-–—]/g, '').toLowerCase()

// בונה שאלת בחירה מכרטיסייה: לפעמים מושג→הגדרה, לפעמים הגדרה→מושג.
// המסיחים נלקחים מכרטיסיות אחרות (עדיפות לאותו נושא) — שליפה אמיתית, לא דירוג עצמי.
// מושג שנשמר כשאלה ("מהו נשוא מורחב?") → המושג עצמו ("נשוא מורחב")
const cleanTerm = (s) => String(s || '').trim()
  .replace(/^(מה\s*(הוא|היא|הם|הן|זה|זו)?|מהו|מהי|מהם|מהן|איך\s+מזהים|הגדר\/?י?|הסבר\/?י?)\s+/, '')
  .replace(/[?؟]+\s*$/, '').trim()
const termKey = (c) => norm(cleanTerm(c.front))
// אותו מושג בשני ניסוחים ("נשוא מורחב" / "מהו נשוא מורחב?") — נחשב כפילות
const sameTerm = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))))
// כינויים של מושג: "משלים שם (לוואי)" → [משלים שם (לוואי), משלים שם, לוואי]
const aliases = (c) => {
  const t = cleanTerm(c.front)
  const inside = (t.match(/\(([^)]+)\)/) || [])[1]
  return [t, t.replace(/\([^)]*\)/g, ''), inside].map(norm).filter(Boolean)
}
const sameConcept = (a, b) => aliases(a).some((x) => aliases(b).some((y) => sameTerm(x, y)))
// כרטיסייה שהיא שאלת כן/לא ("האם…?" / "לא! …") — לא מושג, לא מתאימה לא כשאלה ולא כמסיח
export const isChatCard = (c) => /^האם[\s־]/.test(String(c.front || '').trim()) || /^(לא|כן|נכון|לא נכון)\s*[!.,:—-]/.test(String(c.back || '').trim())
const clean = (s) => String(s || '').replace(/\*+/g, '').trim()   // בלי כוכביות של הדגשה

export function buildItem(card, all) {
  const reversed = Math.random() < 0.5
  const key = reversed ? 'front' : 'back'      // מה צריך לבחור
  const show = (c) => clean(key === 'front' ? cleanTerm(c.front) : c.back)
  const correct = show(card)
  // בלי כרטיסיות על אותו מושג (הגדרה שלהן תהיה נכונה גם היא) ובלי כרטיסיות כן/לא
  const others = all.filter((c) => c.id !== card.id && c[key] && !isChatCard(c) && !sameConcept(c, card))
  const same = others.filter((c) => c.topic_id === card.topic_id)
  const rest = others.filter((c) => c.topic_id !== card.topic_id)
  const prompt = reversed ? card.back : card.front
  const seen = [norm(correct), norm(prompt)]
  const distract = []
  for (const c of [...shuffle(same), ...shuffle(rest)]) {
    const text = show(c)
    const k = norm(text)
    if (!k || seen.some((s) => sameTerm(s, k))) continue
    seen.push(k); distract.push(text)
    if (distract.length >= 3) break
  }
  const choices = shuffle([correct, ...distract])
  return {
    id: card.id, topic_id: card.topic_id,
    prompt: reversed ? 'איזה מושג מתאים להגדרה?' : 'מה ההגדרה של המושג?',
    q: clean(reversed ? card.back : cleanTerm(card.front)),
    choices, answer: choices.indexOf(correct),
    valid: choices.length >= 2,
  }
}

