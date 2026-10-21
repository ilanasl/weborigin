// תרגילי מתמטיקה שנבנים בקוד (בלי AI): התשובה תמיד נכונה והשרטוט מדויק.
// כל תרגיל: { type, tag, title, math|figure (HTML), ask, fields, steps: [[הסבר, ביטוי, סופי?]], kind? }
// kind: 'tf' — נכון/לא נכון, 'pick' — בחירת שורה; בלי kind — שדות מספר.
// mc: { q, right, wrongs } — אותו תרגיל כשאלה אמריקאית, ל"לחיזוק" אחרי טעות (toQuestion).

const R = (a,b) => a + Math.floor(Math.random()*(b-a+1))
const pick = arr => arr[Math.floor(Math.random()*arr.length)]
const M = n => n < 0 ? '−' + Math.abs(n) : String(n);           // number with real minus
const sgn = n => n < 0 ? ' − ' + Math.abs(n) : ' + ' + n;        // signed term "+ 5" / "− 5"
const sq = (v='x') => v + '<sup>2</sup>'
// coefficient·var as written in the notebook: 1x→x, -1x→−x
const cx = (c, v='x') => c === 1 ? v : c === -1 ? '−' + v : M(c) + v
const scx = (c, v='x') => c < 0 ? ' − ' + (c === -1 ? v : Math.abs(c) + v) : ' + ' + (c === 1 ? v : c + v)
const lin = (a,b,v='x') => a === 0 ? M(b) : cx(a,v) + (b ? sgn(b) : '');   // ax+b
const quad = (a,b,c,v='x') => {                                             // ax²+bx+c
  let s = a === 1 ? sq(v) : a === -1 ? '−' + sq(v) : M(a) + sq(v)
  if (b) s += scx(b,v); if (c) s += sgn(c); return s
}
const par = n => n < 0 ? '(' + M(n) + ')' : String(n)
// 3 מסיחים מספריים שונים מהתשובה — קודם הטעויות הצפויות (prefer), אחר כך סמוכים
const others = (ans, prefer = [], min = -Infinity) => {
  const out = []
  for (const n of [...prefer, ans + 1, ans - 1, -ans, ans + 2, ans * 2, ans - 2, ans + 3]) {
    if (n !== ans && n >= min && Number.isInteger(n) && !out.includes(n)) out.push(n)
    if (out.length === 3) break
  }
  return out
}

