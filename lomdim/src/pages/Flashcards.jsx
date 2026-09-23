import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRAD } from '../lib/mastery'
import { settleSession } from '../lib/coins'

const SESSION = 12   // כמה כרטיסיות בסבב
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

// בונה שאלת בחירה מכרטיסייה: לפעמים מושג→הגדרה, לפעמים הגדרה→מושג.
// המסיחים נלקחים מכרטיסיות אחרות (עדיפות לאותו נושא) — שליפה אמיתית, לא דירוג עצמי.
function buildItem(card, all) {
  const reversed = Math.random() < 0.5
  const key = reversed ? 'front' : 'back'      // מה צריך לבחור
  const correct = reversed ? card.front : card.back
  const same = all.filter((c) => c.id !== card.id && c.topic_id === card.topic_id && c[key])
  const rest = all.filter((c) => c.id !== card.id && c.topic_id !== card.topic_id && c[key])
  const seen = new Set([correct])
  const distract = []
  for (const c of [...shuffle(same), ...shuffle(rest)]) {
    if (seen.has(c[key])) continue
    seen.add(c[key]); distract.push(c[key])
    if (distract.length >= 3) break
  }
  const choices = shuffle([correct, ...distract])
  return {
    id: card.id, topic_id: card.topic_id,
    prompt: reversed ? 'איזה מושג מתאים להגדרה?' : 'מה ההגדרה של המושג?',
    q: reversed ? card.back : card.front,
    choices, answer: choices.indexOf(correct),
    valid: choices.length >= 2,
  }
}

