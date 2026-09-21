// ── רכיב Markdown קטן ומדויק ──
// הופך את הסיכום של Gemini (כותרות, נקודות, **הדגשות**, טבלאות) לטקסט מעוצב.

function Inline({ text }) {
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

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isTableSep = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')

export default function Markdown({ text, className = '' }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let list = null
  const flush = () => { if (list) { blocks.push(list); list = null } }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()

    // טבלה: שורת כותרת עם | ואחריה שורת מפריד ---
    if (/\|/.test(line) && lines[i + 1] != null && isTableSep(lines[i + 1])) {
      flush()
      const header = splitRow(line)
      const rows = []
      let j = i + 2
      while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) {
        rows.push(splitRow(lines[j])); j++
      }
      blocks.push({ type: 'table', header, rows })
      i = j - 1
      continue
    }

    if (!line.trim()) { flush(); continue }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); blocks.push({ type: 'h', level: h[1].length, text: h[2] }); continue }

    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flush(); list = { type: 'list', ordered, items: [] } }
      list.items.push(ul ? ul[1] : ol[1])
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
            <Tag key={i} className={`my-1.5 ps-5 space-y-[5px] ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
              {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </Tag>
          )
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="my-3">
              <table className="w-full text-[13px] border-collapse" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    {b.header.map((c, j) => (
                      <th key={j} className="border border-line bg-surface2 p-2 text-start font-bold break-words"><Inline text={c} /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border border-line p-2 align-top break-words"><Inline text={c} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <p key={i} className="my-1.5"><Inline text={b.text} /></p>
      })}
    </div>
  )
}
