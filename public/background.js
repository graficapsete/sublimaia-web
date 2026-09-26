'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const state = { file: null, url: null, output: null };
  const input = $('#bg-file');
  const labels = ['Desligada', 'Suave', 'Média', 'Forte'];

  function updateLabels() {
    $('#bg-tolerance-out').textContent = $('#bg-tolerance').value + '%';
    $('#bg-softness-out').textContent = $('#bg-softness').value + ' px';
    $('#bg-clean-out').textContent = labels[Number($('#bg-clean').value)];
  }
  function choose(file) {
    if (!file) return;
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = file; state.url = URL.createObjectURL(file); state.output = null;
    $('#bg-preview-image').src = state.url; $('#bg-preview-wrap').hidden = false; $('#bg-empty').hidden = true;
    $('#bg-info').textContent = file.name; $('#bg-run').disabled = false; $('#bg-download').disabled = true; $('#bg-status').textContent = '';
  }
  $('#bg-open').addEventListener('click', () => input.click());
  $('#bg-open-empty').addEventListener('click', () => input.click());
  input.addEventListener('change', () => choose(input.files[0]));
  $('#bg-mode').addEventListener('change', (e) => { $('#bg-color-row').hidden = e.target.value !== 'manual'; });
  ['#bg-tolerance', '#bg-softness', '#bg-clean'].forEach((s) => $(s).addEventListener('input', updateLabels));
  window.addEventListener('dragover', (e) => { if (!$('#bg-app').hidden) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!$('#bg-app').hidden) { e.preventDefault(); choose(e.dataTransfer.files[0]); } });

  $('#bg-run').addEventListener('click', async () => {
    if (!state.file) return;
    const button = $('#bg-run'); const status = $('#bg-status'); button.disabled = true; status.textContent = 'Removendo fundo e limpando contorno…';
    try {
      const bytes = new Uint8Array(await state.file.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const payload = { data: btoa(binary), name: state.file.name, mode: $('#bg-mode').value, color: $('#bg-color').value, tolerance: Number($('#bg-tolerance').value), softness: Number($('#bg-softness').value), clean: Number($('#bg-clean').value), preserveAlpha: $('#bg-preserve-alpha').checked };
      const response = await fetch('/api/remove-background', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      state.output = await response.blob(); $('#bg-preview-image').src = URL.createObjectURL(state.output); $('#bg-download').disabled = false; status.textContent = 'Fundo removido. Confira o contorno e baixe o PNG transparente.';
    } catch (err) { status.textContent = 'Não foi possível remover o fundo: ' + (err.message || err); }
    finally { button.disabled = false; }
  });
  $('#bg-download').addEventListener('click', () => {
    if (!state.output) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(state.output); a.download = (state.file.name.replace(/\.[^.]+$/, '') || 'imagem') + '-sem-fundo.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
  updateLabels();
})();