/* ---------- 1. angles in a triangle ---------- */
// שלושה סוגים: משולש רגיל, משולש ישר זווית (ריבוע בפינה), ומשולש שחוצים בקו מקודקוד (שני נעלמים)
function genTri(lv){
  const r = Math.random()
  if (lv >= 2 && r < (lv === 2 ? 0.3 : 0.35)) return genSplit(lv)
  if (r > (lv === 1 ? 0.6 : 0.7)) return genRight(lv)
  for(;;){
    const x = R(8,40)
    let terms
    if(lv === 1){ const a = R(35,85), b = R(30,80), c = 180-a-b; if(c<20) continue
      terms = [{c:0,k:a},{c:0,k:b},{c:1,k:0}]; // third angle is x
      return finishTri(terms, c, 'x'); }
    if(lv === 2){ const k = [R(1,3),R(1,4),R(1,5)]; const s = k[0]+k[1]+k[2]
      if(180 % s) continue; const v = 180/s; if(k.some(q=>q*v<15||q*v>140)) continue
      return finishTri(k.map(q=>({c:q,k:0})), v, 'x'); }
    const a = R(1,2), b = R(1,3), c = 1, k2 = pick([0,10,20,-10])
    const k3 = 180 - (a+b+c)*x - k2
    if(k3 < -30 || k3 > 70 || k3 === 0) continue
    const t = [{c:a,k:0},{c:b,k:k2},{c:c,k:k3}]
    if(t.some(q=>q.c*x+q.k<15||q.c*x+q.k>140)) continue
    return finishTri(t, x, 'x')
  }
}
// ישר זווית: הזווית הישרה מסומנת בריבוע (בלי מספר) — כמו בלוח בכיתה
function genRight(lv){
  if (lv === 1) { const a = R(20,70); return finishTri([{c:0,k:90,right:true},{c:0,k:a},{c:1,k:0}], 90-a, 'x') }
  if (Math.random() < 0.5) { const c = pick([2,4,5,8]); return finishTri([{c:0,k:90,right:true},{c:c,k:0},{c:1,k:0}], 90/(c+1), 'x') }
  const x = R(15,38); return finishTri([{c:0,k:90,right:true},{c:1,k:0},{c:1,k:90-2*x}], x, 'x')
}
function finishTri(terms, x, v){
  const label = t => t.c === 0 ? t.k + '°' : lin(t.c, t.k) + '°'
  const vals = terms.map(t => t.c*x + t.k)
  const sumC = terms.reduce((s,t)=>s+t.c,0), sumK = terms.reduce((s,t)=>s+t.k,0)
  const steps = [
    ...(terms[0].right ? [['הריבוע בפינה מסמן זווית ישרה', '90°']] : []),
    ['סכום הזוויות במשולש הוא 180°', terms.map(t=>t.c===0 ? t.k : t.k ? '(' + lin(t.c,t.k) + ')' : cx(t.c)).join(' + ') + ' = 180'],
    ['מחברים את ה-x לחוד ואת המספרים לחוד', lin(sumC,sumK) + ' = 180'],
  ]
  if(sumK) steps.push([sumK>0?'מעבירים את '+sumK+' לצד השני (מחסרים)':'מעבירים את '+M(sumK)+' לצד השני (מוסיפים)', cx(sumC) + ' = ' + (180-sumK)])
  if(sumC !== 1) steps.push(['מחלקים ב-' + sumC, 'x = ' + (180-sumK) + ' : ' + sumC])
  steps.push(['התשובה', 'x = ' + x, true])
  if(terms.some(t=>t.c!==0 && !(t.c===1&&t.k===0))) steps.push(['בדיקה: מציבים x = '+x, vals.join(' + ') + ' = 180 ✓'])
  const mc = { q: `${terms[0].right ? 'במשולש ישר זווית' : 'במשולש'} הזוויות הן ${terms.map(t => iso(label(t))).join(', ')}. מצאו את x.`,
    right: 'x = ' + x, wrongs: others(x, [180 - sumK, x + 10, x - 10], 1).map(n => 'x = ' + n) }
  return { type:'tri', tag:'גאומטרייה', title: terms[0].right ? 'משולש ישר זווית' : 'זוויות במשולש', math:null,
    figure: triSVG(vals, terms.map(t => (t.right ? '' : label(t))), terms[0].right), ask:'מצאו את x.', fields:[{pre:'x =', ans:x}], steps, mc }
}

// משולש ACD, הנקודה B על CD, והקטע AB מחלק את זווית A. מוצאים x = ∠ABD (משולש קטן) ו-y = ∠C (משולש גדול)
function genSplit(lv){
  for(;;){
    let a1, a2
    if (lv === 2) { a1 = pick([30,40,45,50,60]); a2 = 90 - a1 }
    else { a1 = 5 * R(5,12); a2 = 5 * R(5,12) }
    const A = a1 + a2, d = R(20,60), y = 180 - A - d, x = 180 - a2 - d
    if (y < 20 || x < 25 || x > 150) continue
    const steps = [
      ['במשולש הקטן ABD: סכום הזוויות 180°', `${a2} + ${d} + x = 180`],
      ['', `${a2 + d} + x = 180`],
      ['', `x = 180 − ${a2 + d}`],
      ['', `x = ${x}`, true],
      ['במשולש הגדול ACD: זווית A שלמה', `${a1} + ${a2} = ${A}`],
      ['סכום הזוויות 180°', `y + ${A} + ${d} = 180`],
      ['', `y = 180 − ${A + d}`],
      ['', `y = ${y}`, true],
    ]
    const right = `x = ${x}, y = ${y}`
    const wrongs = [...new Set([`x = ${180 - x}, y = ${y}`, `x = ${x}, y = ${y + 10}`, `x = ${180 - a1 - d}, y = ${y}`, `x = ${x - 10}, y = ${y}`])]
      .filter((w) => w !== right).slice(0, 3)
    return { type:'tri', tag:'גאומטרייה', title:'משולש שחוצים בקו', math:null,
      figure: splitSVG(a1, a2, d), ask:'הקטע AB מחלק את המשולש. מצאו את x ואת y.',
      fields:[{pre:'x =', ans:x},{pre:'y =', ans:y}], steps,
      mc: { q: `במשולש ACD הנקודה B נמצאת על הצלע CD, והקטע AB מחלק את זווית A: ${iso('∠CAB = ' + a1 + '°')}, ${iso('∠BAD = ' + a2 + '°')}. זווית D היא ${iso(d + '°')}. מצאו את x (${iso('∠ABD')}) ואת y (${iso('∠C')}).`, right, wrongs } }
  }
}

