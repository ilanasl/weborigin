import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readiness } from '../lib/mastery'

// פלטת פסטלים רכים לאריחי המקצועות
const PALETTE = [
  { bg: '#EFE6DE', color: '#B15A2B' },
  { bg: '#E4E8F3', color: '#4A55C7' },
  { bg: '#E4EDDF', color: '#3F8F63' },
  { bg: '#EAE4F1', color: '#6D4BB0' },
  { bg: '#E7EEF0', color: '#3B7C88' },
  { bg: '#F1E7E9', color: '#B0506A' },
]

export default function Home({ nav }) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data: subs } = await supabase
      .from('subjects').select('*').order('created_at')
    // מוכנות לכל מקצוע: ממוצע שליטה על הנושאים לפי יומן התשובות
    const { data: att } = await supabase
      .from('attempts').select('topic_id, subject_id, correct, difficulty, created_at')
    const list = (subs || []).map((s) => {
      const byTopic = {}
      for (const a of att || []) {
        if (a.subject_id !== s.id || !a.topic_id) continue
        ;(byTopic[a.topic_id] ||= []).push({
          correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
        })
      }
      return { ...s, ready: readiness(Object.values(byTopic)) }
    })
    setSubjects(list)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addSubject() {
    const name = prompt('שם המקצוע:')
    if (!name) return
    const p = PALETTE[subjects.length % PALETTE.length]
    await supabase.from('subjects').insert({ name: name.trim(), bg: p.bg, color: p.color })
    load()
  }

  return (
    <div>
      <div className="pt-2 pb-5">
        <div className="text-[13px] text-muted font-semibold">שלום 👋</div>
        <h1 className="text-[clamp(30px,8vw,42px)] font-black mt-1">מוכנים ללמוד?</h1>
      </div>

      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[16px] font-extrabold">המקצועות שלי</h2>
        <button className="text-primary text-sm font-bold" onClick={addSubject}>+ הוסף מקצוע</button>
      </div>

      {loading ? (
        <div className="text-muted">טוען…</div>
      ) : subjects.length === 0 ? (
        <div className="card text-center text-muted py-8">
          עדיין אין מקצועות.<br />לחצו "הוסף מקצוע" כדי להתחיל.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-[440px]:grid-cols-1">
          {subjects.map((s) => (
            <button key={s.id} onClick={() => nav.go('subject', { id: s.id })}
              className="text-start rounded-xl3 p-[17px] shadow-soft min-h-[132px] flex flex-col gap-2 transition hover:-translate-y-[3px]"
              style={{ background: s.bg, color: '#1B1C1F' }}>
              <h3 className="text-[21px] font-black" style={{ color: '#1B1C1F' }}>{s.name}</h3>
              <div className="flex-1" />
              {s.ready == null ? (
                <div className="text-[12.5px] italic" style={{ color: 'rgba(20,20,25,.55)' }}>אוספים נתונים…</div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(20,20,25,.12)' }}>
                    <i className="block h-full rounded-full" style={{ width: `${s.ready}%`, background: '#1B1C1F' }} />
                  </div>
                  <span className="text-[12.5px] font-bold tnum" style={{ color: 'rgba(20,20,25,.6)' }}>{s.ready}%</span>
                </div>
              )}
            </button>
          ))}
          <button onClick={addSubject}
            className="rounded-xl3 p-[17px] min-h-[132px] flex flex-col items-center justify-center gap-1 border-2 border-dashed border-line text-muted hover:border-primary hover:text-primary transition">
            <span className="text-[30px] leading-none font-black">+</span>
            <span className="text-[14px] font-bold">הוסף מקצוע</span>
          </button>
        </div>
      )}
    </div>
  )
}
