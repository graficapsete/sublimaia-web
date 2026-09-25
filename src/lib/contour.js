'use strict';
/**
 * Contornos sub-pixel a partir de mapas de rótulos.
 *
 * Para cada cor L: campo suave F_L = blur(máscara de L). A região da cor é
 *   H_L = F_L - max_{M≠L} F_M  > 0
 * (vence quem tem o maior campo). Como H_L e H_M cruzam zero exatamente no mesmo
 * lugar entre duas cores vizinhas, as formas encaixam sem frestas, e o borrão
 * elimina degraus/serrilhado. O contorno é extraído por marching squares.
 */

function boxesForGauss(sigma) {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  if (wl < 1) wl = 1;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const r = [];
  for (let i = 0; i < n; i++) r.push(((i < m ? wl : wu) - 1) / 2);
  return r; // raios
}

function blurH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + (k < 0 ? 0 : k > w - 1 ? w - 1 : k)];
    dst[row] = sum * inv;
    for (let x = 1; x < w; x++) {
      const a = x + r > w - 1 ? w - 1 : x + r;
      const s = x - r - 1 < 0 ? 0 : x - r - 1;
      sum += src[row + a] - src[row + s];
      dst[row + x] = sum * inv;
    }
  }
}

function blurV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  const col = new Float64Array(w);
  for (let k = -r; k <= r; k++) {
    const row = (k < 0 ? 0 : k > h - 1 ? h - 1 : k) * w;
    for (let x = 0; x < w; x++) col[x] += src[row + x];
  }
  for (let x = 0; x < w; x++) dst[x] = col[x] * inv;
  for (let y = 1; y < h; y++) {
    const a = (y + r > h - 1 ? h - 1 : y + r) * w;
    const s = (y - r - 1 < 0 ? 0 : y - r - 1) * w;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      col[x] += src[a + x] - src[s + x];
      dst[o + x] = col[x] * inv;
    }
  }
}

/** Borrão gaussiano (3 box blurs). `a` recebe o resultado; `b` é temporário. */
function gaussBlur(a, b, w, h, radii) {
  for (const r of radii) {
    if (r < 1) continue;
    blurH(a, b, w, h, r);
    blurV(b, a, w, h, r);
  }
}

/** Caixa delimitadora de cada rótulo. */
function labelBounds(labels, w, h, count) {
  const minx = new Int32Array(count).fill(w), miny = new Int32Array(count).fill(h);
  const maxx = new Int32Array(count).fill(-1), maxy = new Int32Array(count).fill(-1);
  const area = new Float64Array(count);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const L = labels[y * w + x];
      area[L]++;
      if (x < minx[L]) minx[L] = x;
      if (x > maxx[L]) maxx[L] = x;
      if (y < miny[L]) miny[L] = y;
      if (y > maxy[L]) maxy[L] = y;
    }
  }
  return { minx, miny, maxx, maxy, area };
}

/**
 * Marching squares em h (lw×lh) com limiar 0. Devolve laços fechados
 * [Float64Array x,y,x,y...] em coordenadas locais de pixel (centro do pixel = +0.5).
 */
function extractLoops(hf, lw, lh) {
  const PW = lw + 4, PH = lh + 4;
  const P = new Float32Array(PW * PH).fill(-1);
  for (let y = 0; y < lh; y++) {
    const src = y * lw, dst = (y + 2) * PW + 2;
    for (let x = 0; x < lw; x++) P[dst + x] = hf[src + x];
    P[dst - 1] = hf[src]; // anel replicado (esquerda/direita)
    P[dst + lw] = hf[src + lw - 1];
  }
  for (let x = 0; x < lw; x++) {
    P[PW + 2 + x] = hf[x]; // anel replicado (topo/base)
    P[(lh + 2) * PW + 2 + x] = hf[(lh - 1) * lw + x];
  }
  P[PW + 1] = hf[0];
  P[PW + lw + 2] = hf[lw - 1];
  P[(lh + 2) * PW + 1] = hf[(lh - 1) * lw];
  P[(lh + 2) * PW + lw + 2] = hf[lh * lw - 1];

  const OFF = PW * PH;
  const a1 = new Map(), a2 = new Map();
  const add = (e, o) => { if (!a1.has(e)) a1.set(e, o); else a2.set(e, o); };
  const link = (e, f) => { add(e, f); add(f, e); };

  for (let y = 0; y < PH - 1; y++) {
    for (let x = 0; x < PW - 1; x++) {
      const i = y * PW + x;
      const v0 = P[i], v1 = P[i + 1], v2 = P[i + PW + 1], v3 = P[i + PW];
      const c = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const top = i, bottom = i + PW, left = OFF + i, right = OFF + i + 1;
      switch (c) {
        case 1: case 14: link(left, top); break;
        case 2: case 13: link(top, right); break;
        case 4: case 11: link(right, bottom); break;
        case 8: case 7: link(bottom, left); break;
        case 3: case 12: link(left, right); break;
        case 6: case 9: link(top, bottom); break;
        case 5: case 10: {
          const centerIn = v0 + v1 + v2 + v3 > 0;
          if ((c === 5) === centerIn) { link(top, right); link(bottom, left); }
          else { link(left, top); link(right, bottom); }
          break;
        }
        default: break;
      }
    }
  }

  const pt = (e, out) => {
    if (e < OFF) {
      const y = (e / PW) | 0, x = e - y * PW;
      const va = P[e], vb = P[e + 1];
      out[0] = x + va / (va - vb);
      out[1] = y;
    } else {
      const k = e - OFF, y = (k / PW) | 0, x = k - y * PW;
      const va = P[k], vb = P[k + PW];
      out[0] = x;
      out[1] = y + va / (va - vb);
    }
  };

  const loops = [];
  const visited = new Set();
  const tmp = [0, 0];
  for (const start of a1.keys()) {
    if (visited.has(start)) continue;
    const coords = [];
    let prev = -1, cur = start;
    for (;;) {
      visited.add(cur);
      pt(cur, tmp);
      coords.push(tmp[0] - 2 + 0.5, tmp[1] - 2 + 0.5);
      const n1 = a1.get(cur), n2 = a2.get(cur);
      let nx = n1 !== prev ? n1 : n2;
      if (nx === undefined || nx === start || visited.has(nx)) break;
      prev = cur;
      cur = nx;
    }
    if (coords.length >= 6) loops.push(Float64Array.from(coords));
  }
  return loops;
}

module.exports = { boxesForGauss, gaussBlur, labelBounds, extractLoops };
