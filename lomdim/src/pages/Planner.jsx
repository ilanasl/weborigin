import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { scanScope, matchScopeTopics } from '../lib/gemini'

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
// ברירת מחדל: כמה ימים לפני מתחילים ללמוד — מבדק קצר יותר, מבחן מסכם ארוך יותר
const LEAD_DEFAULT = { 'מבדק': 4, 'מבחן מסכם': 8 }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null

export default function Planner({ nav, params }) {
  const { subjectId, subjectName } = params
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [kind, setKind] = useState('מבחן מסכם')
  const [leadDays, setLeadDays] = useState(LEAD_DEFAULT['מבחן מסכם'])
  const [exam, setExam] = useState({ date: '', scope: '' })  // מבחן מסכם
  const [quiz, setQuiz] = useState({ date: '', scope: '' })  // מבדק
  const [scopeFile, setScopeFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [matchNote, setMatchNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: tp }, { data: at }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', subjectId).single(),
      supabase.from('topics').select('*').eq('subject_id', subjectId).order('created_at'),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', subjectId),
    ])
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
    }
    setSubject(s)
    setExam({ date: s?.exam_date || '', scope: s?.exam_scope_text || '' })
    setQuiz({ date: s?.quiz_date || '', scope: s?.quiz_scope_text || '' })
    // ברירת מחדל: הסוג הקרוב יותר שכבר הוגדר לו תאריך
    const qd = daysUntil(s?.quiz_date), ed = daysUntil(s?.exam_date)
    const k = (qd != null && qd >= 0 && (ed == null || ed < 0 || qd <= ed)) ? 'מבדק' : 'מבחן מסכם'
    setKind(k)
    setLeadDays(LEAD_DEFAULT[k])
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    setLoading(false)
  }
  useEffect(() => { load() }, [subjectId])

  // המשבצת הפעילה לפי הסוג שנבחר
  const slot = kind === 'מבדק' ? quiz : exam
  const setSlot = (patch) => (kind === 'מבדק' ? setQuiz : setExam)((s) => ({ ...s, ...patch }))
  const date = slot.date
  const scope = slot.scope

  async function onPickPhoto(f) {
    setScanErr('')
    if (!f) { setScopeFile(null); return }
    setScopeFile(f); setScanning(true)
    try {
      const text = await scanScope({ imageBase64: await fileToBase64(f), mimeType: f.type, subjectName })
      if (text) setSlot({ scope: (scope ? scope.trim() + '\n' : '') + text.trim() })
    } catch (e) {
      setScanErr('קריאת הצילום נכשלה. אפשר לכתוב את המיקוד ידנית. ' + String(e?.message || e).slice(0, 160))
    } finally { setScanning(false) }
  }

  async function save() {
    setBusy(true); setMatchNote('')
    const cols = kind === 'מבדק'
      ? { quiz_date: date || null, quiz_scope_text: scope || null }
      : { exam_kind: 'מבחן מסכם', exam_date: date || null, exam_scope_text: scope || null }
    await supabase.from('subjects').update(cols).eq('id', subjectId)
    // מיקוד → נושאים: מזהה אילו נושאים כלולים במבחן ומסמן אותם (התוכנית תתמקד בהם)
    if (scope.trim() && topics.length) {
      try {
        const { in_exam } = await matchScopeTopics({ subjectName, scopeText: scope.trim(), knownTopics: topics.map((t) => t.name) })
        const set = new Set(in_exam || [])
        await Promise.all(topics.map((t) => supabase.from('topics').update({ in_exam: set.has(t.name) }).eq('id', t.id)))
        if (set.size) setMatchNote(`🎯 זוהו ${set.size} נושאים במבחן — התוכנית תתמקד בהם: ${[...set].join(', ')}`)
      } catch { /* לא חוסם את שמירת התוכנית */ }
    }
    // שמירת צילום המיקוד כחומר (כדי שיישמר וייראה ב"החומרים שהעליתי")
    if (scopeFile) {
      try {
        const { data: u } = await supabase.auth.getUser()
        const uid = u.user?.id
        let storagePath = null
        if (uid) {
          storagePath = `${uid}/scope-${Date.now()}`
          await supabase.storage.from('materials').upload(storagePath, scopeFile).catch(() => {})
        }
        await supabase.from('materials').insert({
          subject_id: subjectId, title: 'מיקוד המבחן', kind: 'image',
          storage_path: storagePath, origin: 'השנה', source_text: scope || null,
        })
      } catch { /* לא חוסם את שמירת התוכנית */ }
      setScopeFile(null)
    }
    await load()
    setBusy(false)
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  const examDays = daysUntil(date)
  // אם זוהו נושאים במבחן (מהמיקוד) — מתמקדים בהם; אחרת בכל הנושאים. חלשים קודם.
  const inExam = topics.filter((t) => t.in_exam)
  const ordered = [...(inExam.length ? inExam : topics)].sort((a, b) => (a.m.pct ?? 50) - (b.m.pct ?? 50))
  const addDays = (d) => { const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() + d); return dt }

  // בניית תוכנית: מתחילים ללמוד רק בחלון (leadDays לפני המבחן), נושאים חלשים קודם,
  // יום לפני = חזרה כללית, יום המבחן מסומן. אם המבחן עוד רחוק — startsInDays אומר בעוד כמה ימים מתחילים.
  function buildPlan() {
    if (examDays == null || examDays < 1) return { days: [], startsInDays: null }
    const startIn = Math.max(1, examDays - leadDays)     // היום הראשון של הלמידה (הסחה מהיום)
    const studyOffsets = []
    for (let d = startIn; d <= examDays - 2; d++) studyOffsets.push(d)
    const days = []
    const n = studyOffsets.length
    const perDay = n > 0 ? Math.max(1, Math.ceil(ordered.length / n)) : 0
    let ti = 0
    studyOffsets.forEach((d, idx) => {
      const day = []
      for (let k = 0; k < perDay && ti < ordered.length; k++) day.push(ordered[ti++])
      if (day.length === 0 && ordered.length) day.push(ordered[idx % ordered.length])
      days.push({ dt: addDays(d), topics: day })
    })
    if (examDays >= 2) days.push({ dt: addDays(examDays - 1), review: true })
    days.push({ dt: addDays(examDays), exam: true })
    return { days, startsInDays: startIn > 1 ? startIn : null }
  }
  const { days: plan, startsInDays } = buildPlan()

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">מתכנן המבחן</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card flex flex-col gap-4">
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">איזה מהם עורכים?</label>
          <div className="flex gap-2">
            {['מבחן מסכם', 'מבדק'].map((k) => {
              const d = k === 'מבדק' ? quiz.date : exam.date
              return (
                <button key={k} onClick={() => { setKind(k); setLeadDays(LEAD_DEFAULT[k]) }}
                  className={`flex-1 rounded-[12px] border-[1.5px] py-2 text-[14px] font-semibold transition ${
                    kind === k ? 'border-primary text-primary' : 'border-line text-ink'}`}
                  style={kind === k ? { background: 'var(--primary-soft)' } : {}}>
                  {k}
                  <div className="text-[11px] font-normal text-muted">{d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : 'ללא תאריך'}</div>
                </button>
              )
            })}
          </div>
          <div className="text-[12px] text-muted mt-1.5">אפשר להגדיר תאריך גם למבדק וגם למבחן — שניהם יופיעו בבית ובלוח המבחנים.</div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[13.5px] font-bold text-muted mb-1.5">תאריך ה{kind}</label>
            <input type="date" className="field" value={date} onChange={(e) => setSlot({ date: e.target.value })} />
          </div>
          <div className="w-[130px]">
            <label className="block text-[13.5px] font-bold text-muted mb-1.5">מתחילים ללמוד</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min="1" max="30" className="field text-center" style={{ width: 60 }}
                value={leadDays} onChange={(e) => setLeadDays(Math.max(1, parseInt(e.target.value, 10) || 1))} />
              <span className="text-[12.5px] text-muted">ימים לפני</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">מיקוד החומר (חופשי)</label>
          <textarea className="field" style={{ minHeight: 70 }} value={scope}
            onChange={(e) => setSlot({ scope: e.target.value })}
            placeholder="מה בדיוק במבחן? אפשר להעתיק את מה שהמורה שלחה…" />
          <div className="mt-2">
            <label className="text-[13px] font-semibold text-primary cursor-pointer inline-flex items-center gap-1.5">
              📷 צרפו צילום של המיקוד (למשל מה שהמורה כתבה על הלוח)
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => onPickPhoto(e.target.files?.[0] || null)} />
            </label>
            {scanning && <div className="text-muted text-[12.5px] mt-1">קורא את הצילום… ✍️</div>}
            {scopeFile && !scanning && <div className="text-good text-[12.5px] mt-1">✓ צורף וזוהה — אפשר לערוך את הטקסט למעלה.</div>}
            {scanErr && <div className="text-bad text-[12.5px] mt-1">{scanErr}</div>}
          </div>
        </div>
        <button className="btn btn-primary btn-wide" onClick={save} disabled={busy}>
          {busy ? 'שומר ובונה…' : 'שמור ובנה תוכנית'}
        </button>
        {matchNote && <div className="text-good text-[13px] font-semibold leading-relaxed">{matchNote}</div>}
      </div>

      {examDays != null && examDays >= 0 && (
        <div className="ready-card mt-3">
          <div className="ready-top">
            <div className="ready-lbl">{kind} בעוד</div>
            <div className="ready-pct tnum">{examDays === 0 ? 'היום' : examDays}</div>
          </div>
          {examDays > 0 && <div className="text-muted text-[12.5px] mt-1">ימים</div>}
        </div>
      )}

      {startsInDays != null && (
        <div className="card mt-3 text-[13.5px] leading-relaxed" style={{ background: 'var(--primary-soft)' }}>
          📅 המבחן עוד רחוק — אין צורך להתחיל עכשיו. לפי ההגדרה, הלמידה ל{kind} תתחיל <b>בעוד {startsInDays} ימים</b>.
          עד אז אפשר להתמקד במבחנים קרובים יותר. (אפשר לשנות ב"מתחילים ללמוד".)
        </div>
      )}

      {plan.length > 0 && (
        <>
          <div className="list-title">תוכנית הלמידה שלי</div>
          <div className="card">
            {plan.map((p, i) => (
              <div key={i} className="flex gap-3 py-3 border-b border-line last:border-0">
                <div className="w-[54px] flex-none text-center">
                  <div className="font-disp font-bold text-[13px]">{DOW[p.dt.getDay()]}</div>
                  <div className="text-[11px] text-muted">{p.dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {p.exam ? (
                    <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-bad bg-bad-soft rounded-[9px] px-2.5 py-1">📝 {kind}!</span>
                  ) : p.review ? (
                    <div className="text-[14.5px] font-semibold">🔁 חזרה כללית + לחיזוק</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {p.topics.map((t) => (
                        <button key={t.id} className="text-start text-[14.5px] font-medium flex items-center gap-2"
                          onClick={() => nav.go('topicSummary', { subjectId, subjectName, topicId: t.id, topicName: t.name })}>
                          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)' }} />
                          {t.name} <span className="text-muted text-[12px]">קרא ותרגל ›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
