'use strict';
/**
 * Exportadores. Todos partem do modelo vetorial de trace.js e não têm dependências
 * externas (só `zlib` do Node, para comprimir o stream do PDF).
 *
 * Curvas: o modelo usa segmentos retos (L), quadráticos (Q) e cúbicos (C). PDF/EPS só
 * têm Bézier cúbica, então Q é elevado a C sem perda. DXF não tem curvas simples em
 * R12, então Q/C são subdivididas em pequenos segmentos.
 */
const zlib = require('zlib');

const FORMATS = {
  svg: { ext: 'svg', label: 'SVG', mime: 'image/svg+xml' },
  pdf: { ext: 'pdf', label: 'PDF', mime: 'application/pdf' },
  eps: { ext: 'eps', label: 'EPS', mime: 'application/postscript' },
  dxf: { ext: 'dxf', label: 'DXF', mime: 'image/vnd.dxf' },
  png: { ext: 'png', label: 'PNG', mime: 'image/png' }, // gerado no renderer (canvas)
};

const n2 = (v) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};
const n4 = (v) => String(Math.round(v * 10000) / 10000);
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Quadrática -> cúbica: mesma curva, sem perda. */
function quadToCubic(x0, y0, cx, cy, x, y) {
  return [
    x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0),
    x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y),
    x, y,
  ];
}

// ------------------------------------------------------------------- SVG ---

function pathD(subpaths) {
  const out = [];
  for (const sp of subpaths) {
    let s = `M${n2(sp.start[0])} ${n2(sp.start[1])}`;
    for (const seg of sp.segs) {
      if (seg[0] === 'L') s += `L${n2(seg[1])} ${n2(seg[2])}`;
      else if (seg[0] === 'C') s += `C${n2(seg[1])} ${n2(seg[2])} ${n2(seg[3])} ${n2(seg[4])} ${n2(seg[5])} ${n2(seg[6])}`;
      else s += `Q${n2(seg[1])} ${n2(seg[2])} ${n2(seg[3])} ${n2(seg[4])}`;
    }
    out.push(s + 'Z');
  }
  return out.join('');
}

/**
 * @param opts.outline  desenha só os contornos (pré-visualização de nós/formas)
 */
