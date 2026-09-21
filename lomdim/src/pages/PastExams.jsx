import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { checkExercise, generateQuestions } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

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

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('past_exams').select('*')
      .eq('subject_id', subjectId).order('exam_date', { ascending: false })
    setExams(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [subjectId])

  async function analyzeToReinforce() {
    // ניתוח צילום המבחן → מוצא טעויות → מייצר תרגולים → לחיזוק
    const out = await checkExercise({ imageBase64: await fileToBase64(file), mimeType: file.type, subjectName, learner: profile })
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
      if (file) { try { analyzed = await analyzeToReinforce() } catch { /* לא חוסם */ } }
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
            <div key={e.id} className="flex items-center gap-3 py-3 border-b border-line last:border-0">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14.5px]">{e.kind || 'מבחן'}</div>
                <div className="text-[12.5px] text-muted">
                  {e.exam_date ? new Date(e.exam_date).toLocaleDateString('he-IL') : ''}
                  {e.analyzed ? ' · נותח ✓' : ''}
                </div>
              </div>
              {e.grade != null && (
                <span className={`text-[15px] font-black rounded-[10px] px-2.5 py-1 tnum ${gradeColor(e.grade)}`}>{e.grade}</span>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
