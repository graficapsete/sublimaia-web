'use strict';
// Sends only repository-owned synthetic artwork to the explicitly supplied site.
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { cases, params } = require('../test/fixtures/vector-quality');
const { runPipeline } = require('../src/lib/pipeline');
const { exportModel } = require('../src/lib/exporters');

async function main() {
  const base = process.argv[2]?.replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) throw new Error('Informe a URL da instalação a verificar.');
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  let exportId;
  for (const fixture of cases) {
    let input = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
    if (fixture.jpeg) input = await sharp(input).jpeg({ quality: 72 }).toBuffer();
    const data = await sharp(input).ensureAlpha().raw().toBuffer();
    const job = { width: 128, height: 128, data, params };
    const expected = exportModel('svg', runPipeline(job).model);
    const response = await fetch(base + '/api/vectorize', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ ...job, data: data.toString('base64') }) });
    assert.equal(response.status, 200, fixture.name);
    const result = await response.json();
    assert.equal(result.ok, true, fixture.name);
    assert.equal(result.svg, expected, `${fixture.name}: código publicado deve produzir o mesmo vetor validado localmente`);
    exportId = result.id;
    console.log(`${fixture.name}: OK (${result.stats.ms} ms no servidor)`);
  }
  // PNG is rendered by the browser canvas, not by /api/export.
  for (const format of ['svg', 'pdf', 'eps', 'dxf']) {
    const response = await fetch(`${base}/api/export/${exportId}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
    assert.equal(response.status, 200, format);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 100, format);
    assert.match(bytes.toString('utf8'), { svg: /<svg/, pdf: /^%PDF/, eps: /^%!PS/, dxf: /ENTITIES/ }[format]);
    console.log(`export ${format}: OK`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
