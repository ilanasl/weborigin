import { useEffect, useState } from 'react'
import { useG } from '../lib/gender'
import { aiErrorText, aiErrorReason } from '../lib/aiError'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { subjectStyle } from '../lib/examStyle'
import { topicSummary, fetchSourceText, stripNotebookWarnings, generateQuestions, splitSource } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import Markdown from '../components/Markdown'
import ConfirmDialog from '../components/ConfirmDialog'
import WorkNote, { useWorking } from '../components/WorkNote'
import { fetchAll } from '../lib/fetchAll'
import { forget } from '../lib/screenCache'
import { consolidateTopic, needsConsolidation, autoTried, readOff, moveOffTopic, markOffDone } from '../lib/consolidate'
import { GEN_MARK } from '../lib/plan'
import { addMoreQuestions } from '../lib/moreQuestions'
import { isMathSubject, drillTypeOf, VARIANTS } from '../lib/mathDrill'

// מוצג כלשונית של נושא בתוך מחברת הסיכומים (embedded). onChanged — רענון הלשוניות (שם/נושא חדש), onOpen — מעבר ללשונית של נושא אחר
export default function TopicSummary({ nav, params, embedded = false, onChanged, onOpen }) {
  const gx = useG()
  const { subjectId, subjectName, topicId, topicName } = params
  const { profile } = useAuth()
  const [summary, setSummary] = useState(null)
  const [notes, setNotes] = useState([])
  const [aggSource, setAggSource] = useState('')
  const [sourceText, setSourceText] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const [qCount, setQCount] = useState(0)
  // ניהול נושא
  const [otherTopics, setOtherTopics] = useState([])
  const [showManage, setShowManage] = useState(false)
  const [renameVal, setRenameVal] = useState(topicName || '')
  const [name, setName] = useState(topicName || '')   // שם הנושא (אפשר לשנות במקום)
  const [editName, setEditName] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')
  const [askMerge, setAskMerge] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completeNote, setCompleteNote] = useState('')
  const [restTopic, setRestTopic] = useState(null)   // הנושא החדש שנוצר מההמשך
  const [notebook, setNotebook] = useState('')        // סיכומי הדפים מהמחברת בלבד
  const [enrich, setEnrich] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // העברת "סיכום שהוספתי" לנושא אחר
  const [moveNote, setMoveNote] = useState(null)   // { id, to, name }
  const [noteBusy, setNoteBusy] = useState(null)
  const [moreBusy, setMoreBusy] = useState(false)    // "עוד שאלות לנושא"
  const [moreNote, setMoreNote] = useState('')
  const [autoMerging, setAutoMerging] = useState(false)   // איחוד אוטומטי של כמה דפים לסיכום אחד
  const [offs, setOffs] = useState([])          // חומר מתחום אחר שהוצא מהסיכום — ממתין להחלטה
  const [offBusy, setOffBusy] = useState(null)
  const [offNote, setOffNote] = useState(null)  // { id, name } — הנושא שנוצר מההעברה
  const [err, setErr] = useState('')
  const [ref, setRef] = useState('')
  const [fetching, setFetching] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteVal, setPasteVal] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [fetchedSources, setFetchedSources] = useState([])
  const [wantSource, setWantSource] = useState(false)

  useWorking(busy || moreBusy || !!noteBusy || autoMerging || completing || fetching || !!offBusy || removing)

  const drillTopic = isMathSubject(subjectName) && !!drillTypeOf(name)
  const [showKinds, setShowKinds] = useState(false)   // "תרגול לפי סוג"
  const isBible = /תנ["״׳']?ך|מקרא|תורה|נביאים|כתובים/.test(subjectName || '')
  // טקסט מקור מלא רלוונטי רק לספרות/תנ״ך — לא לדקדוק/לשון/מתמטיקה וכו'
  const isLiterary = isBible || /ספרות|שיר|פזמון|יצירה|בלדה|סיפור|פרוזה/.test(subjectName || '')
  const srcKind = isBible ? 'פסוקים' : isLiterary ? 'שיר' : 'טקסט מקור'
  // קישורים למקורות אמינים — ממולאים מראש עם שם השיר/המקור
  const q = encodeURIComponent((ref.trim() || name || '').trim())
  // חיפוש גוגל ממוקד לאתר — הכי אמין להגיע לעמוד הנכון (בלי לנחש נתיבי חיפוש פנימיים)
  const g = (extra) => `https://www.google.com/search?q=${q}${extra ? '%20' + extra : ''}`
  const SOURCES = isBible
    ? [
        { label: 'ספריא', url: g('site:sefaria.org.il') },
        { label: 'ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: 'חיפוש', url: g('פסוקים') },
      ]
    : [
        { label: 'פרויקט בן־יהודה', url: g('site:benyehuda.org') },
        { label: 'ויקיטקסט', url: g('site:he.wikisource.org') },
        { label: 'חיפוש', url: g('שיר%20מלא%20טקסט') },
      ]

  async function savePasted() {
    const t = pasteVal.trim()
    if (!t) return
    setBusy(true); setErr('')
    try {
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור (מהמקור)', source_text: t,
      })
      setPasteVal(''); setPasteMode(false)
      await load(); setShowSource(true)
    } catch (e) {
      setErr('שמירת הטקסט נכשלה. ' + String(e))
    } finally { setBusy(false) }
  }

  async function load() {
    setLoading(true)
    const [{ data: allMats }, { count }, { data: tps }] = await Promise.all([
      supabase.from('materials').select('id, kind, title, summary_md, source_text, created_at')
        .eq('topic_id', topicId).order('created_at', { ascending: false }),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('topic_id', topicId),
      supabase.from('topics').select('id, name').eq('subject_id', subjectId),
    ])
    const mats = allMats || []
    // סיכום מאוחד (kind='summary') מוצג ראשון; אחרת הסיכום העדכני מהדפים שהועלו
    const consolidated = mats.find((m) => m.kind === 'summary' && m.summary_md)
    const pages = mats.filter((m) => m.kind !== 'summary' && m.kind !== 'note')
    // סיכום מאוחד שנשמר לפני התיקון — מנקים בתצוגה את שורות "במחברת כתוב…" (בלי להריץ שוב ובלי קרדיטים)
    // בלי סיכום מאוחד: מציגים את הסיכומים של כל הדפים, לפי סדר ההעלאה (לא רק של הדף האחרון — כדי שדף חדש לא "ידרוס" את הקודמים)
    const pageSums = [...new Set(pages.slice().reverse().map((m) => m.summary_md).filter(Boolean))]
    setSummary((consolidated && stripNotebookWarnings(consolidated.summary_md)) || pageSums.join('\n\n---\n\n') || null)
    setOffs(readOff(consolidated?.summary_md).pending)
    setNotes(mats.filter((m) => m.kind === 'note' && m.summary_md))
    setSourceText(mats.find((m) => m.source_text)?.source_text || null)
    // מקור לאיחוד: כל מה שהועלה לנושא (סיכומי דפים + טקסטים), לא כולל סיכום מאוחד/הערות
    // בלי שורות "⚠️ במחברת כתוב…" מסיכומי הדפים — אלה הערות של ה-AI, לא תוכן המחברת (אחרת הן מתגלגלות ומתרבות)
    setNotebook(pages.map((m) => stripNotebookWarnings(m.summary_md)).filter(Boolean).join('\n\n---\n\n'))
    setAggSource(pages.map((m) => [stripNotebookWarnings(m.summary_md), m.source_text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n---\n\n'))
    setOtherTopics((tps || []).filter((t) => t.id !== topicId))
    setQCount(count || 0)
    setLoading(false)
    // כמה דפים בלי סיכום מאוחד — מאחדים לבד (במקום להציג את כל סיכומי הדפים ברצף, עם חזרות)
    if (needsConsolidation(mats) && !autoTried.has(topicId)) {
      autoTried.add(topicId)
      setAutoMerging(true)
      try {
        if (await consolidateTopic({ subjectId, subjectName, topicId, topicName: name, learner: profile })) { forget(`subject:${subjectId}`); await load() }
      } catch { /* נשאר הסיכום מהדפים; אפשר לנסות שוב מ"ניהול הנושא" */ }
      setAutoMerging(false)
    }
  }

  // העברת "סיכום שהוספתי" לנושא אחר. לנושא חדש — ההסבר הופך לסיכום הנושא ונוצרות לו שאלות תרגול
  async function moveNoteTo(n) {
    const to = moveNote?.to
    if (!to) return
    setNoteBusy(n.id); setErr('')
    try {
      if (to === '__new') {
        const nm = (moveNote.name || '').trim()
        if (!nm) { setNoteBusy(null); return }
        const exist = otherTopics.find((t) => t.name.trim() === nm)
        if (exist) {
          await supabase.from('materials').update({ topic_id: exist.id }).eq('id', n.id)
        } else {
          const { data: cur } = await supabase.from('topics').select('in_exam').eq('id', topicId).maybeSingle()
          const { data: ins, error } = await supabase.from('topics').insert({ subject_id: subjectId, name: nm, origin: 'השנה', in_exam: !!cur?.in_exam }).select('id').single()
          if (error || !ins) throw error || new Error('topic')
          await supabase.from('materials').update({ topic_id: ins.id, kind: 'summary', title: n.title || nm, summary_md: `${GEN_MARK}\n\n${n.summary_md}` }).eq('id', n.id)
          try { await addMoreQuestions({ subjectId, subjectName, topicId: ins.id, topicName: nm, learner: profile, count: 8 }) } catch { /* הנושא והסיכום נשמרו */ }
        }
      } else {
        await supabase.from('materials').update({ topic_id: to }).eq('id', n.id)
      }
      setMoveNote(null)
      forget(`subject:${subjectId}`)
      await load(); onChanged?.()
    } catch (e) { setErr(aiErrorText('ההעברה נכשלה.', e)) }
    setNoteBusy(null)
  }

  async function deleteNote(id) {
    if (!window.confirm('להסיר את הסיכום הזה?')) return
    await supabase.from('materials').delete().eq('id', id)
    await load()
  }
  useEffect(() => { load() }, [topicId])

  async function fetchSource() {
    setFetching(true); setErr('')
    try {
      const { source_text, sources } = await fetchSourceText({ subjectName, reference: ref.trim() || name })
      setFetchedSources(sources || [])
      await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: topicId, kind: 'text', title: 'טקסט מקור (מהרשת)', source_text,
      })
      await load(); setShowSource(true)
    } catch (e) {
      setErr(aiErrorText('הבאת הטקסט נכשלה.', e))
    } finally { setFetching(false) }
  }

  async function generate() {
    setBusy(true); setErr('')
    try {
      // מאחד את כל החומרים שהועלו לנושא לסיכום אחד (אם אין — סיכום כללי)
      if (aggSource) {
        // יש דפים — איחוד מכולם (כולל גבולות מול שאר הנושאים במקצוע)
        await consolidateTopic({ subjectId, subjectName, topicId, topicName: name, learner: profile, enrich })
      } else {
        const { summary_md: md } = await topicSummary({ subjectName, topicName: name, learner: profile })
        // נושא שנכתב מהידע הכללי (בלי דפים) — התגית נשארת גם אחרי בנייה מחדש
        const summary_md = String(summary || '').includes(GEN_MARK) ? `${GEN_MARK}\n\n${md}` : md
        await supabase.from('materials').delete().eq('topic_id', topicId).eq('kind', 'summary')
        await supabase.from('materials').insert({
          subject_id: subjectId, topic_id: topicId, title: 'סיכום עיוני', kind: 'summary', summary_md,
        })
      }
      forget(`subject:${subjectId}`)
      await load()
    } catch (e) {
      setErr(aiErrorText('יצירת הסיכום נכשלה.', e))
    } finally { setBusy(false) }
  }

  // המחברת מכסה רק חלק מהטקסט המלא (למשל עד פסוק י'): ההמשך נפתח כנושא חדש — כמו חומר חדש שמצלמים.
  // הנושא הנוכחי נשאר כמו שהוא; ההתקדמות של עילאי לא נמחקת.
  async function completeFromSource() {
    setCompleting(true); setErr(''); setRestTopic(null); setCompleteNote('בודק מה חסר במחברת…')
    try {
      // השלמה ישנה (סיכום של כל הפרק בתוך הנושא הזה) — השאלות שלה מתחלקות: מה שעל ההמשך עובר לנושא החדש
      // (מזהים אותה לפי התגית "השלמה", או לפי שאלות שמקושרות לסיכום — סיכום מאוחד רגיל לא יוצר שאלות)
      const { data: sums } = await supabase.from('materials').select('id, summary_md').eq('topic_id', topicId).eq('kind', 'summary')
      const { data: linked } = (sums || []).length ? await supabase.from('questions').select('id, q, material_id').in('material_id', sums.map((m) => m.id)) : { data: [] }
      const old = (sums || []).filter((m) => /השלמה/.test(m.summary_md || '') || (linked || []).some((q) => q.material_id === m.id))
      const oldQs = (linked || []).filter((q) => old.some((m) => m.id === q.material_id))
      const split = await splitSource({ notebook, fullText: sourceText, questions: (oldQs || []).map((q) => ({ id: q.id, q: q.q })) })
      const restText = String(split?.rest_text || '').trim()
      if (!restText) { setCompleteNote('✓ נראה שהמחברת כבר מכסה את כל הטקסט — אין מה להשלים.'); return }

      const base = name.replace(/\s*[-–—]\s*פסוקים.*$/, '').trim() || name
      const newName = `${base} - ${String(split.rest_label || 'המשך').trim()}`
      setCompleteNote(`פותח נושא חדש: ${newName}…`)
      const { data: ex } = await supabase.from('topics').select('id').eq('subject_id', subjectId).eq('name', newName).maybeSingle()
      let newId = ex?.id
      if (!newId) {
        const { data: ins, error } = await supabase.from('topics').insert({ subject_id: subjectId, name: newName, origin: 'השנה' }).select('id').single()
        if (error || !ins) throw new Error('topic')
        newId = ins.id
      }

      setCompleteNote('מכין סיכום להמשך…')
      const { summary_md } = await topicSummary({ subjectName, topicName: newName, learner: profile, sourceMaterials: restText, fromText: true })
      const { data: mat } = await supabase.from('materials').insert({
        subject_id: subjectId, topic_id: newId, title: newName, kind: 'text', summary_md, source_text: restText,
      }).select('id').single()

      // שאלות מההשלמה הקודמת שעוסקות בהמשך — עוברות לנושא החדש, יחד עם התשובות שעילאי כבר ענה עליהן
      const moveIds = (split.rest_question_ids || []).map(String).filter((id) => (oldQs || []).some((q) => q.id === id))
      if (moveIds.length) {
        await supabase.from('questions').update({ topic_id: newId, material_id: mat?.id || null }).in('id', moveIds)
        await supabase.from('attempts').update({ topic_id: newId }).in('question_id', moveIds)
      }
      // הסיכום של כל הפרק יוצא מהנושא הזה — חוזרים לסיכומי המחברת (שאר השאלות שלו נשארות כאן)
      if (old.length) await supabase.from('materials').delete().in('id', old.map((m) => m.id))

      setCompleteNote('מכין שאלות על ההמשך…')
      const { data: moved } = moveIds.length ? await supabase.from('questions').select('q').in('id', moveIds) : { data: [] }
      const { questions } = await generateQuestions({
        subjectName, topic: newName, count: Math.max(5, 10 - moveIds.length), learner: profile, style: await subjectStyle(subjectId),
        sourceText: `הטקסט המלא:\n${restText}\n\nהסיכום:\n${summary_md}` +
          ((moved || []).length ? `\n\nאל תחזור/י על השאלות האלה:\n${moved.map((x) => `- ${x.q}`).join('\n')}` : ''),
      })
      const rows = (questions || []).filter((q) => q?.q && Array.isArray(q.choices)).map((q) => ({
        subject_id: subjectId, topic_id: newId, material_id: mat?.id || null,
        q: q.q, choices: q.choices, answer: q.answer,
        difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
      }))
      if (rows.length) await supabase.from('questions').insert(rows)
      forget(`subject:${subjectId}`)
      await load()
      setRestTopic({ id: newId, name: newName }); onChanged?.()
      setCompleteNote(`✓ נפתח נושא חדש עם סיכום ו-${rows.length + moveIds.length} שאלות.`)
    } catch (e) {
      setCompleteNote(''); setErr(aiErrorText('ההשלמה נכשלה.', e))
    } finally { setCompleting(false) }
  }

  async function renameTopic() {
    const nm = renameVal.trim()
    if (!nm || nm === name) { setEditName(false); setRenameVal(name); return }
    try {
      const { error } = await supabase.from('topics').update({ name: nm }).eq('id', topicId)
      if (error) throw error
      setName(nm); onChanged?.()
    } catch { setRenameVal(name) }
    setEditName(false)
  }

  async function mergeInto() {
    if (!mergeTarget) return
    setAskMerge(false); setRemoving(true)
    // (לבונה השאילתות של Supabase אין .catch — לכן try/catch)
    for (const tbl of ['questions', 'flashcards', 'materials', 'attempts', 'syntax_items']) {
      try { await supabase.from(tbl).update({ topic_id: mergeTarget }).eq('topic_id', topicId) } catch { /* */ }
    }
    await supabase.from('topics').delete().eq('id', topicId)
    forget(`subject:${subjectId}`)
    nav.reset('subject', { id: subjectId })
  }

  // מחיקת נושא לגמרי: הסיכומים, השאלות, הכרטיסיות והדפים ששייכים רק לו.
  // היסטוריית התרגול נשמרת (בלי שיוך לנושא) — כדי לא לפגוע ביעד היומי וברצף.
  async function deleteTopic() {
    setAskDelete(false); setRemoving(true)
    const inChunks = async (ids, fn) => { for (let i = 0; i < ids.length; i += 100) await fn(ids.slice(i, i + 100)) }
    try {
      const { data: qs } = await fetchAll(() => supabase.from('questions').select('id').eq('topic_id', topicId))
      const qIds = (qs || []).map((q) => q.id)
      await supabase.from('attempts').update({ topic_id: null }).eq('topic_id', topicId)
      await inChunks(qIds, async (ids) => {
        await supabase.from('attempts').update({ question_id: null }).in('question_id', ids)
        await supabase.from('review_items').delete().in('ref_id', ids)
        await supabase.from('questions').delete().in('id', ids)
      })
      const { data: fcs } = await fetchAll(() => supabase.from('flashcards').select('id').eq('topic_id', topicId))
      await inChunks((fcs || []).map((f) => f.id), async (ids) => {
        await supabase.from('review_items').delete().in('ref_id', ids)
        await supabase.from('flashcards').delete().in('id', ids)
      })
      // דף שמשויך גם לנושא אחר — נשאר שם; קובץ שלא שייך לאף נושא אחר — נמחק מהאחסון
      const { data: mats } = await supabase.from('materials').select('id, storage_path').eq('topic_id', topicId)
      const paths = [...new Set((mats || []).map((m) => m.storage_path).filter(Boolean))]
      await supabase.from('materials').delete().eq('topic_id', topicId)
      if (paths.length) {
        const { data: still } = await supabase.from('materials').select('storage_path').in('storage_path', paths)
        const used = new Set((still || []).map((m) => m.storage_path))
        const orphan = paths.filter((p) => !used.has(p))
        if (orphan.length) await supabase.storage.from('materials').remove(orphan)
      }
      await supabase.from('topics').delete().eq('id', topicId)
    } catch { /* מה שנמחק נמחק; הנושא יופיע שוב אם המחיקה שלו עצמו לא הצליחה */ }
    forget(`subject:${subjectId}`)
    nav.reset('subject', { id: subjectId })
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1">
      {!embedded && <span className="end-tag inline-block mb-3">{subjectName}</span>}
      {editName ? (
        <div className="flex items-center gap-2">
          <input className="field flex-1 min-w-0 !text-[18px] font-bold" value={renameVal} autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') renameTopic(); if (e.key === 'Escape') { setEditName(false); setRenameVal(name) } }} />
          <button type="button" className="hbtn !px-0 w-11 flex-none" aria-label="שמור שם" onClick={renameTopic}><Icon name="check" size={19} /></button>
          <button type="button" className="hbtn !px-0 w-11 flex-none" aria-label="ביטול" onClick={() => { setEditName(false); setRenameVal(name) }}><Icon name="x" size={18} /></button>
        </div>
      ) : (
        <h1 className={`font-black ${embedded ? 'text-[24px]' : 'text-[30px]'} leading-[1.1] tracking-tight`}>
          {name}
          <button type="button" className="inline-grid place-items-center align-middle ms-2 w-8 h-8 rounded-full text-muted" style={{ background: 'rgba(255,255,255,.08)' }}
            aria-label="שינוי שם הנושא" onClick={() => { setRenameVal(name); setEditName(true) }}><Icon name="pencil" size={15} /></button>
        </h1>
      )}
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">
        {summary ? 'סיכום' : 'אין עדיין סיכום'} · {drillTopic ? 'תרגילים ללא הגבלה' : `${qCount} שאלות`}{notes.length ? ` · ${notes.length} סיכומים שהוספתי` : ''}
      </div>
      <button type="button" className="ts-practice" disabled={qCount === 0 && !drillTopic}
        onClick={() => nav.go('practice', { subjectId, subjectName, topicId, topicName: name, mode: 'practice' })}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
        <span>{gx('תרגל את הנושא', 'תרגלי את הנושא')}</span>
        {qCount > 0 && !drillTopic && <span className="ts-count tnum">{qCount}</span>}
      </button>
      {/* תרגול לפי סוג — רק בנושא עם תרגילים; סגור כברירת מחדל כדי לא להעמיס */}
      {drillTopic && (
        <div className="mb-4 -mt-2">
          <button type="button" className="text-[13.5px] font-semibold text-muted underline underline-offset-2" onClick={() => setShowKinds((v) => !v)} aria-expanded={showKinds}>
            {showKinds ? 'הסתרת הסוגים' : 'או תרגול לפי סוג ←'}
          </button>
          {showKinds && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {(VARIANTS[drillTypeOf(name)] || []).map(([v, label]) => (
                <button key={v} type="button" className="kind-chip"
                  onClick={() => nav.go('practice', { subjectId, subjectName, topicId, topicName: name, mode: 'practice', variant: v })}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {sourceText && !pasteMode ? (
        <>
          <button type="button" className="milky-row mb-3" onClick={() => setShowSource((v) => !v)}>
            <Icon name="text" />
            <span className="flex-1 text-start font-bold text-[14.5px]">הטקסט המלא</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showSource ? 'rotate(180deg)' : 'none', transition: '.2s' }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {/* המחברת מכסה רק חלק מהטקסט — השלמה לכל הפרק */}
          <div className="milky-row !flex-col !items-stretch !gap-2 mb-3">
            <div className="text-[13.5px] font-bold">חסר חומר על חלק מה{isBible ? 'פרק' : 'טקסט'}?</div>
            <div className="text-[12px] text-muted leading-relaxed">
              {isBible ? 'למשל: במחברת יש עד פסוק י\', והמבדק על כל הפרק. ' : ''}המערכת תמצא מה לא נלמד במחברת ותפתח לו נושא חדש — עם סיכום ברמת הכיתה ושאלות, כמו חומר חדש שמצלמים. הנושא הזה נשאר כמו שהוא.
            </div>
            {completeNote && (completing ? <WorkNote text={`${completeNote} כחצי דקה עד דקה.`} /> : <div className="text-[12.5px] font-semibold" style={{ color: 'var(--good)' }}>{completeNote}</div>)}
            {restTopic && (
              <button type="button" className="self-start text-[13px] font-bold text-primary underline"
                onClick={() => (onOpen ? onOpen(restTopic.id) : nav.go('topicSummary', { subjectId, subjectName, topicId: restTopic.id, topicName: restTopic.name }))}>לנושא החדש ›</button>
            )}
            <button type="button" className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-bold"
              style={{ background: 'var(--primary)', color: 'var(--on-fill)' }} disabled={completing || busy} onClick={completeFromSource}>
              <Icon name="sparkle" size={16} />{completing ? 'מכין…' : `השלם את המשך ה${isBible ? 'פרק' : 'טקסט'}`}
            </button>
          </div>
          {showSource && (
            <div className="card mb-3">
              <div className="whitespace-pre-line text-[14.5px] leading-relaxed">{sourceText}</div>
              {fetchedSources.length > 0 && (
                <div className="text-[12px] text-muted mt-3">
                  נמצא מהמקור: {fetchedSources.slice(0, 2).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="text-primary underline break-all">{new URL(u).hostname.replace('www.', '')}</a>
                  )).reduce((a, b) => [a, ' · ', b])}
                </div>
              )}
              <div className="flex gap-3 mt-3">
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={fetchSource} disabled={fetching}>{fetching ? 'מביא…' : <span className="inline-flex items-center gap-1"><Icon name="refresh" size={14} />הבא שוב מהרשת</span>}</button>
                <button className="text-muted text-[12.5px] font-semibold hover:text-primary"
                  onClick={() => { setPasteVal(sourceText); setPasteMode(true) }}><span className="inline-flex items-center gap-1"><Icon name="pencil" size={14} />ערוך / החלף ידנית</span></button>
              </div>
            </div>
          )}
        </>
      ) : !(isLiterary || wantSource) ? (
        <button type="button" className="milky-row mb-3" onClick={() => setWantSource(true)}>
          <Icon name="text" />
          <span className="flex-1 text-start text-[13.5px] font-semibold">יש לנושא טקסט מקור (שיר / פסוקים)? הבא אותו</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      ) : (
        <div className="card mb-3">
          <div className="text-[14px] font-semibold mb-1 flex items-center gap-1.5"><Icon name="text" size={18} />הבא את הטקסט המלא ({srcKind})</div>
          <div className="text-muted text-[12.5px] mb-2 leading-relaxed">
            כתבו את שם {isBible ? 'הפרק/הפסוקים' : isLiterary ? 'השיר' : 'הטקסט'} — והמערכת תחפש ותביא אותו מהרשת ממקור אמין, עם קישור למקור.
          </div>
          <input className="field mb-2" value={ref} onChange={(e) => setRef(e.target.value)}
            placeholder={`שם ${isBible ? 'הפרק/הפסוקים' : isLiterary ? 'השיר' : 'הטקסט'} — ${name}`} />
          {!pasteMode && (
            <button className="btn btn-primary btn-wide" onClick={fetchSource} disabled={fetching}>
              {fetching ? 'מחפש ומביא מהרשת…' : <><Icon name="download" size={18} />הבא טקסט מלא מהרשת</>}
            </button>
          )}
          {fetching && <WorkNote className="mt-2" text="מחפש את הנוסח המלא ברשת… כמה שניות עד חצי דקה." />}
          {err && <div className="text-bad text-[12.5px] mt-2">{err}</div>}

          {/* גיבוי ידני — מקורות + הדבקה */}
          <button className="text-muted text-[12.5px] font-semibold mt-3 hover:text-primary w-full text-start"
            onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'הסתר ▲' : 'לא נמצא / לא מדויק? מקורות והדבקה ידנית ▼'}
          </button>
          {(showManual || pasteMode) && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-2 mb-3">
                {SOURCES.map((s) => (
                  <a key={s.label} href={s.url} target="_blank" rel="noreferrer"
                    className="text-[13px] font-semibold text-primary border border-line rounded-[10px] px-2.5 py-1.5 hover:border-primary">
                    {s.label} <Icon name="link" size={13} />
                  </a>
                ))}
              </div>
              {pasteMode ? (
                <>
                  <textarea className="field mb-2" style={{ minHeight: 160 }} value={pasteVal}
                    onChange={(e) => setPasteVal(e.target.value)}
                    placeholder="הדביקו כאן את הטקסט המלא מהמקור…" />
                  <div className="action-row">
                    <button className="btn" onClick={() => { setPasteMode(false); setPasteVal('') }} disabled={busy}>ביטול</button>
                    <button className="btn btn-primary" onClick={savePasted} disabled={busy || !pasteVal.trim()}>
                      {busy ? 'שומר…' : <><Icon name="save" size={18} />שמור טקסט מדויק</>}
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn btn-wide" onClick={() => setPasteMode(true)}><Icon name="paste" size={18} />הדבק טקסט מהמקור</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* הסיכום — "דף" בהיר ונוח לקריאה */}
      <div className="paper print-area">
        {summary && <div className="hidden print:block font-disp font-extrabold text-[20px] mb-2">{name} · {subjectName}</div>}
        {summary ? (
          <div style={busy || autoMerging ? { opacity: 0.4, transition: 'opacity .3s' } : undefined}><Markdown text={summary} examBox /></div>
        ) : (
          <div className="text-center py-6">
            <div className="flex justify-center mb-2" style={{ color: '#5E7A00' }}><Icon name="book" size={36} /></div>
            <div className="font-disp font-extrabold text-[17px]">עדיין אין סיכום לנושא הזה</div>
            <div className="text-[14px] mt-1" style={{ color: '#3E3E45' }}>לחצו למטה כדי שהמערכת תכין אחד מסודר.</div>
          </div>
        )}

        <div className="no-print">
        {err && <div className="text-[13.5px] mt-3 font-semibold" style={{ color: '#B8501C' }}>{err}</div>}

        {(busy || autoMerging) && (
          <WorkNote light className="mt-4" text={autoMerging ? 'מאחד את כל הדפים של הנושא לסיכום אחד, בלי חזרות… בערך חצי דקה.' : 'בונה את הסיכום מחדש מכל הדפים… בערך חצי דקה עד דקה. הסיכום הנוכחי יתחלף כשזה יסתיים.'} />
        )}
        <button type="button" className="ts-practice mt-4 !mb-0" disabled={qCount === 0 && !drillTopic}
          onClick={() => nav.go('practice', { subjectId, subjectName, topicId, topicName: name, mode: 'practice' })}>
          <Icon name="target" size={19} />
          <span>{gx('תרגל את הנושא', 'תרגלי את הנושא')}</span>
        </button>
        <div className="paper-actions">
          {summary && (
            <button type="button" className="paper-btn" onClick={() => window.print()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" /></svg>
              הדפסה
            </button>
          )}
          {/* בלי סיכום בכלל — יוצרים כאן; בנייה מחדש של סיכום קיים — ב"ניהול הנושא" */}
          {!summary && (
            <button type="button" className="paper-btn" onClick={generate} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
              {busy ? 'מכין…' : 'צור סיכום'}
            </button>
          )}
        </div>
        </div>
      </div>

      {/* חומר מתחום אחר שהיה בדפים של הנושא — הוצא מהסיכום; מציעים להעביר לנושא משלו */}
      {offs.map((o) => (
        <div key={o.name} className="gap-miss mt-4">
          <div className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>
            בדפים של הנושא הזה יש גם חומר על <b style={{ color: 'var(--accent)' }}>{o.name}</b> — נושא אחר, ולכן הוא לא נכנס לסיכום.
          </div>
          <div className="flex gap-2 flex-wrap mt-1.5">
            <button type="button" className="gap-btn gap-btn-fill" disabled={!!offBusy} onClick={async () => {
              setOffBusy(o.name)
              try {
                const t = await moveOffTopic({ subjectId, subjectName, fromTopicId: topicId, item: o, learner: profile })
                forget(`subject:${subjectId}`); setOffNote(t); await load(); onChanged?.()
              } catch { setErr('ההעברה נכשלה. נסו שוב בעוד רגע.') }
              setOffBusy(null)
            }}>{offBusy === o.name ? 'יוצר נושא ושאלות…' : 'להעביר לנושא משלו'}</button>
            <button type="button" className="gap-btn" disabled={!!offBusy} onClick={async () => { await markOffDone(topicId, o.name); await load() }}>לא צריך</button>
          </div>
          {offBusy === o.name && <WorkNote className="mt-2" text={`יוצר נושא «${o.name}» עם סיכום ושאלות… כחצי דקה.`} />}
        </div>
      ))}
      {offNote && (
        <button type="button" className="milky-row mt-3 text-[13.5px] font-semibold"
          onClick={() => (onOpen ? onOpen(offNote.id) : nav.go('topicSummary', { subjectId, subjectName, topicId: offNote.id, topicName: offNote.name }))}>
          <Icon name="check" size={18} style={{ color: 'var(--good)' }} />
          <span className="flex-1 text-start">נוצר נושא «{offNote.name}» עם סיכום ושאלות</span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      {/* סיכומים שהוספתי (מהצ'אט) — קבועים, לא נמחקים ב"סכם מחדש" */}
      {notes.length > 0 && (
        <>
          <div className="home-h2 mt-6 mb-2.5"><h2>סיכומים שהוספתי</h2><span>{notes.length}</span></div>
          {notes.map((n) => (
            <div key={n.id} className="paper mb-3">
              <div className="flex items-start gap-2 mb-1">
                <div className="flex-1 font-disp font-extrabold text-[16px] flex items-center gap-1.5"><Icon name="note" size={18} />{n.title || 'סיכום'}</div>
                <button type="button" onClick={() => setMoveNote(moveNote?.id === n.id ? null : { id: n.id, to: '', name: '' })}
                  className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ color: '#3E3E45', border: '1.5px solid rgba(20,20,22,.25)' }}>העבר לנושא</button>
                <button type="button" onClick={() => deleteNote(n.id)} title="הסר סיכום" aria-label="הסר סיכום"
                  className="text-[13px] font-bold px-2.5 py-1 rounded-full" style={{ color: '#B8501C', border: '1.5px solid rgba(184,80,28,.35)' }}>הסר</button>
              </div>
              {moveNote?.id === n.id && (
                <div className="flex flex-col gap-2 my-2 p-3 rounded-[14px]" style={{ background: 'rgba(20,20,22,.06)' }}>
                  <select className="field !py-1.5 !text-[16px]" value={moveNote.to} disabled={noteBusy === n.id}
                    onChange={(e) => setMoveNote({ ...moveNote, to: e.target.value })}>
                    <option value="">{gx('בחר נושא…', 'בחרי נושא…')}</option>
                    {otherTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="__new">+ נושא חדש…</option>
                  </select>
                  {moveNote.to === '__new' && (
                    <input className="field !py-1.5" autoFocus value={moveNote.name} placeholder="שם הנושא החדש" disabled={noteBusy === n.id}
                      onChange={(e) => setMoveNote({ ...moveNote, name: e.target.value })} />
                  )}
                  {moveNote.to === '__new' && <div className="text-[12px]" style={{ color: '#6B6B72' }}>ההסבר יהיה הסיכום של הנושא החדש, וייווצרו לו שאלות תרגול.</div>}
                  <button type="button" className="paper-btn self-start" disabled={noteBusy === n.id || !moveNote.to || (moveNote.to === '__new' && !moveNote.name.trim())}
                    onClick={() => moveNoteTo(n)}>{noteBusy === n.id ? 'מעביר ויוצר שאלות…' : 'העבר'}</button>
                  {noteBusy === n.id && moveNote.to === '__new' && <WorkNote light text="יוצר את הנושא ושאלות תרגול… כחצי דקה." />}
                </div>
              )}
              <Markdown text={n.summary_md} />
            </div>
          ))}
        </>
      )}

      {/* ניהול הנושא — איחוד עם נושא אחר או מחיקה */}
      <div className="home-h2 mt-7 mb-2.5"><h2>כלים לנושא</h2></div>
      <div className="milky-row !flex-col !items-stretch !gap-3">
        {/* נושא מתמטי עם תרגילים (חזקות, פילוג...) — מתורגל בתרגילים שנבנים בקוד, אין צורך בשאלות נוספות */}
        {summary && !drillTopic && (
          <div className="flex flex-col gap-2">
            <div className="text-[13.5px] font-bold">עוד שאלות לנושא</div>
            <div className="text-[12px] text-muted leading-relaxed">יוצר עוד שאלות תרגול מהסיכום של הנושא — בלי לחזור על השאלות שכבר יש ({qCount}).</div>
            <button type="button" className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-bold" disabled={moreBusy || busy}
              style={{ border: '1.5px solid var(--milky-line)' }} onClick={async () => {
                setMoreBusy(true); setMoreNote('')
                try {
                  const { n, dropped } = await addMoreQuestions({ subjectId, subjectName, topicId, topicName: name, learner: profile, count: 8 })
                  setMoreNote(n ? `✓ נוספו ${n} שאלות חדשות${dropped ? ` (${dropped} נפסלו כי חזרו על שאלות קיימות)` : ''}.` : 'לא נמצאו שאלות חדשות שלא חוזרות על הקיימות — כנראה החומר כבר מכוסה היטב.')
                  forget(`subject:${subjectId}`); await load()
                } catch (e) { setMoreNote(aiErrorText('יצירת השאלות נכשלה.', e)) }
                setMoreBusy(false)
              }}>
              {moreBusy ? <span className="up-spin" style={{ width: 15, height: 15 }} /> : <Icon name="plus" size={16} />}{moreBusy ? 'יוצר שאלות…' : '8 שאלות נוספות'}
            </button>
            {moreBusy && <WorkNote text="יוצר שאלות חדשות מהסיכום ובודק שהן לא חוזרות על הקיימות… כחצי דקה." />}
            {moreNote && !moreBusy && <div className="text-[12.5px] font-semibold" style={{ color: moreNote.startsWith('✓') ? 'var(--good)' : 'var(--muted)' }}>{moreNote}</div>}
          </div>
        )}
        {summary && (
          <div className="flex flex-col gap-2">
            <div className="text-[13.5px] font-bold">בנייה מחדש של הסיכום</div>
            <div className="text-[12px] text-muted leading-relaxed">כותב את הסיכום מחדש מכל הדפים של הנושא — קצר ובלי חזרות. נעשה לבד אחרי העלאת דף חדש; צריך רק אם משהו בסיכום לא טוב.</div>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-bold" disabled={busy || autoMerging}
                style={{ border: '1.5px solid var(--milky-line)' }} onClick={generate}>
                {busy ? <span className="up-spin" style={{ width: 15, height: 15 }} /> : <Icon name="refresh" size={16} />}{busy ? 'בונה…' : gx('בנה מחדש', 'בני מחדש')}
              </button>
              {aggSource && (
                <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
                  <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="w-[18px] h-[18px]" style={{ accentColor: 'var(--primary)' }} />
                  להשלים גם מהידע הכללי
                </label>
              )}
            </div>
            {busy && <WorkNote text="בונה את הסיכום מחדש מכל הדפים… בערך חצי דקה עד דקה. הסיכום למעלה יתחלף כשזה יסתיים." />}
          </div>
        )}
        {otherTopics.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[13.5px] font-bold">איחוד עם נושא אחר</div>
            <div className="text-[12px] text-muted leading-relaxed">כל התוכן של הנושא — דפים, שאלות, כרטיסיות והתקדמות — עובר לנושא שבוחרים, והנושא הזה נמחק. מתאים לנושא כפול.</div>
            <div className="flex gap-2">
              <select className="field flex-1 min-w-0" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} disabled={removing}>
                <option value="">{gx('בחר נושא…', 'בחרי נושא…')}</option>
                {otherTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="px-4 rounded-[16px] font-bold text-[14px]" style={{ background: 'var(--primary)', color: 'var(--on-fill)' }}
                disabled={!mergeTarget || removing} onClick={() => setAskMerge(true)}>{gx('אחד', 'אחדי')}</button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] font-bold">מחיקת הנושא</div>
          <div className="text-[12px] text-muted leading-relaxed">מוחק את הנושא עם הסיכומים, השאלות והכרטיסיות שלו. דף ששייך גם לנושא אחר — נשאר שם.</div>
          <button type="button" className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-bold" disabled={removing}
            style={{ color: 'var(--bad)', border: '1.5px solid color-mix(in srgb, var(--bad) 40%, transparent)' }} onClick={() => setAskDelete(true)}>
            <Icon name="trash" size={16} />{removing ? 'מוחק…' : gx('מחק את הנושא', 'מחקי את הנושא')}
          </button>
        </div>
      </div>

      <ConfirmDialog open={askMerge} icon="refresh" title="לאחד את הנושאים?"
        text={`כל התוכן של "${name}" יעבור אל "${otherTopics.find((t) => t.id === mergeTarget)?.name || ''}", והנושא "${name}" יימחק.`}
        confirmLabel={gx('אחד', 'אחדי')} cancelLabel="ביטול" onConfirm={mergeInto} onCancel={() => setAskMerge(false)} />
      <ConfirmDialog open={askDelete} icon="trash" danger title={`למחוק את "${name}"?`}
        text={`יימחקו הסיכומים, ${qCount} שאלות והכרטיסיות של הנושא. התשובות שכבר נענו נשמרות לספירת היעד היומי. אי אפשר לבטל.`}
        confirmLabel={gx('מחק', 'מחקי')} cancelLabel="ביטול" onConfirm={deleteTopic} onCancel={() => setAskDelete(false)} />
    </div>
  )
}
