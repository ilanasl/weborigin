import { useEffect, useState } from 'react'
import { toAIInput } from '../lib/image'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { mastery } from '../lib/mastery'
import { scanScope } from '../lib/gemini'
import { toneOf } from '../lib/tone'
import Icon from '../components/Icon'
import { LEAD_DEFAULT, daysUntil, parseDay, buildStudyPlan, nearestKind, refreshScopeTopics, expirePastExams } from '../lib/plan'

const Chev = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.55, flex: 'none' }}><path d="M15 6l-6 6 6 6" /></svg>
)

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']


export default function Planner({ nav, params }) {
  const { subjectId, subjectName } = params
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [kind, setKind] = useState('מבחן מסכם')
  const [leadDays, setLeadDays] = useState(LEAD_DEFAULT['מבחן מסכם'])
  const [exam, setExam] = useState({ date: '', scope: '' })  // מבחן מסכם
  const [quiz, setQuiz] = useState({ date: '', scope: '' })  // מבדק
  const [scopeFile, setScopeFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [matchNote, setMatchNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [allTs, setAllTs] = useState([])   // זמני כל התשובות במקצוע — לסימון יום חזרה שבוצע

  async function load() {
    setLoading(true)
    // מבחן שעבר — מתאפס לפני הטעינה (תאריך + מיקוד), כדי שהטופס יתחיל נקי
    const { data: s0 } = await supabase.from('subjects').select('*').eq('id', subjectId).single()
    const [s] = await expirePastExams(s0 ? [s0] : [])
    const [{ data: tp }, { data: at }] = await Promise.all([
      supabase.from('topics').select('*').eq('subject_id', subjectId).order('created_at'),
      fetchAll(() => supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', subjectId)),
    ])
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({ correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime() })
    }
    setSubject(s)
    setExam({ date: s?.exam_date || '', scope: s?.exam_scope_text || '' })
    setQuiz({ date: s?.quiz_date || '', scope: s?.quiz_scope_text || '' })
    // ברירת מחדל: הסוג הקרוב יותר שכבר הוגדר לו תאריך
    const qd = daysUntil(s?.quiz_date), ed = daysUntil(s?.exam_date)
    const k = (qd != null && qd >= 0 && (ed == null || ed < 0 || qd <= ed)) ? 'מבדק' : 'מבחן מסכם'
    setKind(k)
    setLeadDays(LEAD_DEFAULT[k])
    setTopics((tp || []).map((t) => ({ ...t, att: byTopic[t.id] || [], m: mastery(byTopic[t.id] || []) })))
    setAllTs((at || []).map((a) => new Date(a.created_at).getTime()))
    setLoading(false)
  }
  useEffect(() => { load() }, [subjectId])

  // המשבצת הפעילה לפי הסוג שנבחר
  const slot = kind === 'מבדק' ? quiz : exam
  const setSlot = (patch) => (kind === 'מבדק' ? setQuiz : setExam)((s) => ({ ...s, ...patch }))
  const date = slot.date
  const scope = slot.scope

  async function onPickPhoto(f) {
    setScanErr('')
    if (!f) { setScopeFile(null); return }
    setScopeFile(f); setScanning(true)
    try {
      const text = await scanScope({ ...(await toAIInput(f)), subjectName })
      if (text) setSlot({ scope: (scope ? scope.trim() + '\n' : '') + text.trim() })
    } catch (e) {
      setScanErr('קריאת הצילום נכשלה. אפשר לכתוב את המיקוד ידנית. ' + String(e?.message || e).slice(0, 160))
    } finally { setScanning(false) }
  }

  async function save() {
    setBusy(true); setMatchNote('')
    const cols = kind === 'מבדק'
      ? { quiz_date: date || null, quiz_scope_text: scope || null }
      : { exam_kind: 'מבחן מסכם', exam_date: date || null, exam_scope_text: scope || null }
    await supabase.from('subjects').update(cols).eq('id', subjectId)
    // מיקוד → נושאים: הסימון "במבחן" תמיד לפי המבחן הקרוב (מבדק ומבחן לא דורסים זה את זה).
    // בלי מיקוד — אף נושא לא מסומן, והמבדק יהיה על כל החומר.
    const updated = { ...subject, name: subjectName, ...cols }
    if (nearestKind(updated) === kind) {
      try {
        const set = await refreshScopeTopics(updated)
        if (set?.size) setMatchNote(`זוהו ${set.size} נושאים במיקוד — התוכנית והמבדק יתמקדו בהם: ${[...set].join(', ')}`)
        else if (scope.trim()) setMatchNote('לא נמצאו נושאים שמתאימים למיקוד — אולי צריך להעלות את החומר. בינתיים המבדק יהיה על כל החומר.')
      } catch { /* לא חוסם את שמירת התוכנית */ }
    } else if (scope.trim()) {
      setMatchNote(`נשמר. המיקוד הזה ייכנס לתוקף אחרי ה${kind === 'מבדק' ? 'מבחן' : 'מבדק'} הקרוב.`)
    }
    // שמירת צילום המיקוד כחומר (כדי שיישמר וייראה ב"החומרים שהעליתי")
    if (scopeFile) {
      try {
        const { data: u } = await supabase.auth.getUser()
        const uid = u.user?.id
        let storagePath = null
        if (uid) {
          storagePath = `${uid}/scope-${Date.now()}`
          await supabase.storage.from('materials').upload(storagePath, scopeFile).catch(() => {})
        }
        await supabase.from('materials').insert({
          subject_id: subjectId, title: 'מיקוד המבחן', kind: 'image',
          storage_path: storagePath, origin: 'השנה', source_text: scope || null,
        })
      } catch { /* לא חוסם את שמירת התוכנית */ }
      setScopeFile(null)
    }
    await load()
    setBusy(false)
  }

  if (loading) return <div className="text-muted pt-4">טוען…</div>

  const examDays = daysUntil(date)
  // אם זוהו נושאים במבחן (מהמיקוד) — מתמקדים בהם; אחרת בכל הנושאים. חלשים קודם.
  // תוכנית: חלון קבוע לפי תאריך המבחן, חלשים קודם, יום לפני = חזרה כללית, ימים שהושלמו מסומנים (lib/plan)
  const { days: plan, startsInDays } = buildStudyPlan({ examDays, leadDays, topics, allTs })

  return (
    <div className="pt-1">
      <span className="end-tag inline-block mb-3">{subjectName}</span>
      <h1 className="font-black text-[30px] leading-[1.1] mb-4">מתכנן המבחן</h1>

      {/* כמה זמן נשאר — בצבע המקצוע */}
      {examDays != null && examDays >= 0 && (
        <div className="exam-card !cursor-default mb-4" style={{ background: toneOf(subject).bg }}>
          <span className="exam-days">
            {examDays === 0 ? <b className="!text-[24px]">היום</b> : <><b className="tnum">{examDays}</b><small>ימים</small></>}
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="font-disp font-extrabold text-[17px]">{examDays === 0 ? `ה${kind} היום — בהצלחה!` : `${kind} בעוד ${examDays} ימים`}</span>
            <span className="text-[12.5px] font-semibold" style={{ color: 'rgba(19,19,22,.72)' }}>
              {startsInDays != null ? `הלמידה מתחילה בעוד ${startsInDays} ימים — עד אז אפשר להתמקד במבחנים קרובים` : `הלמידה מתחילה ${leadDays} ימים לפני`}
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[13.5px] font-bold text-muted mb-1.5">איזה מהם עורכים?</div>
          <div className="seg">
            {['מבחן מסכם', 'מבדק'].map((k) => {
              const d = k === 'מבדק' ? quiz.date : exam.date
              return (
                <button key={k} type="button" onClick={() => { setKind(k); setLeadDays(LEAD_DEFAULT[k]) }} aria-pressed={kind === k}>
                  <span className="font-bold text-[14.5px]">{k}</span>
                  <span className="text-[11.5px] opacity-70">{d ? parseDay(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : 'ללא תאריך'}</span>
                </button>
              )
            })}
          </div>
          <div className="text-[12px] text-muted mt-1.5">אפשר להגדיר תאריך גם למבדק וגם למבחן — שניהם יופיעו בבית ובלוח המבחנים.</div>
        </div>

        {/* "מתחילים ללמוד X ימים לפני" הוסר מהמסך — מספר קבוע לפי סוג המבחן (LEAD_DEFAULT) */}
        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">תאריך ה{kind}</label>
          <input type="date" className="field" value={date} onChange={(e) => setSlot({ date: e.target.value })} />
        </div>

        <div>
          <label className="block text-[13.5px] font-bold text-muted mb-1.5">מיקוד החומר (חופשי)</label>
          <textarea className="field" style={{ minHeight: 80 }} value={scope}
            onChange={(e) => setSlot({ scope: e.target.value })}
            placeholder="מה בדיוק במבחן? אפשר להעתיק את מה שהמורה שלחה…" />
          <label className="milky-row mt-2 cursor-pointer">
            <Icon name="camera" />
            <span className="flex-1 text-[13.5px] font-semibold">
              {scanning ? 'קורא את הצילום…' : scopeFile ? 'צילום צורף וזוהה — אפשר לערוך את הטקסט למעלה' : 'צרפו צילום של המיקוד (למשל מהלוח)'}
            </span>
            {scopeFile && !scanning && <Icon name="check" size={18} style={{ color: 'var(--good)' }} />}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0] || null)} />
          </label>
          {scanErr && <div className="text-[12.5px] mt-1.5 font-semibold" style={{ color: 'var(--bad)' }}>{scanErr}</div>}
        </div>

        <button type="button" className="ts-practice !mb-0" onClick={save} disabled={busy}>
          <Icon name="sparkle" size={19} />{busy ? 'שומר ובונה…' : 'שמור ובנה תוכנית'}
        </button>
        {matchNote && <div className="text-good text-[13px] font-semibold leading-relaxed">{matchNote}</div>}
      </div>

      {plan.length > 0 && (
        <>
          <div className="home-h2 mt-6 mb-2.5">
            <h2>תוכנית הלמידה</h2>
            <span>חלשים קודם</span>
          </div>
          <div className="flex flex-col gap-2">
            {plan.filter((p) => !p.exam).map((p, i) => {
              const date = p.dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
              const today = p.off === 0
              const tileStyle = p.done ? { background: 'var(--good)', color: 'var(--on-fill)' }
                : p.review ? { background: '#B7A5FF', color: 'var(--on-fill)' }
                : today ? { background: 'var(--primary)', color: 'var(--on-fill)' } : undefined
              const tile = (
                <span className="plan-tile" style={tileStyle}>
                  {p.done ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="בוצע"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  ) : (<><b>{today ? 'היום' : DOW[p.dt.getDay()]}</b><small>{date}</small></>)}
                </span>
              )
              if (p.review) return (
                <button key={i} type="button" className={`milky-row plan-row ${p.done ? 'plan-done' : ''}`} onClick={() => nav.go('reinforce', { subjectId, subjectName })}>
                  {tile}
                  <span className="flex-1 text-start text-[14.5px] font-semibold plan-txt">חזרה כללית + לחיזוק</span>
                  <Chev />
                </button>
              )
              return (
                <div key={i} className={`milky-row plan-row !items-start ${p.done ? 'plan-done' : ''} ${today && !p.done ? 'plan-today' : ''}`}>
                  {tile}
                  <div className="flex-1 min-w-0 flex flex-col">
                    {p.topics.map((t) => (
                      <button key={t.id} type="button" className={`plan-topic ${t.done ? 'plan-topic-done' : ''}`}
                        onClick={() => nav.go('topicSummary', { subjectId, subjectName, topicId: t.id, topicName: t.name })}>
                        <span className="flex-1 min-w-0 plan-txt">{t.name}</span>
                        {t.done && !p.done && <span className="text-good font-bold" aria-label="בוצע">✓</span>}
                        <Chev />
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* קו סיום: יום המבחן — בצבע של המקצוע, לא עוד יום תרגול */}
          {plan.filter((p) => p.exam).map((p, i) => (
            <div key={`x${i}`} className="plan-finish" style={{ '--c': toneOf(subject).bg }}>
              <div className="plan-finish-line">
                <span />
                <i><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg></i>
                <span />
              </div>
              <div className="plan-finish-title">בהצלחה ב{kind}!</div>
              <div className="text-[13px] font-semibold text-muted">
                יום {DOW[p.dt.getDay()]} · {p.dt.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} · {subjectName}
              </div>
            </div>
          ))}
        </>
      )}

      {/* מבחנים שעברו — עבר לכאן ממסך המקצוע (קשור להכנה למבחן) */}
      <button type="button" className="milky-row mt-6" onClick={() => nav.go('pastExams', { subjectId, subjectName })}>
        <Icon name="archive" />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
          <span className="font-bold text-[15px]">מבחנים שעברו</span>
          <span className="text-[12.5px] text-muted">ציונים, צילומי מבחנים מתוקנים וטעויות לחיזוק</span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
    </div>
  )
}
