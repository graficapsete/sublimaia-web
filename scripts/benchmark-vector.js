'use strict';
// Uso: node scripts/benchmark-vector.js imagem.png '{"denoise":1}'
// A arte fica no computador: somente métricas são impressas.
const sharp = require('sharp');
const { runPipeline } = require('../src/lib/pipeline');
const { exportModel } = require('../src/lib/exporters');

const DEFAULT_PARAMS = {
  mode: 'color', colors: 12, upscale: 4, denoise: 1, sharpen: 10,
  detail: 2, smooth: 25, strokeBalance: 8, removeBg: false, antiGap: true,
};

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Informe o caminho de uma imagem para medir.');
  const params = { ...DEFAULT_PARAMS, ...(process.argv[3] ? JSON.parse(process.argv[3]) : {}) };
  const { data: source, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width * height > 8000000) throw new Error('O arquivo ultrapassa o limite de 8 milhões de pixels.');
  const { model, stats } = runPipeline({ width, height, data: source, params });
  const rendered = await sharp(Buffer.from(exportModel('svg', model))).ensureAlpha().raw().toBuffer();
  let totalError = 0, edgeError = 0, edgeCount = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    let error = 0;
    for (let c = 0; c < 4; c++) error += Math.abs(source[p + c] - rendered[p + c]);
    totalError += error;
    const neighbor = x > 0 ? p - 4 : y > 0 ? p - width * 4 : p;
    let contrast = 0;
    for (let c = 0; c < 4; c++) contrast += Math.abs(source[p + c] - source[neighbor + c]);
    if (contrast >= 30) { edgeError += error; edgeCount++; }
  }
  console.log(JSON.stringify({
    file: filename, width, height, params, stats,
    pixelError: +(totalError / (width * height * 4 * 255)).toFixed(5),
    edgeError: edgeCount ? +(edgeError / (edgeCount * 4 * 255)).toFixed(5) : null,
    edgePixels: edgeCount,
  }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
