import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Markdown from '../components/Markdown'
import TopicSummary from './TopicSummary'
import { supabase } from '../lib/supabase'
import { stripNotebookWarnings } from '../lib/gemini'
import { useG } from '../lib/gender'

// מחברת הסיכומים: מסך אחד לכל הסיכומים של המקצוע.
// לשונית "כל המחברת" — תוכן עניינים + כל הסיכומים ברצף (לקריאה ולהדפסה);
// לשונית לכל נושא — הסיכום שלו, תרגול, ו"כלים לנושא". params.topicId פותח ישר בלשונית של הנושא.
export default function Summaries({ nav, params }) {
  const g = useG()
  const { subjectId, subjectName } = params
  const [items, setItems] = useState([])   // [{ id, name, in_exam, summary }]
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(params.topicId || 'all')

  async function load() {
    const [{ data: tp }, { data: mats }] = await Promise.all([
      supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId).order('created_at'),
      supabase.from('materials').select('topic_id, kind, summary_md, created_at').eq('subject_id', subjectId)
        .order('created_at', { ascending: false }),
    ])
    // אותו כלל כמו בלשונית הנושא: סיכום מאוחד אם יש, אחרת כל סיכומי הדפים לפי סדר ההעלאה
    const list = (tp || []).map((t) => {
      const own = (mats || []).filter((m) => m.topic_id === t.id && m.summary_md)
      const merged = own.find((m) => m.kind === 'summary')
      const pageSums = [...new Set(own.filter((m) => !['summary', 'note', 'style', 'check'].includes(m.kind)).reverse().map((m) => m.summary_md))]
      return { ...t, summary: merged ? stripNotebookWarnings(merged.summary_md) : pageSums.join('\n\n---\n\n') || null }
    })
    // נושאי המיקוד ראשונים
    list.sort((a, b) => (b.in_exam ? 1 : 0) - (a.in_exam ? 1 : 0))
    setItems(list)
    setLoading(false)
  }
  useEffect(() => { load() }, [subjectId])

  // מעבר ללשונית: למעלה, והלשונית הפעילה נגללת לתוך השורה
  function open(id) {
    setTab(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => document.getElementById(`nb-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }), 50)
  }
  useEffect(() => {
    if (params.topicId) setTimeout(() => document.getElementById(`nb-tab-${params.topicId}`)?.scrollIntoView({ block: 'nearest', inline: 'center' }), 100)
  }, [])

  if (loading) return <div className="text-muted pt-4">טוען…</div>
  const current = items.find((t) => t.id === tab)

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3 no-print">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] tracking-tight no-print">סיכומים</h1>

      {items.length === 0 ? (
        <div className="milky-row text-muted text-sm mt-4">עדיין אין נושאים — {g('העלה', 'העלי')} חומר כדי שייווצרו סיכומים.</div>
      ) : (
        <>
          {/* לשוניות: כל המחברת + נושא לכל לשונית */}
          <div className="nb-tabs no-print" role="tablist" aria-label="נושאי המחברת">
            <button id="nb-tab-all" role="tab" aria-selected={tab === 'all'} className="nb-tab" onClick={() => open('all')}>כל המחברת</button>
            {items.map((t, i) => (
              <button key={t.id} id={`nb-tab-${t.id}`} role="tab" aria-selected={tab === t.id} className="nb-tab" onClick={() => open(t.id)}>
                <span className="opacity-60 me-1 tnum">{i + 1}</span>{t.name}
                {t.in_exam && <span className="nb-dot" aria-label="במיקוד" />}
              </button>
            ))}
          </div>

          {tab === 'all' || !current ? (
            <>
              {/* תוכן עניינים — לחיצה עוברת ללשונית של הנושא */}
              <div className="milky-row !flex-col !items-stretch !gap-0 mb-3 no-print">
                <div className="text-[12.5px] font-bold text-muted mb-1">תוכן עניינים</div>
                {items.map((t, i) => (
                  <button key={t.id} type="button" onClick={() => open(t.id)}
                    className="flex items-center gap-2.5 text-start py-2.5 text-[14.5px] font-semibold" style={i ? { borderTop: '1px solid rgba(255,255,255,.07)' } : undefined}>
                    <span className="tnum text-muted w-5 flex-none">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate">{t.name}</span>
                    {t.in_exam && <span className="tp-badge flex-none" style={{ background: 'var(--primary)' }}>במיקוד</span>}
                    {!t.summary && <span className="text-[12px] text-muted flex-none">אין סיכום</span>}
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>

              {items.some((t) => t.summary) && (
                <button type="button" className="milky-row mb-5 no-print" onClick={() => window.print()}>
                  <Icon name="file" />
                  <span className="flex-1 text-start font-bold text-[14.5px]">הדפסת המחברת</span>
                  <span className="text-[12px] text-muted">או שמירה כ-PDF</span>
                </button>
              )}

              {/* כל הסיכומים ברצף; בתחתית כל דף — כפתור אחד לנושא (תרגול וכלים) */}
              <div className="print-area">
                <div className="hidden print:block font-disp font-extrabold text-[22px] mb-3">סיכומים · {subjectName}</div>
                {items.map((t, i) => (
                  <section key={t.id} className={`mb-6 ${t.summary ? '' : 'no-print'}`}>
                    <h2 className="font-disp font-extrabold text-[19px] leading-tight mb-2.5 flex gap-2">
                      <span className="text-muted tnum">{i + 1}.</span><span>{t.name}</span>
                    </h2>
                    <div className="paper">
                      {t.summary ? <Markdown text={t.summary} examBox /> : (
                        <div className="text-[14px]" style={{ color: '#3E3E45' }}>עדיין אין סיכום לנושא הזה.</div>
                      )}
                      <button type="button" className="nb-go no-print" onClick={() => open(t.id)}>
                        <span>לנושא — תרגול וכלים</span><Icon name="chevron" size={17} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <TopicSummary key={current.id} nav={nav} onChanged={load}
              params={{ subjectId, subjectName, topicId: current.id, topicName: current.name }} />
          )}
        </>
      )}
    </div>
  )
}
