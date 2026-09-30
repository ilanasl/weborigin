import { useEffect, useRef, useState } from 'react'
import { mathText } from '../lib/mathText'
import Markdown from './Markdown'

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו']

// פס התקדמות מקוטע: ירוק = נכון, כתום = טעות, לבן = השאלה הנוכחית
export function SegProgress({ total, idx, results = [], label }) {
  // סבב ארוך (למשל חיזוק עם 148 פריטים) — פס רציף במקום עשרות מקטעים זעירים
  if (total > 20) return (
    <div className="q-top">
      <div className="q-segs">
        <i style={{ background: 'rgba(255,255,255,.14)', position: 'relative', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${(idx + 1) / total * 100}%`, background: 'var(--primary)', borderRadius: 3 }} />
        </i>
      </div>
      <b className="tnum" dir="ltr">{label ?? `${idx + 1}/${total}`}</b>
    </div>
  )
  return (
    <div className="q-top">
      <div className="q-segs">
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const c = r === true ? 'var(--good)' : r === false ? 'var(--bad)' : i === idx ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.14)'
          return <i key={i} style={{ background: c }} />
        })}
      </div>
      <b className="tnum" dir="ltr">{label ?? `${idx + 1}/${total}`}</b>
    </div>
  )
}

// בלוק השאלה: תגית הנושא + הטקסט, על כרטיס ליים
export function QuestionBlock({ topic, sub, text }) {
  return (
    <div className="q-block">
      {topic && (
        <div className="q-tag">
          <span className="opacity-70 font-semibold">נושא:</span>
          <span>{topic}</span>
        </div>
      )}
      <div>
        {sub && <div className="q-sub">{sub}</div>}
        <div className="q-text">{mathText(text)}</div>
      </div>
    </div>
  )
}

export function Options({ choices, answer, picked, onPick }) {
  const answered = picked != null
  return (
    <div className="q-opts">
      {choices.map((c, i) => {
        const state = !answered ? '' : i === answer ? 'ok' : i === picked ? 'bad' : 'dim'
        return (
          <button key={i} type="button" disabled={answered} onClick={() => onPick(i)} className={`q-opt ${state}`}>
            <span className="q-letter">{LETTERS[i] || i + 1}</span>
            <span className="flex-1">{mathText(c)}</span>
            {state === 'ok' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            {state === 'bad' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>}
          </button>
        )
      })}
    </div>
  )
}

// גיליון בהיר קבוע בתחתית + מקום ריק בגובהו, כדי שלא יסתיר את התוכן
export function BottomSheet({ children, className = '', scroll = false, role }) {
  const sheet = useRef(null)
  const [h, setH] = useState(260)
  useEffect(() => {
    const el = sheet.current
    if (!el) return
    const measure = () => setH(el.offsetHeight + 12)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    // בלי קפיצה: גוללים רק אם התשובה המסומנת מוסתרת מאחורי הגיליון, ורק בדיוק כמה שצריך
    if (scroll) requestAnimationFrame(() => {
      // התשובה האחרונה ברשימה (או אריח המילה האחרון) — כך אף תשובה לא נשארת מוסתרת
      const target = [...document.querySelectorAll('.q-opt, .syn-tile')].pop()
      if (!target) return
      const hiddenBy = target.getBoundingClientRect().bottom - (window.innerHeight - el.offsetHeight) + 12
      if (hiddenBy > 0) window.scrollBy({ top: hiddenBy, behavior: 'smooth' })
    })
    return () => ro?.disconnect()
  }, [scroll])
  return (
    <>
      <div style={{ height: h }} />
      <div ref={sheet} className={`q-sheet ${className}`} role={role}>
        <div className="q-grip" />
        {children}
      </div>
    </>
  )
}

// גיליון משוב שעולה מלמטה אחרי תשובה
export function FeedbackSheet({ ok, title, explain, extra, nextLabel = 'הבא', onNext, busy = false, finishLabel, onFinish }) {
  return (
    <BottomSheet className={ok ? 'ok' : 'bad'} scroll role="status">
      <div className="q-sheet-title">{title}</div>
      {explain && <div className="q-sheet-body"><Markdown text={explain} /></div>}
      {extra}
      <button type="button" className="q-next" onClick={onNext} disabled={busy}>
        <span>{nextLabel}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      </button>
      {onFinish && (
        <button type="button" className="q-finish" onClick={onFinish}>{finishLabel || 'סיים תרגול'}</button>
      )}
    </BottomSheet>
  )
}
