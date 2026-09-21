import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { checkExercise, generateQuestions } from '../lib/gemini'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function CheckExercise({ params }) {
  const { subjectId, subjectName } = params
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)

  async function ensureTopic(name) {
    const { data: ex } = await supabase.from('topics').select('id').eq('subject_id', subjectId).eq('name', name).maybeSingle()
    if (ex) return ex.id
    const { data: ins } = await supabase.from('topics').insert({ subject_id: subjectId, name, origin: 'השנה' }).select('id').single()
    return ins?.id
  }

  async function addToReinforce() {
    setAdding(true); setErr('')
    try {
      const topicId = await ensureTopic('תרגילים שבדקתי')
      const src = [res.exercise, res.feedback, res.reteach].filter(Boolean).join('\n')
      const { questions } = await generateQuestions({ subjectName, topic: 'תרגילים שבדקתי', sourceText: src, count: 2, learner: profile })
      if (questions?.length) {
        const { data: inserted } = await supabase.from('questions').insert(questions.map((q) => ({
          subject_id: subjectId, topic_id: topicId, q: q.q, choices: q.choices, answer: q.answer,
          difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
        }))).select('id')
        if (inserted?.length) {
          await supabase.from('review_items').insert(inserted.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
        }
      }
      setAdded(true)
    } catch (e) {
      setErr('הוספה לחיזוק נכשלה. נסו שוב. ' + String(e))
    } finally { setAdding(false) }
  }

  async function run() {
    if (!file) return
    setBusy(true); setErr(''); setRes(null); setAdded(false)
    try {
      const out = await checkExercise({ imageBase64: await fileToBase64(file), mimeType: file.type, subjectName, learner: profile })
      setRes(out)
    } catch {
      setErr('הבדיקה נכשלה. נסו לצלם את הפתרון חד וברור יותר.')
    } finally { setBusy(false) }
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">בדוק תרגיל שפתרתי</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card">
        <div className="dropzone">
          <div className="text-3xl">📷</div>
          <div className="font-semibold text-[15px] text-ink">צלמו את התרגיל הפתור מהמחברת</div>
          <div className="text-[12.5px]">Gemini יקרא את הפתרון ויגיד איפה הטעות (אם יש).</div>
          <input type="file" accept="image/*" className="text-sm mt-1"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setErr('') }} />
        </div>
        <button className="btn btn-primary btn-wide mt-4" onClick={run} disabled={!file || busy}>
          {busy ? 'בודק…' : 'בדוק את הפתרון'}
        </button>
        {err && <div className="text-bad text-[13.5px] mt-3">{err}</div>}
      </div>

      {res && (
        <div className="card mt-3">
          <div className={`font-extrabold mb-2 ${res.correct ? 'text-good' : 'text-bad'}`}>
            {res.correct ? '✅ הפתרון נכון!' : '💡 יש טעות — בואו נבין'}
          </div>
          {res.exercise && <div className="ce-eq">{res.exercise}</div>}
          {Array.isArray(res.steps) && res.steps.length > 0 && (
            <div className="ce-steps mb-3">
              {res.steps.map((st, i) => (
                <div key={i} className={`ce-step ${st.ok ? 'ok' : 'bad'}`}>
                  <span>{st.ok ? '✓' : '✗'}</span><span>{st.text}</span>
                </div>
              ))}
            </div>
          )}
          {res.feedback && (
            <div className="text-[14px] leading-relaxed"><Markdown text={res.feedback} /></div>
          )}
          {res.reteach && (
            <div className="mt-3 pt-3 border-t border-line text-[13.5px] text-muted">
              <b className="text-ink">לזכור: </b>{res.reteach}
            </div>
          )}
          {!res.correct && (
            added ? (
              <div className="mt-4 text-good font-semibold text-[14px]">✓ נוסף ל"לחיזוק" — יופיע שם לתרגול חוזר.</div>
            ) : (
              <button className="btn btn-wide mt-4" onClick={addToReinforce} disabled={adding}>
                {adding ? 'מוסיף…' : '📓 הוסף את הטעות ל"לחיזוק"'}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
