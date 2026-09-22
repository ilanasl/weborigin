import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { useAuth } from '../context/AuthContext'

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null
const WEEK = 7 * 86400000

export default function ParentReport({ nav }) {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: subs }, { data: tp }, { data: at }, { data: ri }] = await Promise.all([
        supabase.from('subjects').select('*').order('created_at'),
        supabase.from('topics').select('id, subject_id, name'),
        supabase.from('attempts').select('subject_id, topic_id, correct, difficulty, created_at'),
        supabase.from('review_items').select('subject_id'),
      ])
      const now = Date.now()
      const weekAtt = (at || []).filter((a) => now - new Date(a.created_at).getTime() <= WEEK)
      const weekCorrect = weekAtt.filter((a) => a.correct).length

      const subjects = (subs || []).map((s) => {
        const topics = (tp || []).filter((t) => t.subject_id === s.id).map((t) => {
          const att = (at || []).filter((a) => a.topic_id === t.id)
            .map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() }))
          return { ...t, m: mastery(att) }
        })
        const pcts = topics.map((t) => t.m.pct).filter((p) => p != null)
        const ready = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
        const strong = topics.filter((t) => t.m.pct != null && t.m.pct >= 75)
        const weak = topics.filter((t) => t.m.pct != null && t.m.pct < 50)
          .sort((a, b) => a.m.pct - b.m.pct)
        const exams = [
          { kind: 'מבחן מסכם', days: daysUntil(s.exam_date) },
          { kind: 'מבדק', days: daysUntil(s.quiz_date) },
        ].filter((e) => e.days != null && e.days >= 0).sort((a, b) => a.days - b.days)
        const reviewCount = (ri || []).filter((r) => r.subject_id === s.id).length
        const weekN = weekAtt.filter((a) => a.subject_id === s.id).length
        return { ...s, topics, ready, strong, weak, exams, reviewCount, weekN }
      })

      setData({
        subjects,
        weekTotal: weekAtt.length,
        weekPct: weekAtt.length ? Math.round(weekCorrect / weekAtt.length * 100) : null,
        activeSubjects: subjects.filter((s) => s.weekN > 0).length,
      })
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="text-muted pt-4">מכין דוח…</div>
  const name = profile?.name || 'הילד/ה'
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  const Chips = ({ arr, kind }) => (
    <div className="rc-chips">
      {(arr.length ? arr : [{ id: '_', name: '—' }]).map((t) => (
        <span key={t.id} className={`rc-chip ${kind}`}>● {t.name}{t.m?.pct != null ? ` ${t.m.pct}%` : ''}</span>
      ))}
    </div>
  )

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">דוח הורה 👨‍👩‍👦</h1>
      <div className="text-muted text-[13.5px] mb-4">התקדמות של {name} · {today}</div>

      {/* סיכום השבוע */}
      <div className="ready-card">
        <div className="ready-lbl mb-2">מה קרה השבוע</div>
        <div className="flex gap-3">
          <div className="flex-1 text-center">
            <div className="font-disp font-black text-[26px] text-primary tnum">{data.weekTotal}</div>
            <div className="text-[12px] text-muted">שאלות תורגלו</div>
          </div>
          <div className="flex-1 text-center">
            <div className="font-disp font-black text-[26px] tnum" style={{ color: 'var(--good)' }}>{data.weekPct == null ? '—' : data.weekPct + '%'}</div>
            <div className="text-[12px] text-muted">אחוז הצלחה</div>
          </div>
          <div className="flex-1 text-center">
            <div className="font-disp font-black text-[26px] tnum">{data.activeSubjects}</div>
            <div className="text-[12px] text-muted">מקצועות פעילים</div>
          </div>
        </div>
        {data.weekTotal === 0 && (
          <div className="collecting mt-3">השבוע עדיין לא תורגל — כדאי לעודד כמה תרגולים כדי שהדוח יתמלא.</div>
        )}
      </div>

      {/* לפי מקצוע */}
      <div className="list-title">לפי מקצוע</div>
      {data.subjects.length === 0 ? (
        <div className="card text-muted text-sm">עדיין אין מקצועות.</div>
      ) : data.subjects.map((s) => (
        <div key={s.id} className="card mb-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-[11px] grid place-items-center font-black flex-none"
              style={{ background: s.bg, color: s.color }}>{s.name.charAt(0)}</div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-[16px]">{s.name}</div>
              <div className="text-[12px] text-muted">
                {s.exams.length
                  ? s.exams.map((e) => `${e.kind} ${e.days === 0 ? 'היום' : `בעוד ${e.days} י׳`}`).join(' · ')
                  : 'אין מבחן מתוכנן'}
              </div>
            </div>
            <div className="text-end">
              <div className="font-disp font-black text-[20px] tnum" style={{ color: 'var(--primary)' }}>{s.ready == null ? '—' : s.ready + '%'}</div>
              <div className="text-[11px] text-muted">מוכנות</div>
            </div>
          </div>

          {s.ready == null ? (
            <div className="collecting">עדיין אוספים נתונים — צריך עוד כמה תרגולים.</div>
          ) : (
            <>
              <div className="rc-group"><div className="rc-h">שולט</div><Chips arr={s.strong} kind="good" /></div>
              <div className="rc-group"><div className="rc-h">כדאי לחזק</div><Chips arr={s.weak} kind="weak" /></div>
            </>
          )}

          <div className="text-[13px] text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>תורגלו השבוע: <b className="text-ink tnum">{s.weekN}</b></span>
            <span>ממתין ב״לחיזוק״: <b className="text-ink tnum">{s.reviewCount}</b></span>
          </div>

          {/* המלצה קצרה */}
          {s.weak.length > 0 && (
            <div className="text-[13px] mt-2 rounded-[10px] p-2.5 leading-relaxed"
              style={{ background: 'var(--accent-soft)', color: 'color-mix(in srgb,var(--accent) 80%,#7a4b00)' }}>
              💡 כדאי להתמקד ב: <b>{s.weak.slice(0, 2).map((t) => t.name).join(', ')}</b>
              {s.exams.length ? ` — לקראת ה${s.exams[0].kind}.` : '.'}
            </div>
          )}
        </div>
      ))}

      <div className="text-[12px] text-muted text-center mt-4 leading-relaxed">
        הדוח מבוסס על נתוני התרגול במערכת. אחוזי המוכנות מחושבים לפי הצלחות אחרונות, קושי ותיקון ניחוש.
      </div>
    </div>
  )
}
