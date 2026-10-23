import { useEffect, useRef, useState } from 'react'
import { useG } from '../lib/gender'
import { supabase } from '../lib/supabase'
import { BottomSheet } from './QuestionUI'
import Calculator, { calcMemory } from './Calculator'
import { makeExercise, toQuestion, difficultyOf, levelOf, bumpLevel, parsePoly } from '../lib/mathDrill'

const num = (s) => Number(String(s).trim().replace(/[−–]/g, '-').replace(/\s/g, ''))
// תשובה שיכולה להיות לא שלמה: שבר (27/2 או 27:2) או עשרוני. עשרוני מעוגל מתקבל אם יש בו לפחות 2 ספרות אחרי הנקודה
function fracOk(raw, ans) {
  const t = String(raw).trim().replace(/[−–]/g, '-').replace(/\s/g, '').replace(':', '/')
  const m = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(t)
  const v = m ? Number(m[1]) / Number(m[2]) : Number(t)
  if (!Number.isFinite(v)) return false
  if (Math.abs(v - ans) < 1e-9) return true
  return !m && (t.split('.')[1] || '').length >= 2 && Math.abs(v - ans) < 0.006
}
// מספרים בתוך משפט בעברית — כיוון משמאל לימין, שהמינוס לא יקפוץ
const ltrNums = (t) => t.replace(/\(?−?\d+°?\)?/g, (m) => `<bdi dir="ltr">${m}</bdi>`)
// ה-HTML נבנה בקוד שלנו בלבד (mathDrill) — לא מתוכן שהמשתמש או ה-AI כתבו
const Html = ({ html, className, as: Tag = 'span' }) => <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />

