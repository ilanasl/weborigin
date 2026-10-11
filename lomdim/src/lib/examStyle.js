// סגנון שאלות המבחן של המורה — נלמד מצילומי מבחנים מתוקנים ("מבחנים שעברו").
// נשמר כשורת חומר מסוג 'style' בלי נושא ובלי קובץ — לא מופיע ברשימת החומרים ולא בתרגול.
import { supabase } from './supabase'

export async function subjectStyle(subjectId) {
  try {
    const { data } = await supabase.from('materials').select('summary_md')
      .eq('subject_id', subjectId).eq('kind', 'style').order('created_at', { ascending: false }).limit(4)
    return (data || []).map((m) => m.summary_md).filter(Boolean).join('\n\n').slice(0, 3000)
  } catch { return '' }
}
