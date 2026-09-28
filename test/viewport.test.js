'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeViewport() {
  const rootEvents = {}, toolbarEvents = {};
  const surface = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture() {} };
  const makeImage = () => ({ style: {}, naturalWidth: 200, naturalHeight: 200, offsetWidth: 100, offsetHeight: 100, closest: () => surface, addEventListener() {} });
  const original = makeImage(), result = makeImage();
  const label = { textContent: '' };
  const toolbar = {
    hidden: true,
    className: '',
    setAttribute() {},
    querySelector: () => label,
    addEventListener: (name, handler) => { toolbarEvents[name] = handler; },
  };
  const classes = new Set();
  const root = {
    compare: false,
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
    append() {},
    addEventListener: (name, handler) => { rootEvents[name] = handler; },
    querySelectorAll: () => [original, result],
    querySelector(selector) {
      if (selector === '.compare:not([hidden])') return this.compare ? { querySelector: () => result } : null;
      if (selector === '.upscale-preview-wrap:not([hidden]) img') return original;
      return null;
    },
  };
  const context = { window: {}, document: { createElement: () => toolbar } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/viewport.js'), 'utf8'), context);
  const viewport = context.window.createImageViewport(root);
  const click = action => toolbarEvents.click({ target: { closest: () => ({ dataset: { zoom: action } }) } });
  return { root, toolbar, label, original, result, viewport, rootEvents, classes, click };
}

test('zoom reutilizável sincroniza original/resultado e mantém enquadramento após refresh', () => {
  for (const tab of ['upscale', 'background', 'halftone']) {
    const v = makeViewport();
    v.viewport.setEnabled(true);
    v.click('in');
    assert.equal(v.viewport.getState().zoom, 1.25, tab);
    assert.equal(v.original.style.transform, v.result.style.transform, tab);
    v.rootEvents.pointerdown({ target: v.original, button: 0, clientX: 50, clientY: 50, pointerId: 1, preventDefault() {} });
    v.rootEvents.pointermove({ pointerId: 1, clientX: 70, clientY: 60 });
    v.rootEvents.pointerup({ pointerId: 1 });
    assert.equal(v.viewport.getState().panX, 20, tab);
    assert.equal(v.viewport.getState().panY, 10, tab);
    v.root.compare = true;
    v.viewport.refresh();
    assert.equal(v.viewport.getState().zoom, 1.25, tab);
    assert.equal(v.original.style.transform, v.result.style.transform, tab);
    v.click('actual');
    assert.equal(v.viewport.getState().zoom, 2, tab);
    v.click('fit');
    assert.equal(JSON.stringify(v.viewport.getState()), JSON.stringify({ zoom: 1, panX: 0, panY: 0 }), tab);
    v.rootEvents.wheel({ target: v.result, deltaY: -100, clientX: 50, clientY: 50, preventDefault() {} });
    assert.ok(v.viewport.getState().zoom > 1, tab);
    v.viewport.reset();
    assert.equal(JSON.stringify(v.viewport.getState()), JSON.stringify({ zoom: 1, panX: 0, panY: 0 }), tab);
  }
});
