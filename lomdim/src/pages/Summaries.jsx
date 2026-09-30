import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Markdown from '../components/Markdown'
import { supabase } from '../lib/supabase'
import { stripNotebookWarnings } from '../lib/gemini'

// חוברת סיכומים: כל סיכומי המקצוע במסך אחד, עם תוכן עניינים — לקריאה רצופה לפני מבחן
export default function Summaries({ nav, params }) {
  const { subjectId, subjectName } = params
  const [items, setItems] = useState([])   // [{ id, name, in_exam, summary }]
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: tp }, { data: mats }] = await Promise.all([
        supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId).order('created_at'),
        supabase.from('materials').select('topic_id, kind, summary_md, created_at').eq('subject_id', subjectId)
          .order('created_at', { ascending: false }),
      ])
      // אותו כלל כמו במסך הנושא: סיכום מאוחד אם יש, אחרת הסיכום העדכני מהדפים
      const list = (tp || []).map((t) => {
        const own = (mats || []).filter((m) => m.topic_id === t.id && m.summary_md)
        const merged = own.find((m) => m.kind === 'summary')
        const page = own.find((m) => m.kind !== 'summary' && m.kind !== 'note')
        return { ...t, summary: merged ? stripNotebookWarnings(merged.summary_md) : page?.summary_md || null }
      })
      // נושאי המיקוד ראשונים
      list.sort((a, b) => (b.in_exam ? 1 : 0) - (a.in_exam ? 1 : 0))
      setItems(list)
      setLoading(false)
    })()
  }, [subjectId])

  const jump = (id) => document.getElementById(`sm-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const openTopic = (t) => nav.go('topicSummary', { subjectId, subjectName, topicId: t.id, topicName: t.name })

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] tracking-tight">חוברת סיכומים</h1>
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">כל הסיכומים של המקצוע, אחד אחרי השני. נוח לקריאה לפני מבחן.</div>

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
                {t.in_exam && <span className="tp-badge flex-none" style={{ background: 'var(--primary)' }}>במיקוד</span>}
                {!t.summary && <span className="text-[12px] text-muted flex-none">אין סיכום</span>}
              </button>
            ))}
          </div>

          {items.map((t, i) => (
            <section key={t.id} id={`sm-${t.id}`} className="mb-6" style={{ scrollMarginTop: 90 }}>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="font-disp font-extrabold text-[15px] text-muted tnum">{i + 1}.</span>
                <h2 className="font-disp font-extrabold text-[20px] leading-tight flex-1">{t.name}</h2>
              </div>
              <div className="paper">
                {t.summary ? <Markdown text={t.summary} examBox /> : (
                  <div className="text-[14px]" style={{ color: '#3E3E45' }}>עדיין אין סיכום לנושא הזה.</div>
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  <button type="button" className="paper-btn"
                    onClick={() => nav.go('practice', { subjectId, subjectName, topicId: t.id, topicName: t.name, mode: 'practice' })}>
                    <Icon name="target" size={17} />לתרגול הנושא
                  </button>
                  <button type="button" className="paper-btn" onClick={() => openTopic(t)}>
                    <Icon name="book" size={17} />{t.summary ? 'למסך הנושא' : 'ליצירת סיכום'}
                  </button>
                </div>
              </div>
            </section>
          ))}

          <button type="button" className="btn btn-wide mb-4" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ חזרה לתוכן העניינים
          </button>
        </>
      )}
    </div>
  )
}
