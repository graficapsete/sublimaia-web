'use strict';
/**
 * Mapa de rótulos: cada pixel recebe o índice de uma cor da paleta.
 *  - K (= palette.length) é o rótulo especial "transparente".
 *  - Misturas são resolvidas pela cobertura entre tintas; a cobertura contínua
 *    é recuperada usando somente cores presentes na vizinhança.
 *  - Manchas minúsculas são absorvidas pelos vizinhos.
 */
const { buildClassifier } = require('./color');

const UNK = 254;

/** Preenche manchas removidas com o vizinho conhecido mais próximo (BFS multi-fonte). */
function propagate(labels, w, h) {
  const N = w * h;
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] === UNK) continue;
      if (
        (x > 0 && labels[i - 1] === UNK) || (x < w - 1 && labels[i + 1] === UNK) ||
        (y > 0 && labels[i - w] === UNK) || (y < h - 1 && labels[i + w] === UNK)
      ) queue[qt++] = i;
    }
  }
  if (qt === 0) {
    // ninguém conhecido: nada a propagar (ou tudo desconhecido -> rótulo 0)
    for (let i = 0; i < N; i++) if (labels[i] === UNK) labels[i] = 0;
    return;
  }
  while (qh < qt) {
    const p = queue[qh++];
    const L = labels[p];
    const x = p % w;
    if (x > 0 && labels[p - 1] === UNK) { labels[p - 1] = L; queue[qt++] = p - 1; }
    if (x < w - 1 && labels[p + 1] === UNK) { labels[p + 1] = L; queue[qt++] = p + 1; }
    if (p >= w && labels[p - w] === UNK) { labels[p - w] = L; queue[qt++] = p - w; }
    if (p < N - w && labels[p + w] === UNK) { labels[p + w] = L; queue[qt++] = p + w; }
  }
}

/** @returns Uint8Array(w*h) com rótulos 0..K-1 (K = transparente) */
function buildLabelMap(img, palette) {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  const K = palette.length;
  const { lut } = buildClassifier(palette);
  const labels = new Uint8Array(N);
  const exact = new Map(palette.map((c, i) => [(c.rgb[0] << 16) | (c.rgb[1] << 8) | c.rgb[2], i]));
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    if (d[p + 3] === 0) {
      labels[i] = K;
      continue;
    }
    const exactLabel = exact.get((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
    if (exactLabel !== undefined) { labels[i] = exactLabel; continue; }
    const cell = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
    // Resolve antialiasing by measured coverage. BFS from opaque seeds erases
    // thin features whose entire width consists of partially covered pixels.
    labels[i] = lut[cell];
  }
  return labels;
}

/** Recover continuous coverage at boundaries between locally present inks. */
function buildCoverageMap(img, palette, labels, factor = 1) {
  const { width: w, height: h, data } = img, N = w * h, K = palette.length;
  const secondary = new Uint8Array(N).fill(K);
  const weight = new Float32Array(N).fill(1);
  const neighbors = new Uint8Array(K);
  const reach = Math.min(4, Math.max(1, Math.ceil(factor)));
  const offsets = reach === 1 ? [-1, 0, 1] : [-reach, -1, 0, 1, reach];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, primary = labels[i];
    if (primary === K) continue;
    const p = i * 4, a = palette[primary].rgb;
    const dr = data[p] - a[0], dg = data[p + 1] - a[1], db = data[p + 2] - a[2];
    let bestError = dr * dr + dg * dg + db * db;
    if (bestError < 4) continue;
    let count = 0;
    for (const dy of offsets) for (const dx of offsets) {
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
      const candidate = labels[(y + dy) * w + x + dx];
      if (candidate === primary || candidate === K) continue;
      let found = false;
      for (let j = 0; j < count; j++) if (neighbors[j] === candidate) found = true;
      if (found) continue;
      neighbors[count++] = candidate;
      const b = palette[candidate].rgb;
      const vr = b[0] - a[0], vg = b[1] - a[1], vb = b[2] - a[2];
      const length2 = vr * vr + vg * vg + vb * vb;
      if (length2 < 36) continue;
      const t = Math.max(0, Math.min(1, (dr * vr + dg * vg + db * vb) / length2));
      const error = (dr - t * vr) ** 2 + (dg - t * vg) ** 2 + (db - t * vb) ** 2;
      if (t > 0 && t < 1 && error < Math.min(bestError, 144)) {
        bestError = error;
        secondary[i] = candidate;
        weight[i] = 1 - t;
      }
    }
  }
  return { secondary, weight };
}

/** Remove componentes conexos (4-vizinhança) menores que minArea. */
function despeckle(labels, w, h, minArea, transparentLabel) {
  const N = w * h;
  minArea = Math.min(minArea, N / 50);
  if (minArea < 2) return 0;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a > b ? a : b] = a < b ? a : b;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0 && labels[i] === labels[i - 1]) union(i, i - 1);
      if (y > 0 && labels[i] === labels[i - w]) union(i, i - w);
    }
  }
  const size = new Int32Array(N);
  for (let i = 0; i < N; i++) size[find(i)]++;
  let removed = 0;
  for (let i = 0; i < N; i++) {
    if (labels[i] !== transparentLabel && size[find(i)] < minArea) {
      labels[i] = UNK;
      removed++;
    }
  }
  if (removed) {
    if (removed === N) {
      labels.fill(0);
      return 0;
    }
    propagate(labels, w, h);
  }
  return removed;
}

/** Rótulo dominante na borda da imagem (fundo) ou -1 se não houver consenso. */
function detectBackgroundLabel(labels, w, h, K) {
  const cnt = new Int32Array(K + 1);
  let total = 0;
  const add = (i) => { cnt[labels[i]]++; total++; };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  let best = -1, bn = 0;
  for (let k = 0; k <= K; k++) if (cnt[k] > bn) { bn = cnt[k]; best = k; }
  return best >= 0 && bn >= total * 0.5 ? best : -1;
}

module.exports = { buildLabelMap, buildCoverageMap, despeckle, propagate, detectBackgroundLabel, UNK };
