// צליל "דלינג" של מטבעות — מסונתז בדפדפן, בלי קובץ שמע
const MUTE_KEY = 'lomdim-mute'
let ctx = null

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}
export function setMuted(v) {
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0') } catch { /* לא קריטי */ }
}

// באייפון חייבים לפתוח את השמע בתוך לחיצה — קוראים לזה בלחיצה שמובילה לסיום
export function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { /* אין שמע — ממשיכים בלי */ }
}

export function playDing() {
  if (isMuted()) return
  primeAudio()
  if (!ctx) return
  const t0 = ctx.currentTime + 0.02
  ;[[1318.5, 0], [1760, 0.09], [2637, 0.18]].forEach(([f, dt]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = f
    g.gain.setValueAtTime(0, t0 + dt)
    g.gain.linearRampToValueAtTime(0.22, t0 + dt + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.45)
    o.connect(g); g.connect(ctx.destination)
    o.start(t0 + dt); o.stop(t0 + dt + 0.5)
  })
}
