'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { runPipeline } = require('../src/lib/pipeline');
const { exportModel } = require('../src/lib/exporters');
const { cases, params, errorMetrics } = require('./fixtures/vector-quality');
const { extractLoops } = require('../src/lib/contour');

async function vectorize(name) {
  const fixture = cases.find(c => c.name === name);
  const { data, info } = await sharp(Buffer.from(fixture.svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = runPipeline({ width: info.width, height: info.height, data, params });
  const pixels = await sharp(Buffer.from(exportModel('svg', result.model))).ensureAlpha().raw().toBuffer();
  return { ...result, source: data, pixels, fixture };
}

test('cinza intencional entre preto e branco não é descartado como antialiasing', async () => {
  const { model, pixels } = await vectorize('intentional-gray');
  assert.ok(model.palette.some(c => c.every(v => Math.abs(v - 128) <= 2)));
  assert.ok(Math.abs(pixels[(50 * 128 + 95) * 4] - 128) <= 2);
});

test('branco, marfim e tinta escura preservam suas cores distintas', async () => {
  const { pixels } = await vectorize('near-white-colors');
  assert.deepEqual([...pixels.subarray((5 * 128 + 60) * 4, (5 * 128 + 60) * 4 + 3)], [250, 245, 240]);
  assert.deepEqual([...pixels.subarray((25 * 128 + 20) * 4, (25 * 128 + 20) * 4 + 3)], [255, 255, 255]);
});

test('pontuação de um pixel não desaparece com detalhe mínimo', async () => {
  const { pixels } = await vectorize('tiny-dots');
  assert.ok(pixels[(20 * 128 + 20) * 4] < 200, 'ponto de 1px deve ser visível');
  assert.ok(pixels[(20 * 128 + 40) * 4] < 150, 'ponto de 2px deve ser visível');
});

test('cor rara próxima de outra tinta não é confundida com resíduo JPEG', async () => {
  const data = Buffer.alloc(128 * 128 * 4, 255);
  for (let y = 20; y < 100; y++) for (let x = 20; x < 50; x++) {
    const p = (y * 128 + x) * 4; data[p] = 220; data[p + 1] = 30; data[p + 2] = 40;
  }
  for (let y = 50; y < 58; y++) {
    const p = (y * 128 + 90) * 4; data[p] = 235; data[p + 1] = 35; data[p + 2] = 40;
  }
  const { model } = runPipeline({ width: 128, height: 128, data, params });
  assert.ok(model.palette.some(c => c[0] === 235 && c[1] === 35 && c[2] === 40));
  const pixels = await sharp(Buffer.from(exportModel('svg', model))).ensureAlpha().raw().toBuffer();
  assert.ok(pixels[(54 * 128 + 90) * 4 + 1] < 80);
});

test('curva transparente usa a cobertura alfa original', async () => {
  const { source, pixels, model, fixture } = await vectorize('transparent-curves');
  assert.ok(errorMetrics(source, pixels, 128, 128).edgeError < 0.05);
  assert.equal(pixels[(64 * 128 + 64) * 4 + 3], 0, 'furo permanece aberto');
  const reference = await sharp(Buffer.from(fixture.svg), { density: 288 }).ensureAlpha().raw().toBuffer();
  const enlarged = await sharp(Buffer.from(exportModel('svg', model)), { density: 288 }).ensureAlpha().raw().toBuffer();
  assert.ok(errorMetrics(reference, enlarged, 512, 512).edgeError < 0.08, 'borda deve permanecer fiel em 4x');
  assert.equal(model.palette.length, 1, 'RGB de pixels semitransparentes não deve criar franjas de outra tinta');
});

test('remoção de fundo usa a borda, mesmo quando a arte ocupa a maior área', async () => {
  const data = Buffer.alloc(64 * 64 * 4, 255);
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    const i = (y * 64 + x) * 4; data[i] = 20; data[i + 1] = 70; data[i + 2] = 160;
  }
  const { model } = runPipeline({ width: 64, height: 64, data, params: { ...params, removeBg: true } });
  const pixels = await sharp(Buffer.from(exportModel('svg', model))).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(32 * 64 + 32) * 4 + 3], 255);
});

test('sela diagonal não conecta ilhas pelo peso de um único pixel', () => {
  // Two positive corners; arithmetic mean says connected, bilinear field does not.
  const fields = [[10, -1, -1, 0.01], [-1, 10, 0.01, -1], [0.01, -1, -1, 10]];
  for (const values of fields) assert.equal(extractLoops(Float32Array.from(values), 2, 2).length, 2);
});

test('imagem quase invisível produz orientação em vez de SVG vazio', () => {
  const data = Buffer.alloc(4 * 4 * 4, 64);
  assert.throws(() => runPipeline({ width: 4, height: 4, data, params }), { code: 'LOW_OPACITY' });
});

test('texto e curvas multicoloridas respeitam erro de borda em ampliação 4x', async () => {
  for (const [name, maxError] of [['small-type', 0.085], ['jpeg-type', 0.065], ['multicolor-curves', 0.068]]) {
    const fixture = cases.find(c => c.name === name);
    let source = sharp(Buffer.from(fixture.svg));
    if (fixture.jpeg) source = sharp(await source.jpeg({ quality: 72 }).toBuffer());
    const data = await source.ensureAlpha().raw().toBuffer();
    const { model } = runPipeline({ width: 128, height: 128, data, params });
    const original = await sharp(Buffer.from(fixture.svg), { density: 288 }).ensureAlpha().raw().toBuffer();
    const result = await sharp(Buffer.from(exportModel('svg', model)), { density: 288 }).ensureAlpha().raw().toBuffer();
    assert.ok(errorMetrics(original, result, 512, 512).edgeError < maxError, name);
  }
});
