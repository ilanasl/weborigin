import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { explain, prepNote } from '../lib/gemini'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'

// תגובות-המשך — מופיעות רק אחרי שהמורה ענה (לא בשיחה חדשה ריקה)
const FOLLOWUPS = ['עדיין לא הבנתי', 'תן דוגמה', 'תסביר יותר פשוט']

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
  const [topics, setTopics] = useState([])
  const [addIdx, setAddIdx] = useState(null)   // אינדקס ההודעה שמוסיפים ממנה לסיכומים
  const [addTopic, setAddTopic] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [prep, setPrep] = useState({ title: '', summary_md: '' })
  const [saved, setSaved] = useState({})       // idx -> נוסף
  const endRef = useRef(null)

  async function loadHistory() {
    const { data } = await supabase.from('chats').select('id, title, messages, updated_at')
      .eq('subject_id', subjectId).order('updated_at', { ascending: false })
    setHistory(data || [])
  }
  useEffect(() => { loadHistory() }, [subjectId])
  useEffect(() => {
    supabase.from('topics').select('id, name').eq('subject_id', subjectId).order('created_at')
      .then(({ data }) => setTopics(data || []))
  }, [subjectId])

  // פתיחת התפריט + זיהוי נושא, כותרת נקייה וסיכום מנוקה
  async function openAdd(i) {
    setAddIdx(i); setAddTopic(topics[0]?.id || ''); setPrep({ title: '', summary_md: '' }); setDetecting(true)
    try {
      const { topic, title, summary_md } = await prepNote({ subjectName, text: msgs[i].text, knownTopics: topics.map((t) => t.name) })
      const match = topics.find((t) => t.name === topic)
      if (match) setAddTopic(match.id)
      setPrep({ title: title || '', summary_md: summary_md || '' })
    } catch { /* נשארים עם ברירת המחדל */ } finally { setDetecting(false) }
  }

  async function saveSummary(i) {
    const topicId = addTopic || topics[0]?.id
    if (!topicId) return
    await supabase.from('materials').insert({
      subject_id: subjectId, topic_id: topicId,
      title: prep.title || 'סיכום', kind: 'note',
      summary_md: prep.summary_md || msgs[i].text,
    })
    setSaved((s) => ({ ...s, [i]: true })); setAddIdx(null)
  }
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
    } catch (e) {
      setMsgs((m) => [...m, { who: 'ai', text: 'שגיאה: ' + String(e?.message || e).slice(0, 300) }])
    } finally { setBusy(false) }
  }

  function openChat(c) { setChatId(c.id); setMsgs(c.messages || [intro]); setShowHist(false) }
  function newChat() { setChatId(null); setMsgs([intro]); setShowHist(false) }

  async function deleteChat(e, c) {
    e.stopPropagation()
    if (!window.confirm('למחוק את השיחה הזו? אי אפשר לשחזר.')) return
    await supabase.from('chats').delete().eq('id', c.id)
    if (chatId === c.id) newChat()
    loadHistory()
  }

  // תגובות-המשך מופיעות רק כשכבר יש חילופי דברים והמורה ענה אחרון
  const showFollowups = msgs.length > 1 && msgs[msgs.length - 1].who === 'ai' && !busy
  // הודעת פתיחה גנרית — לא מציעים עליה "הוסף לסיכומים"
  const isIntro = (m) => m.who === 'ai' && /מה לא ברור/.test(m.text || '')

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
                <div key={c.id}
                  className="flex items-center gap-2 w-full py-2.5 border-b border-line last:border-0">
                  <button onClick={() => openChat(c)} className="flex-1 min-w-0 text-start">
                    <div className="text-[14.5px] font-semibold truncate">{c.title || 'שיחה'}</div>
                    <div className="text-[12px] text-muted">{new Date(c.updated_at).toLocaleDateString('he-IL')}</div>
                  </button>
                  <button onClick={() => openChat(c)} className="text-muted text-[13px]">פתח ›</button>
                  <button onClick={(e) => deleteChat(e, c)} title="מחק שיחה"
                    className="w-8 h-8 rounded-[9px] grid place-items-center text-[15px]"
                    style={{ color: 'var(--bad)' }}>🗑</button>
                </div>
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
            {m.who === 'ai' && !isIntro(m) && (
              saved[i] ? (
                <div className="text-good text-[12px] font-semibold mt-2">✓ נוסף לסיכומים של הנושא</div>
              ) : addIdx === i ? (
                <div className="mt-2 pt-2 border-t border-line">
                  <div className="text-[12px] text-muted mb-1.5">
                    {detecting ? 'מזהה את הנושא… ✍️' : 'לשמור בנושא (אפשר לשנות):'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="field !py-1.5 !w-auto text-[13px]" value={addTopic} onChange={(e) => setAddTopic(e.target.value)} disabled={detecting}>
                      {topics.length === 0 && <option value="">אין נושאים</option>}
                      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button className="text-[12.5px] font-bold text-primary disabled:opacity-40" onClick={() => saveSummary(i)} disabled={detecting || !topics.length}>שמור</button>
                    <button className="text-[12.5px] font-semibold text-muted" onClick={() => setAddIdx(null)}>ביטול</button>
                  </div>
                </div>
              ) : (
                <button className="text-[12px] text-primary font-semibold mt-2 hover:underline"
                  onClick={() => openAdd(i)}>➕ הוסף לסיכומים שלי</button>
              )
            )}
          </div>
        ))}
        {busy && <div className="bubble ai"><div className="who">מורה 🤖</div>חושב…</div>}
        <div ref={endRef} />
      </div>

      {showFollowups && (
        <div className="chips">
          {FOLLOWUPS.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="כתבו כאן שאלה חופשית…" />
        <button type="submit" disabled={busy || !input.trim()}>שלח</button>
      </form>
    </div>
  )
}
