import { useEffect, useState } from 'react'
import { useG } from '../lib/gender'
import { supabase } from '../lib/supabase'
import Icon from '../components/Icon'
import { mastery, level, LEVEL_LABEL } from '../lib/mastery'

const LEVEL_COLOR = { strong: 'var(--good)', mid: 'var(--primary)', weak: 'var(--accent)' }

export default function PracticePicker({ nav, params }) {
  const g = useG()
  const { subjectId, subjectName, mode } = params
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: tp }, { data: at }, { data: qs }] = await Promise.all([
        supabase.from('topics').select('*').eq('subject_id', subjectId).order('created_at'),
        supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', subjectId),
        supabase.from('questions').select('topic_id').eq('subject_id', subjectId),
      ])
      const byTopic = {}
      for (const a of at || []) {
        if (!a.topic_id) continue
        ;(byTopic[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
      }
      const qCount = {}
      for (const q of qs || []) if (q.topic_id) qCount[q.topic_id] = (qCount[q.topic_id] || 0) + 1
      setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []), n: qCount[t.id] || 0 })))
      setLoading(false)
    })()
  }, [subjectId])

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  const withQ = topics.filter((t) => t.n > 0)
  // המלצה: הנושא החלש ביותר שיש בו נתונים; אם אין — הראשון עם שאלות
  const scored = withQ.filter((t) => t.m.pct != null).sort((a, b) => a.m.pct - b.m.pct)
  const recommended = scored[0] || null

  const start = (topicId, topicName) =>
    nav.go('practice', { subjectId, subjectName, mode, topicId, topicName })

  return (
    <div className="pt-1">
      <h1 className="font-black text-[30px] leading-[1.1]">על מה נתרגל?</h1>
      <div className="text-muted text-[13.5px] mt-1.5 mb-4">{subjectName}</div>

      <div className="flex flex-col gap-2">
        {recommended && (
          <button type="button" onClick={() => start(recommended.id, recommended.name)} className="milky-row !items-start"
            style={{ borderColor: 'color-mix(in srgb, var(--primary) 45%, var(--milky-line))' }}>
            <span className="up-thumb" style={{ background: 'var(--primary)', color: 'var(--on-fill)' }}><Icon name="target" size={20} /></span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
              <span className="tp-badge self-start" style={{ background: 'var(--primary)' }}>מומלץ</span>
              <span className="font-disp font-bold text-[16.5px] mt-1">הנושא שקצת פחות חזק</span>
              <span className="text-muted text-[13px]">{recommended.name} · <span className="tnum">{recommended.m.pct}%</span></span>
            </span>
          </button>
        )}

        <button type="button" onClick={() => start(null, null)} className="milky-row !items-start">
          <span className="up-thumb"><Icon name="shuffle" size={20} /></span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
            <span className="font-disp font-bold text-[16.5px]">כל החומר, מעורבב</span>
            <span className="text-muted text-[13px]">שאלות מכל הנושאים יחד — טוב לחזרה כללית לפני מבחן.</span>
          </span>
        </button>
      </div>

      <div className="home-h2 mt-6 mb-2.5"><h2>{g('או בחר נושא לבד', 'או בחרי נושא לבד')}</h2></div>
      <div className="flex flex-col gap-2">
        {withQ.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין שאלות — העלו חומר כדי שהמערכת תייצר שאלות.</div>
        ) : withQ.map((t) => (
          <div key={t.id} className="milky-row topic-row">
            <div className="topic-main">
              <span className="font-bold text-[15.5px]">{t.name}</span>
              {t.m.pct == null ? (
                <span className="text-[12.5px] text-muted">עוד לא תורגל{t.m.n ? ` · ${t.m.n} מתוך 5 תשובות` : ''}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${t.m.pct}%`, background: LEVEL_COLOR[level(t.m.pct)] }} />
                  </span>
                  <span className="text-[12px] font-bold" style={{ color: LEVEL_COLOR[level(t.m.pct)] }}>{LEVEL_LABEL[level(t.m.pct)]}</span>
                  <span className="font-disp font-bold text-[13px] tnum" dir="ltr">{t.m.pct}%</span>
                </span>
              )}
            </div>
            <button type="button" className="topic-go" aria-label={`לתרגל את ${t.name}`} onClick={() => start(t.id, t.name)}>
              <Icon name="target" size={22} />
              <span>תרגול</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
