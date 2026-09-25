'use strict';
/**
 * Cores: conversão sRGB->Lab, k-means, poda de paleta e classificador de pixels.
 *
 * Ideia central (é o que separa um vetor "limpo" de um vetor cheio de halos):
 *  1. A paleta é calculada com k-means em Lab (perceptual).
 *  2. Cores de TRANSIÇÃO (o cinza entre preto e branco, o "oliva" entre amarelo e
 *     preto...) são detectadas e descartadas: elas só existem por causa do
 *     antialiasing das bordas e não são cores reais da imagem.
 *  3. Pixels que são mistura de duas cores da paleta não "votam" por cor:
 *     recebem o rótulo do vizinho confiável mais próximo (ver labels.js).
 */

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0..255) -> Lab (D65). Escreve em out[o..o+2]. */
function rgbToLab(r, g, b, out, o = 0) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = fLab(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = fLab((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[o] = 116 * y - 16;
  out[o + 1] = 500 * (x - y);
  out[o + 2] = 200 * (y - z);
}

function labOf(rgb) {
  const o = [0, 0, 0];
  rgbToLab(rgb[0], rgb[1], rgb[2], o, 0);
  return o;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Amostra pixels opacos da imagem (Lab + RGB). Determinístico. */
function samplePixels(img, maxSamples) {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  let step = Math.max(1, Math.floor(N / maxSamples));
  if (step > 1) step |= 1; // ímpar: evita alinhar com a largura
  const cap = Math.ceil(N / step) + 1;
  const lab = new Float32Array(cap * 3);
  const rgb = new Uint8Array(cap * 3);
  let n = 0;
  for (let i = 0; i < N; i += step) {
    const p = i * 4;
    if (d[p + 3] < 128) continue;
    rgb[n * 3] = d[p];
    rgb[n * 3 + 1] = d[p + 1];
    rgb[n * 3 + 2] = d[p + 2];
    rgbToLab(d[p], d[p + 1], d[p + 2], lab, n * 3);
    n++;
  }
  return { n, lab, rgb };
}

/** k-means (k-means++ determinístico) em Lab. */
function kmeans(lab, n, K, rng, iters = 10) {
  K = Math.max(1, Math.min(K, n));
  const cent = new Float64Array(K * 3);
  const minD = new Float64Array(n).fill(Infinity);
  const first = Math.floor(rng() * n);
  cent[0] = lab[first * 3];
  cent[1] = lab[first * 3 + 1];
  cent[2] = lab[first * 3 + 2];
  let have = 1;
  for (let k = 1; k < K; k++) {
    let sum = 0;
    const c0 = cent[(k - 1) * 3], c1 = cent[(k - 1) * 3 + 1], c2 = cent[(k - 1) * 3 + 2];
    for (let i = 0; i < n; i++) {
      const a = lab[i * 3] - c0, b = lab[i * 3 + 1] - c1, c = lab[i * 3 + 2] - c2;
      const dd = a * a + b * b + c * c;
      if (dd < minD[i]) minD[i] = dd;
      sum += minD[i];
    }
    if (sum <= 1e-9) break; // todos os pontos já coincidem com algum centro
    let r = rng() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= minD[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    cent[k * 3] = lab[pick * 3];
    cent[k * 3 + 1] = lab[pick * 3 + 1];
    cent[k * 3 + 2] = lab[pick * 3 + 2];
    have++;
  }
  K = have;

  const assign = new Uint8Array(n);
  const sums = new Float64Array(K * 3);
  const cnt = new Int32Array(K);
  for (let it = 0; it < iters; it++) {
    let changed = 0;
    sums.fill(0);
    cnt.fill(0);
    for (let i = 0; i < n; i++) {
      const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const a = L - cent[k * 3], b = A - cent[k * 3 + 1], c = B - cent[k * 3 + 2];
        const dd = a * a + b * b + c * c;
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      if (assign[i] !== best || it === 0) changed++;
      assign[i] = best;
      sums[best * 3] += L;
      sums[best * 3 + 1] += A;
      sums[best * 3 + 2] += B;
      cnt[best]++;
    }
    for (let k = 0; k < K; k++) {
      if (cnt[k] > 0) {
        cent[k * 3] = sums[k * 3] / cnt[k];
        cent[k * 3 + 1] = sums[k * 3 + 1] / cnt[k];
        cent[k * 3 + 2] = sums[k * 3 + 2] / cnt[k];
      }
    }
    if (changed === 0) break;
  }
  return { K, assign };
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Preto e branco "puros" quando a média está muito perto (limpa ruído JPEG). */
function snapRGB(rgb) {
  const mx = Math.max(rgb[0], rgb[1], rgb[2]);
  const mn = Math.min(rgb[0], rgb[1], rgb[2]);
  if (mx <= 14) return [0, 0, 0];
  if (mn >= 241) return [255, 255, 255];
  return rgb;
}

// Limiares (unidades de Lab, ~ΔE76)
const MERGE_DE = 10; // cores mais próximas que isso viram uma só
// Antialiasing/JPEG misturam no espaço sRGB, então a "mistura" é testada em RGB (0..255):
const MIX_MIN_LEN = 60; // só existe "mistura" entre cores razoavelmente distintas
const MIX_RESIDUAL = 14; // distância máxima ao segmento entre duas cores
const TRANS_RATIO = 0.6; // uma transição tem bem menos pixels que as cores vizinhas

/**
 * Poda a paleta: junta quase-iguais, remove cores de transição e limita a K.
 * entries: [{rgb, lab, n}]  (modificado no lugar)
 */
function prunePalette(entries, K, minShareN) {
  const remove = (i) => entries.splice(i, 1);
  for (;;) {
    if (entries.length <= 2) break;

    // 1) quase-duplicatas
    let bi = -1, bj = -1, bd = MERGE_DE;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const d = dist3(entries[i].lab, entries[j].lab);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi >= 0) {
      const a = entries[bi], b = entries[bj];
      const n = a.n + b.n;
      a.rgb = snapRGB([0, 1, 2].map((k) => clampByte((a.rgb[k] * a.n + b.rgb[k] * b.n) / n)));
      a.lab = labOf(a.rgb);
      a.n = n;
      remove(bj);
      continue;
    }

    // 2) cores de transição (ficam "entre" duas outras e têm poucos pixels)
    let cand = -1, candN = Infinity;
    for (let c = 0; c < entries.length; c++) {
      const C = entries[c];
      let isTrans = false;
      for (let a = 0; a < entries.length && !isTrans; a++) {
        if (a === c) continue;
        for (let b = a + 1; b < entries.length; b++) {
          if (b === c) continue;
          const A = entries[a].rgb, B = entries[b].rgb, Cc = C.rgb;
          const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
          const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
          if (len2 < MIX_MIN_LEN * MIX_MIN_LEN) continue;
          const t = ((Cc[0] - A[0]) * ab[0] + (Cc[1] - A[1]) * ab[1] + (Cc[2] - A[2]) * ab[2]) / len2;
          if (t < 0.04 || t > 0.96) continue;
          const proj = [A[0] + t * ab[0], A[1] + t * ab[1], A[2] + t * ab[2]];
          if (dist3(Cc, proj) > MIX_RESIDUAL) continue;
          if (C.n < TRANS_RATIO * Math.min(entries[a].n, entries[b].n)) {
            isTrans = true;
            break;
          }
        }
      }
      if (isTrans && C.n < candN) {
        cand = c;
        candN = C.n;
      }
    }
    if (cand >= 0) {
      remove(cand);
      continue;
    }

    // 3) manchas de cor quase sem pixels
    let tiny = -1;
    for (let c = 0; c < entries.length; c++) {
      if (entries[c].n < minShareN && (tiny < 0 || entries[c].n < entries[tiny].n)) tiny = c;
    }
    if (tiny >= 0) {
      remove(tiny);
      continue;
    }
    break;
  }

  // 4) limite K: remove a cor cuja perda causa o menor erro (pixels × distância²)
  while (entries.length > Math.max(1, K)) {
    let worst = 0, worstCost = Infinity;
    for (let i = 0; i < entries.length; i++) {
      let nd = Infinity;
      for (let j = 0; j < entries.length; j++) {
        if (j !== i) nd = Math.min(nd, dist3(entries[i].lab, entries[j].lab));
      }
      const cost = entries[i].n * nd * nd;
      if (cost < worstCost) {
        worstCost = cost;
        worst = i;
      }
    }
    remove(worst);
  }
  return entries;
}

/**
 * Extrai a paleta final da imagem.
 * @returns [{rgb:[r,g,b], lab:[L,a,b], share}]  (share = fração de pixels)
 */
function extractPalette(img, K, opts = {}) {
  const samples = samplePixels(img, opts.maxSamples || 160000);
  if (samples.n === 0) return [];
  const rng = mulberry32(12345);
  // Centros extras: parte deles será "engolida" por cores de transição e descartada.
  const Kp = Math.min(64, K + 4 + Math.ceil(K / 2));
  const km = kmeans(samples.lab, samples.n, Kp, rng, 10);

  const sums = new Float64Array(km.K * 3);
  const cnt = new Int32Array(km.K);
  for (let i = 0; i < samples.n; i++) {
    const k = km.assign[i];
    sums[k * 3] += samples.rgb[i * 3];
    sums[k * 3 + 1] += samples.rgb[i * 3 + 1];
    sums[k * 3 + 2] += samples.rgb[i * 3 + 2];
    cnt[k]++;
  }
  const entries = [];
  for (let k = 0; k < km.K; k++) {
    if (!cnt[k]) continue;
    const rgb = snapRGB([0, 1, 2].map((c) => clampByte(sums[k * 3 + c] / cnt[k])));
    entries.push({ rgb, lab: labOf(rgb), n: cnt[k] });
  }
  prunePalette(entries, K, Math.max(1, Math.round(samples.n * 0.0002)));
  entries.sort((a, b) => b.n - a.n);
  return entries.map((e) => ({ rgb: e.rgb, lab: e.lab, share: e.n / samples.n }));
}

/** Paleta fixa (modo P&B). */
function fixedPalette(rgbs) {
  return rgbs.map((rgb) => ({ rgb, lab: labOf(rgb), share: 1 / rgbs.length }));
}

/**
 * Classificador RGB -> rótulo, via tabela 32×32×32 (5 bits/canal).
 * unc[cell] = 1 quando a cor é uma MISTURA de duas cores da paleta (antialiasing):
 * esses pixels não devem escolher cor sozinhos.
 */
function buildClassifier(palette) {
  const K = palette.length;
  const lut = new Uint8Array(32768);
  const unc = new Uint8Array(32768);
  const lab = [0, 0, 0];
  const dists = new Float64Array(K);
  const M = Math.min(K, 6);
  const top = new Int32Array(M);
  for (let cell = 0; cell < 32768; cell++) {
    const r = ((cell >> 10) & 31) * 8 + 4, g = ((cell >> 5) & 31) * 8 + 4, b = (cell & 31) * 8 + 4;
    rgbToLab(r, g, b, lab, 0);
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) {
      const p = palette[k].lab;
      const d = Math.hypot(lab[0] - p[0], lab[1] - p[1], lab[2] - p[2]);
      dists[k] = d;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    lut[cell] = best;
    if (bd < 6 || K < 2) continue; // perto de uma cor real: confiável

    // as M mais próximas
    let m = 0;
    for (let k = 0; k < K; k++) {
      let pos = m;
      while (pos > 0 && dists[top[pos - 1]] > dists[k]) pos--;
      if (pos < M) {
        for (let q = Math.min(m, M - 1); q > pos; q--) top[q] = top[q - 1];
        top[pos] = k;
        if (m < M) m++;
      }
    }
    let mix = false;
    for (let x = 0; x < m && !mix; x++) {
      for (let y = x + 1; y < m; y++) {
        const A = palette[top[x]].rgb, B = palette[top[y]].rgb;
        const ab0 = B[0] - A[0], ab1 = B[1] - A[1], ab2 = B[2] - A[2];
        const len2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2;
        if (len2 < MIX_MIN_LEN * MIX_MIN_LEN) continue;
        const t = ((r - A[0]) * ab0 + (g - A[1]) * ab1 + (b - A[2]) * ab2) / len2;
        if (t < 0.15 || t > 0.85) continue;
        const res = Math.hypot(r - (A[0] + t * ab0), g - (A[1] + t * ab1), b - (A[2] + t * ab2));
        if (res < MIX_RESIDUAL - 2) {
          mix = true;
          break;
        }
      }
    }
    if (mix) unc[cell] = 1;
  }
  return { lut, unc };
}

module.exports = {
  rgbToLab, labOf, mulberry32, samplePixels, kmeans, prunePalette,
  extractPalette, fixedPalette, buildClassifier, snapRGB,
};
