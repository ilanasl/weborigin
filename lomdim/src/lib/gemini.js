import { SUPABASE_URL, SUPABASE_ANON } from './supabase'

// ── שני מצבים ──
// 1) מצב "ישיר" (הכי קל להרצה): אם הוגדר VITE_GEMINI_API_KEY, קוראים ל-Gemini
//    ישירות מהדפדפן. נוח לפיתוח/בדיקה מקומית. ⚠️ אל תפרסו כך לאתר ציבורי —
//    המפתח נחשף בקוד. לפרודקשן השתמשו בפונקציית ה-Edge (מצב 2).
// 2) מצב "פונקציה" (מאובטח): קריאה לפונקציית ה-Edge של Supabase שמסתירה את המפתח.

const DIRECT_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.6-flash'
const FN_URL =
  import.meta.env.VITE_GEMINI_FN_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/gemini` : '')

// כללים שחוזרים בכמה משימות
const HEB_RULE = 'כתוב אך ורק בעברית תקינה. מותר אנגלית רק כשהיא חלק מהמקצוע. חל איסור מוחלט על אותיות משפות אחרות — במיוחד ערבית, וגם רוסית, גאורגית או יוונית. בלי LaTeX ובלי פקודות: אל תשתמש ב-$...$ או ב-\\leftarrow וכדומה; חץ כותבים ← או →.'
const VARY_RULE = 'פזר/י את התשובה הנכונה בין המיקומים — לא תמיד האפשרות הראשונה.'
// שפה מותאמת גיל: פשוטה, חברית, בגובה העיניים
const TONE_RULE = 'כתוב/י בשפה פשוטה ובגובה העיניים, חברית ומזמינה — כמו אח/ות גדול/ה שמסביר/ה, לא כמו מורה מרוחק/ת. בלי מילים גבוהות או מליציות; אם צריך מונח מקצועי, הסבר/י אותו מייד במילים פשוטות. משפטים קצרים וברורים.'
// ניקוד רק היכן שההגייה מבדילה בין אפשרויות
const NIKUD_RULE = 'הוסף/י ניקוד רק במילים שבהן ההגייה חשובה כדי להבדיל בין האפשרויות (למשל מספרים: שְׁמוֹנָה מול שְׁמוֹנֶה, שְׁמוֹנָה עָשָׂר מול שְׁמוֹנֶה עֶשְׂרֵה). שאר הטקסט — בלי ניקוד.'
// טקסונומיית בלום — גיוון רמות חשיבה
const BLOOM_RULE = 'גוון/י את רמות החשיבה: לא רק זכירה והבנה — כלול/י גם שאלת יישום (מקרה חדש עם נתונים/מילים אחרים), שאלת ניתוח, ולפחות שאלה אחת מסוג "מצא/י את הטעות" (מוצג פתרון או משפט עם שגיאה, והתלמיד/ה מזהה איפה נפלה הטעות).'
// אימות עצמי — מפחית תשובות שגויות (LLM-as-a-Judge קליל, ללא קריאה נוספת)
const VERIFY_RULE = 'בקרת איכות לפני סיום: פתור/י כל שאלה בעצמך צעד-אחר-צעד, וודא/י שהשדה answer הוא בדיוק האינדקס (0=הראשונה) של האפשרות הנכונה, ושכל שאר האפשרויות אכן שגויות. אם יש אי-התאמה — תקן/י. אל תחזיר/י שאלה שאין לה תשובה אחת נכונה וברורה.'

// פנייה אישית לפי פרופיל הלומד/ת (שם + מין)
function learnerRule(learner) {
  if (!learner || !learner.name) return ''
  const g = learner.gender === 'בת' ? 'נקבה' : 'זכר'
  return ` פנה/י אל התלמיד/ה בשמו/ה "${learner.name}" ובלשון ${g} (למשל: ${g === 'בת' ? 'קראי, בחרי, נסי' : 'קרא, בחר, נסה'}).`
}

// ── ניקוי פלט: הסרת אותיות מכתבים זרים שלא אמורים להופיע בעברית ──
const FOREIGN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿Ѐ-ӿͰ-ϿႠ-ჿ԰-֏]/g
const stripForeign = (s) => {
  if (typeof s !== 'string') return s
  return s
    .replace(FOREIGN, '')
    // תיקון פקודות LaTeX שדלפו לפלט
    .replace(/\$?\\?leftarrow\$?/gi, '←')
    .replace(/\$?\\?rightarrow\$?/gi, '→')
    .replace(/\$([^$\n]{1,80})\$/g, '$1')   // הסרת עטיפת $...$
    .replace(/\\(text|mathrm|left|right|,|;|!|quad)\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim()
}
function deepClean(v) {
  if (typeof v === 'string') return stripForeign(v)
  if (Array.isArray(v)) return v.map(deepClean)
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = deepClean(v[k]); return o }
  return v
}

// ── בניית הפרומפט לכל משימה (משותף לשני המצבים) ──
function buildParts(payload) {
  const { task } = payload
  const parts = []
  const img = (b64, mt) => ({ inlineData: { mimeType: mt || 'image/jpeg', data: b64 } })

  if (task === 'analyze_material') {
    const { text, imageBase64, mimeType, subjectName, knownTopics = [], learner } = payload
    parts.push({ text:
      `אתה עוזר לימוד לתלמיד/ה בכיתה ט' במקצוע "${subjectName}". לפניך חומר לימוד. ` +
      (knownTopics.length ? `נושאים קיימים: ${knownTopics.join(', ')}. אם מתאים לאחד — החזר אותו שם בדיוק. ` : '') +
      `החזר JSON בלבד: {"topic":"שם נושא קצר","summary_md":"סיכום עיוני מסודר ב-Markdown: כלל/הגדרה, ולכל מושג — מה זה + על איזו שאלה עונה + דוגמה, דגשים וטעויות נפוצות, וטבלת השוואה (Markdown) כשמשווים מושגים דומים",` +
      `"source_text":"אם החומר הוא שיר או יצירה ספרותית — כתוב/י כאן את הטקסט המלא מילה-במילה ובשורות המקוריות, בלי לשנות ובלי לקצר. אחרת השאר/י ריק.",` +
      `"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"קל|בינוני|קשה","explain":"","hint":""}],` +
      `"flashcards":[{"front":"מושג","back":"הגדרה"}]}. צור 5 שאלות (4 מסיחים) ו-4 כרטיסיות. ` +
      HEB_RULE + ` ` + TONE_RULE + ` ` + NIKUD_RULE + ` ` + BLOOM_RULE + ` ` + VERIFY_RULE + ` ` + VARY_RULE + learnerRule(learner) +
      ` אם החומר הוא תחביר / ניתוח משפט — כלול שאלות שבהן נתון משפט והתלמיד/ה בוחר/ת מה התפקיד התחבירי של מילה מסוימת בו (נושא, נשוא, מושא, לוואי וכו').` })
    if (text) parts.push({ text: `\nהטקסט:\n${text}` })
    if (imageBase64) parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: true }
  }
  if (task === 'generate_questions') {
    const { subjectName, topic, sourceText, count = 5, difficulty, learner } = payload
    parts.push({ text:
      `צור ${count} שאלות אמריקאיות למקצוע "${subjectName}"${topic ? `, נושא "${topic}"` : ''}${difficulty ? `, קושי ${difficulty}` : ''}. ` +
      `החזר JSON: {"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"","explain":"","hint":""}]}. ` +
      HEB_RULE + ` ` + TONE_RULE + ` ` + NIKUD_RULE + ` ` + BLOOM_RULE + ` ` + VERIFY_RULE + ` ` + VARY_RULE + learnerRule(learner) + ` ` +
      (sourceText ? `לפי החומר:\n${sourceText}` : '') })
    return { parts, wantJson: true }
  }
  if (task === 'explain') {
    const { subjectName, context, question, learner } = payload
    parts.push({ text:
      `את/ה חבר/ה גדול/ה שעוזר/ת ללמוד "${subjectName}", ברמת כיתה ט'. את/ה כבר באמצע שיחה — אל תפתח/י ב"שלום" ואל תציג/י את עצמך שוב, פשוט המשך/י ישר לעניין. ` +
      TONE_RULE + ' ' + HEB_RULE + learnerRule(learner) +
      ` אם התלמיד/ה עונה תשובה לשאלה ששאלת: תן/י קודם משוב קצר — נכון או לא, ולמה. אם ענה/תה משהו שאינו אחת האפשרויות שנתת — אמור/י בעדינות "זו לא אחת האפשרויות" והסבר/י מה כן. אם היו עוד סעיפים פתוחים ששאלת — המשך/י אליהם ואל תשאיר/י אותם באוויר. ` +
      (context ? `הקשר החומר: ${context}\n` : '') + `הודעת התלמיד/ה: ${question}` })
    return { parts, wantJson: false }
  }
  if (task === 'check_exercise') {
    const { imageBase64, mimeType, subjectName, learner } = payload
    parts.push({ text:
      `צילום של תרגיל שנפתר במחברת (מקצוע ${subjectName}). בדוק/י וזהה/י איפה הטעות. ` +
      HEB_RULE + ' ' + TONE_RULE + learnerRule(learner) + ' ' +
      `החזר/י JSON: {"exercise":"","correct":true,"steps":[{"text":"","ok":true}],"feedback":"","reteach":""}` })
    parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: true }
  }
  return { parts: [{ text: 'unknown task' }], wantJson: false }
}

