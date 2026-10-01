import { useEffect, useState } from 'react'
import { useG } from '../lib/gender'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { generateVariations } from '../lib/gemini'
import { settleSession } from '../lib/coins'
import { VARIATIONS, varKind, GRAD } from '../lib/mastery'
import { useAuth } from '../context/AuthContext'
import SessionEnd from '../components/SessionEnd'
import { checkPlanDayDone } from '../lib/plan'
import { primeAudio } from '../lib/celebrate'
import { SegProgress, QuestionBlock, Options, FeedbackSheet } from '../components/QuestionUI'
import { buildItem, isChatCard } from '../lib/flashcardQuiz'

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }
// ערבוב מיקום התשובה בכל שאלה בזמן התצוגה — מבטיח פיזור גם לשאלות ישנות שנשמרו עם התשובה במיקום 1
function shuffleChoices(q) {
  if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
  const correct = q.choices[q.answer]
  const order = shuffle(q.choices.map((_, i) => i))
  const choices = order.map((i) => q.choices[i])
  return { ...q, choices, answer: choices.indexOf(correct) }
}

const FC_PER_ROUND = 3   // כמה שאלות הגדרה מכרטיסיות בסבב תרגול רגיל

export default function Practice({ nav, params }) {
  const g = useG()
  const { subjectId, subjectName, topicId, topicName } = params
  const { profile } = useAuth()
  const examMode = params.mode === 'exam'
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)
  const [showHint, setShowHint] = useState(false)
  const [correct, setCorrect] = useState(0)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [reward, setReward] = useState(null)   // { earned, events } — מטבעות שנצברו בסבב
  const [planDay, setPlanDay] = useState(null) // היום בתוכנית הלמידה הושלם בסבב הזה → חגיגה
  const [topicNames, setTopicNames] = useState({})

  useEffect(() => {
    (async () => {
      const { data: tp } = await supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId)
      setTopicNames(Object.fromEntries((tp || []).map((t) => [t.id, t.name])))
      let q = supabase.from('questions').select('*').eq('subject_id', subjectId)
      if (topicId) q = q.eq('topic_id', topicId)
      // סימולציית מבדק: רק מהנושאים שבמיקוד (אם הוגדר); בלי מיקוד — מכל החומר
      else if (examMode) {
        const scopeIds = (tp || []).filter((t) => t.in_exam).map((t) => t.id)
        if (scopeIds.length) q = q.in('topic_id', scopeIds)
      }
      const { data } = await q
      // דגימה אקראית מכל השאלות (לא רק מה-40 הראשונות)
      // params.count — סבב קצר שמשלים את היעד היומי (מהכרטיס בבית)
      const total = examMode ? 15 : (params.count > 0 ? params.count : 10)
      let fcItems = []
      // תרגול רגיל: 2–3 שאלות הגדרה מהכרטיסיות (מושג ↔ הגדרה), במקום מסך כרטיסיות נפרד
      if (!examMode) {
        const { data: cards } = await supabase.from('flashcards').select('*').eq('subject_id', subjectId)
        const all = (cards || []).filter((c) => !isChatCard(c))
        const own = topicId ? all.filter((c) => c.topic_id === topicId) : all
        const fcBase = total >= 6 ? FC_PER_ROUND : total >= 3 ? 1 : 0   // בסבב קצר — פחות שאלות הגדרה
        const want = Math.max(fcBase, total - (data || []).length)   // מעט שאלות רגילות → משלימים מכרטיסיות
        fcItems = shuffle(own).slice(0, want).map((c) => buildItem(c, all)).filter((it) => it.valid)
          .map((it) => ({ ...it, fc: true, explain: `התשובה הנכונה: **${it.choices[it.answer]}**`, difficulty: 'קל' }))
      }
      const qs = shuffle(data || []).slice(0, total - fcItems.length).map(shuffleChoices)
      setQueue(shuffle([...qs, ...fcItems]))
      setLoading(false)
    })()
  }, [subjectId, topicId])

  if (loading) return <div className="text-muted pt-4">טוען…</div>
  if (!queue.length) return (
    <div className="text-center text-muted pt-10">
      אין עדיין שאלות במקצוע הזה.<br />העלו חומר כדי שהמערכת תייצר שאלות.
    </div>
  )

  if (done) {
    const pct = Math.round(correct / queue.length * 100)
    return (
      <SessionEnd correct={correct} total={queue.length} reward={reward} planDay={planDay}
        tag={[subjectName, topicName].filter(Boolean).join(' · ')}
        title={pct >= 80 ? 'שליטה מצוינת!' : pct >= 50 ? 'בכיוון הנכון!' : 'שווה לחזור ולנסות שוב'}
        subtitle={pct >= 80 ? 'ממשיכים ככה.' : 'עוד קצת תרגול, וזה אצלך.'}
        wrongCount={examMode ? 0 : queue.length - correct}
        onReinforce={() => { nav.back(); nav.go('reinforce', { subjectId, subjectName }) }}
        onAgain={() => { nav.back(); nav.go('practice', { ...params, count: undefined }) }}  // סבב נוסף — רגיל (10), לא קצר
        onBack={() => nav.back()} />
    )
  }

  const q = queue[idx]
  const answered = picked != null

  async function answer(i) {
    if (answered) return
    setPicked(i)
    const ok = i === q.answer
    if (ok) setCorrect((c) => c + 1)
    setResults((r) => { const n = [...r]; n[idx] = ok; return n })
    if (q.fc) {
      // שאלת הגדרה מכרטיסייה — נרשמת כמו בכרטיסיות (בלי question_id), וטעות נכנסת ל"לחיזוק"
      await supabase.from('attempts').insert({ subject_id: subjectId, topic_id: q.topic_id, correct: ok, difficulty: 'קל' })
      const { data: ex } = await supabase.from('review_items').select('id, streak').eq('kind', 'flashcard').eq('ref_id', q.id).maybeSingle()
      if (!ok) {
        if (ex) await supabase.from('review_items').update({ streak: 0, updated_at: new Date().toISOString() }).eq('id', ex.id)
        else await supabase.from('review_items').insert({ subject_id: subjectId, kind: 'flashcard', ref_id: q.id, streak: 0 })
      } else if (ex) {
        const s = (ex.streak || 0) + 1
        if (s >= GRAD) await supabase.from('review_items').delete().eq('id', ex.id)
        else await supabase.from('review_items').update({ streak: s, updated_at: new Date().toISOString() }).eq('id', ex.id)
      }
      return
    }
    await supabase.from('attempts').insert({
      question_id: q.id, topic_id: q.topic_id, subject_id: subjectId,
      correct: ok, difficulty: q.difficulty,
    })
    // טעות → נכנס ל"לחיזוק" (streak מתאפס)
    if (!ok) {
      const { data: ex } = await supabase.from('review_items')
        .select('id').eq('kind', 'question').eq('ref_id', q.id).maybeSingle()
      if (ex) await supabase.from('review_items').update({ streak: 0, updated_at: new Date().toISOString() }).eq('id', ex.id)
      else await supabase.from('review_items').insert({ subject_id: subjectId, kind: 'question', ref_id: q.id, streak: 0 })
      spawnVariations(q) // ברקע — עוד כמה תרגולים על אותה טעות
    }
  }

  // מייצר ברקע כמה שאלות דומות על אותה טעות, ומכניס אותן ל"לחיזוק"
  async function spawnVariations(seed) {
    try {
      const { questions } = await generateVariations({
        subjectName, topicName: topicName || '', concept: seed.q, learner: profile, count: VARIATIONS,
      })
      if (!questions?.length) return
      const { data: ins } = await supabase.from('questions').insert(questions.slice(0, VARIATIONS).map((v) => ({
        subject_id: subjectId, topic_id: seed.topic_id,
        q: v.q, choices: v.choices, answer: v.answer,
        difficulty: v.difficulty || 'בינוני', explain: v.explain || '', hint: v.hint || '',
      }))).select('id')
      if (ins?.length) await supabase.from('review_items')
        .insert(ins.map((r) => ({ subject_id: subjectId, kind: varKind(seed.id), ref_id: r.id, streak: 0 })))
    } catch { /* לא חוסם את התרגול */ }
  }
  async function next() {
    if (idx >= queue.length - 1) {
      primeAudio()
      setDone(true)
      const r = await settleSession({ subjectId, topicId, correctCount: correct })
      setReward(r)
      setPlanDay(await checkPlanDayDone(subjectId))
      return
    }
    setIdx(idx + 1); setPicked(null); setShowHint(false)
  }

  const topicLabel = topicNames[q.topic_id] || topicName
  const last = idx >= queue.length - 1
  return (
    <div className="pt-1">
      <SegProgress total={queue.length} idx={idx} results={results} />

      <QuestionBlock topic={topicLabel} sub={q.fc ? q.prompt : `${examMode ? 'סימולציה · ' : ''}${q.difficulty || ''}`} text={q.q} />

      <Options choices={q.choices} answer={q.answer} picked={picked} onPick={answer} />

      {!answered && q.hint && !examMode && (
        showHint
          ? <div className="q-hint flex gap-2"><Icon name="bulb" size={18} />{q.hint}</div>
          : <button type="button" className="q-hint inline-flex items-center gap-1.5" onClick={() => setShowHint(true)}><Icon name="bulb" size={18} />רמז</button>
      )}

      {answered && (
        <FeedbackSheet ok={picked === q.answer} title={picked === q.answer ? 'יפה מאוד!' : g('כמעט — בוא נבין', 'כמעט — בואי נבין')}
          explain={q.explain} nextLabel={last ? 'לסיכום' : 'הבא'} onNext={next} />
      )}
    </div>
  )
}
