import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRAD } from '../lib/mastery'
import { settleSession } from '../lib/coins'
import { primeAudio } from '../lib/celebrate'
import SessionEnd from '../components/SessionEnd'
import { checkPlanDayDone } from '../lib/plan'
import { SegProgress, QuestionBlock, Options, FeedbackSheet } from '../components/QuestionUI'

const SESSION = 12   // כמה כרטיסיות בסבב
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

// השוואה בלי ניקוד, פיסוק ורווחים — כדי ש"שם עצם" ו"שֵׁם עֶצֶם" לא יופיעו כשתי תשובות
const norm = (s) => String(s || '').replace(/[\u0591-\u05C7]/g, '').replace(/[\s"'׳״.,:;!?()\-–—]/g, '').toLowerCase()

// בונה שאלת בחירה מכרטיסייה: לפעמים מושג→הגדרה, לפעמים הגדרה→מושג.
// המסיחים נלקחים מכרטיסיות אחרות (עדיפות לאותו נושא) — שליפה אמיתית, לא דירוג עצמי.
function buildItem(card, all) {
  const reversed = Math.random() < 0.5
  const key = reversed ? 'front' : 'back'      // מה צריך לבחור
  const correct = reversed ? card.front : card.back
  const same = all.filter((c) => c.id !== card.id && c.topic_id === card.topic_id && c[key])
  const rest = all.filter((c) => c.id !== card.id && c.topic_id !== card.topic_id && c[key])
  const prompt = reversed ? card.back : card.front
  const seen = new Set([norm(correct), norm(prompt)])
  const distract = []
  for (const c of [...shuffle(same), ...shuffle(rest)]) {
    const k = norm(c[key])
    if (!k || seen.has(k)) continue
    seen.add(k); distract.push(c[key])
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
  const [results, setResults] = useState([])
  const [reward, setReward] = useState(null)
  const [planDay, setPlanDay] = useState(null) // היום בתוכנית הלמידה הושלם בסבב הזה → חגיגה
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)

  async function build() {
    setLoading(true); setDone(false); setIdx(0); setPicked(null); setCorrect(0); setResults([]); setReward(null); setPlanDay(null)
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
      <SessionEnd correct={correct} total={queue.length} reward={reward} planDay={planDay}
        tag={`${subjectName} · כרטיסיות`}
        title={pct >= 80 ? 'שליטה יפה במושגים!' : pct >= 50 ? 'בכיוון הנכון!' : 'שווה לחזור על החומר'}
        onAgain={build} onBack={() => nav.back()} />
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
    setResults((r) => { const n = [...r]; n[idx] = ok; return n })
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
      primeAudio()
      setDone(true)
      const r = await settleSession({ subjectId, correctCount: correct })
      setReward(r)
      setPlanDay(await checkPlanDayDone(subjectId))
      return
    }
    setIdx(idx + 1); setPicked(null)
  }

  return (
    <div className="pt-1">
      <SegProgress total={queue.length} idx={idx} results={results} />
      <QuestionBlock topic={eyebrow} sub={item.prompt} text={item.q} />
      <Options choices={item.choices} answer={item.answer} picked={picked} onPick={answer} />
      {answered && (
        <FeedbackSheet ok={picked === item.answer} title={picked === item.answer ? 'יפה מאוד!' : 'לא מדויק'}
          explain={picked === item.answer ? '' : `התשובה הנכונה: **${item.choices[item.answer]}**`}
          nextLabel={idx >= queue.length - 1 ? 'לסיכום' : 'הבא'} onNext={next} />
      )}
    </div>
  )
}
