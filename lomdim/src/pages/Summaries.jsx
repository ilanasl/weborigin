import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Markdown from '../components/Markdown'
import { supabase } from '../lib/supabase'
import { stripNotebookWarnings } from '../lib/gemini'
import { examTag } from '../lib/plan'
import { consolidateTopic, needsConsolidation, autoTried, readOff } from '../lib/consolidate'
import { useAuth } from '../context/AuthContext'
import WorkNote, { useWorking } from '../components/WorkNote'

// חוברת סיכומים: כל סיכומי המקצוע במסך אחד, עם תוכן עניינים — לקריאה רצופה לפני מבחן
export default function Summaries({ nav, params }) {
  const { subjectId, subjectName } = params
  const [items, setItems] = useState([])   // [{ id, name, in_exam, summary }]
  const [loading, setLoading] = useState(true)
  const [openSrc, setOpenSrc] = useState({})   // אילו "טקסט מלא" פתוחים
  const [subj, setSubj] = useState(null)       // לתגית "למבדק/למבחן הקרוב"
  const [merging, setMerging] = useState({})   // נושאים שמתאחדים עכשיו לסיכום אחד
  const { profile } = useAuth()
  useWorking(Object.values(merging).some(Boolean))

  useEffect(() => {
    (async () => {
      const [{ data: tp }, { data: mats }, { data: sj }] = await Promise.all([
        supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId).order('created_at'),
        supabase.from('materials').select('topic_id, kind, summary_md, source_text, created_at').eq('subject_id', subjectId)
          .order('created_at', { ascending: false }),
        supabase.from('subjects').select('id, exam_date, quiz_date').eq('id', subjectId).maybeSingle(),
      ])
      setSubj(sj || null)
      // אותו כלל כמו במסך הנושא: סיכום מאוחד אם יש, אחרת הסיכום העדכני מהדפים
      const list = (tp || []).map((t) => {
        const own = (mats || []).filter((m) => m.topic_id === t.id && m.summary_md)
        // הטקסט המלא (שיר / פסוקים) — אם נשמר לנושא, מוצג כמו במסך הנושא
        const source = (mats || []).find((m) => m.topic_id === t.id && m.source_text)?.source_text || null
        const merged = own.find((m) => m.kind === 'summary')
        // בלי סיכום מאוחד — כל סיכומי הדפים לפי סדר ההעלאה (לא רק האחרון)
        const pageSums = [...new Set(own.filter((m) => m.kind !== 'summary' && m.kind !== 'note' && m.kind !== 'style').reverse().map((m) => m.summary_md))]
        return { ...t, source, needMerge: needsConsolidation(own), offs: readOff(merged?.summary_md).pending.map((o) => o.name), summary: merged ? stripNotebookWarnings(merged.summary_md) : pageSums.join('\n\n---\n\n') || null }
      })
      // נושאי המיקוד ראשונים
      list.sort((a, b) => (b.in_exam ? 1 : 0) - (a.in_exam ? 1 : 0))
      setItems(list)
      setLoading(false)
      // נושא עם כמה דפים בלי סיכום מאוחד — מאחדים ברקע, אחד אחרי השני (במקום סיכומי דפים ברצף עם חזרות)
      for (const t of list.filter((x) => x.needMerge && !autoTried.has(x.id))) {
        autoTried.add(t.id)
        setMerging((m) => ({ ...m, [t.id]: true }))
        try {
          if (await consolidateTopic({ subjectId, subjectName, topicId: t.id, topicName: t.name, learner: profile })) {
            const { data: sm } = await supabase.from('materials').select('summary_md').eq('topic_id', t.id).eq('kind', 'summary').limit(1)
            const md = sm?.[0]?.summary_md
            if (md) setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, summary: stripNotebookWarnings(md), offs: readOff(md).pending.map((o) => o.name) } : x)))
          }
        } catch { /* נשאר הסיכום מהדפים */ }
        setMerging((m) => ({ ...m, [t.id]: false }))
      }
    })()
  }, [subjectId])

  const jump = (id) => document.getElementById(`sm-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // הדפסה של נושא אחד בלבד (שאר החוברת מוסתרת בזמן ההדפסה)
  const printOne = (id) => {
    document.body.classList.add('print-one')
    document.getElementById(`sm-${id}`)?.classList.add('print-this')
    const done = () => {
      document.body.classList.remove('print-one')
      document.querySelectorAll('.print-this').forEach((el) => el.classList.remove('print-this'))
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
  }
  const openTopic = (t) => nav.go('topicSummary', { subjectId, subjectName, topicId: t.id, topicName: t.name })

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] tracking-tight">חוברת סיכומים</h1>
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">כל הסיכומים של המקצוע, אחד אחרי השני. נוח לקריאה לפני מבחן.</div>
      {items.some((t) => t.summary) && (
        <button type="button" className="milky-row mb-4" onClick={() => window.print()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" /></svg>
          <span className="flex-1 text-start font-bold text-[14.5px]">הדפסת החוברת</span>
          <span className="text-[12px] text-muted">או שמירה כ-PDF</span>
        </button>
      )}

      {items.length === 0 ? (
        <div className="milky-row text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שייווצרו סיכומים.</div>
      ) : (
        <>
          {/* תוכן עניינים */}
          <div className="milky-row !flex-col !items-stretch !gap-1.5 mb-5">
            <div className="text-[12.5px] font-bold text-muted mb-0.5">תוכן עניינים</div>
            {items.map((t, i) => (
              <button key={t.id} type="button" onClick={() => jump(t.id)}
                className="flex items-center gap-2.5 text-start py-1.5 text-[14.5px] font-semibold">
                <span className="tnum text-muted w-5 flex-none">{i + 1}.</span>
                <span className="flex-1 min-w-0 truncate">{t.name}</span>
                {t.in_exam && <span className="tp-badge flex-none" style={{ background: 'var(--primary)' }}>{examTag(subj)}</span>}
                {!t.summary && <span className="text-[12px] text-muted flex-none">אין סיכום</span>}
              </button>
            ))}
          </div>

          <div className="print-area">
          <div className="hidden print:block print-book-title font-disp font-extrabold text-[22px] mb-3">חוברת סיכומים · {subjectName}</div>
          {items.map((t, i) => (
            <section key={t.id} id={`sm-${t.id}`} className={`mb-6 ${t.summary ? '' : 'no-print'}`} style={{ scrollMarginTop: 90 }}>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="font-disp font-extrabold text-[15px] text-muted tnum">{i + 1}.</span>
                {/* כותרת הנושא — מובילה למסך הסיכום הרגיל של הנושא */}
                <button type="button" onClick={() => openTopic(t)} className="flex-1 text-start flex items-center gap-1.5">
                  <h2 className="font-disp font-extrabold text-[20px] leading-tight">{t.name}</h2>
                  <span className="no-print"><Icon name="chevron" size={18} /></span>
                </button>
              </div>
              {t.source && (
                <>
                  <button type="button" className="milky-row mb-3 no-print" onClick={() => setOpenSrc((s) => ({ ...s, [t.id]: !s[t.id] }))} aria-expanded={!!openSrc[t.id]}>
                    <Icon name="text" />
                    <span className="flex-1 text-start font-bold text-[14.5px]">הטקסט המלא</span>
                    <Icon name="down" size={18} style={{ transform: openSrc[t.id] ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
                  </button>
                  {openSrc[t.id] && (
                    <div className="card mb-3 no-print"><div className="whitespace-pre-line text-[14.5px] leading-relaxed">{t.source}</div></div>
                  )}
                </>
              )}
              <div className="paper">
                {merging[t.id] && <WorkNote light className="mb-3 no-print" text="מאחד את כל הדפים של הנושא לסיכום אחד, בלי חזרות… כחצי דקה." />}
                {t.offs?.length > 0 && (
                  <button type="button" onClick={() => openTopic(t)} className="w-full text-start mb-3 p-3 rounded-[14px] text-[13px] font-semibold no-print"
                    style={{ background: 'rgba(184,80,28,.08)', color: '#8A3A12' }}>
                    בדפים של הנושא יש גם חומר על {t.offs.map((n) => `«${n}»`).join(', ')} — להעביר אותו לנושא משלו ←
                  </button>
                )}
                {t.summary ? <div style={merging[t.id] ? { opacity: 0.4 } : undefined}><Markdown text={t.summary} examBox /></div> : (
                  <div className="text-[14px]" style={{ color: '#3E3E45' }}>עדיין אין סיכום לנושא הזה.</div>
                )}
                <div className="flex flex-wrap gap-2 mt-4 no-print">
                  <button type="button" className="paper-btn"
                    onClick={() => nav.go('practice', { subjectId, subjectName, topicId: t.id, topicName: t.name, mode: 'practice' })}>
                    <Icon name="target" size={17} />לתרגול הנושא
                  </button>
                  {t.summary && (
                    <button type="button" className="paper-btn" onClick={() => printOne(t.id)}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" /></svg>
                      הדפסה
                    </button>
                  )}
                  {!t.summary && (
                    <button type="button" className="paper-btn" onClick={() => openTopic(t)}>
                      <Icon name="book" size={17} />ליצירת סיכום
                    </button>
                  )}
                </div>
              </div>
            </section>
          ))}
          </div>

          <button type="button" className="btn btn-wide mb-4" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ חזרה לתוכן העניינים
          </button>
        </>
      )}
    </div>
  )
}