// גאומטריה משותפת לשרטוטים: נקודות במתמטיקה (y למעלה) → קואורדינטות SVG, ותווית על חוצה הזווית
function fitPts(pts){
  const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), h = Math.max(...ys)
  const W = 340, pad = 28, sc = Math.min((W-2*pad)/(maxX-minX), 190/h)
  const H = h*sc + 2*pad
  return { W, H, P: pts.map(([x,y]) => [pad + (x-minX)*sc + ((W-2*pad)-(maxX-minX)*sc)/2, H - pad - y*sc]) }
}
const unit = (a, b) => { const dx = b[0]-a[0], dy = b[1]-a[1], d = Math.hypot(dx,dy) || 1; return [dx/d, dy/d] }
function angleLabel(p, q, r, rad, text){
  const u = unit(p,q), v = unit(p,r), bx = u[0]+v[0], by = u[1]+v[1], d = Math.hypot(bx,by) || 1
  return `<text x="${p[0] + bx/d*rad}" y="${p[1] + by/d*rad}" text-anchor="middle" dominant-baseline="middle" fill="var(--ink)" font-family="Rubik, system-ui, sans-serif" font-size="15" font-weight="600" direction="ltr">${text}</text>`
}
const vName = (p, away, text) => {
  const u = unit(away, p)
  return `<text x="${p[0] + u[0]*15}" y="${p[1] + u[1]*15}" text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-family="Rubik, system-ui, sans-serif" font-size="13">${text}</text>`
}

function triSVG(ang, labels, right){
  const [A,B] = ang.map(a => a*Math.PI/180), L = 300
  // base from P0 (left) to P1 (right); apex where the two sides meet
  const t = L * Math.sin(B) / Math.sin(A+B)
  const { W, H, P } = fitPts([[0,0], [L,0], [t*Math.cos(A), t*Math.sin(A)]])
  const cen = [(P[0][0]+P[1][0]+P[2][0])/3, (P[0][1]+P[1][1]+P[2][1])/3]
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="משולש עם זוויות ${labels.filter(Boolean).join(', ')}">`
  s += `<polygon points="${P.map(p=>p.join(',')).join(' ')}" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>`
  if (right) {
    // ריבוע של זווית ישרה בקודקוד הראשון
    const u = unit(P[0], P[1]), v = unit(P[0], P[2]), q = 16
    s += `<polyline points="${P[0][0]+u[0]*q},${P[0][1]+u[1]*q} ${P[0][0]+(u[0]+v[0])*q},${P[0][1]+(u[1]+v[1])*q} ${P[0][0]+v[0]*q},${P[0][1]+v[1]*q}" fill="none" stroke="var(--primary)" stroke-width="2"/>`
  }
  P.forEach((p,i) => {
    if (labels[i]) {
      const d = Math.hypot(cen[0]-p[0], cen[1]-p[1])
      s += angleLabel(p, P[(i+1)%3], P[(i+2)%3], Math.min(46, d*.55), labels[i].replace(/<[^>]+>/g,''))
    }
    s += vName(p, cen, ['A','B','C'][i])
  })
  return s + '</svg>'
}

function splitSVG(a1, a2, d){
  const rad = (g) => g*Math.PI/180, A = rad(a1 + a2), D = rad(d), L = 300
  const t = L * Math.sin(D) / Math.sin(A + D)
  const pA = [0,0], pD = [L,0], pC = [t*Math.cos(A), t*Math.sin(A)]
  // B = החיתוך של הקרן מ-A בזווית a2 עם הצלע CD
  const dir = [Math.cos(rad(a2)), Math.sin(rad(a2))], cr = (u, v) => u[0]*v[1] - u[1]*v[0]
  const CD = [pC[0]-pD[0], pC[1]-pD[1]], k = -cr(dir, pD) / cr(dir, CD)
  const pB = [pD[0] + k*CD[0], pD[1] + k*CD[1]]
  const { W, H, P } = fitPts([pA, pD, pC, pB])
  const [sA, sD, sC, sB] = P
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="משולש ACD שחוצים בקטע AB">`
  s += `<polygon points="${[sA,sD,sC].map(p=>p.join(',')).join(' ')}" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>`
  s += `<line x1="${sA[0]}" y1="${sA[1]}" x2="${sB[0]}" y2="${sB[1]}" stroke="var(--primary)" stroke-width="2"/>`
  s += angleLabel(sA, sD, sB, 44, a2 + '°') + angleLabel(sA, sB, sC, 44, a1 + '°')
  s += angleLabel(sD, sA, sC, 38, d + '°') + angleLabel(sC, sA, sD, 30, 'y') + angleLabel(sB, sA, sD, 26, 'x')
  s += vName(sA, sB, 'A') + vName(sD, sA, 'D') + vName(sC, sA, 'C') + vName(sB, sA, 'B')
  return s + '</svg>'
}

