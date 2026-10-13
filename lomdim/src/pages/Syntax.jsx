import { useEffect, useRef, useState } from 'react'
import { useG } from '../lib/gender'
import { aiErrorText } from '../lib/aiError'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { generateSentenceTags } from '../lib/gemini'
import { useAuth } from '../context/AuthContext'
import { SegProgress, BottomSheet, FeedbackSheet } from '../components/QuestionUI'
import { fetchAll } from '../lib/fetchAll'
import { mastery } from '../lib/mastery'

const ROLES = {
  syntax: ['נושא', 'נשוא', 'נשוא מורחב', 'משלים שם', 'משלים פועל'],
  pos: ['פועל', 'שם עצם', 'שם תואר', 'מילת קישור'],
}
// סוגי התרגול. כל סוג נכנס לתרגול המעורב רק כשיש במקצוע נושא מתאים (תפקידי המילים — תמיד).
// נושא חדש שמתאים לאחת התבניות (לפי השם שלו) מצטרף אוטומטית.
const MODES = [
  { mode: 'syntax', label: 'תפקידי המילים', match: /תחביר|ניתוח משפט/ },
  { mode: 'conn', label: 'מילות חיבור', match: /מילות חיבור|מילות קישור|משפט מחובר|משפטים מחוברים/ },
  { mode: 'pos', label: 'חלקי הדיבר', match: /חלקי (ה)?דיבר/ },
]
const CONN = 'מילת חיבור'
const DEFAULT_REL = ['חיבור והוספה', 'ניגוד וויתור', 'סיבה ותוצאה']
const relOf = (it) => (it?.tokens || []).find((t) => t.rel)?.rel || ''
const showW = (w) => (w === 'ו' ? 'ו־' : w)
// צבע קבוע לכל תפקיד — תמיד לצד שם התפקיד
const COLOR = {
  'נושא': '#B7A5FF', 'נשוא': '#D4F46A', 'נשוא מורחב': '#FFB28A', 'משלים שם': '#7FDCCB', 'משלים פועל': '#FF9DB4',
  'פועל': '#D4F46A', 'שם עצם': '#B7A5FF', 'שם תואר': '#7FDCCB', 'מילת קישור': '#FFB28A',
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

export default function Syntax({ nav, params }) {
  const g = useG()
  const { subjectId, subjectName, topicId, topicName } = params
  const { profile } = useAuth()
  // תרגול מעורב: כל משפט הוא אחד מסוגי התרגול שיש להם חומר במקצוע (הסוג נשמר על המשפט — item.mode).
  // הנושא החלש מקבל יותר משפטים. topicId — תרגול של נושא אחד בלבד.
  const [modes, setModes] = useState(null)      // [{ mode, label, topic, weight }]
  const [rel, setRel] = useState('')            // מילות חיבור: סוג הקשר שנבחר
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)
  const idxRef = useRef(0)
  idxRef.current = idx
  const [picks, setPicks] = useState({})
  const [sel, setSel] = useState([])        // אפשר לבחור כמה מילים יחד ולתת להן תפקיד אחד
  const [results, setResults] = useState([])
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState('')

  // מנה של משפטים לסוג אחד — נשמרים (לא ייעלמו)
  async function genFor(m, count) {
    // מילות חיבור — לפי החומר שהועלה לנושא (אותן מילים ואותן קטגוריות כמו במחברת)
    let source = ''
    if (m.mode === 'conn' && m.topic?.id) {
      const { data: mats } = await supabase.from('materials').select('summary_md, source_text').eq('topic_id', m.topic.id).limit(6)
      source = (mats || []).map((x) => [x.summary_md, x.source_text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')
    }
    const { items: got } = await generateSentenceTags({ subjectName, topicName: m.topic?.name || topicName, mode: m.mode, count, learner: profile, source })
    let clean = (got || []).filter((it) => Array.isArray(it.tokens) && it.tokens.length)
    if (m.mode === 'conn') {
      // הסוג נשמר על מילות החיבור עצמן (בלי עמודה חדשה במסד); משפט בלי מילת חיבור או בלי סוג — נפסל
      clean = clean.filter((it) => it.relation && it.tokens.some((t) => t.role === CONN))
        .map((it) => ({ ...it, tokens: it.tokens.map((t) => (t.role === CONN ? { ...t, rel: it.relation } : { w: t.w, role: '' })) }))
    }
    if (!clean.length) return []
    const rows = clean.map((it) => ({
      subject_id: subjectId, topic_id: m.topic?.id || null, mode: m.mode,
      sentence: it.sentence || '', tokens: it.tokens, explain: it.explain || '',
    }))
    const { data: ins } = await supabase.from('syntax_items').insert(rows).select('*')
    return ins || []
  }

  // מנה מעורבת: לכל סוג — לפי המשקל שלו (חלש = יותר משפטים); only = רק הסוגים האלה
  async function genMore(initial, only) {
    setGenerating(true); setErr('')
    try {
      const list = (only || modes || []).filter(Boolean)
      const outs = await Promise.all(list.map((m) => genFor(m, m.weight + 1).catch(() => [])))
      const added = shuffle(outs.flat())
      if (!added.length) throw new Error('no_items')
      if (initial) { setItems(added); setIdx(0); setPicks({}); setSel([]); setRel(''); setChecked(false) }
      // משפטים חדשים מתערבבים במשפטים שעוד לא הגיעו אליהם (מה שכבר נענה — לא זז)
      else setItems((prev) => { const k = Math.min(idxRef.current + 1, prev.length); return [...prev.slice(0, k), ...shuffle([...prev.slice(k), ...added])] })
    } catch (e) {
      setErr(aiErrorText('יצירת המשפטים נכשלה.', e?.message || e))
    } finally { setGenerating(false); setLoading(false) }
  }

  // סוגי התרגול הזמינים — לפי שמות הנושאים במקצוע; המשקל לפי השליטה בנושא
  useEffect(() => {
    (async () => {
      if (topicId) {
        const m = MODES.find((x) => x.mode === params.mode) || MODES.find((x) => x.match.test(topicName || '')) || MODES[0]
        setModes([{ ...m, topic: { id: topicId, name: topicName }, weight: 3 }])
        return
      }
      const { data: tps } = await supabase.from('topics').select('id, name').eq('subject_id', subjectId)
      const list = MODES.map((m) => ({ ...m, topic: (tps || []).find((t) => m.match.test(t.name)) || null }))
        .filter((m) => m.mode === 'syntax' || m.topic)
      const ids = list.map((m) => m.topic?.id).filter(Boolean)
      const { data: at } = ids.length
        ? await fetchAll(() => supabase.from('attempts').select('topic_id, correct, difficulty, created_at').in('topic_id', ids))
        : { data: [] }
      const pctOf = (tid) => mastery((at || []).filter((a) => a.topic_id === tid)
        .map((a) => ({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() }))).pct
      // חלש / עוד לא תורגל = 3 · בדרך = 2 · חזק = 1
      setModes(list.map((m) => {
        const pct = m.topic ? pctOf(m.topic.id) : null
        return { ...m, weight: pct == null || pct < 60 ? 3 : pct < 80 ? 2 : 1 }
      }))
    })()
  }, [subjectId, topicId])

  // טוען משפטים שעדיין לא נענו (מכל הסוגים, מעורבבים); סוג שאין לו משפטים מחכים — מייצרים לו
  useEffect(() => {
    if (!modes) return
    (async () => {
      setLoading(true); setResults([])
      let q = supabase.from('syntax_items').select('*').eq('subject_id', subjectId).eq('done', false)
        .in('mode', modes.map((m) => m.mode))
      if (topicId) q = q.eq('topic_id', topicId)
      const { data } = await q.order('created_at').limit(40)
      const pending = data || []
      const empty = modes.filter((m) => !pending.some((it) => it.mode === m.mode))
      if (!pending.length) { await genMore(true); return }
      setItems(shuffle(pending)); setIdx(0); setPicks({}); setSel([]); setRel(''); setChecked(false); setLoading(false)
      if (empty.length) {
        // סוג בלי משפטים מחכים — מצטרף ברקע, ומתערבב בהמשך המנה
        genMore(false, empty)
      }
    })()
  }, [modes])

  if (loading) return <div className="pt-1"><div className="text-muted pt-4">{generating ? 'מכין משפטים לתרגול…' : 'טוען…'}</div></div>
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
  // סוג התרגול של המשפט הזה, והנושא שאליו נרשמת התשובה
  const mode = item.mode || 'syntax'
  const roles = ROLES[mode] || ROLES.syntax
  const modeInfo = (modes || []).find((m) => m.mode === mode) || MODES.find((m) => m.mode === mode)
  const effTopic = topicId ? { id: topicId, name: topicName } : item.topic_id ? { id: item.topic_id, name: modeInfo?.topic?.name } : (modeInfo?.topic || null)
  const multi = (modes || []).length > 1
  // שורת "מה עושים" מעל המשפט — בתרגול מעורב, כדי שיהיה ברור איזה סוג תרגיל זה
  const kicker = multi && <span className="tp-badge mb-2 inline-block" style={{ background: 'var(--primary)' }}>{modeInfo?.label}</span>
  const allTagged = tokens.every((_, i) => picks[i])
  const correctCount = tokens.filter((t, i) => picks[i] === t.role).length
  // מילות חיבור: מסמנים את מילת החיבור (מילה אחת או כמה) ובוחרים את סוג הקשר
  const isConn = mode === 'conn'
  const connIdx = isConn ? tokens.map((t, i) => (t.role === CONN ? i : -1)).filter((i) => i >= 0) : []
  const rightRel = isConn ? relOf(item) : ''
  const relOptions = (() => {
    if (!isConn) return []
    const seen = [...new Set(items.map(relOf).filter(Boolean))]
    const base = DEFAULT_REL.filter((r) => seen.includes(r) || seen.length < 3)
    return [...base, ...seen.filter((r) => !base.includes(r))]
  })()
  const connWordsOk = isConn && sel.length === connIdx.length && connIdx.every((i) => sel.includes(i))
  const connOk = connWordsOk && rel === rightRel

  function toggle(i) {
    if (checked) return
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))
  }
  function choose(role) {
    if (checked || !sel.length || isConn) return
    setPicks((p) => { const n = { ...p }; for (const i of sel) n[i] = role; return n })
    setSel([])
  }

  async function ensureTopic(nm) {
    const { data: all } = await supabase.from('topics').select('id, name').eq('subject_id', subjectId)
    const ex = (all || []).find((t) => t.name === nm)
    if (ex) return ex.id
    // יש כבר נושא תחביר במקצוע (למשל "תחביר המשפט הפשוט") — משייכים אליו, לא פותחים נושא כפול
    const syn = (all || []).find((t) => /תחביר/.test(t.name)) || (all || []).find((t) => /משפט/.test(t.name))
    if (syn) return syn.id
    const { data: ins } = await supabase.from('topics').insert({ subject_id: subjectId, name: nm, origin: 'השנה' }).select('id').single()
    return ins?.id
  }

  // מהמילים שטעו בהן — יוצר שאלות אמריקאיות ("מה התפקיד של X?") ומכניס ל"לחיזוק"
  async function spawnReinforce() {
    try {
      if (isConn) {
        // מילות חיבור: שאלה על סוג הקשר של מילת החיבור במשפט
        const word = connIdx.map((i) => showW(tokens[i].w)).join(' ')
        const choices = shuffle([rightRel, ...shuffle(relOptions.filter((r) => r !== rightRel)).slice(0, 3)])
        const { data: ins } = await supabase.from('questions').insert({
          subject_id: subjectId, topic_id: effTopic?.id || null,
          q: `במשפט: "${item.sentence}" — איזה קשר מבטאת מילת החיבור "${word}"?`,
          choices, answer: choices.indexOf(rightRel),
          difficulty: 'בינוני', explain: item.explain || `"${word}" מבטאת ${rightRel}.`, hint: '',
        }).select('id')
        if (ins?.length) await supabase.from('review_items').insert(ins.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
        return
      }
      const wrong = tokens.filter((t, i) => picks[i] !== t.role)
      const src = (wrong.length ? wrong : tokens).slice(0, 4)
      if (!src.length) return
      const tid = effTopic?.id || await ensureTopic('ניתוח משפט')
      const rows = src.map((t) => {
        const distractors = shuffle(roles.filter((r) => r !== t.role)).slice(0, 3)
        const choices = shuffle([t.role, ...distractors])
        return {
          subject_id: subjectId, topic_id: tid,
          q: mode === 'pos' ? `במשפט: "${item.sentence}" — מהו חלק הדיבר של המילה "${t.w}"?` : `במשפט: "${item.sentence}" — מה התפקיד התחבירי של המילה "${t.w}"?`,
          choices, answer: choices.indexOf(t.role),
          difficulty: 'בינוני', explain: mode === 'pos' ? `"${t.w}" היא ${t.role}.` : `התפקיד של "${t.w}" במשפט הוא ${t.role}.`, hint: '',
        }
      })
      const { data: ins } = await supabase.from('questions').insert(rows).select('id')
      if (ins?.length) await supabase.from('review_items')
        .insert(ins.map((r) => ({ subject_id: subjectId, kind: 'question', ref_id: r.id, streak: 0 })))
    } catch { /* לא חוסם את התרגול */ }
  }

  async function check() {
    setChecked(true)
    const ok = isConn ? connOk : correctCount === tokens.length
    setResults((r) => { const n = [...r]; n[idx] = ok; return n })
    // (לבונה השאילתות של Supabase אין .catch — לכן try/catch)
    try {
      if (effTopic?.id) await supabase.from('attempts').insert({ subject_id: subjectId, topic_id: effTopic.id, correct: ok, difficulty: 'בינוני' })
      // רק משפט שנענה נכון "מסתיים" ולא חוזר; טעות נשארת (done=false) ותחזור בכניסה הבאה
      if (item?.id && ok) await supabase.from('syntax_items').update({ done: true }).eq('id', item.id)
    } catch { /* לא חוסם את התרגול */ }
    if (!ok) spawnReinforce() // טעות → שאלות אמריקאיות ל"לחיזוק"
  }

  async function next() {
    if (idx + 1 < items.length) { setIdx(idx + 1); setPicks({}); setSel([]); setRel(''); setChecked(false) }
    else { await genMore(false); setIdx(idx + 1); setPicks({}); setSel([]); setRel(''); setChecked(false) }
  }

  if (isConn) {
    const canCheck = sel.length > 0 && rel
    const connWord = connIdx.map((i) => showW(tokens[i].w)).join(' ')
    return (
      <div className="pt-1">
        <SegProgress total={items.length} idx={idx} results={results} />
        {kicker}
        <h1 className="font-black text-[30px] leading-tight">{multi ? 'ניתוח משפט' : 'מילות חיבור'}</h1>
        <div className="text-muted text-[13.5px] mt-1 leading-relaxed">
          {checked ? 'בדקנו את התשובה שלך' : 'הקישו על מילת החיבור (אם היא כמה מילים — על כולן), ובחרו למטה איזה קשר היא מבטאת.'}
        </div>
        <div className="syn-words">
          {tokens.map((t, i) => {
            const isC = t.role === CONN, on = sel.includes(i)
            if (checked) {
              const style = isC ? { background: '#FFB28A', color: 'var(--on-fill)' } : undefined
              return (
                <div key={i} className={`syn-tile syn-tile-sm ${!isC && on ? 'syn-wrong' : !isC ? 'syn-empty' : ''}`} style={style}>
                  <span className={`syn-w ${!isC && on ? 'line-through' : ''}`}>{showW(t.w)}</span>
                  {isC && <span className="syn-l">{on ? '✓' : 'זו מילת החיבור'}</span>}
                </div>
              )
            }
            return (
              <button key={i} type="button" onClick={() => toggle(i)} className={`syn-tile syn-tile-sm ${on ? '' : 'syn-empty'}`}
                style={on ? { background: '#FFB28A', color: 'var(--on-fill)', boxShadow: '0 0 0 3px var(--bg), 0 0 0 6px var(--primary)' } : undefined}>
                <span className="syn-w">{showW(t.w)}</span>
              </button>
            )
          })}
        </div>
        {!checked ? (
          <BottomSheet>
            <div className="text-center font-disp font-extrabold text-[18px]">
              {!sel.length ? 'הקישו על מילת החיבור ↑' : 'איזה קשר היא מבטאת?'}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {relOptions.map((r) => (
                <button key={r} type="button" onClick={() => setRel(r)} className="syn-role"
                  style={{ background: rel === r ? 'var(--primary)' : 'rgba(20,20,22,.08)', color: 'var(--on-fill)' }}>{r}</button>
              ))}
            </div>
            <button type="button" className="q-next" onClick={check} disabled={!canCheck}
              style={canCheck ? undefined : { background: 'rgba(20,20,22,.1)', color: 'rgba(20,20,22,.5)' }}>
              {canCheck ? g('✓ בדוק', '✓ בדקי') : !sel.length ? 'סמנו את מילת החיבור' : 'בחרו את סוג הקשר'}
            </button>
          </BottomSheet>
        ) : (
          <FeedbackSheet ok={connOk}
            title={connOk ? '🎉 נכון!' : !connWordsOk && rel !== rightRel ? 'לא הפעם' : !connWordsOk ? 'סוג הקשר נכון — אבל מילת החיבור אחרת' : 'מילת החיבור נכונה — אבל הקשר אחר'}
            explain={`מילת החיבור: „${connWord}” · ${rightRel}${item.explain ? ` — ${item.explain}` : ''}`}
            extra={!connOk && <div className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: '#5A43D1' }}><Icon name="book" size={16} />נוספה שאלת תרגול ל„לחיזוק”</div>}
            busy={generating}
            nextLabel={generating ? 'מכין…' : (idx + 1 < items.length ? 'המשפט הבא' : 'עוד משפטים')}
            onNext={next}
            finishLabel="סיים תרגול ✓" onFinish={() => nav.back()} />
        )}
      </div>
    )
  }

  const taggedN = tokens.filter((_, i) => picks[i]).length
  const selWords = [...sel].sort((a, b) => a - b).map((i) => tokens[i].w).join(' ')
  const perfect = correctCount === tokens.length

  return (
    <div className="pt-1">
      <SegProgress total={items.length} idx={idx} results={results} />
      {kicker}
      <h1 className="font-black text-[30px] leading-tight">{mode === 'pos' && !multi ? 'זיהוי חלקי דיבר' : 'ניתוח משפט'}</h1>
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
            {allTagged ? g('✓ בדוק', '✓ בדקי') : `סמנו את כל המילים · ${taggedN} מתוך ${tokens.length}`}
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
