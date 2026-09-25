'use strict';
/**
 * Ajuste de curvas Bézier cúbicas a polilinhas fechadas (algoritmo de Schneider,
 * "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems),
 * com detecção de cantos: nos cantos a curva quebra; no resto, é contínua (G1).
 *
 * Entrada: Float64Array [x0,y0,x1,y1,...] (laço fechado, sem repetir o 1º ponto).
 * Saída:   { start:[x,y], segs:[['L',x,y] | ['C',c1x,c1y,c2x,c2y,x,y]] }
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
function norm(a) {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
}

function bezAt(b, t) {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return [
    b0 * b[0][0] + b1 * b[1][0] + b2 * b[2][0] + b3 * b[3][0],
    b0 * b[0][1] + b1 * b[1][1] + b2 * b[2][1] + b3 * b[3][1],
  ];
}
function bezD1(b, t) {
  const u = 1 - t;
  return [
    3 * u * u * (b[1][0] - b[0][0]) + 6 * u * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]),
    3 * u * u * (b[1][1] - b[0][1]) + 6 * u * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1]),
  ];
}
function bezD2(b, t) {
  const u = 1 - t;
  return [
    6 * u * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
    6 * u * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1]),
  ];
}

function chordParam(d, first, last) {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
  const tot = u[u.length - 1] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= tot;
  return u;
}

function generateBezier(d, first, last, u, t1, t2) {
  const n = last - first + 1;
  const p0 = d[first], p3 = d[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < n; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
    const a1 = [t1[0] * b1, t1[1] * b1], a2 = [t2[0] * b2, t2[1] * b2];
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = [
      d[first + i][0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3)),
      d[first + i][1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3)),
    ];
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  if (!(al > eps) || !(ar > eps)) al = ar = segLen / 3;
  return [p0, [p0[0] + t1[0] * al, p0[1] + t1[1] * al], [p3[0] + t2[0] * ar, p3[1] + t2[1] * ar], p3];
}

function maxError(d, first, last, bez, u) {
  let max = 0, split = ((last - first + 1) >> 1) + first;
  for (let i = first + 1; i < last; i++) {
    const p = bezAt(bez, u[i - first]);
    const dx = p[0] - d[i][0], dy = p[1] - d[i][1];
    const dd = dx * dx + dy * dy;
    if (dd >= max) {
      max = dd;
      split = i;
    }
  }
  return { max, split };
}

function reparam(d, first, last, u, bez) {
  const out = [];
  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const q = bezAt(bez, t), q1 = bezD1(bez, t), q2 = bezD2(bez, t);
    const num = (q[0] - d[i][0]) * q1[0] + (q[1] - d[i][1]) * q1[1];
    const den = q1[0] * q1[0] + q1[1] * q1[1] + (q[0] - d[i][0]) * q2[0] + (q[1] - d[i][1]) * q2[1];
    out.push(Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - num / den)));
  }
  return out;
}

function fitCubic(d, first, last, t1, t2, err2, out, depth) {
  if (last - first === 1) {
    const dist = len(sub(d[last], d[first])) / 3;
    out.push([d[first], [d[first][0] + t1[0] * dist, d[first][1] + t1[1] * dist], [d[last][0] + t2[0] * dist, d[last][1] + t2[1] * dist], d[last]]);
    return;
  }
  let u = chordParam(d, first, last);
  let bez = generateBezier(d, first, last, u, t1, t2);
  let e = maxError(d, first, last, bez, u);
  if (e.max < err2) return void out.push(bez);
  if (e.max < err2 * 16) {
    for (let it = 0; it < 5; it++) {
      u = reparam(d, first, last, u, bez);
      bez = generateBezier(d, first, last, u, t1, t2);
      e = maxError(d, first, last, bez, u);
      if (e.max < err2) return void out.push(bez);
    }
  }
  if (depth > 48 || e.split <= first || e.split >= last) return void out.push(bez);
  let ct = norm(sub(d[e.split - 1], d[e.split + 1]));
  if (ct[0] === 0 && ct[1] === 0) ct = norm(sub(d[e.split], d[e.split + 1]));
  fitCubic(d, first, e.split, t1, ct, err2, out, depth + 1);
  fitCubic(d, e.split, last, [-ct[0], -ct[1]], t2, err2, out, depth + 1);
}

/** Distância de p ao segmento a-b. */
function distSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}


/** Reamostra uma polilinha em pontos igualmente espaçados (mantém os extremos). */
function resample(pts, spacing, closed) {
  const m = pts.length;
  const seq = closed ? pts.concat([pts[0]]) : pts;
  const cum = [0];
  for (let i = 1; i < seq.length; i++) cum.push(cum[i - 1] + Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 1e-9) return { pts: pts.slice(), total };
  const cnt = Math.max(closed ? 8 : 2, Math.round(total / spacing));
  const out = [];
  let j = 0;
  const last = closed ? cnt : cnt; // closed: gera cnt pontos (sem repetir o 1º); aberto: cnt+1
  const steps = closed ? cnt : cnt;
  for (let i = 0; i <= steps; i++) {
    if (closed && i === steps) break;
    const target = (total * i) / steps;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (target - cum[j]) / seg;
    out.push([seq[j][0] + t * (seq[j + 1][0] - seq[j][0]), seq[j][1] + t * (seq[j + 1][1] - seq[j][1])]);
  }
  void m;
  void last;
  return { pts: out, total };
}

