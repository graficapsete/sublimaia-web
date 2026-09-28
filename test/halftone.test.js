'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { processHalftone } = require('../src/halftone');

function payload(data, overrides = {}) {
  return { data: data.toString('base64'), name: 'gradiente.png', shirt: 'white', color: '#31558a', widthCm: 2, dpi: 150, lpi: 35, angle: 22, shape: 'circle', contrast: 1, intensity: 1, minDot: 1, ...overrides };
}

async function fixture() {
  const width = 96, height = 64, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = Math.round(x / (width - 1) * 255);
    pixels[i + 1] = Math.round((1 - x / (width - 1)) * 180);
    pixels[i + 2] = Math.round(y / (height - 1) * 255);
    pixels[i + 3] = x < 8 || x > 87 || y < 6 || y > 57 ? 0 : x === 8 || x === 87 ? 128 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test('quatro camisas, degradê, alfa, dimensões e densidade de impressão', async () => {
  const data = await fixture();
  const outputs = [];
  for (const shirt of ['white', 'light', 'colored', 'black']) {
    const { png, width, height } = await processHalftone(payload(data, { shirt }));
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png'); assert.equal(meta.hasAlpha, true);
    assert.equal(meta.width, width); assert.equal(meta.height, height);
    assert.equal(width, Math.round(2 / 2.54 * 150));
    assert.equal(height, Math.round(width * 64 / 96));
    assert.ok(Math.abs(meta.density - 150) <= 1);
    const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
    const alpha = []; const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      alpha.push(pixels[i + 3]);
      if (pixels[i + 3] > 0) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    assert.ok(alpha.includes(0)); assert.ok(alpha.some(a => a > 0));
    assert.ok(alpha.some(a => a > 0 && a < 255));
    assert.ok(colors.size > 20, 'as cores originais são preservadas');
    outputs.push(png);
  }
  assert.notDeepEqual(outputs[0], outputs[3], 'a cor da camisa altera a distribuição dos pontos');
});

test('prévia limitada e formatos de ponto diferentes', async () => {
  const data = await fixture();
  const circle = await processHalftone(payload(data, { preview: true }));
  const square = await processHalftone(payload(data, { preview: true, shape: 'square' }));
  assert.notDeepEqual(circle.png, square.png);
  assert.ok(circle.width * circle.height <= 1_000_000);
});

test('orienta a remover fundo quando a imagem não tem transparência', async () => {
  const opaque = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(processHalftone(payload(opaque)), { code: 'TRANSPARENCY_REQUIRED', status: 422 });
});

test('limites de entrada e saída retornam mensagem clara', async () => {
  const data = await fixture();
  await assert.rejects(processHalftone(payload(data, { widthCm: 50, dpi: 600 })), { code: 'OUTPUT_TOO_LARGE', status: 413 });
  await assert.rejects(processHalftone(payload(data, { data: 'x'.repeat(17_000_000) })), { code: 'INPUT_TOO_LARGE', status: 413 });
});
