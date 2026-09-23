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
  const [rvCount, setRvCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showMats, setShowMats] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: tp }, { data: mt }, { data: at }, { count: qc }, { count: fc }, { count: rc }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', id).single(),
      supabase.from('topics').select('*').eq('subject_id', id).order('created_at'),
      supabase.from('materials').select('*').eq('subject_id', id).order('created_at', { ascending: false }),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', id),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('subject_id', id),
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
    // רק קבצים שהועלו בפועל (יש להם קובץ מאוחסן או חתימת תוכן) — לא סיכומים/הערות שנוצרו
    setMaterials((mt || []).filter((m) => m.storage_path || m.content_hash))
    setQCount(qc || 0); setFcCount(fc || 0); setRvCount(rc || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  // פתיחת הקובץ המקורי שהועלה (URL חתום זמני)
  async function openMaterial(m) {
    if (!m.storage_path) return
    const { data } = await supabase.storage.from('materials').createSignedUrl(m.storage_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // שיוך חומר לנושא אחר — מעביר גם את השאלות שנוצרו ממנו
  async function moveMaterialTopic(m, topicId) {
    if (!topicId || topicId === m.topic_id) return
    await supabase.from('materials').update({ topic_id: topicId }).eq('id', m.id)
    await supabase.from('questions').update({ topic_id: topicId }).eq('material_id', m.id).catch(() => {})
    load()
  }

  if (loading || !subject) return <div className="text-muted pt-4">טוען…</div>

  const name = subject.name
  // המבחן/מבדק הקרוב יותר מבין השניים
  const upcomingExams = [
    { kind: 'מבחן מסכם', days: daysUntil(subject.exam_date) },
    { kind: 'מבדק', days: daysUntil(subject.quiz_date) },
  ].filter((x) => x.days != null && x.days >= 0).sort((a, b) => a.days - b.days)
  const examDays = upcomingExams[0]?.days ?? null
  const examKind = upcomingExams[0]?.kind || 'מבחן'
  const summary = materials.find((m) => m.summary_md)

  const pcts = topics.map((t) => t.m.pct).filter((p) => p != null)
  const ready = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  const strong = topics.filter((t) => t.m.pct != null && t.m.pct >= 75)
  const weak = topics.filter((t) => t.m.pct != null && t.m.pct < 50)
  // מבחן קרוב אך עדיין לא הוגדר/הועלה חומר עבורו (אין נושאים מסומנים "במבחן")
  const hasExam = examDays != null && examDays >= 0
  const needsMaterial = hasExam && topics.filter((t) => t.in_exam).length === 0
  // תרגיל ניתוח משפט רלוונטי ללשון/עברית/דקדוק
  const isLang = /עברית|לשון|דקדוק|תחביר/.test(name || '')

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
        {isLang && (
          <button className="btn" onClick={() => nav.go('syntax', { subjectId: id, subjectName: name, mode: 'syntax' })}>🧩 ניתוח משפט</button>
        )}
        <button className="btn" onClick={() => nav.go('explain', { subjectId: id, subjectName: name, context: summary?.summary_md })}>💬 תסביר לי</button>
        <button className="btn" onClick={() => nav.go('reinforce', { subjectId: id, subjectName: name })}>
          📓 לחיזוק{rvCount > 0 ? ` (${rvCount})` : ''}
        </button>
        <button className="btn" onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}>
          📅 מתכנן המבחן{needsMaterial ? ' ●' : ''}
        </button>
        <button className="btn" onClick={() => nav.go('pastExams', { subjectId: id, subjectName: name })}>
          🗂️ מבחנים שעברו
        </button>
      </div>

      {/* אזהרה: מבחן קרוב בלי חומר מוגדר */}
      {needsMaterial && (
        <button onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}
          className="w-full text-start rounded-[16px] p-3.5 mt-3 flex items-start gap-2.5 text-[13.5px] leading-relaxed"
          style={{ background: 'var(--accent-soft)', color: 'color-mix(in srgb,var(--accent) 80%,#7a4b00)' }}>
          <span className="text-[17px] leading-none">📤</span>
          <span><b>עדיין לא הוגדר חומר ל{examKind}.</b> העלו את החומר וסמנו את המיקוד במתכנן המבחן, כדי שהתוכנית והתרגול יתמקדו בו ›</span>
        </button>
      )}

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
                {t.in_exam && <span className="scope-in">✓ במבחן</span>}
                {t.m.due && <span className="due">🔁 חזרה שוטפת</span>}
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

      {/* חומרים — מכווץ כברירת מחדל */}
      <button className="list-title flex items-center gap-2 w-full" onClick={() => setShowMats((v) => !v)}>
        <span className="flex-1 text-start">החומרים שהעליתי ({materials.length})</span>
        <span className="text-[12px] font-bold">{showMats ? 'הסתר ▲' : 'הצג ▼'}</span>
      </button>
      <div className="card">
        {showMats && (materials.length === 0 ? (
          <div className="text-muted text-sm mb-3">עדיין לא הועלה חומר.</div>
        ) : (
          <div className="timeline mb-3">
            {materials.map((m) => (
              <div key={m.id} className="tl-item">
                <div className="d">{new Date(m.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}</div>
                <div className="t">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{m.title || 'חומר'}</span>
                    {m.storage_path && (
                      <button className="text-primary text-[12px] font-semibold" onClick={() => openMaterial(m)}>👁 צפה</button>
                    )}
                  </div>
                  {/* שיוך לנושא — ניתן לשינוי מכאן */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[11.5px] text-muted">נושא:</span>
                    <select className="field !py-1 !px-2 text-[12.5px] !w-auto" value={m.topic_id || ''}
                      onChange={(e) => moveMaterialTopic(m, e.target.value)}>
                      {!m.topic_id && <option value="">— ללא —</option>}
                      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="tag">{m.kind === 'pdf' ? 'PDF' : m.kind === 'text' ? 'טקסט' : 'תמונה'}</div>
              </div>
            ))}
          </div>
        ))}
        <button className="btn w-full" onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
          ➕ העלה חומר חדש
        </button>
      </div>
    </div>
  )
}