/* ---------- 2. expanding brackets ---------- */
function genExpand(lv){
  let a=1, c=1, b, d, tail = 0
  const v = lv === 1 ? 'x' : pick(['x','x','a','b','y'])
  do {
    a = 1; c = 1; tail = 0
    if(lv === 1){ b = R(1,9); d = R(1,9); }
    else if(lv === 2){ b = R(1,9); d = -R(1,9); }
    else if(Math.random() < .35){ b = R(1,7); d = -R(1,7); tail = pick([-1,1])*R(1,6); }  // like (x+2)(x−6)+3x
    else { a = R(1,3); c = R(2,4); b = pick([-1,1])*R(1,7); d = pick([-1,1])*R(1,7); }
  } while(a*d + b*c === 0 || a*d + b*c + tail === 0)
  const A = a*c, B = a*d + b*c + tail, C = b*d
  const tl = tail ? scx(tail,v) : ''
  const steps = [
    ['כל איבר בסוגריים הראשונים כפול כל איבר בשניים',
      `${cx(a,v)}·${cx(c,v)} ${d<0?'−':'+'} ${cx(a,v)}·${Math.abs(d)} ${b<0?'−':'+'} ${Math.abs(b)}·${cx(c,v)} ${(b<0)!==(d<0)?'−':'+'} ${Math.abs(b)}·${Math.abs(d)}${tl}`],
    [`מכפילים: ${v}·${v} = ${v}²`, `${quad(A,0,0,v)}${scx(a*d,v)}${scx(b*c,v)}${sgn(C)}${tl}`],
    ['מכנסים איברים דומים', quad(A,B,C,v), true],
  ]
  const right = quad(A,B,C,v), wrongs = []
  for (const [x2, x1, x0] of [[A,-B,C],[A,B,-C],[A,-B,-C],[A,a*d-b*c+tail,C],[A,B,C+b+d],[A,B+2,C]]) {
    const w = quad(x2,x1,x0,v)
    if (x1 && w !== right && !wrongs.includes(w) && wrongs.length < 3) wrongs.push(w)
  }
  const math = `(${lin(a,b,v)})(${lin(c,d,v)})${tl}`
  return { type:'expand', tag:'אלגברה', title:'פילוג מורחב', mc: { q: `פתחו את הסוגריים וכנסו: ${iso(math)}`, right, wrongs },
    math, ask:'פתחו את הסוגריים וכנסו, וכתבו את התוצאה:',
    // התלמיד כותב את כל הביטוי בעצמו (כמו במחברת) — נבדק לפי המקדמים, בכל סדר
    fields:[{poly:true, v, ans:[A,B,C]}], steps }
}

