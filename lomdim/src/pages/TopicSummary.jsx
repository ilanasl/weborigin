import { useEffect, useState } from 'react'
import { aiErrorText, aiErrorReason } from '../lib/aiError'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { topicSummary, fetchSourceText } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import Markdown from '../components/Markdown'

export default function TopicSummary({ nav, params }) {
  const { subjectId, subjectName, topicId, topicName } = params
  const { profile } = useAuth()
  const [summary, setSummary] = useState(null)
  const [notes, setNotes] = useState([])
  const [aggSource, setAggSource] = useState('')
  const [sourceText, setSourceText] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const [qCount, setQCount] = useState(0)
  // ניהול נושא
  const [otherTopics, setOtherTopics] = useState([])
  const [showManage, setShowManage] = useState(false)
  const [renameVal, setRenameVal] = useState(topicName || '')
  const [name, setName] = useState(topicName || '')   // שם הנושא (אפשר לשנות במקום)
  const [editName, setEditName] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')
  const [enrich, setEnrich] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ref, setRef] = useState('')
  const [fetching, setFetching] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteVal, setPasteVal] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [fetchedSources, setFetchedSources] = useState([])
  const [wantSource, setWantSource] = useState(false)

  const isBible = /תנ["״׳']?ך|מקרא|תורה|נביאים|כתובים/.test(subjectName || '')
  // טקסט מקור מלא רלוונטי רק לספרות/תנ״ך — לא לדקדוק/לשון/מתמטיקה וכו'
  const isLiterary = isBible || /ספרות|שיר|פזמון|יצירה|בלדה|סיפור|פרוזה/.test(subjectName || '')
  const srcKind = isBible ? 'פסוקים' : isLiterary ? 'שיר' : 'טקסט מקור'
  // קישורים למקורות אמינים — ממולאים מראש עם שם השיר/המקור
  const q = encodeURIComponent((ref.trim() || name || '').trim())
  // חיפוש גוגל ממוקד לאתר — הכי אמין להגיע לעמוד הנכון (בלי לנחש נתיבי חיפוש פנימיים)
  const g = (extra) => `https://www.google.com/search?q=${q}${extra ? '%20' + extra : ''}`
  const SOURCES = isBible
    ? [
        { label: 'ספריא', url: g('site:sefaria.org.il') },
        { label: 'ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: 'חיפוש', url: g('פסוקים') },
      ]
    : [
        { label: 'פרויקט בן־יהודה', url: g('site:benyehuda.org') },
        { label: 'ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: 'חיפוש', url: g('שיר%20מלא%20טקסט') },
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
    const [{ data: allMats }, { count }, { data: tps }] = await Promise.all([
      supabase.from('materials').select('id, kind, title, summary_md, source_text, created_at')
        .eq('topic_id', topicId).order('created_at', { ascending: false }),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('topic_id', topicId),
      supabase.from('topics').select('id, name').eq('subject_id', subjectId),
    ])
    const mats = allMats || []
    // סיכום מאוחד (kind='summary') מוצג ראשון; אחרת הסיכום העדכני מהדפים שהועלו
    const consolidated = mats.find((m) => m.kind === 'summary' && m.summary_md)
    const pages = mats.filter((m) => m.kind !== 'summary' && m.kind !== 'note')
    setSummary(consolidated?.summary_md || pages.find((m) => m.summary_md)?.summary_md || null)
    setNotes(mats.filter((m) => m.kind === 'note' && m.summary_md))
    setSourceText(mats.find((m) => m.source_text)?.source_text || null)
    // מקור לאיחוד: כל מה שהועלה לנושא (סיכומי דפים + טקסטים), לא כולל סיכום מאוחד/הערות
    // בלי שורות "⚠️ במחברת כתוב…" מסיכומי הדפים — אלה הערות של ה-AI, לא תוכן המחברת (אחרת הן מתגלגלות ומתרבות)
    const noWarn = (s) => String(s || '').split('\n').filter((l) => !/⚠️|במחברת (כתוב|נרשם|נרשמה)/.test(l)).join('\n')
    setAggSource(pages.map((m) => [noWarn(m.summary_md), m.source_text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n---\n\n'))
    setOtherTopics((tps || []).filter((t) => t.id !== topicId))
    setQCount(count || 0)
    setLoading(false)
  }

  async function deleteNote(id) {
    if (!window.confirm('להסיר את הסיכום הזה?')) return
    await supabase.from('materials').delete().eq('id', id)
    await load()
  }
  useEffect(() => { load() }, [topicId])

  async function fetchSource() {
    setFetching(true); setErr('')
    try {
      const { source_text, sources } = await fetchSourceText({ subjectName, reference: ref.trim() || name })
      setFetchedSources(sources || [])
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור (מהרשת)', source_text,
      })
      await load(); setShowSource(true)
    } catch (e) {
      setErr(aiErrorText('הבאת הטקסט נכשלה.', e))
    } finally { setFetching(false) }
  }

  async function generate() {
    setBusy(true); setErr('')
    try {
      // מאחד את כל החומרים שהועלו לנושא לסיכום אחד (אם אין — סיכום כללי)
      const { summary_md } = await topicSummary({ subjectName, topicName: name, learner: profile, sourceMaterials: aggSource, enrich })
      await supabase.from('materials').delete().eq('topic_id', topicId).eq('kind', 'summary')
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, title: 'סיכום עיוני', kind: 'summary', summary_md,
      })
      await load()
    } catch (e) {
      setErr(aiErrorText('יצירת הסיכום נכשלה.', e))
    } finally { setBusy(false) }
  }

  async function renameTopic() {
    const nm = renameVal.trim()
    if (!nm || nm === name) { setEditName(false); setRenameVal(name); return }
    try {
      const { error } = await supabase.from('topics').update({ name: nm }).eq('id', topicId)
      if (error) throw error
      setName(nm)
    } catch { setRenameVal(name) }
    setEditName(false)
  }

  async function mergeInto() {
    if (!mergeTarget) return
    if (!window.confirm('להעביר את כל התוכן של הנושא הזה לנושא שנבחר ולמחוק את הנושא הזה?')) return
    setBusy(true)
    // (לבונה השאילתות של Supabase אין .catch — לכן try/catch)
    for (const tbl of ['questions', 'flashcards', 'materials', 'attempts', 'syntax_items']) {
      try { await supabase.from(tbl).update({ topic_id: mergeTarget }).eq('topic_id', topicId) } catch { /* */ }
    }
    await supabase.from('topics').delete().eq('id', topicId)
    nav.reset('subject', { id: subjectId })
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      {editName ? (
        <div className="flex items-center gap-2">
          <input className="field flex-1 min-w-0 !text-[18px] font-bold" value={renameVal} autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') renameTopic(); if (e.key === 'Escape') { setEditName(false); setRenameVal(name) } }} />
          <button type="button" className="hbtn !px-0 w-11 flex-none" aria-label="שמור שם" onClick={renameTopic}><Icon name="check" size={19} /></button>
          <button type="button" className="hbtn !px-0 w-11 flex-none" aria-label="ביטול" onClick={() => { setEditName(false); setRenameVal(name) }}><Icon name="x" size={18} /></button>
        </div>
      ) : (
        <h1 className="font-black text-[30px] leading-[1.1] tracking-tight">
          {name}
          <button type="button" className="inline-grid place-items-center align-middle ms-2 w-8 h-8 rounded-full text-muted" style={{ background: 'rgba(255,255,255,.08)' }}
            aria-label="שינוי שם הנושא" onClick={() => { setRenameVal(name); setEditName(true) }}><Icon name="pencil" size={15} /></button>
        </h1>
      )}
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">
        {summary ? 'סיכום' : 'אין עדיין סיכום'} · {qCount} שאלות{notes.length ? ` · ${notes.length} סיכומים שהוספתי` : ''}
      </div>
      <button type="button" className="ts-practice" disabled={qCount === 0}
        onClick={() => nav.go('practice', { subjectId, subjectName, topicId, topicName: name, mode: 'practice' })}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
        <span>תרגל את הנושא</span>
        {qCount > 0 && <span className="ts-count tnum">{qCount}</span>}
      </button>

      {sourceText && !pasteMode ? (
        <>
          <button type="button" className="milky-row mb-3" onClick={() => setShowSource((v) => !v)}>
            <Icon name="text" />
            <span className="flex-1 text-start font-bold text-[14.5px]">הטקסט המלא</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showSource ? 'rotate(180deg)' : 'none', transition: '.2s' }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showSource && (
            <div className="card mb-3">
              <div className="whitespace-pre-line text-[14.5px] leading-relaxed">{sourceText}</div>
              {fetchedSources.length > 0 && (
                <div className="text-[12px] text-muted mt-3">
                  נמצא מהמקור: {fetchedSources.slice(0, 2).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="text-primary underline break-all">{new URL(u).hostname.replace('www.', '')}</a>
                  )).reduce((a, b) => [a, ' · ', b])}
                </div>
              )}
              <div className="flex gap-3 mt-3">
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={fetchSource} disabled={fetching}>{fetching ? 'מביא…' : <span className="inline-flex items-center gap-1"><Icon name="refresh" size={14} />הבא שוב מהרשת</span>}</button>
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={() => { setPasteVal(sourceText); setPasteMode(true) }}><span className="inline-flex items-center gap-1"><Icon name="pencil" size={14} />ערוך / החלף ידנית</span></button>
              </div>
            </div>
          )}
        </>
      ) : !(isLiterary || wantSource) ? (
        <button type="button" className="milky-row mb-3" onClick={() => setWantSource(true)}>
          <Icon name="text" />
          <span className="flex-1 text-start text-[13.5px] font-semibold">יש לנושא טקסט מקור (שיר / פסוקים)? הבא אותו</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      ) : (
        <div className="card mb-3">
          <div className="text-[14px] font-semibold mb-1 flex items-center gap-1.5"><Icon name="text" size={18} />הבא את הטקסט המלא ({srcKind})</div>
          <div className="text-muted text-[12.5px] mb-2 leading-relaxed">
            כתבו את שם {isBible ? 'הפרק/הפסוקים' : isLiterary ? 'השיר' : 'הטקסט'} — והמערכת תחפש ותביא אותו מהרשת ממקור אמין, עם קישור למקור.
          </div>
          <input className="field mb-2" value={ref} onChange={(e) => setRef(e.target.value)}
            placeholder={`שם ${isBible ? 'הפרק/הפסוקים' : isLiterary ? 'השיר' : 'הטקסט'} — ${name}`} />
          {!pasteMode && (
            <button className="btn btn-primary btn-wide" onClick={fetchSource} disabled={fetching}>
              {fetching ? 'מחפש ומביא מהרשת…' : <><Icon name="download" size={18} />הבא טקסט מלא מהרשת</>}
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
                    {s.label} <Icon name="link" size={13} />
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
                      {busy ? 'שומר…' : <><Icon name="save" size={18} />שמור טקסט מדויק</>}
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn btn-wide" onClick={() => setPasteMode(true)}><Icon name="paste" size={18} />הדבק טקסט מהמקור</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* הסיכום — "דף" בהיר ונוח לקריאה */}
      <div className="paper">
        {summary ? (
          <div style={busy ? { opacity: 0.4, transition: 'opacity .3s' } : undefined}><Markdown text={summary} examBox /></div>
        ) : (
          <div className="text-center py-6">
            <div className="flex justify-center mb-2" style={{ color: '#5E7A00' }}><Icon name="book" size={36} /></div>
            <div className="font-disp font-extrabold text-[17px]">עדיין אין סיכום לנושא הזה</div>
            <div className="text-[14px] mt-1" style={{ color: '#3E3E45' }}>לחצו למטה כדי שהמערכת תכין אחד מסודר.</div>
          </div>
        )}

        {err && <div className="text-[13.5px] mt-3 font-semibold" style={{ color: '#B8501C' }}>{err}</div>}

        {busy && (
          <div className="flex items-start gap-2.5 mt-4 p-3 rounded-[14px] text-[13.5px] font-semibold" style={{ background: 'rgba(94,122,0,.1)', color: '#3E4E00' }}>
            <span className="up-spin mt-0.5" style={{ borderColor: 'rgba(94,122,0,.25)', borderTopColor: '#5E7A00' }} />
            <span>מכין סיכום חדש מכל החומרים… זה לוקח בערך חצי דקה עד דקה. הסיכום הנוכחי יתחלף כשזה יסתיים.</span>
          </div>
        )}
        <div className="paper-actions">
          <button type="button" className="paper-btn" onClick={generate} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
            {busy ? 'מכין…' : aggSource ? 'אחד סיכום מהחומרים' : summary ? 'סכם מחדש' : 'צור סיכום'}
          </button>
          {aggSource && (
            <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer" style={{ color: '#3E3E45' }}>
              <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="w-[18px] h-[18px]" style={{ accentColor: '#5E7A00' }} />
              להשלים גם מהידע הכללי
            </label>
          )}
        </div>
        {aggSource && <div className="text-[12px] mt-2" style={{ color: '#6B6B72' }}>"אחד סיכום" קורא את כל מה שהעלית לנושא ובונה סיכום אחד מעודכן.</div>}
      </div>

      {/* סיכומים שהוספתי (מהצ'אט) — קבועים, לא נמחקים ב"סכם מחדש" */}
      {notes.length > 0 && (
        <>
          <div className="home-h2 mt-6 mb-2.5"><h2>סיכומים שהוספתי</h2><span>{notes.length}</span></div>
          {notes.map((n) => (
            <div key={n.id} className="paper mb-3">
              <div className="flex items-start gap-2 mb-1">
                <div className="flex-1 font-disp font-extrabold text-[16px] flex items-center gap-1.5"><Icon name="note" size={18} />{n.title || 'סיכום'}</div>
                <button type="button" onClick={() => deleteNote(n.id)} title="הסר סיכום" aria-label="הסר סיכום"
                  className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ color: '#B8501C', border: '1.5px solid rgba(184,80,28,.35)' }}>הסר</button>
              </div>
              <Markdown text={n.summary_md} />
            </div>
          ))}
        </>
      )}

    </div>
  )
}
