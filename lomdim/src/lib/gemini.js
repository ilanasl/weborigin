import { SUPABASE_URL, SUPABASE_ANON } from './supabase'
import { mathText } from './mathText'

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
const MATH_RULE = 'כתיבה מתמטית בלי LaTeX: כפל · או ×, חילוק : , חזקה בספרות עיליות (5², 2³, xⁿ), שבר 9/4. אסור \\cdot, ^, $ או פקודות עם \\.'
const HEB_RULE = 'כתוב אך ורק בעברית תקינה. מותר אנגלית רק כשהיא חלק מהמקצוע. חל איסור מוחלט על אותיות משפות אחרות — במיוחד ערבית, וגם רוסית, גאורגית או יוונית. בלי LaTeX ובלי פקודות: אל תשתמש ב-$...$ או ב-\\leftarrow וכדומה; חץ כותבים ← או →.' + ' ' + MATH_RULE
// בלי רמזים חיצוניים: התשובה הנכונה לא בולטת באורך או בניסוח — אבל בלי מילוי סרק
const LENGTH_RULE = 'חשוב מאוד — בלי רמזים חיצוניים לתשובה הנכונה: ארבע האפשרויות צריכות להיות באורך דומה, באותו מבנה דקדוקי ובאותה רמת פירוט. אל תהפוך/י את התשובה הנכונה לארוכה או למפורטת מהאחרות — היא לא אמורה להיות הארוכה ביותר ברוב השאלות. את האיזון משיגים בשתי דרכים בלבד: (1) לנסח את התשובה הנכונה בתמציתיות, ולהעביר הסברים והסתייגויות לשדה explain; (2) לבנות מסיחים בעלי תוכן אמיתי — טעות נפוצה ומתקבלת על הדעת, באותה רמת פירוט — ולא מילים ריקות, חזרות או תוספות סרק רק כדי להאריך. גם אל תשאיר/י רק בתשובה הנכונה מילות הסתייגות (כמו "בדרך כלל", "לעיתים") או מילים שמועתקות מנוסח השאלה. לפני סיום עבור/י על כל שאלה ובדוק/י: האם אפשר לנחש את התשובה רק לפי האורך או הניסוח? אם כן — תקן/י.'
// מסיחים סבירים — כל אפשרות שגויה צריכה להיראות כמו תשובה אפשרית לתלמיד/ה שלא בטוח/ה
// מחברת של תלמיד/ה עלולה לכלול טעויות — הידע הנכון גובר, והטעות מסומנת בסיכום
const NOTEBOOK_RULE = 'חשוב: החומר הוא לרוב מחברת של תלמיד/ה ועלול לכלול טעויות (חישוב שגוי, כלל שנרשם לא נכון, למשל חוק שמתאים לכפל שנרשם עם חיבור). במקרה של סתירה לידע המקובל — הידע הנכון גובר: אל תלמד/י ואל תבנה/י שאלה על פי הטעות. בסיכום, בכל מקום שבו יש טעות במחברת, הוסף/י שורה: "⚠️ שים/י לב: במחברת כתוב "X" — הנכון הוא Y" (עם הסבר קצר למה). סמן/י טעות רק כשהיא כתובה במפורש בדף, ו-X הוא ציטוט מדויק של מה שכתוב שם — לא מסקנה מסדר של רשימה, לא דבר שלא נכתב, ולא טקסט מחוק, חיוור או שקוף מהצד השני של הדף (אותו מתעלמים ממנו לגמרי). מסמנים רק טעות עובדתית ברורה ברמת הכיתה של התלמיד/ה — לא דקויות מינוח שמעבר לרמה הזו (למשל ההבחנה בין "חום" ל"אנרגיה תרמית"), ולא ניסוח אחר של אותו רעיון נכון. אם לא בטוח/ה שזו טעות — לא מסמנים. אם אין טעויות — לא מוסיפים שום אזהרה או פרק טעויות; אין צורך "למצוא" טעויות.'
// באיחוד סיכום: המקור הוא סיכומי דפים שה-AI כתב — לא המחברת עצמה, ולכן אי אפשר לצטט ממנה
const CONSOLIDATE_RULE = 'החומרים כאן הם סיכומים שנכתבו מדפי המחברת — לא המחברת עצמה. לכן אל תכתוב/י "במחברת כתוב" ואל תוסיף/י אזהרות על טעויות במחברת. אם מידע בחומרים שגוי עובדתית ברמת הכיתה — פשוט כתוב/י בסיכום את הנכון.'
// הסרת שורות "⚠️ שים לב: במחברת כתוב…" (גם "נכתב/נרשם") — כותרות עם ⚠️ בלי "במחברת" נשארות
const WARN_LINE = /במחברת\s+(?:כתוב|נכתב|נרשם|נרשמה|רשום|רשומה)|\u26A0[^\n]*במחברת/
export const stripNotebookWarnings = (md) => String(md || '').split('\n').filter((l) => !WARN_LINE.test(l)).join('\n')
// רמת הפירוט של נושא: פרק שלם, לא כלל בודד
const TOPIC_LEVEL_RULE = 'רמת נושא: נושא הוא פרק לימודי שלם (למשל "חוקי חזקות", "שם המספר", "חוק הפילוג המורחב") — לא כלל בודד, מקרה פרטי או סוג תרגיל בתוך הפרק (למשל לא "חוקי חזקות – כפל וחילוק" בנפרד מ"חוקי חזקות"). אם הדף עוסק בחלק מפרק שכבר קיים ברשימת הנושאים הקיימים — החזר/י את שם הנושא הקיים בדיוק, גם אם הכותרת בדף שונה.'
const PLAUSIBLE_RULE = 'חשוב מאוד — מסיחים (התשובות השגויות) חייבים להיות סבירים ומפתים: מאותו תחום ובאותה "שפה" של התשובה הנכונה, כך שתלמיד/ה שהבין/ה רק חלקית עלול/ה לבחור בהם. בנה/י אותם מטעויות נפוצות, מבלבול בין מושגים קרובים, מחצי-אמת או ממה שנכון במקרה אחר. אסור בהחלט מסיחים מופרכים, מצחיקים, מחוץ לנושא או כאלה שכל אחד/ת פוסל/ת מיד (למשל בשאלה על מטרת המילים בשיר — לא "ללמד לבנות מטריה" או "להציג סטטיסטיקה"). בדיקה לפני סיום: אם אפשר לנחש את התשובה רק כי שלוש האפשרויות האחרות "לא קשורות" — החלף/י אותן במסיחים קשורים ומבלבלים.'
const VARY_RULE = 'חשוב מאוד — מיקום התשובה הנכונה: פזר/י את התשובה הנכונה באקראי בין המיקומים (ראשון/שני/שלישי/רביעי). אסור שהתשובה הנכונה תהיה תמיד או ברוב השאלות באותו מיקום, ובפרט לא תמיד הראשונה. בסדרה של שאלות ודא/י שהאינדקס answer מגוון — חלק 0, חלק 1, חלק 2, חלק 3.'
// כיתת הלומד/ת (מההגדרות) — קובעת את רמת השפה והעומק של הסיכומים, ההסברים והשאלות
const GRADE_AGE = { "ז'": '12-13', "ח'": '13-14', "ט'": '14-15', "י'": '15-16', 'י"א': '16-17', 'י"ב': '17-18' }
const gradeOf = (learner) => learner?.grade || "ט'"
const ageOf = (learner) => GRADE_AGE[gradeOf(learner)] || '14-15'
// שפה מותאמת גיל: פשוטה, חברית, בגובה העיניים
// שפת הסיכומים — ברמה של הכיתה שהוגדרה, לא ניסוח אקדמי של דפי המורה
const summaryLangRule = (learner) => 'שפת הסיכום: כתוב/י לתלמיד/ה בכיתה ' + gradeOf(learner) + ' (גיל ' + ageOf(learner) + '), במילים של היום-יום. אל תעתיק/י את הניסוח הגבוה או האקדמי מהחומר — נסח/י מחדש במילים שלך, בפשטות, בלי לאבד את התוכן והדגשים. משפטים קצרים, מילה אחת פשוטה במקום צירוף מליצי. את המונחים המקצועיים שצריך לדעת למבחן — השאר/י, אבל הסבר/י כל אחד מייד במילים פשוטות, למשל: "מטאפורה (השוואה בלי המילה \u0027כמו\u0027 — אומרים שדבר אחד הוא דבר אחר)". מילה קשה או נדירה — הסבר/י בסוגריים. בדיקה לפני סיום: האם תלמיד/ה בכיתה ' + gradeOf(learner) + ' יבין/תבין כל משפט בקריאה ראשונה, בלי מילון? אם לא — פשט/י.'
// תוספת לספרות/תנ"ך: להבין את הטקסט עצמו, לא רק מושגים עליו
const litRule = (subjectName = '') => /ספרות|שיר|תנ"?ך|מקרא/.test(subjectName)
  ? ' בספרות/תנ"ך: הוסף/י בתחילת הסיכום חלק "## על מה זה במילים פשוטות" — 2-4 משפטים שמסבירים מה קורה בשיר/בסיפור/בפרק, כמו שמספרים לחבר. '
    + 'כשמצטטים שורה קשה — הוסף/י מיד אחריה מה היא אומרת במילים פשוטות. לכל אמצעי אמנותי — מה זה, איפה הוא מופיע בטקסט, ומה הוא עושה לקורא. '
    + 'סיים/י ב"## מה לכתוב במבחן" — נקודות קצרות וברורות שאפשר להשתמש בהן בתשובה.'
  : ''
