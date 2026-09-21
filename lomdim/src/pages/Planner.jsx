import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { scanScope } from '../lib/gemini'

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

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
  const [date, setDate] = useState('')
  const [scope, setScope] = useState('')
  const [scopeFile, setScopeFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')
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
    setKind(s?.exam_kind || 'מבחן מסכם')
    setDate(s?.exam_date || '')
    setScope(s?.exam_scope_text || '')
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    setLoading(false)
  }
  useEffect(() => { load() }, [subjectId])

  async function onPickPhoto(f) {
    setScanErr('')
    if (!f) { setScopeFile(null); return }
    setScopeFile(f); setScanning(true)
    try {
      const text = await scanScope({ imageBase64: await fileToBase64(f), mimeType: f.type, subjectName })
      if (text) setScope((s) => (s ? s.trim() + '\n' : '') + text.trim())
    } catch (e) {
      setScanErr('קריאת הצילום נכשלה. אפשר לכתוב את המיקוד ידנית. ' + String(e?.message || e).slice(0, 160))
    } finally { setScanning(false) }
  }

  async function save() {
    setBusy(true)
    await supabase.from('subjects').update({
      exam_kind: kind, exam_date: date || null, exam_scope_text: scope || null,
    }).eq('id', subjectId)
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
  // נושאים חלשים קודם (null = אמצע)
  const ordered = [...topics].sort((a, b) => (a.m.pct ?? 50) - (b.m.pct ?? 50))

  // בניית תוכנית יומית: מהיום עד המבחן, נושאים חלשים קודם, יום לפני = חזרה כללית
  function buildPlan() {
    if (examDays == null || examDays < 1 || ordered.length === 0) return []
    const plan = []
    const studyDays = Math.max(1, examDays - 1)
    const perDay = Math.max(1, Math.ceil(ordered.length / studyDays))
    let ti = 0
    for (let d = 1; d <= examDays; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d)
      if (d === examDays) { plan.push({ dt, exam: true }); continue }
      if (d === examDays - 1) { plan.push({ dt, review: true }); continue }
      const day = []
      for (let k = 0; k < perDay && ti < ordered.length; k++) day.push(ordered[ti++])
      if (day.length === 0 && ordered.length) day.push(ordered[(d - 1) % ordered.length])
      plan.push({ dt, topics: day })
    }
    return plan
  }
  const plan = buildPlan()

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">מתכנן המבחן</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card flex flex-col gap-4">
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">סוג</label>
          <div className="flex gap-2">
            {['מבחן מסכם', 'מבדק'].map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`flex-1 rounded-[12px] border-[1.5px] py-2.5 text-[14.5px] font-semibold transition ${
                  kind === k ? 'border-primary text-primary' : 'border-line text-ink'}`}
                style={kind === k ? { background: 'var(--primary-soft)' } : {}}>{k}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">תאריך המבחן</label>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">מיקוד החומר (חופשי)</label>
          <textarea className="field" style={{ minHeight: 70 }} value={scope}
            onChange={(e) => setScope(e.target.value)}
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
          {busy ? 'שומר…' : 'שמור ובנה תוכנית'}
        </button>
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
