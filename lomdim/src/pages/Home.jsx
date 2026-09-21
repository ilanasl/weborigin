import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readiness } from '../lib/mastery'
import { useAuth } from '../context/AuthContext'

// פלטת פסטלים רכים לאריחי המקצועות
const PALETTE = [
  { bg: '#EFE6DE', color: '#B15A2B' },
  { bg: '#E4E8F3', color: '#4A55C7' },
  { bg: '#E4EDDF', color: '#3F8F63' },
  { bg: '#EAE4F1', color: '#6D4BB0' },
  { bg: '#E7EEF0', color: '#3B7C88' },
  { bg: '#F1E7E9', color: '#B0506A' },
]

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null

export default function Home({ nav }) {
  const { profile } = useAuth()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: subs }, { data: att }, { data: tp }, { data: mt }] = await Promise.all([
      supabase.from('subjects').select('*').order('created_at'),
      supabase.from('attempts').select('topic_id, subject_id, correct, difficulty, created_at'),
      supabase.from('topics').select('id, subject_id'),
      supabase.from('materials').select('id, subject_id'),
    ])
    const list = (subs || []).map((s) => {
      const byTopic = {}
      for (const a of att || []) {
        if (a.subject_id !== s.id || !a.topic_id) continue
        ;(byTopic[a.topic_id] ||= []).push({
          correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
        })
      }
      return {
        ...s,
        ready: readiness(Object.values(byTopic)),
        nTopics: (tp || []).filter((t) => t.subject_id === s.id).length,
        nMaterials: (mt || []).filter((m) => m.subject_id === s.id).length,
        examDays: daysUntil(s.exam_date),
      }
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

  const upcoming = subjects
    .filter((s) => s.examDays != null && s.examDays >= 0)
    .sort((a, b) => a.examDays - b.examDays)[0]

  return (
    <div>
      <div className="hello mt-1.5 mb-5">
        <div className="eyebrow">שלום{profile?.name ? ` ${profile.name}` : ''} 👋</div>
        <h1 className="font-black">
          {profile?.gender === 'בת' ? 'מוכנה ללמוד?' : profile?.gender === 'בן' ? 'מוכן ללמוד?' : 'מוכנים ללמוד?'}
        </h1>
        {upcoming && (
          <div className="sub">
            הכי קרוב: <b>{upcoming.name}</b> — {upcoming.examDays === 0 ? 'היום' : `בעוד ${upcoming.examDays} ימים`}.
          </div>
        )}
        {!profile && (
          <button className="streak-line mt-3" onClick={() => nav.go('settings')}>
            👤 מי מתרגל? הגדירו שם ומין ›
          </button>
        )}
      </div>

      <div className="section-title">
        <h2>המקצועות שלי</h2>
        <span>לחצו כדי להיכנס</span>
      </div>

      {loading ? (
        <div className="text-muted">טוען…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-[440px]:grid-cols-1">
          {subjects.map((s) => (
            <button key={s.id} className="subject-card" style={{ background: s.bg }}
              onClick={() => nav.go('subject', { id: s.id })}>
              <h3>{s.name}</h3>
              <div className="meta">{s.nTopics} נושאים · {s.nMaterials} חומרים</div>
              {s.examDays != null && s.examDays >= 0 && (
                <div className="card-chips">
                  <span className={`exam-chip ${s.examDays > 7 ? 'calm' : ''}`}>
                    {s.examDays === 0 ? 'מבחן היום' : `מבחן בעוד ${s.examDays} ימים`}
                  </span>
                </div>
              )}
              <div className="tile-sp" />
              {s.ready == null ? (
                <div className="collecting">אוספים נתונים…</div>
              ) : (
                <div className="bar-row">
                  <div className="bar"><i style={{ width: `${s.ready}%` }} /></div>
                  <span className="pct tnum">{s.ready}%</span>
                </div>
              )}
            </button>
          ))}
          <button onClick={addSubject}
            className="rounded-[22px] p-[17px] min-h-[132px] flex flex-col items-center justify-center gap-1 border-2 border-dashed border-line text-muted hover:border-primary hover:text-primary transition">
            <span className="text-[30px] leading-none font-black">+</span>
            <span className="text-[14px] font-bold">הוסף מקצוע</span>
          </button>
        </div>
      )}

      <div className="action-row mt-5">
        <button className="btn btn-wide" onClick={() => nav.go('examBoard')}>
          🗓️ לוח המבחנים והלו״ז
        </button>
        <button className="btn btn-wide" onClick={() => nav.go('soon', { title: 'דוח יומי להורה' })}>
          👨‍👩‍👦 דוח יומי להורה
        </button>
      </div>
    </div>
  )
}