const TONE_RULE = 'כתוב/י בשפה פשוטה ובגובה העיניים, חברית ומזמינה — כמו אח/ות גדול/ה שמסביר/ה, לא כמו מורה מרוחק/ת. בלי מילים גבוהות או מליציות; אם צריך מונח מקצועי, הסבר/י אותו מייד במילים פשוטות. משפטים קצרים וברורים.'
// ניקוד רק היכן שההגייה מבדילה בין אפשרויות
const NIKUD_BASE = 'הוסף/י ניקוד רק במילים שבהן ההגייה חשובה כדי להבדיל בין האפשרויות (למשל מספרים: שְׁמוֹנָה מול שְׁמוֹנֶה, שְׁמוֹנָה עָשָׂר מול שְׁמוֹנֶה עֶשְׂרֵה). שאר הטקסט — בלי ניקוד.'
const NIKUD_BINYAN = 'חובה: כשמופיעים שמות בניינים או צורות פועל — נַקֵּד אותם תמיד ובמלואם, גם בשאלה וגם בכל אפשרויות התשובה (פָּעַל, נִפְעַל, פִּעֵל, פֻּעַל, הִפְעִיל, הֻפְעַל, הִתְפַּעֵל) — בלי ניקוד קשה להבחין בין פָּעַל, פּוֹעֵל ופֻּעַל.'
// מקצועות לשון: עברית/לשון/דקדוק/תחביר
const isLangSubject = (s = '') => /עברית|לשון|דקדוק|תחביר/.test(s)
const nikudRule = (subjectName) => (isLangSubject(subjectName) ? NIKUD_BASE + ' ' + NIKUD_BINYAN : NIKUD_BASE)
// להישאר בתוך המקצוע — בלי מונחים ממקצועות אחרים (למשל בניינים ודקדוק בשאלה על שיר)
const subjectRule = (subjectName) => (subjectName && !isLangSubject(subjectName)
  ? ` השאלות, האפשרויות וההסברים עוסקים רק במקצוע "${subjectName}": אל תערב/י מונחים או ניתוח ממקצועות אחרים — במיוחד לא דקדוק, בניינים, שורשים או ניתוח תחבירי, אלא אם החומר עצמו עוסק בזה.`
  : '')
