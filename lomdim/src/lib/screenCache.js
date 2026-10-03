// זיכרון מסכים: כשחוזרים למסך — מציגים מיד את מה שהיה, ומרעננים מהשרת ברקע (בלי "טוען…").
// נשמר רק בזיכרון של הלשונית הפתוחה; טעינה מחדש של האפליקציה מתחילה נקי.
const mem = new Map()
export const cached = (key) => mem.get(key)
export const remember = (key, val) => { mem.set(key, val) }
export const forgetAll = () => mem.clear()
