import { useEffect, useRef, useState } from 'react'

// מחשבון קטן לתרגילי מתמטיקה — צף מעל התרגיל, אפשר לגרור אותו מהפס העליון לכל מקום במסך
// (המיקום נשמר במכשיר). "הקטנה" (או גרירה אל קצה המסך) מצמידה אותו לצד כלשונית קטנה — כמו סרטון
// בטלפון — והחישוב האחרון נשאר. הזיכרון נשמר גם בין תרגילים באותו סבב.
// החישוב נעשה כאן (בלי eval): מספרים, + − × ÷, סוגריים ומינוס בהתחלה.
function evaluate(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '')
  let i = 0
  const peek = () => s[i]
  function num() {
    const m = /^\d*\.?\d+|^\d+\./.exec(s.slice(i))
    if (!m) throw new Error('bad')
    i += m[0].length
    return parseFloat(m[0])
  }
  function factor() {
    if (peek() === '-') { i++; return -factor() }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('bad'); i++; return v }
    return num()
  }
  function term() {
    let v = factor()
    while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r }
    return v
  }
  function expr() {
    let v = term()
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r }
    return v
  }
  const v = expr()
  if (i !== s.length || !Number.isFinite(v)) throw new Error('bad')
  return Math.round(v * 1e6) / 1e6
}

const KEYS = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '=']
const POS_KEY = 'calcPos'
// נשמר בין תרגילים (כל תרגיל בונה את המסך מחדש)
export const calcMemory = { open: false, expr: '', result: null, docked: null }
const readPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) ? p : null } catch { return null } }

export default function Calculator({ onClose, wake }) {
  const [expr, setExprState] = useState(calcMemory.expr)
  const [result, setResultState] = useState(calcMemory.result)   // { ok, text }
  const [pos, setPos] = useState(readPos)        // null = מקום ברירת המחדל (למטה בצד)
  const [docked, setDockedState] = useState(calcMemory.docked)   // null | 'left' | 'right'
  const setExpr = (v) => { calcMemory.expr = v; setExprState(v) }
  const setResult = (v) => { calcMemory.result = v; setResultState(v) }
  const setDocked = (v) => { calcMemory.docked = v; setDockedState(v) }
  const box = useRef(null)
  const drag = useRef(null)
  const posRef = useRef(pos)
  posRef.current = pos
  // לחיצה על "מחשבון" כשהוא מוקטן — מחזירה אותו
  useEffect(() => { if (wake) setDocked(null) }, [wake])

  // תמיד בתוך המסך — גם אחרי סיבוב הטלפון או מקום שנשמר במסך אחר
  const size = () => ({ w: box.current?.offsetWidth || 300, h: box.current?.offsetHeight || 400 })
  const clamp = (p) => {
    const { w, h } = size()
    return { x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8), y: Math.min(Math.max(8, p.y), window.innerHeight - h - 8) }
  }
  const savePos = (p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* אין אחסון — לא נורא */ } }
  // הקטנה: נצמד לצד הקרוב, נשאר רק לשונית קטנה
  function minimize() {
    const r = box.current.getBoundingClientRect()
    const p = clamp({ x: r.left, y: r.top })
    setPos(p); savePos(p)
    setDocked(r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right')
  }
  useEffect(() => {
    if (pos) setPos(clamp(pos))
    const onResize = () => setPos((p) => (p ? clamp(p) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function startDrag(e) {
    if (e.target.closest('button')) return
    const r = box.current.getBoundingClientRect()
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function moveDrag(e) {
    if (!drag.current) return
    // בזמן גרירה מותר לחרוג חצי מהרוחב החוצה — כדי שאפשר יהיה "לזרוק" לצד
    const { w } = size(), y = clamp({ x: 8, y: e.clientY - drag.current.dy }).y
    setPos({ x: Math.min(Math.max(-w * 0.6, e.clientX - drag.current.dx), window.innerWidth - w * 0.4), y })
  }
  function endDrag() {
    if (!drag.current) return
    drag.current = null
    const { w } = size(), p = posRef.current
    if (!p) return
    if (p.x < -w * 0.3 || p.x > window.innerWidth - w * 0.7) setDocked(p.x < 0 ? 'left' : 'right')
    const c = clamp(p); setPos(c); savePos(c)
  }

  function press(k) {
    if (k === 'C') { setExpr(''); setResult(null); return }
    if (k === '⌫') { setExpr(expr.slice(0, -1)); setResult(null); return }
    if (k === '=') {
      try { const v = evaluate(expr); setResult({ ok: true, text: String(v).replace('-', '−') }) } catch { setResult({ ok: false, text: 'התרגיל לא שלם' }) }
      return
    }
    // אחרי תוצאה — מספר חדש מתחיל חישוב חדש, ופעולה ממשיכה מהתוצאה
    if (result?.ok) {
      setExpr(/[\d.(]/.test(k) ? k : result.text + k)
      setResult(null)
      return
    }
    setExpr(expr + k); setResult(null)
  }

  // מקלדת פיזית (במחשב): ספרות, פעולות, Enter, Backspace, Escape
  useEffect(() => {
    const map = { '*': '×', '/': '÷', '-': '−', Enter: '=', '=': '=', Backspace: '⌫', Delete: 'C' }
    const onKey = (e) => {
      if (docked || e.target.closest?.('input, textarea')) return
      if (e.key === 'Escape') { onClose(); return }
      const k = map[e.key] || (/^[\d.+()]$/.test(e.key) ? e.key : null)
      if (k) { e.preventDefault(); press(k) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (docked) {
    // לשונית מציצה בקצה המסך — לחיצה מחזירה את המחשבון בדיוק למצב שהיה
    const top = pos ? pos.y + 24 : undefined
    return (
      <button type="button" className={`calc-tab ${docked}`} style={top != null ? { top, bottom: 'auto' } : undefined}
        aria-label="פתיחת המחשבון" onClick={() => setDocked(null)}>
        <span aria-hidden="true">🧮</span>
        {result?.ok && <span className="calc-tab-res" dir="ltr">{result.text}</span>}
      </button>
    )
  }

  const style = pos ? { left: pos.x, top: pos.y, bottom: 'auto' } : undefined
  return (
    <div ref={box} className="calc-wrap" style={style} role="dialog" aria-label="מחשבון">
      <div className="calc">
        <div className="calc-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <span className="calc-grip" aria-hidden="true" />
          <span className="font-disp font-bold text-[15px] flex-1">מחשבון</span>
          <span className="text-[11.5px] text-muted">גררו מכאן</span>
          <button type="button" className="calc-x" aria-label="הקטנה לצד (החישוב נשמר)" onClick={minimize}>—</button>
          <button type="button" className="calc-x" aria-label="סגירת המחשבון" onClick={() => { setExpr(''); setResult(null); onClose() }}>✕</button>
        </div>
        <div className="calc-screen" dir="ltr">
          <div className="calc-expr">{expr || '0'}</div>
          {result && <div className={`calc-res ${result.ok ? '' : 'bad'}`}>{result.ok ? '= ' : ''}{result.text}</div>}
        </div>
        <div className="calc-keys" dir="ltr">
          {KEYS.map((k) => (
            <button key={k} type="button" aria-label={k === '⌫' ? 'מחיקה' : k === 'C' ? 'ניקוי' : k}
              className={`calc-key ${'÷×−+'.includes(k) ? 'op' : ''} ${k === '=' ? 'eq' : ''} ${k === 'C' || k === '⌫' ? 'fn' : ''}`}
              onClick={() => press(k)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
