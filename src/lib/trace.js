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
const { buildLabelMap, despeckle, detectBackgroundLabel } = require('./labels');
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
    sigma: Math.max(0.9, (0.1 + 0.2 * s) * factor), // borrão dos campos (px de trabalho)
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
    : extractPalette(img, p.colors);
  const K = palette.length;
  const T = K; // rótulo "transparente"
  if (K === 0) return { width: ctx.outWidth, height: ctx.outHeight, stroke: 0, shapes: [], palette: [] };

  progress('classify', 12);
  const labels = buildLabelMap(img, palette);

  progress('despeckle', 22);
  const minArea = p.detail > 0 ? Math.pow((p.detail / 2) * factor, 2) : 0;
  despeckle(labels, W, H, minArea, T);

  const bounds = labelBounds(labels, W, H, K + 1);
  const present = [];
  for (let k = 0; k < K; k++) if (bounds.area[k] > 0) present.push(k);

  // rótulos que não são desenhados
  const skip = new Set();
  if (bounds.area[T] > 0) skip.add(T);
  if (p.removeBg) {
    const bg = detectBackgroundLabel(labels, W, H, K);
    if (bg >= 0 && bg !== T) skip.add(bg);
  }

  // ordem de desenho: maior área embaixo, detalhes por cima
  const order = present.filter((k) => !skip.has(k)).sort((a, b) => bounds.area[b] - bounds.area[a]);

  const shapes = [];
  const stroke = p.antiGap ? Math.round(Math.min(0.5, 0.9 / factor + 0.15) * 100) / 100 : 0;

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
    const pad = Math.ceil(radii.reduce((a, b) => a + b, 0)) + 3;
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
        for (let x = 0; x < lw; x++) scratchA[o + x] = labels[g + x] === L ? 1 : 0;
      }
      gaussBlur(scratchA, scratchB, lw, lh, radii);
      return { x0, y0, lw, lh };
    };

    // passo 1: maior e segundo maior campo em cada pixel
    progress('smooth', 30);
    const allLabels = present.concat(bounds.area[T] > 0 ? [T] : []);
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
      const minLoopArea = Math.max(1.5, minArea * 0.25);
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

module.exports = { traceImage, modelStats };
