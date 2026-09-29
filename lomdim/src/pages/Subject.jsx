import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { analyzeMaterial } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import { withTone } from '../lib/tone'
import { foldLegacyCheckTopic, LEGACY_CHECK_TOPIC } from '../lib/checkTopic'

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
// מזהה הקובץ המקורי — כמה שורות (נושא לכל שורה) יכולות לחלוק את אותו דף
const fileKey = (m) => m.storage_path || (m.content_hash || '').split(':')[0] || m.id
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = reject
  r.readAsDataURL(blob)
})

export default function Subject({ nav, params }) {
  const { id } = params
  const { profile } = useAuth()
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [materials, setMaterials] = useState([])
  const [qCount, setQCount] = useState(0)
  const [fcCount, setFcCount] = useState(0)
  const [rvCount, setRvCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showMats, setShowMats] = useState(false)
  const [savingMat, setSavingMat] = useState(null)  // id של חומר שנשמר כרגע
  const [savedMat, setSavedMat] = useState(null)     // id של חומר שזה עתה נשמר (לאישור קצר)
  // הוספת נושא נוסף לדף שכולל שני נושאים
  const [addFor, setAddFor] = useState(null)        // id של החומר שהחלונית פתוחה עבורו
  const [addSel, setAddSel] = useState('')          // topic id | '__new'
  const [addNew, setAddNew] = useState('')
  const [addBusy, setAddBusy] = useState(null)
  const [addErr, setAddErr] = useState('')
  const [addDone, setAddDone] = useState(null)

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
    setSubject(withTone(s))
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    // רק קבצים שהועלו בפועל (יש להם קובץ מאוחסן או חתימת תוכן) — לא סיכומים/הערות שנוצרו
    setMaterials((mt || []).filter((m) => m.storage_path || m.content_hash))
    setQCount(qc || 0); setFcCount(fc || 0); setRvCount(rc || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])
  // חד-פעמי: "תרגילים שבדקתי" כבר לא יחידה נפרדת — השאלות עוברות לנושאים שלהן
  useEffect(() => {
    if (!subject?.name || !topics.some((t) => t.name === LEGACY_CHECK_TOPIC)) return
    foldLegacyCheckTopic(id, subject.name).then((moved) => { if (moved) load() })
  }, [subject?.name, topics.length])

  // פתיחת הקובץ המקורי שהועלה (URL חתום זמני)
  async function openMaterial(m) {
    if (!m.storage_path) return
    const { data } = await supabase.storage.from('materials').createSignedUrl(m.storage_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // שיוך חומר לנושא אחר — מעביר גם את השאלות שנוצרו ממנו.
  // בלי טעינה מחדש של כל המסך — כדי לא לקפוץ למעלה ולאבד את המקום (אפשר לסווג כמה חומרים ברצף).
  async function moveMaterialTopic(m, topicId) {
    if (!topicId || topicId === m.topic_id) return
    const prev = m.topic_id
    setMaterials((arr) => arr.map((x) => x.id === m.id ? { ...x, topic_id: topicId } : x))
    setSavingMat(m.id); setSavedMat(null)
    const { error } = await supabase.from('materials').update({ topic_id: topicId }).eq('id', m.id)
    if (error) {
      // שחזור הבחירה הקודמת אם השמירה נכשלה — בלי לקפוץ מהמסך
      setMaterials((arr) => arr.map((x) => x.id === m.id ? { ...x, topic_id: prev } : x))
      setSavingMat(null)
      return
    }
    try {
      await supabase.from('questions').update({ topic_id: topicId }).eq('material_id', m.id)
    } catch { /* אם אין שאלות מקושרות — לא נורא */ }
    setSavingMat(null); setSavedMat(m.id)
    setTimeout(() => setSavedMat((cur) => cur === m.id ? null : cur), 2500)
  }

  // דף שכולל גם נושא נוסף: קורא שוב את הדף המקורי, מתמקד רק בחלק של הנושא הזה,
  // ושומר לו שורת חומר משלו (אותו קובץ) עם סיכום, שאלות וכרטיסיות. בלי טעינה מחדש של המסך.
  async function addTopicToMaterial(m) {
    setAddErr('')
    let topicId = addSel
    let topicName = topics.find((t) => t.id === addSel)?.name
    if (addSel === '__new') {
      const nm = addNew.trim()
      if (!nm) return
      const exist = topics.find((t) => t.name === nm)
      if (exist) { topicId = exist.id; topicName = exist.name }
      else {
        const { data: ins, error } = await supabase.from('topics')
          .insert({ subject_id: id, name: nm, origin: m.origin || 'השנה' }).select('*').single()
        if (error || !ins) { setAddErr('יצירת הנושא נכשלה — נסו שוב'); return }
        topicId = ins.id; topicName = ins.name
        setTopics((arr) => [...arr, { ...ins, m: mastery([]) }])
      }
    }
    if (!topicId || !topicName) return
    setAddBusy(m.id)
    try {
      let input
      if (m.storage_path) {
        const { data: blob, error } = await supabase.storage.from('materials').download(m.storage_path)
        if (error || !blob) throw new Error('download')
        input = { imageBase64: await blobToBase64(blob), mimeType: blob.type || (m.kind === 'pdf' ? 'application/pdf' : 'image/jpeg') }
      } else {
        input = { text: m.source_text || m.summary_md || m.title || '' }
      }
      const out = await analyzeMaterial({
        ...input, subjectName: subject.name, knownTopics: [topicName], learner: profile, focusTopic: topicName,
      })
      const t = out.topics?.[0] || { summary_md: '', questions: [], flashcards: [] }
      const { data: mat, error: me } = await supabase.from('materials').insert({
        subject_id: id, topic_id: topicId, title: topicName, kind: m.kind,
        storage_path: m.storage_path || null, origin: m.origin || 'השנה',
        summary_md: t.summary_md || '',
        // סימון שזה אותו דף (לא נחשב כקובץ כפול בבדיקת ההעלאה)
        content_hash: m.content_hash ? `${m.content_hash.split(':')[0]}:${topicId}` : (m.storage_path ? null : `page:${m.id}:${topicId}`),
      }).select('*').single()
      if (me || !mat) throw new Error('save')
      const qs = Array.isArray(t.questions) ? t.questions : []
      const fcs = Array.isArray(t.flashcards) ? t.flashcards : []
      if (qs.length) await supabase.from('questions').insert(qs.map((q) => ({
        subject_id: id, topic_id: topicId, material_id: mat.id,
        q: q.q, choices: q.choices, answer: q.answer,
        difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
      })))
      if (fcs.length) await supabase.from('flashcards').insert(fcs.map((c) => ({
        subject_id: id, topic_id: topicId, front: c.front, back: c.back, context: c.context || null,
      })))
      // מכניס את השורה החדשה מיד מתחת לדף המקורי — בלי לקפוץ מהמקום
      setMaterials((arr) => { const i = arr.findIndex((x) => x.id === m.id); const c = arr.slice(); c.splice(i + 1, 0, mat); return c })
      setQCount((c) => c + qs.length); setFcCount((c) => c + fcs.length)
      setAddFor(null); setAddDone(mat.id)
      setTimeout(() => setAddDone((cur) => cur === mat.id ? null : cur), 3500)
    } catch {
      setAddErr('הניתוח נכשל — נסו שוב בעוד רגע')
    } finally { setAddBusy(null) }
  }

  // הסרת שיוך נוסף של דף (רק כשהדף משויך ליותר מנושא אחד — לא מוחק את הקובץ עצמו)
  async function removeMaterialRow(m) {
    if (!confirm('להסיר את הדף מהנושא הזה? (הדף נשאר בנושא השני)')) return
    await supabase.from('questions').delete().eq('material_id', m.id)
    const { error } = await supabase.from('materials').delete().eq('id', m.id)
    if (!error) setMaterials((arr) => arr.filter((x) => x.id !== m.id))
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
      <div className="home-h2 mt-5 mb-2.5">
        <h2>הנושאים שלי</h2>
        <span>{topics.length} נושאים</span>
      </div>
      <div className="flex flex-col gap-2">
        {topics.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שהמערכת תזהה נושאים.</div>
        ) : topics.map((t) => (
          <div key={t.id} className="milky-row topic-row">
            <button type="button" className="topic-main"
              onClick={() => nav.go('topicSummary', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name })}>
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-[15.5px]">{t.name}</span>
                {t.in_exam && <span className="tp-badge" style={{ background: 'var(--primary)' }}>במבחן</span>}
                {t.m.due && <span className="tp-badge" style={{ background: '#B7A5FF' }}>חזרה שוטפת</span>}
                {t.origin === 'חזרה' && <span className="tp-badge tp-badge-muted">חזרה</span>}
              </span>
              {t.m.pct == null ? (
                <span className="text-[12.5px] text-muted italic">אוספים נתונים…</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${t.m.pct}%`, background: 'var(--primary)' }} />
                  </span>
                  <span className="font-disp font-bold text-[13px] tnum" dir="ltr">{t.m.pct}%</span>
                </span>
              )}
              <span className="text-[12px] text-muted">📖 לסיכום הנושא ›</span>
            </button>
            <button type="button" className="topic-go" aria-label={`לתרגל את ${t.name}`}
              onClick={() => nav.go('practice', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name, mode: 'practice' })}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
              <span>תרגול</span>
            </button>
          </div>
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
                    {savingMat === m.id && <span className="text-[11.5px] text-muted">שומר…</span>}
                    {savedMat === m.id && <span className="text-[11.5px] text-good font-semibold">✓ נשמר</span>}
                    {addDone === m.id && <span className="text-[11.5px] text-good font-semibold">✓ נוסף לנושא</span>}
                  </div>
                  {(() => {
                    const siblings = materials.filter((x) => fileKey(x) === fileKey(m))
                    const usedTopics = new Set(siblings.map((x) => x.topic_id))
                    const isShared = siblings.length > 1
                    if (addFor !== m.id) return (
                      <div className="flex items-center gap-3 mt-1.5">
                        <button className="text-primary text-[12px] font-semibold"
                          onClick={() => { setAddFor(m.id); setAddSel(''); setAddNew(''); setAddErr('') }}>
                          ➕ הדף כולל גם נושא נוסף
                        </button>
                        {isShared && (
                          <button className="text-muted text-[12px] font-semibold hover:text-bad" onClick={() => removeMaterialRow(m)}>
                            הסר מנושא זה
                          </button>
                        )}
                      </div>
                    )
                    return (
                      <div className="mt-2 rounded-[12px] border border-line p-2.5 flex flex-col gap-2">
                        <div className="text-[12px] text-muted leading-relaxed">
                          לאיזה נושא נוסף שייך הדף? המערכת תקרא אותו שוב ותכין לנושא הזה סיכום, שאלות וכרטיסיות רק מהחלק הרלוונטי.
                        </div>
                        <select className="field !py-1.5 text-[13px]" value={addSel} onChange={(e) => setAddSel(e.target.value)}>
                          <option value="">בחר/י נושא…</option>
                          {topics.filter((t) => !usedTopics.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          <option value="__new">➕ נושא חדש…</option>
                        </select>
                        {addSel === '__new' && (
                          <input className="field !py-1.5 text-[13px]" placeholder="שם הנושא החדש"
                            value={addNew} onChange={(e) => setAddNew(e.target.value)} />
                        )}
                        <div className="flex gap-2">
                          <button className="btn btn-primary !py-1.5 !px-3 text-[13px]"
                            disabled={addBusy === m.id || !addSel || (addSel === '__new' && !addNew.trim())}
                            onClick={() => addTopicToMaterial(m)}>
                            {addBusy === m.id ? 'מנתח את הדף…' : 'הוסף'}
                          </button>
                          <button className="btn !py-1.5 !px-3 text-[13px]" disabled={addBusy === m.id} onClick={() => setAddFor(null)}>ביטול</button>
                        </div>
                        {addErr && <div className="text-bad text-[12px]">{addErr}</div>}
                      </div>
                    )
                  })()}
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
