// איחוד הסיכום של נושא מכל הדפים שהועלו אליו — סיכום אחד מסודר, בלי חזרות.
// רץ אוטומטית כשמעלים דף חדש לנושא שכבר יש בו דפים, כשנכנסים לנושא עם כמה דפים, ומ"בנייה מחדש".
import { supabase } from './supabase'
import { topicSummary, stripNotebookWarnings, generateQuestions } from './gemini'

const PAGE_KINDS_SKIP = ['summary', 'note', 'style', 'check']

// נושא שיש בו 2 דפים (עם סיכום) או יותר — ואין לו עדיין סיכום מאוחד → כדאי לאחד
export const needsConsolidation = (mats = []) =>
  !mats.some((m) => m.kind === 'summary' && m.summary_md) &&
  mats.filter((m) => !PAGE_KINDS_SKIP.includes(m.kind) && m.summary_md).length >= 2
// איחוד אוטומטי — פעם אחת לנושא בכל הפעלה של האפליקציה (גם אם נכשל — לא חוזרים בלולאה)
export const autoTried = new Set()

// ── חומר מתחום אחר שנמצא בדפים של הנושא (למשל "תעודת זהות של טקסט" בתוך דקדוק) ──
// נשמר כהערה נסתרת בסוף הסיכום המאוחד: <!--OFF:{name,md}--> = ממתין להחלטה · <!--OFFDONE:name--> = טופל (לא להציע שוב)
const OFF_LINE = /^<!--OFF(DONE)?:(.*)-->\s*$/
const enc = (o) => JSON.stringify(o).replace(/--/g, '\\u002d\\u002d')
export function readOff(md) {
  const pending = [], done = []
  for (const line of String(md || '').split('\n')) {
    const m = line.match(OFF_LINE)
    if (!m) continue
    try {
      if (m[1]) done.push(JSON.parse(m[2]))
      else { const o = JSON.parse(m[2]); if (o?.name) pending.push(o) }
    } catch { /* הערה פגומה — מדלגים */ }
  }
  return { pending, done }
}
const stripOff = (md) => String(md || '').split('\n').filter((l) => !OFF_LINE.test(l)).join('\n').trimEnd()
const withOff = (md, pending, done) => [stripOff(md), ...pending.map((o) => `<!--OFF:${enc(o)}-->`), ...done.map((n) => `<!--OFFDONE:${enc(n)}-->`)].join('\n')

export async function consolidateTopic({ subjectId, subjectName, topicId, topicName, learner, enrich = false }) {
  const [{ data: mats }, { data: tps }] = await Promise.all([
    supabase.from('materials').select('kind, summary_md, source_text, created_at').eq('topic_id', topicId).order('created_at'),
    supabase.from('topics').select('id, name').eq('subject_id', subjectId),
  ])
  const pages = (mats || []).filter((m) => !PAGE_KINDS_SKIP.includes(m.kind) && (m.summary_md || m.source_text))
  const source = pages.map((m) => [stripNotebookWarnings(m.summary_md), m.source_text].filter(Boolean).join('\n'))
    .filter(Boolean).join('\n\n---\n\n')
  if (!source.trim()) return false
  const prev = readOff((mats || []).find((m) => m.kind === 'summary')?.summary_md)
  const handled = [...prev.done, ...prev.pending.map((o) => o.name)]
  const otherTopics = (tps || []).filter((t) => t.id !== topicId).map((t) => t.name)
  const { summary_md, offtopic = [] } = await topicSummary({ subjectName, topicName, learner, sourceMaterials: source, enrich, otherTopics, handledOff: handled })
  if (!summary_md) return false
  // הצעות קודמות שעוד ממתינות נשמרות; חדשות — רק אם לא טופלו כבר ולא שם של נושא קיים במקצוע
  const known = new Set([...handled, ...otherTopics].map((n) => n.trim()))
  const pending = [...prev.pending, ...offtopic.filter((o) => !known.has(o.name.trim()))]
  await supabase.from('materials').delete().eq('topic_id', topicId).eq('kind', 'summary')
  await supabase.from('materials').insert({ subject_id: subjectId, topic_id: topicId, title: 'סיכום עיוני', kind: 'summary', summary_md: withOff(summary_md, pending, prev.done) })
  return true
}

// סימון חומר מתחום אחר כ"טופל" (הועבר לנושא משלו, או שהחליטו להשאיר בחוץ)
export async function markOffDone(topicId, name) {
  const { data } = await supabase.from('materials').select('id, summary_md').eq('topic_id', topicId).eq('kind', 'summary').limit(1)
  const row = data?.[0]
  if (!row) return
  const { pending, done } = readOff(row.summary_md)
  await supabase.from('materials').update({ summary_md: withOff(row.summary_md, pending.filter((o) => o.name !== name), [...new Set([...done, name])]) }).eq('id', row.id)
}

// העברת החומר לנושא משלו: נושא חדש (או קיים באותו שם) + דף עם הסיכום + שאלות תרגול
export async function moveOffTopic({ subjectId, subjectName, fromTopicId, item, learner }) {
  const name = String(item.name).trim()
  const { data: tps } = await supabase.from('topics').select('id, name, in_exam').eq('subject_id', subjectId)
  let tid = (tps || []).find((t) => t.name.trim() === name)?.id
  if (!tid) {
    const from = (tps || []).find((t) => t.id === fromTopicId)
    const { data: ins, error } = await supabase.from('topics').insert({ subject_id: subjectId, name, origin: 'השנה', in_exam: !!from?.in_exam }).select('id').single()
    if (error || !ins) throw new Error('topic')
    tid = ins.id
  }
  const { data: mat } = await supabase.from('materials').insert({ subject_id: subjectId, topic_id: tid, title: name, kind: 'text', summary_md: item.md }).select('id').single()
  try {
    const { questions = [] } = await generateQuestions({ subjectName, topic: name, sourceText: item.md, count: 6, learner })
    if (questions.length) {
      await supabase.from('questions').insert(questions.map((q) => ({
        subject_id: subjectId, topic_id: tid, material_id: mat?.id,
        q: q.q, choices: q.choices, answer: q.answer,
        difficulty: q.difficulty || 'בינוני', explain: q.explain || '', hint: q.hint || '',
      })))
    }
  } catch { /* הנושא והסיכום כבר נשמרו */ }
  await markOffDone(fromTopicId, item.name)
  return { id: tid, name }
}