// טקסונומיית בלום — גיוון רמות חשיבה
const BLOOM_RULE = 'גוון/י את רמות החשיבה: לא רק זכירה והבנה — כלול/י גם שאלת יישום (מקרה חדש עם נתונים/מילים אחרים), שאלת ניתוח, ולפחות שאלה אחת מסוג "מצא/י את הטעות" (מוצג פתרון או משפט עם שגיאה, והתלמיד/ה מזהה איפה נפלה הטעות).'
// אימות עצמי — מפחית תשובות שגויות (LLM-as-a-Judge קליל, ללא קריאה נוספת)
const VERIFY_RULE = 'בקרת איכות לפני סיום: פתור/י כל שאלה בעצמך צעד-אחר-צעד, וודא/י שהשדה answer הוא בדיוק האינדקס (0=הראשונה) של האפשרות הנכונה, ושכל שאר האפשרויות אכן שגויות. אם יש אי-התאמה — תקן/י. אל תחזיר/י שאלה שאין לה תשובה אחת נכונה וברורה.'

// פנייה אישית לפי פרופיל הלומד/ת (שם + מין)
function learnerRule(learner) {
  if (!learner) return ''
  // רמת הכיתה — קובעת עומק החומר, קושי השאלות ואוצר המילים
  const level = ` התלמיד/ה בכיתה ${gradeOf(learner)} — התאם/י את רמת החומר, קושי השאלות ואוצר המילים לכיתה זו.`
  if (!learner.name) return level
  const g = learner.gender === 'בת' ? 'נקבה' : 'זכר'
  return level + ` פנה/י אל התלמיד/ה בשמו/ה "${learner.name}" ובלשון ${g} (למשל: ${g === 'בת' ? 'קראי, בחרי, נסי' : 'קרא, בחר, נסה'}).`
}

