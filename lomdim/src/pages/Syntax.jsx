import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateSentenceTags } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'

const ROLES = {
  syntax: ['נושא', 'נשוא', 'נשוא מורחב', 'משלים שם', 'משלים פועל'],
  pos: ['פועל', 'שם עצם', 'שם תואר', 'מילת קישור'],
}
const COLOR = {
  'נושא': '#4A55C7', 'נשוא': '#B15A2B', 'נשוא מורחב': '#B0506A', 'משלים שם': '#6D4BB0', 'משלים פועל': '#3F8F63',
  'פועל': '#B15A2B', 'שם עצם': '#4A55C7', 'שם תואר': '#3F8F63', 'מילת קישור': '#6C7080',
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

export default function Syntax({ nav, params }) {
  const { subjectId, subjectName, topicId, topicName, mode = 'syntax' } = params
  const { profile } = useAuth()
  const roles = ROLES[mode] || ROLES.syntax
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)
  const [picks, setPicks] = useState({})
  const [sel, setSel] = useState(null)
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState('')

  // מייצר מנה חדשה של משפטים ושומר אותם (לא ייעלמו)
  async function genMore(initial) {
    setGenerating(true); setErr('')
    try {
      const { items: got } = await generateSentenceTags({ subjectName, topicName, mode, count: 6, learner: profile })
      const clean = (got || []).filter((it) => Array.isArray(it.tokens) && it.tokens.length)
      if (!clean.length) throw new Error('no_items')
      const rows = clean.map((it) => ({
        subject_id: subjectId, topic_id: topicId || null, mode,
        sentence: it.sentence || '', tokens: it.tokens, explain: it.explain || '',
      }))
      const { data: ins } = await supabase.from('syntax_items').insert(rows).select('*')
      const added = ins || []
      if (initial) { setItems(added); setIdx(0); setPicks({}); setSel(null); setChecked(false) }
      else setItems((prev) => [...prev, ...added])
    } catch (e) {
      setErr('יצירת המשפטים נכשלה. נסו שוב עוד רגע. ' + String(e?.message || e))
    } finally { setGenerating(false); setLoading(false) }
  }

  // טוען משפטים שעדיין לא נענו — ממשיכים מאיפה שעצרנו; אם אין — מייצר
  async function loadItems() {
    setLoading(true)
    let q = supabase.from('syntax_items').select('*')
      .eq('subject_id', subjectId).eq('mode', mode).eq('done', false)
    if (topicId) q = q.eq('topic_id', topicId)
    const { data } = await q.order('created_at').limit(30)
    if (data && data.length) {
      setItems(data); setIdx(0); setPicks({}); setSel(null); setChecked(false); setLoading(false)
    } else {
      await genMore(true)
    }
  }
  useEffect(() => { loadItems() }, [subjectId, topicId, mode])

  if (loading) return <div className="text-muted pt-4">{generating ? 'מכין משפטים לתרגול…' : 'טוען…'}</div>
  if (err && !items.length) return (
    <div className="pt-4">
      <div className="text-bad text-[14px] mb-3">{err}</div>
      <button className="btn btn-primary" onClick={() => genMore(true)}>נסו שוב</button>
    </div>
  )
  if (!items.length) return (
    <div className="empty pt-10"><div className="big">🧩</div>אין משפטים כרגע.<br />
      <button className="btn btn-primary mt-3" onClick={() => genMore(true)}>צור משפטים לתרגול</button>
    </div>
  )

  const item = items[idx]
  const tokens = item.tokens
  const allTagged = tokens.every((_, i) => picks[i])
  const correctCount = tokens.filter((t, i) => picks[i] === t.role).length

  function choose(role) {
    if (checked || sel == null) return
    setPicks((p) => ({ ...p, [sel]: role }))
    setSel(null)
  }

  async function ensureTopic(nm) {
    const { data: ex } = await supabase.from('topics').select('id').eq('subject_id', subjectId).eq('name', nm).maybeSingle()
    if (ex) return ex.id
    const { data: ins } = await supabase.from('topics').insert({ subject_id: subjectId, name: nm, origin: 'השנה' }).select('id').single()
    return ins?.id
  }

  // מהמילים שטעו בהן — יוצר שאלות אמריקאיות ("מה התפקיד של X?") ומכניס ל"לחיזוק"
  async function spawnReinforce() {
    try {
      const wrong = tokens.filter((t, i) => picks[i] !== t.role)
      const src = (wrong.length ? wrong : tokens).slice(0, 4)
      if (!src.length) return
      const tid = topicId || await ensureTopic('ניתוח משפט')
      const rows = src.map((t) => {
        const distractors = shuffle(roles.filter((r) => r !== t.role)).slice(0, 3)
        const choices = shuffle([t.role, ...distractors])
        return {
          subject_id: subjectId, topic_id: tid,
          q: `במשפט: "${item.sentence}" — מה התפקיד התחבירי של המילה "${t.w}"?`,
          choices, answer: choices.indexOf(t.role),
          difficulty: 'בינוני', explain: `התפקיד של "${t.w}" במשפט הוא ${t.role}.`, hint: '',
        }
      })
      const { data: ins } = await supabase.from('questions').insert(rows).select('id')
      if (ins?.length) await supabase.from('review_items')
        .insert(ins.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
    } catch { /* לא חוסם את התרגול */ }
  }

  async function check() {
    setChecked(true)
    const ok = correctCount === tokens.length
    if (topicId) {
      await supabase.from('attempts').insert({ subject_id: subjectId, topic_id: topicId, correct: ok, difficulty: 'בינוני' }).catch(() => {})
    }
    // רק משפט שנענה נכון "מסתיים" ולא חוזר; טעות נשארת (done=false) ותחזור בכניסה הבאה
    if (item?.id && ok) await supabase.from('syntax_items').update({ done: true }).eq('id', item.id).catch(() => {})
    if (!ok) spawnReinforce() // טעות → שאלות אמריקאיות ל"לחיזוק"
  }

  async function next() {
    if (idx + 1 < items.length) { setIdx(idx + 1); setPicks({}); setSel(null); setChecked(false) }
    else { await genMore(false); setIdx(idx + 1); setPicks({}); setSel(null); setChecked(false) }
  }

  return (
    <div className="pt-2">
      <h1 className="text-[22px] font-black mb-1">{mode === 'pos' ? 'זיהוי חלקי דיבר' : 'ניתוח משפט'}</h1>
      <div className="text-muted text-[13.5px] mb-1">{subjectName}{topicName ? ` · ${topicName}` : ''}</div>
      <div className="text-muted text-[12.5px] mb-4">
        {mode === 'pos' ? 'הקישו על כל מילה ובחרו את חלק הדיבר שלה.' : 'הקישו על כל מילה ובחרו את תפקידה. טיפ: קודם הנשוא, אז הנושא, ואז המשלימים.'}
      </div>

      {/* המשפט — מילים לחיצות */}
      <div className="card">
        <div className="flex flex-wrap gap-2 justify-center leading-loose" style={{ fontSize: 19 }}>
          {tokens.map((t, i) => {
            const pick = picks[i]
            const right = checked && pick === t.role
            const wrong = checked && pick && pick !== t.role
            const active = sel === i
            return (
              <button key={i} onClick={() => !checked && setSel(i)}
                className="rounded-[10px] px-2.5 py-1 border-[1.5px] font-semibold transition"
                style={{
                  borderColor: active ? 'var(--primary)' : right ? 'var(--good)' : wrong ? 'var(--bad)' : pick ? COLOR[pick] : 'var(--line)',
                  background: active ? 'var(--primary-soft)' : pick ? `color-mix(in srgb, ${COLOR[pick]} 12%, transparent)` : 'transparent',
                  color: 'var(--ink)',
                }}>
                {t.w}
                {pick && <span className="block text-[10.5px] font-bold" style={{ color: right ? 'var(--good)' : wrong ? 'var(--bad)' : COLOR[pick] }}>
                  {pick}{wrong ? ` → ${t.role}` : ''}
                </span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* בורר תוויות */}
      {!checked && (
        <div className="mt-3">
          <div className="text-muted text-[12.5px] mb-1.5 text-center">
            {sel == null ? 'בחרו מילה למעלה ↑' : `איזה תפקיד ל"${tokens[sel].w}"?`}
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {roles.map((r) => (
              <button key={r} onClick={() => choose(r)} disabled={sel == null}
                className="rounded-[999px] px-3.5 py-2 text-[13.5px] font-bold border-[1.5px] disabled:opacity-40"
                style={{ borderColor: COLOR[r], color: COLOR[r] }}>{r}</button>
            ))}
          </div>
        </div>
      )}

      {/* משוב */}
      {checked && (
        <div className="card mt-3">
          <div className="font-extrabold text-[15px] mb-1" style={{ color: correctCount === tokens.length ? 'var(--good)' : 'var(--accent)' }}>
            {correctCount === tokens.length ? '🎉 כל הכבוד! ניתוח מושלם' : `סימנת נכון ${correctCount} מתוך ${tokens.length}`}
          </div>
          {item.explain && <div className="text-[14px] text-muted leading-relaxed">{item.explain}</div>}
        </div>
      )}

      <div className="fc-count tnum mt-3">{idx + 1} / {items.length}</div>
      <div className="action-row mt-1">
        {!checked ? (
          <button className="btn btn-primary btn-wide" onClick={check} disabled={!allTagged}>
            {allTagged ? '✓ בדוק' : 'סמנו את כל המילים'}
          </button>
        ) : (
          <button className="btn btn-primary btn-wide" onClick={next} disabled={generating}>
            {generating ? 'מכין…' : (idx + 1 < items.length ? 'המשפט הבא ←' : '✨ עוד משפטים')}
          </button>
        )}
      </div>
      <div className="text-center mt-2">
        <button className="text-muted text-sm font-semibold hover:text-primary" onClick={() => nav.back()}>סיים תרגול ✓</button>
      </div>
    </div>
  )
}
