import { useEffect, useState } from 'react'
import { useG } from '../lib/gender'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { cached, remember } from '../lib/screenCache'
import { mastery, examReadiness, level, STRONG, LEVEL_LABEL } from '../lib/mastery'
import { expirePastExams, PASSED_KEY, daysUntil, parseDay } from '../lib/plan'

const LEVEL_COLOR = { strong: 'var(--good)', mid: 'var(--primary)', weak: 'var(--accent)' }
import { withTone } from '../lib/tone'
import { foldLegacyCheckTopic, LEGACY_CHECK_TOPIC } from '../lib/checkTopic'


export default function Subject({ nav, params }) {
  const g = useG()
  const { id } = params
  // חזרה למסך — מציגים מיד את מה שהיה, ומרעננים ברקע
  const snap = cached(`subject:${id}`)
  const [subject, setSubject] = useState(snap?.subject || null)
  const [topics, setTopics] = useState(snap?.topics || [])
  const [materials, setMaterials] = useState(snap?.materials || [])
  const [qCount, setQCount] = useState(snap?.qCount || 0)
  const [rvCount, setRvCount] = useState(snap?.rvCount || 0)
  const [loading, setLoading] = useState(!snap)

  async function load() {
    // הכול במקביל; מהחומרים — רק מה שהמסך מציג (בלי טקסט הסיכומים, שיכול להיות כבד)
    const topicsQ = () => supabase.from('topics').select('*').eq('subject_id', id).order('created_at')
    const [{ data: s0 }, { data: tp0 }, { data: mt }, { data: at }, { count: qc }, { count: rc }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', id).single(),
      topicsQ(),
      supabase.from('materials').select('id, created_at, storage_path, content_hash').eq('subject_id', id).order('created_at', { ascending: false }),
      fetchAll(() => supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', id)),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('subject_id', id),
    ])
    // מבחן/מבדק שעבר — מתאפס; רק אז סימון הנושאים השתנה וצריך לטעון אותם שוב
    const [s] = await expirePastExams(s0 ? [s0] : [])
    const tp = s && s !== s0 ? (await topicsQ()).data : tp0
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({
        correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
      })
    }
    const next = {
      subject: s ? withTone(s) : null,
      topics: (tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })),
      // רק קבצים שהועלו בפועל (יש להם קובץ מאוחסן או חתימת תוכן) — לא סיכומים/הערות שנוצרו
      materials: (mt || []).filter((m) => m.storage_path || m.content_hash),
      qCount: qc || 0, rvCount: rc || 0,
    }
    setSubject(next.subject); setTopics(next.topics); setMaterials(next.materials)
    setQCount(next.qCount); setRvCount(next.rvCount)
    setLoading(false)
    remember(`subject:${id}`, next)
  }
  useEffect(() => { load() }, [id])
  // חד-פעמי: "תרגילים שבדקתי" כבר לא יחידה נפרדת — השאלות עוברות לנושאים שלהן
  useEffect(() => {
    if (!subject?.name || !topics.some((t) => t.name === LEGACY_CHECK_TOPIC)) return
    foldLegacyCheckTopic(id, subject.name).then((moved) => { if (moved) load() })
  }, [subject?.name, topics.length])

  if (loading || !subject) return <div className="text-muted pt-4">טוען…</div>

  const name = subject.name
  // המבחן/מבדק הקרוב יותר מבין השניים
  const upcomingExams = [
    { kind: 'מבחן מסכם', days: daysUntil(subject.exam_date) },
    { kind: 'מבדק', days: daysUntil(subject.quiz_date) },
  ].filter((x) => x.days != null && x.days >= 0).sort((a, b) => a.days - b.days)
  const examDays = upcomingExams[0]?.days ?? null
  const examKind = upcomingExams[0]?.kind || 'מבחן'
  // תאריך המבחן הקרוב, קצר ("12.10") — לכפתור הסימולציה
  const examRaw = upcomingExams[0] ? (upcomingExams[0].kind === 'מבדק' ? subject.quiz_date : subject.exam_date) : null
  const examDate = examRaw ? (() => { const d = parseDay(examRaw); return `${d.getDate()}.${d.getMonth() + 1}` })() : null

  // מוכנות למבחן: נושאי המבחן (או כולם אם לא הוגדר מיקוד); נושא שלא תורגל נספר כ-0
  const rd = examReadiness(topics.map((t) => ({ in_exam: t.in_exam, pct: t.m.pct })))
  const ready = rd.pct
  const scopeTopics = topics.some((t) => t.in_exam) ? topics.filter((t) => t.in_exam) : topics
  const strong = scopeTopics.filter((t) => level(t.m.pct) === 'strong')
  // "הכי כדאי לתרגל עכשיו": 2 הנושאים החלשים — קודם כאלה שתורגלו ועוד לא חזקים, ורק אחריהם נושאים שעוד לא תורגלו
  const focus = [
    ...scopeTopics.filter((t) => t.m.pct != null && t.m.pct < STRONG).sort((a, b) => a.m.pct - b.m.pct),
    ...scopeTopics.filter((t) => t.m.pct == null),
  ].slice(0, 2)
  // מבחן קרוב אך עדיין לא הוגדר/הועלה חומר עבורו (אין נושאים מסומנים "במבחן")
  const hasExam = examDays != null && examDays >= 0
  const needsMaterial = hasExam && topics.filter((t) => t.in_exam).length === 0
  // מבחן שעבר (התאפס אוטומטית) — מבקשים חומר חדש עד שמעלים משהו אחרי מועד האיפוס
  const passed = (() => {
    try {
      const p = JSON.parse(localStorage.getItem(PASSED_KEY(id)) || 'null')
      if (!p) return null
      const uploadedAfter = materials.some((m) => new Date(m.created_at).getTime() > p.ts)
      return uploadedAfter ? null : p
    } catch { return null }
  })()
  // תרגיל ניתוח משפט רלוונטי ללשון/עברית/דקדוק
  const isLang = /עברית|לשון|דקדוק|תחביר/.test(name || '')

  // הסיכום האחרון כהקשר ל"תסביר לי" — נטען רק בלחיצה (לא בכל כניסה למסך)
  const openExplain = async () => {
    let context
    try {
      const { data } = await supabase.from('materials').select('summary_md').eq('subject_id', id)
        .not('summary_md', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      context = data?.summary_md || undefined
    } catch { /* בלי הקשר */ }
    nav.go('explain', { subjectId: id, subjectName: name, context })
  }

  const isEmpty = topics.length === 0 && materials.length === 0
  const goPractice = (mode) => nav.go('practice', { subjectId: id, subjectName: name, mode })

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-4 mt-1">
        <div className="min-w-0">
          <h1 className="font-black text-[38px] leading-none tracking-tight">{name}</h1>
          <div className="text-[14px] text-muted mt-1.5">
            {topics.length} נושאים{hasExam ? ` · ${examKind} ${examDays === 0 ? 'היום' : `בעוד ${examDays} ימים`}` : ''}
          </div>
        </div>

      </div>

      {/* מקצוע ריק — פעולה אחת ברורה במקום כל המסך */}
      {isEmpty ? (
        <div className="rounded-[28px] p-6 flex flex-col items-center text-center gap-3" style={{ background: subject.bg, color: 'var(--on-fill)' }}>
          <span className="w-16 h-16 rounded-full grid place-items-center" style={{ background: 'rgba(255,255,255,.55)' }}>
            <Icon name="camera" size={30} />
          </span>
          <div className="font-disp font-extrabold text-[22px] leading-tight">מתחילים כאן</div>
          <div className="text-[14.5px] leading-relaxed" style={{ color: 'rgba(19,19,22,.75)' }}>
            מצלמים דף מהמחברת או מעלים PDF — והמערכת מכינה ממנו סיכום ושאלות לתרגול.
          </div>
          <button type="button" className="ready-btn w-full mt-1" style={{ background: 'var(--on-fill)', color: subject.bg, flex: 'none' }}
            onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
            <Icon name="upload" size={20} />{g('העלה חומר ראשון', 'העלי חומר ראשון')}
          </button>
          <button type="button" className="text-[13.5px] font-semibold underline underline-offset-4" style={{ color: 'rgba(19,19,22,.7)' }}
            onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}>
            יש מבחן קרוב? אפשר כבר להגדיר תאריך
          </button>
        </div>
      ) : (<>
      {/* כרטיס מוכנות — בצבע המקצוע */}
      <div className="ready-hero" style={{ background: subject.bg }}>
        {/* בלי מבחן קרוב, או מבחן שעוד לא הוגדר לו חומר — זה לא "מוכנות", אלא כמה החומר שולט */}
        <div className="text-[14px] font-semibold">{hasExam && !needsMaterial ? `מוכנות ל${examKind === 'מבדק' ? 'מבדק' : 'מבחן'}` : 'השליטה שלי בחומר'}</div>
        <div className="ready-hero-num tnum" dir="ltr">{ready == null ? '—' : `${ready}%`}</div>
        <div className="hero-track !flex-none"><i style={{ width: `${ready || 0}%` }} /></div>
        {ready == null && <div className="text-[12.5px] font-semibold" style={{ color: 'rgba(19,19,22,.7)' }}>עוד לא תורגל — כמה תרגולים והמספר יופיע.</div>}
        {ready != null && (
          <div className="flex flex-col gap-2 mt-0.5">
            <span className="text-[13.5px] font-bold inline-flex items-center gap-1.5"><Icon name="check" size={16} />חזק ב-{strong.length} מתוך {rd.total} נושאים · תורגלו {rd.practiced}</span>
            {focus.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-bold" style={{ color: 'rgba(19,19,22,.7)' }}>הכי כדאי לתרגל עכשיו</span>
                <div className="flex gap-1.5 flex-wrap">
                  {focus.map((t) => (
                    <button key={t.id} type="button" className="ready-chip ready-chip-weak" aria-label={`לתרגל את ${t.name}`}
                      onClick={() => nav.go('practice', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name, mode: 'practice' })}>
                      <b aria-hidden="true">!</b>{t.name}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.5 }}><path d="M15 6l-6 6 6 6" /></svg>
                    </button>
                  ))}
                </div>
              </div>
            ) : <span className="text-[15px] font-extrabold inline-flex items-center gap-1.5">הכול חזק! <ConfettiIcon /></span>}
          </div>
        )}
        <div className="flex gap-2 mt-0.5">
          <button type="button" className="ready-btn" style={{ background: 'var(--on-fill)', color: subject.bg }} disabled={qCount === 0}
            onClick={() => nav.go('practicePicker', { subjectId: id, subjectName: name, mode: 'practice' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
            <span className="ready-lbl" style={{ color: '#fff' }}><span>תרגול חופשי</span><small>כל החומר</small></span>
          </button>
          <button type="button" className="ready-btn" style={{ background: '#fff', color: 'var(--on-fill)' }} disabled={qCount === 0} onClick={() => goPractice('exam')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
            <span className="ready-lbl">
              <span>סימולציה</span>
              {/* סימולציה על המבדק רק כשהוגדר לו חומר; אחרת — על כל החומר */}
              <small>{examDate && !needsMaterial ? `${examKind === 'מבדק' ? 'מבדק' : 'מבחן'} · ${examDate}` : 'על כל החומר'}</small>
            </span>
          </button>
        </div>
      </div>

      {/* כלים */}
      {(() => {
        // שני טורים, אריחים זהים — אף פעם בלי חור.
        const list = [
          topics.length > 0 && { k: 'sm', label: 'סיכומים', sub: 'חוברת כל הנושאים', icon: 'note', go: () => nav.go('summaries', { subjectId: id, subjectName: name }) },
          { k: 'rv', label: 'לחיזוק', sub: rvCount > 0 ? 'מה שכדאי לחזק' : 'אין כרגע מה לחזק', icon: 'book', count: rvCount, go: () => nav.go('reinforce', { subjectId: id, subjectName: name }) },
          { k: 'pl', label: 'מתכנן המבחן', sub: needsMaterial ? 'צריך להגדיר חומר' : 'תוכנית עד המבחן', icon: 'calendar', dot: needsMaterial, go: () => nav.go('planner', { subjectId: id, subjectName: name }) },
          isLang && { k: 'sx', label: 'ניתוח משפט', sub: 'תפקידי המילים', icon: 'blocks', go: () => nav.go('syntax', { subjectId: id, subjectName: name, mode: 'syntax' }) },
          { k: 'ck', label: 'בדוק תרגיל', sub: 'צילום של פתרון', icon: 'camera', go: () => nav.go('check', { subjectId: id, subjectName: name }) },
        ].filter(Boolean)
        const explainTile = { k: 'ex', label: 'תסביר לי', sub: 'שאלו כל שאלה', icon: 'chat', go: openExplain }
        // מספר אי-זוגי → "תסביר לי" בסוף ברוחב מלא; זוגי → בתוך הרשת
        const tools = [...list, explainTile]
        const odd = tools.length % 2 === 1
        const Tile = ({ t, full }) => (
          <button type="button" className="tool" style={full ? { gridColumn: '1 / -1' } : undefined} onClick={t.go}>
            <Icon name={t.icon} size={22} />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="leading-tight">{t.label}</span>
              <span className="text-[12px] font-medium text-muted leading-tight">{t.sub}</span>
            </span>
            {t.count > 0 && <span className="tool-badge tnum">{t.count}</span>}
            {t.dot && <span className="tool-dot" aria-hidden="true" />}
          </button>
        )
        return (
          <>
            <div className="tools-grid">
              {tools.map((t, i) => <Tile key={t.k} t={t} full={odd && i === tools.length - 1} />)}
            </div>
          </>
        )
      })()}

      {/* אזהרה: מבחן קרוב בלי חומר מוגדר */}
      {passed && !hasExam && (
        <button onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}
          className="w-full text-start rounded-[16px] p-3.5 mt-3 flex items-start gap-2.5 text-[13.5px] leading-relaxed"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Icon name="upload" size={19} />
          <span><b>ה{passed.kind} עבר 🎉</b> העלו את החומר החדש שלומדים עכשיו. עד שתגדירו מיקוד למבדק הבא — המבדק יהיה על כל החומר.</span>
        </button>
      )}

      {needsMaterial && (
        <button onClick={() => nav.go('planner', { subjectId: id, subjectName: name })}
          className="w-full text-start rounded-[16px] p-3.5 mt-3 flex items-start gap-2.5 text-[13.5px] leading-relaxed"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Icon name="upload" size={19} />
          <span><b>עדיין לא הוגדר חומר ל{examKind}.</b> העלו את החומר וסמנו את המיקוד במתכנן המבחן, כדי שהתוכנית והתרגול יתמקדו בו</span>
        </button>
      )}

      {/* נושאים */}
      <div className="home-h2 mt-5 mb-2.5">
        <h2>הנושאים שלי</h2>
        <span>{topics.length} נושאים</span>
      </div>
      <div className="flex flex-col gap-2">
        {topics.length === 0 ? (
          <div className="milky-row text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שהמערכת תזהה נושאים.</div>
        ) : topics.map((t) => (
          <div key={t.id} className="milky-row topic-row">
            <button type="button" className="topic-main"
              onClick={() => nav.go('topicSummary', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name })}>
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-[15.5px]">{t.name}</span>
                {t.in_exam && <span className="tp-badge" style={{ background: 'var(--primary)' }}>במיקוד</span>}
                {t.m.due && <span className="tp-badge" style={{ background: '#B7A5FF' }}>לרענון</span>}
              </span>
              {t.m.pct == null ? (
                <span className="text-[12.5px] text-muted">עוד לא תורגל{t.m.n ? ` · ${t.m.n} מתוך 5 תשובות` : ''}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.14)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${t.m.pct}%`, background: LEVEL_COLOR[level(t.m.pct)] }} />
                  </span>
                  <span className="text-[12px] font-bold" style={{ color: LEVEL_COLOR[level(t.m.pct)] }}>{LEVEL_LABEL[level(t.m.pct)]}</span>
                  <span className="font-disp font-bold text-[13px] tnum" dir="ltr">{t.m.pct}%</span>
                </span>
              )}
            </button>
            <button type="button" className="topic-go" aria-label={`לתרגל את ${t.name}`}
              onClick={() => nav.go('practice', { subjectId: id, subjectName: name, topicId: t.id, topicName: t.name, mode: 'practice' })}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
              <span>תרגול</span>
            </button>
          </div>
        ))}
      </div>

      {/* העלאת חומר + החומרים (מסך נפרד) */}
      <button type="button" className="ts-practice mt-6 !mb-2" onClick={() => nav.go('upload', { subjectId: id, subjectName: name })}>
        <Icon name="upload" size={19} /><span>{g('העלה חומר חדש', 'העלי חומר חדש')}</span>
      </button>
      <button type="button" className="milky-row" onClick={() => nav.go('materials', { subjectId: id, subjectName: name })}>
        <Icon name="archive" />
        <span className="flex-1 text-start font-bold text-[15px]">החומרים שהעליתי ({materials.length})</span>
        <Icon name="chevron" size={18} />
      </button>
      </>)}
    </div>
  )
}

// קונפטי צבעוני ל"הכול חזק!" — בסגנון האפליקציה (לא אימוג'י של המערכת)
function ConfettiIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 28 L11 10 L22 21 Z" fill="#131316" />
      <path d="M7.2 20 L9.6 14 M9.8 25.4 L14.6 16.6" stroke="#FFC400" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 8 q2 -3 0 -5" stroke="#7B5CFF" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M24 17 q3 -2 5 0" stroke="#FF4FA0" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M19 12 l6 -6" stroke="#FF7A3D" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="22" cy="4" r="1.8" fill="#FF4FA0" />
      <circle cx="28" cy="10" r="1.8" fill="#7B5CFF" />
      <rect x="26.5" y="22.5" width="3.4" height="3.4" rx=".8" fill="#FFC400" transform="rotate(20 28 24)" />
      <rect x="9" y="3" width="3.2" height="3.2" rx=".8" fill="#FF7A3D" transform="rotate(-25 10.5 4.5)" />
      <circle cx="30" cy="16" r="1.3" fill="#FF7A3D" />
    </svg>
  )
}
