import { useEffect } from 'react'

// ── פעולה ארוכה (AI) — חיווי אחיד + הגנה ──
// WorkNote: תיבה עם עיגול מסתובב, מה קורה עכשיו, והאם אפשר לעזוב את המסך.
//   stay — התוצאה נשמרת רק במסך הזה (למשל ניתוח לפני שמירה) → צריך להישאר.
//   אחרת — העבודה ממשיכה גם במעבר למסך אחר באפליקציה ונשמרת לבד.
// useWorking: בזמן העבודה המסך לא נכבה, וסגירת הלשונית שואלת קודם.

let lock = null
let holders = 0
// עבודה שממשיכה גם אחרי שיוצאים מהמסך (למשל שמירת חומר) — לא תלויה בחיי המסך
let background = 0
const onUnloadBg = (e) => { e.preventDefault(); e.returnValue = '' }
export function holdWork() {
  if (background++ === 0) window.addEventListener('beforeunload', onUnloadBg)
  let done = false
  return () => {
    if (done) return
    done = true
    if (--background === 0) window.removeEventListener('beforeunload', onUnloadBg)
  }
}
// יש עבודה ארוכה שרצה עכשיו — כדי שעדכון גרסה לא יטען את האפליקציה מחדש באמצע
export const isWorking = () => holders > 0 || background > 0
async function awake(on) {
  try {
    if (on && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen')
      lock.addEventListener?.('release', () => { lock = null })
    } else if (!on && lock && holders === 0) { await lock.release(); lock = null }
  } catch { lock = null }
}

export function useWorking(active) {
  useEffect(() => {
    if (!active) return
    holders++
    awake(true)
    const onUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    const onVis = () => { if (document.visibilityState === 'visible') awake(true) }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      holders--
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('visibilitychange', onVis)
      awake(false)
    }
  }, [active])
}

export default function WorkNote({ text, stay = false, light = false, className = '' }) {
  return (
    <div className={`work-note ${light ? 'work-note-light' : ''} ${className}`} role="status" aria-live="polite">
      <span className="up-spin mt-0.5" />
      <span>
        {text}
        <span className="work-sub">
          {stay
            ? 'צריך להישאר במסך הזה עד הסוף — יציאה תבטל את זה.'
            : 'אפשר לעבור למסך אחר באפליקציה — זה ימשיך ויישמר לבד. רק לא לסגור את האפליקציה ולא לנעול את הטלפון עד שזה מסתיים.'}
        </span>
      </span>
    </div>
  )
}
