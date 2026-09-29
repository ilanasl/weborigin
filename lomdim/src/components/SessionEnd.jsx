import { useEffect, useMemo, useState } from 'react'
import { DAILY_GOAL, DAILY_BONUS } from '../lib/coins'
import { playDing, isMuted, setMuted } from '../lib/celebrate'

const CONFETTI_COLORS = ['#D4F46A', '#B7A5FF', '#FFB28A', '#7FDCCB', '#FFA3C4', '#F5F4EF']

// מסך סיום סבב — רגיל, או חגיגה כשהסבב השלים את משימת היום
export default function SessionEnd({ correct, total, title, subtitle, tag, reward, wrongCount = 0, onAgain, onBack, onReinforce, backLabel = 'חזרה למקצוע' }) {
  const celebrate = !!reward?.events?.some((e) => e.reason === 'daily_goal')
  const [muted, setMute] = useState(isMuted())
  useEffect(() => { if (celebrate) playDing() }, [celebrate])

  const pct = total ? correct / total : 0
  const C = 2 * Math.PI * 84
  const today = reward?.todayCount
  const pieces = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    left: `${(i * 37) % 100}%`, delay: `${(i % 9) * 0.12}s`, dur: `${2.4 + (i % 5) * 0.35}s`,
    w: i % 3 ? 8 : 12, h: i % 3 ? 14 : 8, r: i % 4 === 0 ? '50%' : '2px',
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rot: `${(i * 47) % 360}deg`,
  })), [])

  const coinCard = reward && reward.earned > 0 && (
    <div className="end-coins">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="end-coins-lbl">צברת בסבב הזה</span>
        {reward.events.map((e, i) => (
          <span key={i} className="text-[13.5px] font-semibold">{e.label} <span className="tnum opacity-70">+{e.amount}</span></span>
        ))}
      </div>
      <div className="end-coins-num tnum" dir="ltr">+{reward.earned}</div>
    </div>
  )

  return (
    <div className="end">
      {celebrate && (
        <div className="confetti" aria-hidden="true">
          {pieces.map((p, i) => (
            <i key={i} style={{ left: p.left, width: p.w, height: p.h, borderRadius: p.r, background: p.color,
              animationDelay: p.delay, animationDuration: p.dur, '--rot': p.rot }} />
          ))}
        </div>
      )}

      <div className="end-top">
        {celebrate ? (
          <button type="button" className="hbtn" aria-label={muted ? 'להפעיל צלילים' : 'להשתיק צלילים'}
            onClick={() => { setMuted(!muted); setMute(!muted) }}>{muted ? '🔇' : '🔊'}</button>
        ) : tag ? <span className="end-tag">{tag}</span> : <span />}
        <button type="button" className="hbtn" aria-label="סגירה" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      {celebrate ? (
        <div className="end-hero">
          <div className="end-kicker">משימת היום</div>
          <div className="end-big tnum" dir="ltr">{DAILY_GOAL}<span>/{DAILY_GOAL}</span></div>
          <div className="end-title">הושלמה! כל הכבוד</div>
          <div className="end-sub">{correct}/{total} נכונות בסבב הזה</div>
        </div>
      ) : (
        <div className="end-hero">
          <div className="end-ring">
            <svg width="196" height="196" viewBox="0 0 196 196" aria-hidden="true">
              <circle cx="98" cy="98" r="84" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="16" />
              <circle cx="98" cy="98" r="84" fill="none" stroke="var(--primary)" strokeWidth="16" strokeLinecap="round"
                strokeDasharray={`${Math.max(0.001, pct * C)} ${C}`} transform="rotate(-90 98 98)" />
            </svg>
            <div className="end-ring-in">
              <div className="end-ring-num tnum" dir="ltr">{correct}<span>/{total}</span></div>
              <div className="text-[13px] font-semibold text-muted">תשובות נכונות</div>
            </div>
          </div>
          <div className="end-title">{title}</div>
          {subtitle && <div className="end-sub">{subtitle}</div>}
        </div>
      )}

      {coinCard}

      {!celebrate && today != null && today < DAILY_GOAL && (
        <div className="milky-row flex-col !items-stretch !gap-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[14.5px]">משימת היום</span>
            <span className="font-disp font-extrabold text-[14.5px] tnum" dir="ltr">{today}/{DAILY_GOAL}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
            <div className="h-full rounded-full" style={{ width: `${today / DAILY_GOAL * 100}%`, background: 'var(--primary)' }} />
          </div>
          <span className="text-[12.5px] text-muted">עוד {DAILY_GOAL - today} שאלות לבונוס של {DAILY_BONUS} מטבעות</span>
        </div>
      )}

      {wrongCount > 0 && onReinforce && (
        <button type="button" className="milky-row" onClick={onReinforce}>
          <span className="flex-1 text-start text-[14px] font-semibold">{wrongCount === 1 ? 'שאלה אחת עברה' : `${wrongCount} שאלות עברו`} ל„לחיזוק”</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      )}

      <div className="end-actions">
        {onAgain && <button type="button" className="end-again" onClick={onAgain}>סבב נוסף</button>}
        <button type="button" className="btn" onClick={onBack}>{backLabel}</button>
      </div>
    </div>
  )
}
