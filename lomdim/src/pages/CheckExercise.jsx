import { useState, useEffect } from 'react'
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
  const [history, setHistory] = useState([])
  const [showHist, setShowHist] = useState(false)

  async function loadHistory() {
    const { data } = await supabase.from('materials').select('id, title, source_text, storage_path, created_at')
      .eq('subject_id', subjectId).eq('kind', 'check').order('created_at', { ascending: false })
    setHistory(data || [])
  }
  useEffect(() => { loadHistory() }, [subjectId])

  // שמירת הבדיקה כהיסטוריה (בטבלת materials, kind='check', בלי נושא — לא מופיע ברשימת החומרים)
  async function saveCheck(out, theFile) {
    try {
      const { data: u } = await supabase.auth.getUser()
      const uid = u.user?.id
      let storagePath = null
      if (theFile && uid) {
        storagePath = `${uid}/check-${Date.now()}`
        await supabase.storage.from('materials').upload(storagePath, theFile).catch(() => {})
      }
      await supabase.from('materials').insert({
        subject_id: subjectId, kind: 'check', title: out.exercise || 'תרגיל שנבדק',
        storage_path: storagePath, source_text: JSON.stringify(out),
      })
      loadHistory()
    } catch { /* לא חוסם */ }
  }

  async function deleteCheck(e, m) {
    e.stopPropagation()
    if (!window.confirm('למחוק את הבדיקה השמורה?')) return
    await supabase.from('materials').delete().eq('id', m.id)
    if (m.storage_path) await supabase.storage.from('materials').remove([m.storage_path]).catch(() => {})
    loadHistory()
  }

  async function ensureTopic(name) {
    const { data: ex } = await supabase.from('topics').select('id').eq('subject_id', subjectId).eq('name', name).maybeSingle()
    if (ex) return ex.id
    const { data: ins } = await supabase.from('topics').insert({ subject_id: subjectId, name, origin: 'השנה' }).select('id').single()
    return ins?.id
  }

  async function addToReinforce(result) {
    const r = result || res
    if (!r) return
    setAdding(true); setErr('')
    try {
      const topicId = await ensureTopic('תרגילים שבדקתי')
      const src = [r.exercise, r.feedback, r.reteach].filter(Boolean).join('\n')
      const { questions } = await generateQuestions({ subjectName, topic: 'תרגילים שבדקתי', sourceText: src, count: 5, learner: profile })
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
      saveCheck(out, file) // שמירה להיסטוריה
      const hasMistake = out.correct === false || (Array.isArray(out.steps) && out.steps.some((s) => s.ok === false))
      if (hasMistake) addToReinforce(out) // אוטומטי — טעות נכנסת ל"לחיזוק"
    } catch {
      setErr('הבדיקה נכשלה. נסו לצלם את הפתרון חד וברור יותר.')
    } finally { setBusy(false) }
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">בדוק תרגיל שפתרתי</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      {/* היסטוריית בדיקות — מקופלת תחת חץ */}
      {history.length > 0 && (
        <>
          <button className="list-title flex items-center gap-2 w-full !mt-0" onClick={() => setShowHist((v) => !v)}>
            <span className="flex-1 text-start">📷 בדיקות קודמות ({history.length})</span>
            <span className="text-[12px] font-bold">{showHist ? 'הסתר ▲' : 'הצג ▼'}</span>
          </button>
          {showHist && (
            <div className="card mb-3">
              {history.map((m) => {
                let saved = null
                try { saved = JSON.parse(m.source_text) } catch { /* ignore */ }
                const ok = saved?.correct
                return (
                  <div key={m.id} className="flex items-center gap-2 w-full py-2.5 border-b border-line last:border-0">
                    <button onClick={() => { setRes(saved); setFile(null); setAdded(false); setShowHist(false) }}
                      className="flex-1 min-w-0 text-start">
                      <div className="text-[14px] font-semibold truncate">{m.title || 'תרגיל'}</div>
                      <div className="text-[12px] text-muted">
                        {new Date(m.created_at).toLocaleDateString('he-IL')}
                        {saved != null && <span className={ok ? 'text-good' : 'text-bad'}> · {ok ? 'נכון ✓' : 'הייתה טעות'}</span>}
                      </div>
                    </button>
                    <button onClick={(ev) => deleteCheck(ev, m)} title="מחק"
                      className="w-8 h-8 rounded-[9px] grid place-items-center text-[15px]" style={{ color: 'var(--bad)' }}>🗑</button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <div className="card">
        <div className="dropzone">
          <div className="text-3xl">📷</div>
          <div className="font-semibold text-[15px] text-ink">צלמו את התרגיל הפתור מהמחברת</div>
          <div className="text-[12.5px]">המערכת תקרא את הפתרון ותגיד איפה הטעות (אם יש).</div>
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
          {!res.correct && (adding || added) && (
            <div className="mt-4 text-[14px] font-semibold text-good">
              {added ? '✓ נוסף אוטומטית ל"לחיזוק" — יחזור לתרגול' : '📓 מוסיף ל"לחיזוק"…'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