/* ---------- 3. powers ---------- */
const P = (b,n) => `${b}<sup>${n}</sup>`
const frac = (t,b) => `<span class="frac"><span>${t}</span><span>${b}</span></span>`
function genPow(lv){
  const k = pick(lv === 1 ? ['val','val','r1'] : lv === 2 ? ['r1','r2','r3','tf'] : ['r1','r2','r3','mix','tf','tf'])
  const out = (title, math, ask, fields, steps, kind, mc) => ({ type:'pow', tag:'חזקות', title, math, ask, fields, steps, kind, mc })
  const expMc = (left, b, ans, prefer) => ({ q: `${iso(left)} = ?`, right: P(b,ans), wrongs: others(ans, prefer, 0).map(n => P(b,n)) })
  if(k === 'val'){
    const b = R(2,10), n = R(2, b<=3?5 : b<=5?4 : b===10?4 : 3), v = b**n
    return out('חישוב חזקה', P(b,n) + ' = ?', 'כמה זה?', [{ans:v}], [
      [`${b} כפול עצמו ${n} פעמים`, Array(n).fill(b).join(' · ')],
      ['התשובה', `${P(b,n)} = ${v}`, true]], undefined,
      { q: `כמה זה ${iso(P(b,n))}?`, right: String(v), wrongs: others(v, [b*n, b**(n-1), v+b], 1).map(String) })
  }
  if(k === 'r1'){
    const b = lv === 3 ? pick([2,3,5,'a','b']) : R(2,7)
    const ex = [R(2,6), R(2,5)]; if(lv > 1 && Math.random() < .5) ex.push(1)
    const s = ex.reduce((p,q)=>p+q,0)
    const steps = []
    if(ex.includes(1)) steps.push([`${b} בלי מעריך זה ${b} בחזקת 1`, ex.map(e=>P(b,e)).join(' · ')])
    steps.push(['חוק 1: כפל, אותו בסיס — מחברים את המעריכים', P(b, ex.join('+'))], ['התשובה', P(b,s), true])
    return out('חוק 1 — כפל חזקות', ex.map(e => e===1 ? b : P(b,e)).join(' · ') + ' = ' + P(b,'?'),
      'מה המעריך?', [{pre:String(b), ans:s, sup:true}], steps, undefined,
      expMc(ex.map(e => e===1 ? b : P(b,e)).join(' · '), b, s, [ex.reduce((p,q)=>p*q,1), s-1]))
  }
  if(k === 'r2'){
    const b = R(2,10), n = R(2,8), m = n + R(1,6)
    return out('חוק 2 — חילוק חזקות', frac(P(b,m),P(b,n)) + ' = ' + P(b,'?'), 'מה המעריך?', [{pre:String(b), ans:m-n, sup:true}], [
      ['חוק 2: חילוק, אותו בסיס — מחסרים את המעריכים', P(b, m+'−'+n)], ['התשובה', P(b,m-n), true]], undefined,
      expMc(frac(P(b,m),P(b,n)), b, m-n, [m+n, m-n+1]))
  }
  if(k === 'r3'){
    const b = pick([2,3,4,5,6,'a']), m = R(2,6), n = R(2,5)
    return out('חוק 3 — חזקה של חזקה', `(${P(b,m)})<sup>${n}</sup> = ${P(b,'?')}`, 'מה המעריך?', [{pre:String(b), ans:m*n, sup:true}], [
      ['חוק 3: חזקה של חזקה — כופלים את המעריכים', P(b, m+'·'+n)], ['התשובה', P(b,m*n), true]], undefined,
      expMc(`(${P(b,m)})<sup>${n}</sup>`, b, m*n, [m+n, m*n+n]))
  }
  if(k === 'mix'){
    const c = R(2,5), b = R(2,4), n = R(2,3), d = R(2,3), m = R(2,3)
    return out('חשבון עם חזקות', `${c} · ${P(b,n)} + ${P(d,m)} = ?`, 'כמה זה?', [{ans:c*b**n + d**m}], [
      ['קודם מחשבים את החזקות', `${c} · ${b**n} + ${d**m}`],
      ['אחר כך כפל', `${c*b**n} + ${d**m}`],
      ['ובסוף חיבור', String(c*b**n + d**m), true]], undefined,
      { q: `כמה זה ${iso(`${c} · ${P(b,n)} + ${P(d,m)}`)}?`, right: String(c*b**n + d**m),
        wrongs: others(c*b**n + d**m, [(c*b)**n + d**m, c*b*n + d*m, c*b**n + d*m], 1).map(String) })
  }
  // true / false — aimed at the "5² + 5³ = 5⁵" mix-up
  const b = R(2,5), m = R(2,3), n = R(2,3)
  const st = pick(['sum','sum','mul','pow','div','base'])
  const T = {
    sum:  [`${P(b,m)} + ${P(b,n)} = ${P(b,m+n)}`, false, [
            ['מחברים מעריכים רק בכפל, לא בחיבור. בחיבור מחשבים כל חזקה לחוד', `${b**m} + ${b**n} = ${b**m+b**n}`],
            ['ואילו', `${P(b,m+n)} = ${b**(m+n)}`], ['לכן', `${P(b,m)} + ${P(b,n)} ≠ ${P(b,m+n)}`, true]]],
    mul:  [`${P(b,m)} · ${P(b,n)} = ${P(b,m+n)}`, true, [['חוק 1: כפל, אותו בסיס — מחברים את המעריכים', `${P(b,m)} · ${P(b,n)} = ${P(b,m+n)} ✓`, true]]],
    pow:  [`(${P(b,m+1)})<sup>${n}</sup> = ${P(b,m+1+n)}`, false, [['בחזקה של חזקה כופלים את המעריכים, לא מחברים', `(${P(b,m+1)})<sup>${n}</sup> = ${P(b,(m+1)*n)}`, true]]],
    div:  [`${frac(P(b,m+n),P(b,n))} = ${P(b,m)}`, true, [['חוק 2: חילוק, אותו בסיס — מחסרים את המעריכים', `${P(b,(m+n)+'−'+n)} = ${P(b,m)} ✓`, true]]],
    base: [`${P(2,m)} · ${P(3,n)} = ${P(6,m+n)}`, false, [['החוקים עובדים רק כשהבסיס זהה. כאן מחשבים כל חזקה לחוד', `${2**m} · ${3**n} = ${2**m*3**n}`, true]]],
  }[st]
  return out('נכון או לא נכון?', T[0], 'האם זה נכון?', [{ans:T[1]}], T[2], 'tf',
    { q: `נכון או לא נכון: ${iso(T[0])}`, right: T[1] ? 'נכון' : 'לא נכון', wrongs: [T[1] ? 'לא נכון' : 'נכון'] })
}

