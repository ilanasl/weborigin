import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { useAuth } from '../context/AuthContext'

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
        supabase.from('subjects').select('*').order('created_at'),
        supabase.from('topics').select('id, subject_id, name'),
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
        const pcts = topicsNow.map((t) => t.m.pct).filter((p) => p != null)
        const ready = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
        const strong = topicsNow.filter((t) => t.m.pct != null && t.m.pct >= 75)
        const weak = topicsNow.filter((t) => t.m.pct != null && t.m.pct < 50).sort((a, b) => a.m.pct - b.m.pct)
        const exams = [
          { kind: 'מבחן מסכם', days: daysUntil(s.exam_date) },
          { kind: 'מבדק', days: daysUntil(s.quiz_date) },
        ].filter((e) => e.days != null && e.days >= 0).sort((a, b) => a.days - b.days)
        const reviewCount = (ri || []).filter((r) => r.subject_id === s.id).length
        const weekN = weekAtt.filter((a) => a.subject_id === s.id).length

        // סדרת מוכנות לאורך זמן
        const series = checkpoints.map((T) => {
          const vals = sTopics.map((t) => {
            const past = t.att.filter((a) => a.ts <= T).map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: a.ts }))
            return mastery(past, T).pct
          }).filter((p) => p != null)
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
        })
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
      const subjColor = Object.fromEntries((subs || []).map((s) => [s.id, s.color]))
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
    <div className="rc-chips">
      {(arr.length ? arr : [{ id: '_', name: '—' }]).map((t) => (
        <span key={t.id} className={`rc-chip ${kind}`}>● {t.name}{t.m?.pct != null ? ` ${t.m.pct}%` : ''}</span>
      ))}
    </div>
  )

  const fmtDay = (day) => {
    const d = new Date(day), t = new Date().toDateString(), y = new Date(Date.now() - DAY).toDateString()
    if (day === t) return 'היום'
    if (day === y) return 'אתמול'
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">דוח הורה 👨‍👩‍👦</h1>
      <div className="text-muted text-[13.5px] mb-4">התקדמות של {name} · {today}</div>

      {/* אריחי-על */}
      <div className="card">
        <div className="flex gap-3">
          {[
            { v: `${data.streak} 🔥`, l: 'רצף ימים' },
            { v: data.activeSubjects, l: 'מקצועות פעילים' },
            { v: data.weekTotal, l: 'שאלות השבוע' },
          ].map((t, i) => (
            <div key={i} className="flex-1 text-center rounded-[14px] py-3" style={{ background: 'var(--bg)' }}>
              <div className="font-disp font-black text-[24px] text-primary tnum">{t.v}</div>
              <div className="text-[12px] text-muted mt-0.5">{t.l}</div>
            </div>
          ))}
        </div>
        {data.weekPct != null && (
          <div className="text-center text-[13px] text-muted mt-3">אחוז הצלחה השבוע: <b className="tnum" style={{ color: 'var(--good)' }}>{data.weekPct}%</b></div>
        )}
      </div>

      {/* פעילות אחרונה */}
      {data.feed.length > 0 && (
        <>
          <div className="list-title">פעילות אחרונה</div>
          <div className="card">
            {data.feed.map((g, i) => (
              <div key={i} className="flex items-center gap-2.5 py-2 border-b border-line last:border-0">
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: g.color }} />
                <div className="flex-1 min-w-0 text-[14px]">
                  <b>{g.name}</b> — תרגל {g.n} שאלות · {g.ok} נכון
                </div>
                <div className="text-[12px] text-muted flex-none">{fmtDay(g.day)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* גרף התקדמות לאורך זמן */}
      {data.chartSubjects.length > 0 && (
        <>
          <div className="list-title">מוכנות לאורך זמן</div>
          <div className="card">
            <ProgressChart subjects={data.chartSubjects} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 justify-center">
              {data.chartSubjects.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

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
          <line x1={padL} x2={W - padR} y1={ys(g)} y2={ys(g)} stroke="var(--line)" strokeWidth="1" />
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
              <polyline key={k} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                points={seg.map((p) => p.join(',')).join(' ')} />
            ))}
            {last && <circle cx={last[0]} cy={last[1]} r="3.5" fill={s.color} />}
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
