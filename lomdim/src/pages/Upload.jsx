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
  const [onlyPractice, setOnlyPractice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [topicsList, setTopicsList] = useState([])
  const [chosen, setChosen] = useState([])   // [{ name, summary_md, questions, flashcards }]
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
      setTopicsList(knownTopics)
      let out
      if (isText(file)) {
        out = await analyzeMaterial({ text: await readText(file), subjectName, knownTopics, learner: profile, noSummary: onlyPractice })
      } else {
        out = await analyzeMaterial({
          imageBase64: await fileToBase64(file), mimeType: file.type, subjectName, knownTopics, learner: profile, noSummary: onlyPractice,
        })
      }
      setResult(out)
      setChosen((out.topics || []).map((t) => ({
        name: t.topic || '', summary_md: t.summary_md || '',
        questions: t.questions || [], flashcards: t.flashcards || [],
      })))
    } catch (e) {
      const msg = String(e)
      setErr(msg.includes('parse_failed')
        ? 'המערכת החזירה תשובה שלא הצלחנו לקרוא. נסו שוב, או צלמו את הדף בתאורה טובה יותר / חד יותר.'
        : 'הניתוח נכשל. ודאו חיבור לאינטרנט ושמפתח ה-API מוגדר. ' + msg)
    } finally { setBusy(false) }
  }

  async function ensureTopic(name, origin) {
    const { data: exist } = await supabase.from('topics')
      .select('id').eq('subject_id', subjectId).eq('name', name).maybeSingle()
    if (exist) return exist.id
    const { data: ins } = await supabase.from('topics')
      .insert({ subject_id: subjectId, name, origin }).select('id').single()
    return ins?.id
  }

  async function save() {
    const active = chosen.filter((c) => c.name.trim())
    if (!active.length) return
    setBusy(true); setErr('')
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      const origin = lastYear ? 'חזרה' : 'השנה'
      const kind = isText(file) ? 'text' : file?.type === 'application/pdf' ? 'pdf' : 'image'

      // העלאת הקובץ פעם אחת
      let storagePath = null
      if (file && uid && !isText(file)) {
        storagePath = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}`
        await supabase.storage.from('materials').upload(storagePath, file).catch(() => {})
      }

      // כל נושא שזוהה נשמר בנפרד עם השאלות/הכרטיסיות שלו
      for (let i = 0; i < active.length; i++) {
        const ct = active[i]
        const topicId = await ensureTopic(ct.name.trim(), origin)
        const { data: mat } = await supabase.from('materials').insert({
          subject_id: subjectId, topic_id: topicId, title: ct.name.trim(),
          kind, storage_path: i === 0 ? storagePath : null, origin,
          summary_md: onlyPractice ? '' : (ct.summary_md || ''),
          content_hash: i === 0 ? hash : null,
          source_text: i === 0 ? (result.source_text || null) : null,
        }).select('id').single()
        if (Array.isArray(ct.questions) && ct.questions.length) {
          await supabase.from('questions').insert(ct.questions.map((q) => ({
            subject_id: subjectId, topic_id: topicId, material_id: mat?.id,
            q: q.q, choices: q.choices, answer: q.answer,
            difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
          })))
        }
        if (Array.isArray(ct.flashcards) && ct.flashcards.length) {
          await supabase.from('flashcards').insert(ct.flashcards.map((c) => ({
            subject_id: subjectId, topic_id: topicId, front: c.front, back: c.back, context: c.context || null,
          })))
        }
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

        <label className="flex items-center gap-2 mt-3 text-[14.5px] font-semibold cursor-pointer">
          <input type="checkbox" checked={onlyPractice} onChange={(e) => setOnlyPractice(e.target.checked)}
            className="w-[18px] h-[18px]" />
          רק תרגולים (בלי סיכום)
        </label>
        <div className="text-[12px] text-muted mt-1">מכין רק שאלות וכרטיסיות, בלי לייצר סיכום עיוני — טוב אם כבר יש לך סיכומים.</div>

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
          <div className="text-good font-extrabold mb-1">✅ נותח</div>
          <div className="text-[13px] text-muted mb-3">
            {chosen.length > 1 ? `זוהו ${chosen.length} נושאים בדף הזה — כל אחד יישמר בנפרד.` : 'זוהה נושא אחד.'} אפשר לשנות שמות או לבחור נושא קיים.
          </div>

          <datalist id="existing-topics">
            {topicsList.map((t) => <option key={t} value={t} />)}
          </datalist>

          {chosen.map((ct, i) => (
            <div key={i} className="mb-3 pb-3 border-b border-line last:border-0">
              <label className="block text-[13px] font-bold text-muted mb-1.5">נושא {chosen.length > 1 ? i + 1 : ''}</label>
              <input className="field" list="existing-topics" value={ct.name}
                onChange={(e) => setChosen((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                placeholder="שם הנושא" />
              <div className="text-[12px] text-muted mt-1">
                {ct.questions?.length || 0} שאלות · {ct.flashcards?.length || 0} כרטיסיות
              </div>
              {!onlyPractice && ct.summary_md && (
                <details className="mt-2">
                  <summary className="text-[12.5px] text-primary font-semibold cursor-pointer">הצג סיכום</summary>
                  <div className="mt-2 text-[14px] leading-relaxed"><Markdown text={ct.summary_md} /></div>
                </details>
              )}
            </div>
          ))}

          <button className="btn btn-primary btn-wide mt-1" onClick={save} disabled={busy || !chosen.some((c) => c.name.trim())}>
            {busy ? 'שומר…' : 'שמור למקצוע'}
          </button>
        </div>
      )}
    </div>
  )
}