function toSVG(model, opts = {}) {
  const { width, height, shapes, stroke = 0 } = model;
  const head =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`;
  const parts = [head];

  if (opts.outline) {
    parts.push(`<g fill="none" stroke="#4d8dff" stroke-width="1" stroke-linejoin="round">\n`);
    for (const sh of shapes) {
      parts.push(`<path vector-effect="non-scaling-stroke" d="${pathD(sh.subpaths)}"/>\n`);
    }
    parts.push('</g>\n</svg>\n');
    return parts.join('');
  }

  parts.push(
    stroke > 0
      ? `<g fill-rule="evenodd" stroke-width="${n4(stroke)}" stroke-linejoin="round">\n`
      : `<g fill-rule="evenodd">\n`
  );
  for (const sh of shapes) {
    const c = hex(sh.fill);
    parts.push(
      stroke > 0
        ? `<path fill="${c}" stroke="${c}" d="${pathD(sh.subpaths)}"/>\n`
        : `<path fill="${c}" d="${pathD(sh.subpaths)}"/>\n`
    );
  }
  parts.push('</g>\n</svg>\n');
  return parts.join('');
}

// ------------------------------------------------------------------- PDF ---

function toPDF(model) {
  const { width, height, shapes, stroke = 0 } = model;
  // 96 dpi (1 px = 0,75 pt). Limite de página do Acrobat: 14400 pt.
  const k = Math.min(0.75, 14400 / Math.max(width, height));
  const W = width * k, H = height * k;

  const c = [];
  c.push(`${n4(k)} 0 0 ${n4(-k)} 0 ${n4(H)} cm`); // origem no topo-esquerdo, unidades em px
  if (stroke > 0) c.push(`${n4(stroke)} w 1 j`);

  for (const sh of shapes) {
    const [r, g, b] = sh.fill.map((v) => n4(v / 255));
    c.push(`${r} ${g} ${b} rg`);
    if (stroke > 0) c.push(`${r} ${g} ${b} RG`);
    for (const sp of sh.subpaths) {
      let cx = sp.start[0], cy = sp.start[1];
      c.push(`${n2(cx)} ${n2(cy)} m`);
      for (const seg of sp.segs) {
        if (seg[0] === 'L') {
          c.push(`${n2(seg[1])} ${n2(seg[2])} l`);
          cx = seg[1];
          cy = seg[2];
        } else if (seg[0] === 'C') {
          c.push(seg.slice(1, 7).map(n2).join(' ') + ' c');
          cx = seg[5];
          cy = seg[6];
        } else {
          const b3 = quadToCubic(cx, cy, seg[1], seg[2], seg[3], seg[4]);
          c.push(b3.map(n2).join(' ') + ' c');
          cx = seg[3];
          cy = seg[4];
        }
      }
      c.push('h');
    }
    c.push(stroke > 0 ? 'B*' : 'f*'); // even-odd: buracos funcionam
  }

  const stream = zlib.deflateSync(Buffer.from(c.join('\n') + '\n', 'latin1'));
  const bodies = [
    null,
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Contents 4 0 R /Resources << >> >>`,
      'latin1'
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.from('<< /Producer (SublimaIa) /Creator (SublimaIa) >>', 'latin1'),
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  for (let i = 1; i < bodies.length; i++) {
    offsets[i] = offset;
    const obj = Buffer.concat([Buffer.from(`${i} 0 obj\n`, 'latin1'), bodies[i], Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(obj);
    offset += obj.length;
  }
  let xref = `xref\n0 ${bodies.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < bodies.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size ${bodies.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------- EPS ---

function toEPS(model) {
  const { width, height, shapes, stroke = 0 } = model;
  const k = 0.75;
  const W = width * k, H = height * k;
  const L = [];
  L.push('%!PS-Adobe-3.0 EPSF-3.0');
  L.push(`%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`);
  L.push(`%%HiResBoundingBox: 0 0 ${n2(W)} ${n2(H)}`);
  L.push('%%Creator: SublimaIa');
  L.push('%%Pages: 1');
  L.push('%%LanguageLevel: 2');
  L.push('%%EndComments');
  L.push('%%BeginProlog');
  L.push('/m {moveto} bind def');
  L.push('/l {lineto} bind def');
  L.push('/c {curveto} bind def');
  L.push('/h {closepath} bind def');
  L.push('%%EndProlog');
  L.push('%%Page: 1 1');
  L.push('gsave');
  L.push(`[${n4(k)} 0 0 ${n4(-k)} 0 ${n2(H)}] concat`);
  if (stroke > 0) L.push(`${n4(stroke)} setlinewidth 1 setlinejoin`);

  for (const sh of shapes) {
    const [r, g, b] = sh.fill.map((v) => n4(v / 255));
    L.push(`${r} ${g} ${b} setrgbcolor`);
    L.push('newpath');
    for (const sp of sh.subpaths) {
      let cx = sp.start[0], cy = sp.start[1];
      L.push(`${n2(cx)} ${n2(cy)} m`);
      for (const seg of sp.segs) {
        if (seg[0] === 'L') {
          L.push(`${n2(seg[1])} ${n2(seg[2])} l`);
          cx = seg[1];
          cy = seg[2];
        } else if (seg[0] === 'C') {
          L.push(seg.slice(1, 7).map(n2).join(' ') + ' c');
          cx = seg[5];
          cy = seg[6];
        } else {
          L.push(quadToCubic(cx, cy, seg[1], seg[2], seg[3], seg[4]).map(n2).join(' ') + ' c');
          cx = seg[3];
          cy = seg[4];
        }
      }
      L.push('h');
    }
    if (stroke > 0) L.push('gsave eofill grestore stroke');
    else L.push('eofill');
  }
  L.push('grestore');
  L.push('showpage');
  L.push('%%EOF');
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------- DXF ---

/** Tabela ACI (AutoCAD Color Index) gerada algoritmicamente. */
function buildACI() {
  const t = [];
  t[1] = [255, 0, 0]; t[2] = [255, 255, 0]; t[3] = [0, 255, 0]; t[4] = [0, 255, 255];
  t[5] = [0, 0, 255]; t[6] = [255, 0, 255]; t[7] = [255, 255, 255];
  t[8] = [128, 128, 128]; t[9] = [192, 192, 192];
  const levels = [255, 189, 129, 104, 79];
  const hsv = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  for (let hue = 0; hue < 24; hue++) {
    for (let k = 0; k < 10; k++) {
      const v = levels[k >> 1] / 255;
      const s = k % 2 === 0 ? 1 : 1 / 3;
      t[10 + hue * 10 + k] = hsv(hue * 15, s, v);
    }
  }
  [51, 91, 132, 173, 214, 255].forEach((g, i) => (t[250 + i] = [g, g, g]));
  return t;
}
let ACI = null;
function nearestACI(rgb) {
  if (!ACI) ACI = buildACI();
  let best = 7, bestD = Infinity;
  for (let i = 1; i <= 255; i++) {
    const c = ACI[i];
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * DXF R12 (AC1009): máxima compatibilidade (AutoCAD, LibreCAD, CNC, laser).
 * Cada cor vira uma layer "COR_RRGGBB"; contornos fechados (POLYLINE).
 * R12 só tem cores indexadas (ACI), então a cor da layer é a mais próxima;
 * o valor exato fica no nome da layer.
 */
function toDXF(model, opts = {}) {
  const { width, height, shapes } = model;
  const steps = opts.curveSteps || 8;
  const out = [];
  const g = (code, val) => out.push(String(code), String(val));
  const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

  const layers = shapes.map((sh) => ({
    name: 'COR_' + sh.fill.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(),
    aci: nearestACI(sh.fill),
  }));

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Math.max(1, layers.length));
  for (const l of layers) {
    g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.aci); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  shapes.forEach((sh, idx) => {
    const layer = layers[idx].name;
    for (const sp of sh.subpaths) {
      const pts = [[sp.start[0], sp.start[1]]];
      let cx = sp.start[0], cy = sp.start[1];
      for (const seg of sp.segs) {
        if (seg[0] === 'L') {
          pts.push([seg[1], seg[2]]);
          cx = seg[1];
          cy = seg[2];
        } else if (seg[0] === 'C') {
          for (let i = 1; i <= steps; i++) {
            const t = i / steps, u = 1 - t;
            const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
            pts.push([
              b0 * cx + b1 * seg[1] + b2 * seg[3] + b3 * seg[5],
              b0 * cy + b1 * seg[2] + b2 * seg[4] + b3 * seg[6],
            ]);
          }
          cx = seg[5];
          cy = seg[6];
        } else {
          for (let i = 1; i <= steps; i++) {
            const t = i / steps, u = 1 - t;
            pts.push([
              u * u * cx + 2 * u * t * seg[1] + t * t * seg[3],
              u * u * cy + 2 * u * t * seg[2] + t * t * seg[4],
            ]);
          }
          cx = seg[3];
          cy = seg[4];
        }
      }
      const first = pts[0], last = pts[pts.length - 1];
      if (pts.length > 1 && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) pts.pop();
      if (pts.length < 3) continue;
      g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, 1);
      for (const p of pts) {
        g(0, 'VERTEX'); g(8, layer); g(10, f(p[0])); g(20, f(height - p[1])); g(30, '0.000');
      }
      g(0, 'SEQEND'); g(8, layer);
    }
  });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}

/** Ponto de entrada. PNG é gerado no renderer (canvas). */
function exportModel(format, model, options = {}) {
  switch (format) {
    case 'svg': return toSVG(model, options);
    case 'pdf': return toPDF(model, options);
    case 'eps': return toEPS(model, options);
    case 'dxf': return toDXF(model, options);
    default: throw new Error(`Formato não suportado: ${format}`);
  }
}

module.exports = { FORMATS, exportModel, toSVG, toPDF, toEPS, toDXF, nearestACI, buildACI };