/* ---------- 4. find the mistake (rare) ---------- */
function genErr(){
  let b, d; do { b = R(1,9); d = -R(1,9); } while(b + d === 0)
  const v = pick(['x','a','y']), B = b + d, C = b*d
  const okLines = [`(${lin(1,b,v)})(${lin(1,d,v)})`, `${sq(v)}${scx(d,v)}${scx(b,v)}${sgn(C)}`, quad(1,B,C,v)]
  const lines = okLines.slice()
  const e = pick(['last','last','sq','collect'])
  let at, why
  if(e === 'last'){ const C2 = pick([-C, C + pick([-4,4])]); at = 2
    lines[1] = `${sq(v)}${scx(d,v)}${scx(b,v)}${sgn(C2)}`; lines[2] = quad(1,B,C2,v)
    why = ['המספר בסוף לא נכון', `${b} · ${par(d)} = ${M(C)}`]; }
  else if(e === 'sq'){ at = 2
    lines[1] = `${v}${scx(d,v)}${scx(b,v)}${sgn(C)}`; lines[2] = `${cx(1+B,v)}${sgn(C)}`
    why = ['חסרה החזקה', `${v} · ${v} = ${sq(v)}`]; }
  else { at = 3; const B2 = -B
    lines[2] = quad(1,B2,C,v); why = ['כינוס איברים לא נכון', `${cx(d,v)}${scx(b,v)} = ${cx(B,v)}`]; }
  const fig = `<div class="wlines">${lines.map((l,i)=>`<div class="wl"><b>${i+1}</b><span>${l}</span></div>`).join('')}</div>`
  // "מצא ותקן": כותבים את התוצאה הנכונה (בלי בחירה בין שורות — אי אפשר לנחש)
  const right = quad(1,B,C,v)
  const wrongs = [...new Set([lines[2], quad(1,-B,C,v), quad(1,B,-C,v), quad(1,-B,-C,v)])].filter((w) => w !== right).slice(0, 3)
  return { type:'err', tag:'מצא ותקן', title:'מצא ותקן', figure:fig, ask:'בפתרון הזה יש טעות אחת. מצאו אותה וכתבו את התוצאה הנכונה:',
    fields:[{poly:true, v, ans:[1,B,C]}],
    steps:[[`הטעות בשורה ${at}: ${why[0]}`, why[1]], ['הפתרון הנכון', okLines[1]], ['', okLines[2], true]],
    mc: { q: `בפתרון של ${iso(lines[0])} יש טעות. מה התוצאה הנכונה?`, right, wrongs } }
}

