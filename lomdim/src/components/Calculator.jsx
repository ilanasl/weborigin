import { useState } from 'react'

// מחשבון קטן לתרגילי מתמטיקה — נפתח מעל התרגיל ונסגר בלי לאבד את מה שנכתב.
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

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '(', '+', ')', '⌫', 'C', '=']

export default function Calculator({ onClose }) {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState(null)   // { ok, text }
  const [top, setTop] = useState(false)        // מכסה משהו? אפשר להזיז למעלה / למטה

  function press(k) {
    if (k === 'C') { setExpr(''); setResult(null); return }
    if (k === '⌫') { setExpr(expr.slice(0, -1)); setResult(null); return }
    if (k === '=') {
      try { const v = evaluate(expr); setResult({ ok: true, text: String(v).replace('-', '−') }) } catch { setResult({ ok: false, text: 'לא תקין' }) }
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

  return (
    <div className={`calc-wrap ${top ? 'top' : ''}`} role="dialog" aria-label="מחשבון">
      <div className="calc">
        <div className="flex items-center justify-between mb-2">
          <span className="font-disp font-bold text-[15px]">מחשבון</span>
          <span className="flex gap-1.5">
            <button type="button" className="calc-x" aria-label={top ? 'להזיז למטה' : 'להזיז למעלה'} onClick={() => setTop(!top)}>{top ? '↓' : '↑'}</button>
            <button type="button" className="calc-x" aria-label="סגירת המחשבון" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="calc-screen" dir="ltr">
          <div className="calc-expr">{expr || '0'}</div>
          {result && <div className={`calc-res ${result.ok ? '' : 'bad'}`}>{result.ok ? '= ' : ''}{result.text}</div>}
        </div>
        <div className="calc-keys" dir="ltr">
          {KEYS.map((k) => (
            <button key={k} type="button" className={`calc-key ${'÷×−+='.includes(k) ? 'op' : ''} ${k === '=' ? 'eq' : ''}`} onClick={() => press(k)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
