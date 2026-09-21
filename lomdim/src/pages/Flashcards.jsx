import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRAD } from '../lib/mastery'

export default function Flashcards({ nav, params }) {
  const { subjectId, subjectName } = params
  const [cards, setCards] = useState([])
  const [topicNames, setTopicNames] = useState({})
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data }, { data: tp }] = await Promise.all([
        supabase.from('flashcards').select('*').eq('subject_id', subjectId).order('created_at'),
        supabase.from('topics').select('id, name').eq('subject_id', subjectId),
      ])
      setCards(data || [])
      setTopicNames(Object.fromEntries((tp || []).map((t) => [t.id, t.name])))
      setLoading(false)
    })()
  }, [subjectId])

  if (loading) return <div className="text-muted pt-4">טוען…</div>
  if (!cards.length) return (
    <div className="empty pt-10"><div className="big">🃏</div>עדיין אין כרטיסיות במקצוע הזה.<br />הן נוצרות אוטומטית כשמעלים חומר.</div>
  )

  const card = cards[i]
  const cardContext = card.context || topicNames[card.topic_id] || 'מושג'
  const go = (d) => { setFlipped(false); setI((x) => (x + d + cards.length) % cards.length) }

  async function rate(known) {
    const c = card
    const { data: ex } = await supabase.from('review_items')
      .select('id, streak').eq('kind', 'flashcard').eq('ref_id', c.id).maybeSingle()
    if (!known) {
      // לא ידעתי → נכנס/מתאפס בלחיזוק
      if (ex) await supabase.from('review_items').update({ streak: 0, updated_at: new Date().toISOString() }).eq('id', ex.id)
      else await supabase.from('review_items').insert({ subject_id: subjectId, kind: 'flashcard', ref_id: c.id, streak: 0 })
    } else if (ex) {
      // ידעתי → מתקדם בעקומת הלמידה; אחרי GRAD יוצא מהחיזוק
      const s = (ex.streak || 0) + 1
      if (s >= GRAD) await supabase.from('review_items').delete().eq('id', ex.id)
      else await supabase.from('review_items').update({ streak: s, updated_at: new Date().toISOString() }).eq('id', ex.id)
    }
    go(1)
  }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">כרטיסיות</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="fc-stage">
        <div className={`fc-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <div className="fc-face fc-front">
            <div className="fc-eyebrow">{cardContext}</div>
            <div className="fc-term">{card.front}</div>
            <div className="fc-fliphint">לחצו כדי לראות את ההגדרה ↻</div>
          </div>
          <div className="fc-face fc-back">
            <div className="fc-eyebrow">הגדרה</div>
            <div className="fc-def">{card.back}</div>
            <div className="fc-fliphint">לחצו כדי לחזור ↻</div>
          </div>
        </div>
      </div>

      <div className="fc-count tnum">{i + 1} / {cards.length}</div>

      <div className="action-row">
        <button className="btn" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 40%, var(--line))' }}
          onClick={() => rate(false)}>😕 עדיין לא</button>
        <button className="btn btn-primary" onClick={() => rate(true)}>✅ ידעתי</button>
      </div>
      <div className="text-center mt-2 flex flex-col gap-2">
        <button className="text-muted text-sm font-semibold" onClick={() => go(1)}>דלג ←</button>
        <button className="text-muted text-sm font-semibold hover:text-primary" onClick={() => nav.back()}>סיים תרגול ✓</button>
      </div>
    </div>
  )
}
