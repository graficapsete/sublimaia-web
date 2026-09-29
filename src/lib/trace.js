'use strict';
/**
 * Vetorização: imagem RGBA tratada -> modelo vetorial interno.
 *
 * Modelo (independente de formato; todos os exportadores partem dele):
 * {
 *   width, height,          // tamanho em px da imagem ORIGINAL (unidades do usuário)
 *   stroke,                 // espessura do contorno "anti-fresta" (0 = sem)
 *   shapes: [{
 *     fill: [r, g, b],
 *     subpaths: [{ start: [x, y], segs: [['L', x, y] | ['Q', cx, cy, x, y] | ['C', c1x, c1y, c2x, c2y, x, y]] }]
 *   }]                      // cada shape = 1 cor; buracos são subpaths extras (even-odd)
 * }
 *
 * Motor próprio (sem dependências):
 *   paleta (k-means em Lab + poda de cores de transição)
 *   -> mapa de rótulos (misturas de antialiasing vão para o vizinho mais próximo)
 *   -> remoção de manchas -> campos suaves por cor -> contornos sub-pixel
 *   -> ajuste de Béziers cúbicas com detecção de cantos.
 */
const { extractPalette, fixedPalette } = require('./color');
const { buildLabelMap, buildCoverageMap, despeckle, detectBackgroundLabel } = require('./labels');
const { boxesForGauss, gaussBlur, labelBounds, extractLoops } = require('./contour');
const { fitClosedPath } = require('./bezier');

function modelStats(model) {
  let paths = 0, nodes = 0;
  for (const sh of model.shapes) {
    paths += sh.subpaths.length;
    for (const sp of sh.subpaths) nodes += sp.segs.length;
  }
  return { shapes: model.shapes.length, paths, nodes };
}

/** Parâmetros de suavização derivados do controle "suavidade" (0..100). */
function smoothing(p, factor) {
  const s = p.smooth / 100;
  return {
    sigma: Math.max(0.3, (0.1 + 0.2 * s) * factor), // em 1×, não diluir linhas de um pixel
    tol: Math.max(0.45, (0.1 + 0.4 * s) * factor), // erro máx. do ajuste de curva (px de trabalho)
    arcSigma: Math.max(1, (0.3 + 1.2 * s) * factor), // alisamento do contorno ao longo do arco
    cornerAngle: ((48 + 22 * s) * Math.PI) / 180, // ângulo de virada para considerar canto
  };
}

