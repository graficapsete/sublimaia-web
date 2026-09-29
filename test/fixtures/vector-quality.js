'use strict';

const params = { mode: 'color', colors: 12, upscale: 4, denoise: 0, sharpen: 0,
  autoContrast: false, detail: 1, smooth: 15, strokeBalance: 0, removeBg: false, antiGap: false };
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${body}</svg>`;
const cases = [
  { name: 'intentional-gray', svg: svg('<path fill="white" d="M0 0h128v128H0z"/><path d="M0 0h60v128H0z"/><path fill="#808080" d="M85 40h20v30H85z"/>') },
  { name: 'near-white-colors', svg: svg('<path fill="#faf5f0" d="M0 0h128v128H0z"/><path fill="#ffffff" d="M10 10h40v108H10z"/><path fill="#101820" d="M70 20h40v80H70z"/>') },
  { name: 'tiny-dots', svg: svg('<path fill="white" d="M0 0h128v128H0z"/><path d="M20 20h1v1h-1z M40 20h2v2h-2z M65 20h3v3h-3z M20 40h80v1H20z M20 60h80v2H20z"/>') },
  { name: 'transparent-curves', svg: svg('<path fill="#d52b36" fill-rule="evenodd" d="M64 12.3a51.7 51.7 0 1 1 0 103.4a51.7 51.7 0 1 1 0-103.4 M64 24.7a39.3 39.3 0 1 0 0 78.6a39.3 39.3 0 1 0 0-78.6"/>') },
  { name: 'opaque-curves', svg: svg('<path fill="#677c69" d="M0 0h128v128H0z"/><circle cx="64" cy="64" r="43.7" fill="#f2fce2"/><circle cx="64" cy="64" r="39.3" fill="#677c69"/>') },
  { name: 'multicolor-curves', svg: svg('<path fill="white" d="M0 0h128v128H0z"/><circle cx="42.3" cy="45.7" r="31.2" fill="#ea3038"/><circle cx="87.7" cy="77.4" r="30.6" fill="#185aca"/><path fill="#f4b824" d="M10.2 109.7L29.4 71.2L52.6 109.7z"/>') },
  { name: 'small-type', svg: svg('<path fill="#677c69" d="M0 0h128v128H0z"/><g fill="none" stroke="#f2fce2" stroke-width="1.4"><path d="M8 44V26h8a4 4 0 0 1 0 8H8m20 10V26h8a4 4 0 0 1 0 8h-8m6 0l8 10 M51 26v18m10 0V26l11 18V26 M81 26h16m-8 0v18 M107 26v18h13"/><circle cx="34" cy="72" r="8.3"/><path d="M60 81V63h7a4 4 0 0 1 0 8h-7m22 10V63l10 18V63"/></g>') },
  { name: 'jpeg-type', jpeg: true, svg: svg('<path fill="#677c69" d="M0 0h128v128H0z"/><g fill="none" stroke="#f2fce2" stroke-width="2"><path d="M12 46V20h11a6 6 0 0 1 0 12H12m13 0l9 14 M46 20v26 M60 46V20l15 26V20 M86 20h26m-13 0v26"/><circle cx="32" cy="82" r="13.2"/><path d="M61 96V68h12a7 7 0 0 1 0 14H61 M100 68v28"/></g>') },
];

// Compare premultiplied colors; RGB hidden under alpha=0 has no visual meaning.
function errorMetrics(expected, actual, width, height) {
  let total = 0, edge = 0, edgePixels = 0;
  const channel = (d, p, c) => c === 3 ? d[p + 3] : d[p + c] * d[p + 3] / 255;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    let error = 0, contrast = 0;
    for (let c = 0; c < 4; c++) {
      error += Math.abs(channel(expected, p, c) - channel(actual, p, c));
      for (const q of [x > 0 ? p - 4 : p, x + 1 < width ? p + 4 : p,
        y > 0 ? p - width * 4 : p, y + 1 < height ? p + width * 4 : p]) {
        contrast = Math.max(contrast, Math.abs(channel(expected, p, c) - channel(expected, q, c)));
      }
    }
    total += error;
    if (contrast >= 8) { edge += error; edgePixels++; }
  }
  return { pixelError: total / (width * height * 4 * 255), edgeError: edgePixels ? edge / (edgePixels * 4 * 255) : 0 };
}

module.exports = { cases, params, errorMetrics };
