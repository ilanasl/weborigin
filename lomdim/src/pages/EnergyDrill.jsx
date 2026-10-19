import { useEffect, useRef, useState } from 'react'
import { useG } from '../lib/gender'
import { supabase } from '../lib/supabase'
import { SegProgress, BottomSheet, FeedbackSheet } from '../components/QuestionUI'
import { FORMS, ROUND, sceneCount, makeChain, chainOk, makePie, pieSVG, nameOf, shuffled } from '../lib/energyDrill'

// תרגול המרות אנרגיה — קובייה נפרדת במדעים (לא מתערבב בתרגול הרגיל).
// כל תשובה נרשמת לדוח — על נושא האנרגיה במקצוע אם יש כזה, אחרת על המקצוע בלבד.
// תרשים זרימה: בונים את שרשרת ההמרות בלחיצה על הקופסאות. גרף עוגה: חוק שימור האנרגיה בחישוב.
const lvKey = (id) => `energyDrill:${id}`
function readLv(id) {
  try { const v = JSON.parse(localStorage.getItem(lvKey(id)) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function saveLv(id, v) { try { localStorage.setItem(lvKey(id), JSON.stringify(v)) } catch { /* אין אחסון — לא נורא */ } }

const num = (s) => Number(String(s).trim().replace(/[−–]/g, '-').replace(/[%\s]/g, ''))
const ltrNums = (t) => t.replace(/\(?−?\d+%?\)?/g, (m) => `<bdi dir="ltr">${m}</bdi>`)

function Chain({ items, onTap, empty }) {
  if (!items.length) return <div className="en-chain en-chain-empty">{empty}</div>
  return (
    <div className="en-chain">
      {items.map((f, i) => (
        <span key={i} className="contents">
          {i > 0 && <span className="en-arrow" aria-hidden="true">←</span>}
          {onTap ? <button type="button" className="en-box" onClick={() => onTap(i)} aria-label={`להסיר ${f}`}>{f}</button>
            : <span className="en-box">{f}</span>}
        </span>
      ))}
    </div>
  )
}

export default function EnergyDrill({ nav, params }) {
  const g = useG()
  const { subjectId } = params
  const scenes = useRef(shuffled([...Array(sceneCount).keys()]))
  const sceneAt = useRef(0)
  const stats = useRef(readLv(subjectId))
  const make = (kind) => (kind === 'chain' ? makeChain(scenes.current[sceneAt.current++ % sceneCount]) : makePie(stats.current.pie || 1))

  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState([])
  const [ex, setEx] = useState(() => make(ROUND[0]))
  const [chain, setChain] = useState([])
  const [val, setVal] = useState('')
  const [wrong, setWrong] = useState(false)   // ניסיון ראשון שגוי — אפשר לתקן
  const [done, setDone] = useState(null)      // null | true | false
  const stepsRef = useRef(null)
  const topicId = useRef(null)

  useEffect(() => {
    supabase.from('topics').select('id, name').eq('subject_id', subjectId)
      .then(({ data }) => { topicId.current = (data || []).find((t) => /אנרגי/.test(t.name))?.id || null })
  }, [subjectId])

  function finish(ok) {
    setDone(ok)
    const difficulty = ex.kind === 'pie' ? ['קל', 'בינוני', 'קשה'][(stats.current.pie || 1) - 1] : 'בינוני'
    supabase.from('attempts').insert({ subject_id: subjectId, topic_id: topicId.current, correct: ok, difficulty })
      .then(() => {}, () => {})   // לא חוסם את התרגול
    setResults((r) => { const n = r.slice(); n[idx] = ok; return n })
    if (ex.kind === 'pie') {
      // רמה לגרף העוגה: 2 נכונות ברצף → עולה, טעות → יורדת
      const s = stats.current
      let lv = s.pie || 1, st = s.st || 0
      if (ok) { st++; if (st >= 2 && lv < 3) { lv++; st = 0 } } else { st = 0; if (lv > 1) lv-- }
      stats.current = { ...s, pie: lv, st }
      saveLv(subjectId, stats.current)
    }
    requestAnimationFrame(() => stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function check() {
    const ok = ex.kind === 'chain' ? chainOk(ex, chain) : num(val) === ex.ans
    if (ok) { finish(true); return }
    if (!wrong) { setWrong(true); return }
    finish(false)
  }

  function next() {
    const i = idx + 1
    if (i >= ROUND.length) { setResults([]); setIdx(0) } else setIdx(i)
    setEx(make(ROUND[i % ROUND.length]))
    setChain([]); setVal(''); setWrong(false); setDone(null)
    window.scrollTo({ top: 0 })
  }

  const ready = ex.kind === 'chain' ? chain.length >= 2 : String(val).trim() !== ''
  const lv = ex.kind === 'pie' ? stats.current.pie || 1 : 0

  return (
    <div className="pt-1">
      <SegProgress total={ROUND.length} idx={idx} results={results} />
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="tp-badge inline-block" style={{ background: 'var(--primary)' }}>המרות אנרגיה</span>
        {lv > 0 && <span className="md-level" aria-label={`רמה ${lv} מתוך 3`}>רמה {[1, 2, 3].map((n) => <i key={n} className={n <= lv ? 'on' : ''} />)}</span>}
      </div>

      {ex.kind === 'chain' ? (
        <>
          <h1 className="font-black text-[30px] leading-tight">תרשים זרימה</h1>
          <div className="en-scene">{ex.s}</div>
          <div className="text-[15px] mb-2">{done === null ? 'בנו את שרשרת ההמרות: הקישו על סוגי האנרגיה לפי הסדר.' : 'השרשרת שבנית:'}</div>
          <Chain items={chain} empty="הקישו על הקופסאות למטה ↓"
            onTap={done === null ? (i) => { setChain(chain.filter((_, j) => j !== i)); setWrong(false) } : null} />
          {done === null && (
            <>
              <div className="en-palette">
                {FORMS.map((f) => (
                  <button key={f} type="button" className="en-pick" disabled={chain.length >= 5}
                    onClick={() => { setChain([...chain, f]); setWrong(false) }}>{f}</button>
                ))}
              </div>
              {chain.length > 0 && <button type="button" className="text-[13px] text-muted underline mb-3" onClick={() => { setChain([]); setWrong(false) }}>ניקוי</button>}
            </>
          )}
        </>
      ) : (
        <>
          <h1 className="font-black text-[30px] leading-tight">גרף עוגה — שימור אנרגיה</h1>
          <div className="en-pie">
            <div className="en-pie-svg" dangerouslySetInnerHTML={{ __html: pieSVG(ex.pct) }} />
            <div className="en-legend">
              <div className="text-[12.5px] text-muted mb-1">נכנסה: {nameOf(ex.from)}{ex.total ? <> · <bdi dir="ltr">{ex.total}</bdi> ג'ול</> : ' · 100%'}</div>
              {ex.slices.map(([name, v], i) => (
                <div key={i} className="flex items-center gap-2 text-[14.5px]">
                  <i className="en-dot" style={{ background: i === 0 ? 'var(--primary)' : 'var(--accent)' }} />
                  <span>{nameOf(name)}:</span>
                  <b className="whitespace-nowrap">{typeof v === 'number' ? <><bdi dir="ltr">{v}</bdi> ג'ול</> : v}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[15px] mb-3 leading-relaxed">{ex.q}</div>
          <div className="md-answer">
            <input inputMode="decimal" enterKeyHint="done" aria-label="תשובה" value={val} disabled={done !== null}
              className={wrong ? 'no' : done === true ? 'ok' : ''} style={{ width: 110 }}
              onChange={(e) => { setVal(e.target.value); setWrong(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready && done === null) check() }} />
            <span>{ex.unit}</span>
          </div>
        </>
      )}

      {wrong && done === null && (
        <div className="md-note">
          לא מדויק. {g('נסה', 'נסי')} שוב, או{' '}
          <button type="button" className="underline font-semibold" onClick={() => finish(false)}>{g('הראה', 'הראי')} את הפתרון</button>
        </div>
      )}

      {done !== null && (
        <div ref={stepsRef} className="md-steps">
          {ex.kind === 'chain' ? (
            <>
              <div className="font-disp font-bold text-[15px] mb-2">{done ? 'נכון! ההסבר:' : 'השרשרת הנכונה:'}</div>
              {!done && <Chain items={ex.ok[0]} />}
              <div className="text-[14.5px] leading-relaxed mt-2">{ex.why}</div>
              {(() => {
                // שרשראות נוספות שמתקבלות — חוץ מזו שכבר מוצגת (של עילאי אם צדק, או הנכונה)
                const shown = done ? chain : ex.ok[0]
                const more = ex.ok.filter((c) => !chainOk({ ok: [c] }, shown))
                return more.length > 0 && <div className="text-[12.5px] text-muted mt-2">מתקבל גם: {more.map((c) => c.join(' ← ')).join(' · ')}</div>
              })()}
            </>
          ) : (
            <>
              <div className="font-disp font-bold text-[15px] mb-1">הפתרון שלב אחר שלב</div>
              {ex.steps.map(([why, expr, fin], i) => (
                <div key={i} className={`md-step ${fin ? 'final' : ''}`}>
                  <span className="md-why" dangerouslySetInnerHTML={{ __html: ltrNums(why) }} />
                  <span className="md-ex" style={/[א-ת]/.test(expr) ? { direction: 'rtl', textAlign: 'right' } : undefined}>{expr}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {done === null ? (
        <BottomSheet>
          <button type="button" className="q-next" onClick={check} disabled={!ready}
            style={ready ? undefined : { background: 'rgba(20,20,22,.1)', color: 'rgba(20,20,22,.5)' }}>
            {ready ? g('✓ בדוק', '✓ בדקי') : ex.kind === 'chain' ? 'בנו שרשרת של 2 קופסאות לפחות' : 'כתבו את התשובה'}
          </button>
        </BottomSheet>
      ) : (
        <FeedbackSheet ok={done} title={done ? '🎉 נכון!' : 'לא הפעם — הפתרון למעלה'}
          nextLabel={idx + 1 < ROUND.length ? 'התרגיל הבא' : 'עוד סבב'} onNext={next}
          finishLabel="סיים תרגול ✓" onFinish={() => nav.back()} />
      )}
    </div>
  )
}