function polygonArea(loop) {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[i * 2] * loop[j * 2 + 1] - loop[j * 2] * loop[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

/**
 * Em logos opacos de duas tintas, os pixels intermediários do JPEG são medidas
 * da cobertura da borda, não uma terceira cor. Traçá-los como um campo contínuo
 * evita deslocar letras finas para o centro do pixel e evita a propagação BFS
 * das cores ambíguas através dos glifos.
 */
function traceTwoTone(img, palette, p, ctx) {
  const W = img.width, H = img.height;
  // The most frequent ink is not necessarily the background (large logos).
  let border0 = 0, border1 = 0;
  const vote = i => {
    const d = img.data, a = palette[0].rgb, b = palette[1].rgb;
    const da = (d[i] - a[0]) ** 2 + (d[i + 1] - a[1]) ** 2 + (d[i + 2] - a[2]) ** 2;
    const db = (d[i] - b[0]) ** 2 + (d[i + 1] - b[1]) ** 2 + (d[i + 2] - b[2]) ** 2;
    if (da <= db) border0++; else border1++;
  };
  for (let x = 0; x < W; x++) { vote(x * 4); vote(((H - 1) * W + x) * 4); }
  for (let y = 1; y + 1 < H; y++) { vote(y * W * 4); vote((y * W + W - 1) * 4); }
  const bg = border0 === border1 ? (palette[0].share >= palette[1].share ? 0 : 1) : (border0 > border1 ? 0 : 1);
  const fg = 1 - bg;
  const a = palette[bg].rgb, b = palette[fg].rgb;
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const length2 = vx * vx + vy * vy + vz * vz;
  if (length2 < 900) return null;
  const field = new Float32Array(W * H);
  const d = img.data;
  const histogram = new Uint32Array(256);
  let mixed = 0;
  let discrete = true;
  let expectedInk = 0;
  for (let i = 0; i < field.length; i++) {
    const o = i * 4;
    if (d[o + 3] < 255) return null;
    const coverage = Math.max(0, Math.min(1, ((d[o] - a[0]) * vx + (d[o + 1] - a[1]) * vy + (d[o + 2] - a[2]) * vz) / length2));
    field[i] = coverage;
    if (coverage > 0.001 && coverage < 0.999) discrete = false;
    histogram[Math.min(255, Math.floor(coverage * 255))]++;
    if (coverage > 0.1) expectedInk += coverage;
    if (coverage > 0.1 && coverage < 0.9) mixed++;
  }
  // Uma imagem com muitas cores intermediárias é provavelmente um degradê,
  // não um logo de duas tintas: deixe o motor multicolorido tratá-la.
  if (discrete || mixed > field.length * 0.15) return null;
  let threshold = 0.5;
  if (mixed > field.length / 200) {
    let opaqueArea = 0;
    for (let bin = 255; bin >= 0; bin--) {
      opaqueArea += histogram[bin];
      if (opaqueArea >= expectedInk) {
        threshold = Math.max(0.38, Math.min(0.62, bin / 255));
        break;
      }
    }
  }
  threshold = Math.max(0.25, Math.min(0.75, Math.round(threshold * 100) / 100 - p.strokeBalance / 200));
  for (let i = 0; i < field.length; i++) field[i] = Math.max(-1, Math.min(1, 2 * (field[i] - threshold)));
  // Menos de um pixel: tira ruído de compressão sem fechar os contra-formas.
  // Bordas de duas cores realmente chapadas não precisam desse filtro: ele
  // apagaria traços legítimos de um pixel e cores raras.
  if (mixed > field.length / 200) {
    const sigma = 0.4 + p.smooth / 500;
    const radii = boxesForGauss(sigma);
    if (radii.some(radius => radius >= 1)) gaussBlur(field, new Float32Array(W * H), W, H, radii);
  }
  const loops = extractLoops(field, W, H);
  const subpaths = [];
  const minArea = p.detail > 0 ? Math.pow(p.detail / 2, 2) : 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2) {
      loop[i] = Math.max(0, Math.min(W, loop[i]));
      loop[i + 1] = Math.max(0, Math.min(H, loop[i + 1]));
    }
    if (polygonArea(loop) < Math.max(0.1, minArea * 0.25)) continue;
    const sp = fitClosedPath(loop, {
      tol: 0.15 + p.smooth / 500,
      arcSigma: 0.25 + p.smooth / 300,
      cornerRound: 2,
      cornerWindow: 4,
      cornerAngle: Math.PI / 3,
      sharpen: false,
      scaleX: ctx.outWidth / W,
      scaleY: ctx.outHeight / H,
    });
    if (sp && sp.segs.length >= 2) subpaths.push(sp);
  }
  const shapes = [];
  if (!p.removeBg) shapes.push({ fill: a.slice(), subpaths: [{ start: [0, 0], segs: [['L', ctx.outWidth, 0], ['L', ctx.outWidth, ctx.outHeight], ['L', 0, ctx.outHeight]] }] });
  if (subpaths.length) shapes.push({ fill: b.slice(), subpaths });
  return { width: ctx.outWidth, height: ctx.outHeight, stroke: 0, shapes, palette: palette.map(c => c.rgb) };
}

/**
 * @param img     imagem de trabalho já tratada (RGBA)
 * @param p       parâmetros normalizados
 * @param ctx     { factor, outWidth, outHeight }
 * @param progress (stage = chave de tradução, pct 0..100) => void
 */
