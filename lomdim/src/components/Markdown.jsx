// ── רכיב Markdown קטן ומדויק ──
// הופך את הסיכום של Gemini (כותרות, נקודות, **הדגשות**) לטקסט מעוצב,
// במקום להציג את סימני ה-# וה-** כמו שהם.

function Inline({ text }) {
  // מפצל **הדגשה** ל-<strong>, שאר הטקסט רגיל
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

export default function Markdown({ text, className = '' }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let list = null // { ordered, items: [] }

  const flush = () => { if (list) { blocks.push(list); list = null } }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); blocks.push({ type: 'h', level: h[1].length, text: h[2] }); continue }

    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flush(); list = { type: 'list', ordered, items: [] } }
      list.items.push((ul ? ul[1] : ol[1]))
      continue
    }

    flush()
    blocks.push({ type: 'p', text: line })
  }
  flush()

  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const size = b.level === 1 ? 'text-[16px]' : b.level === 2 ? 'text-[15px]' : 'text-[14px]'
          return <div key={i} className={`font-disp font-bold ${size} mt-4 first:mt-0 mb-1`}><Inline text={b.text} /></div>
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul'
          return (
            <Tag key={i} className={`my-1.5 pe-5 space-y-[5px] ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
              {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </Tag>
          )
        }
        return <p key={i} className="my-1.5"><Inline text={b.text} /></p>
      })}
    </div>
  )
}