function parseJson(text) {
  const c = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const i = c.indexOf('{'); const j = c.indexOf('[')
  const from = i === -1 ? j : j === -1 ? i : Math.min(i, j)
  if (from < 0) return null
  const open = c[from]
  const close = open === '{' ? '}' : ']'
  // ניסיון 1: מהסוגר הראשון עד הסוף
  try { return JSON.parse(c.slice(from)) } catch { /* ננסה לגזור עד הסוגר התואם האחרון */ }
  const last = c.lastIndexOf(close)
  if (last > from) { try { return JSON.parse(c.slice(from, last + 1)) } catch { /* fallthrough */ } }
  return null
}

// ערבוב מסיחים כדי שהתשובה הנכונה לא תהיה תמיד באותו מקום
function shuffleQuestions(list) {
  if (!Array.isArray(list)) return list
  return list.map((q) => {
    if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
    const correct = q.choices[q.answer]
    const order = q.choices.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) { const k = Math.random() * (i + 1) | 0;[order[i], order[k]] = [order[k], order[i]] }
    const choices = order.map((i) => q.choices[i])
    return { ...q, choices, answer: choices.indexOf(correct) }
  })
}

async function callDirect(payload) {
  const { parts, wantJson } = buildParts(payload)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${DIRECT_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: wantJson ? { temperature: 0.4, responseMimeType: 'application/json' } : { temperature: 0.6 },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!wantJson) return { answer: out }
  const parsed = parseJson(out)
  if (!parsed) throw new Error('parse_failed')
  return parsed
}

