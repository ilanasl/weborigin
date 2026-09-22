import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeMaterial, fileHash } from '../lib/gemini'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'

const MAX_MB = 12 // מעל זה קריאת Gemini אחת נכשלת/יקרה — עדיף לפצל

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
const readText = (file) => file.text()

const isText = (f) => f.type === 'text/plain' || /\.txt$/i.test(f.name)
const isWord = (f) => /\.(docx?|rtf)$/i.test(f.name) ||
  f.type.includes('word') || f.type.includes('officedocument.wordprocessing')

export default function Upload({ nav, params }) {
  const { subjectId, subjectName } = params
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [hash, setHash] = useState(null)
  const [lastYear, setLastYear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  async function onPick(f) {
    setResult(null); setErr(''); setNote(''); setHash(null); setFile(null)
    if (!f) return
    if (isWord(f)) {
      setErr('קובצי Word עדיין לא נתמכים לקריאה ישירה. הכי פשוט: פותחים ב-Word → קובץ → שמירה בשם → PDF, ומעלים את ה-PDF. (או צילום מסך של הדף.)')
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`הקובץ גדול מדי (${(f.size / 1024 / 1024).toFixed(1)}MB). המערכת מנתחת דף/כמה דפים בכל פעם — לקובץ ענק (כמו שיחה שלמה) פצלו לחלקים או צלמו את הדפים הרלוונטיים.`)
      return
    }
    setFile(f)
    // חתימת תוכן → בדיקה אם כבר הועלה
    const h = await fileHash(f)
    setHash(h)
    if (h) {
      const { data } = await supabase.from('materials')
        .select('id, title, created_at').eq('subject_id', subjectId).eq('content_hash', h).maybeSingle()
      if (data) {
        setNote(`הקובץ הזה כבר הועלה למקצוע (${new Date(data.created_at).toLocaleDateString('he-IL')}) — אין צורך שוב.`)
      }
    }
  }

  async function analyze() {
    if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const { data: tp } = await supabase.from('topics').select('name').eq('subject_id', subjectId)
      const knownTopics = (tp || []).map((t) => t.name)
      let out
      if (isText(file)) {
        out = await analyzeMaterial({ text: await readText(file), subjectName, knownTopics, learner: profile })
      } else {
        out = await analyzeMaterial({
          imageBase64: await fileToBase64(file), mimeType: file.type, subjectName, knownTopics, learner: profile,
        })
      }
      setResult(out)
    } catch (e) {
      const msg = String(e)
      setErr(msg.includes('parse_failed')
        ? 'המערכת החזירה תשובה שלא הצלחנו לקרוא. נסו שוב, או צלמו את הדף בתאורה טובה יותר / חד יותר.'
        : 'הניתוח נכשל. ודאו חיבור לאינטרנט ושמפתח ה-API מוגדר. ' + msg)
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

      // 2) העלאת הקובץ לאחסון (לא חוסם אם נכשל)
      let storagePath = null
      if (file && uid && !isText(file)) {
        storagePath = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}`
        await supabase.storage.from('materials').upload(storagePath, file).catch(() => {})
      }

      // 3) חומר + סיכום + חתימת תוכן
      const kind = isText(file) ? 'text' : file?.type === 'application/pdf' ? 'pdf' : 'image'
      const { data: mat } = await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, title: result.topic || 'חומר',
        kind, storage_path: storagePath, origin, summary_md: result.summary_md || '',
        content_hash: hash, source_text: result.source_text || null,
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
          subject_id: subjectId, topic_id: topicId, front: c.front, back: c.back, context: c.context || null,
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
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card">
        <div className="border-2 border-dashed border-line rounded-[14px] p-6 text-center flex flex-col gap-3 items-center">
          <div className="text-3xl">📎</div>
          <div className="font-semibold text-[15.5px]">צלם או בחר קובץ — תמונה של המחברת / דף עבודה / PDF</div>
          <div className="text-[12.5px] text-muted">בלי לתייג נושא — המערכת תזהה לבד.</div>
          <input type="file" accept="image/*,application/pdf,text/plain,.txt"
            onChange={(e) => onPick(e.target.files?.[0] || null)}
            className="text-sm" />
        </div>

        <label className="flex items-center gap-2 mt-4 text-[14.5px] font-semibold cursor-pointer">
          <input type="checkbox" checked={lastYear} onChange={(e) => setLastYear(e.target.checked)}
            className="w-[18px] h-[18px]" />
          זה חומר משנה שעברה (לחזרה)
        </label>
        <div className="text-[12px] text-muted mt-1">לסמן רק בהתחלה — בהמשך המערכת תזהה לבד.</div>

        {note && <div className="text-accent text-[13.5px] mt-3 bg-accent-soft rounded-[10px] p-2.5">ℹ️ {note}</div>}

        {!result && (
          <button className="btn btn-primary btn-wide mt-4" onClick={analyze} disabled={!file || busy}>
            {busy ? 'מנתח…' : 'נתח חומר'}
          </button>
        )}
        {err && <div className="text-bad text-[13.5px] mt-3 leading-relaxed">{err}</div>}
      </div>

      {result && (
        <div className="card mt-3">
          <div className="text-good font-extrabold mb-1">✅ נותח — זיהוי אוטומטי</div>
          <div className="text-[15px]">נושא שזוהה: <b>{result.topic}</b></div>
          <div className="text-[13.5px] text-muted mt-1">
            נוצרו: {result.questions?.length || 0} שאלות · {result.flashcards?.length || 0} כרטיסיות.
          </div>
          <div className="mt-3 pt-3 border-t border-line text-[14.5px] leading-relaxed">
            <Markdown text={result.summary_md} />
          </div>
          <button className="btn btn-primary btn-wide mt-4" onClick={save} disabled={busy}>
            {busy ? 'שומר…' : 'שמור למקצוע'}
          </button>
        </div>
      )}
    </div>
  )
}
