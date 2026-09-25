'use strict';
/**
 * Pré-processamento de imagens raster antes da vetorização.
 * Tudo em JS puro sobre { width, height, data: Uint8ClampedArray (RGBA) }.
 *
 * Ordem usada pelo pipeline (ver pipeline.js):
 *   alfa -> cinza -> mediana (ruído/JPEG) -> auto-contraste -> ampliação Lanczos
 *   -> nitidez -> limiar (P&B)
 * Remover ruído ANTES de ampliar é mais barato e mais eficaz: o ruído e os
 * blocos de JPEG existem na resolução original.
 */

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Cópia independente da imagem. */
function cloneImage(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * Trata transparência.
 *  - modos 'gray'/'bw': achata sobre fundo branco.
 *  - modo 'color': mantém alfa binário (>=128 opaco) e preenche o RGB dos pixels
 *    transparentes com a cor média, para não sujar as bordas ao filtrar/ampliar.
 * Retorna true se o resultado ainda tem transparência.
 */
function prepareAlpha(img, mode) {
  const d = img.data;
  let hasTransparency = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) {
      hasTransparency = true;
      break;
    }
  }
  if (!hasTransparency) return false;

  if (mode !== 'color') {
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 255) {
        const inv = 255 - a;
        d[i] = (d[i] * a + 255 * inv) / 255;
        d[i + 1] = (d[i + 1] * a + 255 * inv) / 255;
        d[i + 2] = (d[i + 2] * a + 255 * inv) / 255;
        d[i + 3] = 255;
      }
    }
    return false;
  }

  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 128) {
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
      n++;
      d[i + 3] = 255;
    } else {
      d[i + 3] = 0;
    }
  }
  if (n === 0) {
    const e = new Error('A imagem é totalmente transparente.');
    e.code = 'FULLY_TRANSPARENT';
    throw e;
  }
  const mr = Math.round(sr / n), mg = Math.round(sg / n), mb = Math.round(sb / n);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) {
      d[i] = mr;
      d[i + 1] = mg;
      d[i + 2] = mb;
    }
  }
  return true;
}

/** Após ampliar, o alfa fica com valores intermediários: volta a binário. */
function binarizeAlpha(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
}

/** Converte para tons de cinza (luma Rec.601), mantendo RGB iguais. */
function toGray(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

/**
 * Filtro de mediana (raio 1 = 3x3, raio 2 = 5x5) por canal.
 * Elimina ruído "sal e pimenta" e atenua blocos de JPEG preservando bordas.
 */
function medianFilter(img, radius, grayOnly = false) {
  if (radius <= 0) return img;
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const size = 2 * radius + 1;
  const n = size * size;
  const mid = n >> 1;
  const buf = new Uint8Array(n);
  const channels = grayOnly ? 1 : 3;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < channels; c++) {
        let k = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            const v = data[(yy * w + xx) * 4 + c];
            // inserção ordenada
            let j = k++;
            while (j > 0 && buf[j - 1] > v) {
              buf[j] = buf[j - 1];
              j--;
            }
            buf[j] = v;
          }
        }
        out[p + c] = buf[mid];
      }
      if (grayOnly) out[p + 1] = out[p + 2] = out[p];
      out[p + 3] = data[p + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** Estica o histograma (descartando 0,5% dos extremos) para ganhar contraste. */
function autoLevels(img, clip = 0.005) {
  const d = img.data;
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    hist[Math.round((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000)]++;
    total++;
  }
  if (!total) return;
  const cut = total * clip;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > cut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > cut) {
      hi = v;
      break;
    }
  }
  if (hi - lo < 16) return; // imagem já "chapada": nada a esticar
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// ---------------------------------------------------------------- Lanczos ---

function lanczos3(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

function buildWeights(srcLen, dstLen) {
  const scale = dstLen / srcLen;
  const fs = Math.max(1, 1 / scale); // alarga o filtro ao reduzir (anti-aliasing)
  const support = 3 * fs;
  const maxTaps = Math.ceil(support * 2) + 3;
  const starts = new Int32Array(dstLen);
  const counts = new Int32Array(dstLen);
  const w = new Float32Array(dstLen * maxTaps);

  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale;
    let left = Math.max(0, Math.floor(center - support));
    const right = Math.min(srcLen - 1, Math.ceil(center + support));
    const base = i * maxTaps;
    const n = Math.min(right - left + 1, maxTaps);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const wt = lanczos3((left + k + 0.5 - center) / fs);
      w[base + k] = wt;
      sum += wt;
    }
    if (n <= 0 || Math.abs(sum) < 1e-9) {
      left = clamp(Math.floor(center), 0, srcLen - 1);
      w[base] = 1;
      starts[i] = left;
      counts[i] = 1;
      continue;
    }
    for (let k = 0; k < n; k++) w[base + k] /= sum;
    starts[i] = left;
    counts[i] = n;
  }
  return { starts, counts, w, maxTaps };
}