function traceImage(img, p, ctx, progress = () => {}) {
  const W = img.width, H = img.height, N = W * H;
  const factor = ctx.factor || 1;
  const sx = ctx.outWidth / W, sy = ctx.outHeight / H;

  progress('colors', 0);
  const palette = p.mode === 'bw'
    ? fixedPalette([[0, 0, 0], [255, 255, 255]])
    : ctx.palette || extractPalette(img, p.colors, { protectRare: p.detail <= 2 });
  const K = palette.length;
  const T = K; // rótulo "transparente"
  if (K === 0) return { width: ctx.outWidth, height: ctx.outHeight, stroke: 0, shapes: [], palette: [] };

  progress('classify', 12);
  const source = ctx.sourceImage || img;
  const sourceLabels = buildLabelMap(source, palette);
  const labels = source.width === W && source.height === H ? sourceLabels : new Uint8Array(N);
  if (labels !== sourceLabels) {
    // Enlargement may create a gray that also exists elsewhere as a real ink.
    // Keep spatial ownership from the source; interpolate coverage, not labels.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      labels[y * W + x] = sourceLabels[Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / H)) * source.width
        + Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / W))];
    }
  }
  for (let i = 0; i < N; i++) {
    if (labels[i] !== T || img.data[i * 4 + 3] === 0) continue;
    let distance = Infinity;
    for (let k = 0; k < K; k++) {
      const rgb = palette[k].rgb, p = i * 4;
      const error = (img.data[p] - rgb[0]) ** 2 + (img.data[p + 1] - rgb[1]) ** 2 + (img.data[p + 2] - rgb[2]) ** 2;
      if (error < distance) { distance = error; labels[i] = k; }
    }
  }

  progress('despeckle', 22);
  const minArea = p.detail > 0 ? Math.pow((p.detail / 2) * factor, 2) : 0;
  despeckle(labels, W, H, minArea, T);
  const coverage = buildCoverageMap(img, palette, labels, factor);

  const bounds = labelBounds(labels, W, H, K + 1);
  let hasAlpha = false;
  for (let i = 0; i < N; i++) {
    if (img.data[i * 4 + 3] === 255) continue;
    hasAlpha = true;
    const x = i % W, y = (i / W) | 0;
    bounds.minx[T] = Math.min(bounds.minx[T], x); bounds.maxx[T] = Math.max(bounds.maxx[T], x);
    bounds.miny[T] = Math.min(bounds.miny[T], y); bounds.maxy[T] = Math.max(bounds.maxy[T], y);
  }
  const present = [];
  for (let k = 0; k < K; k++) if (bounds.area[k] > 0) present.push(k);

  // rótulos que não são desenhados
  const skip = new Set();
  if (hasAlpha) skip.add(T);
  if (p.removeBg) {
    const bg = detectBackgroundLabel(labels, W, H, K);
    if (bg >= 0 && bg !== T) skip.add(bg);
  }

  // ordem de desenho: maior área embaixo, detalhes por cima
  const order = present.filter((k) => !skip.has(k)).sort((a, b) => bounds.area[b] - bounds.area[a]);

  const shapes = [];
  const stroke = p.antiGap && !hasAlpha ? Math.round(Math.min(0.25, 0.45 / factor) * 100) / 100 : 0;

  // com "evitar frestas" e sem transparência, a cor dominante vira um retângulo de fundo
  let rectLabel = -1;
  if (p.antiGap && skip.size === 0 && order.length > 1) rectLabel = order[0];
  if (rectLabel >= 0) {
    shapes.push({
      fill: palette[rectLabel].rgb.slice(),
      subpaths: [{ start: [0, 0], segs: [['L', ctx.outWidth, 0], ['L', ctx.outWidth, ctx.outHeight], ['L', 0, ctx.outHeight]] }],
    });
  }
  const toTrace = order.filter((k) => k !== rectLabel);

  if (toTrace.length) {
    const sm = smoothing(p, factor);
    const radii = boxesForGauss(sm.sigma);
    const pad = Math.ceil(radii.reduce((a, b) => a + b, 0)) + Math.max(3, Math.ceil(factor) + 1);
    const scratchA = new Float32Array(N), scratchB = new Float32Array(N);
    const best1 = new Float32Array(N), best2 = new Float32Array(N);
    const best1Lab = new Uint8Array(N).fill(255);

    // campo suave local de um rótulo (região = bbox + margem)
    const localField = (L) => {
      const x0 = Math.max(0, bounds.minx[L] - pad), x1 = Math.min(W - 1, bounds.maxx[L] + pad);
      const y0 = Math.max(0, bounds.miny[L] - pad), y1 = Math.min(H - 1, bounds.maxy[L] + pad);
      const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
      for (let y = 0; y < lh; y++) {
        const g = (y0 + y) * W + x0, o = y * lw;
        for (let x = 0; x < lw; x++) {
          const alpha = img.data[(g + x) * 4 + 3] / 255;
          const i = g + x;
          scratchA[o + x] = L === T ? 1 - alpha : alpha * (labels[i] === L ? coverage.weight[i]
            : coverage.secondary[i] === L ? 1 - coverage.weight[i] : 0);
        }
      }
      gaussBlur(scratchA, scratchB, lw, lh, radii);
      return { x0, y0, lw, lh };
    };

    // passo 1: maior e segundo maior campo em cada pixel
    progress('smooth', 30);
    const allLabels = present.concat(hasAlpha ? [T] : []);
    allLabels.forEach((L, idx) => {
      const f = localField(L);
      for (let y = 0; y < f.lh; y++) {
        const g = (f.y0 + y) * W + f.x0, o = y * f.lw;
        for (let x = 0; x < f.lw; x++) {
          const v = scratchA[o + x];
          if (v <= 0) continue;
          if (v > best1[g + x]) {
            best2[g + x] = best1[g + x];
            best1[g + x] = v;
            best1Lab[g + x] = L;
          } else if (v > best2[g + x]) best2[g + x] = v;
        }
      }
      progress('smooth', 30 + (25 * (idx + 1)) / allLabels.length);
    });

    // passo 2: contorno de cada cor
    const hbuf = new Float32Array(N);
    toTrace.forEach((L, idx) => {
      const f = localField(L);
      for (let y = 0; y < f.lh; y++) {
        const g = (f.y0 + y) * W + f.x0, o = y * f.lw;
        for (let x = 0; x < f.lw; x++) {
          const comp = best1Lab[g + x] === L ? best2[g + x] : best1[g + x];
          hbuf[o + x] = scratchA[o + x] - comp - 1e-5;
        }
      }
      const loops = extractLoops(hbuf, f.lw, f.lh);
      const subpaths = [];
      const cornerRound = Math.ceil(sm.sigma * 2.2) + 2; // extensão (em pontos) do canto arredondado pelo borrão
      const cornerWindow = cornerRound + 2;
      const minLoopArea = Math.max(0.1, minArea * 0.25);
      for (const loop of loops) {
        // coordenadas locais -> trabalho, presas ao retângulo da imagem
        for (let i = 0; i < loop.length; i += 2) {
          const wx = loop[i] + f.x0, wy = loop[i + 1] + f.y0;
          loop[i] = wx < 0 ? 0 : wx > W ? W : wx;
          loop[i + 1] = wy < 0 ? 0 : wy > H ? H : wy;
        }
        if (polygonArea(loop) < minLoopArea) continue;
        const sp = fitClosedPath(loop, { tol: sm.tol, arcSigma: sm.arcSigma, cornerRound, cornerWindow, cornerAngle: sm.cornerAngle, scaleX: sx, scaleY: sy });
        if (sp && sp.segs.length >= 2) subpaths.push(sp);
      }
      if (subpaths.length) shapes.push({ fill: palette[L].rgb.slice(), subpaths });
      progress('curves', 55 + (44 * (idx + 1)) / toTrace.length);
    });
  }

  return {
    width: ctx.outWidth,
    height: ctx.outHeight,
    stroke,
    shapes,
    palette: palette.map((c) => c.rgb),
  };
}

module.exports = { traceImage, traceTwoTone, modelStats };