/* ---------- 5. equations with brackets ---------- */
function genEq(lv){
  for(;;){
    const x = pick([-1,1])*R(1,9) || 2
    if(lv === 1){                       // a(x + b) = cx + d
      const a = R(2,5), b = pick([-1,1])*R(1,8), c = R(1,a+3); if(c===a) continue
      const d = a*x + a*b - c*x
      return eqOut(`${a}(${lin(1,b)}) = ${lin(c,d)}`, x, [
        ['פותחים סוגריים: כופלים את '+a+' בכל איבר', `${lin(a,a*b)} = ${lin(c,d)}`],
        ['מעבירים x לצד אחד ומספרים לצד השני', `${cx(a)}${scx(-c)} = ${M(d)}${sgn(-a*b)}`],
        ['מכנסים', `${cx(a-c)} = ${M(d-a*b)}`],
        ...(a-c!==1?[['מחלקים ב-'+par(a-c), `x = ${M(d-a*b)} : ${par(a-c)}`]]:[]),
        ['התשובה', 'x = '+M(x), true]])
    }
    if(lv === 2){                       // a(x + b) − c(x + d) = e
      const a = R(3,7), c = R(1,a-1), b = pick([-1,1])*R(1,6), d = pick([-1,1])*R(1,6)
      const e = a*(x+b) - c*(x+d)
      return eqOut(`${a}(${lin(1,b)}) − ${c}(${lin(1,d)}) = ${M(e)}`, x, [
        ['פותחים סוגריים. שימו לב: המינוס לפני '+c+' הופך את הסימן של שני האיברים', `${lin(a,a*b)}${scx(-c)}${sgn(-c*d)} = ${M(e)}`],
        ['מכנסים איברים דומים', `${lin(a-c, a*b-c*d)} = ${M(e)}`],
        ...(a*b-c*d?[['מעבירים את '+M(a*b-c*d)+' לצד השני', `${cx(a-c)} = ${M(e-(a*b-c*d))}`]]:[]),
        ...(a-c!==1?[['מחלקים ב-'+(a-c), `x = ${M(e-(a*b-c*d))} : ${a-c}`]]:[]),
        ['התשובה', 'x = '+M(x), true]])
    }
    // (x + p)(x + q) = x² + rx + s
    const p = pick([-1,1])*R(1,8), q = pick([-1,1])*R(1,8), r = pick([-1,1])*R(1,9)
    const k = p+q-r; if(!k) continue
    const s = k*x + p*q
    return eqOut(`(${lin(1,p)})(${lin(1,q)}) = ${quad(1,r,s)}`, x, [
      ['פותחים סוגריים בצד שמאל', `${quad(1,p+q,p*q)} = ${quad(1,r,s)}`],
      ['x² מופיע בשני הצדדים — מבטלים אותו', `${lin(p+q,p*q)} = ${lin(r,s)}`],
      ['מעבירים x לשמאל ומספרים לימין', `${cx(p+q)}${scx(-r)} = ${M(s)}${sgn(-p*q)}`],
      ['מכנסים', `${cx(k)} = ${M(s-p*q)}`],
      ...(k!==1?[['מחלקים ב-'+par(k), `x = ${M(s-p*q)} : ${par(k)}`]]:[]),
      ['התשובה', 'x = '+M(x), true]])
  }
}
const eqOut = (math, x, steps) => ({ type:'eq', tag:'אלגברה', title:'משוואה עם סוגריים', math, ask:'פתרו את המשוואה.', fields:[{pre:'x =', ans:x}], steps,
  mc: { q: `פתרו את המשוואה: ${iso(math)}`, right: 'x = ' + M(x), wrongs: others(x, [-x]).map(n => 'x = ' + M(n)) } })

// ביטוי שהתלמיד כתב (למשל "x²+7x+12", "x^2 - 2x", "12+7x+x²") → [מקדם x², מקדם x, מספר]; לא קריא → null
export function parsePoly(raw, v = 'x') {
  const s = String(raw).toLowerCase().replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/\^2/g, '²').replace(/[*·]/g, '')
  if (!s) return null
  const re = new RegExp(`([+-]?)(\\d*)(${v}²|${v})?`, 'y')
  const c = [0, 0, 0]
  let i = 0, n = 0
  while (i < s.length) {
    re.lastIndex = i
    const m = re.exec(s)
    if (!m || m[0] === '' || m[0] === '+' || m[0] === '-' || (n > 0 && !m[1])) return null
    if (m[2] === '' && !m[3]) return null
    const k = m[2] === '' ? 1 : Number(m[2])
    c[m[3] ? (m[3].endsWith('²') ? 2 : 1) : 0] += (m[1] === '-' ? -1 : 1) * k
    i = re.lastIndex; n++
  }
  return [c[2], c[1], c[0]]
}