// ── ניקוי פלט: הסרת אותיות מכתבים זרים שלא אמורים להופיע בעברית ──
const FOREIGN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿Ѐ-ӿͰ-ϿႠ-ჿ԰-֏]/g
const stripForeign = (s) => {
  if (typeof s !== 'string') return s
  return mathText(s)
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
    const { text, imageBase64, mimeType, subjectName, knownTopics = [], learner, noSummary, focusTopic } = payload
    parts.push({ text:
      `אתה עוזר לימוד לתלמיד/ה בכיתה ${gradeOf(learner)} במקצוע "${subjectName}". לפניך חומר לימוד. ` +
      (focusTopic
        ? `הדף הזה כולל כמה נושאים. התמקד/י אך ורק בחלק שעוסק בנושא "${focusTopic}" והתעלם/י משאר הדף. החזר/י בדיוק איבר אחד במערך topics, ושם הנושא יהיה בדיוק "${focusTopic}". `
        : '') +
      (knownTopics.length ? `נושאים קיימים: ${knownTopics.join(', ')}. אם מתאים לאחד — החזר אותו שם בדיוק. ` : '') +
      `החזר JSON בלבד: {"topics":[{"topic":"שם נושא קצר",` +
      (noSummary
        ? `"summary_md":"",`
        : `"summary_md":"סיכום מסודר ב-Markdown בשפה של תלמיד/ה בכיתה ${gradeOf(learner)}: כלל/הגדרה, ולכל מושג — מה זה + על איזו שאלה עונה + דוגמה, דגשים וטעויות נפוצות, וטבלת השוואה (Markdown) כשמשווים מושגים דומים",`) +
      `"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"קל|בינוני|קשה","explain":"","hint":""}],` +
      `"flashcards":[{"front":"מושג","back":"הגדרה","context":"הקשר קצר לפני החשיפה — מאיזה שיר/יצירה או תת-נושא הכרטיסייה שואלת. אם ברור מהנושא — ריק."}]}],` +
      `"source_text":"אם החומר הוא שיר או יצירה ספרותית — הטקסט המלא מילה-במילה ובשורות המקוריות, בלי לשנות ובלי לקצר. אחרת ריק."}. ` +
      TOPIC_LEVEL_RULE + ' ' + NOTEBOOK_RULE + ' ' +
      `זיהוי נושאים: לפני שאת/ה עונה, עבור/י על כל הדף ובדוק/י אם יש בו כמה נושאים נפרדים. סימנים לנושא נפרד: כותרת או מספור חדש, מעבר לכלל/מושג אחר לגמרי, או תרגילים שעוסקים בנושא אחר (למשל חלק על שם המספר וחלק על בניינים, או חלק על תחביר וחלק על הבנת הנקרא). לכל נושא נפרד — איבר נפרד במערך topics, עם הסיכום, השאלות והכרטיסיות שלו בלבד. אבל אל תפצל/י תת-חלקים של אותו נושא (למשל הגדרה + דוגמאות + תרגול על אותו כלל = נושא אחד). ` +
      `כמות השאלות והכרטיסיות תלויה בכמות התוכן בפועל, לא מספר קבוע: דף עשיר → יותר. לכל נושא בין 5 ל-12 שאלות אמריקאיות (4 אפשרויות בכל אחת), ובין 3 ל-6 כרטיסיות למושגי המפתח בלבד (מושג↔הגדרה קצרה וברורה שראוי לזכור בעל-פה) — לא לכל דבר, בלי להמציא ובלי לחזור על אותה נקודה. כללי כרטיסייה: front = שם המושג בלבד (למשל "נשוא מורחב") — לא שאלה ("מהו…?"), לא שאלת כן/לא ("האם…?"). back = הגדרה עניינית במשפט אחד, שלא פותחת ב"לא"/"כן"/"נכון" ובלי כוכביות או סימוני Markdown. כל מושג — כרטיסייה אחת בלבד, גם אם יש לו שם נוסף (כתוב/י את השם הנוסף בסוגריים באותה כרטיסייה). ` +
      HEB_RULE + ` ` + TONE_RULE + ` ` + nikudRule(subjectName) + subjectRule(subjectName) + ` ` + BLOOM_RULE + ` ` + VERIFY_RULE + ` ` + VARY_RULE + ` ` + LENGTH_RULE + ` ` + PLAUSIBLE_RULE + learnerRule(learner) +
      (noSummary ? '' : ` ${summaryLangRule(learner)}${litRule(subjectName)}`) +
      ` אם החומר הוא תחביר / ניתוח משפט — כלול שאלות שבהן נתון משפט והתלמיד/ה בוחר/ת מה התפקיד התחבירי של מילה מסוימת בו.` })
    if (text) parts.push({ text: `\nהטקסט:\n${text}` })
    if (imageBase64) parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: true }
  }
  if (task === 'generate_questions') {
    const { subjectName, topic, sourceText, count = 5, difficulty, learner } = payload
    parts.push({ text:
      `צור ${count} שאלות אמריקאיות למקצוע "${subjectName}"${topic ? `, נושא "${topic}"` : ''}${difficulty ? `, קושי ${difficulty}` : ''}. ` +
      `החזר JSON: {"questions":[{"q":"","choices":["","","",""],"answer":0,"difficulty":"","explain":"","hint":""}]}. ` +
      HEB_RULE + ` ` + TONE_RULE + ` ` + nikudRule(subjectName) + subjectRule(subjectName) + ` ` + BLOOM_RULE + ` ` + VERIFY_RULE + ` ` + VARY_RULE + ` ` + LENGTH_RULE + ` ` + PLAUSIBLE_RULE + learnerRule(learner) + ` ` +
      (sourceText ? `לפי החומר:\n${sourceText}` : '') })
    return { parts, wantJson: true }
  }
  if (task === 'review_questions') {
    const { items = [], subjectName, learner, source } = payload  // [{id, q, choices, answer, explain}]
    parts.push({ text:
      `לפניך שאלות אמריקאיות במקצוע "${subjectName}" (answer = אינדקס התשובה הנכונה, 0 = הראשונה). בצע/י בקרת איכות לכל שאלה בנפרד:\n` +
      `(1) נכונות — הכי חשוב: פתור/י את השאלה בעצמך צעד-אחר-צעד. ודא/י שהאפשרות המסומנת נכונה לפי הידע המקובל ברמת הכיתה${source ? ' (החומר המצורף הוא מחברת תלמיד/ה ועלול לכלול טעויות — כשהוא סותר את הידע המקובל, הידע הנכון גובר)' : ''}, ושאין אפשרות נוספת שגם היא נכונה. ` +
      `אם הסימון שגוי — תקן/י את answer. אם השאלה לא חד-משמעית — נסח/י מחדש את השאלה או את האפשרויות כך שתהיה תשובה נכונה אחת בלבד. ` +
      `רק אם השאלה בנויה על מידע שגוי ואי אפשר לתקן אותה בביטחון — "status":"drop" (השתמש/י בזה במשורה).\n` +
      `(2) התשובה הנכונה ארוכה או מפורטת בבירור מהאחרות — קצר/י אותה והעבר/י פרטים ל-explain.\n` +
      `(3) מסיח מופרך, מחוץ לנושא או כזה שכל אחד פוסל מיד — החלף/י במסיח סביר ומבלבל.\n` +
      `(4) מונחים ממקצוע אחר (למשל בניינים או דקדוק בשאלה בספרות) — החלף/י בתוכן מהמקצוע עצמו.\n` +
      `ההסבר (explain) חייב להתאים לתשובה הנכונה. שאלה תקינה — "status":"ok" בלי שדות נוספים. שאלה שתוקנה — "status":"fixed" עם השאלה המלאה המתוקנת. ` +
      `החזר/י JSON בלבד, עם אותם id: {"items":[{"id":"","status":"ok|fixed|drop","q":"","choices":["","","",""],"answer":0,"explain":""}]}. ` +
      HEB_RULE + ' ' + LENGTH_RULE + ' ' + PLAUSIBLE_RULE + ' ' + nikudRule(subjectName) + subjectRule(subjectName) + learnerRule(learner) +
      (source ? `\n\nהחומר שממנו נוצרו השאלות:\n"""${String(source).slice(0, 10000)}"""` : '') +
      `\n\nהשאלות:\n${JSON.stringify(items)}` })
    return { parts, wantJson: true }
  }
  if (task === 'explain') {
    const { subjectName, context, question, learner } = payload
    parts.push({ text:
      `את/ה חבר/ה גדול/ה שעוזר/ת ללמוד "${subjectName}", ברמת כיתה ${gradeOf(learner)}. את/ה כבר באמצע שיחה — אל תפתח/י ב"שלום" ואל תציג/י את עצמך שוב, פשוט המשך/י ישר לעניין. ` +
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
  if (task === 'scan_scope') {
    const { imageBase64, mimeType, subjectName } = payload
    parts.push({ text:
      `לפניך צילום של מיקוד למבחן (למשל מה שהמורה כתבה על הלוח או שלחה) במקצוע "${subjectName}". ` +
      `תמלל/י ותסכם/י בעברית, בצורה מסודרת ותמציתית, מה נכלל במבחן — רשימת הנושאים והדגשים בלבד. ` +
      HEB_RULE + ` החזר/י טקסט נקי בלבד (אפשר בנקודות), בלי הקדמה ובלי "שלום".` })
    parts.push(img(imageBase64, mimeType))
    return { parts, wantJson: false }
  }
  if (task === 'renikud') {
    const { items } = payload  // [{id, q, choices:[...]}]
    parts.push({ text:
      `לפניך שאלות אמריקאיות בלשון עברית (בפורמט JSON). הוסף/י ניקוד אך ורק בשתי הקטגוריות הבאות, ורק כשהן מופיעות — גם בשאלה וגם באפשרויות התשובה:` +
      ` (1) שמות שבעת הבניינים כשהם מופיעים כשם בניין: פָּעַל, נִפְעַל, פִּעֵל, פֻּעַל, הִפְעִיל, הֻפְעַל, הִתְפַּעֵל.` +
      ` (2) שם המספר / מילות מספר שהניקוד מבחין בהגייתן (למשל שְׁמוֹנָה מול שְׁמוֹנֶה, שְׁלוֹשָׁה מול שָׁלוֹשׁ, חֲמִשָּׁה מול חָמֵשׁ).` +
      ` אל תנקד/י אף מילה אחרת (לא צורות פועל אחרות, לא שמות עצם, כלום), ואל תשנה/י ניסוח, מילים, או סדר האפשרויות. ` +
      ` חשוב מאוד: חלק מהאפשרויות הן שגויות בכוונה (מסיחים) — אל "תתקן/י" אותן! השאר/י כל מילה בדיוק כמו שהיא, רק עם סימני ניקוד. ` +
      ` קריטי: שמור/י על אותן אותיות בדיוק כפי שהן כתובות במקור, כולל הכתיב המלא (אל תסיר/י ואל תוסיף/י אף אות, גם לא יו"ד או וי"ו — למשל "שיניים" נשאר "שִׁינַיִים" עם שתי יו"דים, לא "שִׁנַּיִם"). רק מוסיפים סימני ניקוד מעל/מתחת לאותיות הקיימות. ` +
      ` נַקֵּד/י את כל האפשרויות (גם הנכונה וגם השגויות) ואת השאלה. ` +
      `החזר/י JSON באותו מבנה בדיוק, עם אותם ה-id: {"items":[{"id":"","q":"","choices":["","","",""]}]}. ` + HEB_RULE +
      `\nהנתונים:\n${JSON.stringify(items)}` })
    return { parts, wantJson: true }
  }
  if (task === 'prep_note') {
    const { subjectName, text, knownTopics = [] } = payload
    parts.push({ text:
      `במקצוע "${subjectName}" קיימים הנושאים: ${knownTopics.join(' | ')}. ` +
      `לפניך תשובה מתוך שיחה: """${String(text).slice(0, 3000)}""". ` +
      `החזר/י JSON: {"topic":"<שם נושא אחד בדיוק מהרשימה שאליו זה שייך>","title":"<כותרת קצרה (2-5 מילים) על מה הסיכום>","summary_md":"<הסיכום עצמו ב-Markdown נקי>"}. ` +
      `ב-summary_md: שמור/י על התוכן, הטבלאות והנקודות — אבל הסר/י כל פנייה אישית, שם פרטי, פתיחות ("בטח", "יופי") ושאלות של צ'אט ("רוצה ש..."). רק הסיכום העובדתי. ` + HEB_RULE })
    return { parts, wantJson: true }
  }
  if (task === 'classify_topic') {
    const { subjectName, text, knownTopics = [] } = payload
    parts.push({ text:
      `במקצוע "${subjectName}" קיימים הנושאים הבאים: ${knownTopics.join(' | ')}. ` +
      `לפניך סיכום/תשובה מתוך שיחה: """${String(text).slice(0, 1500)}""". ` +
      `לאיזה נושא מהרשימה הוא שייך בעיקר? החזר/י JSON בלבד: {"topic":"<שם נושא אחד, בדיוק כפי שנכתב ברשימה>"}. בחר/י את המתאים ביותר, ואל תמציא/י שם חדש. ` + HEB_RULE })
    return { parts, wantJson: true }
  }
  if (task === 'tag_sentence') {
    const { subjectName, topicName, count = 6, mode = 'syntax', learner } = payload
    const isPos = mode === 'pos'
    const roles = isPos ? '"פועל", "שם עצם", "שם תואר", "מילת קישור"' : '"נושא", "נשוא", "נשוא מורחב", "משלים שם", "משלים פועל"'
    const rules = isPos
      ? `לכל מילה — חלק הדיבר שלה. פועל: פעולה שאפשר להטות בזמן. שם עצם: אדם/חפץ/מקום/מושג (בד"כ אפשר ה' הידיעה). שם תואר: מתאר שם עצם ("איזה?"). מילות יחס/קישור/מ"ש → "מילת קישור".`
      : `השתמש/י אך ורק בחמשת התפקידים האלה, ולא באחרים. שיטה: קודם הנשוא, אז הנושא, אז המשלימים. ` +
        `• נשוא = פועל יחיד שמציין את הפעולה. ` +
        `• נשוא מורחב = שני פעלים רצופים, או פועל + שם פועל, שהם פעולה אחת ("התחיל לרוץ", "המשיכה לחגוג") — שתי המילים מקבלות "נשוא מורחב". ` +
        `• משלים שם = מתאר שם עצם, עונה על "איזה?/של מי?/כמה?" ונצמד לשם עצם (לוואי). ` +
        `• משלים פועל = קשור לפועל: מושא (את מי?/במה?/למי?/על מה?) או תיאור (מתי?/איפה?/איך?). ` +
        `מילת יחס נצמדת לתפקיד הצירוף ("את החשוד" → שתיהן "משלים פועל"; "במעבדה" → "משלים פועל"). ה' הידיעה חלק מהמילה.`
    parts.push({ text:
      `צור/י ${count} משפטים פשוטים בעברית לתרגול ${isPos ? 'זיהוי חלקי הדיבר' : 'ניתוח תחבירי'} לכיתה ${gradeOf(learner)}${topicName ? ` (נושא: ${topicName})` : ''}. ` +
      `לכל משפט פרק/י אותו למילים לפי הסדר, ולכל מילה קבע/י תווית מתוך: ${roles} בלבד. ${rules} ` +
      `החזר/י JSON: {"items":[{"sentence":"המשפט המלא","tokens":[{"w":"מילה","role":"תווית"}],"explain":"משפט הסבר קצר על החלוקה"}]}. ` +
      `ה-tokens בסדר הופעתן במשפט, וצירופן ברווחים = המשפט המלא. ` + HEB_RULE + ' ' + TONE_RULE + ' ' + nikudRule(subjectName) + learnerRule(learner) })
    return { parts, wantJson: true }
  }
  if (task === 'match_scope') {
    const { subjectName, scopeText, knownTopics = [] } = payload
    parts.push({ text:
      `במקצוע "${subjectName}" קיימים הנושאים הבאים: ${knownTopics.join(' | ')}. ` +
      `לפניך מיקוד החומר למבחן: """${scopeText}""". ` +
      `החזר/י JSON בלבד: {"in_exam":["<שמות נושאים — אך ורק מהרשימה שלמעלה, בדיוק כפי שנכתבו — הכלולים במיקוד>"]}. ` +
      `אל תמציא/י שמות חדשים. אם המיקוד כללי או עמום — בחר/י את הנושאים מהרשימה שהכי מתאימים לו. ` + HEB_RULE })
    return { parts, wantJson: true }
  }
  if (task === 'fetch_source') {
    const { subjectName, reference } = payload
    parts.push({ text:
      `חפש/י ברשת והבא/י את הנוסח המדויק והמלא של: "${reference}"${subjectName ? ` (מקצוע ${subjectName})` : ''}. ` +
      `אם זה שיר — כל השורות והבתים במדויק ובשורות המקוריות, ממקור אמין (פרויקט בן־יהודה / ויקיטקסט). ` +
      `אם אלה פסוקים מהתנ"ך — במדויק, עם ניקוד ומספרי פסוקים (ספריא / ויקיטקסט / נוסח המסורה). ` +
      `החזר/י אך ורק את הטקסט עצמו — בלי פרשנות, בלי הקדמה, בלי הסבר ובלי "שלום". ` + HEB_RULE })
    return { parts, wantJson: false }
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
  const grounded = !!payload.grounded
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${DIRECT_KEY}`
  const reqBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: wantJson && !grounded ? { temperature: 0.4, responseMimeType: 'application/json' } : { temperature: grounded ? 0.2 : 0.6 },
  }
  if (grounded) reqBody.tools = [{ google_search: {} }]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  const cand = data?.candidates?.[0]
  const out = (cand?.content?.parts || []).map((p) => p.text || '').join('')
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c?.web?.uri).filter(Boolean)
  if (!wantJson) return { answer: out, sources }
  const parsed = parseJson(out)
  if (!parsed) throw new Error('parse_failed')
  return parsed
}

// מצב "צינור דק": הפרומפט נבנה כאן (buildParts) ונשלח לפונקציה, שרק מוסיפה את המפתח.
// כך כל הלוגיקה בצד הלקוח (מתעדכן אוטומטית) — אין צורך לפרוס את הפונקציה שוב.
async function callFn(payload) {
  if (!FN_URL) throw new Error('שירות ה-AI אינו מוגדר')
  const { parts, wantJson } = buildParts(payload)
  const grounded = !!payload.grounded
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON || ''}` },
    body: JSON.stringify({ parts, wantJson, grounded }),
  })
  if (!res.ok) throw new Error(`שגיאת מערכת ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const out = data?.text ?? ''
  const sources = data?.sources || []
  if (!wantJson) return { answer: out, sources }
  const parsed = parseJson(out)
  if (!parsed) throw new Error('parse_failed')
  return parsed
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// שגיאות חולפות ששווה לנסות עליהן שוב: עומס זמני על המודל, קצב, או JSON שלא נפרס
const isRetryable = (e) => /parse_failed|overload|unavailable|timeout|network|failed to fetch|\b(429|500|502|503|504)\b/i.test(String(e))

// ניסיון חוזר אוטומטי — קריטי כשמעלים כמה קבצים ברצף וחלקם נתקלים בשגיאה חולפת
async function call(payload) {
  const run = () => (DIRECT_KEY ? callDirect(payload) : callFn(payload))
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await run() }
    catch (e) {
      lastErr = e
      if (attempt === 2 || !isRetryable(e)) throw e
      await sleep(700 * Math.pow(2, attempt) + Math.random() * 400) // 0.7s, ~1.4s
    }
  }
  throw lastErr
}


// ── איזון אורך: תשובה נכונה ארוכה בהרבה מהשאר מסגירה את עצמה ──
const clen = (s) => String(s || '').trim().length
export function isUnbalanced(q) {
  if (!Array.isArray(q?.choices) || q.choices.length < 2 || typeof q.answer !== 'number') return false
  const c = clen(q.choices[q.answer])
  const others = q.choices.filter((_, i) => i !== q.answer).map(clen)
  const maxOther = Math.max(...others)
  return c > maxOther * 1.25 && c - maxOther >= 12
}
// בקרת איכות לתשובה אחת של הבודק: מחזיר {kind:'ok'|'fixed'|'drop', q?} — ומוודא שהתיקון תקין לפני שמשתמשים בו
export function readReview(orig, it) {
  if (!it || it.status === 'ok' || !it.status) return { kind: 'ok' }
  if (it.status === 'drop') return { kind: 'drop' }
  const n = orig.choices.length
  const choices = Array.isArray(it.choices) && it.choices.length === n && it.choices.every((c) => typeof c === 'string' && c.trim()) ? it.choices : null
  const answer = Number.isInteger(it.answer) && it.answer >= 0 && it.answer < n ? it.answer : null
  if (!choices || answer == null) return { kind: 'ok' }
  const q = typeof it.q === 'string' && it.q.trim() ? it.q : orig.q
  const explain = typeof it.explain === 'string' && it.explain.trim() ? it.explain : orig.explain
  const same = q === orig.q && answer === orig.answer && choices.every((c, k) => c === orig.choices[k]) && explain === orig.explain
  return same ? { kind: 'ok' } : { kind: 'fixed', q: { ...orig, q, choices, answer, explain } }
}
export const reviewBatch = async (p) => deepClean(await call({ task: 'review_questions', ...p }))

// בקרת איכות אוטומטית לשאלות חדשות (נכונות, אורך, מסיחים, ערבוב מקצועות) — לפני שהן נשמרות
async function reviewQuestions(questions, { subjectName, learner, source }) {
  const list = (questions || []).filter((q) => Array.isArray(q?.choices) && q.choices.length >= 2 && typeof q.answer === 'number')
  if (!list.length) return questions || []
  const CH = 12
  const chunks = []
  for (let i = 0; i < list.length; i += CH) chunks.push(list.slice(i, i + CH))
  const done = await Promise.all(chunks.map(async (chunk) => {
    try {
      const { items } = await reviewBatch({ subjectName, learner, source, items: chunk.map((q, i) => ({ id: String(i), q: q.q, choices: q.choices, answer: q.answer, explain: q.explain || '' })) })
      const byId = Object.fromEntries((items || []).map((it) => [String(it.id), it]))
      const res = chunk.map((q, i) => ({ q, r: readReview(q, byId[String(i)]) }))
      // בודק שמוחק יותר מחצי — חשוד; לא מוחקים כלום במנה הזו
      const tooMany = res.filter((x) => x.r.kind === 'drop').length > chunk.length / 2
      return res.filter((x) => tooMany || x.r.kind !== 'drop').map((x) => (x.r.kind === 'fixed' ? x.r.q : x.q))
    } catch { return chunk }
  }))
  return done.flat()
}

export const analyzeMaterial = async (p) => {
  const out = deepClean(await call({ task: 'analyze_material', ...p }))
  // תמיכה בשני הפורמטים: topics[] חדש, או topic יחיד ישן
  const raw = Array.isArray(out.topics) && out.topics.length
    ? out.topics
    : (out.topic ? [{ topic: out.topic, summary_md: out.summary_md, questions: out.questions, flashcards: out.flashcards }] : [])
  const valid = raw.filter((t) => t && t.topic)
  // בקרת איכות — כל נושא מול הסיכום שלו והטקסט המקורי (במקביל)
  const extra = [out.source_text, p.text].filter(Boolean).join('\n\n')
  const reviewed = await Promise.all(valid.map((t) => reviewQuestions(t.questions, {
    subjectName: p.subjectName, learner: p.learner, source: [t.summary_md, extra].filter(Boolean).join('\n\n'),
  })))
  const topics = valid.map((t, ti) => ({
    ...t,
    questions: shuffleQuestions(reviewed[ti]),
    flashcards: t.flashcards || [],
  }))
  return { topics, source_text: out.source_text || '' }
}
export const generateQuestions = async (p) => {
  const out = deepClean(await call({ task: 'generate_questions', ...p }))
  return { ...out, questions: shuffleQuestions(await reviewQuestions(out.questions, { subjectName: p.subjectName, learner: p.learner, source: p.sourceText })) }
}
export const explain = async (p) => deepClean(await call({ task: 'explain', ...p }))
export const checkExercise = async (p) => deepClean(await call({ task: 'check_exercise', ...p }))
// קריאת צילום מיקוד המבחן (הלוח / מה שהמורה שלחה) → טקסט מסודר של מה שנכלל
export const scanScope = async (p) => deepClean(await call({ task: 'scan_scope', ...p })).answer
// התאמת מיקוד החומר לרשימת הנושאים הקיימים → אילו נושאים כלולים במבחן
export const matchScopeTopics = async (p) => deepClean(await call({ task: 'match_scope', ...p }))
// זיהוי הנושא שאליו שייך טקסט (לשמירת סיכום מהצ'אט לנושא הנכון)
export const classifyTopic = async (p) => deepClean(await call({ task: 'classify_topic', ...p }))
// הכנת סיכום נקי מהצ'אט: מזהה נושא, יוצר כותרת קצרה, ומנקה פנייה אישית/צ'אט
export const prepNote = async (p) => deepClean(await call({ task: 'prep_note', ...p }))
// תרגיל ניתוח משפט / חלקי דיבר — משפטים עם תווית תפקיד לכל מילה
export const generateSentenceTags = async (p) => deepClean(await call({ task: 'tag_sentence', ...p }))
// הוספת ניקוד לשאלות קיימות (בניינים/צורות פועל) — מקבל מנה ומחזיר אותה מנוקדת
export const renikudQuestions = async (items) => deepClean(await call({ task: 'renikud', items }))

// סיכום עיוני מסודר לנושא. אם מועברים sourceMaterials (החומרים שהועלו) — מאחד אותם; אחרת סיכום כללי.
// enrich=false (ברירת מחדל): רק מהחומר שהועלה. enrich=true: מותר להשלים מהידע הכללי.
export const topicSummary = async ({ subjectName, topicName, learner, sourceMaterials, enrich }) => {
  const hasSource = sourceMaterials && sourceMaterials.trim()
  const faith = enrich
    ? `בסס/י את הסיכום על החומר שהועלה, ומותר להשלים ולהעשיר מהידע הכללי במקומות שחסרים או לא ברורים.`
    : `הסתמך/י אך ורק על החומר שהועלה — אל תוסיף/י מידע, מושגים או דוגמאות שאינם מופיעים בו.`
  const intro = hasSource
    ? `לפניך כל החומרים שהתלמיד/ה העלה/תה לנושא "${topicName}" (${subjectName}). אחד/י אותם לסיכום אחד מסודר ומקיף — בלי כפילויות וסתירות, ותוך שמירה על כל הדגשים החשובים. ${faith} ${CONSOLIDATE_RULE}\n\nהחומרים שהועלו:\n"""${String(sourceMaterials).slice(0, 12000)}"""\n\n`
    : `כתוב סיכום מסודר לחזרה על הנושא "${topicName}" במקצוע "${subjectName}", ברמת כיתה ${gradeOf(learner)}. `
  const question = intro +
    `בנה אותו כך: (1) כלל/הגדרה קצרה של הנושא. (2) לכל מושג מרכזי — מה זה, על איזו שאלה הוא עונה, ודוגמה. ` +
    `(3) דגשים וטעויות נפוצות למבחן. (4) כשמתאים — השתמש בטבלת Markdown להשוואה, עם עמודות שמתאימות לנושא: לרוב "מושג | מה זה | על איזו שאלה עונה | דוגמה", ובנושאים כמו שם המספר "מספר | זכר | נקבה". ` +
    TONE_RULE + ' ' + summaryLangRule(learner) + litRule(subjectName) + ' ' + nikudRule(subjectName) + ' ' +
    `החזר Markdown נקי בלבד (כותרות ##, נקודות, טבלאות), בלי הקדמות ובלי סיומת ובלי "שלום".`
  const { answer } = await explain({ subjectName, question, learner })
  // באיחוד אין גישה למחברת עצמה — אזהרות "במחברת כתוב" שנשארו למרות ההוראה מוסרות כאן בוודאות
  return { summary_md: hasSource ? stripNotebookWarnings(answer) : answer }
}

// הבאת טקסט מקור מלא (שיר / פסוקים) מהרשת עם חיפוש אמיתי (grounding) + קישור למקור
export const fetchSourceText = async ({ subjectName, reference }) => {
  const out = deepClean(await call({ task: 'fetch_source', subjectName, reference, grounded: true }))
  return { source_text: out.answer, sources: out.sources || [] }
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
