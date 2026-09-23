import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { coinSummary } from '../lib/coins'

const REASON_ICON = { practice: '✏️', daily_goal: '🎯', streak: '🔥', mastery: '💎', redeem: '🎁' }

export default function Store({ nav }) {
  const [sum, setSum] = useState({ balance: 0, reserved: 0, available: 0, recent: [] })
  const [rewards, setRewards] = useState([])
  const [reds, setReds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState(false)

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

  async function addReward() {
    const title = prompt('שם הפרס (למשל: ערב משחקים, בחירת סרט):')
    if (!title?.trim()) return
    const costStr = prompt('כמה מטבעות הוא עולה?')
    const cost = parseInt(costStr, 10)
    if (!cost || cost <= 0) return
    setBusy(true)
    await supabase.from('rewards').insert({ title: title.trim(), cost })
    await load(); setBusy(false)
  }

  async function removeReward(id) {
    if (!confirm('להסיר את הפרס מהחנות?')) return
    await supabase.from('rewards').update({ active: false }).eq('id', id)
    load()
  }

  async function request(rw) {
    if (sum.available < rw.cost) return
    setBusy(true)
    await supabase.from('redemptions').insert({ reward_id: rw.id, title: rw.title, cost: rw.cost, status: 'pending' })
    await load(); setBusy(false)
  }

  async function decide(r, approve) {
    setBusy(true)
    if (approve) {
      // ירידת המטבעות רק עכשיו — שורת פדיון שלילית ביומן
      await supabase.from('coin_events').insert({ amount: -r.cost, reason: 'redeem', label: `פדיון: ${r.title}` })
      await supabase.from('redemptions').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', r.id)
    } else {
      await supabase.from('redemptions').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', r.id)
    }
    await load(); setBusy(false)
  }

  const pending = reds.filter((r) => r.status === 'pending')
  const history = reds.filter((r) => r.status !== 'pending')

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  return (
    <div className="pt-2">
      {/* יתרה */}
      <div className="ready-card text-center">
        <div className="text-[13px] text-muted font-semibold">המטבעות שלי</div>
        <div className="font-disp font-black text-[46px] text-accent tnum leading-tight">🪙 {sum.balance}</div>
        {sum.reserved > 0 && (
          <div className="text-[12.5px] text-muted">{sum.reserved} ממתינים לאישור · {sum.available} זמינים לפדיון</div>
        )}
      </div>

      {/* בקשות ממתינות */}
      {pending.length > 0 && (
        <>
          <div className="list-title">בקשות לאישור הורה</div>
          <div className="card flex flex-col gap-2.5">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="font-semibold text-[14.5px]">{r.title}</div>
                  <div className="text-[12px] text-muted tnum">🪙 {r.cost}</div>
                </div>
                <button className="btn btn-primary !py-1.5 !px-3 text-[13px]" disabled={busy} onClick={() => decide(r, true)}>אשר</button>
                <button className="btn !py-1.5 !px-3 text-[13px]" disabled={busy} onClick={() => decide(r, false)}>דחה</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* חנות הפרסים */}
      <div className="list-title flex items-center gap-2">
        <span className="flex-1">חנות הפרסים</span>
        <button className="text-[12.5px] font-bold text-primary" onClick={() => setManage((v) => !v)}>
          {manage ? 'סיום ניהול' : '✎ ניהול הורה'}
        </button>
      </div>
      <div className="card">
        {rewards.length === 0 ? (
          <div className="text-muted text-sm mb-3">עדיין אין פרסים. הוסיפו פרס דרך «ניהול הורה».</div>
        ) : (
          <div className="flex flex-col gap-2.5 mb-3">
            {rewards.map((rw) => {
              const can = sum.available >= rw.cost
              return (
                <div key={rw.id} className="flex items-center gap-2 rounded-[13px] border border-line p-3">
                  <div className="text-2xl">🎁</div>
                  <div className="flex-1">
                    <div className="font-semibold text-[15px]">{rw.title}</div>
                    <div className="text-[12.5px] text-muted tnum">🪙 {rw.cost} מטבעות</div>
                  </div>
                  {manage ? (
                    <button className="btn !py-1.5 !px-3 text-[13px] text-bad" onClick={() => removeReward(rw.id)}>הסר</button>
                  ) : (
                    <button className="btn btn-primary !py-1.5 !px-3 text-[13px]" disabled={!can || busy} onClick={() => request(rw)}>
                      {can ? 'אני רוצה' : 'חסר עוד'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {manage && (
          <button className="btn btn-wide" disabled={busy} onClick={addReward}>➕ הוסף פרס</button>
        )}
      </div>

      {/* איך צברתי */}
      {sum.recent.length > 0 && (
        <>
          <div className="list-title">התנועות האחרונות</div>
          <div className="card">
            <div className="timeline">
              {sum.recent.map((e, i) => (
                <div key={i} className="tl-item">
                  <div className="d">{new Date(e.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}</div>
                  <div className="t"><span className="font-medium text-[13.5px]">{REASON_ICON[e.reason] || '•'} {e.label || e.reason}</span></div>
                  <div className={`tag tnum ${e.amount < 0 ? 'text-bad' : 'text-good'}`}>{e.amount < 0 ? '' : '+'}{e.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* היסטוריית פדיונות */}
      {history.length > 0 && (
        <>
          <div className="list-title">פרסים שמומשו</div>
          <div className="card flex flex-col gap-1.5">
            {history.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[13.5px]">
                <span className="flex-1">{r.title}</span>
                <span className={r.status === 'approved' ? 'text-good font-semibold' : 'text-muted'}>
                  {r.status === 'approved' ? '✓ אושר' : 'נדחה'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
