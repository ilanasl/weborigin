import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const LEAD_DEFAULT = { 'מבדק': 4, 'מבחן מסכם': 8 }
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const offsetOf = (dateStr) => Math.ceil((new Date(dateStr) - startOfToday()) / 86400000)
const addDays = (d) => { const dt = startOfToday(); dt.setDate(dt.getDate() + d); return dt }

export default function ExamBoard({ nav }) {
  const [subjects, setSubjects] = useState([])
  const [byTopicSubj, setByTopicSubj] = useState({})
  const [topicsBySubj, setTopicsBySubj] = useState({})
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: subs }, { data: tp }, { data: at }] = await Promise.all([
      supabase.from('subjects').select('*').order('created_at'),
      supabase.from('topics').select('*'),
      supabase.from('attempts').select('subject_id, topic_id, correct, difficulty, created_at'),
    ])
    const byTS = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTS[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
    }
    const tBy = {}
    for (const t of tp || []) (tBy[t.subject_id] ||= []).push(t)
    setSubjects(subs || []); setByTopicSubj(byTS); setTopicsBySubj(tBy)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  // מבחנים קרובים (יש תאריך, בעתיד או היום)
  const exams = subjects
    .map((s) => ({ ...s, off: offsetOf(s.exam_date) }))
    .filter((s) => s.exam_date && s.off >= 0)
    .sort((a, b) => a.off - b.off)

  const noDate = subjects.filter((s) => !s.exam_date)

  // בניית לו"ז משולב: כל מבחן מחלק את הנושאים החלשים שלו על חלון הלמידה שלו
  const dayMap = {} // offset -> [entry]
  const add = (off, entry) => { (dayMap[off] ||= []).push(entry) }

  for (const s of exams) {
    const kind = s.exam_kind || 'מבחן מסכם'
    const lead = LEAD_DEFAULT[kind] || 8
    const base = { subjectId: s.id, subjectName: s.name, color: s.color, bg: s.bg, kind }
    // יום המבחן + יום חזרה לפני
    add(s.off, { ...base, exam: true })
    if (s.off >= 2) add(s.off - 1, { ...base, review: true })
    // נושאים חלשים קודם
    const topics = (topicsBySubj[s.id] || []).map((t) => ({ ...t, m: mastery(byTopicSubj[t.id] || []) }))
    const ordered = topics.sort((a, b) => (a.m.pct ?? 50) - (b.m.pct ?? 50))
    const startIn = Math.max(1, s.off - lead)
    const studyOffsets = []
    for (let d = startIn; d <= s.off - 2; d++) studyOffsets.push(d)
    if (ordered.length === 0) {
      if (studyOffsets.length) add(studyOffsets[0], { ...base, noMaterial: true })
      continue
    }
    const n = studyOffsets.length
    const perDay = n > 0 ? Math.max(1, Math.ceil(ordered.length / n)) : 0
    let ti = 0
    studyOffsets.forEach((d, idx) => {
      const day = []
      for (let k = 0; k < perDay && ti < ordered.length; k++) day.push(ordered[ti++])
      if (day.length === 0) day.push(ordered[idx % ordered.length])
      add(d, { ...base, topics: day })
    })
  }

  const offsets = Object.keys(dayMap).map(Number).sort((a, b) => a - b)

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">לוח המבחנים</h1>
      <div className="text-muted text-[13.5px] mb-4">כל המבחנים והלו״ז המשולב</div>

      {/* רשימת המבחנים הקרובים */}
      {exams.length === 0 ? (
        <div className="card empty">
          <div className="big">🗓️</div>
          עדיין לא הוגדרו תאריכי מבחנים.<br />
          כנסו למקצוע → 📅 מתכנן המבחן כדי להוסיף תאריך.
        </div>
      ) : (
        <div className="card mb-3">
          {exams.map((s) => (
            <button key={s.id} onClick={() => nav.go('planner', { subjectId: s.id, subjectName: s.name })}
              className="flex items-center gap-3 w-full text-start py-2.5 border-b border-line last:border-0">
              <div className="w-9 h-9 rounded-[11px] grid place-items-center font-black flex-none"
                style={{ background: s.bg, color: s.color }}>{s.name.charAt(0)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-semibold truncate">{s.name}</div>
                <div className="text-[12px] text-muted">
                  {s.exam_kind || 'מבחן'} · {new Date(s.exam_date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
              </div>
              <span className={`exam-chip ${s.off > 7 ? 'calm' : ''}`}>
                {s.off === 0 ? 'היום' : s.off === 1 ? 'מחר' : `בעוד ${s.off} ימים`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* הלו"ז המשולב */}
      {offsets.length > 0 && (
        <>
          <div className="list-title">הלו״ז המשולב</div>
          <div className="card">
            {offsets.map((off) => {
              const dt = addDays(off)
              const entries = dayMap[off]
              return (
                <div key={off} className="flex gap-3 py-3 border-b border-line last:border-0">
                  <div className="w-[54px] flex-none text-center">
                    <div className="font-disp font-bold text-[13px]">{off === 0 ? 'היום' : off === 1 ? 'מחר' : DOW[dt.getDay()]}</div>
                    <div className="text-[11px] text-muted">{dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    {entries.map((e, i) => (
                      <div key={i}>
                        {e.exam ? (
                          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-bad bg-bad-soft rounded-[9px] px-2.5 py-1">
                            📝 {e.kind} ב{e.subjectName}!
                          </span>
                        ) : e.review ? (
                          <div className="text-[14px] font-semibold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: e.color }} />
                            🔁 חזרה כללית ב{e.subjectName}
                          </div>
                        ) : e.noMaterial ? (
                          <button className="text-start text-[13.5px] flex items-center gap-1.5 text-muted"
                            onClick={() => nav.go('subject', { id: e.subjectId })}>
                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: e.color }} />
                            {e.subjectName}: העלו חומר כדי לקבל תוכנית ›
                          </button>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <div className="text-[12px] font-bold" style={{ color: e.color }}>{e.subjectName}</div>
                            {e.topics.map((t) => (
                              <button key={t.id} className="text-start text-[14px] font-medium flex items-center gap-2"
                                onClick={() => nav.go('topicSummary', { subjectId: e.subjectId, subjectName: e.subjectName, topicId: t.id, topicName: t.name })}>
                                <span className="w-2 h-2 rounded-full flex-none" style={{ background: e.color }} />
                                {t.name} <span className="text-muted text-[12px]">קרא ותרגל ›</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* מקצועות ללא תאריך */}
      {noDate.length > 0 && (
        <>
          <div className="list-title">בלי תאריך מבחן עדיין</div>
          <div className="card">
            {noDate.map((s) => (
              <button key={s.id} onClick={() => nav.go('planner', { subjectId: s.id, subjectName: s.name })}
                className="flex items-center gap-3 w-full text-start py-2.5 border-b border-line last:border-0">
                <div className="flex-1 min-w-0 text-[14.5px] font-semibold truncate">{s.name}</div>
                <span className="text-primary text-[13px] font-bold">➕ הוסף תאריך ›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
