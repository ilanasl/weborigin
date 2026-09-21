import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'

export default function PracticePicker({ nav, params }) {
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
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">על מה נתרגל?</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      {recommended && (
        <button onClick={() => start(recommended.id, recommended.name)}
          className="card w-full text-start mb-3 border-primary/40 hover:-translate-y-[2px] transition"
          style={{ borderColor: 'color-mix(in srgb, var(--primary) 45%, var(--line))' }}>
          <span className="inline-block text-[11.5px] font-bold text-white bg-primary rounded-full px-2.5 py-[3px] mb-2">מומלץ ✨</span>
          <div className="font-disp font-bold text-[17px]">הנושאים שקצת פחות חזקים</div>
          <div className="text-muted text-[13.5px] mt-1">{recommended.name} · {recommended.m.pct}%</div>
        </button>
      )}

      <button onClick={() => start(null, null)}
        className="card w-full text-start mb-3 hover:-translate-y-[2px] transition">
        <div className="font-disp font-bold text-[17px]">🔀 כל החומר, מעורבב</div>
        <div className="text-muted text-[13.5px] mt-1">שאלות מכל הנושאים יחד — טוב לחזרה כללית לפני מבחן.</div>
      </button>

      <div className="list-title">או בחר נושא לבד</div>
      <div className="card">
        {withQ.length === 0 ? (
          <div className="text-muted text-sm">עדיין אין שאלות — העלו חומר כדי שהמערכת תייצר שאלות.</div>
        ) : withQ.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-3 border-b border-line last:border-0">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px]">{t.name}</div>
              {t.m.pct == null ? (
                <div className="collecting mt-1.5">עדיין אוספים נתונים…</div>
              ) : (
                <div className="bar-row mt-1.5" style={{ maxWidth: 220 }}>
                  <div className="bar"><i style={{ width: `${t.m.pct}%` }} /></div>
                  <span className="pct tnum" style={{ color: 'var(--muted)' }}>{t.m.pct}%</span>
                </div>
              )}
            </div>
            <button className="btn" onClick={() => start(t.id, t.name)}>תרגל</button>
          </div>
        ))}
      </div>
    </div>
  )
}
