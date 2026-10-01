import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { mastery, examReadiness } from '../lib/mastery'
import { expirePastExams, daysUntil, dailyTarget } from '../lib/plan'
import { coinBalance, DAILY_GOAL } from '../lib/coins'
import { useAuth } from '../context/AuthContext'
import { TONES, withTone } from '../lib/tone'

const PALETTE = TONES

// כמה שאלות היום + רצף ימים שבהם הושלם היעד (כמו בחישוב המטבעות)
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }
function dayStats(att) {
  const per = {}
  for (const a of att) { const k = dayKey(a.created_at); per[k] = (per[k] || 0) + 1 }
  const d = new Date()
  const n = per[dayKey(d)] || 0
  if (n < DAILY_GOAL) d.setDate(d.getDate() - 1) // היום עוד לא הושלם — הרצף נספר עד אתמול
  let streak = 0
  while ((per[dayKey(d)] || 0) >= DAILY_GOAL) { streak++; d.setDate(d.getDate() - 1) }
  const next = streak < 3 ? 3 : streak < 7 ? 7 : (Math.floor(streak / 7) + 1) * 7
  return { n, streak, toBonus: next - streak }
}


export default function Home({ nav }) {
  const { profile } = useAuth()
  const [subjects, setSubjects] = useState([])
  const [coins, setCoins] = useState(null)
  const [today, setToday] = useState({ n: 0, streak: 0 })
  const [loading, setLoading] = useState(true)
  const [todayBusy, setTodayBusy] = useState(false)

  async function load() {
    setLoading(true)
    // מבחן/מבדק שעבר — מתאפס (תאריך + מיקוד) לפני שמחשבים מוכנות ונושאים
    const { data: subs0 } = await supabase.from('subjects').select('*').order('created_at')
    const subs = await expirePastExams(subs0 || [])
    const [{ data: att }, { data: tp }, { data: mt }, bal] = await Promise.all([
      supabase.from('attempts').select('topic_id, subject_id, correct, difficulty, created_at'),
      supabase.from('topics').select('id, subject_id, in_exam'),
      supabase.from('materials').select('id, subject_id, storage_path, content_hash'),
      coinBalance(),
    ])
    setCoins(bal)
    setToday(dayStats(att || []))
    const list = (subs || []).map(withTone).map((s) => {
      const byTopic = {}
      for (const a of att || []) {
        if (a.subject_id !== s.id || !a.topic_id) continue
        ;(byTopic[a.topic_id] ||= []).push({
          correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
        })
      }
      const exams = [
        { kind: 'מבחן מסכם', days: daysUntil(s.exam_date) },
        { kind: 'מבדק', days: daysUntil(s.quiz_date) },
      ].filter((x) => x.days != null && x.days >= 0).sort((a, b) => a.days - b.days)
      return {
        ...s,
        // מוכנות למבחן: נושאי המבחן (או כולם), נושא שלא תורגל = 0
        ready: examReadiness((tp || []).filter((t) => t.subject_id === s.id)
          .map((t) => ({ in_exam: t.in_exam, pct: mastery(byTopic[t.id] || []).pct }))).pct,
        nTopics: (tp || []).filter((t) => t.subject_id === s.id).length,
        // דף שמשויך לכמה נושאים נספר פעם אחת
        nMaterials: new Set((mt || [])
          .filter((m) => m.subject_id === s.id && (m.storage_path || m.content_hash))
          .map((m) => m.storage_path || (m.content_hash || '').split(':')[0] || m.id)).size,
        exams,
        examDays: exams[0]?.days ?? null,
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
  const focus = upcoming || subjects[0]
  const name = profile?.name ? ` ${profile.name}` : ''
  const ready = profile?.gender === 'בת' ? 'מוכנה' : profile?.gender === 'בן' ? 'מוכן' : 'מוכנים'
  const done = today.n >= DAILY_GOAL
  // משימת היום: הנושא של היום בתוכנית למבחן; אחרי זה — המקצוע שתורגל הכי מעט והנושא החלש בו
  const startToday = async () => {
    if (todayBusy) return
    setTodayBusy(true)
    try {
      const tg = await dailyTarget()
      const dest = tg || (focus ? { subjectId: focus.id, subjectName: focus.name } : null)
      if (dest) nav.go('practice', { ...dest, mode: 'practice' })
    } finally { setTodayBusy(false) }
  }
  const cardMeta = (s) => {
    const ex = s.exams[0]
    if (ex && ex.days <= 14) return ex.days === 0 ? `${ex.kind} היום` : `${ex.kind} בעוד ${ex.days} ימים`
    // מספר החומרים (צילומים) לא אומר הרבה — מציגים רק כמה נושאים יש
    return s.nTopics ? `${s.nTopics} ${s.nTopics === 1 ? 'נושא' : 'נושאים'}` : 'עוד אין חומר'
  }

  return (
    <div className="home">
      <div className="home-top">
        <div>
          <div className="home-hi">היי{name}</div>
          <h1 className="home-title">{ready} לסבב<br />של היום?</h1>
        </div>
        {coins != null && (
          <button type="button" className="coin-pill" onClick={() => nav.go('store')} aria-label={`המטבעות שלי: ${coins}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></svg>
            <span className="tnum">{coins}</span>
          </button>
        )}
      </div>

      {!profile && (
        <button className="streak-line mb-3" onClick={() => nav.go('settings')}><Icon name="user" size={16} />מי מתרגל? הגדירו שם ומין ›</button>
      )}

      <div className="hero-grid">
        {/* כל הכרטיס לחיץ (כל עוד היעד לא הושלם) */}
        <div className={`hero hero-a${done ? '' : ' cursor-pointer'}`} role={done ? undefined : 'button'} tabIndex={done ? undefined : 0}
          aria-label={done ? undefined : 'להמשיך את משימת היום'} onClick={done ? undefined : startToday}
          onKeyDown={done ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') startToday() }}
          style={todayBusy ? { opacity: 0.75 } : undefined}>
          {done ? (
            <span className="arrow-btn" style={{ color: '#5E7A00' }} role="img" aria-label="משימת היום הושלמה">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
          ) : (
            <span className="arrow-btn" style={{ color: '#5E7A00' }} aria-hidden="true"><ArrowIcon /></span>
          )}
          <div className="hero-num tnum">{Math.min(today.n, DAILY_GOAL)}<span>/{DAILY_GOAL}</span></div>
          <div className="hero-lbl">{done ? '✓ היעד של היום הושלם' : 'שאלות היום'}</div>
          <div className="hero-foot"><div className="hero-track"><i style={{ width: `${Math.min(100, today.n / DAILY_GOAL * 100)}%` }} /></div></div>
        </div>
        <div className="hero hero-b">
          <button type="button" className="arrow-btn" style={{ color: '#5A43D1' }} onClick={() => nav.go('store')} aria-label="למטבעות ולפרסים"><ArrowIcon /></button>
          
          <div className="hero-numrow">
            <FlameIcon />
            <div className="hero-num tnum">{today.streak}</div>
          </div>
          <div className="hero-lbl">ימים ברצף</div>
          <div className="hero-foot hero-sub">{today.toBonus === 1 ? 'עוד יום אחד לבונוס' : `עוד ${today.toBonus} ימים לבונוס`}</div>
        </div>
      </div>

      {upcoming && (
        <button type="button" className="milky-row" onClick={() => nav.go('planner', { subjectId: upcoming.id, subjectName: upcoming.name })}>
          <span className="day-box" style={{ background: upcoming.bg }}>
            <b className="tnum">{upcoming.examDays}</b><small>{upcoming.examDays === 1 ? 'יום' : 'ימים'}</small>
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
            <span className="font-bold text-[15px] truncate">{upcoming.exams[0].kind} ב{upcoming.name}</span>
            <span className="text-[13px] text-muted">{upcoming.examDays === 0 ? 'היום! בהצלחה 🍀' : upcoming.ready == null ? 'מוכנות: עוד לא תורגל' : `מוכנות ${upcoming.ready}%`}</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      )}

      <div className="home-h2">
        <h2>המקצועות שלי</h2>
        <span>{subjects.length} מקצועות</span>
      </div>

      {loading ? (
        <div className="text-muted">טוען…</div>
      ) : (
        <div className="subj-grid">
          {subjects.map((s) => (
            <div key={s.id} className="subj-card" style={{ background: s.bg }} onClick={() => nav.go('subject', { id: s.id })}>
              <button type="button" className="arrow-btn sm" style={{ color: s.color }} aria-label={`לפתוח את ${s.name}`}
                onClick={(e) => { e.stopPropagation(); nav.go('subject', { id: s.id }) }}><ArrowIcon size={17} /></button>
              <div>
                <div className="subj-name">{s.name}</div>
                <div className="subj-meta">{cardMeta(s)}</div>
              </div>
              {s.ready == null ? (
                <div className="subj-meta">עוד לא תורגל</div>
              ) : (
                <div className="subj-bar">
                  <div className="hero-track"><i style={{ width: `${s.ready}%` }} /></div>
                  <b className="tnum">{s.ready}%</b>
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={addSubject} className="subj-add">
            <span className="text-[26px] leading-none font-black">+</span>
            <span className="text-[14px] font-bold">הוסף מקצוע</span>
          </button>
        </div>
      )}

      <button type="button" className="milky-row mt-5" onClick={() => nav.go('examBoard')}>
        <Icon name="calendar" /><span className="flex-1 text-start font-semibold text-[15px]">לוח המבחנים והלו״ז</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className="milky-row -mt-1" onClick={() => nav.go('parent')}>
        <Icon name="users" /><span className="flex-1 text-start font-semibold text-[15px]">אזור הורה</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
    </div>
  )
}

function ArrowIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 17L7 7M7 7h9M7 7v9" />
    </svg>
  )
}

// להבה מלאה ונועזת: גוף כהה עם לשון פנימית בצבע הכרטיס
function FlameIcon() {
  return (
    <svg className="hero-flame" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 1.5c.6 3.6 3.2 5.6 5 7.8A8 8 0 0 1 12 22.5a8 8 0 0 1-6.6-12.4c.5 2 1.7 3.2 3.1 3.6C8.2 9.3 9.5 5 12 1.5z" />
      <path fill="#B7A5FF" d="M12 12.6c1.8 1.5 3.1 3 3.1 4.9a3.1 3.1 0 0 1-6.2 0c0-1.5.9-2.7 1.8-3.4.1 1 .6 1.7 1.2 2-.3-1.3-.2-2.5.1-3.5z" />
    </svg>
  )
}
