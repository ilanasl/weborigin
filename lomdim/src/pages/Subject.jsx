import { useEffect, useState } from 'react'
import { toAIInput } from '../lib/image'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { mastery, examReadiness, level, STRONG, LEVEL_LABEL } from '../lib/mastery'
import { expirePastExams, PASSED_KEY, daysUntil, parseDay } from '../lib/plan'

const LEVEL_COLOR = { strong: 'var(--good)', mid: 'var(--primary)', weak: 'var(--accent)' }
import { analyzeMaterial } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import { withTone } from '../lib/tone'
import { foldLegacyCheckTopic, LEGACY_CHECK_TOPIC } from '../lib/checkTopic'

// מזהה הקובץ המקורי — כמה שורות (נושא לכל שורה) יכולות לחלוק את אותו דף
const fileKey = (m) => m.storage_path || (m.content_hash || '').split(':')[0] || m.id

export default function Subject({ nav, params }) {
  const { id } = params
  const { profile } = useAuth()
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [materials, setMaterials] = useState([])
  const [qCount, setQCount] = useState(0)
  const [fcCount, setFcCount] = useState(0)
  const [rvCount, setRvCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showMats, setShowMats] = useState(false)
  const [savingMat, setSavingMat] = useState(null)  // id של חומר שנשמר כרגע
  const [savedMat, setSavedMat] = useState(null)     // id של חומר שזה עתה נשמר (לאישור קצר)
  // הוספת נושא נוסף לדף שכולל שני נושאים
  const [addFor, setAddFor] = useState(null)        // id של החומר שהחלונית פתוחה עבורו
  const [addSel, setAddSel] = useState('')          // topic id | '__new'
  const [addNew, setAddNew] = useState('')
  const [addBusy, setAddBusy] = useState(null)
  const [addErr, setAddErr] = useState('')
  const [addDone, setAddDone] = useState(null)

  async function load() {
    setLoading(true)
    const { data: s0 } = await supabase.from('subjects').select('*').eq('id', id).single()
    const [s] = await expirePastExams(s0 ? [s0] : [])
    const [{ data: tp }, { data: mt }, { data: at }, { count: qc }, { count: fc }, { count: rc }] = await Promise.all([
      supabase.from('topics').select('*').eq('subject_id', id).order('created_at'),
      supabase.from('materials').select('*').eq('subject_id', id).order('created_at', { ascending: false }),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', id),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('subject_id', id),
    ])
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({
        correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
      })
    }
    setSubject(withTone(s))
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    // רק קבצים שהועלו בפועל (יש להם קובץ מאוחסן או חתימת תוכן) — לא סיכומים/הערות שנוצרו
    setMaterials((mt || []).filter((m) => m.storage_path || m.content_hash))
    setQCount(qc || 0); setFcCount(fc || 0); setRvCount(rc || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])
  // חד-פעמי: "תרגילים שבדקתי" כבר לא יחידה נפרדת — השאלות עוברות לנושאים שלהן
  useEffect(() => {
    if (!subject?.name || !topics.some((t) => t.name === LEGACY_CHECK_TOPIC)) return
    foldLegacyCheckTopic(id, subject.name).then((moved) => { if (moved) load() })
  }, [subject?.name, topics.length])

  // פתיחת הקובץ המקורי שהועלה (URL חתום זמני)
  async function openMaterial(m) {
    if (!m.storage_path) return
    const { data } = await supabase.storage.from('materials').createSignedUrl(m.storage_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // שיוך חומר לנושא אחר — מעביר גם את השאלות שנוצרו ממנו.
  // בלי טעינה מחדש של כל המסך — כדי לא לקפוץ למעלה ולאבד את המקום (אפשר לסווג כמה חומרים ברצף).
  async function moveMaterialTopic(m, topicId) {
    if (!topicId || topicId === m.topic_id) return
    const prev = m.topic_id
    setMaterials((arr) => arr.map((x) => x.id === m.id ? { ...x, topic_id: topicId } : x))
    setSavingMat(m.id); setSavedMat(null)
    const { error } = await supabase.from('materials').update({ topic_id: topicId }).eq('id', m.id)
    if (error) {
      // שחזור הבחירה הקודמת אם השמירה נכשלה — בלי לקפוץ מהמסך
      setMaterials((arr) => arr.map((x) => x.id === m.id ? { ...x, topic_id: prev } : x))
      setSavingMat(null)
      return
    }
    try {
      await supabase.from('questions').update({ topic_id: topicId }).eq('material_id', m.id)
    } catch { /* אם אין שאלות מקושרות — לא נורא */ }
    await foldEmptyTopic(prev, topicId)
    setSavingMat(null); setSavedMat(m.id)
    setTimeout(() => setSavedMat((cur) => cur === m.id ? null : cur), 2500)
  }

  // אחרי העברת חומר: אם בנושא הקודם לא נשאר אף קובץ שהועלה — מאחדים אותו לתוך הנושא החדש
  // (כרטיסיות, היסטוריית תרגול, הערות ושאלות שנשארו) ומוחקים את הנושא הריק. בלי כפתור נוסף.
  async function foldEmptyTopic(fromId, toId) {
    if (!fromId || fromId === toId) return
    try {
      const { data: left } = await supabase.from('materials').select('id, kind, storage_path, content_hash').eq('topic_id', fromId)
      if ((left || []).some((x) => x.storage_path || x.content_hash)) return
      // סיכום מאוחד ישן — נמחק (ייווצר מחדש בנושא המאוחד); הערות שנשמרו — עוברות
      await supabase.from('materials').delete().eq('topic_id', fromId).eq('kind', 'summary')
      for (const tbl of ['materials', 'questions', 'flashcards', 'attempts', 'syntax_items']) {
        try { await supabase.from(tbl).update({ topic_id: toId }).eq('topic_id', fromId) } catch { /* */ }
      }
      await supabase.from('topics').delete().eq('id', fromId)
      // עדכון המסך במקום — בלי טעינה מחדש (כדי לא לקפוץ למעלה)
      const { data: at } = await supabase.from('attempts').select('correct, difficulty, created_at').eq('topic_id', toId)
      const m = mastery((at || []).map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })))
      setTopics((arr) => arr.filter((x) => x.id !== fromId).map((x) => (x.id === toId ? { ...x, m } : x)))
    } catch { /* אם משהו נכשל — הנושא הישן פשוט נשאר */ }
  }

  // דף שכולל גם נושא נוסף: קורא שוב את הדף המקורי, מתמקד רק בחלק של הנושא הזה,
  // ושומר לו שורת חומר משלו (אותו קובץ) עם סיכום, שאלות וכרטיסיות. בלי טעינה מחדש של המסך.
  async function addTopicToMaterial(m) {
    setAddErr('')
    let topicId = addSel
    let topicName = topics.find((t) => t.id === addSel)?.name
    if (addSel === '__new') {
      const nm = addNew.trim()
      if (!nm) return
      const exist = topics.find((t) => t.name === nm)
      if (exist) { topicId = exist.id; topicName = exist.name }
      else {
        const { data: ins, error } = await supabase.from('topics')
          .insert({ subject_id: id, name: nm, origin: m.origin || 'השנה' }).select('*').single()
        if (error || !ins) { setAddErr('יצירת הנושא נכשלה — נסו שוב'); return }
        topicId = ins.id; topicName = ins.name
        setTopics((arr) => [...arr, { ...ins, m: mastery([]) }])
      }
    }
    if (!topicId || !topicName) return
    setAddBusy(m.id)
    try {
      let input
      if (m.storage_path) {
        const { data: blob, error } = await supabase.storage.from('materials').download(m.storage_path)
        if (error || !blob) throw new Error('download')
        input = await toAIInput(blob, m.kind === 'pdf' ? 'application/pdf' : 'image/jpeg')
      } else {
        input = { text: m.source_text || m.summary_md || m.title || '' }
      }
      const out = await analyzeMaterial({
        ...input, subjectName: subject.name, knownTopics: [topicName], learner: profile, focusTopic: topicName,
      })
      const t = out.topics?.[0] || { summary_md: '', questions: [], flashcards: [] }
      const { data: mat, error: me } = await supabase.from('materials').insert({
        subject_id: id, topic_id: topicId, title: topicName, kind: m.kind,
        storage_path: m.storage_path || null, origin: m.origin || 'השנה',
        summary_md: t.summary_md || '',
        // סימון שזה אותו דף (לא נחשב כקובץ כפול בבדיקת ההעלאה)
        content_hash: m.content_hash ? `${m.content_hash.split(':')[0]}:${topicId}` : (m.storage_path ? null : `page:${m.id}:${topicId}`),
      }).select('*').single()
      if (me || !mat) throw new Error('save')
      const qs = Array.isArray(t.questions) ? t.questions : []
      const fcs = Array.isArray(t.flashcards) ? t.flashcards : []
      if (qs.length) await supabase.from('questions').insert(qs.map((q) => ({
        subject_id: id, topic_id: topicId, material_id: mat.id,
        q: q.q, choices: q.choices, answer: q.answer,
        difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
      })))
      if (fcs.length) await supabase.from('flashcards').insert(fcs.map((c) => ({
        subject_id: id, topic_id: topicId, front: c.front, back: c.back, context: c.context || null,
      })))
      // מכניס את השורה החדשה מיד מתחת לדף המקורי — בלי לקפוץ מהמקום
      setMaterials((arr) => { const i = arr.findIndex((x) => x.id === m.id); const c = arr.slice(); c.splice(i + 1, 0, mat); return c })
      setQCount((c) => c + qs.length); setFcCount((c) => c + fcs.length)
      setAddFor(null); setAddDone(mat.id)
      setTimeout(() => setAddDone((cur) => cur === mat.id ? null : cur), 3500)
    } catch {
      setAddErr('הניתוח נכשל — נסו שוב בעוד רגע')
    } finally { setAddBusy(null) }
  }

  // הסרת שיוך נוסף של דף (רק כשהדף משויך ליותר מנושא אחד — לא מוחק את הקובץ עצמו)
  async function removeMaterialRow(m) {
    if (!confirm('להסיר את הדף מהנושא הזה? (הדף נשאר בנושא השני)')) return
    await supabase.from('questions').delete().eq('material_id', m.id)
    const { error } = await supabase.from('materials').delete().eq('id', m.id)
    if (!error) setMaterials((arr) => arr.filter((x) => x.id !== m.id))
  }

  // מחיקת חומר לגמרי: הקובץ (כל הנושאים שהוא משויך אליהם), השאלות שנוצרו ממנו והפריטים שלהן ב"לחיזוק".
  // נושא שלא נשאר בו אף חומר שהועלה — נמחק כולו (שאלות, כרטיסיות, סיכומים).
  const [deleting, setDeleting] = useState(null)
  async function deleteMaterial(m) {
    const siblings = materials.filter((x) => fileKey(x) === fileKey(m))
    const topicIds = [...new Set(siblings.map((x) => x.topic_id).filter(Boolean))]
    const willEmpty = topicIds.filter((tid) => !materials.some((x) => x.topic_id === tid && !siblings.includes(x)))
    const emptyNames = topics.filter((t) => willEmpty.includes(t.id)).map((t) => `"${t.name}"`)
    const msg = `למחוק את "${m.title || 'החומר'}" ואת כל השאלות שנוצרו ממנו?` +
      (emptyNames.length ? `\n\nלא יישאר חומר בנושא ${emptyNames.join(', ')} — הנושא יימחק כולו (שאלות, כרטיסיות וסיכום).` : '') +
      '\n\nאי אפשר לבטל.'
    if (!window.confirm(msg)) return
    setDeleting(m.id)
    try {
      const dropQuestions = async (qIds) => {
        if (!qIds.length) return
        await supabase.from('review_items').delete().in('ref_id', qIds)
        await supabase.from('questions').delete().in('id', qIds)
      }
      for (const s of siblings) {
        const { data: qs } = await supabase.from('questions').select('id').eq('material_id', s.id)
        await dropQuestions((qs || []).map((q) => q.id))
      }
      await supabase.from('materials').delete().in('id', siblings.map((s) => s.id))
      const paths = [...new Set(siblings.map((s) => s.storage_path).filter(Boolean))]
      if (paths.length) await supabase.storage.from('materials').remove(paths)
      for (const tid of willEmpty) {
        const { data: qs } = await supabase.from('questions').select('id').eq('topic_id', tid)
        await dropQuestions((qs || []).map((q) => q.id))
        const { data: fcs } = await supabase.from('flashcards').select('id').eq('topic_id', tid)
        if (fcs?.length) {
          await supabase.from('review_items').delete().in('ref_id', fcs.map((f) => f.id))
          await supabase.from('flashcards').delete().eq('topic_id', tid)
        }
        await supabase.from('materials').delete().eq('topic_id', tid)
        await supabase.from('topics').delete().eq('id', tid)
      }
    } catch { /* ממשיכים לרענון — מה שנמחק נמחק */ }
    setDeleting(null)
    load()
  }

  if (loading || !subject) return <div className="text-muted pt-4">טוען…</div>

  const name = subject.name
  // המבחן/מבדק הקרוב יותר מבין השניים
  const upcomingExams = [
    { kind: 'מבחן מסכם', days: daysUntil(subject.exam_date) },
    { kind: 'מבדק', days: daysUntil(subject.quiz_date) },
  ].filter((x) => x.days != null && x.days >= 0).sort((a, b) => a.days - b.days)
  const examDays = upcomingExams[0]?.days ?? null
  const examKind = upcomingExams[0]?.kind || 'מבחן'
  // תאריך המבחן הקרוב, קצר ("8 באוק׳") — לכפתור הסימולציה
  const examRaw = upcomingExams[0] ? (upcomingExams[0].kind === 'מבדק' ? subject.quiz_date : subject.exam_date) : null
  const examDate = examRaw ? parseDay(examRaw).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : null
  const summary = materials.find((m) => m.summary_md)

  // מוכנות למבחן: נושאי המבחן (או כולם אם לא הוגדר מיקוד); נושא שלא תורגל נספר כ-0
  const rd = examReadiness(topics.map((t) => ({ in_exam: t.in_exam, pct: t.m.pct })))
  const ready = rd.pct
  const scopeTopics = topics.some((t) => t.in_exam) ? topics.filter((t) => t.in_exam) : topics
  const strong = scopeTopics.filter((t) => level(t.m.pct) === 'strong')
  // "הכי כדאי לתרגל עכשיו": 2 הנושאים החלשים — קודם כאלה שתורגלו ועוד לא חזקים, ורק אחריהם נושאים שעוד לא תורגלו
  const focus = [
    ...scopeTopics.filter((t) => t.m.pct != null && t.m.pct < STRONG).sort((a, b) => a.m.pct - b.m.pct),
    ...scopeTopics.filter((t) => t.m.pct == null),
  ].slice(0, 2)
  // מבחן קרוב אך עדיין לא הוגדר/הועלה חומר עבורו (אין נושאים מסומנים "במבחן")
  const hasExam = examDays != null && examDays >= 0
  const needsMaterial = hasExam && topics.filter((t) => t.in_exam).length === 0
  // מבחן שעבר (התאפס אוטומטית) — מבקשים חומר חדש עד שמעלים משהו אחרי מועד האיפוס
  const passed = (() => {
    try {
      const p = JSON.parse(localStorage.getItem(PASSED_KEY(id)) || 'null')
      if (!p) return null
      const uploadedAfter = materials.some((m) => new Date(m.created_at).getTime() > p.ts)
      return uploadedAfter ? null : p
    } catch { return null }
  })()
  // תרגיל ניתוח משפט רלוונטי ללשון/עברית/דקדוק
  const isLang = /עברית|לשון|דקדוק|תחביר/.test(name || '')

  const isEmpty = topics.length === 0 && materials.length === 0
  const goPractice = (mode) => nav.go('practice', { subjectId: id, subjectName: name, mode })

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-4 mt-1">
        <div className="min-w-0">
          <h1 className="font-black text-[38px] leading-none tracking-tight">{name}</h1>
          <div className="text-[14px] text-muted mt-1.5">
            {topics.length} נושאים{hasExam ? ` · ${examKind} ${examDays === 0 ? 'היום' : `בעוד ${examDays} ימים`}` : ''}
          </div>
        </div>
{!isEmpty && (
        <button type="button" className="up-pill" onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={subject.color} strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          העלה חומר
        </button>
        )}
      </div>

      {/* מקצוע ריק — פעולה אחת ברורה במקום כל המסך */}
      {isEmpty ? (
        <div className="rounded-[28px] p-6 flex flex-col items-center text-center gap-3" style={{ background: subject.bg, color: 'var(--on-fill)' }}>
          <span className="w-16 h-16 rounded-full grid place-items-center" style={{ background: 'rgba(255,255,255,.55)' }}>
            <Icon name="camera" size={30} />
          </span>
          <div className="font-disp font-extrabold text-[22px] leading-tight">מתחילים כאן</div>
          <div className="text-[14.5px] leading-relaxed" style={{ color: 'rgba(19,19,22,.75)' }}>
            מצלמים דף מהמחברת או מעלים PDF — והמערכת מכינה ממנו סיכום ושאלות לתרגול.
          </div>
          <button type="button" className="ready-btn w-full mt-1" style={{ background: 'var(--on-fill)', color: subject.bg, flex: 'none' }}
            onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
            <Icon name="upload" size={20} />העלה חומר ראשון
          </button>
          <button type="button" className="text-[13.5px] font-semibold underline underline-offset-4" style={{ color: 'rgba(19,19,22,.7)' }}
            onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}>
            יש מבחן קרוב? אפשר כבר להגדיר תאריך
          </button>
        </div>
      ) : (<>
      {/* כרטיס מוכנות — בצבע המקצוע */}
      <div className="ready-hero" style={{ background: subject.bg }}>
        {/* בלי מבחן קרוב — זה לא "מוכנות", אלא כמה החומר שולט */}
        <div className="text-[14px] font-semibold">{hasExam ? `מוכנות ל${examKind === 'מבדק' ? 'מבדק' : 'מבחן'}` : 'השליטה שלי בחומר'}</div>
        <div className="ready-hero-num tnum" dir="ltr">{ready == null ? '—' : `${ready}%`}</div>
        <div className="hero-track !flex-none"><i style={{ width: `${ready || 0}%` }} /></div>
        {ready == null && <div className="text-[12.5px] font-semibold" style={{ color: 'rgba(19,19,22,.7)' }}>עוד לא תורגל — כמה תרגולים והמספר יופיע.</div>}
        {ready != null && (
          <div className="flex flex-col gap-2 mt-0.5">
            <span className="text-[13.5px] font-bold">✓ חזק ב-{strong.length} מתוך {rd.total} נושאים · תורגלו {rd.practiced}</span>
            {focus.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-bold" style={{ color: 'rgba(19,19,22,.7)' }}>הכי כדאי לתרגל עכשיו</span>
                <div className="flex gap-1.5 flex-wrap">
                  {focus.map((t) => (
                    <button key={t.id} type="button" className="ready-chip ready-chip-weak" aria-label={`לתרגל את ${t.name}`}
                      onClick={() => nav.go('practice', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name, mode: 'practice' })}>
                      <b aria-hidden="true">!</b>{t.name}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.5 }}><path d="M15 6l-6 6 6 6" /></svg>
                    </button>
                  ))}
                </div>
              </div>
            ) : <span className="text-[13px] font-semibold">הכול חזק! 🎉</span>}
          </div>
        )}
        <div className="flex gap-2 mt-0.5">
          <button type="button" className="ready-btn" style={{ background: 'var(--on-fill)', color: subject.bg }} disabled={qCount === 0}
            onClick={() => nav.go('practicePicker', { subjectId: id, subjectName: name, mode: 'practice' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
            <span className="ready-lbl"><span>תרגול חופשי</span><small>כל החומר</small></span>
          </button>
          <button type="button" className="ready-btn" style={{ background: '#fff', color: 'var(--on-fill)' }} disabled={qCount === 0} onClick={() => goPractice('exam')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
            <span className="ready-lbl">
              <span>סימולציה</span>
              <small>{examDate ? `${examKind === 'מבדק' ? 'מבדק' : 'מבחן'} · ${examDate}` : 'כמו מבחן, על כל החומר'}</small>
            </span>
          </button>
        </div>
      </div>

      {/* כלים */}
      {(() => {
        // שני טורים, אריחים זהים. מספר אי-זוגי → "תסביר לי" עובר לסוף ברוחב מלא, כך שאף פעם אין חור.
        const tools = [
          topics.length > 0 && { k: 'sm', label: 'סיכומים', sub: 'חוברת כל הנושאים', icon: 'note', go: () => nav.go('summaries', { subjectId: id, subjectName: name }) },
          fcCount > 0 && { k: 'fc', label: 'כרטיסיות', sub: 'מושגים לשינון', icon: 'cards', go: () => nav.go('flashcards', { subjectId: id, subjectName: name }) },
          { k: 'rv', label: 'לחיזוק', sub: rvCount > 0 ? 'מה שכדאי לחזק' : 'אין כרגע מה לחזק', icon: 'book', count: rvCount, go: () => nav.go('reinforce', { subjectId: id, subjectName: name }) },
          isLang && { k: 'sx', label: 'ניתוח משפט', sub: 'תפקידי המילים', icon: 'blocks', go: () => nav.go('syntax', { subjectId: id, subjectName: name, mode: 'syntax' }) },
          { k: 'ck', label: 'בדוק תרגיל', sub: 'צילום של פתרון', icon: 'camera', go: () => nav.go('check', { subjectId: id, subjectName: name }) },
          { k: 'ex', label: 'תסביר לי', sub: 'שאלו כל שאלה', icon: 'chat', go: () => nav.go('explain', { subjectId: id, subjectName: name, context: summary?.summary_md }) },
        ].filter(Boolean)
        const odd = tools.length % 2 === 1
        const exam = [
          { k: 'pl', label: 'מתכנן המבחן', sub: needsMaterial ? 'צריך להגדיר חומר' : 'תוכנית עד המבחן', icon: 'calendar', dot: needsMaterial, go: () => nav.go('planner', { subjectId: id, subjectName: name }) },
          { k: 'pe', label: 'מבחנים שעברו', sub: 'ציונים וטעויות', icon: 'archive', go: () => nav.go('pastExams', { subjectId: id, subjectName: name }) },
        ]
        const Tile = ({ t, full }) => (
          <button type="button" className="tool" style={full ? { gridColumn: '1 / -1' } : undefined} onClick={t.go}>
            <Icon name={t.icon} size={22} />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="leading-tight">{t.label}</span>
              <span className="text-[12px] font-medium text-muted leading-tight">{t.sub}</span>
            </span>
            {t.count > 0 && <span className="tool-badge tnum">{t.count}</span>}
            {t.dot && <span className="tool-dot" aria-hidden="true" />}
          </button>
        )
        return (
          <>
            <div className="tools-grid">
              {tools.map((t, i) => <Tile key={t.k} t={t} full={odd && i === tools.length - 1} />)}
            </div>
            <div className="tools-grid mt-3">
              {exam.map((t) => <Tile key={t.k} t={t} />)}
            </div>
          </>
        )
      })()}

      {/* אזהרה: מבחן קרוב בלי חומר מוגדר */}
      {passed && !hasExam && (
        <button onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}
          className="w-full text-start rounded-[16px] p-3.5 mt-3 flex items-start gap-2.5 text-[13.5px] leading-relaxed"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Icon name="upload" size={19} />
          <span><b>ה{passed.kind} עבר 🎉</b> העלו את החומר החדש שלומדים עכשיו. עד שתגדירו מיקוד למבדק הבא — המבדק יהיה על כל החומר.</span>
        </button>
      )}

      {needsMaterial && (
        <button onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}
          className="w-full text-start rounded-[16px] p-3.5 mt-3 flex items-start gap-2.5 text-[13.5px] leading-relaxed"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Icon name="upload" size={19} />
          <span><b>עדיין לא הוגדר חומר ל{examKind}.</b> העלו את החומר וסמנו את המיקוד במתכנן המבחן, כדי שהתוכנית והתרגול יתמקדו בו</span>
        </button>
      )}

      {/* נושאים */}
      <div className="home-h2 mt-5 mb-2.5">
        <h2>הנושאים שלי</h2>
        <span>{topics.length} נושאים</span>
      </div>
      <div className="flex flex-col gap-2">
        {topics.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שהמערכת תזהה נושאים.</div>
        ) : topics.map((t) => (
          <div key={t.id} className="milky-row topic-row">
            <button type="button" className="topic-main"
              onClick={() => nav.go('topicSummary', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name })}>
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-[15.5px]">{t.name}</span>
                {t.in_exam && <span className="tp-badge" style={{ background: 'var(--primary)' }}>במיקוד</span>}
                {t.m.due && <span className="tp-badge" style={{ background: '#B7A5FF' }}>לרענון</span>}
                {t.origin === 'חזרה' && <span className="tp-badge tp-badge-muted">משנה שעברה</span>}
              </span>
              {t.m.pct == null ? (
                <span className="text-[12.5px] text-muted">עוד לא תורגל{t.m.n ? ` · ${t.m.n} מתוך 5 תשובות` : ''}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${t.m.pct}%`, background: LEVEL_COLOR[level(t.m.pct)] }} />
                  </span>
                  <span className="text-[12px] font-bold" style={{ color: LEVEL_COLOR[level(t.m.pct)] }}>{LEVEL_LABEL[level(t.m.pct)]}</span>
                  <span className="font-disp font-bold text-[13px] tnum" dir="ltr">{t.m.pct}%</span>
                </span>
              )}
              <span className="text-[12px] text-muted inline-flex items-center gap-1"><Icon name="book" size={14} />לצפייה בסיכום הנושא ›</span>
            </button>
            <button type="button" className="topic-go" aria-label={`לתרגל את ${t.name}`}
              onClick={() => nav.go('practice', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name, mode: 'practice' })}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
              <span>תרגול</span>
            </button>
          </div>
        ))}
      </div>

      {/* חומרים — מכווץ כברירת מחדל */}
      <button type="button" className="milky-row mt-6" onClick={() => setShowMats((v) => !v)} aria-expanded={showMats}>
        <Icon name="archive" />
        <span className="flex-1 text-start font-bold text-[15px]">החומרים שהעליתי ({materials.length})</span>
        <Icon name="down" size={18} style={{ transform: showMats ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
      </button>
      <div className="flex flex-col gap-2 mt-2">
        {showMats && (materials.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין לא הועלה חומר.</div>
        ) : (
          <>
            {materials.map((m) => (
              <div key={m.id} className="milky-row !flex-col !items-stretch !gap-2" style={deleting === m.id ? { opacity: 0.5 } : undefined}>
                <div className="flex items-start gap-2.5">
                  <span className="up-thumb"><Icon name={m.kind === 'image' ? 'image' : m.kind === 'text' ? 'text' : 'file'} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[14.5px] leading-snug">{m.title || 'חומר'}</div>
                    <div className="text-[12px] text-muted">
                      {new Date(m.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} · {m.kind === 'pdf' ? 'PDF' : m.kind === 'text' ? 'טקסט' : 'תמונה'}
                    </div>
                  </div>
                  {m.storage_path && (
                    <button type="button" className="up-x" aria-label="צפה בקובץ" onClick={() => openMaterial(m)}><Icon name="eye" size={16} /></button>
                  )}
                  <button type="button" className="up-x" aria-label="מחק חומר" style={{ color: 'var(--bad)' }}
                    disabled={deleting === m.id} onClick={() => deleteMaterial(m)}><Icon name="trash" size={16} /></button>
                </div>
                {/* שיוך לנושא — ניתן לשינוי מכאן */}
                <div>
                  <div className="text-[12px] text-muted mb-1">נושא</div>
                  <select className="field !py-1.5 !text-[16px]" value={m.topic_id || ''}
                    onChange={(e) => moveMaterialTopic(m, e.target.value)}>
                    {!m.topic_id && <option value="">— ללא —</option>}
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {(savingMat === m.id || savedMat === m.id || addDone === m.id) && (
                    <div className="text-[12px] font-semibold mt-1" style={{ color: savingMat === m.id ? 'var(--muted)' : 'var(--good)' }}>
                      {savingMat === m.id ? 'שומר…' : savedMat === m.id ? '✓ נשמר' : '✓ נוסף לנושא'}
                    </div>
                  )}
                </div>
                  {(() => {
                    const siblings = materials.filter((x) => fileKey(x) === fileKey(m))
                    const usedTopics = new Set(siblings.map((x) => x.topic_id))
                    const isShared = siblings.length > 1
                    if (addFor !== m.id) return (
                      <div className="flex items-center gap-4 flex-wrap">
                        <button type="button" className="text-primary text-[12.5px] font-semibold inline-flex items-center gap-1"
                          onClick={() => { setAddFor(m.id); setAddSel(''); setAddNew(''); setAddErr('') }}>
                          <Icon name="plus" size={14} stroke={2.6} />הדף כולל גם נושא נוסף
                        </button>
                        {isShared && (
                          <button type="button" className="text-muted text-[12.5px] font-semibold" onClick={() => removeMaterialRow(m)}>
                            הסר מנושא זה
                          </button>
                        )}
                      </div>
                    )
                    return (
                      <div className="mt-2 rounded-[12px] border border-line p-2.5 flex flex-col gap-2">
                        <div className="text-[12px] text-muted leading-relaxed">
                          לאיזה נושא נוסף שייך הדף? המערכת תקרא אותו שוב ותכין לנושא הזה סיכום, שאלות וכרטיסיות רק מהחלק הרלוונטי.
                        </div>
                        <select className="field !py-1.5 !text-[16px]" value={addSel} onChange={(e) => setAddSel(e.target.value)}>
                          <option value="">בחר/י נושא…</option>
                          {topics.filter((t) => !usedTopics.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          <option value="__new">+ נושא חדש…</option>
                        </select>
                        {addSel === '__new' && (
                          <input className="field !py-1.5 !text-[16px]" placeholder="שם הנושא החדש"
                            value={addNew} onChange={(e) => setAddNew(e.target.value)} />
                        )}
                        <div className="flex gap-2">
                          <button className="btn btn-primary !py-1.5 !px-3 text-[13px]"
                            disabled={addBusy === m.id || !addSel || (addSel === '__new' && !addNew.trim())}
                            onClick={() => addTopicToMaterial(m)}>
                            {addBusy === m.id ? 'מנתח את הדף…' : 'הוסף'}
                          </button>
                          <button className="btn !py-1.5 !px-3 text-[13px]" disabled={addBusy === m.id} onClick={() => setAddFor(null)}>ביטול</button>
                        </div>
                        {addErr && <div className="text-bad text-[12px]">{addErr}</div>}
                      </div>
                    )
                  })()}
              </div>
            ))}
          </>
        ))}
        <button type="button" className="btn w-full" onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
          <Icon name="upload" size={18} />העלה חומר חדש
        </button>
      </div>
      </>)}
    </div>
  )
}
