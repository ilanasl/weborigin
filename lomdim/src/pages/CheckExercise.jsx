import { useState, useEffect } from 'react'
import { toAIInput } from '../lib/image'
import { supabase } from '../lib/supabase'
import { checkExercise, generateQuestions } from '../lib/gemini'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'
import { pickTopicId } from '../lib/checkTopic'
import Icon from '../components/Icon'
import { VARIATIONS, varKind } from '../lib/mastery'


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
      const src = [r.exercise, r.feedback, r.reteach].filter(Boolean).join('\n')
      // התרגיל משתייך לנושא הקיים שהוא עוסק בו — ונכנס לתרגולים שלו, לא ליחידה נפרדת
      const { data: topics } = await supabase.from('topics').select('id, name').eq('subject_id', subjectId)
      const topicId = await pickTopicId({ subjectId, subjectName, text: src, topics })
        || await ensureTopic('תרגול כללי')
      const topicName = (topics || []).find((t) => t.id === topicId)?.name
      // שאלה אחת "ראשית" על הטעות + VARIATIONS וריאציות עזר (יוצאות אחרי הצלחה אחת)
      const { questions } = await generateQuestions({ subjectName, topic: topicName, sourceText: src, count: 1 + VARIATIONS, learner: profile })
      if (questions?.length) {
        const { data: inserted } = await supabase.from('questions').insert(questions.slice(0, 1 + VARIATIONS).map((q) => ({
          subject_id: subjectId, topic_id: topicId, q: q.q, choices: q.choices, answer: q.answer,
          difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
        }))).select('id')
        if (inserted?.length) {
          const [main, ...vars] = inserted
          await supabase.from('review_items').insert([
            { subject_id: subjectId, kind: 'question', ref_id: main.id, streak: 0 },
            ...vars.map((r) => ({ subject_id: subjectId, kind: varKind(main.id), ref_id: r.id, streak: 0 })),
          ])
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
      const out = await checkExercise({ ...(await toAIInput(file)), subjectName, learner: profile })
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
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1]">בדוק תרגיל</h1>
      <div className="text-[13.5px] text-muted mt-1.5 mb-4">צלמו תרגיל שפתרתם במחברת — המערכת תגיד איפה הטעות, אם יש.</div>

      {/* צילום / בחירה */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="up-big up-big-lime">
          <Icon name="camera" size={28} />
          <span className="font-disp font-extrabold text-[18px]">צלם</span>
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setErr(''); e.target.value = '' }} />
        </label>
        <label className="up-big">
          <Icon name="image" size={28} />
          <span className="font-disp font-extrabold text-[18px]">מהגלריה</span>
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setErr(''); e.target.value = '' }} />
        </label>
      </div>

      {file && (
        <div className="milky-row mt-3 !py-2 !px-2.5">
          <span className="up-thumb"><Icon name="image" /></span>
          <span className="flex-1 min-w-0 font-semibold text-[14px] truncate" dir="ltr" style={{ textAlign: 'right' }}>{file.name}</span>
          <button type="button" className="up-x" aria-label="הסר" onClick={() => setFile(null)}><Icon name="x" size={15} stroke={2.4} /></button>
        </div>
      )}

      <button type="button" className="ts-practice mt-3" onClick={run} disabled={!file || busy}>
        <Icon name="sparkle" size={19} />{busy ? 'בודק…' : 'בדוק את הפתרון'}
      </button>
      {err && <div className="text-[13.5px] mt-1 font-semibold" style={{ color: 'var(--bad)' }}>{err}</div>}

      {/* תוצאה */}
      {res && (
        <div className="flex flex-col gap-3 mt-2">
          <div className="ce-head" style={{ background: res.correct ? 'var(--good)' : 'var(--accent)' }}>
            <span className="ce-head-ic"><Icon name={res.correct ? 'check' : 'bulb'} size={20} stroke={2.4} /></span>
            <span className="font-disp font-extrabold text-[18px]">{res.correct ? 'הפתרון נכון!' : 'יש טעות — בואו נבין'}</span>
          </div>
          {res.exercise && <div className="ce-eq !mb-0 text-center" dir="auto">{res.exercise}</div>}
          {Array.isArray(res.steps) && res.steps.length > 0 && (
            <div className="flex flex-col gap-2">
              {res.steps.map((st, i) => (
                <div key={i} className={`ce-row ${st.ok ? 'ok' : 'bad'}`}>
                  <span className="ce-row-ic"><Icon name={st.ok ? 'check' : 'x'} size={14} stroke={3} /></span>
                  <span className="flex-1">{st.text}</span>
                </div>
              ))}
            </div>
          )}
          {(res.feedback || res.reteach) && (
            <div className="paper">
              {res.feedback && <Markdown text={res.feedback} />}
              {res.reteach && (
                <div className="md-exam !mb-0">
                  <div className="md-exam-h"><Icon name="check" size={17} stroke={2.6} style={{ color: '#5E7A00' }} />לזכור</div>
                  <div className="text-[14.5px]" style={{ color: '#26262B' }}>{res.reteach}</div>
                </div>
              )}
            </div>
          )}
          {!res.correct && (adding || added) && (
            <div className="milky-row text-[14px] font-semibold" style={{ color: added ? 'var(--good)' : 'var(--muted)' }}>
              <Icon name={added ? 'check' : 'book'} size={18} />
              {added ? 'נוסף אוטומטית ל"לחיזוק" — יחזור בתרגול' : 'מוסיף ל"לחיזוק"…'}
            </div>
          )}
        </div>
      )}

      {/* בדיקות קודמות — מקופל */}
      {history.length > 0 && (
        <div className="mt-6">
          <button type="button" className="milky-row" onClick={() => setShowHist((v) => !v)} aria-expanded={showHist}>
            <Icon name="archive" />
            <span className="flex-1 text-start font-bold text-[14.5px]">בדיקות קודמות ({history.length})</span>
            <Icon name="down" size={18} style={{ transform: showHist ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
          </button>
          {showHist && (
            <div className="flex flex-col gap-1.5 mt-2">
              {history.map((m) => {
                let saved = null
                try { saved = JSON.parse(m.source_text) } catch { /* ignore */ }
                const ok = saved?.correct
                return (
                  <div key={m.id} className="milky-row !py-2">
                    <button type="button" onClick={() => { setRes(saved); setFile(null); setAdded(false); setShowHist(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      className="flex-1 min-w-0 text-start">
                      <div className="text-[14px] font-semibold truncate">{m.title || 'תרגיל'}</div>
                      <div className="text-[12px] text-muted">
                        {new Date(m.created_at).toLocaleDateString('he-IL')}
                        {saved != null && <span style={{ color: ok ? 'var(--good)' : 'var(--accent)' }}> · {ok ? 'נכון' : 'הייתה טעות'}</span>}
                      </div>
                    </button>
                    <button type="button" onClick={(ev) => deleteCheck(ev, m)} title="מחק" aria-label="מחק"
                      className="up-x" style={{ color: 'var(--bad)' }}><Icon name="trash" size={16} /></button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