// מצב "צינור דק": הפרומפט נבנה כאן (buildParts) ונשלח לפונקציה, שרק מוסיפה את המפתח.
// כך כל הלוגיקה בצד הלקוח (מתעדכן אוטומטית) — אין צורך לפרוס את הפונקציה שוב.
async function callFn(payload) {
  if (!FN_URL) throw new Error('Gemini function URL is not configured')
  const { parts, wantJson } = buildParts(payload)
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON || ''}` },
    body: JSON.stringify({ parts, wantJson }),
  })
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const out = data?.text ?? ''
  if (!wantJson) return { answer: out }
  const parsed = parseJson(out)
  if (!parsed) throw new Error('parse_failed')
  return parsed
}

const call = (payload) => (DIRECT_KEY ? callDirect(payload) : callFn(payload))

export const analyzeMaterial = async (p) => {
  const out = deepClean(await call({ task: 'analyze_material', ...p }))
  return { ...out, questions: shuffleQuestions(out.questions) }
}
export const generateQuestions = async (p) => {
  const out = deepClean(await call({ task: 'generate_questions', ...p }))
  return { ...out, questions: shuffleQuestions(out.questions) }
}
export const explain = async (p) => deepClean(await call({ task: 'explain', ...p }))
export const checkExercise = async (p) => deepClean(await call({ task: 'check_exercise', ...p }))

// סיכום עיוני מסודר לנושא (משתמש במשימת explain — לא דורש עדכון של פונקציית ה-Edge)
export const topicSummary = async ({ subjectName, topicName, learner }) => {
  const question =
    `כתוב סיכום עיוני מסודר לחזרה על הנושא "${topicName}" במקצוע "${subjectName}", ברמת כיתה ט'. ` +
    `בנה אותו כך: (1) כלל/הגדרה קצרה של הנושא. (2) לכל מושג מרכזי — מה זה, על איזו שאלה הוא עונה, ודוגמה. ` +
    `(3) דגשים וטעויות נפוצות למבחן. (4) כשמתאים — השתמש בטבלת Markdown להשוואה, עם עמודות שמתאימות לנושא: לרוב "מושג | מה זה | על איזו שאלה עונה | דוגמה", ובנושאים כמו שם המספר "מספר | זכר | נקבה". ` +
    TONE_RULE + ' ' + NIKUD_RULE + ' ' +
    `החזר Markdown נקי בלבד (כותרות ##, נקודות, טבלאות), בלי הקדמות ובלי סיומת ובלי "שלום".`
  const { answer } = await explain({ subjectName, question, learner })
  return { summary_md: answer }
}

// וריאציות תרגול על אותו רעיון/טעות — לגיוון ולחיזוק ממוקד
export const generateVariations = ({ subjectName, topicName, concept, learner, count = 5 }) => {
  const src = `צור/י ${count} שאלות שונות זו מזו שמתרגלות בדיוק את אותו רעיון/טעות: "${concept}". ` +
    `וריאציות אמיתיות (מילים ומשפטים אחרים), ברמות קושי מגוונות, שכולן בודקות את אותו עיקרון.`
  return generateQuestions({ subjectName, topic: topicName, sourceText: src, count, learner })
}

// חתימת תוכן של קובץ (SHA-256) — לזיהוי קובץ שכבר הועלה
export async function fileHash(file) {
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}
