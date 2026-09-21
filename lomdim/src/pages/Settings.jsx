import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Settings({ nav }) {
  const { profile, saveProfile } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [gender, setGender] = useState(profile?.gender || 'בן')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    await saveProfile({ name: name.trim(), gender })
    setBusy(false)
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
    </div>
  )
}
