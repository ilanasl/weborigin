import Icon from '../components/Icon'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const GRADES = ["ז'", "ח'", "ט'", "י'", 'י"א', 'י"ב']

export default function Settings({ nav }) {
  const { profile, saveProfile } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [gender, setGender] = useState(profile?.gender || 'בן')
  const [grade, setGrade] = useState(profile?.grade || "ט'")
  const [gradeNote, setGradeNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const ok = await saveProfile({ name: name.trim(), gender, grade })
    setBusy(false)
    if (!ok) { setGradeNote('השם נשמר. כדי לשמור גם את הכיתה צריך להריץ פעם אחת את שורת ה-SQL שקיבלת.'); return }
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

      <button type="button" className="milky-row mt-7" onClick={() => nav.go('parent')}>
        <Icon name="users" /><span className="flex-1 text-start font-semibold text-[15px]">אזור הורה</span>
        <span className="text-muted text-[12.5px]">פרסים, כלים ואיפוס</span>
      </button>
    </div>
  )
}
