'use strict';
/**
 * Mapa de rótulos: cada pixel recebe o índice de uma cor da paleta.
 *  - K (= palette.length) é o rótulo especial "transparente".
 *  - Pixels de MISTURA (antialiasing) recebem o rótulo do vizinho confiável
 *    mais próximo, em vez de "inventar" uma cor intermediária.
 *  - Manchas minúsculas são absorvidas pelos vizinhos.
 */
const { buildClassifier } = require('./color');

const UNK = 254;

/** Preenche pixels UNK com o rótulo do vizinho conhecido mais próximo (BFS multi-fonte). */
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
  const { lut, unc } = buildClassifier(palette);
  const labels = new Uint8Array(N);
  let anyUnk = false;
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    if (d[p + 3] < 128) {
      labels[i] = K;
      continue;
    }
    const cell = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
    if (unc[cell]) {
      labels[i] = UNK;
      anyUnk = true;
    } else labels[i] = lut[cell];
  }
  if (anyUnk) propagate(labels, w, h);
  return labels;
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

module.exports = { buildLabelMap, despeckle, propagate, detectBackgroundLabel, UNK };
