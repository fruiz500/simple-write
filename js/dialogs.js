/* Simple Write: dialogs */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$;
  const dlg = SW.dlg = {};
  const ed = () => SW.ed;

  function show(d) {
    return new Promise((res) => {
      d.returnValue = '';
      d.addEventListener('close', () => res(d.returnValue), { once: true });
      d.showModal();
    });
  }
  // Enter in a one-line field means OK (the first button in the markup is Cancel)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const d = e.target.closest && e.target.closest('dialog.dlg');
    if (!d) return;
    if ((e.target.nodeName === 'INPUT' && /^(text|search|number)$/.test(e.target.type)) || (e.target.nodeName === 'TEXTAREA' && (e.ctrlKey || e.metaKey))) {
      if (e.target.id === 'rp-find' || e.target.id === 'rp-with') { e.preventDefault(); $('rp-next').click(); return; }
      if (d.querySelector('button[value="ok"]')) { e.preventDefault(); d.close('ok'); }
    }
  });
  const uniqueId = (prefix, text) => {
    const root = ed().root();
    let base = prefix + ':' + (SW.slug(text || '').slice(0, 24).replace(/-+$/, '') || '');
    if (base.endsWith(':')) { let n = 1; while (root.querySelector('[data-id="' + prefix + ':' + n + '"]')) n++; return prefix + ':' + n; }
    let id = base, n = 2;
    while (root.querySelector('[data-id="' + CSS.escape(id) + '"]')) id = base + '-' + n++;
    return id;
  };
  dlg.uniqueId = uniqueId;

  /* ---------- generic: question, list ---------- */
  dlg.ask = async function (title, text, buttons, input) {
    $('ask-title').textContent = title;
    $('ask-text').textContent = text || '';
    const inp = $('ask-input');
    inp.hidden = input === undefined; inp.value = input || '';
    const box = $('ask-btns'); box.innerHTML = '';
    (buttons || [{ label: 'OK', value: 'ok', primary: true }]).forEach((b) => {
      const el = document.createElement('button'); el.type = 'submit'; el.value = b.value; el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      box.appendChild(el);
    });
    if (!input && input !== '') setTimeout(() => { const p = box.querySelector('.primary'); if (p) p.focus(); }, 0);
    const v = await show($('dlg-ask'));
    return input !== undefined ? (v === 'ok' ? inp.value : null) : v;
  };
  dlg.list = async function (title, hint, items) {
    $('list-title').textContent = title; $('list-hint').textContent = hint || '';
    const box = $('list-items'); box.innerHTML = '';
    if (!items.length) box.innerHTML = '<div class="empty-note">Nothing here yet.</div>';
    const d = $('dlg-list');
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'pick-item';
      row.innerHTML = '<span class="t"></span><span class="k"></span><span class="acts"></span>';
      row.querySelector('.t').textContent = it.label;
      row.querySelector('.k').textContent = it.sub || '';
      for (const a of it.actions || []) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label;
        b.addEventListener('click', async (e) => { e.stopPropagation(); const close = await a.run(row); if (close !== false) d.close('done'); });
        row.querySelector('.acts').appendChild(b);
      }
      if (it.run) row.addEventListener('click', () => { d.close('done'); it.run(); });
      box.appendChild(row);
    }
    return show(d);
  };

  /* ---------- equation ---------- */
  const PAL = {
    'Structures': ['\\frac{#?}{}|\\frac{a}{b}', '^{#?}|x^{n}', '_{#?}|x_{i}', '_{#?}^{}|x_{i}^{n}', '\\sqrt{#?}|\\sqrt{x}', '\\sqrt[#?]{}|\\sqrt[n]{x}', '\\sum_{#?}^{}|\\sum_{i}^{n}', '\\prod_{#?}^{}|\\prod_{i}^{n}', '\\int_{#?}^{} \\, d|\\int_a^b', '\\oint #?|\\oint', '\\lim_{#?}|\\lim_{x\\to a}', '\\frac{d#?}{dx}|\\frac{dy}{dx}', '\\frac{\\partial #?}{\\partial x}|\\frac{\\partial f}{\\partial x}', '\\left( #? \\right)|\\left(x\\right)', '\\left[ #? \\right]|\\left[x\\right]', '\\left\\vert #? \\right\\vert|\\left\\vert x\\right\\vert', '\\left\\{ #? \\right\\}|\\left\\{x\\right\\}', '\\binom{#?}{}|\\binom{n}{k}', '\\begin{pmatrix} #? & \\\\ & \\end{pmatrix}|\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\begin{bmatrix} #? & \\\\ & \\end{bmatrix}|\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}', '\\begin{cases} #? & \\text{if } \\\\ & \\text{otherwise} \\end{cases}|\\begin{cases}a\\\\b\\end{cases}', '\\begin{aligned} #? &= \\\\ &= \\end{aligned}|\\begin{aligned}a&=b\\\\&=c\\end{aligned}', '\\text{#?}|\\text{abc}', '\\overset{#?}{}|\\overset{a}{=}', '\\underbrace{#?}_{}|\\underbrace{ab}_{n}', '\\boxed{#?}|\\boxed{x}'],
    'Greek': 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ').map((g) => '\\' + g + ' |\\' + g),
    'Operators': '\\pm \\mp \\times \\cdot \\div \\ast \\circ \\bullet \\nabla \\partial \\infty \\propto \\sum \\prod \\int \\iint \\iiint \\oint \\cup \\cap \\wedge \\vee \\neg \\forall \\exists \\in \\notin \\subset \\subseteq \\emptyset \\angle \\perp \\parallel \\ell \\hbar \\Re \\Im \\aleph \\ldots \\cdots \\vdots \\ddots'.split(' ').map((s) => s + ' |' + s),
    'Relations, arrows': '= \\ne \\approx \\equiv \\sim \\simeq \\cong < > \\le \\ge \\ll \\gg \\to \\leftarrow \\leftrightarrow \\Rightarrow \\Leftarrow \\Leftrightarrow \\uparrow \\downarrow \\mapsto \\rightleftharpoons \\longrightarrow \\xrightarrow{}'.split(' ').map((s) => s + ' |' + s),
    'Accents, fonts': ['\\hat{#?}|\\hat{x}', '\\bar{#?}|\\bar{x}', '\\overline{#?}|\\overline{xy}', '\\vec{#?}|\\vec{v}', '\\dot{#?}|\\dot{m}', '\\ddot{#?}|\\ddot{x}', '\\tilde{#?}|\\tilde{x}', '\\underline{#?}|\\underline{x}', '\\mathrm{#?}|\\mathrm{Re}', '\\mathbf{#?}|\\mathbf{F}', '\\boldsymbol{#?}|\\boldsymbol{\\tau}', '\\mathit{#?}|\\mathit{x}', '\\mathcal{#?}|\\mathcal{L}', '\\mathbb{#?}|\\mathbb{R}', '\\operatorname{#?}|\\operatorname{erf}', '\\sin #?|\\sin', '\\cos #?|\\cos', '\\tan #?|\\tan', '\\ln #?|\\ln', '\\log #?|\\log', '\\exp #?|\\exp', '\\sinh #?|\\sinh', '\\cosh #?|\\cosh', '\\tanh #?|\\tanh', '\\max #?|\\max', '\\min #?|\\min'],
    'Engineering': ['\\dot{m}|\\dot{m}', '\\dot{Q}|\\dot{Q}', '\\dot{W}|\\dot{W}', '\\dot{V}|\\dot{V}', '\\Delta #?|\\Delta x', 'c_p|c_p', 'c_v|c_v', '\\eta_{\\text{th}}|\\eta_{\\text{th}}', '\\mathrm{Re}|\\mathrm{Re}', '\\mathrm{Nu}|\\mathrm{Nu}', '\\mathrm{Pr}|\\mathrm{Pr}', '\\mathrm{Bi}|\\mathrm{Bi}', '\\overline{h}|\\overline{h}', '\\frac{dT}{dx}|\\frac{dT}{dx}', '\\frac{\\partial T}{\\partial t}|\\frac{\\partial T}{\\partial t}', '\\nabla^2 T|\\nabla^2 T', '\\,\\mathrm{kJ/kg}|\\mathrm{kJ/kg}', '\\,\\mathrm{kW}|\\mathrm{kW}', '\\,\\mathrm{kPa}|\\mathrm{kPa}', '\\,\\mathrm{W/m^2K}|\\mathrm{W/m^2K}', '^\\circ\\mathrm{C}|^\\circ\\mathrm{C}', '\\,\\mathrm{K}|\\mathrm{K}', '\\sigma T^4|\\sigma T^4', '\\rho V A|\\rho V A']
  };
  let eqTab = 'Structures', eqObj = null;
  function renderPalette() {
    $('eq-tabs').innerHTML = '';
    for (const t of Object.keys(PAL)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; if (t === eqTab) b.className = 'on';
      b.addEventListener('click', () => { eqTab = t; renderPalette(); });
      $('eq-tabs').appendChild(b);
    }
    const box = $('eq-palette'); box.innerHTML = '';
    for (const item of PAL[eqTab]) {
      const [ins, show] = item.split('|');
      const b = document.createElement('button'); b.type = 'button'; b.title = ins.replace('#?', '');
      try { b.innerHTML = katex.renderToString(show, { throwOnError: false }); } catch (e) { b.textContent = show; }
      b.addEventListener('click', () => insertTex(ins));
      box.appendChild(b);
    }
  }
  function insertTex(snippet) {
    const ta = $('eq-tex');
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
    let text = snippet, caret = snippet.indexOf('#?');
    if (caret >= 0) { text = snippet.replace('#?', sel); caret += sel.length; } else caret = text.length;
    ta.focus();
    ta.setSelectionRange(s, e);
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, s, e, 'end');
    ta.setSelectionRange(s + caret, s + caret);
    eqPreview();
  }
  function eqPreview() {
    const tex = $('eq-tex').value;
    const display = $('eq-display').checked;
    const box = $('eq-preview');
    if (!tex.trim()) { box.innerHTML = '<span class="hint">The equation appears here as you type.</span>'; return; }
    try { box.innerHTML = katex.renderToString(tex + (display && $('eq-number').checked ? ' \\tag{n}' : ''), { displayMode: display, throwOnError: true, strict: false }); }
    catch (err) { box.innerHTML = '<span style="color:#c00"></span>'; box.firstChild.textContent = String(err.message || err).replace(/^KaTeX parse error: /, ''); }
  }
  function eqNumberState() {
    const num = $('eq-number');
    num.disabled = !$('eq-display').checked;
    if (num.disabled) num.checked = false;
    $('eq-label').disabled = !num.checked;
    if (num.checked && !$('eq-label').value) $('eq-label').value = uniqueId('eq', '');
  }
  $('eq-tex').addEventListener('input', eqPreview);
  $('eq-display').addEventListener('change', () => { eqNumberState(); eqPreview(); });
  $('eq-number').addEventListener('change', () => { eqNumberState(); eqPreview(); });
  $('eq-tex').addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
    let tex = null;
    if (html) {
      const r = SW.normalizeHtml(html);
      const ms = [...r.body.querySelectorAll('.math[data-tex]')];
      if (ms.length) tex = ms.map((m) => m.getAttribute('data-tex')).join(' ');
    }
    if (tex === null && /^\s*<math[\s>]/i.test(text)) tex = SW.mmlStringToTex(text);
    if (tex === null && /^\s*\$\$?[\s\S]*\$\$?\s*$/.test(text)) tex = text.trim().replace(/^\$\$?|\$\$?$/g, '').trim();
    if (tex !== null) { e.preventDefault(); document.execCommand('insertText', false, tex); eqPreview(); }
  });
  dlg.equation = async function (o) {
    eqObj = o && o.classList && o.classList.contains('math') ? o : null;
    const sel = eqObj ? '' : ed().selectionText();
    const r = ed().saved, blk = r && ed().topBlock(r.startContainer);
    $('eq-tex').value = eqObj ? eqObj.dataset.tex : sel;
    $('eq-display').checked = eqObj ? eqObj.classList.contains('display') : !(blk && blk.textContent.replace(sel, '').trim());
    $('eq-number').checked = !!(eqObj && eqObj.dataset.id);
    $('eq-label').value = eqObj && eqObj.dataset.id || '';
    $('eq-ok').textContent = eqObj ? 'Update' : 'Insert';
    eqNumberState(); renderPalette(); eqPreview();
    setTimeout(() => { const ta = $('eq-tex'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    if (await show($('dlg-eq')) !== 'ok') return;
    const tex = $('eq-tex').value.trim();
    if (!tex) { if (eqObj) ed().op(() => eqObj.remove()); return; }
    const display = $('eq-display').checked;
    let id = display && $('eq-number').checked ? $('eq-label').value.trim().replace(/\s+/g, '-') : '';
    if (id && !/^eq:/.test(id)) id = 'eq:' + id;
    const el = SW.makeMath(tex, display, id);
    if (eqObj) ed().replaceObj(eqObj, el); else ed().insertNodes([el]);
  };

  /* ---------- symbols ---------- */
  const SYMS = {
    'Greek': 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ',
    'Math': '±∓×÷·°′″∞≈≠≡≤≥≪≫∝√∛∑∏∫∮∂∇∆∈∉⊂⊆∪∩∧∨¬∀∃∅→←↔⇒⇐⇔↑↓⊥∥∠',
    'Science and units': 'µΩÅ℃℉‰½⅓⅔¼¾⅛²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉ℏℓ',
    'Typography': '—–…•†‡§¶©®™«»‹›“”‘’„¿¡·',
    'Currency': '$€£¥¢₹₽₩',
    'Accented letters': 'áéíóúñüçàèìòùâêîôûäëïöÿßøåæœÁÉÍÓÚÑÜÇÀÈÒÄÖØÅÆŒ'
  };
  (function buildSymbols() {
    const g = $('sym-grid');
    for (const [k, v] of Object.entries(SYMS)) {
      const h = document.createElement('h3'); h.textContent = k; g.appendChild(h);
      for (const ch of [...v]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = ch; b.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        b.addEventListener('click', () => insertChar(ch));
        g.appendChild(b);
      }
    }
  })();
  function insertChar(ch) {
    const E = ed(); const root = E.root();
    E.op(() => {
      let r = E.saved;
      if (!r || !root.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(root.lastElementChild || root); r.collapse(false); }
      r.deleteContents();
      const t = document.createTextNode(ch);
      r.insertNode(t);
      const nr = document.createRange(); nr.setStartAfter(t); nr.collapse(true);
      E.saved = nr;
      const s = getSelection(); s.removeAllRanges(); s.addRange(nr.cloneRange());
    });
  }
  dlg.symbol = async function () { await show($('dlg-sym')); const E = ed(); if (E.saved) { const r = E.useRange(); E.saved = null; } };

  /* ---------- link ---------- */
  dlg.link = async function () {
    const E = ed(), r = E.saved;
    const node = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode);
    const a = node && node.closest('a[href]:not(.xref)');
    const existing = a && E.root().contains(a) ? a : null;
    $('link-text').value = existing ? existing.textContent : (r ? r.toString() : '');
    $('link-url').value = existing ? existing.getAttribute('href') : '';
    $('link-remove').hidden = !existing;
    setTimeout(() => ($('link-text').value ? $('link-url') : $('link-text')).focus(), 0);
    const v = await show($('dlg-link'));
    if (v === 'remove' && existing) { E.op(() => existing.replaceWith(...existing.childNodes)); return; }
    if (v !== 'ok') return;
    let url = $('link-url').value.trim(), text = $('link-text').value;
    if (!url) return;
    if (!/^([a-z][\w+.-]*:|#|\/|\.)/i.test(url)) url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' + url : 'https://' + url;
    E.op(() => {
      if (existing) { existing.setAttribute('href', url); if (text && text !== existing.textContent) existing.textContent = text; return; }
      const rr = E.useRange();
      const el = document.createElement('a'); el.href = url; el.target = '_blank';
      if (!rr.collapsed && (!text || text === rr.toString())) el.appendChild(rr.extractContents());
      else { rr.deleteContents(); el.textContent = text || url; }
      rr.insertNode(el); E.caretAfter(el);
    });
  };

  /* ---------- pictures ---------- */
  let imgBlob = null;
  $('img-pick').addEventListener('click', () => $('img-file').click());
  $('img-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    imgBlob = f; $('img-picked').textContent = f.name; $('img-url').value = '';
  });
  $('img-url').addEventListener('input', () => { imgBlob = null; $('img-picked').textContent = 'or type an address:'; });
  dlg.image = async function (o) {
    const E = ed();
    const isFig = o && o.nodeName === 'FIGURE';
    const img = o ? (o.nodeName === 'IMG' ? o : o.querySelector('img')) : null;
    imgBlob = null;
    $('img-picked').textContent = 'or type an address:';
    $('img-url').value = img ? (img.dataset.src || img.getAttribute('src')) : '';
    $('img-cap').value = isFig ? o.querySelector('figcaption .cap').textContent : '';
    $('img-number').checked = isFig ? !!o.dataset.id : true;
    $('img-width').value = img && img.dataset.width ? img.dataset.width : '';
    $('img-ok').textContent = o ? 'Update' : 'Insert';
    $('img-source-row').hidden = false;
    if (await show($('dlg-img')) !== 'ok') return;
    let src = $('img-url').value.trim();
    if (imgBlob) src = SW.addAssetBlob(imgBlob, imgBlob.name);
    if (!src) return;
    const cap = $('img-cap').value.trim(), numbered = $('img-number').checked, width = $('img-width').value;
    let el;
    if (cap || numbered) {
      const id = numbered ? (isFig && o.dataset.id ? o.dataset.id : uniqueId('fig', cap)) : '';
      el = SW.makeFigure(src, cap, id, width, o ? o.dataset.float : '');
      if (img && img.dataset.height && width === (img.dataset.width || '')) { el.querySelector('img').dataset.height = img.dataset.height; SW.layoutImg(el); }
    } else {
      el = document.createElement('img'); el.dataset.src = src; el.src = SW.resolveAsset(src); el.alt = '';
      if (width) el.dataset.width = width;
      if (img && img.dataset.height && width === (img.dataset.width || '')) el.dataset.height = img.dataset.height;
      if (o && o.dataset.float) el.dataset.float = o.dataset.float;
      SW.layoutImg(el);
    }
    if (o) E.replaceObj(o, el); else E.insertNodes([el]);
  };

  /* ---------- tables ---------- */
  function makeCaption(text, numbered) {
    const p = document.createElement('p'); p.className = 'tcap';
    p.appendChild(document.createTextNode(text));
    if (numbered) p.dataset.id = uniqueId('tbl', text);
    return p;
  }
  dlg.table = async function () {
    $('tbl-cap').value = '';
    if (await show($('dlg-table')) !== 'ok') return;
    const cols = Math.max(1, Math.min(20, +$('tbl-cols').value || 3)), rows = Math.max(1, Math.min(200, +$('tbl-rows').value || 3));
    const t = ed().makeTable(cols, rows);
    const cap = $('tbl-cap').value.trim(), num = $('tbl-number').checked;
    const nodes = cap || num ? [makeCaption(cap, num), t] : [t];
    ed().insertNodes(nodes);
    const th = t.querySelector('th');
    if (th) { const r = document.createRange(); r.selectNodeContents(th); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }
  };
  dlg.tableCaption = async function (table) {
    const E = ed();
    const cap = [table.previousElementSibling, table.nextElementSibling].find((s) => s && s.classList.contains('tcap'));
    const old = cap ? [...cap.childNodes].filter((n) => !(n.classList && n.classList.contains('num'))).map((n) => n.textContent).join('') : '';
    const v = await textDialog('Table caption', 'Leave it empty to remove the caption. Captioned tables are numbered and can be cross-referenced.', old, !!cap);
    if (v === null) return;
    E.op(() => {
      if (v === '' || v === undefined) { if (cap) cap.remove(); return; }
      if (cap) { [...cap.childNodes].forEach((n) => { if (!(n.classList && n.classList.contains('num'))) n.remove(); }); cap.appendChild(document.createTextNode(v)); if (!cap.dataset.id) cap.dataset.id = uniqueId('tbl', v); }
      else table.before(makeCaption(v, true));
    });
  };

  /* ---------- simple text dialogs: footnotes, comments ---------- */
  async function textDialog(title, hint, value, canDelete) {
    $('text-title').textContent = title; $('text-hint').textContent = hint || '';
    $('text-val').value = value || '';
    $('text-del').hidden = !canDelete;
    setTimeout(() => $('text-val').focus(), 0);
    const v = await show($('dlg-text'));
    if (v === 'delete') return '';
    if (v !== 'ok') return null;
    return $('text-val').value.trim();
  }
  dlg.footnote = async function (o) {
    const E = ed();
    const fn = o && o.classList && o.classList.contains('fn') ? o : null;
    const v = await textDialog('Footnote', 'The note text. Notes are numbered by themselves; Word files get real footnotes. Ctrl+Enter is OK.', fn ? fn.dataset.note : '', !!fn);
    if (v === null) return;
    if (fn) { E.op(() => { if (v) fn.dataset.note = v; else fn.remove(); }); return; }
    if (v) E.insertNodes([SW.makeFootnote(v)]);
  };
  dlg.comment = async function (o) {
    const E = ed();
    const m = o && o.dataset && o.dataset.comment !== undefined ? o : null;
    const parts = m ? E.splitAuthor(m.dataset.comment) : { who: '', text: '' };
    const v = await textDialog('Comment', m ? (parts.who ? 'By ' + parts.who : '') : 'Comments are saved in the Markdown file as {==text==}{>>comment<<} and go to Word as real comments.', parts.text, !!m);
    if (v === null) return;
    if (m) { if (!v) E.deleteComment(m); else E.op(() => { m.dataset.comment = (parts.who ? parts.who + ': ' : '') + v; }); return; }
    if (v) E.addComment(v);
  };

  /* ---------- citations ---------- */
  let citeSel = new Set();
  function citeList() {
    const box = $('cite-list'), q = $('cite-filter').value.toLowerCase();
    const all = Object.values(SW.bib.entries());
    box.innerHTML = '';
    if (!all.length) { box.innerHTML = '<div class="empty-note">No references yet. Add BibTeX entries below.</div>'; $('cite-add').open = true; return; }
    for (const e of all.sort((a, b) => a.key.localeCompare(b.key))) {
      const txt = SW.bib.plain(e);
      if (q && !(e.key + ' ' + txt).toLowerCase().includes(q)) continue;
      const row = document.createElement('div'); row.className = 'pick-item' + (citeSel.has(e.key) ? ' on' : '');
      row.innerHTML = '<span class="k"></span><span class="t"></span>';
      row.firstChild.textContent = e.key; row.lastChild.textContent = txt;
      row.addEventListener('click', () => { if (citeSel.has(e.key)) citeSel.delete(e.key); else citeSel.add(e.key); row.classList.toggle('on'); });
      row.addEventListener('dblclick', () => { citeSel.add(e.key); $('dlg-cite').close('ok'); });
      box.appendChild(row);
    }
  }
  $('cite-filter').addEventListener('input', citeList);
  $('cite-add-btn').addEventListener('click', () => {
    const t = $('cite-bib').value;
    const r = SW.bib.add(t);
    if (!r.added && !r.replaced) { $('cite-bib').focus(); SW.message('No BibTeX entries found in that text.'); return; }
    $('cite-bib').value = '';
    SW.files.bibChanged();
    citeList();
  });
  $('cite-load').addEventListener('click', () => $('cite-file').click());
  $('cite-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    SW.bib.add(await f.text()); SW.files.bibChanged(); citeList();
  });
  dlg.cite = async function (o) {
    const c = o && o.classList && o.classList.contains('cite') ? o : null;
    citeSel = new Set(c ? c.dataset.keys.split(';').filter(Boolean) : []);
    $('cite-filter').value = ''; $('cite-add').open = false;
    citeList();
    setTimeout(() => $('cite-filter').focus(), 0);
    if (await show($('dlg-cite')) !== 'ok' || !citeSel.size) return;
    const keys = [...citeSel];
    if (c) ed().op(() => { c.dataset.keys = keys.join(';'); });
    else ed().insertNodes([SW.makeCite(keys)]);
  };

  /* ---------- cross-references ---------- */
  let xrefPick = null;
  dlg.xref = async function (o) {
    const E = ed(), root = E.root();
    const x = o && o.classList && o.classList.contains('xref') ? o : null;
    xrefPick = null;
    const items = [];
    root.querySelectorAll('figure.fig').forEach((f) => items.push({ el: f, kind: 'fig', label: (f.dataset.id ? f.querySelector('.num').textContent : 'Figure (unnumbered): ') + f.querySelector('.cap').textContent }));
    root.querySelectorAll('.tcap').forEach((p) => items.push({ el: p, kind: 'tbl', label: (p.dataset.id ? '' : 'Table (unnumbered): ') + p.textContent }));
    root.querySelectorAll('.math.display').forEach((m) => items.push({ el: m, kind: 'eq', label: (m.dataset.id ? 'Eq. (' + m.dataset.num + '): ' : 'Equation (unnumbered): ') + m.dataset.tex.slice(0, 70) }));
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => items.push({ el: h, kind: 'sec', label: 'Heading: ' + (h.getAttribute('data-secnum') ? h.getAttribute('data-secnum') + ' ' : '') + h.textContent }));
    const box = $('xref-list'); box.innerHTML = '';
    if (!items.length) box.innerHTML = '<div class="empty-note">There is nothing to refer to yet: add captioned figures or tables, display equations or headings.</div>';
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'pick-item' + (x && it.el.dataset.id === x.dataset.ref ? ' on' : '');
      if (row.classList.contains('on')) xrefPick = it;
      row.innerHTML = '<span class="t"></span>'; row.firstChild.textContent = it.label;
      row.addEventListener('click', () => { box.querySelectorAll('.on').forEach((n) => n.classList.remove('on')); row.classList.add('on'); xrefPick = it; });
      row.addEventListener('dblclick', () => { xrefPick = it; $('dlg-xref').close('ok'); });
      box.appendChild(row);
    }
    if (await show($('dlg-xref')) !== 'ok' || !xrefPick) return;
    const it = xrefPick;
    E.op(() => {
      if (!it.el.dataset.id) {
        it.el.dataset.id = uniqueId(it.kind, it.kind === 'sec' ? it.el.textContent : it.kind === 'fig' ? it.el.querySelector('.cap').textContent : it.kind === 'tbl' ? it.el.textContent : '');
        if (it.kind === 'eq') SW.typeset(it.el);
      }
      if (x) x.dataset.ref = it.el.dataset.id;
    });
    if (!x) E.insertNodes([SW.makeXref(it.el.dataset.id)]);
  };

  /* ---------- code blocks ---------- */
  $('code-text').addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  });
  async function codeDialog(o) {
    const E = ed();
    $('code-text').value = o ? o.dataset.code : E.selectionText();
    $('code-lang').value = o ? (o.dataset.lang || '') : (SW.store.get('sw.lastLang') || '');
    setTimeout(() => $('code-text').focus(), 0);
    if (await show($('dlg-code')) !== 'ok') return;
    const code = $('code-text').value.replace(/\s+$/, '');
    if (!code) { if (o) E.op(() => o.remove()); return; }
    const lang = $('code-lang').value.trim().toLowerCase();
    SW.store.set('sw.lastLang', lang);
    const el = SW.makeCode(code, lang);
    if (o) E.replaceObj(o, el); else E.insertNodes([el]);
  }
  dlg.code = (o) => codeDialog(o && o.classList && o.classList.contains('code-block') ? o : null);
  dlg.codeblock = () => codeDialog(null);

  /* ---------- page setup ---------- */
  SW.FONTS = ['Calibri', 'Aptos', 'Arial', 'Helvetica', 'Verdana', 'Segoe UI', 'Times New Roman', 'Georgia', 'Cambria', 'Garamond', 'Palatino Linotype', 'Book Antiqua', 'Courier New', 'Consolas'];
  (function fillFonts() {
    const s = $('su-font');
    s.innerHTML = '<option value="">Default (Calibri or similar)</option>' + SW.FONTS.map((f) => '<option>' + f + '</option>').join('');
  })();
  const MARGINS = {
    in: [['1in', '1 in (default)'], ['0.5in', '0.5 in'], ['0.75in', '0.75 in'], ['1.25in', '1.25 in']],
    cm: [['1in', '2.54 cm (default)'], ['1.5cm', '1.5 cm'], ['2cm', '2 cm'], ['2.5cm', '2.5 cm'], ['3cm', '3 cm']]
  };
  let setupMargin = null;
  const toIn = (v) => parseFloat(v) / (/cm/.test(v) ? 2.54 : /mm/.test(v) ? 25.4 : /pt/.test(v) ? 72 : 1);
  function fillMargins(unit, cur) {                 // cur: a margin string, or null for custom
    const sel = $('su-margin');
    sel.innerHTML = MARGINS[unit].map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '<option value="custom">Custom (set with the ruler)</option>';
    const hit = cur && MARGINS[unit].find((o) => Math.abs(toIn(o[0]) - toIn(cur)) < 0.01);
    sel.value = hit ? hit[0] : 'custom';
  }
  $('su-units').addEventListener('change', () => { const cur = $('su-margin').value; fillMargins($('su-units').value, cur === 'custom' ? setupMargin : cur); $('su-paper').options[0].textContent = $('su-units').value === 'cm' ? 'Letter (21.6 \u00d7 27.9 cm)' : 'Letter (8.5 \u00d7 11 in)'; $('su-paper').options[1].textContent = $('su-units').value === 'cm' ? 'A4 (21 \u00d7 29.7 cm)' : 'A4 (8.27 \u00d7 11.69 in)'; });
  let lastPaper = 'letter';
  $('su-paper').addEventListener('change', () => {         // the default text size follows the paper: 12 pt for pages, 24 pt for slides
    const def = (v) => (v.startsWith('screen') ? '24pt' : '12pt'), now = $('su-paper').value;
    if ($('su-size').value === def(lastPaper)) $('su-size').value = def(now);
    lastPaper = now;
  });
  // the background picture: copied in as chosen, or reduced to screen size when asked (never for logos or frames)
  let bgOrig = null;
  async function placeBg() {
    let blob = bgOrig, name = bgOrig.name;
    if ($('su-bgsmall').checked && /^image\/(png|jpeg|webp)$/.test(bgOrig.type)) {
      try {
        const bmp = await createImageBitmap(bgOrig), k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
        if (out && out.size < bgOrig.size) { blob = out; name = name.replace(/\.\w+$/, '') + '.jpg'; }
      } catch (_) { /* keep the original */ }
    }
    $('su-bgtext').value = SW.addAssetBlob(blob, name); bgPrev();
  }
  // a small sample of the slide background with some text on it, to judge fit, fade and contrast
  function bgPrev() {
    const el = $('su-prev'); if (!el) return;
    const named = $('su-bgtext').value.trim() || ($('su-bg').value === 'plain' ? '' : $('su-bg').value);
    const fade = { pct: +$('su-fade').value, light: $('su-fadetone').value === 'light' }, lk = SW.present.look(named, fade, $('su-fit').value);
    const paper = $('su-paper').value, r = SW.paperInfo(paper);
    const w = r.w >= r.h ? 300 : 200;
    el.style.cssText = 'width:' + w + 'px;height:' + Math.round(w * r.h / r.w) + 'px;background:' + lk.bg + ';' + (lk.shade ? '--pr-shade:' + lk.shade + ';' : '') + 'color:' + lk.fg + ';--head-color:' + lk.head;
    el.classList.toggle('shade', !!lk.shade);
    el.querySelector('b').style.color = lk.head;
  }
  ['su-bg', 'su-bgtext', 'su-fade', 'su-fadetone', 'su-fit', 'su-paper'].forEach((id) => $(id).addEventListener(id === 'su-bgtext' || id === 'su-fade' ? 'input' : 'change', bgPrev));
  $('su-bgsmall').addEventListener('change', () => { if (bgOrig) placeBg(); });
  dlg.pageSetup = async function () {
    const E = ed();
    E.syncMetaFromSource();
    const s = E.settings();
    $('su-paper').value = s.paper; lastPaper = s.paper;
    const uniform = s.ml === s.mr && s.mr === s.mt && s.mt === s.mb;
    $('su-units').value = SW.units();
    setupMargin = uniform ? s.margin : null;
    fillMargins(SW.units(), setupMargin);
    $('su-units').dispatchEvent(new Event('change'));
    $('su-cols').value = String(s.cols);
    $('su-font').value = SW.FONTS.includes(s.font) ? s.font : '';
    $('su-size').value = [...$('su-size').options].some((o) => o.value === s.size) ? s.size : (s.paper.startsWith('screen') ? '24pt' : '12pt');
    $('su-line').value = ['1', '1.15', '1.5', '2'].includes(s.line) ? s.line : '1.15';
    $('su-header').value = s.header; $('su-footer').value = s.footer; $('su-skipfirst').checked = s.skipfirst;
    { const bgNamed = ['dark', 'navy', 'sepia'].includes(s.bg); $('su-bg').value = bgNamed ? s.bg : 'plain'; $('su-bgtext').value = s.bg && !bgNamed ? s.bg : ''; $('su-fade').value = s.fade.pct; $('su-fadetone').value = s.fade.light ? 'light' : 'dark'; $('su-trans').value = s.trans; $('su-reveal').checked = s.reveal; }
    $('su-pagenum').checked = s.pagenum; $('su-numsec').checked = s.numsec;
    $('su-bgpick').onclick = () => $('su-bgfile').click();
    $('su-bgfile').onchange = () => { const f = $('su-bgfile').files[0]; $('su-bgfile').value = ''; if (f) { bgOrig = f; placeBg(); } };
    $('su-fit').value = s.fit; $('su-bgsmall').checked = false; bgOrig = null; bgPrev();
    if (await show($('dlg-setup')) !== 'ok') return;
    const fm = SW.doc.fm;
    SW.store.set('sw.units', $('su-units').value);
    SW.setMeta(fm, 'papersize', { a4: 'a4', screen: 'screen', screen43: 'screen43' }[$('su-paper').value] || null);
    SW.setMeta(fm, 'background', $('su-bgtext').value.trim() || ($('su-bg').value === 'plain' ? null : $('su-bg').value));
    SW.setMeta(fm, 'backgroundfit', $('su-fit').value === 'fill' ? null : $('su-fit').value);
    { const f = +$('su-fade').value, l = $('su-fadetone').value === 'light'; SW.setMeta(fm, 'backgroundfade', f === 45 && !l ? null : f + (l ? ' light' : '')); }
    SW.setMeta(fm, 'transition', $('su-trans').value === 'fade' ? null : $('su-trans').value);
    SW.setMeta(fm, 'reveal', $('su-reveal').checked ? 'bullets' : null);
    if ($('su-margin').value !== 'custom') SW.setMeta(fm, 'geometry', $('su-margin').value === '1in' ? null : 'margin=' + $('su-margin').value);
    { const cur = String(fm.meta.classoption || '').split(/[\s,]+/).filter((c) => c && c !== 'twocolumn'); if ($('su-cols').value === '2') cur.push('twocolumn'); SW.setMeta(fm, 'classoption', cur.join(',') || null); }
    SW.setMeta(fm, 'mainfont', $('su-font').value || null);
    SW.setMeta(fm, 'fontsize', $('su-size').value === ($('su-paper').value.startsWith('screen') ? '24pt' : '12pt') ? null : $('su-size').value);
    SW.setMeta(fm, 'linestretch', $('su-line').value === '1.15' ? null : $('su-line').value);
    SW.setMeta(fm, 'header', $('su-header').value.trim() || null);
    SW.setMeta(fm, 'footer', $('su-footer').value.trim() || null);
    SW.setMeta(fm, 'skipfirst', $('su-skipfirst').checked ? 'true' : null);
    SW.setMeta(fm, 'pagenumbers', $('su-pagenum').checked ? 'true' : null);
    SW.setMeta(fm, 'numbersections', $('su-numsec').checked ? 'true' : null);
    E.metaChanged();
    if (SW.layout) SW.layout.updateRuler();
  };

  /* ---------- find and replace ---------- */
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function findRe() {
    const f = $('rp-find').value; if (!f) return null;
    const w = $('rp-word').checked;
    return new RegExp((w ? '(?<![\\p{L}\\p{N}_])' : '') + escRe(f) + (w ? '(?![\\p{L}\\p{N}_])' : ''), 'gu' + ($('rp-case').checked ? '' : 'i'));
  }
  function docMatches() {
    const re = findRe(); if (!re) return [];
    const root = ed().root(), out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentNode.closest('.obj') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (w.nextNode()) { const n = w.currentNode; re.lastIndex = 0; let m; while ((m = re.exec(n.nodeValue))) { out.push({ n, s: m.index, e: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; } }
    return out;
  }
  let lastHit = null;
  function findNext() {
    const msg = $('rp-msg');
    if (SW.doc.view === 'md') {
      const ta = $('source'), re = findRe(); if (!re) return;
      re.lastIndex = ta.selectionEnd; let m = re.exec(ta.value);
      if (!m) { re.lastIndex = 0; m = re.exec(ta.value); }
      if (!m) { msg.textContent = 'Not found.'; return; }
      ta.setSelectionRange(m.index, m.index + m[0].length);
      const line = ta.value.slice(0, m.index).split('\n').length;
      ta.scrollTop = Math.max(0, (line - 5) * 22);
      lastHit = { start: m.index, end: m.index + m[0].length };
      msg.textContent = 'Found on line ' + line + '.';
      return;
    }
    const all = docMatches();
    if (!all.length) { msg.textContent = 'Not found.'; lastHit = null; return; }
    let i = 0;
    if (lastHit && lastHit.n.isConnected) {
      const cur = document.createRange(); cur.setStart(lastHit.n, lastHit.e);
      i = all.findIndex((h) => { const r = document.createRange(); r.setStart(h.n, h.s); return r.compareBoundaryPoints(Range.START_TO_START, cur) >= 0; });
      if (i < 0) i = 0;
    }
    lastHit = all[i];
    const r = document.createRange(); r.setStart(lastHit.n, lastHit.s); r.setEnd(lastHit.n, lastHit.e);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    lastHit.n.parentNode.scrollIntoView({ block: 'center' });
    msg.textContent = 'Match ' + (i + 1) + ' of ' + all.length + '.';
  }
  $('rp-next').addEventListener('click', findNext);
  $('rp-one').addEventListener('click', () => {
    const rep = $('rp-with').value;
    if (SW.doc.view === 'md') {
      const ta = $('source');
      if (lastHit && ta.selectionStart === lastHit.start && ta.selectionEnd === lastHit.end) { ta.setRangeText(rep, lastHit.start, lastHit.end, 'end'); ta.dispatchEvent(new Event('input')); lastHit = null; }
      findNext(); return;
    }
    if (lastHit && lastHit.n.isConnected && findRe() && lastHit.n.nodeValue.slice(lastHit.s, lastHit.e).match(new RegExp('^' + findRe().source + '$', findRe().flags.replace('g', '')))) {
      const h = lastHit;
      ed().op(() => { h.n.nodeValue = h.n.nodeValue.slice(0, h.s) + rep + h.n.nodeValue.slice(h.e); });
      lastHit = { n: h.n, s: h.s, e: h.s + rep.length };
    }
    findNext();
  });
  $('rp-all').addEventListener('click', () => {
    const rep = $('rp-with').value, re = findRe(); if (!re) return;
    if (SW.doc.view === 'md') {
      const ta = $('source'); const n = (ta.value.match(re) || []).length;
      if (n) { $('dlg-replace').close(); ta.focus(); ta.select(); document.execCommand('insertText', false, ta.value.replace(re, () => rep)); }
      SW.message(n + ' replaced'); return;
    }
    const all = docMatches();
    if (all.length) ed().op(() => { for (let i = all.length - 1; i >= 0; i--) { const h = all[i]; h.n.nodeValue = h.n.nodeValue.slice(0, h.s) + rep + h.n.nodeValue.slice(h.e); } });
    $('rp-msg').textContent = all.length + (all.length === 1 ? ' replacement.' : ' replacements.');
    lastHit = null;
  });
  dlg.replace = async function () {
    const t = SW.doc.view === 'md' ? (() => { const ta = $('source'); return ta.value.slice(ta.selectionStart, ta.selectionEnd); })() : getSelection().toString();
    if (t && !t.includes('\n') && t.length < 80) $('rp-find').value = t;
    $('rp-msg').textContent = ''; lastHit = null;
    setTimeout(() => { $('rp-find').focus(); $('rp-find').select(); }, 0);
    await show($('dlg-replace'));
  };

  /* ---------- save as ---------- */
  dlg.saveAs = async function (name, fmt) {
    $('sv-name').value = name;
    document.querySelectorAll('input[name=sv-fmt]').forEach((r) => { r.checked = r.value === fmt; });
    setTimeout(() => { $('sv-name').focus(); $('sv-name').select(); }, 0);
    if (await show($('dlg-save')) !== 'ok') return null;
    const f = document.querySelector('input[name=sv-fmt]:checked');
    return { name: $('sv-name').value.trim().replace(/\.(md|markdown|docx|html?|txt|zip)$/i, '') || 'document', fmt: f ? f.value : 'md' };
  };
})();