// תרגיל מתמטי אחד בתוך סבב תרגול: הקלדת תשובה (או בחירה), ניסיון שני, ופתרון שלב אחר שלב.
// התשובה נרשמת לדוח; טעות → אותו תרגיל כשאלה אמריקאית ל"לחיזוק" (onReview).
export default function DrillExercise({ subjectId, item, topicName, examMode, onDone, onReview }) {
  const g = useG()
  const [lv] = useState(() => levelOf(subjectId, item.type))
  const [ex] = useState(() => makeExercise(item.type, lv, item.variant))
  const [vals, setVals] = useState([])
  const [wrong, setWrong] = useState(null)   // אחרי ניסיון ראשון שגוי: אילו שדות לא נכונים
  const [done, setDone] = useState(null)     // null | true | false
  const [picked, setPicked] = useState(null)
  const [calc, setCalcState] = useState(calcMemory.open)   // מחשבון קטן בצד — נשאר פתוח/מוקטן גם בתרגיל הבא
  const [wake, setWake] = useState(0)
  const setCalc = (v) => { calcMemory.open = v; if (v) calcMemory.docked = null; setCalcState(v) }
  const [badInput, setBadInput] = useState(false)   // ביטוי שלא הצלחנו לקרוא
  const [work, setWork] = useState('')               // הדרך (לא חובה, לא נבדקת)
  const workRef = useRef(null)
  const target = useRef(0)                            // לאיזו שורה הכפתורים מוסיפים: 'work' או מספר השדה
  const ansRefs = useRef([])
  const mathRef = useRef(null)
  const stepsRef = useRef(null)
  const firstInput = useRef(null)

  // ביטוי ארוך — מקטינים את הגופן עד שנכנס בשורה אחת
  useEffect(() => {
    const m = mathRef.current
    if (m) for (let fs = 26; m.scrollWidth > m.clientWidth && fs > 15; fs--) m.style.fontSize = fs + 'px'
    firstInput.current?.focus({ preventScroll: true })
  }, [])

  async function record(ok) {
    try {
      const row = { subject_id: subjectId, topic_id: item.topic_id, correct: ok, difficulty: difficultyOf(lv || 2) }
      const { error } = await supabase.from('attempts').insert(examMode ? { ...row, mode: 'exam' } : row)
      if (error && examMode) await supabase.from('attempts').insert(row)
      if (ok) return
      const { data: ins } = await supabase.from('questions').insert({ subject_id: subjectId, topic_id: item.topic_id, ...toQuestion(ex, lv || 2) }).select('id')
      if (ins?.length) {
        await supabase.from('review_items').insert(ins.map((q) => ({ subject_id: subjectId, kind: 'question', ref_id: q.id, streak: 0 })))
        onReview?.()
      }
    } catch { /* לא חוסם את התרגול */ }
  }

  function finish(ok) {
    setDone(ok)
    bumpLevel(subjectId, item.type, ok)
    record(ok)
    onDone(ok)
    requestAnimationFrame(() => stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function check() {
    const f0 = ex.fields[0]
    if (f0.poly) {
      // ביטוי שלם: לא קריא → הסבר איך לכתוב (לא נחשב ניסיון)
      const c = parsePoly(vals[0] ?? '', f0.v)
      if (!c) { setBadInput(true); return }
      setBadInput(false)
      const ok = c.every((n, i) => n === f0.ans[i])
      if (ok) { setWrong(null); finish(true); return }
      if (!wrong && !examMode) { setWrong([false]); return }
      setWrong([false]); finish(false); return
    }
    const ok = ex.fields.map((f, i) => (f.frac ? fracOk(vals[i] ?? '', f.ans) : num(vals[i] ?? '') === f.ans))
    if (ok.every(Boolean)) { setWrong(null); finish(true); return }
    if (!wrong && !examMode) { setWrong(ok); return }   // ניסיון ראשון — אפשר לתקן (לא בסימולציה)
    setWrong(ok); finish(false)
  }

  function choose(v) {
    if (done !== null) return
    setPicked(v)
    finish(v === ex.fields[0].ans)
  }

  const filled = ex.fields.every((_, i) => String(vals[i] ?? '').trim() !== '')
  const isChoice = ex.kind === 'tf' || ex.kind === 'pick'
  const poly = !!ex.fields[0].poly
  const withWork = poly || ex.type === 'eq' || ex.type === 'tri'
  const opts = ex.kind === 'tf' ? [[true, 'נכון'], [false, 'לא נכון']] : ex.fields[0].opts

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="tp-badge inline-block" style={{ background: 'var(--primary)' }}>{topicName || ex.tag}{examMode ? ' · סימולציה' : ''}</span>
        <span className="flex items-center gap-3">
          {lv > 0 && (
            <span className="md-level" aria-label={`רמה ${lv} מתוך 3`}>רמה {[1, 2, 3].map((n) => <i key={n} className={n <= lv ? 'on' : ''} />)}</span>
          )}
          <button type="button" className="calc-open" aria-expanded={calc}
            onClick={() => { if (calc && calcMemory.docked) setWake((n) => n + 1); else setCalc(!calc) }}>🧮 מחשבון</button>
        </span>
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
        <>
          {/* הדרך — לא חובה ולא נבדקת (פילוג, משוואות, משולש); התשובה — חובה, רק היא נבדקת */}
          {withWork && (
            <>
              <label className="md-label" htmlFor="md-work">הדרך <span className="text-muted font-normal">(לא חובה — אפשר גם במחברת)</span></label>
              <textarea id="md-work" ref={workRef} rows={poly ? 1 : 3} autoCapitalize="off" autoCorrect="off" spellCheck={false}
                dir="ltr" className="md-poly md-work" value={work} disabled={done !== null}
                onFocus={() => { target.current = 'work' }} onChange={(e) => setWork(e.target.value)} />
              <label className="md-label" htmlFor="md-ans">התשובה <span className="text-muted font-normal">(חובה — רק היא נבדקת)</span></label>
            </>
          )}
          {poly ? (
            <input id="md-ans" ref={firstInput} inputMode="text" enterKeyHint="done" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              dir="ltr" className={`md-poly ${wrong ? 'no' : done === true ? 'ok' : ''}`}
              value={vals[0] ?? ''} disabled={done !== null}
              onFocus={() => { target.current = 0 }}
              onChange={(e) => { setVals([e.target.value]); setBadInput(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && filled && done === null) check() }} />
          ) : (
            <div className="md-answer">
              {ex.fields.map((f, i) => (
                <span key={i} className="contents">
                  {f.pre && <Html html={f.pre} className={i > 0 ? 'ml-5' : undefined} />}
                  <input id={i === 0 ? 'md-ans' : undefined} ref={(el) => { ansRefs.current[i] = el; if (i === 0) firstInput.current = el }} inputMode="text" enterKeyHint="done" aria-label={`תשובה ${i + 1}`}
                    className={`${f.sup ? 'sup' : ''} ${wrong ? (wrong[i] ? 'ok' : 'no') : done === true ? 'ok' : ''}`}
                    value={vals[i] ?? ''} disabled={done !== null}
                    onFocus={() => { target.current = i }}
                    onChange={(e) => { const v = vals.slice(); v[i] = e.target.value; setVals(v) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && filled && done === null) check() }} />
                  {f.post && <Html html={f.post} />}
                </span>
              ))}
            </div>
          )}
          {withWork && done === null && (
            // מקלדת בעברית — האות, החזקה, הסימנים והסוגריים בלחיצה אחת, בשורה שבה נמצא הסמן
            <div className="md-keys">
              {(poly ? [ex.fields[0].v, '²', '+', '−', '·', '(', ')', '='] : (ex.fields[0].frac ? ['x', '+', '−', '·', ':', '/', '.', '(', ')', '='] : ['x', '+', '−', '·', ':', '(', ')', '='])).map((k) => (
                <button key={k} type="button" className="md-key" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const isWork = target.current === 'work', fi = isWork ? 0 : target.current
                    const el = isWork ? workRef.current : (poly ? firstInput.current : ansRefs.current[fi])
                    const cur = isWork ? work : (vals[fi] ?? '')
                    const a = el?.selectionStart ?? cur.length, b = el?.selectionEnd ?? cur.length
                    const next = cur.slice(0, a) + k + cur.slice(b)
                    if (isWork) setWork(next); else { const v = vals.slice(); v[fi] = next; setVals(v); setBadInput(false) }
                    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + k.length, a + k.length) })
                  }}>{k}</button>
              ))}
            </div>
          )}
          {badInput && <div className="md-note">לא הצלחתי לקרוא את התשובה. בשורת התשובה כותבים רק את התוצאה הסופית, למשל: <bdi dir="ltr">{`${ex.fields[0].v}²+5${ex.fields[0].v}+6`}</bdi></div>}
        </>
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

      {done === null && !isChoice && (
        <BottomSheet>
          <button type="button" className="q-next" onClick={check} disabled={!filled}
            style={filled ? undefined : { background: 'rgba(20,20,22,.1)', color: 'rgba(20,20,22,.5)' }}>
            {filled ? g('✓ בדוק', '✓ בדקי') : 'מלאו את התשובה'}
          </button>
        </BottomSheet>
      )}
      {calc && <Calculator wake={wake} onClose={() => setCalc(false)} />}
    </>
  )
}
