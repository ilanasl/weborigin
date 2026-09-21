import { useState } from 'react'
import { checkExercise } from '../lib/gemini'
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
  const { subjectName } = params
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  async function run() {
    if (!file) return
    setBusy(true); setErr(''); setRes(null)
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
        </div>
      )}
    </div>
  )
}
