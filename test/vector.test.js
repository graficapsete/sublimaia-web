'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { runPipeline, normalizeParams } = require('../src/lib/pipeline');
const { samplePixels } = require('../src/lib/color');
const { exportModel } = require('../src/lib/exporters');

const LOGO = { mode: 'color', colors: 12, upscale: 4, denoise: 0, sharpen: 0, autoContrast: false, detail: 1, smooth: 25, removeBg: false, antiGap: false };
function image(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = paint(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { width: w, height: h, data };
}
async function render(model) {
  return sharp(Buffer.from(exportModel('svg', model))).resize(model.width, model.height).ensureAlpha().raw().toBuffer();
}
function at(data, w, x, y) { return [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]; }
function foregroundF1(source, rendered, choose) {
  let expected = 0, actual = 0, match = 0;
  for (let i = 0; i < source.length; i += 4) {
    const a = choose(source, i), b = choose(rendered, i);
    expected += a; actual += b; match += a && b ? 1 : 0;
  }
  return 2 * match / (expected + actual);
}

test('traços de 1 a 4 px continuam no SVG renderizado', async () => {
  for (const thickness of [1, 2, 4]) {
    const source = image(64, 64, (x, y) => (x >= 30 && x < 30 + thickness) || (y >= 30 && y < 30 + thickness) ? [0, 0, 0] : [255, 255, 255]);
    const result = runPipeline({ ...source, params: LOGO });
    const pixels = await render(result.model);
    assert.ok(at(pixels, 64, 30, 16)[0] < 120, `traço vertical de ${thickness} px`);
    assert.ok(at(pixels, 64, 16, 30)[0] < 120, `traço horizontal de ${thickness} px`);
    assert.ok(foregroundF1(source.data, pixels, (d, i) => d[i] < 128) > 0.8, `sobreposição do traço de ${thickness} px`);
    assert.deepEqual(result.model.palette, [[255, 255, 255], [0, 0, 0]]);
  }
});

test('amostragem não perde cor rara em coluna fora do passo periódico', async () => {
  const source = image(800, 800, x => x === 1 ? [255, 0, 0] : [255, 255, 255]);
  const samples = samplePixels(source);
  assert.equal(samples.total, 640000);
  assert.ok([...samples.rgb].some((_, i) => i % 3 === 1 && samples.rgb[i] === 0));
  const result = runPipeline({ width: 800, height: 800, data: source.data, params: { ...LOGO, upscale: 1 } });
  assert.ok(result.model.palette.some(c => c[0] > 245 && c[1] < 10 && c[2] < 10));
  const pixels = await render(result.model);
  assert.ok(at(pixels, 800, 1, 400)[1] < 40, 'a cor rara deve sobreviver no SVG, não só na paleta');
});

test('logo JPEG de duas tintas mantém texto fino sem curvas explosivas', async () => {
  const source = image(240, 120, (x, y) => {
    const stroke = (x >= 35 && x <= 190 && y >= 33 && y <= 36) ||
      (x >= 35 && x <= 190 && y >= 43 && y <= 45) ||
      (x >= 35 && x <= 38 && y >= 33 && y <= 45) ||
      (x >= 187 && x <= 190 && y >= 33 && y <= 45);
    return stroke ? [242, 252, 226] : [103, 124, 105];
  });
  const jpeg = await sharp(Buffer.from(source.data), { raw: { width: 240, height: 120, channels: 4 } }).jpeg({ quality: 72 }).toBuffer();
  const pixels = await sharp(jpeg).ensureAlpha().raw().toBuffer();
  const result = runPipeline({ width: 240, height: 120, data: pixels, params: { ...LOGO, denoise: 1 } });
  assert.equal(result.stats.colors, 2);
  assert.equal(result.stats.factor, 1, 'contorno deve aproveitar cobertura original do JPEG');
  const output = await render(result.model);
  assert.ok(at(output, 240, 100, 34)[0] > 180);
  assert.ok(at(output, 240, 100, 39)[0] < 150, 'espaço interno deve permanecer aberto');
  assert.ok(at(output, 240, 100, 44)[0] > 180);
  for (const shape of result.model.shapes) for (const sp of shape.subpaths) {
    let previous = sp.start;
    for (const seg of sp.segs) {
      if (seg[0] === 'C') {
        const end = [seg[5], seg[6]];
        assert.ok(Math.hypot(seg[1] - previous[0], seg[2] - previous[1]) < 240);
        assert.ok(Math.hypot(seg[3] - end[0], seg[4] - end[1]) < 240);
      }
      previous = seg.slice(-2);
    }
  }
});

test('controle de espessura preserva configuração e altera somente a cobertura de logos de duas tintas', async () => {
  assert.equal(normalizeParams({ strokeBalance: 99 }).strokeBalance, 30);
  assert.equal(normalizeParams({ strokeBalance: -99 }).strokeBalance, -20);
  const source = image(96, 48, (x, y) => x >= 10 && x < 80 && y >= 22 && y < 24
    ? [235, 245, 220] : [100, 120, 103]);
  const jpeg = await sharp(Buffer.from(source.data), { raw: { width: 96, height: 48, channels: 4 } }).jpeg({ quality: 65 }).toBuffer();
  const data = await sharp(jpeg).ensureAlpha().raw().toBuffer();
  const thin = runPipeline({ width: 96, height: 48, data, params: { ...LOGO, strokeBalance: -20 } });
  const thick = runPipeline({ width: 96, height: 48, data, params: { ...LOGO, strokeBalance: 30 } });
  const a = await render(thin.model), b = await render(thick.model);
  const count = pixels => {
    let n = 0;
    for (let y = 16; y < 30; y++) for (let x = 6; x < 84; x++) {
      if (pixels[(y * 96 + x) * 4] > 170) n++;
    }
    return n;
  };
  assert.ok(count(b) > count(a), 'valor positivo deve recuperar cobertura em traços finos');
  assert.deepEqual(thin.model.palette, thick.model.palette);
});

test('furo, canto e borda transparente permanecem transparentes', async () => {
  const source = image(64, 64, (x, y) => x >= 8 && x < 56 && y >= 8 && y < 56 && !(x >= 25 && x < 39 && y >= 25 && y < 39)
    ? [20, 80, 180, 255] : [0, 0, 0, 0]);
  const result = runPipeline({ ...source, params: LOGO });
  const pixels = await render(result.model);
  assert.equal(at(pixels, 64, 0, 0)[3], 0);
  assert.equal(at(pixels, 64, 32, 32)[3], 0);
  assert.ok(at(pixels, 64, 12, 12)[3] > 200);
  assert.ok(at(pixels, 64, 51, 12)[3] > 200);
});

test('modos cinza e P&B preservam alfa, inclusive após limiar', async () => {
  const source = image(48, 48, (x, y) => x >= 6 && x < 42 && y >= 6 && y < 42 ? [30, 40, 60, 255] : [0, 0, 0, 0]);
  for (const mode of ['gray', 'bw']) {
    const result = runPipeline({ ...source, params: { ...LOGO, mode, colors: mode === 'bw' ? 2 : 8, removeBg: false } });
    const pixels = await render(result.model);
    assert.equal(at(pixels, 48, 0, 0)[3], 0, mode);
    assert.ok(at(pixels, 48, 24, 24)[3] > 200, mode);
  }
});

test('texto pequeno, ruído JPEG e exportações continuam válidos', async () => {
  const glyph = ['10001', '11011', '10101', '10101', '10001'];
  const source = image(80, 48, (x, y) => {
    const gx = Math.floor((x - 20) / 3), gy = Math.floor((y - 13) / 3);
    return gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && glyph[gy][gx] === '1' ? [0, 0, 0] : [255, 255, 255];
  });
  const jpeg = await sharp(source.data, { raw: { width: 80, height: 48, channels: 4 } }).jpeg({ quality: 65 }).toBuffer();
  const raw = await sharp(jpeg).ensureAlpha().raw().toBuffer();
  const result = runPipeline({ width: 80, height: 48, data: new Uint8ClampedArray(raw), params: { ...LOGO, denoise: 1 } });
  const pixels = await render(result.model);
  assert.ok(at(pixels, 80, 21, 14)[0] < 160);
  assert.ok(at(pixels, 80, 55, 35)[0] > 200);
  for (const format of ['svg', 'pdf', 'eps', 'dxf']) assert.ok(exportModel(format, result.model).length > 100, format);
});
