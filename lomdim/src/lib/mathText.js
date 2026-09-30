// ── סימון מתמטי (LaTeX) שדולף מה-AI → סימנים רגילים שקריאים לתלמיד ──
// למשל: 5 \cdot 5 → 5 · 5 ,  4^2 → 4² ,  \frac{9}{4} → 9/4
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', m: 'ᵐ', k: 'ᵏ', '·': '·', ' ': '' }
const sup = (s) => ([...s].every((c) => c in SUP) ? [...s].map((c) => SUP[c]).join('') : `^(${s})`)

export function mathText(s) {
  if (typeof s !== 'string' || !/[\\^]/.test(s)) return s
  return s
    .replace(/\\(?:cdot|times)\b/g, '·')
    .replace(/\\div\b/g, ':')
    .replace(/\\(?:le|leq)\b/g, '≤').replace(/\\(?:ge|geq)\b/g, '≥').replace(/\\(?:ne|neq)\b/g, '≠')
    .replace(/\\pm\b/g, '±').replace(/\\approx\b/g, '≈')
    .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1')
    .replace(/\^\{([^{}]{1,12})\}/g, (_, e) => sup(e))
    .replace(/\^(\d+|[nxyabmk])/g, (_, e) => sup(e))
    .replace(/\\([{}])/g, '$1')
    .replace(/\\ /g, ' ')
}
