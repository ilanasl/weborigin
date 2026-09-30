import { useEffect, useState } from 'react'
import { aiErrorText } from '../lib/aiError'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { generateSentenceTags } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import { SegProgress, BottomSheet, FeedbackSheet } from '../components/QuestionUI'

const ROLES = {
  syntax: ['נושא', 'נשוא', 'נשוא מורחב', 'משלים שם', 'משלים פועל'],
  pos: ['פועל', 'שם עצם', 'שם תואר', 'מילת קישור'],
}
// צבע קבוע לכל תפקיד — תמיד לצד שם התפקיד
const COLOR = {
  'נושא': '#B7A5FF', 'נשוא': '#D4F46A', 'נשוא מורחב': '#FFB28A', 'משלים שם': '#7FDCCB', 'משלים פועל': '#FF9DB4',
  'פועל': '#D4F46A', 'שם עצם': '#B7A5FF', 'שם תואר': '#7FDCCB', 'מילת קישור': '#FFB28A',
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

export default function Syntax({ nav, params }) {
  const { subjectId, subjectName, topicId, topicName, mode = 'syntax' } = params
  const { profile } = useAuth()
  const roles = ROLES[mode] || ROLES.syntax
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)
  const [picks, setPicks] = useState({})
  const [sel, setSel] = useState([])        // אפשר לבחור כמה מילים יחד ולתת להן תפקיד אחד
  const [results, setResults] = useState([])
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
      if (initial) { setItems(added); setIdx(0); setPicks({}); setSel([]); setChecked(false) }
      else setItems((prev) => [...prev, ...added])
    } catch (e) {
      setErr(aiErrorText('יצירת המשפטים נכשלה.', e?.message || e))
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
      setItems(data); setIdx(0); setPicks({}); setSel([]); setChecked(false); setLoading(false)
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
    <div className="empty pt-10"><div className="big"><Icon name="blocks" size={40} /></div>אין משפטים כרגע.<br />
      <button className="btn btn-primary mt-3" onClick={() => genMore(true)}>צור משפטים לתרגול</button>
    </div>
  )

  const item = items[idx]
  const tokens = item.tokens
  const allTagged = tokens.every((_, i) => picks[i])
  const correctCount = tokens.filter((t, i) => picks[i] === t.role).length

  function toggle(i) {
    if (checked) return
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))
  }
  function choose(role) {
    if (checked || !sel.length) return
    setPicks((p) => { const n = { ...p }; for (const i of sel) n[i] = role; return n })
    setSel([])
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
    setResults((r) => { const n = [...r]; n[idx] = ok; return n })
    // (לבונה השאילתות של Supabase אין .catch — לכן try/catch)
    try {
      if (topicId) await supabase.from('attempts').insert({ subject_id: subjectId, topic_id: topicId, correct: ok, difficulty: 'בינוני' })
      // רק משפט שנענה נכון "מסתיים" ולא חוזר; טעות נשארת (done=false) ותחזור בכניסה הבאה
      if (item?.id && ok) await supabase.from('syntax_items').update({ done: true }).eq('id', item.id)
    } catch { /* לא חוסם את התרגול */ }
    if (!ok) spawnReinforce() // טעות → שאלות אמריקאיות ל"לחיזוק"
  }

  async function next() {
    if (idx + 1 < items.length) { setIdx(idx + 1); setPicks({}); setSel([]); setChecked(false) }
    else { await genMore(false); setIdx(idx + 1); setPicks({}); setSel([]); setChecked(false) }
  }

  const taggedN = tokens.filter((_, i) => picks[i]).length
  const selWords = [...sel].sort((a, b) => a - b).map((i) => tokens[i].w).join(' ')
  const perfect = correctCount === tokens.length

  return (
    <div className="pt-1">
      <SegProgress total={items.length} idx={idx} results={results} />

      <h1 className="font-black text-[30px] leading-tight">{mode === 'pos' ? 'זיהוי חלקי דיבר' : 'ניתוח משפט'}</h1>
      <div className="text-muted text-[13.5px] mt-1 leading-relaxed">
        {checked ? 'בדקנו את הסימון שלך' : mode === 'pos'
          ? 'הקישו על מילה (או כמה) ובחרו את חלק הדיבר.'
          : 'הקישו על מילה, או על כמה מילים יחד, ובחרו תפקיד. טיפ: קודם הנשוא, אז הנושא, ואז המשלימים.'}
      </div>

      {/* המשפט — כל מילה אריח נפרד */}
      <div className="syn-words">
        {tokens.map((t, i) => {
          const pick = picks[i]
          const active = sel.includes(i)
          if (checked) {
            const right = pick === t.role
            return right ? (
              <div key={i} className="syn-tile" style={{ background: COLOR[t.role], color: 'var(--on-fill)' }}>
                <span className="syn-w">{t.w}</span>
                <span className="syn-l">{t.role} ✓</span>
              </div>
            ) : (
              <div key={i} className="syn-tile syn-wrong">
                <span className="syn-w">{t.w}</span>
                <span className="syn-l flex flex-col items-center gap-1">
                  {pick && <span className="line-through" style={{ color: 'var(--accent)' }}>{pick}</span>}
                  <span className="rounded-[9px] px-2 py-[2px]" style={{ background: COLOR[t.role], color: 'var(--on-fill)' }}>{t.role}</span>
                </span>
              </div>
            )
          }
          const style = active
            ? { background: '#FFFFFF', color: 'var(--on-fill)', boxShadow: '0 0 0 3px var(--bg), 0 0 0 6px var(--primary)' }
            : pick ? { background: COLOR[pick], color: 'var(--on-fill)' } : undefined
          return (
            <button key={i} type="button" onClick={() => toggle(i)} className={`syn-tile ${!active && !pick ? 'syn-empty' : ''}`} style={style}>
              <span className="syn-w">{t.w}</span>
              <span className="syn-l" style={{ opacity: pick ? 1 : 0.6 }}>{pick || (active ? 'בחרו תפקיד' : '?')}</span>
            </button>
          )
        })}
      </div>

      {!checked ? (
        <BottomSheet>
          <div className="text-center font-disp font-extrabold text-[18px]">
            {!sel.length ? 'בחרו מילה אחת או כמה ↑' : `איזה תפקיד ל„${selWords}”?`}
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {roles.map((r) => (
              <button key={r} type="button" onClick={() => choose(r)} disabled={!sel.length}
                className="syn-role" style={{ background: COLOR[r] }}>{r}</button>
            ))}
          </div>
          <button type="button" className="q-next" onClick={check} disabled={!allTagged}
            style={allTagged ? undefined : { background: 'rgba(20,20,22,.1)', color: 'rgba(20,20,22,.5)' }}>
            {allTagged ? '✓ בדוק' : `סמנו את כל המילים · ${taggedN} מתוך ${tokens.length}`}
          </button>
        </BottomSheet>
      ) : (
        <FeedbackSheet ok={perfect}
          title={perfect ? '🎉 ניתוח מושלם!' : `כמעט! ${correctCount} מתוך ${tokens.length}`}
          explain={item.explain}
          extra={!perfect && <div className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: '#5A43D1' }}><Icon name="book" size={16} />נוספו שאלות תרגול על המילים האלה ל„לחיזוק”</div>}
          busy={generating}
          nextLabel={generating ? 'מכין…' : (idx + 1 < items.length ? 'המשפט הבא' : 'עוד משפטים')}
          onNext={next}
          finishLabel="סיים תרגול ✓" onFinish={() => nav.back()} />
      )}
    </div>
  )
}
