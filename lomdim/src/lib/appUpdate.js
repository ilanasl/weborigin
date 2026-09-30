// זיהוי גרסה חדשה של האפליקציה: משווים את קובץ הסקריפט הראשי (שם עם hash) ל-index.html בשרת.
// כשיש גרסה חדשה — מסמנים, והמעבר מסך הבא טוען אותה (ומחזיר לאותו מסך).
const scriptOf = (html) => (String(html).match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/) || [])[1] || null
const current = () => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || null

let ready = false
let lastCheck = 0
export const updateReady = () => ready

async function check() {
  if (ready || Date.now() - lastCheck < 60_000) return
  lastCheck = Date.now()
  try {
    const res = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' })
    const latest = scriptOf(await res.text())
    const mine = current()
    if (latest && mine && latest !== mine) ready = true
  } catch { /* אין רשת — ננסה בפעם הבאה */ }
}

export function startUpdateWatch() {
  if (!import.meta.env.PROD) return
  check()
  setInterval(check, 5 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
}

// שמירת מחסנית המסכים לפני הטעינה מחדש, ושחזורה אחריה
const KEY = 'lomdim-stack-after-update'
export function reloadInto(stack) {
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.map(({ name, params }) => ({ name, params })))) } catch { /* */ }
  window.location.reload()
}
export function restoredStack() {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    const s = raw ? JSON.parse(raw) : null
    return Array.isArray(s) && s.length ? s : null
  } catch { return null }
}
