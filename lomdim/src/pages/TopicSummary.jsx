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
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteVal, setPasteVal] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [fetchedSources, setFetchedSources] = useState([])

  const isBible = /תנ["״׳']?ך|מקרא|תורה|נביאים|כתובים/.test(subjectName || '')
  // קישורים למקורות אמינים — ממולאים מראש עם שם השיר/המקור
  const q = encodeURIComponent((ref.trim() || topicName || '').trim())
  // חיפוש גוגל ממוקד לאתר — הכי אמין להגיע לעמוד הנכון (בלי לנחש נתיבי חיפוש פנימיים)
  const g = (extra) => `https://www.google.com/search?q=${q}${extra ? '%20' + extra : ''}`
  const SOURCES = isBible
    ? [
        { label: '📖 ספריא', url: g('site:sefaria.org.il') },
        { label: '📚 ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: '🔍 חיפוש', url: g('פסוקים') },
      ]
    : [
        { label: '📖 פרויקט בן־יהודה', url: g('site:benyehuda.org') },
        { label: '📚 ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: '🔍 חיפוש', url: g('שיר%20מלא%20טקסט') },
      ]

  async function savePasted() {
    const t = pasteVal.trim()
    if (!t) return
    setBusy(true); setErr('')
    try {
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור (מהמקור)', source_text: t,
      })
      setPasteVal(''); setPasteMode(false)
      await load(); setShowSource(true)
    } catch (e) {
      setErr('שמירת הטקסט נכשלה. ' + String(e))
    } finally { setBusy(false) }
  }

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
      const { source_text, sources } = await fetchSourceText({ subjectName, reference: ref.trim() || topicName })
      setFetchedSources(sources || [])
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור (מהרשת)', source_text,
      })
      await load(); setShowSource(true)
    } catch (e) {
      setErr('הבאת הטקסט נכשלה. אפשר לנסות שוב, או להביא מהמקורות למטה. ' + String(e))
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

      {sourceText && !pasteMode ? (
        <>
          <button className="list-title flex items-center gap-2 w-full !mt-0" onClick={() => setShowSource((v) => !v)}>
            <span className="flex-1 text-start">📜 הטקסט המלא</span>
            <span className="text-[12px] font-bold">{showSource ? 'הסתר ▲' : 'הצג ▼'}</span>
          </button>
          {showSource && (
            <div className="card mb-3">
              <div className="whitespace-pre-line text-[14.5px] leading-relaxed">{sourceText}</div>
              {fetchedSources.length > 0 && (
                <div className="text-[12px] text-muted mt-3">
                  📖 נמצא מהמקור: {fetchedSources.slice(0, 2).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="text-primary underline break-all">{new URL(u).hostname.replace('www.', '')}</a>
                  )).reduce((a, b) => [a, ' · ', b])}
                </div>
              )}
              <div className="flex gap-3 mt-3">
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={fetchSource} disabled={fetching}>{fetching ? 'מביא…' : '🔄 הבא שוב מהרשת'}</button>
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={() => { setPasteVal(sourceText); setPasteMode(true) }}>✏️ ערוך / החלף ידנית</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card mb-3">
          <div className="text-[14px] font-semibold mb-1">📜 הבא את הטקסט המלא ({isBible ? 'פסוקים' : 'שיר'})</div>
          <div className="text-muted text-[12.5px] mb-2 leading-relaxed">
            כתבו את שם {isBible ? 'הפרק/הפסוקים' : 'השיר'} — והמערכת תחפש ותביא אותו מהרשת ממקור אמין, עם קישור למקור.
          </div>
          <input className="field mb-2" value={ref} onChange={(e) => setRef(e.target.value)}
            placeholder={`שם ${isBible ? 'הפרק/הפסוקים' : 'השיר'} — ${topicName}`} />
          {!pasteMode && (
            <button className="btn btn-primary btn-wide" onClick={fetchSource} disabled={fetching}>
              {fetching ? 'מחפש ומביא מהרשת…' : '📥 הבא טקסט מלא מהרשת'}
            </button>
          )}
          {err && <div className="text-bad text-[12.5px] mt-2">{err}</div>}

          {/* גיבוי ידני — מקורות + הדבקה */}
          <button className="text-muted text-[12.5px] font-semibold mt-3 hover:text-primary w-full text-start"
            onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'הסתר ▲' : 'לא נמצא / לא מדויק? מקורות והדבקה ידנית ▼'}
          </button>
          {(showManual || pasteMode) && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-2 mb-3">
                {SOURCES.map((s) => (
                  <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                    className="text-[13px] font-semibold text-primary border border-line rounded-[10px] px-2.5 py-1.5 hover:border-primary">
                    {s.label} ↗
                  </a>
                ))}
              </div>
              {pasteMode ? (
                <>
                  <textarea className="field mb-2" style={{ minHeight: 160 }} value={pasteVal}
                    onChange={(e) => setPasteVal(e.target.value)}
                    placeholder="הדביקו כאן את הטקסט המלא מהמקור…" />
                  <div className="action-row">
                    <button className="btn" onClick={() => { setPasteMode(false); setPasteVal('') }} disabled={busy}>ביטול</button>
                    <button className="btn btn-primary" onClick={savePasted} disabled={busy || !pasteVal.trim()}>
                      {busy ? 'שומר…' : '💾 שמור טקסט מדויק'}
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn btn-wide" onClick={() => setPasteMode(true)}>📋 הדבק טקסט מהמקור</button>
              )}
            </div>
          )}
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
