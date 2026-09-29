'use strict';
// Known vector originals let us measure reconstruction at 4x, not just JPEG noise.
const sharp = require('sharp');
const fs = require('node:fs');
const { runPipeline } = require('../src/lib/pipeline');
const { exportModel } = require('../src/lib/exporters');
const { cases, params, errorMetrics } = require('../test/fixtures/vector-quality');

async function main() {
  const report = [];
  for (const fixture of cases) {
    let input = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
    if (fixture.jpeg) input = await sharp(input).jpeg({ quality: 72 }).toBuffer();
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { model, stats } = runPipeline({ width: info.width, height: info.height, data, params });
    const result = Buffer.from(exportModel('svg', model));
    const render = source => sharp(source, { density: 288 }).ensureAlpha().raw().toBuffer();
    const metrics = errorMetrics(await render(Buffer.from(fixture.svg)), await render(result), 512, 512);
    report.push({ name: fixture.name, ...metrics, colors: stats.colors, paths: stats.paths, nodes: stats.nodes, ms: stats.ms });
  }
  console.table(report.map(row => ({ ...row, pixelError: +row.pixelError.toFixed(5), edgeError: +row.edgeError.toFixed(5) })));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
