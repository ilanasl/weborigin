import { supabase } from './supabase'
import { classifyTopic } from './gemini'

// תרגילים שנבדקו ("בדוק תרגיל") נכנסים לנושא האמיתי שלהם — לא ליחידה נפרדת
export const LEGACY_CHECK_TOPIC = 'תרגילים שבדקתי'

// בוחר נושא קיים שהטקסט שייך אליו (null אם אין נושאים)
export async function pickTopicId({ subjectId, subjectName, text, topics }) {
  const list = (topics || []).filter((t) => t.name !== LEGACY_CHECK_TOPIC)
  if (!list.length) return null
  if (list.length === 1) return list[0].id
  try {
    const { topic } = await classifyTopic({ subjectName, text, knownTopics: list.map((t) => t.name) })
    const hit = list.find((t) => t.name === topic) || list.find((t) => topic && (t.name.includes(topic) || topic.includes(t.name)))
    return (hit || list[0]).id
  } catch { return list[0].id }
}

// חד-פעמי: מפזר את השאלות מהנושא הישן "תרגילים שבדקתי" לנושאים המתאימים ומוחק אותו.
// מחזיר true אם משהו הועבר (כדי לרענן את המסך).
export async function foldLegacyCheckTopic(subjectId, subjectName) {
  try {
    const { data: topics } = await supabase.from('topics').select('id, name').eq('subject_id', subjectId)
    const legacy = (topics || []).find((t) => t.name === LEGACY_CHECK_TOPIC)
    const real = (topics || []).filter((t) => t.name !== LEGACY_CHECK_TOPIC)
    if (!legacy || !real.length) return false
    const { data: qs } = await supabase.from('questions').select('id, q, explain').eq('topic_id', legacy.id)
    for (const q of qs || []) {
      const tid = await pickTopicId({ subjectId, subjectName, text: `${q.q}\n${q.explain || ''}`, topics: real })
      if (!tid) continue
      await supabase.from('questions').update({ topic_id: tid }).eq('id', q.id)
      await supabase.from('attempts').update({ topic_id: tid }).eq('question_id', q.id)
    }
    // מחיקה רק אם לא נשארו שאלות בנושא הישן
    const { count } = await supabase.from('questions').select('id', { count: 'exact', head: true }).eq('topic_id', legacy.id)
    if (!count) {
      await supabase.from('attempts').update({ topic_id: real[0].id }).eq('topic_id', legacy.id)
      await supabase.from('topics').delete().eq('id', legacy.id)
    }
    return true
  } catch { return false }
}
