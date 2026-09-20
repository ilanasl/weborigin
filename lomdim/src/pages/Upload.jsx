import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeMaterial } from '../lib/gemini'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function Upload({ nav, params }) {
  const { subjectId, subjectName } = params
  const [file, setFile] = useState(null)
  const [lastYear, setLastYear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  async function analyze() {
    if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const b64 = await fileToBase64(file)
      const { data: tp } = await supabase.from('topics').select('name').eq('subject_id', subjectId)
      const out = await analyzeMaterial({
        imageBase64: b64, mimeType: file.type, subjectName,
        knownTopics: (tp || []).map((t) => t.name),
      })
      setResult(out)
    } catch (e) {
      setErr('הניתוח נכשל. ודאו שפונקציית Gemini פרוסה ושמפתח ה-API מוגדר. ' + String(e))
    } finally { setBusy(false) }
  }

  async function save() {
    if (!result) return
    setBusy(true); setErr('')
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      const origin = lastYear ? 'חזרה' : 'השנה'

      // 1) נושא — קיים או חדש
      let topicId = null
      if (result.topic) {
        const { data: exist } = await supabase.from('topics')
          .select('id').eq('subject_id', subjectId).eq('name', result.topic).maybeSingle()
        if (exist) topicId = exist.id
        else {
          const { data: ins } = await supabase.from('topics')
            .insert({ subject_id: subjectId, name: result.topic, origin }).select('id').single()
          topicId = ins?.id
        }
      }

      // 2) העלאת התמונה לאחסון (לא חוסם אם נכשל)
      let storagePath = null
      if (file && uid) {
        storagePath = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}`
        await supabase.storage.from('materials').upload(storagePath, file).catch(() => {})
      }

      // 3) חומר + סיכום
      const { data: mat } = await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, title: result.topic || 'חומר',
        kind: 'image', storage_path: storagePath, origin, summary_md: result.summary_md || '',
      }).select('id').single()

      // 4) שאלות
      if (Array.isArray(result.questions) && result.questions.length) {
        await supabase.from('questions').insert(result.questions.map((q) => ({
          subject_id: subjectId, topic_id: topicId, material_id: mat?.id,
          q: q.q, choices: q.choices, answer: q.answer,
          difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
        })))
      }
      // 5) כרטיסיות
      if (Array.isArray(result.flashcards) && result.flashcards.length) {
        await supabase.from('flashcards').insert(result.flashcards.map((c) => ({
          subject_id: subjectId, topic_id: topicId, front: c.front, back: c.back,
        })))
      }
      nav.reset('subject', { id: subjectId })
    } catch (e) {
      setErr('שמירה נכשלה: ' + String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">העלה חומר</h1>
      <div className="text-muted text-sm mb-4">{subjectName}</div>

      <div className="card">
        <div className="border-2 border-dashed border-line rounded-[14px] p-6 text-center flex flex-col gap-3 items-center">
          <div className="text-3xl">📎</div>
          <div className="font-semibold">צלם או בחר קובץ — תמונה של המחברת / דף עבודה</div>
          <div className="text-[12.5px] text-muted">בלי לתייג נושא — המערכת תזהה לבד.</div>
          <input type="file" accept="image/*" capture="environment"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null) }}
            className="text-sm" />
        </div>

        <label className="flex items-center gap-2 mt-4 text-[14.5px] font-semibold cursor-pointer">
          <input type="checkbox" checked={lastYear} onChange={(e) => setLastYear(e.target.checked)}
            className="w-[18px] h-[18px]" />
          זה חומר משנה שעברה (לחזרה)
        </label>
        <div className="text-[12px] text-muted mt-1">לסמן רק בהתחלה — בהמשך המערכת תזהה לבד.</div>

        {!result && (
          <button className="btn btn-primary btn-wide mt-4" onClick={analyze} disabled={!file || busy}>
            {busy ? 'מנתח…' : 'נתח עם Gemini'}
          </button>
        )}
        {err && <div className="text-bad text-[13.5px] mt-3">{err}</div>}
      </div>

      {result && (
        <div className="card mt-3">
          <div className="text-good font-extrabold mb-1">✅ נותח — זיהוי אוטומטי</div>
          <div className="text-[14.5px]">נושא שזוהה: <b>{result.topic}</b></div>
          <div className="text-[13.5px] text-muted mt-1">
            נוצרו: {result.questions?.length || 0} שאלות · {result.flashcards?.length || 0} כרטיסיות.
          </div>
          <div className="whitespace-pre-line text-[14px] mt-3 pt-3 border-t border-line">{result.summary_md}</div>
          <button className="btn btn-primary btn-wide mt-4" onClick={save} disabled={busy}>
            {busy ? 'שומר…' : 'שמור למקצוע'}
          </button>
        </div>
      )}
    </div>
  )
}