function gaussKernel(sigma) {
  const R = Math.max(1, Math.ceil(sigma * 3));
  const w = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w.push(v);
    sum += v;
  }
  return { R, w: w.map((v) => v / sum) };
}

/** Suaviza um laço fechado (circular). */
function smoothClosed(pts, sigma) {
  const n = pts.length;
  const { R, w } = gaussKernel(sigma);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let k = -R; k <= R; k++) {
      const p = pts[(((i + k) % n) + n) % n];
      x += p[0] * w[k + R];
      y += p[1] * w[k + R];
    }
    out[i] = [x, y];
  }
  return out;
}

/** Suaviza um trecho aberto mantendo os extremos fixos (reflexão pontual nas pontas). */
function smoothOpen(pts, sigma) {
  const m = pts.length;
  if (m < 4) return pts;
  const { R, w } = gaussKernel(sigma);
  const at = (j) => {
    if (j < 0) {
      const q = pts[Math.min(-j, m - 1)];
      return [2 * pts[0][0] - q[0], 2 * pts[0][1] - q[1]];
    }
    if (j > m - 1) {
      const q = pts[Math.max(2 * (m - 1) - j, 0)];
      return [2 * pts[m - 1][0] - q[0], 2 * pts[m - 1][1] - q[1]];
    }
    return pts[j];
  };
  const out = pts.slice();
  for (let i = 1; i < m - 1; i++) {
    let x = 0, y = 0;
    for (let k = -R; k <= R; k++) {
      const p = at(i + k);
      x += p[0] * w[k + R];
      y += p[1] * w[k + R];
    }
    out[i] = [x, y];
  }
  return out;
}

/** Reta de melhor ajuste (PCA) a um conjunto de pontos: {p: centróide, d: direção unitária}. */
function lineFit(P) {
  let mx = 0, my = 0;
  for (const p of P) { mx += p[0]; my += p[1]; }
  mx /= P.length; my /= P.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of P) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [mx, my], d: [Math.cos(ang), Math.sin(ang)] };
}

/**
 * Afia cantos arredondados pelo borrão: substitui a zona arredondada pela interseção
 * das retas ajustadas nos dois lados. Devolve { pts, corners } novos.
 */
function sharpenCorners(pts, corners, m, L, maxDist) {
  const n = pts.length;
  if (!corners.length || n < 4 * (m + L)) return { pts, corners };
  const drop = new Uint8Array(n);
  const put = new Map();
  for (const c of corners) {
    const A = [], B = [];
    for (let a = m + 1; a <= m + L; a++) {
      A.push(pts[(c - a + n) % n]);
      B.push(pts[(c + a) % n]);
    }
    const la = lineFit(A), lb = lineFit(B);
    const cross = la.d[0] * lb.d[1] - la.d[1] * lb.d[0];
    if (Math.abs(cross) < 0.3) continue; // quase paralelas: não é canto de verdade
    const dx = lb.p[0] - la.p[0], dy = lb.p[1] - la.p[1];
    const t = (dx * lb.d[1] - dy * lb.d[0]) / cross;
    const P = [la.p[0] + t * la.d[0], la.p[1] + t * la.d[1]];
    if (Math.hypot(P[0] - pts[c][0], P[1] - pts[c][1]) > maxDist) continue;
    let clash = false;
    for (let a = -m; a <= m; a++) if (drop[(c + a + n) % n]) clash = true;
    if (clash) continue;
    for (let a = -m; a <= m; a++) drop[(c + a + n) % n] = 1;
    put.set(c, P);
  }
  const outPts = [], outCorners = [];
  for (let i = 0; i < n; i++) {
    if (put.has(i)) {
      outCorners.push(outPts.length);
      outPts.push(put.get(i));
    } else if (!drop[i]) outPts.push(pts[i]);
  }
  // cantos não afiados continuam cantos (nos índices novos)
  for (const c of corners) {
    if (put.has(c)) continue;
    let idx = 0;
    for (let i = 0; i < c; i++) if (put.has(i) || !drop[i]) idx++;
    outCorners.push(idx);
  }
  outCorners.sort((x, y) => x - y);
  return { pts: outPts, corners: outCorners };
}

/**
 * @param loop   Float64Array (x,y,...)
 * @param opts   { tol, arcSigma (px de trabalho), cornerWindow (nº de pontos), cornerAngle (rad), scaleX, scaleY }
 */
