import { useEffect, useState } from 'react'
import { withTone } from '../lib/tone'
import { supabase } from '../lib/supabase'
import { mastery, examReadiness, level } from '../lib/mastery'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'

const DAY = 86400000
const WEEK = 7 * DAY
const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / DAY) : null

// רצף ימי למידה — ימים רצופים (עד היום/אתמול) שבהם היה לפחות תרגול אחד
function calcStreak(tsList) {
  const days = new Set(tsList.map((t) => new Date(t).toDateString()))
  const d = new Date()
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1) // מתחילים מאתמול אם היום עוד לא תורגל
  let streak = 0
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1) }
  return streak
}

export default function ParentReport({ nav }) {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: subs }, { data: tp }, { data: at }, { data: ri }] = await Promise.all([
        supabase.from('subjects').select('*').order('created_at').then((r) => ({ ...r, data: (r.data || []).map(withTone) })),
        supabase.from('topics').select('id, subject_id, name, in_exam'),
        supabase.from('attempts').select('subject_id, topic_id, correct, difficulty, created_at'),
        supabase.from('review_items').select('subject_id'),
      ])
      const now = Date.now()
      const atts = (at || []).map((a) => ({ ...a, ts: new Date(a.created_at).getTime() }))
      const weekAtt = atts.filter((a) => now - a.ts <= WEEK)
      const weekCorrect = weekAtt.filter((a) => a.correct).length

      // נקודות זמן לגרף: לפני 4 שבועות → השבוע
      const checkpoints = [4, 3, 2, 1, 0].map((w) => now - w * WEEK)

      const subjects = (subs || []).map((s) => {
        const sTopics = (tp || []).filter((t) => t.subject_id === s.id).map((t) => ({
          ...t,
          att: atts.filter((a) => a.topic_id === t.id),
        }))
        const topicsNow = sTopics.map((t) => ({ ...t, m: mastery(t.att.map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: a.ts })), now) }))
        const ready = examReadiness(topicsNow.map((t) => ({ in_exam: t.in_exam, pct: t.m.pct }))).pct
        const strong = topicsNow.filter((t) => level(t.m.pct) === 'strong')
        const weak = topicsNow.filter((t) => level(t.m.pct) === 'weak').sort((a, b) => a.m.pct - b.m.pct)
        const exams = [
          { kind: 'מבחן מסכם', days: daysUntil(s.exam_date) },
          { kind: 'מבדק', days: daysUntil(s.quiz_date) },
        ].filter((e) => e.days != null && e.days >= 0).sort((a, b) => a.days - b.days)
        const reviewCount = (ri || []).filter((r) => r.subject_id === s.id).length
        const weekN = weekAtt.filter((a) => a.subject_id === s.id).length

        // סדרת מוכנות לאורך זמן
        const series = checkpoints.map((T) => examReadiness(sTopics.map((t) => ({
          in_exam: t.in_exam,
          pct: mastery(t.att.map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: a.ts })), T).pct,
        }))).pct)
        return { ...s, topicsNow, ready, strong, weak, exams, reviewCount, weekN, series }
      })

      // פיד פעילות — קיבוץ לפי יום+מקצוע, אחרונים קודם
      const groups = {}
      for (const a of atts) {
        const day = new Date(a.ts).toDateString()
        const key = day + '|' + a.subject_id
        ;(groups[key] ||= { day, ts: a.ts, subject_id: a.subject_id, n: 0, ok: 0 })
        groups[key].n++; if (a.correct) groups[key].ok++
        if (a.ts > groups[key].ts) groups[key].ts = a.ts
      }
      const subjName = Object.fromEntries((subs || []).map((s) => [s.id, s.name]))
      const subjColor = Object.fromEntries((subs || []).map((s) => [s.id, s.bg]))
      const feed = Object.values(groups).sort((a, b) => b.ts - a.ts).slice(0, 6)
        .map((g) => ({ ...g, name: subjName[g.subject_id], color: subjColor[g.subject_id] }))

      setData({
        subjects,
        streak: calcStreak(atts.map((a) => a.ts)),
        weekTotal: weekAtt.length,
        weekPct: weekAtt.length ? Math.round(weekCorrect / weekAtt.length * 100) : null,
        activeSubjects: subjects.filter((s) => s.weekN > 0).length,
        feed,
        chartSubjects: subjects.filter((s) => s.series.some((v) => v != null)),
      })
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="text-muted pt-4">מכין דוח…</div>
  const name = profile?.name || 'הילד/ה'
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  const Chips = ({ arr, kind }) => (
    <div className="flex flex-wrap gap-1.5">
      {arr.length ? arr.map((t) => (
        <span key={t.id} className={`pr-chip ${kind}`}>
          <Icon name={kind === 'good' ? 'check' : 'bulb'} size={14} stroke={2.6} />
          {t.name}{t.m?.pct != null ? <span className="tnum opacity-70"> {t.m.pct}%</span> : ''}
        </span>
      )) : <span className="text-[12.5px] text-muted">עוד אין</span>}
    </div>
  )

  const fmtDay = (day) => {
    const d = new Date(day), t = new Date().toDateString(), y = new Date(Date.now() - DAY).toDateString()
    if (day === t) return 'היום'
    if (day === y) return 'אתמול'
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="pt-1 flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-medium text-muted">התקדמות של {name} · {today}</div>
        <h1 className="font-black text-[32px] leading-[1.05] mt-1">דוח הורה</h1>
      </div>

      {/* אריחי-על */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: data.streak, l: 'ימי רצף', ic: 'flame', bg: '#D4F46A' },
          { v: data.weekTotal, l: 'שאלות השבוע', ic: 'pencil', bg: '#B7A5FF' },
          { v: data.weekPct == null ? '—' : `${data.weekPct}%`, l: 'הצלחה השבוע', ic: 'target', bg: '#7FDCCB' },
        ].map((t, i) => (
          <div key={i} className="pr-stat" style={{ background: t.bg }}>
            <Icon name={t.ic} size={20} />
            <div className="font-disp font-black text-[28px] leading-none tnum" dir="ltr" style={{ textAlign: 'right' }}>{t.v}</div>
            <div className="text-[12px] font-semibold" style={{ color: 'rgba(19,19,22,.72)' }}>{t.l}</div>
          </div>
        ))}
      </div>

      {/* פעילות אחרונה — שורה לכל יום+מקצוע, עם אחוז ההצלחה לצידה */}
      {data.feed.length > 0 && (
        <div>
          <div className="home-h2 mb-1"><h2>פעילות אחרונה</h2></div>
          <div className="text-[12.5px] text-muted mb-2.5">האחוז = כמה מהשאלות באותו יום באותו מקצוע נענו נכון</div>
          <div className="milky-row !flex-col !items-stretch !gap-0 !py-1">
            {data.feed.map((g, i) => {
              const pct = g.n ? Math.round((g.ok / g.n) * 100) : 0
              return (
                <div key={i} className="flex items-center gap-2.5 py-2.5" style={i ? { borderTop: '1px solid rgba(255,255,255,.08)' } : undefined}>
                  <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: g.color }} />
                  <div className="flex-1 min-w-0 text-[14px]"><b>{g.name}</b> — {g.n} שאלות · {g.ok} נכון</div>
                  <span className="font-disp font-extrabold text-[15px] tnum flex-none" dir="ltr">{pct}%</span>
                  <span className="text-[12px] text-muted flex-none w-[52px] text-end">{fmtDay(g.day)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* גרף התקדמות לאורך זמן */}
      {data.chartSubjects.length > 0 && (
        <div>
          <div className="home-h2 mb-2.5"><h2>מוכנות לאורך זמן</h2><span>5 שבועות</span></div>
          <div className="milky-row !flex-col !items-stretch">
            <ProgressChart subjects={data.chartSubjects} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
              {data.chartSubjects.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.chart }} />{s.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* לפי מקצוע */}
      <div className="flex flex-col gap-3">
        <div className="home-h2"><h2>לפי מקצוע</h2><span>{data.activeSubjects} פעילים השבוע</span></div>
        {data.subjects.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין מקצועות.</div>
        ) : data.subjects.map((s) => (
          <div key={s.id} className="pr-subj">
            <div className="pr-subj-head" style={{ background: s.bg }}>
              <div className="flex-1 min-w-0">
                <div className="font-disp font-extrabold text-[18px]">{s.name}</div>
                <div className="text-[12.5px] font-semibold" style={{ color: 'rgba(19,19,22,.72)' }}>
                  {s.exams.length
                    ? s.exams.map((e) => `${e.kind} ${e.days === 0 ? 'היום' : `בעוד ${e.days} ימים`}`).join(' · ')
                    : 'אין מבחן מתוכנן'}
                </div>
              </div>
              <div className="text-end">
                <div className="font-disp font-black text-[28px] leading-none tnum" dir="ltr">{s.ready == null ? '—' : `${s.ready}%`}</div>
                <div className="text-[11.5px] font-bold" style={{ color: 'rgba(19,19,22,.72)' }}>מוכנות</div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 p-3.5">
              {s.ready == null ? (
                <div className="text-[13px] text-muted">עוד לא תורגל — צריך עוד כמה תרגולים.</div>
              ) : (
                <>
                  <div><div className="text-[12.5px] font-bold text-muted mb-1">שולט</div><Chips arr={s.strong} kind="good" /></div>
                  <div><div className="text-[12.5px] font-bold text-muted mb-1">כדאי לחזק</div><Chips arr={s.weak} kind="weak" /></div>
                </>
              )}
              <div className="text-[13px] text-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>תורגלו השבוע: <b className="text-ink tnum">{s.weekN}</b></span>
                <span>ממתין ב״לחיזוק״: <b className="text-ink tnum">{s.reviewCount}</b></span>
              </div>
              {s.weak.length > 0 && (
                <div className="text-[13px] rounded-[14px] p-2.5 leading-relaxed flex gap-2" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Icon name="bulb" size={17} />
                  <span>כדאי להתמקד ב: <b>{s.weak.slice(0, 2).map((t) => t.name).join(', ')}</b>{s.exams.length ? ` — לקראת ה${s.exams[0].kind}.` : '.'}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="text-[12px] text-muted text-center leading-relaxed">
        הדוח מבוסס על נתוני התרגול. שליטה בנושא = אחוז התשובות הנכונות מתוך 20 האחרונות; מוכנות = ממוצע נושאי המבחן, כשנושא שלא תורגל נספר כ-0.
      </div>
    </div>
  )
}

// גרף קווי — מוכנות (0–100) על פני 5 נקודות זמן, קו לכל מקצוע בצבע שלו
function ProgressChart({ subjects }) {
  const W = 320, H = 150, padL = 26, padR = 10, padT = 10, padB = 22
  const N = 5
  const xs = (i) => padL + (i * (W - padL - padR)) / (N - 1)
  const ys = (v) => padT + (1 - v / 100) * (H - padT - padB)
  const xLabels = ['לפני 4 שב׳', 'לפני 3', 'שבועיים', 'שבוע', 'השבוע']
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="גרף מוכנות לאורך זמן">
      {/* קווי רשת עדינים */}
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={ys(g)} y2={ys(g)} stroke="rgba(255,255,255,.12)" strokeWidth="1" />
          <text x={padL - 5} y={ys(g) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{g}</text>
        </g>
      ))}
      {/* קו לכל מקצוע — מדלג על מקטעים בלי נתונים */}
      {subjects.map((s) => {
        const pts = s.series.map((v, i) => (v == null ? null : [xs(i), ys(v)]))
        const segs = []
        let cur = []
        for (const p of pts) { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = [] } }
        if (cur.length) segs.push(cur)
        const last = pts.filter(Boolean).slice(-1)[0]
        return (
          <g key={s.id}>
            {segs.map((seg, k) => (
              <polyline key={k} fill="none" stroke={s.chart} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                points={seg.map((p) => p.join(',')).join(' ')} />
            ))}
            {last && <circle cx={last[0]} cy={last[1]} r="3.5" fill={s.chart} />}
          </g>
        )
      })}
      {/* תוויות ציר X */}
      {xLabels.map((l, i) => (
        <text key={i} x={xs(i)} y={H - 6} textAnchor="middle" fontSize="8.5" fill="var(--muted)">{l}</text>
      ))}
    </svg>
  )
}
