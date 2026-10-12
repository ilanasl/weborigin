// איחוד הסיכום של נושא מכל הדפים שהועלו אליו — סיכום אחד מסודר, בלי חזרות.
// רץ אוטומטית כשמעלים דף חדש לנושא שכבר יש בו דפים (וגם מהכפתור במסך הנושא).
import { supabase } from './supabase'
import { topicSummary, stripNotebookWarnings } from './gemini'

const PAGE_KINDS_SKIP = ['summary', 'note', 'style', 'check']

export async function consolidateTopic({ subjectId, subjectName, topicId, topicName, learner }) {
  const { data: mats } = await supabase.from('materials').select('kind, summary_md, source_text, created_at')
    .eq('topic_id', topicId).order('created_at')
  const pages = (mats || []).filter((m) => !PAGE_KINDS_SKIP.includes(m.kind) && (m.summary_md || m.source_text))
  const source = pages.map((m) => [stripNotebookWarnings(m.summary_md), m.source_text].filter(Boolean).join('\n'))
    .filter(Boolean).join('\n\n---\n\n')
  if (!source.trim()) return false
  const { summary_md } = await topicSummary({ subjectName, topicName, learner, sourceMaterials: source })
  if (!summary_md) return false
  await supabase.from('materials').delete().eq('topic_id', topicId).eq('kind', 'summary')
  await supabase.from('materials').insert({ subject_id: subjectId, topic_id: topicId, title: 'סיכום עיוני', kind: 'summary', summary_md })
  return true
}