function fitClosedPath(loop, opts) {
  const tol = opts.tol;
  const err2 = tol * tol;

  // pontos únicos
  let pts = [];
  for (let i = 0; i < loop.length; i += 2) {
    const p = [loop[i], loop[i + 1]];
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) pts.push(p);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
  const n = pts.length;
  if (n < 3) return null;

  // cantos
  const k = Math.max(2, Math.min(opts.cornerWindow | 0, Math.floor(n / 4)));
  const corners = [];
  if (n >= 8) {
    const turn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
      const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const l1 = len(v1), l2 = len(v2);
      turn[i] = l1 && l2 ? Math.acos(Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)))) : 0;
    }
    for (let i = 0; i < n; i++) {
      if (turn[i] < opts.cornerAngle) continue;
      let isMax = true;
      for (let j = 1; j <= k; j++) {
        // máximo local; em platôs vale o primeiro ponto
        if (turn[(i - j + n) % n] >= turn[i] || turn[(i + j) % n] > turn[i]) {
          isMax = false;
          break;
        }
      }
      if (isMax) corners.push(i);
    }
    // dois cantos colados atravessando o índice 0
    if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] <= k) corners.pop();
  }

  // afia os cantos arredondados pelo borrão dos campos
  if (corners.length && opts.sharpen !== false) {
    const m = Math.max(2, opts.cornerRound | 0);
    const sh = sharpenCorners(pts, corners, m, Math.max(6, m * 2), m * 3 + 2);
    pts = sh.pts;
    corners.length = 0;
    corners.push(...sh.corners);
  }
  const nn = pts.length; // pode ter mudado

  // pontos de quebra (cantos ou, se não houver, 2 pontos opostos)
  let breaks = corners.slice();
  const smoothBreak = new Set();
  if (breaks.length === 0) {
    breaks = [0, nn >> 1];
    smoothBreak.add(0);
    smoothBreak.add(nn >> 1);
  }

  const tk = Math.max(2, Math.min(k, 4)); // janela para tangentes
  const arc = opts.arcSigma || 0;

  // laço sem cantos: reamostra e suaviza o laço inteiro (circular) antes de dividir
  let work = pts;
  let workBreaks = breaks;
  let workN = nn;
  if (smoothBreak.size && arc > 0) {
    const rs = resample(pts, 1, true);
    const sigma = Math.max(0.8, Math.min(arc, rs.total / 20));
    work = smoothClosed(rs.pts, sigma);
    workN = work.length;
    workBreaks = [0, workN >> 1];
  }

  const curves = [];
  for (let bi = 0; bi < workBreaks.length; bi++) {
    const s = workBreaks[bi];
    const e = workBreaks[(bi + 1) % workBreaks.length];
    let piece = [];
    let i = s;
    for (;;) {
      piece.push(work[i]);
      if (i === e && piece.length > 1) break;
      i = (i + 1) % workN;
      if (piece.length > workN + 1) break;
    }
    if (piece.length < 2) continue;

    // trecho entre cantos: reamostra e suaviza com as pontas fixas
    if (!smoothBreak.size && arc > 0 && piece.length > 6) {
      const rs = resample(piece, 1, false);
      const sigma = Math.max(0.8, Math.min(arc, rs.total / 6));
      piece = smoothOpen(rs.pts, sigma);
    }
    const m = piece.length;
    // tangente inicial
    let t1, t2;
    if (smoothBreak.size) t1 = norm(sub(work[(s + tk) % workN], work[(s - tk + workN) % workN]));
    else t1 = norm(sub(piece[Math.min(tk, m - 1)], piece[0]));
    if (smoothBreak.size) t2 = norm(sub(work[(e - tk + workN) % workN], work[(e + tk) % workN]));
    else t2 = norm(sub(piece[Math.max(0, m - 1 - tk)], piece[m - 1]));

    // peça quase reta -> segmento reto
    let maxD = 0;
    for (let j = 1; j < m - 1; j++) maxD = Math.max(maxD, distSeg(piece[j], piece[0], piece[m - 1]));
    if (m === 2 || maxD < tol * 0.6) {
      curves.push({ line: true, p: piece[m - 1] });
      continue;
    }
    const out = [];
    fitCubic(piece, 0, m - 1, t1, t2, err2, out, 0);
    for (const b of out) {
      // cúbica quase reta -> reta
      const d1 = distSeg(b[1], b[0], b[3]), d2 = distSeg(b[2], b[0], b[3]);
      if (Math.max(d1, d2) < tol * 0.5) curves.push({ line: true, p: b[3] });
      else curves.push({ line: false, b });
    }
  }
  if (!curves.length) return null;

  const sx = opts.scaleX || 1, sy = opts.scaleY || 1;
  const r = (v) => Math.round(v * 100) / 100;
  const first = work[workBreaks[0]];
  const sp = { start: [r(first[0] * sx), r(first[1] * sy)], segs: [] };
  for (const c of curves) {
    if (c.line) sp.segs.push(['L', r(c.p[0] * sx), r(c.p[1] * sy)]);
    else sp.segs.push(['C', r(c.b[1][0] * sx), r(c.b[1][1] * sy), r(c.b[2][0] * sx), r(c.b[2][1] * sy), r(c.b[3][0] * sx), r(c.b[3][1] * sy)]);
  }
  return sp;
}

module.exports = { fitClosedPath };
