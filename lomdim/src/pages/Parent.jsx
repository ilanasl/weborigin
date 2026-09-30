import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { renikudQuestions, reviewBatch, readReview, isUnbalanced } from '../lib/gemini'
import { canEnterParentZone } from '../lib/parentZone'

const stripN = (s) => String(s || '').replace(/[֑-ׇ]/g, '')
// שלד עיצורים "קשה" — בלי ניקוד ובלי אימות קריאה (י/ו) — כדי לסבול כתיב מלא/חסר בין המקור למנוקד
const skel = (s) => stripN(s).replace(/[יו]/g, '').replace(/\s+/g, ' ').trim()

// זיהוי מועמדות לניקוד: עוד לא מנוקדות + מכילות שם בניין או מילת מספר
const HAS_NIKUD = /[ְ-ׇּׁׂ]/
const BINYANIM = ['פעל', 'נפעל', 'פיעל', 'פועל', 'הפעיל', 'הופעל', 'התפעל']
const NUMWORDS = ['אחד', 'אחת', 'שתי', 'שתיים', 'שניים', 'שלוש', 'שלושה', 'ארבע', 'ארבעה', 'חמש', 'חמישה',
  'שש', 'שישה', 'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה', 'עשר', 'עשרה', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'מאה', 'מאתיים', 'אלף']
function isNikudCandidate(row) {
  const txt = [row.q, ...(row.choices || [])].join(' ')
  if (HAS_NIKUD.test(txt)) return false // כבר מנוקד — לא שולחים שוב
  const words = txt.split(/\s+/).map((w) => w.replace(/[^֐-׿]/g, ''))
  return words.some((w) => BINYANIM.includes(w)) || words.some((w) => NUMWORDS.includes(w))
}

// שאלות שכבר נבדקו בכלי התיקון — כדי שהרצה חוזרת לא תשלם שוב עליהן
const FIXED_KEY = 'lomdim-reviewed-q'
const readFixed = () => { try { return new Set(JSON.parse(localStorage.getItem(FIXED_KEY) || '[]')) } catch { return new Set() } }
const saveFixed = (s) => { try { localStorage.setItem(FIXED_KEY, JSON.stringify([...s])) } catch { /* */ } }

const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
)

