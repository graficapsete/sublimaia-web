'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

const params = { mode: 'color', colors: 4, upscale: 1, denoise: 0, sharpen: 0, detail: 1, smooth: 25, removeBg: false, antiGap: false };
const tiny = Buffer.alloc(16 * 16 * 4, 255);
for (let y = 2; y < 14; y++) {
  const i = (y * 16 + 8) * 4;
  tiny[i] = tiny[i + 1] = tiny[i + 2] = 0;
}
function payload(width, height, data, options = params) {
  return JSON.stringify({ width, height, origWidth: width, origHeight: height, data: data.toString('base64'), params: options });
}

test('API de vetorização mantém resposta/exportação e rejeita imagens acima de 8 MP', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/api/vectorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(16, 16, tiny) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.match(result.svg, /<svg/);
    assert.ok(result.id);
    const exported = await fetch(base + '/api/export/' + result.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'pdf' }) });
    assert.equal(exported.status, 200);
    assert.match(await exported.text(), /^%PDF/);
    const overLimit = await fetch(base + '/api/vectorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(3000, 3000, tiny) });
    assert.equal(overLimit.status, 413);
    assert.equal((await overLimit.json()).errorCode, 'IMAGE_TOO_LARGE');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('worker deixa /health livre, limita concorrência e libera após cancelamento', { timeout: 30000 }, async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const width = 1000, height = 1000;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = x & 255; pixels[i + 1] = y & 255; pixels[i + 2] = (x + y) & 255; pixels[i + 3] = 255;
  }
  const abort = new AbortController();
  try {
    const first = fetch(base + '/api/vectorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(width, height, pixels, { ...params, colors: 16, upscale: 2 }), signal: abort.signal }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 150));
    const health = await fetch(base + '/health');
    assert.deepEqual(await health.json(), { ok: true });
    const busy = await fetch(base + '/api/vectorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(16, 16, tiny) });
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).errorCode, 'BUSY');
    abort.abort();
    await first;
    let recovered = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(base + '/api/vectorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(16, 16, tiny) });
      if (response.status === 200) { recovered = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(recovered, 'o worker deve terminar e liberar outra vetorização');
  } finally {
    abort.abort();
    await new Promise(resolve => server.close(resolve));
  }
});
