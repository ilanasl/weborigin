import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Flashcards({ params }) {
  const { subjectId, subjectName } = params
  const [cards, setCards] = useState([])
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('flashcards').select('*').eq('subject_id', subjectId).order('created_at')
      setCards(data || []); setLoading(false)
    })()
  }, [subjectId])

  if (loading) return <div className="text-muted pt-4">טוען…</div>
  if (!cards.length) return (
    <div className="empty pt-10"><div className="big">🃏</div>עדיין אין כרטיסיות במקצוע הזה.<br />הן נוצרות אוטומטית כשמעלים חומר.</div>
  )

  const card = cards[i]
  const go = (d) => { setFlipped(false); setI((x) => (x + d + cards.length) % cards.length) }

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">כרטיסיות</h1>
      <div className="text-muted text-[13.5px] mb-4">{subjectName}</div>

      <div className="fc-stage">
        <div className={`fc-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
          <div className="fc-face fc-front">
            <div className="fc-eyebrow">מושג</div>
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
        <button className="btn" onClick={() => go(-1)}>→ הקודם</button>
        <button className="btn btn-primary" onClick={() => go(1)}>הבא ←</button>
      </div>
    </div>
  )
}
