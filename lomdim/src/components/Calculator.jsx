import { useEffect, useRef, useState } from 'react'

// מחשבון קטן לתרגילי מתמטיקה — צף מעל התרגיל, אפשר לגרור אותו מהפס העליון לכל מקום במסך
// (המיקום נשמר במכשיר), ונסגר בלי לאבד את מה שנכתב.
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
const readPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) ? p : null } catch { return null } }

export default function Calculator({ onClose }) {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState(null)   // { ok, text }
  const [pos, setPos] = useState(readPos)        // null = מקום ברירת המחדל (למטה בצד)
  const box = useRef(null)
  const drag = useRef(null)

  // תמיד בתוך המסך — גם אחרי סיבוב הטלפון או מקום שנשמר במסך אחר
  const clamp = (p) => {
    const el = box.current, w = el?.offsetWidth || 280, h = el?.offsetHeight || 380
    return { x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8), y: Math.min(Math.max(8, p.y), window.innerHeight - h - 8) }
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
    setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  function endDrag() {
    if (!drag.current) return
    drag.current = null
    setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* אין אחסון — לא נורא */ } return p })
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
      if (e.target.closest?.('input, textarea')) return
      if (e.key === 'Escape') { onClose(); return }
      const k = map[e.key] || (/^[\d.+()]$/.test(e.key) ? e.key : null)
      if (k) { e.preventDefault(); press(k) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const style = pos ? { left: pos.x, top: pos.y, bottom: 'auto' } : undefined
  return (
    <div ref={box} className="calc-wrap" style={style} role="dialog" aria-label="מחשבון">
      <div className="calc">
        <div className="calc-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <span className="calc-grip" aria-hidden="true" />
          <span className="font-disp font-bold text-[15px] flex-1">מחשבון</span>
          <span className="text-[11.5px] text-muted">גררו מכאן</span>
          <button type="button" className="calc-x" aria-label="סגירת המחשבון" onClick={onClose}>✕</button>
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
