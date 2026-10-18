// תרגילי מתמטיקה שנבנים בקוד (בלי AI): התשובה תמיד נכונה והשרטוט מדויק.
// כל תרגיל: { type, tag, title, math|figure (HTML), ask, fields, steps: [[הסבר, ביטוי, סופי?]], kind? }
// kind: 'tf' — נכון/לא נכון, 'pick' — בחירת שורה; בלי kind — שדות מספר.

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

/* ---------- 1. angles in a triangle ---------- */
function genTri(lv){
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
function finishTri(terms, x, v){
  const label = t => t.c === 0 ? t.k + '°' : lin(t.c, t.k) + '°'
  const vals = terms.map(t => t.c*x + t.k)
  const sumC = terms.reduce((s,t)=>s+t.c,0), sumK = terms.reduce((s,t)=>s+t.k,0)
  const steps = [
    ['סכום הזוויות במשולש הוא 180°', terms.map(t=>t.c===0 ? t.k : t.k ? '(' + lin(t.c,t.k) + ')' : cx(t.c)).join(' + ') + ' = 180'],
    ['מחברים את ה-x לחוד ואת המספרים לחוד', lin(sumC,sumK) + ' = 180'],
  ]
  if(sumK) steps.push([sumK>0?'מעבירים את '+sumK+' לצד השני (מחסרים)':'מעבירים את '+M(sumK)+' לצד השני (מוסיפים)', cx(sumC) + ' = ' + (180-sumK)])
  if(sumC !== 1) steps.push(['מחלקים ב-' + sumC, 'x = ' + (180-sumK) + ' : ' + sumC])
  steps.push(['התשובה', 'x = ' + x, true])
  if(terms.some(t=>t.c!==0 && !(t.c===1&&t.k===0))) steps.push(['בדיקה: מציבים x = '+x, vals.join(' + ') + ' = 180 ✓'])
  return { type:'tri', tag:'גאומטרייה', title:'זוויות במשולש', math:null,
    figure: triSVG(vals, terms.map(label)), ask:'מצאו את x.', fields:[{pre:'x =', ans:x}], steps }
}
function triSVG(ang, labels){
  const [A,B] = ang.map(a => a*Math.PI/180), L = 300
  // base from P0 (left) to P1 (right); apex where the two sides meet
  const t = L * Math.sin(B) / Math.sin(A+B)
  const P0 = [0,0], P1 = [L,0], P2 = [t*Math.cos(A), t*Math.sin(A)]
  const pts = [P0,P1,P2], xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), h = Math.max(...ys)
  const W = 340, pad = 28, sc = Math.min((W-2*pad)/(maxX-minX), 190/h)
  const H = h*sc + 2*pad
  const P = pts.map(([x,y]) => [pad + (x-minX)*sc + ((W-2*pad)-(maxX-minX)*sc)/2, H - pad - y*sc])
  const cx0 = (P[0][0]+P[1][0]+P[2][0])/3, cy0 = (P[0][1]+P[1][1]+P[2][1])/3
  const names = ['A','B','C']
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="משולש עם זוויות ${labels.join(', ')}">`
  s += `<polygon points="${P.map(p=>p.join(',')).join(' ')}" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>`
  P.forEach((p,i) => {
    const dx = cx0-p[0], dy = cy0-p[1], d = Math.hypot(dx,dy), r = Math.min(46, d*.55)
    const lx = p[0] + dx/d*r, ly = p[1] + dy/d*r
    s += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="var(--ink)" font-family="Rubik, system-ui, sans-serif" font-size="15" font-weight="600" direction="ltr">${labels[i].replace(/<[^>]+>/g,'')}</text>`
    s += `<text x="${p[0]-dx/d*14}" y="${p[1]-dy/d*14}" text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-family="Rubik, system-ui, sans-serif" font-size="13">${names[i]}</text>`
  })
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
  return { type:'expand', tag:'אלגברה', title:'פילוג מורחב',
    math:`(${lin(a,b,v)})(${lin(c,d,v)})${tl}`, ask:'פתחו את הסוגריים וכנסו. השלימו את המספרים:',
    fields:[{ans:A, post:sq(v)+' +'},{ans:B, post:v+' +'},{ans:C}], steps }
}

