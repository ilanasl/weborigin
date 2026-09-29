import { useEffect, useState } from 'react'
import { withTone } from '../lib/tone'
import { supabase } from '../lib/supabase'
import { mastery, examReadiness } from '../lib/mastery'
import { LEAD_DEFAULT } from '../lib/plan'
import Icon from '../components/Icon'

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
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
      supabase.from('subjects').select('*').order('created_at').then((r) => ({ ...r, data: (r.data || []).map(withTone) })),
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

  // מבחנים קרובים — לכל מקצוע עד שניים (מבחן מסכם + מבדק), בעתיד או היום
  const exams = subjects
    .flatMap((s) => [
      { s, kind: 'מבחן מסכם', date: s.exam_date },
      { s, kind: 'מבדק', date: s.quiz_date },
    ])
    .map((e) => ({ ...e, off: offsetOf(e.date) }))
    .filter((e) => e.date && e.off >= 0)
    .sort((a, b) => a.off - b.off)

  const noDate = subjects.filter((s) => !s.exam_date && !s.quiz_date)

  // בניית לו"ז משולב: כל מבחן מחלק את הנושאים החלשים שלו על חלון הלמידה שלו
  const dayMap = {} // offset -> [entry]
  const add = (off, entry) => { (dayMap[off] ||= []).push(entry) }

  for (const e of exams) {
    const s = e.s
    const kind = e.kind
    const lead = LEAD_DEFAULT[kind] || 8
    const base = { subjectId: s.id, subjectName: s.name, color: s.bg, bg: s.bg, kind }
    // יום המבחן + יום חזרה לפני
    add(e.off, { ...base, exam: true })
    if (e.off >= 2) add(e.off - 1, { ...base, review: true })
    // אם זוהו נושאים במבחן (מהמיקוד) — מתמקדים בהם; אחרת בכל הנושאים. חלשים קודם.
    const all = (topicsBySubj[s.id] || []).map((t) => ({ ...t, m: mastery(byTopicSubj[t.id] || []) }))
    const inExam = all.filter((t) => t.in_exam)
    const ordered = (inExam.length ? inExam : all).sort((a, b) => (a.m.pct ?? 50) - (b.m.pct ?? 50))
    const startIn = Math.max(1, e.off - lead)
    const studyOffsets = []
    for (let d = startIn; d <= e.off - 2; d++) studyOffsets.push(d)
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

  const soon = exams.filter((e) => e.off <= 14).length
  const readyOf = (s) => examReadiness((topicsBySubj[s.id] || []).map((t) => ({ in_exam: t.in_exam, pct: mastery(byTopicSubj[t.id] || []).pct }))).pct
  const Arrow = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 17L7 7M7 7h9M7 7v9" /></svg>

  return (
    <div className="pt-1 flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-medium text-muted">
          {exams.length === 0 ? 'עוד לא הוגדרו מבחנים' : soon ? `${soon} ${soon === 1 ? 'מבחן' : 'מבחנים'} בשבועיים הקרובים` : 'אין מבחנים בשבועיים הקרובים'}
        </div>
        <h1 className="font-black text-[32px] leading-[1.05] mt-1">לוח המבחנים</h1>
      </div>

      {/* המבחנים הקרובים — כרטיס בצבע המקצוע */}
      {exams.length === 0 ? (
        <div className="milky-row !flex-col !items-center text-center !py-6 gap-2">
          <Icon name="calendar" size={34} />
          <div className="text-[14px]">עדיין לא הוגדרו תאריכי מבחנים.<br />כנסו למקצוע ← מתכנן המבחן כדי להוסיף תאריך.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {exams.map((e) => {
            const r = readyOf(e.s)
            return (
              <div key={e.s.id + e.kind} className="exam-card" style={{ background: e.s.bg }}
                onClick={() => nav.go('planner', { subjectId: e.s.id, subjectName: e.s.name })}>
                <button type="button" className="arrow-btn sm" style={{ color: e.s.color }} aria-label={`למתכנן של ${e.s.name}`}
                  onClick={(ev) => { ev.stopPropagation(); nav.go('planner', { subjectId: e.s.id, subjectName: e.s.name }) }}><Arrow /></button>
                <span className="exam-days">
                  {e.off === 0 ? <b className="!text-[24px]">היום</b> : e.off === 1 ? <b className="!text-[26px]">מחר</b> : <><b className="tnum">{e.off}</b><small>ימים</small></>}
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="font-disp font-extrabold text-[17px] leading-tight">{e.kind === 'מבדק' ? 'מבדק' : 'מבחן'} · {e.s.name}</span>
                  <span className="text-[12.5px] font-semibold" style={{ color: 'rgba(19,19,22,.72)' }}>
                    {new Date(e.date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}{r != null ? ` · מוכנות ${r}%` : ''}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* הלו"ז המשולב */}
      {offsets.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="home-h2 mb-0.5"><h2>הלו״ז המשולב</h2><span>כל המקצועות יחד</span></div>
          {offsets.map((off) => {
            const dt = addDays(off)
            const entries = dayMap[off]
            const nTopics = entries.reduce((a, e) => a + (e.topics?.length || 0), 0)
            return (
              <div key={off} className="milky-row !flex-col !items-stretch !gap-2.5" style={off === 0 ? { borderColor: 'color-mix(in srgb, var(--primary) 55%, transparent)' } : undefined}>
                <div className="flex items-center justify-between">
                  <span className="font-disp font-extrabold text-[15.5px]">
                    {off === 0 ? 'היום' : off === 1 ? 'מחר' : `יום ${DOW[dt.getDay()]}`} · {dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
                  </span>
                  {nTopics > 0 && <span className="text-[12.5px] text-muted">{nTopics} {nTopics === 1 ? 'נושא' : 'נושאים'}</span>}
                </div>
                {entries.map((e, i) => (
                  e.exam ? (
                    <div key={i} className="flex items-center gap-2.5 rounded-[14px] px-3 py-2 font-bold text-[14px]" style={{ background: e.color, color: 'var(--on-fill)' }}>
                      <Icon name="flag" size={18} />{e.kind} ב{e.subjectName} — בהצלחה!
                    </div>
                  ) : e.review ? (
                    <button key={i} type="button" className="flex items-center gap-2.5 text-start text-[14px] font-semibold"
                      onClick={() => nav.go('reinforce', { subjectId: e.subjectId, subjectName: e.subjectName })}>
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: e.color }} />
                      <span className="flex-1">חזרה כללית ב{e.subjectName}</span>
                      <Icon name="chevron" size={16} style={{ opacity: 0.5 }} />
                    </button>
                  ) : e.noMaterial ? (
                    <button key={i} type="button" className="flex items-center gap-2.5 text-start text-[13.5px] text-muted"
                      onClick={() => nav.go('subject', { id: e.subjectId })}>
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: e.color }} />
                      <span className="flex-1">{e.subjectName}: העלו חומר כדי לקבל תוכנית</span>
                      <Icon name="chevron" size={16} style={{ opacity: 0.5 }} />
                    </button>
                  ) : e.topics.map((t) => (
                    <button key={`${i}-${t.id}`} type="button" className="flex items-center gap-2.5 text-start text-[14px]"
                      onClick={() => nav.go('topicSummary', { subjectId: e.subjectId, subjectName: e.subjectName, topicId: t.id, topicName: t.name })}>
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: e.color }} />
                      <span className="flex-1 min-w-0"><b className="font-bold">{e.subjectName}</b> — {t.name}</span>
                      <Icon name="chevron" size={16} style={{ opacity: 0.5 }} />
                    </button>
                  ))
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* מקצועות ללא תאריך */}
      {noDate.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="home-h2 mb-0.5"><h2>בלי תאריך מבחן עדיין</h2></div>
          {noDate.map((s) => (
            <button key={s.id} type="button" className="milky-row" onClick={() => nav.go('planner', { subjectId: s.id, subjectName: s.name })}>
              <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: s.bg }} />
              <span className="flex-1 min-w-0 text-start text-[14.5px] font-semibold truncate">{s.name}</span>
              <span className="text-primary text-[13px] font-bold inline-flex items-center gap-1"><Icon name="plus" size={15} stroke={2.6} />הוסף תאריך</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
