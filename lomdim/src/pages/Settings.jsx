import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { renikudQuestions } from '../lib/gemini'

const stripN = (s) => String(s || '').replace(/[֑-ׇ]/g, '')
// שלד עיצורים "קשה" — בלי ניקוד ובלי אימות קריאה (י/ו) — כדי לסבול כתיב מלא/חסר בין המקור למנוקד
const skel = (s) => stripN(s).replace(/[יו]/g, '').replace(/\s+/g, ' ').trim()

export default function Settings({ nav }) {
  const { user, profile, saveProfile } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [gender, setGender] = useState(profile?.gender || 'בן')
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [nkSubj, setNkSubj] = useState('all')
  const [nkBusy, setNkBusy] = useState(false)
  const [nkNote, setNkNote] = useState('')

  useEffect(() => {
    supabase.from('subjects').select('id, name').order('created_at').then(({ data }) => setSubjects(data || []))
  }, [])

  async function addNikud() {
    if (!window.confirm('להוסיף ניקוד לשמות בניינים וצורות פועל בשאלות הקיימות?\nזה משתמש ב-AI (עלות קטנה חד-פעמית). ההיסטוריה נשמרת.')) return
    setNkBusy(true); setNkNote('טוען שאלות…')
    let q = supabase.from('questions').select('id, q, choices')
    if (nkSubj !== 'all') q = q.eq('subject_id', nkSubj)
    const { data } = await q
    const all = data || []
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

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    await saveProfile({ name: name.trim(), gender })
    setBusy(false)
    nav.reset('home')
  }

  async function resetProgress() {
    if (!window.confirm('לאפס את כל ההתקדמות (התשובות והאחוזים) ל-0?\nהחומרים, הנושאים והשאלות יישארו — רק היסטוריית התרגול תימחק.')) return
    setResetting(true)
    const uid = user?.id
    await supabase.from('attempts').delete().eq('user_id', uid)
    await supabase.from('review_items').delete().eq('user_id', uid)
    setResetting(false)
    window.alert('ההתקדמות אופסה — הכול מ-0 ✨')
    nav.reset('home')
  }

  const GenderBtn = ({ value, label }) => (
    <button onClick={() => setGender(value)}
      className={`flex-1 rounded-[12px] border-[1.5px] py-3 text-[15px] font-semibold transition ${
        gender === value ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink'
      }`} style={gender === value ? { background: 'var(--primary-soft)' } : {}}>
      {label}
    </button>
  )

  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-1">מי מתרגל?</h1>
      <div className="text-muted text-[13.5px] mb-4">המערכת תפנה אליו/ה בשם ובלשון הנכונה.</div>

      <div className="card flex flex-col gap-4">
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">השם</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="למשל: דניאל" autoFocus />
        </div>

        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">בן או בת?</label>
          <div className="flex gap-2">
            <GenderBtn value="בן" label="בן" />
            <GenderBtn value="בת" label="בת" />
          </div>
        </div>

        <button className="btn btn-primary btn-wide" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'שומר…' : 'שמור'}
        </button>
      </div>

      <div className="list-title">ניקוד שאלות קיימות</div>
      <div className="card">
        <div className="text-[14px] mb-1 font-semibold">🔤 הוסף ניקוד לבניינים ולשם המספר</div>
        <div className="text-muted text-[13px] mb-3">
          מעבר חד‑פעמי שמוסיף ניקוד רק לשמות הבניינים (פָּעַל / פּוֹעֵל / פֻּעַל וכו') ולשם המספר (שְׁמוֹנָה מול שְׁמוֹנֶה) —
          ולא נוגע במילים אחרות. שומר את השאלות ואת כל ההיסטוריה. שאלות חדשות כבר מגיעות מנוקדות.
        </div>
        <select className="field mb-2" value={nkSubj} onChange={(e) => setNkSubj(e.target.value)}>
          <option value="all">כל המקצועות</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-wide" onClick={addNikud} disabled={nkBusy}>
          {nkBusy ? 'מנקד…' : '🔤 נקד שאלות קיימות'}
        </button>
        {nkNote && <div className="text-[13px] mt-2 font-semibold" style={{ color: nkBusy ? 'var(--muted)' : 'var(--good)' }}>{nkNote}</div>}
      </div>

      <div className="list-title">איפוס</div>
      <div className="card">
        <div className="text-[14px] mb-1 font-semibold">להתחיל נקי</div>
        <div className="text-muted text-[13px] mb-3">
          מאפס את כל ההתקדמות (התשובות והאחוזים) ל-0. שימושי כש{profile?.name || 'הילד/ה'} מתחיל לעבוד אחרי הבדיקות שלך.
          החומרים והשאלות יישארו.
        </div>
        <button className="btn btn-wide" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 45%, var(--line))' }}
          onClick={resetProgress} disabled={resetting}>
          {resetting ? 'מאפס…' : 'אפס התקדמות ל-0'}
        </button>
      </div>
    </div>
  )
}
