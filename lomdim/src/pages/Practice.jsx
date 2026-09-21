import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Markdown from '../components/Markdown'

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

export default function Practice({ nav, params }) {
  const { subjectId } = params
  const examMode = params.mode === 'exam'
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)
  const [showHint, setShowHint] = useState(false)
  const [correct, setCorrect] = useState(0)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('questions').select('*').eq('subject_id', subjectId).limit(30)
      setQueue(shuffle(data || []).slice(0, 10))
      setLoading(false)
    })()
  }, [subjectId])

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
    await supabase.from('attempts').insert({
      question_id: q.id, topic_id: q.topic_id, subject_id: subjectId,
      correct: ok, difficulty: q.difficulty,
    })
  }
  function next() {
    if (idx >= queue.length - 1) { setDone(true); return }
    setIdx(idx + 1); setPicked(null); setShowHint(false)
  }

  const badge = { קל: 'bg-good-soft text-good', בינוני: 'bg-accent-soft text-accent', קשה: 'bg-bad-soft text-bad' }[q.difficulty] || ''

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 text-[13px] text-muted font-semibold tnum">
          {examMode ? 'מבחן · ' : ''}שאלה {idx + 1} מתוך {queue.length}
        </div>
        <span className={`pill ${badge}`}>{q.difficulty}</span>
      </div>

      <div className="font-disp font-bold text-[19px] leading-snug my-4">{q.q}</div>

      <div className="flex flex-col gap-[10px]">
        {q.choices.map((c, i) => {
          let cls = 'border-line'
          if (answered && i === q.answer) cls = 'border-good bg-good-soft'
          else if (answered && i === picked) cls = 'border-bad bg-bad-soft'
          return (
            <button key={i} disabled={answered} onClick={() => answer(i)}
              className={`text-start rounded-[13px] border-[1.5px] ${cls} px-4 py-3 text-[15px] font-medium transition`}>
              {c}
            </button>
          )
        })}
      </div>

      {!answered && q.hint && !examMode && (
        showHint
          ? <div className="mt-3 rounded-[12px] bg-accent-soft border border-line p-3 text-[14px]">💡 {q.hint}</div>
          : <button className="mt-3 rounded-[12px] border border-dashed border-line bg-accent-soft text-accent font-semibold px-4 py-[9px] text-sm"
              onClick={() => setShowHint(true)}>💡 רמז</button>
      )}

      {answered && (
        <div className={`mt-4 rounded-[14px] p-4 text-[14px] ${picked === q.answer ? 'bg-good-soft' : 'bg-bad-soft'}`}>
          <div className="font-disp font-bold mb-1">{picked === q.answer ? '✅ יפה מאוד!' : '💡 כמעט — בוא נבין'}</div>
          <Markdown text={q.explain} />
        </div>
      )}

      {answered && (
        <button className="btn btn-primary btn-wide mt-4" onClick={next}>
          {idx >= queue.length - 1 ? 'לסיכום ←' : 'שאלה הבאה ←'}
        </button>
      )}
    </div>
  )
}
