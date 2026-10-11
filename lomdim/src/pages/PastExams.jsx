import { useEffect, useState } from 'react'
import { toAIInput } from '../lib/image'
import { supabase } from '../lib/supabase'
import { checkExercise, generateQuestions } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import { PASSED_KEY } from '../lib/plan'


export default function PastExams({ params }) {
  const { subjectId, subjectName } = params
  const { profile } = useAuth()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState('מבחן מסכם')
  const [date, setDate] = useState('')
  const [grade, setGrade] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  // עריכת מבחן שכבר נרשם — ציון, והוספת צילום (אם לא צורף בהתחלה)
  const [editId, setEditId] = useState(null)
  const [editGrade, setEditGrade] = useState('')
  const [editFile, setEditFile] = useState(null)
  const [editBusy, setEditBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('past_exams').select('*')
      .eq('subject_id', subjectId).order('exam_date', { ascending: false })
    setExams(data || []); setLoading(false)
    // המבחן/מבדק האחרון שעבר — ממלאים מראש את הסוג והתאריך (אם עוד לא נרשם)
    try {
      const p = JSON.parse(localStorage.getItem(PASSED_KEY(subjectId)) || 'null')
      if (p && !(data || []).some((e) => p.date && e.exam_date === p.date)) {
        if (p.kind) setKind(p.kind)
        if (p.date) setDate(p.date)
      }
    } catch { /* בלי אחסון — ממלאים ידנית */ }
  }
  useEffect(() => { load() }, [subjectId])

  async function analyzeToReinforce(file) {
    // ניתוח צילום המבחן → מוצא טעויות → מייצר תרגולים → לחיזוק
    const out = await checkExercise({ ...(await toAIInput(file)), subjectName, learner: profile })
    const hasMistake = out.correct === false || (Array.isArray(out.steps) && out.steps.some((s) => s.ok === false)) || out.feedback
    if (!hasMistake) return false
    let topicId = null
    const { data: exist } = await supabase.from('topics').select('id').eq('subject_id', subjectId).eq('name', 'מבחנים שעברו').maybeSingle()
    if (exist) topicId = exist.id
    else { const { data: ins } = await supabase.from('topics').insert({ subject_id: subjectId, name: 'מבחנים שעברו', origin: 'השנה' }).select('id').single(); topicId = ins?.id }
    const src = [out.exercise, out.feedback, out.reteach].filter(Boolean).join('\n')
    const { questions } = await generateQuestions({ subjectName, topic: 'מבחנים שעברו', sourceText: src, count: 5, learner: profile })
    if (questions?.length) {
      const { data: qs } = await supabase.from('questions').insert(questions.map((q) => ({
        subject_id: subjectId, topic_id: topicId, q: q.q, choices: q.choices, answer: q.answer,
        difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
      }))).select('id')
      if (qs?.length) await supabase.from('review_items').insert(qs.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
    }
    return true
  }

  async function save() {
    if (!date) { setErr('בחרו תאריך'); return }
    setBusy(true); setErr(''); setNote('')
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      let storagePath = null
      if (file && uid) {
        storagePath = `${uid}/exam-${Date.now()}`
        await supabase.storage.from('materials').upload(storagePath, file).catch(() => {})
      }
      let analyzed = false
      if (file) { try { analyzed = await analyzeToReinforce(file) } catch { /* לא חוסם */ } }
      await supabase.from('past_exams').insert({
        subject_id: subjectId, kind, exam_date: date, grade: grade ? parseInt(grade, 10) : null,
        storage_path: storagePath, analyzed,
      })
      if (analyzed) setNote('הטעויות מהמבחן נותחו ונוספו ל"לחיזוק" ✓')
      setDate(''); setGrade(''); setFile(null)
      await load()
    } catch (e) {
      setErr('שמירה נכשלה: ' + String(e))
    } finally { setBusy(false) }
  }

  async function uploadPhoto(f) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData.user?.id
    if (!f || !uid) return null
    const path = `${uid}/exam-${Date.now()}`
    try { await supabase.storage.from('materials').upload(path, f) } catch { return null }
    return path
  }

  function openEdit(e) {
    if (editId === e.id) { setEditId(null); return }
    setEditId(e.id); setEditGrade(e.grade != null ? String(e.grade) : ''); setEditFile(null); setNote(''); setErr('')
  }

  async function saveEdit(e) {
    setEditBusy(true); setErr(''); setNote('')
    try {
      const patch = { grade: editGrade ? parseInt(editGrade, 10) : null }
      if (editFile) {
        const path = await uploadPhoto(editFile)
        if (path) patch.storage_path = path
        let analyzed = false
        try { analyzed = await analyzeToReinforce(editFile) } catch { /* לא חוסם */ }
        if (analyzed) patch.analyzed = true
        if (analyzed) setNote('הטעויות מהמבחן נותחו ונוספו ל"לחיזוק" ✓')
      }
      await supabase.from('past_exams').update(patch).eq('id', e.id)
      setEditId(null)
      await load()
    } catch (x) {
      setErr('שמירה נכשלה: ' + String(x))
    } finally { setEditBusy(false) }
  }

  async function viewPhoto(e) {
    const { data } = await supabase.storage.from('materials').createSignedUrl(e.storage_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const gradeColor = (g) => g == null ? '' : g >= 85 ? 'text-good bg-good-soft' : g < 60 ? 'text-bad bg-bad-soft' : 'text-accent bg-accent-soft'

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">מבחנים שעברו</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card flex flex-col gap-4">
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">סוג</label>
          <div className="flex gap-2">
            {['מבחן מסכם', 'מבדק'].map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`flex-1 rounded-[12px] border-[1.5px] py-2.5 text-[14.5px] font-semibold transition ${kind === k ? 'border-primary text-primary' : 'border-line text-ink'}`}
                style={kind === k ? { background: 'var(--primary-soft)' } : {}}>{k}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[13.5px] font-bold text-muted mb-1.5">תאריך</label>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="w-[110px]">
            <label className="block text-[13.5px] font-bold text-muted mb-1.5">ציון</label>
            <input type="number" className="field" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="—" />
          </div>
        </div>
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">צילום המבחן המתוקן (לא חובה)</label>
          <input type="file" accept="image/*" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className="text-[12px] text-muted mt-1">אם תצרפו — המערכת תזהה טעויות ותוסיף תרגולים ל"לחיזוק".</div>
        </div>
        {note && <div className="text-good text-[13.5px] font-semibold">{note}</div>}
        {err && <div className="text-bad text-[13.5px]">{err}</div>}
        <button className="btn btn-primary btn-wide" onClick={save} disabled={busy}>
          {busy ? (file ? 'שומר ומנתח…' : 'שומר…') : 'הוסף מבחן'}
        </button>
      </div>

      <div className="list-title">היסטוריית מבחנים</div>
      <div className="card">
        {loading ? <div className="text-muted text-sm">טוען…</div>
          : exams.length === 0 ? <div className="text-muted text-sm">עדיין לא נוספו מבחנים.</div>
          : exams.map((e) => (
            <div key={e.id} className="py-3 border-b border-line last:border-0">
              {/* לחיצה על השורה — עריכה: ציון והוספת צילום */}
              <button type="button" className="w-full flex items-center gap-3 text-start" onClick={() => openEdit(e)}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14.5px]">{e.kind || 'מבחן'}</div>
                  <div className="text-[12.5px] text-muted">
                    {e.exam_date ? new Date(e.exam_date).toLocaleDateString('he-IL') : ''}
                    {e.storage_path ? ' · יש צילום' : ''}
                    {e.analyzed ? ' · נותח ✓' : ''}
                  </div>
                </div>
                {e.grade != null && (
                  <span className={`text-[15px] font-black rounded-[10px] px-2.5 py-1 tnum ${gradeColor(e.grade)}`}>{e.grade}</span>
                )}
                <span className="text-[12.5px] font-semibold text-primary flex-none">{editId === e.id ? 'סגור' : 'עריכה'}</span>
              </button>
              {editId === e.id && (
                <div className="flex flex-col gap-3 mt-3">
                  <div className="w-[110px]">
                    <label className="block text-[13px] font-bold text-muted mb-1.5">ציון</label>
                    <input type="number" className="field" value={editGrade} onChange={(x) => setEditGrade(x.target.value)} placeholder="—" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-muted mb-1.5">{e.storage_path ? 'החלפת צילום' : 'הוספת צילום של המבחן המתוקן'}</label>
                    <input type="file" accept="image/*" onChange={(x) => setEditFile(x.target.files?.[0] || null)} className="text-[13px]" />
                    {e.storage_path && (
                      <button type="button" className="block mt-1.5 text-[12.5px] font-semibold text-primary underline" onClick={() => viewPhoto(e)}>צפה בצילום הקיים</button>
                    )}
                  </div>
                  <button className="btn btn-primary btn-wide" onClick={() => saveEdit(e)} disabled={editBusy}>
                    {editBusy ? (editFile ? 'שומר ומנתח…' : 'שומר…') : 'שמור'}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
