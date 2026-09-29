import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRAD, VAR_GRAD, varKind, isVarKind } from '../lib/mastery'
import { settleSession } from '../lib/coins'
import SessionEnd from '../components/SessionEnd'
import { checkPlanDayDone } from '../lib/plan'
import { primeAudio } from '../lib/celebrate'
import { SegProgress, QuestionBlock, Options, FeedbackSheet } from '../components/QuestionUI'

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }
// ערבוב מיקום התשובה בזמן התצוגה — פיזור גם לשאלות שנשמרו עם התשובה במיקום קבוע
function shuffleChoices(q) {
  if (!Array.isArray(q?.choices) || typeof q.answer !== 'number') return q
  const correct = q.choices[q.answer]
  const order = shuffle(q.choices.map((_, i) => i))
  const choices = order.map((i) => q.choices[i])
  return { ...q, choices, answer: choices.indexOf(correct) }
}
const now = () => new Date().toISOString()
const ROUND = 15 // כמה פריטים בסבב חיזוק אחד

export default function Reinforce({ nav, params }) {
  const { subjectId, subjectName } = params
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState(null)   // לשאלות
  const [flipped, setFlipped] = useState(false) // לכרטיסיות
  const [graduated, setGraduated] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [reward, setReward] = useState(null)
  const [planDay, setPlanDay] = useState(null) // היום בתוכנית הלמידה הושלם בסבב הזה → חגיגה
  const [done, setDone] = useState(false)
  const [topicNames, setTopicNames] = useState({})

  useEffect(() => {
    (async () => {
      const { data: ri } = await supabase.from('review_items').select('*').eq('subject_id', subjectId)
      const isQ = (r) => r.kind === 'question' || isVarKind(r.kind)
      const qIds = (ri || []).filter(isQ).map((r) => r.ref_id)
      const fIds = (ri || []).filter((r) => r.kind === 'flashcard').map((r) => r.ref_id)
      const [{ data: qs }, { data: fcs }, { data: tp }] = await Promise.all([
        qIds.length ? supabase.from('questions').select('*').in('id', qIds) : Promise.resolve({ data: [] }),
        fIds.length ? supabase.from('flashcards').select('*').in('id', fIds) : Promise.resolve({ data: [] }),
        supabase.from('topics').select('id, name').eq('subject_id', subjectId),
      ])
      setTopicNames(Object.fromEntries((tp || []).map((t) => [t.id, t.name])))
      const items = []
      for (const r of ri || []) {
        if (isQ(r)) { const q = (qs || []).find((x) => x.id === r.ref_id); if (q) items.push({ type: 'q', reviewId: r.id, kind: r.kind, streak: r.streak || 0, q: shuffleChoices(q) }) }
        else { const c = (fcs || []).find((x) => x.id === r.ref_id); if (c) items.push({ type: 'fc', reviewId: r.id, streak: r.streak || 0, card: c }) }
      }
      // סבב של עד ROUND פריטים: קודם אלה שחיכו הכי הרבה זמן, ואז מערבבים
      const byWait = (ri || []).reduce((m, r) => (m[r.id] = r.updated_at || r.created_at || '', m), {})
      items.sort((a, b) => String(byWait[a.reviewId]).localeCompare(String(byWait[b.reviewId])))
      setQueue(shuffle(items.slice(0, ROUND)))
      setLoading(false)
    })()
  }, [subjectId])

  async function grade(item, success) {
    const s = success ? item.streak + 1 : 0
    const need = isVarKind(item.kind) ? VAR_GRAD : GRAD
    if (success && s >= need) {
      await supabase.from('review_items').delete().eq('id', item.reviewId)
      // השאלה המקורית נטמעה → הטעות תוקנה, הוריאציות שלה כבר לא נחוצות
      if (item.type === 'q' && item.kind === 'question') {
        await supabase.from('review_items').delete().eq('kind', varKind(item.q.id))
      }
      setGraduated((g) => g + 1)
    } else {
      await supabase.from('review_items').update({ streak: s, updated_at: now() }).eq('id', item.reviewId)
    }
  }

  async function next() {
    if (idx >= queue.length - 1) {
      primeAudio()
      setDone(true)
      const r = await settleSession({ subjectId, correctCount: correct })
      setReward(r)
      setPlanDay(await checkPlanDayDone(subjectId))
      return
    }
    setIdx(idx + 1); setPicked(null); setFlipped(false)
  }

  async function answerQ(i) {
    if (picked != null) return
    const item = queue[idx]
    setPicked(i)
    const ok = i === item.q.answer
    if (ok) setCorrect((c) => c + 1)
    await supabase.from('attempts').insert({
      question_id: item.q.id, topic_id: item.q.topic_id, subject_id: subjectId, correct: ok, difficulty: item.q.difficulty,
    })
    await grade(item, ok)
  }
  async function rateFc(known) {
    if (known) setCorrect((c) => c + 1)
    await grade(queue[idx], known)
    next()
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  if (!queue.length) return (
    <div className="empty pt-10">
      <div className="big">🎉</div>
      אין כרגע פריטים לחיזוק!<br />כל מה שטעו בו כבר נטמע. כל הכבוד.
      <div className="mt-4"><button className="btn" onClick={() => nav.back()}>→ חזרה</button></div>
    </div>
  )

  if (done) {
    return (
      <SessionEnd correct={correct} total={queue.length} reward={reward} planDay={planDay}
        tag={`${subjectName} · חיזוק`}
        title="סיימת סבב חיזוק"
        subtitle={graduated > 0 ? `${graduated} פריטים נטמעו ויצאו מהחיזוק 🎓` : 'עוד קצת תרגול והם ייטמעו.'}
        onAgain={() => { nav.back(); nav.go('reinforce', params) }}
        onBack={() => nav.back()} />
    )
  }

  const item = queue[idx]
  const itemTopic = topicNames[item.type === 'q' ? item.q.topic_id : item.card.topic_id]

  return (
    <div className="pt-2">
      <SegProgress total={queue.length} idx={idx} />

      {item.type !== 'q' && itemTopic && <div className="topic-tag mb-1">📖 {itemTopic}</div>}

      {item.type === 'q' ? (
        <QuestionCard item={item} topic={itemTopic} picked={picked} onPick={answerQ} onNext={next} />
      ) : (
        <FlashCard item={item} flipped={flipped} setFlipped={setFlipped} onRate={rateFc} />
      )}
    </div>
  )
}

function QuestionCard({ item, topic, picked, onPick, onNext }) {
  const q = item.q
  const answered = picked != null
  return (
    <>
      <QuestionBlock topic={topic} sub="חיזוק" text={q.q} />
      <Options choices={q.choices} answer={q.answer} picked={picked} onPick={onPick} />
      {answered && (
        <FeedbackSheet ok={picked === q.answer} title={picked === q.answer ? 'יפה! מתקדם לעבר הטמעה' : 'חוזר לחיזוק — ננסה שוב'}
          explain={q.explain} onNext={onNext} />
      )}
    </>
  )
}

function FlashCard({ item, flipped, setFlipped, onRate }) {
  const c = item.card
  return (
    <>
      <div className="fc-stage">
        <div className={`fc-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <div className="fc-face fc-front">
            <div className="fc-eyebrow">כרטיסייה · מושג</div>
            <div className="fc-term">{c.front}</div>
            <div className="fc-fliphint">לחצו לתשובה ↻</div>
          </div>
          <div className="fc-face fc-back">
            <div className="fc-eyebrow">הגדרה</div>
            <div className="fc-def">{c.back}</div>
          </div>
        </div>
      </div>
      <div className="action-row mt-3">
        <button className="btn" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 40%, var(--line))' }}
          onClick={() => onRate(false)}>😕 עדיין לא</button>
        <button className="btn btn-primary" onClick={() => onRate(true)}>✅ ידעתי</button>
      </div>
    </>
  )
}
