import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { coinSummary } from '../lib/coins'

const REASON_ICON = { practice: 'pencil', daily_goal: 'target', streak: 'flame', mastery: 'gem', redeem: 'gift' }
// פרס שאפשר כבר לקנות — כרטיס צבעוני; פרס שעוד חסר לו — חלבי עם פס התקדמות
const PRIZE_FILLS = ['#D4F46A', '#B7A5FF', '#FFB28A', '#7FDCCB']

export default function Store({ nav }) {
  const [sum, setSum] = useState({ balance: 0, reserved: 0, available: 0, recent: [] })
  const [rewards, setRewards] = useState([])
  const [reds, setReds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const [s, { data: rw }, { data: rd }] = await Promise.all([
      coinSummary(),
      supabase.from('rewards').select('*').eq('active', true).order('cost'),
      supabase.from('redemptions').select('*').order('created_at', { ascending: false }),
    ])
    setSum(s); setRewards(rw || []); setReds(rd || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function request(rw) {
    if (sum.available < rw.cost) return
    setBusy(true)
    await supabase.from('redemptions').insert({ reward_id: rw.id, title: rw.title, cost: rw.cost, status: 'pending' })
    await load(); setBusy(false)
  }

  const pending = reds.filter((r) => r.status === 'pending')
  const history = reds.filter((r) => r.status !== 'pending')

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-1 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <h1 className="flex-1 font-black text-[28px] leading-none">חנות הפרסים</h1>
      </div>

      {/* יתרה */}
      <div className="coin-hero">
        <div className="text-[14px] font-semibold">המטבעות שלי</div>
        <div className="coin-hero-num tnum" dir="ltr">{sum.balance}</div>
        <div className="text-[13px] font-semibold" style={{ color: 'rgba(19,19,22,.72)' }}>
          {sum.reserved > 0 ? `${sum.reserved} ממתינים לאישור · ${sum.available} זמינים לפדיון` : 'כל המטבעות זמינים לפדיון'}
        </div>
      </div>

      {/* בקשות ממתינות לאישור הורה */}
      {pending.map((r) => (
        <div key={r.id} className="milky-row">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-muted">ממתין לאישור הורה</span>
            <span className="font-bold text-[15px]">{r.title} · <span className="tnum">{r.cost}</span></span>
          </div>
        </div>
      ))}

      {/* הפרסים */}
      <div>
        <div className="home-h2 mb-2.5"><h2>פרסים</h2><span>{rewards.length} פרסים</span></div>
        {rewards.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין פרסים. ההורה מוסיף אותם באזור ההורה.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {rewards.map((rw, i) => {
              const can = sum.available >= rw.cost
              const fill = PRIZE_FILLS[i % PRIZE_FILLS.length]
              return (
                <div key={rw.id} className="prize" style={can ? { background: fill, color: 'var(--on-fill)', borderColor: 'transparent', boxShadow: 'none' } : undefined}>
                  <div className="flex flex-col gap-1">
                    <div className="font-disp font-extrabold text-[17px] leading-tight">{rw.title}</div>
                    <div className="font-disp font-bold text-[14px] tnum flex items-center gap-1.5"><Icon name="coin" size={16} />{rw.cost}</div>
                  </div>
                  {can ? (
                    <button type="button" className="prize-btn" style={{ color: fill }} disabled={busy} onClick={() => request(rw)}>אני רוצה</button>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (sum.available / rw.cost) * 100)}%`, background: 'var(--primary)' }} />
                      </div>
                      <div className="text-[12.5px] font-semibold text-muted">עוד {rw.cost - sum.available} מטבעות</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* איך צברתי */}
      {sum.recent.length > 0 && (
        <div>
          <div className="home-h2 mb-2.5"><h2>התנועות האחרונות</h2></div>
          <div className="flex flex-col gap-1.5">
            {sum.recent.map((e, i) => (
              <div key={i} className="milky-row !py-2.5">
                <span className="w-9 h-9 rounded-[11px] grid place-items-center flex-none" style={{ background: 'rgba(255,255,255,.1)' }}><Icon name={REASON_ICON[e.reason] || 'coin'} size={18} /></span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-semibold text-[14px] truncate">{e.label || e.reason}</span>
                  <span className="text-[12px] text-muted">{new Date(e.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}</span>
                </span>
                <span className="font-disp font-extrabold text-[16px] tnum" dir="ltr" style={{ color: e.amount < 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {e.amount < 0 ? '' : '+'}{e.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* היסטוריית פדיונות */}
      {history.length > 0 && (
        <div>
          <div className="home-h2 mb-2.5"><h2>פרסים שמומשו</h2></div>
          <div className="flex flex-col gap-1.5">
            {history.map((r) => (
              <div key={r.id} className="milky-row !py-2.5 text-[14px]">
                <span className="flex-1 font-semibold">{r.title}</span>
                <span className="font-bold" style={{ color: r.status === 'approved' ? 'var(--good)' : 'var(--muted)' }}>
                  {r.status === 'approved' ? '✓ אושר' : 'נדחה'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
