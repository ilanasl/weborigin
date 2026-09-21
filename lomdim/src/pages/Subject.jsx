import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null

export default function Subject({ nav, params }) {
  const { id } = params
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [materials, setMaterials] = useState([])
  const [qCount, setQCount] = useState(0)
  const [fcCount, setFcCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: tp }, { data: mt }, { data: at }, { count: qc }, { count: fc }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', id).single(),
      supabase.from('topics').select('*').eq('subject_id', id).order('created_at'),
      supabase.from('materials').select('*').eq('subject_id', id).order('created_at', { ascending: false }),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', id),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('subject_id', id),
    ])
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({
        correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
      })
    }
    setSubject(s)
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    setMaterials(mt || [])
    setQCount(qc || 0); setFcCount(fc || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  if (loading || !subject) return <div className="text-muted pt-4">טוען…</div>

  const name = subject.name
  const examDays = daysUntil(subject.exam_date)
  const examKind = subject.exam_kind || 'מבחן'
  const summary = materials.find((m) => m.summary_md)

  const pcts = topics.map((t) => t.m.pct).filter((p) => p != null)
  const ready = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  const strong = topics.filter((t) => t.m.pct != null && t.m.pct >= 75)
  const weak = topics.filter((t) => t.m.pct != null && t.m.pct < 50)

  const goPractice = (mode) => nav.go('practice', { subjectId: id, subjectName: name, mode })

  const Chips = ({ arr, kind }) => (
    <div className="rc-chips">
      {(arr.length ? arr : [{ id: '_', name: '—' }]).map((t) => (
        <span key={t.id} className={`rc-chip ${kind}`}>● {t.name}</span>
      ))}
    </div>
  )

  return (
    <div>
      <div className="subj-head">
        <div className="avatar" style={{ background: subject.bg, color: subject.color }}>{name.charAt(0)}</div>
        <div>
          <h1>{name}</h1>
          <div className="meta">
            {topics.length} נושאים{examDays != null && examDays >= 0 ? ` · ${examKind} בעוד ${examDays} ימים` : ''}
          </div>
        </div>
      </div>

      {/* כרטיס מוכנות */}
      <div className="ready-card">
        <div className="ready-top">
          <div className="ready-lbl">מוכנות ל{examKind === 'מבדק' ? 'מבדק' : 'מבחן'}</div>
          <div className="ready-pct tnum">{ready == null ? '—' : ready + '%'}</div>
        </div>
        <div className="bar mt-3"><i style={{ width: `${ready || 0}%` }} /></div>
        {ready == null && <div className="collecting mt-2">עדיין אוספים נתונים — כמה תרגולים והמספר יופיע.</div>}
        {(strong.length > 0 || weak.length > 0) && (
          <>
            <div className="rc-group"><div className="rc-h">חזק בנושא</div><Chips arr={strong} kind="good" /></div>
            <div className="rc-group"><div className="rc-h">כדאי לתרגל</div><Chips arr={weak} kind="weak" /></div>
          </>
        )}
        <div className="action-row" style={{ margin: '16px 0 0' }}>
          <button className="btn btn-primary" disabled={qCount === 0}
            onClick={() => nav.go('practicePicker', { subjectId: id, subjectName: name, mode: 'practice' })}>🎯 תרגול</button>
          <button className="btn" disabled={qCount === 0} onClick={() => goPractice('exam')}>📝 {examKind === 'מבדק' ? 'מבדק' : 'מבחן'}</button>
        </div>
      </div>

      {/* מודולים */}
      <div className="action-row">
        {fcCount > 0 && (
          <button className="btn" onClick={() => nav.go('flashcards', { subjectId: id, subjectName: name })}>🃏 כרטיסיות</button>
        )}
        <button className="btn" onClick={() => nav.go('check', { subjectId: id, subjectName: name })}>📷 בדוק תרגיל שפתרתי</button>
        <button className="btn" onClick={() => nav.go('explain', { subjectId: id, subjectName: name, context: summary?.summary_md })}>💬 תסביר לי</button>
        <button className="btn" onClick={() => nav.go('soon', { title: 'לחיזוק' })}>📓 לחיזוק</button>
      </div>

      {/* נושאים */}
      <div className="list-title">הנושאים שלי</div>
      <div className="card">
        {topics.length === 0 ? (
          <div className="text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שהמערכת תזהה נושאים.</div>
        ) : topics.map((t) => (
          <button key={t.id} className="topic w-full text-start"
            onClick={() => nav.go('topicSummary', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name })}>
            <div className="info">
              <div className="nm">
                {t.name}
                {t.m.due && <span className="due">לחזרה היום</span>}
                {t.origin === 'חזרה' && <span className="scope-out">חזרה</span>}
              </div>
              {t.m.pct == null ? (
                <div className="collecting mt-1.5">אוספים נתונים…</div>
              ) : (
                <div className="bar-row mt-1.5" style={{ maxWidth: 220 }}>
                  <div className="bar"><i style={{ width: `${t.m.pct}%` }} /></div>
                  <span className="pct tnum" style={{ color: 'var(--muted)' }}>{t.m.pct}%</span>
                </div>
              )}
            </div>
            <span className="text-muted text-[13px]">📖 ›</span>
          </button>
        ))}
      </div>

      {/* חומרים — ציר זמן */}
      <div className="list-title">החומרים שהעליתי</div>
      <div className="card">
        {materials.length === 0 ? (
          <div className="text-muted text-sm">עדיין לא הועלה חומר.</div>
        ) : (
          <div className="timeline">
            {materials.map((m) => (
              <div key={m.id} className="tl-item">
                <div className="d">{new Date(m.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}</div>
                <div className="t">
                  {m.title || 'חומר'}{' '}
                  <span className={`mat-origin ${m.origin === 'חזרה' ? 'o-old' : 'o-new'}`}>{m.origin || 'השנה'}</span>
                </div>
                <div className="tag">{m.kind === 'pdf' ? 'PDF' : m.kind === 'text' ? 'טקסט' : 'תמונה'}</div>
              </div>
            ))}
          </div>
        )}
        <button className="btn mt-3.5 w-full" onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
          ➕ העלה חומר חדש
        </button>
      </div>
    </div>
  )
}
