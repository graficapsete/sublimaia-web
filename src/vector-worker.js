'use strict';
const { parentPort, workerData } = require('worker_threads');
const { runPipeline } = require('./lib/pipeline');
const { exportModel } = require('./lib/exporters');

try {
  const result = runPipeline({ ...workerData, data: new Uint8ClampedArray(workerData.data) });
  const svg = exportModel('svg', result.model);
  if (result.stats.nodes > 200000 || Buffer.byteLength(svg) > 25 * 1024 * 1024) {
    const error = new Error('O vetor ficou complexo demais. Reduza o número de cores ou aumente a limpeza de manchas.');
    error.code = 'VECTOR_TOO_COMPLEX';
    throw error;
  }
  parentPort.postMessage({ model: result.model, stats: result.stats, svg });
} catch (err) {
  parentPort.postMessage({ error: err.message || String(err), errorCode: err.code || 'PROCESSING_ERROR' });
}
