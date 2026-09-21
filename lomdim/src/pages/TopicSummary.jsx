import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { topicSummary, fetchSourceText } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import Markdown from '../components/Markdown'

export default function TopicSummary({ nav, params }) {
  const { subjectId, subjectName, topicId, topicName } = params
  const { profile } = useAuth()
  const [summary, setSummary] = useState(null)
  const [sourceText, setSourceText] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const [qCount, setQCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ref, setRef] = useState('')
  const [fetching, setFetching] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: mats }, { data: src }, { count }] = await Promise.all([
      supabase.from('materials').select('summary_md, created_at').eq('topic_id', topicId)
        .not('summary_md', 'is', null).order('created_at', { ascending: false }).limit(1),
      supabase.from('materials').select('source_text').eq('topic_id', topicId)
        .not('source_text', 'is', null).order('created_at', { ascending: false }).limit(1),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('topic_id', topicId),
    ])
    setSummary(mats?.[0]?.summary_md || null)
    setSourceText(src?.[0]?.source_text || null)
    setQCount(count || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [topicId])

  async function fetchSource() {
    setFetching(true); setErr('')
    try {
      const { source_text } = await fetchSourceText({ subjectName, reference: ref.trim() || topicName })
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור', source_text,
      })
      await load(); setShowSource(true); setRef('')
    } catch (e) {
      setErr('הבאת הטקסט נכשלה. נסו שוב. ' + String(e))
    } finally { setFetching(false) }
  }

  async function generate() {
    setBusy(true); setErr('')
    try {
      const { summary_md } = await topicSummary({ subjectName, topicName, learner: profile })
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, title: 'סיכום עיוני', kind: 'text', summary_md,
      })
      await load()
    } catch (e) {
      setErr('יצירת הסיכום נכשלה. נסו שוב עוד רגע. ' + String(e))
    } finally { setBusy(false) }
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-2">
      <h1 className="text-[22px] font-black mb-1">{topicName}</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName} · חומר לחזרה</div>

      {sourceText ? (
        <>
          <button className="list-title flex items-center gap-2 w-full !mt-0" onClick={() => setShowSource((v) => !v)}>
            <span className="flex-1 text-start">📜 הטקסט המלא</span>
            <span className="text-[12px] font-bold">{showSource ? 'הסתר ▲' : 'הצג ▼'}</span>
          </button>
          {showSource && (
            <div className="card mb-3 whitespace-pre-line text-[14.5px] leading-relaxed">{sourceText}</div>
          )}
        </>
      ) : (
        <div className="card mb-3">
          <div className="text-[14px] font-semibold mb-1">📜 טקסט מקור (שיר / פסוקים)</div>
          <div className="text-muted text-[12.5px] mb-2">להביא את הטקסט המלא מהידע (לא מהצילום) — למשל שם שיר, או "בראשית פרק א, פסוקים א–ה".</div>
          <input className="field mb-2" value={ref} onChange={(e) => setRef(e.target.value)}
            placeholder={topicName} />
          <button className="btn btn-wide" onClick={fetchSource} disabled={fetching}>
            {fetching ? 'מביא…' : '📜 הבא טקסט מלא'}
          </button>
        </div>
      )}

      {summary ? (
        <div className="card text-[14.5px] leading-relaxed"><Markdown text={summary} /></div>
      ) : (
        <div className="card empty">
          <div className="big">📖</div>
          עדיין אין סיכום עיוני לנושא הזה.<br />לחצו למטה כדי שהמערכת תכין אחד מסודר.
        </div>
      )}

      {err && <div className="text-bad text-[13.5px] mt-3">{err}</div>}

      <div className="action-row mt-3">
        <button className="btn" onClick={generate} disabled={busy}>
          {busy ? 'מכין…' : summary ? '✨ סכם מחדש' : '✨ צור סיכום עיוני'}
        </button>
        <button className="btn btn-primary" disabled={qCount === 0}
          onClick={() => nav.go('practice', { subjectId, subjectName, topicId, topicName, mode: 'practice' })}>
          🎯 תרגל נושא זה
        </button>
      </div>
    </div>
  )
}
