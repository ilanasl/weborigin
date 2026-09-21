import { useState, useRef, useEffect } from 'react'
import { explain } from '../lib/gemini'
import Markdown from '../components/Markdown'

const SUGGESTIONS = ['תסביר לי בפשטות', 'תן דוגמה', 'למה זה ככה?', 'תבחן אותי בשאלה']

export default function Explain({ params }) {
  const { subjectName, context } = params
  const [msgs, setMsgs] = useState([
    { who: 'ai', text: `שלום! אני כאן לעזור ב${subjectName}. מה לא ברור? אפשר לכתוב הכול במילים שלך.` },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput(''); setMsgs((m) => [...m, { who: 'me', text: q }]); setBusy(true)
    try {
      const { answer } = await explain({ subjectName, context, question: q })
      setMsgs((m) => [...m, { who: 'ai', text: answer || 'לא הצלחתי לענות, נסו לנסח אחרת.' }])
    } catch {
      setMsgs((m) => [...m, { who: 'ai', text: 'משהו השתבש בחיבור. נסו שוב עוד רגע.' }])
    } finally { setBusy(false) }
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">תסביר לי</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.who}`}>
            {m.who === 'ai' && <div className="who">מורה 🤖</div>}
            {m.who === 'ai' ? <Markdown text={m.text} /> : m.text}
          </div>
        ))}
        {busy && <div className="bubble ai"><div className="who">מורה 🤖</div>חושב…</div>}
        <div ref={endRef} />
      </div>

      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="כתבו כאן שאלה חופשית…" />
        <button type="submit" disabled={busy || !input.trim()}>שלח</button>
      </form>
    </div>
  )
}
