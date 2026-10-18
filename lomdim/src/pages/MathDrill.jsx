import { useEffect, useRef, useState } from 'react'
import { useG } from '../lib/gender'
import { SegProgress, BottomSheet, FeedbackSheet } from '../components/QuestionUI'
import { makeExercise, ROUND, LEVELED } from '../lib/mathDrill'

// תרגילים שנבנים בקוד (בלי AI) — סבב של 10, רמה נפרדת לכל סוג.
// 2 נכונות ברצף → הרמה עולה; טעות → יורדת. הרמות נשמרות במכשיר.
const keyOf = (id) => `mathDrill:${id}`
function loadLevels(id) {
  try { const v = JSON.parse(localStorage.getItem(keyOf(id)) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function saveLevels(id, lv) { try { localStorage.setItem(keyOf(id), JSON.stringify(lv)) } catch { /* אין אחסון — לא נורא */ } }

const num = (s) => Number(String(s).trim().replace(/[−–]/g, '-').replace(/\s/g, ''))
// מספרים בתוך משפט בעברית — כיוון משמאל לימין, שהמינוס לא יקפוץ
const ltrNums = (t) => t.replace(/\(?−?\d+°?\)?/g, (m) => `<bdi dir="ltr">${m}</bdi>`)
const Html = ({ html, className, as: Tag = 'span' }) => <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />

export default function MathDrill({ nav, params }) {
  const g = useG()
  const { subjectId } = params
  const [levels, setLevels] = useState(() => ({ tri: 1, expand: 1, eq: 1, pow: 1, ...loadLevels(subjectId) }))
  const streak = useRef({})
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState([])
  const [ex, setEx] = useState(() => makeExercise(ROUND[0], levels[ROUND[0]]))
  const [vals, setVals] = useState([])
  const [wrong, setWrong] = useState(null)   // אחרי ניסיון ראשון שגוי: אילו שדות לא נכונים
  const [done, setDone] = useState(null)     // null | true | false
  const [picked, setPicked] = useState(null)
  const mathRef = useRef(null)
  const stepsRef = useRef(null)
  const firstInput = useRef(null)

  // ביטוי ארוך — מקטינים את הגופן עד שנכנס בשורה אחת
  useEffect(() => {
    const m = mathRef.current
    if (!m) return
    m.style.fontSize = ''
    for (let fs = 26; m.scrollWidth > m.clientWidth && fs > 15; fs--) m.style.fontSize = fs + 'px'
    firstInput.current?.focus({ preventScroll: true })
  }, [ex])

  function finish(ok) {
    setDone(ok)
    setResults((r) => { const n = r.slice(); n[idx] = ok; return n })
    const t = ex.type
    if (LEVELED.includes(t)) {
      const s = streak.current
      let lv = levels[t] || 1
      if (ok) { s[t] = (s[t] || 0) + 1; if (s[t] >= 2 && lv < 3) { lv++; s[t] = 0 } }
      else { s[t] = 0; if (lv > 1) lv-- }
      const next = { ...levels, [t]: lv }
      setLevels(next); saveLevels(subjectId, next)
    }
    requestAnimationFrame(() => stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function check() {
    const ok = ex.fields.map((f, i) => num(vals[i] ?? '') === f.ans)
    if (ok.every(Boolean)) { setWrong(null); finish(true); return }
    if (!wrong) { setWrong(ok); return }       // ניסיון ראשון — אפשר לתקן
    setWrong(ok); finish(false)
  }

  function choose(v) {
    if (done !== null) return
    setPicked(v)
    finish(v === ex.fields[0].ans)
  }

  function next() {
    const i = idx + 1
    if (i >= ROUND.length) { setResults([]); setIdx(0) } else setIdx(i)
    const type = ROUND[i % ROUND.length]
    setEx(makeExercise(type, levels[type]))
    setVals([]); setWrong(null); setDone(null); setPicked(null)
    window.scrollTo({ top: 0 })
  }

  const filled = ex.fields.every((_, i) => String(vals[i] ?? '').trim() !== '')
  const lv = LEVELED.includes(ex.type) ? levels[ex.type] || 1 : 0
  const isChoice = ex.kind === 'tf' || ex.kind === 'pick'
  const opts = ex.kind === 'tf' ? [[true, 'נכון'], [false, 'לא נכון']] : ex.fields[0].opts

  return (
    <div className="pt-1">
      <SegProgress total={ROUND.length} idx={idx} results={results} />
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="tp-badge inline-block" style={{ background: 'var(--primary)' }}>{ex.tag}</span>
        {lv > 0 && (
          <span className="md-level" aria-label={`רמה ${lv} מתוך 3`}>רמה {[1, 2, 3].map((n) => <i key={n} className={n <= lv ? 'on' : ''} />)}</span>
        )}
      </div>
      <h1 className="font-black text-[30px] leading-tight">{ex.title}</h1>

      <div className="mt-4">
        {ex.figure
          ? <Html as="div" className="md-figure" html={ex.figure} />
          : <div ref={mathRef} className="md-math" dangerouslySetInnerHTML={{ __html: ex.math }} />}
      </div>
      <div className="text-[15px] mb-3">{ex.ask}</div>

      {isChoice ? (
        <div className="md-opts">
          {opts.map(([v, l]) => {
            const cls = picked === v ? (v === ex.fields[0].ans ? 'ok' : 'no') : done !== null && v === ex.fields[0].ans ? 'ok' : ''
            return <button key={String(v)} type="button" className={`md-opt ${cls}`} disabled={done !== null} onClick={() => choose(v)}>{l}</button>
          })}
        </div>
      ) : (
        <div className="md-answer">
          {ex.fields.map((f, i) => (
            <span key={i} className="contents">
              {f.pre && <span>{f.pre}</span>}
              <input ref={i === 0 ? firstInput : undefined} inputMode="text" enterKeyHint="done" aria-label={`תשובה ${i + 1}`}
                className={`${f.sup ? 'sup' : ''} ${wrong ? (wrong[i] ? 'ok' : 'no') : done === true ? 'ok' : ''}`}
                value={vals[i] ?? ''} disabled={done !== null}
                onChange={(e) => { const v = vals.slice(); v[i] = e.target.value; setVals(v) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && filled && done === null) check() }} />
              {f.post && <Html html={f.post} />}
            </span>
          ))}
        </div>
      )}

      {wrong && done === null && (
        <div className="md-note">
          לא מדויק{ex.fields.length > 1 ? ' — המקומות באדום לא נכונים' : ''}. {g('נסה', 'נסי')} שוב, או{' '}
          <button type="button" className="underline font-semibold" onClick={() => finish(false)}>{g('הראה', 'הראי')} את הפתרון</button>
        </div>
      )}

      {done !== null && (
        <div ref={stepsRef} className="md-steps">
          <div className="font-disp font-bold text-[15px] mb-1">הפתרון שלב אחר שלב</div>
          {ex.steps.map(([why, expr, fin], i) => (
            <div key={i} className={`md-step ${fin ? 'final' : ''}`}>
              {why && <Html className="md-why" html={ltrNums(why)} />}
              {expr && <Html className="md-ex" html={expr} />}
            </div>
          ))}
        </div>
      )}

      {done === null ? (
        !isChoice && (
          <BottomSheet>
            <button type="button" className="q-next" onClick={check} disabled={!filled}
              style={filled ? undefined : { background: 'rgba(20,20,22,.1)', color: 'rgba(20,20,22,.5)' }}>
              {filled ? g('✓ בדוק', '✓ בדקי') : 'מלאו את התשובה'}
            </button>
          </BottomSheet>
        )
      ) : (
        <FeedbackSheet ok={done}
          title={done ? '🎉 נכון!' : 'לא הפעם — הפתרון למעלה'}
          nextLabel={idx + 1 < ROUND.length ? 'התרגיל הבא' : 'עוד סבב'}
          onNext={next}
          finishLabel="סיים תרגול ✓" onFinish={() => nav.back()} />
      )}
    </div>
  )
}