// HTML של תרגיל → טקסט רגיל (חזקות בתווי עילית); iso — ביטוי מבודד משמאל לימין בתוך משפט בעברית
const SUPS = { 0:'⁰', 1:'¹', 2:'²', 3:'³', 4:'⁴', 5:'⁵', 6:'⁶', 7:'⁷', 8:'⁸', 9:'⁹', '+':'⁺', '−':'⁻', '·':'·' }
const plain = (h) => String(h)
  .replace(/<span class="frac"><span>(.*?)<\/span><span>(.*?)<\/span><\/span>/g, '$1 : $2')
  .replace(/<sup>(.*?)<\/sup>/g, (_, e) => [...e].map((c) => SUPS[c] ?? c).join(''))
  .replace(/<[^>]+>/g, '')
function iso(h) { return '\u2066' + plain(h) + '\u2069' }
const DIFF = { 1: 'קל', 2: 'בינוני', 3: 'קשה' }
export const difficultyOf = (level) => DIFF[level] || 'בינוני'

// התרגיל כשאלה אמריקאית ל"לחיזוק" — אותו מבנה כמו שאלה רגילה
export function toQuestion(ex, level) {
  const { q, right, wrongs } = ex.mc
  const fix = (c) => (/[א-ת]/.test(c) ? plain(c) : iso(c))
  const choices = [right, ...wrongs].map(fix).sort(() => Math.random() - 0.5)
  const explain = ex.steps.map(([why, e]) => [why && plain(why), e && iso(e)].filter(Boolean).join(': ')).join('\n')
  return { q, choices, answer: choices.indexOf(fix(right)), difficulty: difficultyOf(level), explain, hint: '' }
}

const GEN = { tri: genTri, expand: genExpand, eq: genEq, pow: genPow, err: genErr }
export const LEVELED = ['tri', 'expand', 'eq', 'pow']
export const makeExercise = (type, level) => GEN[type](level || 1)

// ── שילוב בתרגול הרגיל: נושא מתמטי שיש לו סוג תרגיל → תרגילים במקום שאלות אמריקאיות ──
export const isMathSubject = (name) => /מתמטיקה|חשבון|אלגברה|גאומטרי/.test(name || '')
// הסדר חשוב: "משוואות עם סוגריים" הוא משוואות, לא פילוג. משולש — רק זוויות במשולש (לא שטח, לא ישרים מקבילים)
const TOPIC_TYPES = [['pow', /חזק/], ['eq', /משווא/], ['tri', /זווי.*משולש|משולש.*זווי/], ['expand', /פילוג|סוגריים|כפל מקוצר/]]
export const drillTypeOf = (topicName) => (TOPIC_TYPES.find(([, re]) => re.test(topicName || '')) || [])[0] || null

// n תרגילים מהנושאים (בסבב, בסדר אקראי); בנושא פילוג — מדי פעם "איפה הטעות?"
export function drillItems(topics, n) {
  if (!topics.length || n <= 0) return []
  const order = topics.slice().sort(() => Math.random() - 0.5)
  return Array.from({ length: n }, (_, i) => {
    const t = order[i % order.length]
    let type = drillTypeOf(t.name)
    if (type === 'expand' && Math.random() < 0.12) type = 'err'
    return { drill: true, type, topic_id: t.id }
  })
}

// רמה לכל סוג (1–3), שמורה במכשיר: 2 נכונות ברצף → עולה, טעות → יורדת
const lvKey = (id) => `mathDrill:${id}`
function readLv(id) {
  try { const v = JSON.parse(localStorage.getItem(lvKey(id)) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export const levelOf = (subjectId, type) => (LEVELED.includes(type) ? readLv(subjectId)[type] || 1 : 0)
export function bumpLevel(subjectId, type, ok) {
  if (!LEVELED.includes(type)) return
  const v = readLv(subjectId), s = v._s || {}
  let lv = v[type] || 1
  if (ok) { s[type] = (s[type] || 0) + 1; if (s[type] >= 2 && lv < 3) { lv++; s[type] = 0 } }
  else { s[type] = 0; if (lv > 1) lv-- }
  try { localStorage.setItem(lvKey(subjectId), JSON.stringify({ ...v, [type]: lv, _s: s })) } catch { /* אין אחסון — לא נורא */ }
}
