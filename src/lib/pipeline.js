'use strict';
/**
 * Pipeline completo: imagem RGBA (resolução original) + parâmetros -> modelo vetorial.
 * Roda dentro de um worker_thread (ver worker.js) para não travar a interface.
 */
const P = require('./preprocess');
const { traceImage, modelStats } = require('./trace');

const DEFAULTS = {
  mode: 'color', // 'color' | 'gray' | 'bw'
  colors: 12, // 2..64
  upscale: 3, // 1..4 (ampliação antes de vetorizar)
  denoise: 1, // 0..2 (raio da mediana)
  sharpen: 20, // 0..100 (%)
  autoContrast: false,
  threshold: -1, // P&B: -1 = automático (Otsu) ou 0..255
  detail: 4, // ignora manchas menores que N px (na imagem original)
  smooth: 40, // 0..100 suavidade das curvas
  removeBg: false,
  antiGap: true,
};

// Limite de pixels da imagem de trabalho (após ampliar). Protege memória e tempo.
const MAX_WORK_PIXELS = 8000000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

function normalizeParams(input = {}) {
  const o = { ...DEFAULTS, ...input };
  o.mode = ['color', 'gray', 'bw'].includes(o.mode) ? o.mode : 'color';
  o.colors = Math.round(clamp(num(o.colors, 12), 2, 64));
  if (o.mode === 'bw') o.colors = 2;
  o.upscale = clamp(num(o.upscale, 3), 1, 4);
  o.denoise = Math.round(clamp(num(o.denoise, 1), 0, 2));
  o.sharpen = clamp(num(o.sharpen, 0), 0, 100);
  const t = num(o.threshold, -1);
  o.threshold = t >= 0 && t <= 255 ? Math.round(t) : -1;
  o.detail = clamp(num(o.detail, 4), 0, 50);
  o.smooth = clamp(num(o.smooth, 40), 0, 100);
  o.autoContrast = !!o.autoContrast;
  o.removeBg = !!o.removeBg;
  o.antiGap = !!o.antiGap;
  return o;
}

/**
 * @param job  { width, height, data:Uint8ClampedArray, origWidth?, origHeight?, params }
 * @param progress (stage:string = chave de tradução, pct:number, args?:object) => void
 */
function runPipeline(job, progress = () => {}) {
  const t0 = Date.now();
  const p = normalizeParams(job.params);
  const outWidth = job.origWidth || job.width;
  const outHeight = job.origHeight || job.height;

  if (!job.width || !job.height || job.data.length < job.width * job.height * 4) {
    const e = new Error('Imagem inválida.');
    e.code = 'INVALID_IMAGE';
    throw e;
  }

  let img = P.cloneImage({ width: job.width, height: job.height, data: job.data });

  progress('alpha', 5);
  const hasAlpha = P.prepareAlpha(img, p.mode);
  if (p.mode !== 'color') P.toGray(img);

  if (p.denoise > 0) {
    progress('denoise', 15);
    img = P.medianFilter(img, p.denoise, p.mode !== 'color');
  }
  if (p.autoContrast) {
    progress('contrast', 25);
    P.autoLevels(img);
  }

  const size = P.computeWorkSize(img.width, img.height, p.upscale, MAX_WORK_PIXELS);
  if (size.width !== img.width || size.height !== img.height) {
    progress('resize', 35, { w: size.width, h: size.height });
    img = P.resizeLanczos(img, size.width, size.height);
    if (hasAlpha) P.binarizeAlpha(img);
  }

  if (p.sharpen > 0) {
    progress('sharpen', 45);
    img = P.unsharp(img, p.sharpen, size.factor >= 2.5 ? 2 : 1);
  }

  if (p.mode === 'bw') {
    progress('threshold', 50);
    const t = p.threshold >= 0 ? p.threshold : P.otsu(img);
    P.applyThreshold(img, t);
  }

  progress('trace', 55);
  const model = traceImage(img, p, { factor: size.factor, outWidth, outHeight }, (stage, pct) =>
    progress(stage, 55 + Math.round((pct / 100) * 40))
  );

  progress('finalize', 95);
  const stats = {
    ...modelStats(model),
    colors: model.palette ? model.palette.length : undefined,
    ms: Date.now() - t0,
    workWidth: img.width,
    workHeight: img.height,
    factor: Math.round(size.factor * 100) / 100,
  };
  return { model, stats };
}

module.exports = { runPipeline, normalizeParams, DEFAULTS, MAX_WORK_PIXELS };