/* ---------- 3. powers ---------- */
const P = (b,n) => `${b}<sup>${n}</sup>`
const frac = (t,b) => `<span class="frac"><span>${t}</span><span>${b}</span></span>`
function genPow(lv){
  const k = pick(lv === 1 ? ['val','val','r1'] : lv === 2 ? ['r1','r2','r3','tf'] : ['r1','r2','r3','mix','tf','tf'])
  const out = (title, math, ask, fields, steps, kind) => ({ type:'pow', tag:'חזקות', title, math, ask, fields, steps, kind })
  if(k === 'val'){
    const b = R(2,10), n = R(2, b<=3?5 : b<=5?4 : b===10?4 : 3), v = b**n
    return out('חישוב חזקה', P(b,n) + ' = ?', 'כמה זה?', [{ans:v}], [
      [`${b} כפול עצמו ${n} פעמים`, Array(n).fill(b).join(' · ')],
      ['התשובה', `${P(b,n)} = ${v}`, true]])
  }
  if(k === 'r1'){
    const b = lv === 3 ? pick([2,3,5,'a','b']) : R(2,7)
    const ex = [R(2,6), R(2,5)]; if(lv > 1 && Math.random() < .5) ex.push(1)
    const s = ex.reduce((p,q)=>p+q,0)
    const steps = []
    if(ex.includes(1)) steps.push([`${b} בלי מעריך זה ${b} בחזקת 1`, ex.map(e=>P(b,e)).join(' · ')])
    steps.push(['חוק 1: כפל, אותו בסיס — מחברים את המעריכים', P(b, ex.join('+'))], ['התשובה', P(b,s), true])
    return out('חוק 1 — כפל חזקות', ex.map(e => e===1 ? b : P(b,e)).join(' · ') + ' = ' + P(b,'?'),
      'מה המעריך?', [{pre:String(b), ans:s, sup:true}], steps)
  }
  if(k === 'r2'){
    const b = R(2,10), n = R(2,8), m = n + R(1,6)
    return out('חוק 2 — חילוק חזקות', frac(P(b,m),P(b,n)) + ' = ' + P(b,'?'), 'מה המעריך?', [{pre:String(b), ans:m-n, sup:true}], [
      ['חוק 2: חילוק, אותו בסיס — מחסרים את המעריכים', P(b, m+'−'+n)], ['התשובה', P(b,m-n), true]])
  }
  if(k === 'r3'){
    const b = pick([2,3,4,5,6,'a']), m = R(2,6), n = R(2,5)
    return out('חוק 3 — חזקה של חזקה', `(${P(b,m)})<sup>${n}</sup> = ${P(b,'?')}`, 'מה המעריך?', [{pre:String(b), ans:m*n, sup:true}], [
      ['חוק 3: חזקה של חזקה — כופלים את המעריכים', P(b, m+'·'+n)], ['התשובה', P(b,m*n), true]])
  }
  if(k === 'mix'){
    const c = R(2,5), b = R(2,4), n = R(2,3), d = R(2,3), m = R(2,3)
    return out('חשבון עם חזקות', `${c} · ${P(b,n)} + ${P(d,m)} = ?`, 'כמה זה?', [{ans:c*b**n + d**m}], [
      ['קודם מחשבים את החזקות', `${c} · ${b**n} + ${d**m}`],
      ['אחר כך כפל', `${c*b**n} + ${d**m}`],
      ['ובסוף חיבור', String(c*b**n + d**m), true]])
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
  return out('נכון או לא נכון?', T[0], 'האם זה נכון?', [{ans:T[1]}], T[2], 'tf')
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
  return { type:'err', tag:'מצא את הטעות', title:'איפה הטעות?', figure:fig, ask:'בפתרון הזה יש טעות אחת. באיזו שורה?',
    kind:'pick', fields:[{ans:at, opts:[[2,'שורה 2'],[3,'שורה 3']]}],
    steps:[[`הטעות בשורה ${at}: ${why[0]}`, why[1]], ['הפתרון הנכון', okLines[1]], ['', okLines[2], true]] }
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
const eqOut = (math, x, steps) => ({ type:'eq', tag:'אלגברה', title:'משוואה עם סוגריים', math, ask:'פתרו את המשוואה.', fields:[{pre:'x =', ans:x}], steps })

const GEN = { tri: genTri, expand: genExpand, eq: genEq, pow: genPow, err: genErr }
// סבב של 10: "איפה הטעות?" פעם אחת בסבב
export const ROUND = ['expand', 'pow', 'eq', 'tri', 'pow', 'expand', 'eq', 'pow', 'tri', 'err']
export const LEVELED = ['tri', 'expand', 'eq', 'pow']
export const makeExercise = (type, level) => GEN[type](level || 1)
