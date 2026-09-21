import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { explain } from '../lib/gemini'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'

const QUIZ = '🎯 תבחן אותי'
const SUGGESTIONS = ['תסביר לי בפשטות', 'תן דוגמה', 'למה זה ככה?', QUIZ]

export default function Explain({ nav, params }) {
  const { subjectId, subjectName, context } = params
  const { profile } = useAuth()
  const intro = { who: 'ai', text: `${profile?.name ? profile.name + ', ' : ''}מה לא ברור ב${subjectName}? אפשר לכתוב הכול במילים שלך.` }

  const [msgs, setMsgs] = useState([intro])
  const [chatId, setChatId] = useState(null)
  const [history, setHistory] = useState([])
  const [showHist, setShowHist] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  async function loadHistory() {
    const { data } = await supabase.from('chats').select('id, title, messages, updated_at')
      .eq('subject_id', subjectId).order('updated_at', { ascending: false })
    setHistory(data || [])
  }
  useEffect(() => { loadHistory() }, [subjectId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function persist(next) {
    const title = (next.find((m) => m.who === 'me')?.text || 'שיחה').slice(0, 40)
    if (chatId) {
      await supabase.from('chats').update({ messages: next, title, updated_at: new Date().toISOString() }).eq('id', chatId)
    } else {
      const { data } = await supabase.from('chats').insert({ subject_id: subjectId, title, messages: next }).select('id').single()
      if (data) setChatId(data.id)
    }
    loadHistory()
  }

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    const afterMe = [...msgs, { who: 'me', text: q }]
    setMsgs(afterMe); setBusy(true)
    try {
      const { answer } = await explain({ subjectName, context, question: q, learner: profile })
      const next = [...afterMe, { who: 'ai', text: answer || 'לא הצלחתי לענות, נסו לנסח אחרת.' }]
      setMsgs(next); persist(next)
    } catch {
      setMsgs((m) => [...m, { who: 'ai', text: 'משהו השתבש בחיבור. נסו שוב עוד רגע.' }])
    } finally { setBusy(false) }
  }

  function openChat(c) { setChatId(c.id); setMsgs(c.messages || [intro]); setShowHist(false) }
  function newChat() { setChatId(null); setMsgs([intro]); setShowHist(false) }

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-[23px] font-black flex-1">תסביר לי</h1>
        <button className="text-primary text-sm font-bold" onClick={newChat}>+ שיחה חדשה</button>
      </div>
      <div className="text-muted text-[13.5px] mb-3">{subjectName}</div>

      {/* היסטוריה — מקופלת תחת חץ */}
      {history.length > 0 && (
        <>
          <button className="list-title flex items-center gap-2 w-full !mt-0" onClick={() => setShowHist((v) => !v)}>
            <span className="flex-1 text-start">💬 שיחות קודמות ({history.length})</span>
            <span className="text-[12px] font-bold">{showHist ? 'הסתר ▲' : 'הצג ▼'}</span>
          </button>
          {showHist && (
            <div className="card mb-3">
              {history.map((c) => (
                <button key={c.id} onClick={() => openChat(c)}
                  className="flex items-center gap-3 w-full text-start py-2.5 border-b border-line last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-semibold truncate">{c.title || 'שיחה'}</div>
                    <div className="text-[12px] text-muted">{new Date(c.updated_at).toLocaleDateString('he-IL')}</div>
                  </div>
                  <span className="text-muted text-[13px]">פתח ›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

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
          <button key={s} className="chip" disabled={busy}
            onClick={() => s === QUIZ
              ? nav.go('practicePicker', { subjectId, subjectName, mode: 'practice' })
              : send(s)}>{s}</button>
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="כתבו כאן שאלה חופשית…" />
        <button type="submit" disabled={busy || !input.trim()}>שלח</button>
      </form>
    </div>
  )
}
