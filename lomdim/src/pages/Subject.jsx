import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mastery } from '../lib/mastery'
import Markdown from '../components/Markdown'

export default function Subject({ nav, params }) {
  const { id } = params
  const [subject, setSubject] = useState(null)
  const [topics, setTopics] = useState([])
  const [materials, setMaterials] = useState([])
  const [qCount, setQCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: tp }, { data: mt }, { data: at }, { count }] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', id).single(),
      supabase.from('topics').select('*').eq('subject_id', id).order('created_at'),
      supabase.from('materials').select('*').eq('subject_id', id).order('created_at', { ascending: false }),
      supabase.from('attempts').select('topic_id, correct, difficulty, created_at').eq('subject_id', id),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
    ])
    const byTopic = {}
    for (const a of at || []) {
      if (!a.topic_id) continue
      ;(byTopic[a.topic_id] ||= []).push({
        correct: a.correct, difficulty: a.difficulty, ts: new Date(a.created_at).getTime(),
      })
    }
    setSubject(s)
    setTopics((tp || []).map((t) => ({ ...t, m: mastery(byTopic[t.id] || []) })))
    setMaterials(mt || [])
    setQCount(count || 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  if (loading || !subject) return <div className="text-muted pt-4">טוען…</div>

  const summary = materials.find((m) => m.summary_md)

  return (
    <div>
      <div className="flex items-center gap-3 my-2 mb-4">
        <div className="w-[52px] h-[52px] rounded-[14px] grid place-items-center font-disp font-extrabold text-[26px]"
          style={{ background: subject.bg, color: subject.color }}>{subject.name.charAt(0)}</div>
        <h1 className="text-[23px] font-black">{subject.name}</h1>
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-4">
        <button className="btn btn-primary" disabled={qCount === 0}
          onClick={() => nav.go('practice', { subjectId: id })}>תרגול</button>
        <button className="btn" onClick={() => nav.go('upload', { subjectId: id, subjectName: subject.name })}>
          העלה חומר
        </button>
      </div>

      <div className="text-[14px] font-bold text-muted mt-5 mb-[10px]">הנושאים שלי</div>
      <div className="card">
        {topics.length === 0 ? (
          <div className="text-muted text-sm">עדיין אין נושאים — העלו חומר כדי שהמערכת תזהה נושאים.</div>
        ) : topics.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-3 border-b border-line last:border-0">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[15px]">{t.name}</div>
              {t.m.pct == null ? (
                <div className="text-[12.5px] italic text-muted mt-1">אוספים נתונים…</div>
              ) : (
                <div className="flex items-center gap-2 mt-[6px] max-w-[220px]">
                  <div className="bar flex-1"><i style={{ width: `${t.m.pct}%` }} /></div>
                  <span className="text-[12.5px] font-bold text-muted tnum">{t.m.pct}%</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {summary && (
        <>
          <div className="text-[14px] font-bold text-muted mt-5 mb-[10px]">הסיכום שלי</div>
          <div className="card text-[15px] md:text-[16.5px]"><Markdown text={summary.summary_md} /></div>
        </>
      )}

      <div className="text-[14px] font-bold text-muted mt-5 mb-[10px]">החומרים שהעליתי</div>
      <div className="card">
        {materials.length === 0 ? (
          <div className="text-muted text-sm">עדיין לא הועלה חומר.</div>
        ) : materials.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-2 border-b border-line last:border-0">
            <div className="text-[14.5px]">{m.title || 'חומר'}</div>
            <div className="text-[12px] text-muted">{new Date(m.created_at).toLocaleDateString('he-IL')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
