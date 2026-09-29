import Markdown from './Markdown'

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו']

// פס התקדמות מקוטע: ירוק = נכון, כתום = טעות, לבן = השאלה הנוכחית
export function SegProgress({ total, idx, results = [], label }) {
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></svg>
          <span>{topic}</span>
        </div>
      )}
      <div>
        {sub && <div className="q-sub">{sub}</div>}
        <div className="q-text">{text}</div>
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
            <span className="flex-1">{c}</span>
            {state === 'ok' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            {state === 'bad' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>}
          </button>
        )
      })}
    </div>
  )
}

// גיליון משוב שעולה מלמטה אחרי תשובה
export function FeedbackSheet({ ok, title, explain, nextLabel = 'הבא', onNext }) {
  return (
    <>
      <div className="q-sheet-space" />
      <div className={`q-sheet ${ok ? 'ok' : 'bad'}`} role="status">
        <div className="q-grip" />
        <div className="q-sheet-title">{title}</div>
        {explain && <div className="q-sheet-body"><Markdown text={explain} /></div>}
        <button type="button" className="q-next" onClick={onNext}>
          <span>{nextLabel}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        </button>
      </div>
    </>
  )
}