// אזור הורה — כל מה שהילד/ה לא אמור/ה לשנות: דוח, פרסים ואישורים, כלי שאלות ואיפוס
export default function Parent({ nav }) {
  const { user, profile } = useAuth()
  const [resetting, setResetting] = useState(false)
  const [rsSubj, setRsSubj] = useState('all')
  const [subjects, setSubjects] = useState([])
  const [nkSubj, setNkSubj] = useState('all')
  const [nkBusy, setNkBusy] = useState(false)
  const [nkNote, setNkNote] = useState('')
  const [fxSubj, setFxSubj] = useState('all')
  const [fxBusy, setFxBusy] = useState(false)
  const [fxNote, setFxNote] = useState('')
  // פרסים
  const [rewards, setRewards] = useState([])
  const [pending, setPending] = useState([])
  const [rwTitle, setRwTitle] = useState('')
  const [rwCost, setRwCost] = useState('')
  const [rwBusy, setRwBusy] = useState(false)

  async function loadRewards() {
    const [{ data: rw }, { data: rd }] = await Promise.all([
      supabase.from('rewards').select('*').eq('active', true).order('cost'),
      supabase.from('redemptions').select('*').eq('status', 'pending').order('created_at'),
    ])
    setRewards(rw || []); setPending(rd || [])
  }
  useEffect(() => {
    supabase.from('subjects').select('id, name').order('created_at').then(({ data }) => setSubjects(data || []))
    loadRewards()
  }, [])

  async function addReward() {
    const title = rwTitle.trim(); const cost = parseInt(rwCost, 10)
    if (!title || !cost || cost <= 0) return
    setRwBusy(true)
    try { await supabase.from('rewards').insert({ title, cost }) } catch { /* */ }
    setRwTitle(''); setRwCost('')
    await loadRewards(); setRwBusy(false)
  }
  async function removeReward(rw) {
    if (!window.confirm(`להסיר את "${rw.title}" מהחנות?`)) return
    try { await supabase.from('rewards').update({ active: false }).eq('id', rw.id) } catch { /* */ }
    loadRewards()
  }
  async function decide(r, approve) {
    setRwBusy(true)
    try {
      if (approve) {
        // ירידת המטבעות רק עכשיו — שורת פדיון שלילית ביומן
        await supabase.from('coin_events').insert({ amount: -r.cost, reason: 'redeem', label: `פדיון: ${r.title}` })
        await supabase.from('redemptions').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', r.id)
      } else {
        await supabase.from('redemptions').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', r.id)
      }
    } catch { /* */ }
    await loadRewards(); setRwBusy(false)
  }

  async function addNikud() {
    if (!window.confirm('להוסיף ניקוד לשמות בניינים וצורות פועל בשאלות הקיימות?\nזה משתמש ב-AI (עלות קטנה חד-פעמית). ההיסטוריה נשמרת.')) return
    setNkBusy(true); setNkNote('טוען שאלות…')
    let q = supabase.from('questions').select('id, q, choices')
    if (nkSubj !== 'all') q = q.eq('subject_id', nkSubj)
    const { data } = await q
    // רק שאלות שעוד לא מנוקדות ושמכילות בניין/מספר — חוסך קרדיטים ולא רץ מחדש על הכל
    const all = (data || []).filter(isNikudCandidate)
    if (!all.length) { setNkBusy(false); setNkNote('✓ אין שאלות חדשות לניקוד — הכול מעודכן.'); return }
    let updated = 0
    const CH = 15
    for (let i = 0; i < all.length; i += CH) {
      const batch = all.slice(i, i + CH).map((x) => ({ id: x.id, q: x.q, choices: x.choices }))
      setNkNote(`מנקד… ${Math.min(i + CH, all.length)}/${all.length}`)
      try {
        const { items } = await renikudQuestions(batch)
        const byId = Object.fromEntries((items || []).map((it) => [String(it.id), it]))
        for (const orig of batch) {
          const it = byId[String(orig.id)]
          if (!it) continue
          // בטיחות פר-שדה: מיישמים ניקוד רק במקום שבו הטקסט זהה בדיוק (בלי ניקוד).
          // אם המודל שינה מילה/מסיח — פשוט משאירים את המקורי לאותו שדה. סדר האפשרויות ואינדקס התשובה נשמרים.
          const newQ = (typeof it.q === 'string' && skel(it.q) === skel(orig.q)) ? it.q : orig.q
          const newChoices = (orig.choices || []).map((oc, idx) => {
            const nc = Array.isArray(it.choices) ? it.choices[idx] : null
            return (typeof nc === 'string' && skel(nc) === skel(oc)) ? nc : oc
          })
          const changed = newQ !== orig.q || newChoices.some((c, idx) => c !== orig.choices[idx])
          if (!changed) continue
          await supabase.from('questions').update({ q: newQ, choices: newChoices }).eq('id', orig.id)
          updated++
        }
      } catch { /* מדלגים על מנה שנכשלה */ }
    }
    setNkBusy(false)
    setNkNote(`✓ הסתיים — ${updated} שאלות נוקדו${all.length ? ` (מתוך ${all.length})` : ''}.`)
  }

  async function fixExisting() {
    if (!window.confirm('לבדוק את השאלות הקיימות מול החומר ולתקן: תשובות שגויות או לא חד-משמעיות, תשובות ארוכות מדי, מסיחים לא סבירים וערבוב מקצועות?\nשאלה שגויה שאי אפשר לתקן — תימחק.\nזה משתמש ב-AI (עלות חד-פעמית, לפי כמות השאלות).')) return
    setFxBusy(true); setFxNote('טוען שאלות…')
    let q = supabase.from('questions').select('id, subject_id, material_id, q, choices, answer, explain')
    if (fxSubj !== 'all') q = q.eq('subject_id', fxSubj)
    const { data } = await q
    const done = readFixed()
    // שאלות שנבדקו כבר בהרצה קודמת — מדלגים (חוסך קרדיטים)
    const all = (data || []).filter((x) => !done.has(x.id) && Array.isArray(x.choices) && typeof x.answer === 'number')
    if (!all.length) { setFxBusy(false); setFxNote('✓ אין שאלות חדשות לבדיקה — הכול כבר נבדק.'); return }
    const names = Object.fromEntries(subjects.map((s) => [s.id, s.name]))
    // החומר שממנו נוצרה כל שאלה — כדי לבדוק נכונות מול המקור
    const matIds = [...new Set(all.map((x) => x.material_id).filter(Boolean))]
    const { data: mats } = matIds.length ? await supabase.from('materials').select('id, summary_md, source_text').in('id', matIds) : { data: [] }
    const srcOf = Object.fromEntries((mats || []).map((m) => [m.id, [m.summary_md, m.source_text].filter(Boolean).join('\n\n')]))
    let updated = 0, removed = 0, checked = 0
    const CH = 10
    // קבוצה לכל חומר (שאלות בלי חומר — לפי מקצוע), קודם השאלות שהתשובה בהן בולטת באורכה
    const groups = {}
    for (const x of all) (groups[`${x.subject_id}|${x.material_id || ''}`] ||= []).push(x)
    for (const list of Object.values(groups)) {
      list.sort((a, b) => isUnbalanced(b) - isUnbalanced(a))
      const { subject_id: sid, material_id: mid } = list[0]
      for (let i = 0; i < list.length; i += CH) {
        const batch = list.slice(i, i + CH)
        setFxNote(`בודק… ${checked + batch.length}/${all.length}`)
        try {
          const { items } = await reviewBatch({
            subjectName: names[sid] || '', learner: profile, source: (mid && srcOf[mid]) || '',
            items: batch.map((x) => ({ id: x.id, q: x.q, choices: x.choices, answer: x.answer, explain: x.explain || '' })),
          })
          const byId = Object.fromEntries((items || []).map((it) => [String(it.id), it]))
          const res = batch.map((orig) => ({ orig, got: byId[String(orig.id)], r: readReview(orig, byId[String(orig.id)]) }))
          // בודק שמוחק יותר מחצי מנה — חשוד; לא מוחקים במנה הזו
          const tooMany = res.filter((x) => x.r.kind === 'drop').length > batch.length / 2
          for (const { orig, got, r } of res) {
            if (!got) continue
            try {
              if (r.kind === 'drop' && !tooMany) {
                await supabase.from('review_items').delete().eq('ref_id', orig.id)
                await supabase.from('questions').delete().eq('id', orig.id)
                removed++
              } else if (r.kind === 'fixed') {
                const { q: nq, choices, answer, explain } = r.q
                await supabase.from('questions').update({ q: nq, choices, answer, explain }).eq('id', orig.id)
                updated++
              }
              done.add(orig.id)
            } catch { /* תיבדק שוב בהרצה הבאה */ }
          }
        } catch { /* מדלגים על מנה שנכשלה — תיבדק בהרצה הבאה */ }
        checked += batch.length
        saveFixed(done)
      }
    }
    setFxBusy(false)
    setFxNote(`✓ הסתיים — נבדקו ${all.length} שאלות: ${updated} תוקנו${removed ? `, ${removed} שגויות נמחקו` : ''}.`)
  }

  async function resetProgress() {
    const one = rsSubj !== 'all' && subjects.find((s) => s.id === rsSubj)
    const what = one ? `במקצוע "${one.name}" בלבד` : 'בכל המקצועות'
    if (!window.confirm(`לאפס את ההתקדמות (התשובות והאחוזים) ${what} ל-0?\nהחומרים, הנושאים והשאלות יישארו — רק היסטוריית התרגול תימחק.`)) return
    setResetting(true)
    const uid = user?.id
    let a = supabase.from('attempts').delete().eq('user_id', uid)
    let r = supabase.from('review_items').delete().eq('user_id', uid)
    if (one) { a = a.eq('subject_id', one.id); r = r.eq('subject_id', one.id) }
    try { await a; await r } catch { /* */ }
    setResetting(false)
    window.alert(one ? `ההתקדמות ב${one.name} אופסה — מ-0 ✨` : 'ההתקדמות אופסה — הכול מ-0 ✨')
    nav.reset('home')
  }

  if (!canEnterParentZone()) return null

  return (
    <div className="pt-1">
      <h1 className="font-black text-[30px] leading-[1.1]">אזור הורה</h1>
      <div className="text-muted text-[13.5px] mt-1.5 mb-4">מעקב, פרסים וכלי ניהול. שם, מין וכיתה נמצאים בהגדרות.</div>

      <button type="button" className="milky-row" onClick={() => nav.go('parentReport')}>
        <Icon name="chart" /><span className="flex-1 text-start font-semibold text-[15px]">דוח הורה</span><Chevron />
      </button>

      <div className="home-h2 mt-7 mb-2.5"><h2>פרסים</h2><span>{rewards.length} בחנות</span></div>
      {pending.map((r) => (
        <div key={r.id} className="milky-row mb-2">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-muted">מבקש/ת לממש</span>
            <span className="font-bold text-[15px]">{r.title} · <span className="tnum">{r.cost}</span></span>
          </div>
          <button type="button" className="store-ok" disabled={rwBusy} onClick={() => decide(r, true)}>אשר</button>
          <button type="button" className="up-x !w-auto !px-3 !text-[13.5px] font-semibold" disabled={rwBusy} onClick={() => decide(r, false)}>דחה</button>
        </div>
      ))}
      <div className="milky-row !flex-col !items-stretch !gap-2">
        {rewards.length === 0 && <div className="text-muted text-[13px]">עדיין אין פרסים בחנות.</div>}
        {rewards.map((rw) => (
          <div key={rw.id} className="flex items-center gap-2.5 py-1">
            <Icon name="gift" size={18} />
            <span className="flex-1 min-w-0 font-semibold text-[14.5px] truncate">{rw.title}</span>
            <span className="font-disp font-bold text-[14px] tnum flex items-center gap-1"><Icon name="coin" size={15} />{rw.cost}</span>
            <button type="button" className="up-x" aria-label="הסר פרס" onClick={() => removeReward(rw)}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        <div className="flex gap-2 mt-1">
          <input className="field flex-1 min-w-0" value={rwTitle} onChange={(e) => setRwTitle(e.target.value)} placeholder="פרס חדש (למשל: ערב סרט)" />
          <input className="field !w-[92px] flex-none" value={rwCost} onChange={(e) => setRwCost(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="מטבעות" />
        </div>
        <button type="button" className="btn btn-wide" disabled={rwBusy || !rwTitle.trim() || !(parseInt(rwCost, 10) > 0)} onClick={addReward}>
          <Icon name="plus" size={17} stroke={2.6} />הוסף פרס
        </button>
      </div>

      <div className="home-h2 mt-7 mb-2.5"><h2>ניקוד שאלות קיימות</h2></div>
      <div className="milky-row !flex-col !items-stretch !gap-2">
        <div className="text-[14.5px] font-bold flex items-center gap-2"><Icon name="text" size={18} />הוסף ניקוד לבניינים ולשם המספר</div>
        <div className="text-muted text-[13px] mb-3">
          מעבר חד‑פעמי שמוסיף ניקוד רק לשמות הבניינים (פָּעַל / פּוֹעֵל / פֻּעַל וכו') ולשם המספר (שְׁמוֹנָה מול שְׁמוֹנֶה) —
          ולא נוגע במילים אחרות. שומר את השאלות ואת כל ההיסטוריה. שאלות חדשות כבר מגיעות מנוקדות.
          רץ רק על שאלות שעוד לא מנוקדות ושמכילות בניין/מספר — אפשר להריץ שוב בלי לבזבז קרדיטים.
        </div>
        <select className="field mb-2" value={nkSubj} onChange={(e) => setNkSubj(e.target.value)}>
          <option value="all">כל המקצועות</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-wide" onClick={addNikud} disabled={nkBusy}>
          {nkBusy ? 'מנקד…' : <><Icon name="pencil" size={17} />נקד שאלות קיימות</>}
        </button>
        {nkNote && <div className="text-[13px] mt-2 font-semibold" style={{ color: nkBusy ? 'var(--muted)' : 'var(--good)' }}>{nkNote}</div>}
      </div>

      <div className="home-h2 mt-7 mb-2.5"><h2>תיקון שאלות קיימות</h2></div>
      <div className="milky-row !flex-col !items-stretch !gap-2">
        <div className="text-[14.5px] font-bold flex items-center gap-2"><Icon name="sparkle" size={18} />בדיקת נכונות ואיכות השאלות</div>
        <div className="text-muted text-[13px] mb-3">
          מעבר חד‑פעמי על השאלות שכבר נוצרו, מול החומר שממנו נוצרו: מתקן תשובה שגויה או לא חד‑משמעית, מקצר תשובה נכונה שארוכה מדי,
          מחליף מסיחים לא סבירים ומוציא מונחים ממקצוע אחר. שאלה שגויה שאי אפשר לתקן — נמחקת. שאלות חדשות כבר עוברות את הבדיקה הזו אוטומטית.
          שאלות שכבר נבדקו לא נשלחות שוב — אפשר להריץ שוב בלי לבזבז קרדיטים.
        </div>
        <select className="field mb-2" value={fxSubj} onChange={(e) => setFxSubj(e.target.value)}>
          <option value="all">כל המקצועות</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-wide" onClick={fixExisting} disabled={fxBusy}>
          {fxBusy ? 'בודק…' : <><Icon name="refresh" size={17} />בדוק ותקן שאלות קיימות</>}
        </button>
        {fxNote && <div className="text-[13px] mt-2 font-semibold" style={{ color: fxBusy ? 'var(--muted)' : 'var(--good)' }}>{fxNote}</div>}
      </div>

      <div className="home-h2 mt-7 mb-2.5"><h2>איפוס</h2></div>
      <div className="milky-row !flex-col !items-stretch !gap-2">
        <div className="text-[14px] mb-1 font-semibold">להתחיל נקי</div>
        <div className="text-muted text-[13px] mb-3">
          מאפס את כל ההתקדמות (התשובות והאחוזים) ל-0. שימושי כש{profile?.name || 'הילד/ה'} מתחיל לעבוד אחרי הבדיקות שלך.
          החומרים והשאלות יישארו. אפשר לאפס מקצוע אחד בלבד — השאר לא ייגעו.
        </div>
        <select className="field mb-2" value={rsSubj} onChange={(e) => setRsSubj(e.target.value)}>
          <option value="all">כל המקצועות</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-wide" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 45%, var(--line))' }}
          onClick={resetProgress} disabled={resetting}>
          {resetting ? 'מאפס…' : rsSubj === 'all' ? 'אפס התקדמות ל-0' : 'אפס את המקצוע הזה ל-0'}
        </button>
      </div>
    </div>
  )
}
