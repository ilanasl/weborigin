import { useEffect, useState } from 'react'
import { toAIInput } from '../lib/image'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import { analyzeMaterial } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'

// מזהה הקובץ המקורי — כמה שורות (נושא לכל שורה) יכולות לחלוק את אותו דף
const fileKey = (m) => m.storage_path || (m.content_hash || '').split(':')[0] || m.id

// "החומרים שהעליתי" — מסך נפרד (יצא ממסך המקצוע כדי להוריד עומס): צפייה, שיוך לנושא, מחיקה
export default function Materials({ nav, params }) {
  const { subjectId, subjectName } = params
  const id = subjectId
  const { profile } = useAuth()
  const subject = { name: subjectName }
  const [topics, setTopics] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingMat, setSavingMat] = useState(null)
  const [savedMat, setSavedMat] = useState(null)
  const [addFor, setAddFor] = useState(null)
  const [addSel, setAddSel] = useState('')
  const [addNew, setAddNew] = useState('')
  const [addBusy, setAddBusy] = useState(null)
  const [addErr, setAddErr] = useState('')
  const [addDone, setAddDone] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: tp }, { data: mt }] = await Promise.all([
      supabase.from('topics').select('*').eq('subject_id', id).order('created_at'),
      supabase.from('materials').select('*').eq('subject_id', id).order('created_at', { ascending: false }),
    ])
    setTopics(tp || [])
    // רק קבצים שהועלו בפועל (יש להם קובץ מאוחסן או חתימת תוכן) — לא סיכומים/הערות שנוצרו
    setMaterials((mt || []).filter((m) => m.storage_path || m.content_hash))
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

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

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] tracking-tight">החומרים שהעליתי</h1>
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">כל הדפים והקבצים במקצוע. אפשר לצפות, לשייך לנושא אחר או למחוק.</div>
      <button type="button" className="ts-practice mb-4" onClick={() => nav.go('upload', { subjectId: id, subjectName })}>
        <Icon name="upload" size={19} /><span>העלה חומר חדש</span>
      </button>
      <div className="flex flex-col gap-2">
        {materials.length === 0 ? (
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
        )}
      </div>
    </div>
  )
}