/** Redimensiona (amplia ou reduz) com Lanczos-3 separável. */
function resizeLanczos(img, nw, nh) {
  const sw = img.width, sh = img.height;
  if (nw === sw && nh === sh) return img;
  const src = img.data;

  const hw = buildWeights(sw, nw);
  const tmp = new Float32Array(nw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const rowS = y * sw * 4;
    const rowD = y * nw * 4;
    for (let x = 0; x < nw; x++) {
      const st = hw.starts[x], cnt = hw.counts[x], base = x * hw.maxTaps;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < cnt; k++) {
        const wt = hw.w[base + k];
        const si = rowS + (st + k) * 4;
        r += src[si] * wt;
        g += src[si + 1] * wt;
        b += src[si + 2] * wt;
        a += src[si + 3] * wt;
      }
      const di = rowD + x * 4;
      tmp[di] = r;
      tmp[di + 1] = g;
      tmp[di + 2] = b;
      tmp[di + 3] = a;
    }
  }

  const vw = buildWeights(sh, nh);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const st = vw.starts[y], cnt = vw.counts[y], base = y * vw.maxTaps;
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < cnt; k++) {
        const wt = vw.w[base + k];
        const si = ((st + k) * nw + x) * 4;
        r += tmp[si] * wt;
        g += tmp[si + 1] * wt;
        b += tmp[si + 2] * wt;
        a += tmp[si + 3] * wt;
      }
      const di = (y * nw + x) * 4;
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = a;
    }
  }
  return { width: nw, height: nh, data: out };
}

// ------------------------------------------------------------- Nitidez etc ---

/** Máscara de nitidez (unsharp mask) com desfoque [1 2 1]/4 separável. */
function unsharp(img, percent, passes = 1) {
  if (percent <= 0) return img;
  const { width: w, height: h, data } = img;
  const amount = (percent / 100) * 1.5;
  let blur = new Float32Array(w * h * 3);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    blur[p] = data[i];
    blur[p + 1] = data[i + 1];
    blur[p + 2] = data[i + 2];
  }
  const tmp = new Float32Array(blur.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
        for (let c = 0; c < 3; c++) {
          tmp[(y * w + x) * 3 + c] =
            (blur[(y * w + xl) * 3 + c] + 2 * blur[(y * w + x) * 3 + c] + blur[(y * w + xr) * 3 + c]) / 4;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          blur[(y * w + x) * 3 + c] =
            (tmp[(yu * w + x) * 3 + c] + 2 * tmp[(y * w + x) * 3 + c] + tmp[(yd * w + x) * 3 + c]) / 4;
        }
      }
    }
  }
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    out[i] = data[i] + amount * (data[i] - blur[p]);
    out[i + 1] = data[i + 1] + amount * (data[i + 1] - blur[p + 1]);
    out[i + 2] = data[i + 2] + amount * (data[i + 2] - blur[p + 2]);
    out[i + 3] = data[i + 3];
  }
  return { width: w, height: h, data: out };
}

/** Limiar de Otsu sobre o canal R (imagem já em cinza). */
function otsu(img) {
  const d = img.data;
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    hist[Math.round(d[i])]++;
    total++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Binariza (preto/branco puro). */
function applyThreshold(img, t) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
}

/** Tamanho de trabalho respeitando o limite de pixels. */
function computeWorkSize(w, h, upscale, maxPixels) {
  let f = upscale;
  if (w * h * f * f > maxPixels) f = Math.sqrt(maxPixels / (w * h));
  return {
    factor: f,
    width: Math.max(1, Math.round(w * f)),
    height: Math.max(1, Math.round(h * f)),
  };
}

module.exports = {
  cloneImage,
  prepareAlpha,
  binarizeAlpha,
  toGray,
  medianFilter,
  autoLevels,
  resizeLanczos,
  unsharp,
  otsu,
  applyThreshold,
  computeWorkSize,
};
