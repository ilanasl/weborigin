import Icon from '../components/Icon'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { renikudQuestions, fixQuestions, isUnbalanced } from '../lib/gemini'

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
const FIXED_KEY = 'lomdim-fixed-q'
const readFixed = () => { try { return new Set(JSON.parse(localStorage.getItem(FIXED_KEY) || '[]')) } catch { return new Set() } }
const saveFixed = (s) => { try { localStorage.setItem(FIXED_KEY, JSON.stringify([...s])) } catch { /* */ } }

const GRADES = ["ז'", "ח'", "ט'", "י'", 'י"א', 'י"ב']

export default function Settings({ nav }) {
  const { user, profile, saveProfile } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [gender, setGender] = useState(profile?.gender || 'בן')
  const [grade, setGrade] = useState(profile?.grade || "ט'")
  const [gradeNote, setGradeNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [rsSubj, setRsSubj] = useState('all')
  const [subjects, setSubjects] = useState([])
  const [nkSubj, setNkSubj] = useState('all')
  const [nkBusy, setNkBusy] = useState(false)
  const [nkNote, setNkNote] = useState('')
  const [fxSubj, setFxSubj] = useState('all')
  const [fxBusy, setFxBusy] = useState(false)
  const [fxNote, setFxNote] = useState('')

  useEffect(() => {
    supabase.from('subjects').select('id, name').order('created_at').then(({ data }) => setSubjects(data || []))
  }, [])

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
    if (!window.confirm('לעבור על השאלות הקיימות ולתקן תשובות ארוכות מדי, מסיחים לא סבירים וערבוב מקצועות?\nזה משתמש ב-AI (עלות חד-פעמית, לפי כמות השאלות). השאלות וההיסטוריה נשמרות — רק האפשרויות מנוסחות מחדש.')) return
    setFxBusy(true); setFxNote('טוען שאלות…')
    let q = supabase.from('questions').select('id, subject_id, q, choices, answer, explain')
    if (fxSubj !== 'all') q = q.eq('subject_id', fxSubj)
    const { data } = await q
    const done = readFixed()
    // שאלות שנבדקו כבר בהרצה קודמת — מדלגים (חוסך קרדיטים)
    const all = (data || []).filter((x) => !done.has(x.id) && Array.isArray(x.choices) && typeof x.answer === 'number')
    if (!all.length) { setFxBusy(false); setFxNote('✓ אין שאלות חדשות לבדיקה — הכול כבר נבדק.'); return }
    const names = Object.fromEntries(subjects.map((s) => [s.id, s.name]))
    let updated = 0, checked = 0
    const CH = 10
    for (const sid of [...new Set(all.map((x) => x.subject_id))]) {
      // קודם השאלות שהתשובה הנכונה בהן בולטת באורכה
      const list = all.filter((x) => x.subject_id === sid).sort((a, b) => isUnbalanced(b) - isUnbalanced(a))
      for (let i = 0; i < list.length; i += CH) {
        const batch = list.slice(i, i + CH)
        setFxNote(`בודק… ${checked + batch.length}/${all.length}`)
        try {
          const { items } = await fixQuestions({
            subjectName: names[sid] || '', learner: profile,
            items: batch.map((x) => ({ id: x.id, q: x.q, choices: x.choices, answer: x.answer, explain: x.explain || '' })),
          })
          const byId = Object.fromEntries((items || []).map((it) => [String(it.id), it]))
          for (const orig of batch) {
            const it = byId[String(orig.id)]
            if (!it) continue
            done.add(orig.id)
            // בטיחות: אותו מספר אפשרויות, כולן טקסט לא ריק; השאלה ומיקום התשובה לא משתנים
            const ok = it.fixed && Array.isArray(it.choices) && it.choices.length === orig.choices.length &&
              it.choices.every((c) => typeof c === 'string' && c.trim())
            if (!ok || it.choices.every((c, k) => c === orig.choices[k])) continue
            const patch = { choices: it.choices }
            if (typeof it.explain === 'string' && it.explain.trim()) patch.explain = it.explain
            try { await supabase.from('questions').update(patch).eq('id', orig.id); updated++ } catch { done.delete(orig.id) }
          }
        } catch { /* מדלגים על מנה שנכשלה — תיבדק בהרצה הבאה */ }
        checked += batch.length
        saveFixed(done)
      }
    }
    setFxBusy(false)
    setFxNote(`✓ הסתיים — ${updated} שאלות תוקנו מתוך ${all.length} שנבדקו.`)
  }

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const ok = await saveProfile({ name: name.trim(), gender, grade })
    setBusy(false)
    if (!ok) { setGradeNote('השם נשמר. כדי לשמור גם את הכיתה צריך להריץ פעם אחת את שורת ה-SQL שקיבלת.'); return }
    nav.reset('home')
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


  return (
    <div className="pt-1">
      <h1 className="font-black text-[30px] leading-[1.1]">מי מתרגל?</h1>
      <div className="text-muted text-[13.5px] mt-1.5 mb-4">המערכת תפנה אליו/ה בשם ובלשון הנכונה, ותתאים את רמת החומר לכיתה.</div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">השם</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="למשל: דניאל" />
        </div>

        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">בן או בת?</label>
          <div className="seg">
            {['בן', 'בת'].map((v) => (
              <button key={v} type="button" aria-pressed={gender === v} onClick={() => setGender(v)}>
                <span className="font-bold text-[15px] py-1">{v}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">כיתה</label>
          <div className="seg">
            {GRADES.map((v) => (
              <button key={v} type="button" aria-pressed={grade === v} onClick={() => setGrade(v)}>
                <span className="font-bold text-[15px] py-1">{v}</span>
              </button>
            ))}
          </div>
          <div className="text-[12px] text-muted mt-1.5">קובע את רמת השפה בסיכומים ובהסברים ואת קושי השאלות.</div>
        </div>

        <button type="button" className="ts-practice !mb-0" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'שומר…' : 'שמור'}
        </button>
        {gradeNote && <div className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>{gradeNote}</div>}
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
        <div className="text-[14.5px] font-bold flex items-center gap-2"><Icon name="sparkle" size={18} />שיפור איכות השאלות</div>
        <div className="text-muted text-[13px] mb-3">
          מעבר חד‑פעמי על השאלות שכבר נוצרו: מקצר תשובה נכונה שארוכה מדי, מחליף מסיחים לא סבירים, ומוציא מונחים ממקצוע אחר.
          השאלה והתשובה הנכונה נשארות, וגם כל ההיסטוריה. שאלות חדשות כבר נוצרות לפי הכללים האלה.
          שאלות שכבר נבדקו לא נשלחות שוב — אפשר להריץ שוב בלי לבזבז קרדיטים.
        </div>
        <select className="field mb-2" value={fxSubj} onChange={(e) => setFxSubj(e.target.value)}>
          <option value="all">כל המקצועות</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-wide" onClick={fixExisting} disabled={fxBusy}>
          {fxBusy ? 'בודק…' : <><Icon name="refresh" size={17} />תקן שאלות קיימות</>}
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
