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
const kindOf = (f) => isText(f) ? 'text' : f.type === 'application/pdf' ? 'pdf' : 'image'

export default function Upload({ nav, params }) {
  const { subjectId, subjectName } = params
  const { profile } = useAuth()
  const [files, setFiles] = useState([])       // [{ file, hash, kind, dupe }]
  const [lastYear, setLastYear] = useState(false)
  const [onlyPractice, setOnlyPractice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null) // מקביל ל-files: [{ source_text, topics, error }]
  const [topicsList, setTopicsList] = useState([])
  const [chosen, setChosen] = useState([])     // [{ fileIdx, name, summary_md, questions, flashcards }]
  const [err, setErr] = useState('')

  async function onPick(list) {
    setResults(null); setChosen([]); setErr('')
    const picked = Array.from(list || [])
    if (!picked.length) { setFiles([]); return }
    const entries = []
    const problems = []
    for (const f of picked) {
      if (isWord(f)) {
        problems.push(`«${f.name}» — קובצי Word לא נתמכים. שמרו כ-PDF ומעלים אותו (או צילום מסך).`)
        continue
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        problems.push(`«${f.name}» גדול מדי (${(f.size / 1024 / 1024).toFixed(1)}MB) — צלמו רק את הדפים הרלוונטיים.`)
        continue
      }
      const h = await fileHash(f)
      let dupe = null
      if (h) {
        const { data } = await supabase.from('materials')
          .select('id, created_at').eq('subject_id', subjectId).eq('content_hash', h).maybeSingle()
        if (data) dupe = new Date(data.created_at).toLocaleDateString('he-IL')
      }
      entries.push({ file: f, hash: h, kind: kindOf(f), dupe })
    }
    setFiles(entries)
    if (problems.length) setErr(problems.join('\n'))
  }

  function removeFile(i) {
    setFiles((arr) => arr.filter((_, j) => j !== i))
  }

  async function analyze() {
    if (!files.length) return
    setBusy(true); setErr('')
    try {
      const { data: tp } = await supabase.from('topics').select('name').eq('subject_id', subjectId)
      const knownTopics = (tp || []).map((t) => t.name)
      setTopicsList(knownTopics)
      const res = []
      const flat = []
      for (let fi = 0; fi < files.length; fi++) {
        const { file } = files[fi]
        try {
          let out
          if (isText(file)) {
            out = await analyzeMaterial({ text: await readText(file), subjectName, knownTopics, learner: profile, noSummary: onlyPractice })
          } else {
            out = await analyzeMaterial({
              imageBase64: await fileToBase64(file), mimeType: file.type, subjectName, knownTopics, learner: profile, noSummary: onlyPractice,
            })
          }
          res[fi] = { source_text: out.source_text || null, topics: out.topics || [], error: null }
          for (const t of (out.topics || [])) {
            flat.push({
              fileIdx: fi, name: t.topic || '', summary_md: t.summary_md || '',
              questions: t.questions || [], flashcards: t.flashcards || [],
            })
          }
        } catch (e) {
          res[fi] = { source_text: null, topics: [], error: String(e) }
        }
      }
      setResults(res)
      setChosen(flat)
      if (flat.length === 0) setErr('לא זוהה תוכן באף קובץ. נסו לצלם ברור יותר / בתאורה טובה.')
    } catch (e) {
      setErr('הניתוח נכשל. ודאו חיבור לאינטרנט. ' + String(e))
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

      // כל קובץ מועלה פעם אחת לאחסון
      const storagePaths = {}
      for (let fi = 0; fi < files.length; fi++) {
        const { file } = files[fi]
        if (file && uid && !isText(file)) {
          const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}`
          await supabase.storage.from('materials').upload(path, file).catch(() => {})
          storagePaths[fi] = path
        }
      }

      // חומר לכל נושא; hash/מקור/קובץ מצורפים רק לחומר הראשון של כל קובץ.
      // נושאים בעלי אותו שם מתאחדים אוטומטית (ensureTopic מחזיר את אותו topic_id).
      const usedFirst = {}
      for (const ct of active) {
        const fi = ct.fileIdx
        const topicId = await ensureTopic(ct.name.trim(), origin)
        const first = !usedFirst[fi]
        usedFirst[fi] = true
        const { data: mat } = await supabase.from('materials').insert({
          subject_id: subjectId, topic_id: topicId, title: ct.name.trim(),
          kind: files[fi].kind, storage_path: first ? (storagePaths[fi] || null) : null, origin,
          summary_md: onlyPractice ? '' : (ct.summary_md || ''),
          content_hash: first ? (files[fi].hash || null) : null,
          source_text: first ? (results[fi]?.source_text || null) : null,
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

  const dupeCount = files.filter((f) => f.dupe).length

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">העלה חומר</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="card">
        <div className="border-2 border-dashed border-line rounded-[14px] p-6 text-center flex flex-col gap-3 items-center">
          <div className="text-3xl">📎</div>
          <div className="font-semibold text-[15.5px]">צלם או בחר קבצים — אפשר כמה יחד</div>
          <div className="text-[12.5px] text-muted">מחברת, דף עבודה או PDF. בלי לתייג נושא — המערכת תזהה לבד.</div>
          <input type="file" multiple accept="image/*,application/pdf,text/plain,.txt"
            onChange={(e) => onPick(e.target.files)}
            className="text-sm" />
        </div>

        {files.length > 0 && (
          <div className="mt-4 text-[13.5px]">
            <div className="font-bold mb-1.5">נבחרו {files.length} {files.length === 1 ? 'קובץ' : 'קבצים'}:</div>
            <ul className="flex flex-col gap-1">
              {files.map((fe, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>{fe.kind === 'pdf' ? '📕' : fe.kind === 'text' ? '📄' : '🖼️'}</span>
                  <span className="flex-1 truncate">{fe.file.name}</span>
                  {fe.dupe && <span className="text-accent text-[12px] font-semibold whitespace-nowrap">כבר הועלה</span>}
                  <button onClick={() => removeFile(i)} aria-label="הסר קובץ"
                    className="w-6 h-6 grid place-items-center rounded-full border border-line text-muted hover:text-bad hover:border-bad text-[13px] leading-none shrink-0">✕</button>
                </li>
              ))}
            </ul>
            {dupeCount > 0 && (
              <div className="text-accent text-[12.5px] mt-1.5">ℹ️ {dupeCount} מהקבצים כבר הועלו למקצוע — אפשר להסירם ולבחור מחדש אם לא צריך שוב.</div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 mt-4 text-[14.5px] font-semibold cursor-pointer">
          <input type="checkbox" checked={lastYear} onChange={(e) => setLastYear(e.target.checked)}
            className="w-[18px] h-[18px]" />
          זה חומר משנה שעברה (לחזרה)
        </label>
        <div className="text-[12px] text-muted mt-1">חל על כל הקבצים שנבחרו. לסמן רק בהתחלה — בהמשך המערכת תזהה לבד.</div>

        <label className="flex items-center gap-2 mt-3 text-[14.5px] font-semibold cursor-pointer">
          <input type="checkbox" checked={onlyPractice} onChange={(e) => setOnlyPractice(e.target.checked)}
            className="w-[18px] h-[18px]" />
          רק תרגולים (בלי סיכום)
        </label>
        <div className="text-[12px] text-muted mt-1">חומר חדש שצריך ללמוד ממנו → תנו לו לסכם. דף תרגילים / חומר שכבר סיכמת → סמנו כאן.</div>

        {!results && (
          <button className="btn btn-primary btn-wide mt-4" onClick={analyze} disabled={!files.length || busy}>
            {busy ? `מנתח…` : files.length > 1 ? `נתח ${files.length} קבצים` : 'נתח חומר'}
          </button>
        )}
        {err && <div className="text-bad text-[13.5px] mt-3 leading-relaxed whitespace-pre-line">{err}</div>}
      </div>

      {results && (
        <div className="card mt-3">
          <div className="text-good font-extrabold mb-1">✅ נותח</div>
          <div className="text-[13px] text-muted mb-3">
            {files.length > 1 ? `${files.length} קבצים נותחו. ` : ''}
            אפשר לשנות שמות או לבחור נושא קיים — נושאים בעלי אותו שם יתאחדו אוטומטית.
          </div>

          <datalist id="existing-topics">
            {topicsList.map((t) => <option key={t} value={t} />)}
          </datalist>

          {files.map((fe, fi) => {
            const rows = chosen.map((c, ci) => ({ c, ci })).filter((x) => x.c.fileIdx === fi)
            const r = results[fi]
            return (
              <div key={fi} className="mb-4 last:mb-0">
                {files.length > 1 && (
                  <div className="text-[12.5px] font-bold text-primary mb-2 flex items-center gap-2">
                    <span className="truncate">{fe.kind === 'pdf' ? '📕' : fe.kind === 'text' ? '📄' : '🖼️'} {fe.file.name}</span>
                  </div>
                )}
                {r?.error ? (
                  <div className="text-bad text-[13px] mb-2">ניתוח נכשל לקובץ זה — נסו לצלם ברור יותר.</div>
                ) : rows.length === 0 ? (
                  <div className="text-muted text-[13px] mb-2">לא זוהה תוכן.</div>
                ) : rows.map(({ c, ci }, k) => (
                  <div key={ci} className="mb-3 pb-3 border-b border-line last:border-0">
                    <label className="block text-[13px] font-bold text-muted mb-1.5">
                      נושא {rows.length > 1 ? k + 1 : ''}
                    </label>
                    <input className="field" list="existing-topics" value={c.name}
                      onChange={(e) => setChosen((arr) => arr.map((x, j) => j === ci ? { ...x, name: e.target.value } : x))}
                      placeholder="שם הנושא" />
                    <div className="text-[12px] text-muted mt-1">
                      {c.questions?.length || 0} שאלות · {c.flashcards?.length || 0} כרטיסיות
                    </div>
                    {!onlyPractice && c.summary_md && (
                      <details className="mt-2">
                        <summary className="text-[12.5px] text-primary font-semibold cursor-pointer">הצג סיכום</summary>
                        <div className="mt-2 text-[14px] leading-relaxed"><Markdown text={c.summary_md} /></div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          <button className="btn btn-primary btn-wide mt-1" onClick={save} disabled={busy || !chosen.some((c) => c.name.trim())}>
            {busy ? 'שומר…' : 'שמור למקצוע'}
          </button>
        </div>
      )}
    </div>
  )
}
