import { useState } from 'react'
import Icon from '../components/Icon'
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
  const [status, setStatus] = useState([])   // מצב כל קובץ בזמן הניתוח: wait | run | done | fail | skip

  async function onPick(list) {
    setResults(null); setChosen([]); setErr('')
    const picked = Array.from(list || [])
    if (!picked.length) return
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
      // תצוגה מקדימה — כדי לזהות לפי התוכן איזה דף זה (שם הקובץ לא אומר כלום)
      const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
      entries.push({ file: f, hash: h, kind: kindOf(f), dupe, url })
    }
    // מצטבר: אפשר לצלם כמה דפים בזה אחר זה ולהוסיף גם קבצים (בלי כפילות של אותו קובץ)
    setFiles((prev) => [...prev, ...entries.filter((e) => !e.hash || !prev.some((p) => p.hash === e.hash))])
    if (problems.length) setErr(problems.join('\n'))
  }

  function removeFile(i) {
    setFiles((arr) => arr.filter((_, j) => j !== i))
  }

  const setName = (ci, val) => setChosen((arr) => arr.map((x, j) => j === ci ? { ...x, name: val } : x))

  async function analyze() {
    if (!files.length) return
    setBusy(true); setErr('')
    const st = files.map((f) => (f.dupe ? 'skip' : 'wait'))
    setStatus(st.slice())
    const mark = (fi, s) => { st[fi] = s; setStatus(st.slice()) }
    try {
      const { data: tp } = await supabase.from('topics').select('name').eq('subject_id', subjectId)
      const knownTopics = (tp || []).map((t) => t.name)
      setTopicsList([...knownTopics])
      const res = []
      const flat = []
      for (let fi = 0; fi < files.length; fi++) {
        const { file } = files[fi]
        // קובץ שכבר הועלה למקצוע — מדלגים אוטומטית (לא מנתחים ולא שומרים שוב)
        if (files[fi].dupe) { res[fi] = { source_text: null, topics: [], error: null, skipped: true }; continue }
        mark(fi, 'run')
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
          mark(fi, 'done')
          for (const t of (out.topics || [])) {
            // הדפים הבאים באותה העלאה יכירו גם את הנושאים שזוהו עכשיו — כדי לא לפצל אותו פרק לשני נושאים
            if (t.topic && !knownTopics.includes(t.topic)) knownTopics.push(t.topic)
            flat.push({
              fileIdx: fi, name: t.topic || '', summary_md: t.summary_md || '',
              questions: t.questions || [], flashcards: t.flashcards || [],
            })
          }
        } catch (e) {
          res[fi] = { source_text: null, topics: [], error: String(e) }
          mark(fi, 'fail')
        }
      }
      setTopicsList([...knownTopics])
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
          // כל הנושאים של אותו דף מצביעים על אותו קובץ, כדי שכולם יופיעו ב"החומרים שהעליתי"
          kind: files[fi].kind, storage_path: storagePaths[fi] || null, origin,
          summary_md: onlyPractice ? '' : (ct.summary_md || ''),
          content_hash: files[fi].hash ? (first ? files[fi].hash : `${files[fi].hash}:${topicId}`) : null,
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
  const analyzable = files.length - dupeCount   // כמה באמת ינותחו (בלי הכפולים)

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] tracking-tight">{results ? 'נותח!' : 'העלאת חומר'}</h1>
      <div className="text-[13.5px] text-muted mt-1.5 mb-4 leading-relaxed">
        {results
          ? `${analyzable > 1 ? `${analyzable} קבצים · ` : ''}${chosen.length} נושאים. אפשר לשנות שם או לבחור נושא קיים — נושאים עם אותו שם יתאחדו.`
          : 'אפשר כמה קבצים יחד. בלי לתייג נושא — המערכת תזהה לבד.'}
      </div>

      {!results && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="up-big up-big-lime">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></svg>
              <span className="font-disp font-extrabold text-[18px]">צלם</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPick(e.target.files); e.target.value = '' }} />
            </label>
            <label className="up-big">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M12 10v6M9 13h6" /></svg>
              <span className="flex flex-col items-start gap-px">
                <span className="font-disp font-extrabold text-[18px]">בחר קבצים</span>
                <span className="text-[12px] text-muted">תמונות, PDF</span>
              </span>
              <input type="file" multiple accept="image/*,application/pdf,text/plain,.txt" className="hidden" onChange={(e) => { onPick(e.target.files); e.target.value = '' }} />
            </label>
          </div>

          {files.length > 0 && (
            <>
              <div className="home-h2 mt-5 mb-2">
                <h2 className="!text-[18px]">נבחרו {files.length} {files.length === 1 ? 'קובץ' : 'קבצים'}</h2>
                {dupeCount > 0 && <span>{dupeCount === 1 ? 'אחד כבר הועלה' : `${dupeCount} כבר הועלו`} — נדלג</span>}
              </div>
              <div className="flex flex-col gap-2">
                {files.map((fe, i) => (
                  <div key={i} className="milky-row !py-2 !px-2.5" style={fe.dupe ? { opacity: 0.55 } : undefined}>
                    <span className="up-thumb">{fe.url ? <img src={fe.url} alt="" /> : <Icon name={fe.kind === 'image' ? 'image' : 'file'} />}</span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="font-semibold text-[14px] truncate" dir="ltr" style={{ textAlign: 'right' }}>{fe.file.name}</span>
                      <FileStatus dupe={fe.dupe} s={busy ? status[i] : null} />
                    </span>
                    {!busy && (
                      <button type="button" onClick={() => removeFile(i)} aria-label="הסר קובץ" className="up-x">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 mt-4">
            <label className="milky-row !items-start cursor-pointer">
              <input type="checkbox" checked={lastYear} onChange={(e) => setLastYear(e.target.checked)} className="w-5 h-5 mt-0.5 flex-none" style={{ accentColor: 'var(--primary)' }} />
              <span className="flex flex-col gap-0.5">
                <span className="font-bold text-[14.5px]">חומר משנה שעברה (לחזרה)</span>
                <span className="text-[12px] text-muted">חל על כל הקבצים שנבחרו</span>
              </span>
            </label>
            <label className="milky-row !items-start cursor-pointer">
              <input type="checkbox" checked={onlyPractice} onChange={(e) => setOnlyPractice(e.target.checked)} className="w-5 h-5 mt-0.5 flex-none" style={{ accentColor: 'var(--primary)' }} />
              <span className="flex flex-col gap-0.5">
                <span className="font-bold text-[14.5px]">רק תרגולים (בלי סיכום)</span>
                <span className="text-[12px] text-muted">חומר חדש ללמוד ממנו → בלי סימון. דף תרגילים → סמנו.</span>
              </span>
            </label>
          </div>

          {busy && (() => {
            const total = status.filter((s) => s !== 'skip').length
            const fin = status.filter((s) => s === 'done' || s === 'fail').length
            return (
              <div className="mt-4 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <span className="up-spin" />
                  {total > 1 ? `מנתח קובץ ${Math.min(fin + 1, total)} מתוך ${total}…` : 'מנתח את החומר…'}
                </div>
                <div className="up-bar"><i style={{ width: `${Math.max(6, (fin / Math.max(total, 1)) * 100)}%` }} /></div>
                <div className="text-[12px] text-muted">כל דף לוקח בערך חצי דקה. אפשר להשאיר את המסך פתוח ולחכות.</div>
              </div>
            )
          })()}

          <button type="button" className="ts-practice mt-4 !h-[56px] !rounded-[28px] !text-[17px]" onClick={analyze} disabled={!analyzable || busy}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
            {busy ? 'מנתח…' : !analyzable && files.length ? 'כל הקבצים כבר הועלו' : analyzable > 1 ? `נתח ${analyzable} קבצים` : 'נתח חומר'}
          </button>
        </>
      )}
      {err && <div className="text-[13.5px] mt-3 leading-relaxed whitespace-pre-line font-semibold" style={{ color: 'var(--bad)' }}>{err}</div>}

      {results && (
        <div className="flex flex-col gap-4">
          {files.map((fe, fi) => {
            const rows = chosen.map((c, ci) => ({ c, ci })).filter((x) => x.c.fileIdx === fi)
            const r = results[fi]
            return (
              <div key={fi} className="flex flex-col gap-2">
                {files.length > 1 && (
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                    {fe.url && !r?.error && <span className="up-thumb !w-8 !h-8 !rounded-[9px]"><img src={fe.url} alt="" /></span>}
                    <span className="truncate" dir="ltr">{fe.file.name}</span>
                    {rows.length > 1 && <span className="tp-badge flex-none" style={{ background: 'var(--primary)' }}>זוהו {rows.length} נושאים</span>}
                  </div>
                )}
                {r?.skipped ? (
                  <div className="milky-row text-muted text-[13px]">כבר הועלה למקצוע — דילגנו.</div>
                ) : r?.error ? (
                  <div className="milky-row !flex-col !items-stretch !gap-2">
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--bad)' }}>ניתוח נכשל לדף הזה — נסו לצלם אותו שוב, ברור יותר.</div>
                    {fe.url && <img src={fe.url} alt="הדף שלא נותח" className="up-preview" />}
                  </div>
                ) : rows.length === 0 ? (
                  <div className="milky-row text-muted text-[13px]">לא זוהה תוכן.</div>
                ) : rows.map(({ c, ci }, k) => (
                  <div key={ci} className="milky-row !flex-col !items-stretch !gap-2">
                    <label className="block text-[13px] font-bold text-muted">
                      נושא {rows.length > 1 ? k + 1 : ''}
                    </label>
                    <input className="field" value={c.name}
                      onChange={(e) => setName(ci, e.target.value)}
                      placeholder="שם הנושא — או בחר/י מהקיימים למטה" />
                    {topicsList.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[11.5px] text-muted">קיימים:</span>
                        {topicsList.map((t) => (
                          <button key={t} type="button" onClick={() => setName(ci, t)}
                            className={`px-2.5 py-1 rounded-full text-[12.5px] border transition ${c.name === t ? 'bg-primary text-[color:var(--on-fill)] border-primary font-semibold' : 'border-line text-muted'}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="text-[12px] text-muted mt-1.5">
                      {c.questions?.length || 0} שאלות · {c.flashcards?.length || 0} כרטיסיות
                    </div>
                    {!onlyPractice && c.summary_md && (
                      <details>
                        <summary className="text-[12.5px] text-primary font-semibold cursor-pointer">הצג סיכום</summary>
                        <div className="paper mt-2"><Markdown text={c.summary_md} examBox /></div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          <button type="button" className="ts-practice !h-[56px] !rounded-[28px] !text-[17px]" onClick={save} disabled={busy || !chosen.some((c) => c.name.trim())}>
            {busy ? 'שומר…' : 'שמור למקצוע'}
          </button>
        </div>
      )}
    </div>
  )
}

// מצב הקובץ ברשימה: לפני הניתוח / תוך כדי / אחרי
function FileStatus({ dupe, s }) {
  if (dupe) return <span className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>{`כבר הועלה (${dupe}) — נדלג`}</span>
  if (s === 'run') return <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--primary)' }}><span className="up-spin !w-3 !h-3" />מנתח…</span>
  if (s === 'done') return <span className="text-[12px] font-semibold" style={{ color: 'var(--good)' }}>✓ נותח</span>
  if (s === 'fail') return <span className="text-[12px] font-semibold" style={{ color: 'var(--bad)' }}>הניתוח נכשל</span>
  if (s === 'wait') return <span className="text-[12px] font-semibold text-muted">ממתין בתור</span>
  return <span className="text-[12px] font-semibold text-muted">מוכן לניתוח</span>
}
