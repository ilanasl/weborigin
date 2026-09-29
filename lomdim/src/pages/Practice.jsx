import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateVariations } from '../lib/gemini'
import { settleSession } from '../lib/coins'
import { useAuth } from '../context/AuthContext'
import { SegProgress, QuestionBlock, Options, FeedbackSheet } from '../components/QuestionUI'

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }
// ערבוב מיקום התשובה בכל שאלה בזמן התצוגה — מבטיח פיזור גם לשאלות ישנות שנשמרו עם התשובה במיקום 1
function shuffleChoices(q) {
  if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
  const correct = q.choices[q.answer]
  const order = shuffle(q.choices.map((_, i) => i))
  const choices = order.map((i) => q.choices[i])
  return { ...q, choices, answer: choices.indexOf(correct) }
}

export default function Practice({ nav, params }) {
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
  const [topicNames, setTopicNames] = useState({})

  useEffect(() => {
    (async () => {
      let q = supabase.from('questions').select('*').eq('subject_id', subjectId)
      if (topicId) q = q.eq('topic_id', topicId)
      const [{ data }, { data: tp }] = await Promise.all([
        q.limit(40),
        supabase.from('topics').select('id, name').eq('subject_id', subjectId),
      ])
      setTopicNames(Object.fromEntries((tp || []).map((t) => [t.id, t.name])))
      setQueue(shuffle(data || []).slice(0, examMode ? 15 : 10).map(shuffleChoices))
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
      <div className="pt-8 text-center">
        <div className="text-5xl mb-2">{pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '🌱'}</div>
        <div className="font-disp font-black text-5xl text-primary tnum">{correct}/{queue.length}</div>
        <div className="text-muted mt-1">{pct >= 80 ? 'שליטה מצוינת!' : pct >= 50 ? 'בכיוון הנכון' : 'שווה לחזור ולנסות שוב'}</div>
        {reward && reward.earned > 0 && (
          <div className="mt-5 mx-auto max-w-[300px] rounded-[16px] bg-accent-soft border border-line p-4">
            <div className="font-disp font-black text-[22px] text-accent tnum">🪙 +{reward.earned}</div>
            <div className="flex flex-col gap-0.5 mt-1.5 text-[13px] text-muted">
              {reward.events.map((e, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span>{e.label}</span><span className="tnum font-semibold">+{e.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <button className="btn btn-primary btn-wide mt-6" onClick={() => nav.back()}>חזרה למקצוע</button>
      </div>
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
        subjectName, topicName: topicName || '', concept: seed.q, learner: profile, count: 5,
      })
      if (!questions?.length) return
      const { data: ins } = await supabase.from('questions').insert(questions.map((v) => ({
        subject_id: subjectId, topic_id: seed.topic_id,
        q: v.q, choices: v.choices, answer: v.answer,
        difficulty: v.difficulty || 'בינוני', explain: v.explain || '', hint: v.hint || '',
      }))).select('id')
      if (ins?.length) await supabase.from('review_items')
        .insert(ins.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
    } catch { /* לא חוסם את התרגול */ }
  }
  async function next() {
    if (idx >= queue.length - 1) {
      setDone(true)
      const r = await settleSession({ subjectId, topicId, correctCount: correct })
      setReward(r)
      return
    }
    setIdx(idx + 1); setPicked(null); setShowHint(false)
  }

  const topicLabel = topicNames[q.topic_id] || topicName
  const last = idx >= queue.length - 1
  return (
    <div className="pt-1">
      <SegProgress total={queue.length} idx={idx} results={results} />

      <QuestionBlock topic={topicLabel} sub={`${examMode ? 'מבחן · ' : ''}${q.difficulty || ''}`} text={q.q} />

      <Options choices={q.choices} answer={q.answer} picked={picked} onPick={answer} />

      {!answered && q.hint && !examMode && (
        showHint
          ? <div className="q-hint">💡 {q.hint}</div>
          : <button type="button" className="q-hint" onClick={() => setShowHint(true)}>💡 רמז</button>
      )}

      {answered && (
        <FeedbackSheet ok={picked === q.answer} title={picked === q.answer ? 'יפה מאוד!' : 'כמעט — בוא נבין'}
          explain={q.explain} nextLabel={last ? 'לסיכום' : 'הבא'} onNext={next} />
      )}
    </div>
  )
}