export default function Flashcards({ nav, params }) {
  const { subjectId, subjectName } = params
  const [queue, setQueue] = useState([])
  const [topicNames, setTopicNames] = useState({})
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)
  const [correct, setCorrect] = useState(0)
  const [reward, setReward] = useState(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)

  async function build() {
    setLoading(true); setDone(false); setIdx(0); setPicked(null); setCorrect(0); setReward(null)
    const [{ data: cards }, { data: tp }] = await Promise.all([
      supabase.from('flashcards').select('*').eq('subject_id', subjectId),
      supabase.from('topics').select('id, name').eq('subject_id', subjectId),
    ])
    setTopicNames(Object.fromEntries((tp || []).map((t) => [t.id, t.name])))
    const all = cards || []
    const items = shuffle(all).slice(0, SESSION).map((c) => buildItem(c, all)).filter((it) => it.valid)
    setQueue(items)
    setEmpty(all.length === 0)
    setLoading(false)
  }
  useEffect(() => { build() }, [subjectId])

  if (loading) return <div className="text-muted pt-4">טוען…</div>
  if (empty) return (
    <div className="empty pt-10"><div className="big">🃏</div>עדיין אין כרטיסיות במקצוע הזה.<br />הן נוצרות אוטומטית כשמעלים חומר.</div>
  )
  if (!queue.length) return (
    <div className="empty pt-10"><div className="big">🃏</div>צריך עוד כמה כרטיסיות כדי לבנות שאלות זיהוי.<br />העלו עוד חומר במקצוע.
      <div className="mt-4"><button className="btn" onClick={() => nav.back()}>→ חזרה</button></div>
    </div>
  )

  if (done) {
    const pct = Math.round(correct / queue.length * 100)
    return (
      <div className="pt-8 text-center">
        <div className="text-5xl mb-2">{pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '🌱'}</div>
        <div className="font-disp font-black text-5xl text-primary tnum">{correct}/{queue.length}</div>
        <div className="text-muted mt-1">{pct >= 80 ? 'שליטה יפה במושגים!' : pct >= 50 ? 'בכיוון הנכון' : 'שווה לחזור על החומר'}</div>
        {reward && reward.earned > 0 && (
          <div className="mt-5 mx-auto max-w-[300px] rounded-[16px] bg-accent-soft border border-line p-4">
            <div className="font-disp font-black text-[22px] text-accent tnum">🪙 +{reward.earned}</div>
            <div className="flex flex-col gap-0.5 mt-1.5 text-[13px] text-muted">
              {reward.events.map((e, i) => (
                <div key={i} className="flex items-center justify-between"><span>{e.label}</span><span className="tnum font-semibold">+{e.amount}</span></div>
              ))}
            </div>
          </div>
        )}
        <div className="action-row mt-6">
          <button className="btn" onClick={build}>🔁 סבב נוסף</button>
          <button className="btn btn-primary" onClick={() => nav.back()}>חזרה למקצוע</button>
        </div>
      </div>
    )
  }

  const item = queue[idx]
  const answered = picked != null
  const eyebrow = topicNames[item.topic_id] || 'מושג'

  async function answer(i) {
    if (answered) return
    setPicked(i)
    const ok = i === item.answer
    if (ok) setCorrect((c) => c + 1)
    // תיעוד כניסיון אמיתי (נספר בהתקדמות ובמטבעות). question_id ריק — זו כרטיסייה.
    await supabase.from('attempts').insert({
      subject_id: subjectId, topic_id: item.topic_id, correct: ok, difficulty: 'קל',
    })
    // חיזוק/הטמעה — כמו קודם, אבל לפי תשובה שנבדקה ולא דירוג עצמי
    const { data: ex } = await supabase.from('review_items')
      .select('id, streak').eq('kind', 'flashcard').eq('ref_id', item.id).maybeSingle()
    if (!ok) {
      if (ex) await supabase.from('review_items').update({ streak: 0, updated_at: new Date().toISOString() }).eq('id', ex.id)
      else await supabase.from('review_items').insert({ subject_id: subjectId, kind: 'flashcard', ref_id: item.id, streak: 0 })
    } else if (ex) {
      const s = (ex.streak || 0) + 1
      if (s >= GRAD) await supabase.from('review_items').delete().eq('id', ex.id)
      else await supabase.from('review_items').update({ streak: s, updated_at: new Date().toISOString() }).eq('id', ex.id)
    }
  }

  async function next() {
    if (idx >= queue.length - 1) {
      setDone(true)
      const r = await settleSession({ subjectId, correctCount: correct })
      setReward(r)
      return
    }
    setIdx(idx + 1); setPicked(null)
  }

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 text-[13px] text-muted font-semibold tnum">🃏 {eyebrow} · {idx + 1} מתוך {queue.length}</div>
        <span className="text-[12px] text-muted">{subjectName}</span>
      </div>

      <div className="text-[12.5px] text-muted mt-2">{item.prompt}</div>
      <div className="font-disp font-bold text-[21px] leading-snug mt-1 mb-4">{item.q}</div>

      <div className="flex flex-col gap-[10px]">
        {item.choices.map((c, i) => {
          let cls = 'border-line'
          if (answered && i === item.answer) cls = 'border-good bg-good-soft'
          else if (answered && i === picked) cls = 'border-bad bg-bad-soft'
          return (
            <button key={i} disabled={answered} onClick={() => answer(i)}
              className={`text-start rounded-[13px] border-[1.5px] ${cls} px-4 py-3 text-[15px] font-medium transition`}>
              {c}
            </button>
          )
        })}
      </div>

      {answered && (
        <div className={`mt-4 rounded-[14px] p-4 text-[14px] ${picked === item.answer ? 'bg-good-soft' : 'bg-bad-soft'}`}>
          <div className="font-disp font-bold">{picked === item.answer ? '✅ יפה מאוד!' : '💡 לא מדויק — התשובה הנכונה מסומנת בירוק'}</div>
        </div>
      )}

      {answered && (
        <button className="btn btn-primary btn-wide mt-4" onClick={next}>
          {idx >= queue.length - 1 ? 'לסיכום ←' : 'הבא ←'}
        </button>
      )}
      {!answered && (
        <div className="text-center mt-4">
          <button className="text-muted text-sm font-semibold hover:text-primary" onClick={() => nav.back()}>סיים תרגול ✓</button>
        </div>
      )}
    </div>
  )
}
