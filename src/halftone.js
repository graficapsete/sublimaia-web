'use strict';
const sharp = require('sharp');
const { Worker } = require('worker_threads');
const path = require('path');

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 12_000_000;
const MAX_OUTPUT_PIXELS = 16_000_000;
let busy = false;

class HalftoneError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.status = status; this.code = code; }
}

function number(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HalftoneError(`${label} deve estar entre ${min} e ${max}.`);
  return n;
}

function options(body, sourceWidth, sourceHeight) {
  const shirt = String(body.shirt || 'white');
  if (!['white', 'light', 'colored', 'black'].includes(shirt)) throw new HalftoneError('Tipo de camisa inválido.');
  const palette = { white: '#ffffff', light: '#e9e2d2', black: '#171717' };
  const color = shirt === 'colored' ? String(body.color || '') : palette[shirt];
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HalftoneError('Escolha uma cor de camisa válida.');
  const shape = String(body.shape || 'circle');
  if (!['circle', 'square', 'diamond'].includes(shape)) throw new HalftoneError('Formato de ponto inválido.');
  const widthCm = number(body.widthCm, 2, 50, 'A largura');
  const dpi = number(body.dpi, 150, 600, 'O DPI');
  const lpi = number(body.lpi, 15, 80, 'O LPI');
  const angle = number(body.angle, 0, 89, 'O ângulo');
  const contrast = number(body.contrast, 0.5, 2, 'O contraste');
  const intensity = number(body.intensity, 0.25, 2, 'A intensidade');
  const minDot = number(body.minDot, 0, 5, 'O tamanho mínimo');
  const width = Math.round(widthCm / 2.54 * dpi);
  const height = Math.round(width * sourceHeight / sourceWidth);
  if (width * height > MAX_OUTPUT_PIXELS || width > 8000 || height > 8000) throw new HalftoneError('A saída ultrapassa 16 milhões de pixels ou 8000 px por lado. Reduza largura ou DPI.', 413, 'OUTPUT_TOO_LARGE');
  const preview = body.preview === true;
  const scale = preview ? Math.min(1, 1200 / Math.max(width, height), Math.sqrt(1_000_000 / (width * height))) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), dpi, effectiveDpi: dpi * scale, lpi, angle, contrast, intensity, minDot: minDot * scale, shape, color, preview };
}

function runWorker(pixels, width, height, config) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'halftone-worker.js'), { workerData: { pixels, width, height, config } });
    const timer = setTimeout(() => { worker.terminate(); reject(new HalftoneError('O processamento demorou demais. Reduza o tamanho da impressão.', 503, 'TIMEOUT')); }, 90000);
    worker.once('message', result => { clearTimeout(timer); if (result.error) reject(new Error(result.error)); else resolve(Buffer.from(result.pixels)); });
    worker.once('error', err => { clearTimeout(timer); reject(err); });
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error('Processamento interrompido.')); } });
  });
}

async function processHalftone(body) {
  if (busy) throw new HalftoneError('Há outro halftone em processamento. Aguarde alguns segundos e tente novamente.', 429, 'BUSY');
  busy = true;
  try {
    if (typeof body.data !== 'string' || body.data.length > MAX_INPUT_BYTES * 4 / 3 + 16) throw new HalftoneError('O arquivo excede 12 MB. Reduza a imagem antes de enviar.', 413, 'INPUT_TOO_LARGE');
    const input = Buffer.from(body.data, 'base64');
    if (!input.length || input.length > MAX_INPUT_BYTES) throw new HalftoneError('O arquivo excede 12 MB ou está vazio.', 413, 'INPUT_TOO_LARGE');
    const meta = await sharp(input, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_SOURCE_PIXELS) throw new HalftoneError('A imagem de origem ultrapassa 12 milhões de pixels.', 413, 'INPUT_TOO_LARGE');
    if (!meta.hasAlpha) throw new HalftoneError('Esta arte não tem transparência. Use primeiro a aba “Remover fundo”.', 422, 'TRANSPARENCY_REQUIRED');
    const config = options(body, meta.width, meta.height);
    const { data: pixels } = await sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS }).rotate().ensureAlpha().resize(config.width, config.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true });
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) { transparent = true; break; }
    if (!transparent) throw new HalftoneError('Esta arte não tem áreas transparentes. Use primeiro a aba “Remover fundo”.', 422, 'TRANSPARENCY_REQUIRED');
    const outputPixels = await runWorker(pixels, config.width, config.height, config);
    const png = await sharp(outputPixels, { raw: { width: config.width, height: config.height, channels: 4 } }).png({ compressionLevel: 6 }).withMetadata({ density: config.dpi }).toBuffer();
    return { png, width: config.width, height: config.height, dpi: config.dpi, preview: config.preview };
  } finally { busy = false; }
}

module.exports = { processHalftone, HalftoneError, options };
