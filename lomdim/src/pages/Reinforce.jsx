import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRAD } from '../lib/mastery'
import Markdown from '../components/Markdown'

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

export default function Reinforce({ nav, params }) {
  const { subjectId, subjectName } = params
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState(null)   // לשאלות
  const [flipped, setFlipped] = useState(false) // לכרטיסיות
  const [graduated, setGraduated] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: ri } = await supabase.from('review_items').select('*').eq('subject_id', subjectId)
      const qIds = (ri || []).filter((r) => r.kind === 'question').map((r) => r.ref_id)
      const fIds = (ri || []).filter((r) => r.kind === 'flashcard').map((r) => r.ref_id)
      const [{ data: qs }, { data: fcs }] = await Promise.all([
        qIds.length ? supabase.from('questions').select('*').in('id', qIds) : Promise.resolve({ data: [] }),
        fIds.length ? supabase.from('flashcards').select('*').in('id', fIds) : Promise.resolve({ data: [] }),
      ])
      const items = []
      for (const r of ri || []) {
        if (r.kind === 'question') { const q = (qs || []).find((x) => x.id === r.ref_id); if (q) items.push({ type: 'q', reviewId: r.id, streak: r.streak || 0, q: shuffleChoices(q) }) }
        else { const c = (fcs || []).find((x) => x.id === r.ref_id); if (c) items.push({ type: 'fc', reviewId: r.id, streak: r.streak || 0, card: c }) }
      }
      setQueue(shuffle(items))
      setLoading(false)
    })()
  }, [subjectId])

  async function grade(item, success) {
    const s = success ? item.streak + 1 : 0
    if (success && s >= GRAD) {
      await supabase.from('review_items').delete().eq('id', item.reviewId)
      setGraduated((g) => g + 1)
    } else {
      await supabase.from('review_items').update({ streak: s, updated_at: now() }).eq('id', item.reviewId)
    }
  }

  function next() {
    if (idx >= queue.length - 1) { setDone(true); return }
    setIdx(idx + 1); setPicked(null); setFlipped(false)
  }

  async function answerQ(i) {
    if (picked != null) return
    const item = queue[idx]
    setPicked(i)
    const ok = i === item.q.answer
    await supabase.from('attempts').insert({
      question_id: item.q.id, topic_id: item.q.topic_id, subject_id: subjectId, correct: ok, difficulty: item.q.difficulty,
    })
    await grade(item, ok)
  }
  async function rateFc(known) {
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
      <div className="pt-8 text-center">
        <div className="text-5xl mb-2">💪</div>
        <div className="font-disp font-black text-3xl">סיימת סבב חיזוק</div>
        <div className="text-muted mt-2">{graduated > 0 ? `${graduated} פריטים נטמעו ויצאו מהחיזוק 🎓` : 'עוד קצת תרגול והם ייטמעו.'}</div>
        <button className="btn btn-primary btn-wide mt-6" onClick={() => nav.back()}>חזרה למקצוע</button>
      </div>
    )
  }

  const item = queue[idx]

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 text-[13px] text-muted font-semibold tnum">📓 חיזוק · {idx + 1} מתוך {queue.length}</div>
        <span className="text-[12px] text-muted">{subjectName}</span>
      </div>

      {item.type === 'q' ? (
        <QuestionCard item={item} picked={picked} onPick={answerQ} onNext={next} />
      ) : (
        <FlashCard item={item} flipped={flipped} setFlipped={setFlipped} onRate={rateFc} />
      )}
    </div>
  )
}

function QuestionCard({ item, picked, onPick, onNext }) {
  const q = item.q
  const answered = picked != null
  return (
    <>
      <div className="font-disp font-bold text-[19px] leading-snug my-3">{q.q}</div>
      <div className="flex flex-col gap-[10px]">
        {q.choices.map((c, i) => {
          let cls = 'border-line'
          if (answered && i === q.answer) cls = 'border-good bg-good-soft'
          else if (answered && i === picked) cls = 'border-bad bg-bad-soft'
          return (
            <button key={i} disabled={answered} onClick={() => onPick(i)}
              className={`text-start rounded-[13px] border-[1.5px] ${cls} px-4 py-3 text-[15px] font-medium transition`}>{c}</button>
          )
        })}
      </div>
      {answered && (
        <div className={`mt-4 rounded-[14px] p-4 text-[14px] ${picked === q.answer ? 'bg-good-soft' : 'bg-bad-soft'}`}>
          <div className="font-disp font-bold mb-1">{picked === q.answer ? '✅ יפה! מתקדם לעבר הטמעה' : '💡 חוזר לחיזוק — ננסה שוב'}</div>
          <Markdown text={q.explain} />
        </div>
      )}
      {answered && <button className="btn btn-primary btn-wide mt-4" onClick={onNext}>הבא ←</button>}
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
