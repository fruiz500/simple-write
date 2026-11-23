/* Simple Write: the editing surface */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$;
  const ed = SW.ed = {};
  const doc = SW.doc = { fm: { lines: [], meta: {} }, body: '', dirtyDom: false, modified: false, name: '', format: 'md', fileHandle: null, dirHandle: null, view: 'doc' };
  let root, derived, page, scroller, source;
  const GAP = '.math.display, .code-block, figure.fig, .pagebreak, .media, .toc, table, hr';
  const BLOCKS = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|FIGURE|DIV|HR|PRE)$/;

  /* ---------- setup ---------- */
  ed.init = function () {
    root = $('doc'); derived = $('derived'); page = $('page'); scroller = $('scroller'); source = $('source');
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browsers */ }
    root.addEventListener('input', onInput);
    root.addEventListener('beforeinput', onBeforeInput);
    root.addEventListener('keydown', onKey);
    root.addEventListener('paste', onPaste);
    root.addEventListener('copy', onCopy);
    root.addEventListener('cut', onCut);
    root.addEventListener('dragstart', () => { ed.dragInside = true; });
    root.addEventListener('dragend', () => { ed.dragInside = false; });
    root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    root.addEventListener('drop', onDrop);
    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('mouseup', onMouseUp);
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    derived.addEventListener('mousedown', (e) => e.preventDefault());
    document.addEventListener('selectionchange', () => requestAnimationFrame(onSelChange));
    scroller.addEventListener('scroll', positionBars);
    window.addEventListener('resize', positionBars);
    source.addEventListener('input', () => { setModified(true); SW.files.autosaveSoon(); });
    source.addEventListener('keydown', onSourceKey);
    document.querySelectorAll('#tablebar [data-tbl]').forEach((b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => ed.tableOp(b.dataset.tbl)); });
    document.querySelectorAll('#imagebar [data-img]').forEach((b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => ed.imageOp(b.dataset.img)); });
    document.querySelectorAll('#mediabar [data-med]').forEach((b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => SW.media.op(b.dataset.med)); });
  };
  SW.styleDefaults = function () {
    if (!root) return {};
    const cs = getComputedStyle(root);
    return { color: SW.cssColorToHex(cs.color), 'font-family': cs.fontFamily.replace(/"/g, "'"), 'font-size': cs.fontSize };
  };

  /* ---------- load and save the Markdown ---------- */
  ed.setMarkdown = function (md, keepHistory) {
    const sp = SW.splitFrontMatter(md);
    doc.fm = sp.fm; doc.body = sp.body;
    ed.applySettings();
    const r = SW.renderBody(sp.body);
    root.replaceChildren(...r.childNodes);
    ed.deselect();
    if (doc.view === 'md') { source.value = SW.joinFrontMatter(doc.fm, doc.body); ed.srcOrig = source.value; }
    ed.refresh();
    doc.dirtyDom = false;
    if (!keepHistory) H.reset();
    snap();
  };
  ed.getMarkdown = function () {
    if (doc.view === 'md') return source.value;
    if (doc.dirtyDom) { doc.body = SW.toMarkdown(root, { defaults: SW.styleDefaults() }); doc.dirtyDom = false; }
    return SW.joinFrontMatter(doc.fm, doc.body);
  };
  // after front matter changes made by a dialog
  ed.metaChanged = function () {
    ed.applySettings();
    if (doc.view === 'md') { const sp = SW.splitFrontMatter(source.value); source.value = SW.joinFrontMatter(doc.fm, sp.body); }
    ed.refresh(); setModified(true); SW.files.autosaveSoon();
  };
  ed.syncMetaFromSource = function () { if (doc.view === 'md') doc.fm = SW.splitFrontMatter(source.value).fm; };
  ed.isEmpty = () => !ed.getMarkdown().trim();

  function setModified(v) {
    doc.modified = v;
    $('doc-state').textContent = v ? '\u2022 edited' : '';
    document.title = (doc.name || 'Untitled') + (v ? ' \u2022' : '') + ' \u2013 Simple Write';
  }
  ed.setModified = setModified;
  ed.setName = function (n) { doc.name = n; $('doc-name').textContent = n || 'Untitled'; setModified(doc.modified); };

  /* ---------- settings from the front matter ---------- */
  // paper sizes in inches; the two "screen" sizes are for slides
  const PAPERS = { letter: { w: 8.5, h: 11, css: 'letter', dims: ['8.5in', '11in'] }, a4: { w: 210 / 25.4, h: 297 / 25.4, css: 'A4', dims: ['210mm', '297mm'] }, screen: { w: 40 / 3, h: 7.5, css: '13.333in 7.5in', dims: ['13.333in', '7.5in'] }, screen43: { w: 10, h: 7.5, css: '10in 7.5in', dims: ['10in', '7.5in'] } };
  SW.paperInfo = (p) => PAPERS[p] || PAPERS.letter;
  const paperOf = (v) => { v = String(v || ''); return /a4/i.test(v) ? 'a4' : /screen|slide|16:9|4:3/i.test(v) ? (/4\s*[:x]\s*3|43/.test(v) ? 'screen43' : 'screen') : 'letter'; };
  ed.settings = function () {
    const m = doc.fm.meta;
    const paper = paperOf(m.papersize), scr = paper.startsWith('screen');
    const geo = (k) => ((String(m.geometry || '').match(new RegExp('(?:^|[\\s,])' + k + '\\s*=\\s*([\\d.]+\\s*(?:in|cm|mm|pt))')) || [])[1] || '').replace(/\s+/g, '');
    return {
      paper,
      margin: geo('margin') || (scr ? '0.6in' : '1in'),
      ml: geo('left') || geo('margin') || (scr ? '0.6in' : '1in'), mr: geo('right') || geo('margin') || (scr ? '0.6in' : '1in'),
      mt: geo('top') || geo('margin') || (scr ? '0.6in' : '1in'), mb: geo('bottom') || geo('margin') || (scr ? '0.6in' : '1in'),
      cols: /twocolumn/i.test(m.classoption || '') ? 2 : 1,
      tabs: String(m.tabstops || '').split(/[\s,]+/).map((t) => { const q = t.match(/^([\d.]+)(in|cm|mm|pt)?$/); return q ? parseFloat(q[1]) / (q[2] === 'cm' ? 2.54 : q[2] === 'mm' ? 25.4 : q[2] === 'pt' ? 72 : 1) : 0; }).filter((v) => v > 0 && v < 20).sort((a, b) => a - b),
      font: m.mainfont || '',
      size: /^\d+(\.\d+)?pt$/.test(m.fontsize || '') ? m.fontsize : scr ? '24pt' : '12pt',
      line: /^[\d.]+$/.test(m.linestretch || '') ? m.linestretch : '1.15',
      numsec: /^(true|yes|1)$/i.test(m.numbersections || ''),
      pagenum: /^(true|yes|1)$/i.test(m.pagenumbers || ''),
      header: m.header || '', footer: m.footer || '', skipfirst: /^(true|yes|1)$/i.test(m.skipfirst || ''),
      bg: String(m.background || '').trim(), fit: /^(fit|contain|stretch)$/i.test(m.backgroundfit || '') ? (/stretch/i.test(m.backgroundfit) ? 'stretch' : 'fit') : 'fill', trans: /^(none|slide)$/i.test(m.transition || '') ? String(m.transition).toLowerCase() : 'fade', reveal: /^(bullets|items|true|yes)$/i.test(m.reveal || ''),
      fade: (() => { const q = String(m.backgroundfade || '').match(/^\s*(\d+)\s*%?\s*(light|dark)?/i); return q ? { pct: Math.min(95, +q[1]), light: /light/i.test(q[2] || '') } : { pct: 45, light: false }; })()
    };
  };
  SW.fontStack = (f) => f ? "'" + f.replace(/'/g, '') + "', " + (/(Times|Georgia|Garamond|Cambria|Palatino|Book|Serif)/i.test(f) ? 'serif' : /(Courier|Consolas|Mono)/i.test(f) ? 'monospace' : 'sans-serif') : "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
  // the @page rule for print and PDF: size, margins, header and footer
  ed.pageStyle = function () {
    const s = ed.settings(), hf = SW.hf.printCss(s, doc.fm.meta, root);
    const css = '@page { size: ' + SW.paperInfo(s.paper).css + '; margin: ' + s.mt + ' ' + s.mr + ' ' + s.mb + ' ' + s.ml + ';' + hf.inner + ' }' + hf.after;
    if ($('page-style').textContent !== css) $('page-style').textContent = css;
  };
  ed.applySettings = function () {
    const s = ed.settings();
    const dims = SW.paperInfo(s.paper).dims;
    page.style.setProperty('--page-w', dims[0]);
    page.style.setProperty('--ml', s.ml); page.style.setProperty('--mr', s.mr); page.style.setProperty('--mt', s.mt); page.style.setProperty('--mb', s.mb);
    root.classList.toggle('cols2', s.cols === 2);
    if (SW.layout) SW.layout.settingsChanged();
    page.style.minHeight = dims[1];
    page.style.setProperty('--doc-font', SW.fontStack(s.font));
    page.style.setProperty('--doc-size', s.size);
    page.style.setProperty('--doc-line', String(Math.round(parseFloat(s.line) * 1.2 * 100) / 100));
    ed.pageStyle();
    SW.hf.paintSoon();
  };

  /* ---------- history (own snapshots: the browser's undo cannot follow our DOM changes) ---------- */
  const H = { list: [], i: -1, t: 0 };
  H.reset = () => { H.list = []; H.i = -1; };
  function pathOf(node) {
    const p = [];
    while (node && node !== root) { const par = node.parentNode; if (!par) return null; p.unshift(Array.prototype.indexOf.call(par.childNodes, node)); node = par; }
    return node === root ? p : null;
  }
  function nodeAt(path) { let n = root; for (const i of path) { n = n.childNodes[i]; if (!n) return null; } return n; }
  const nlen = (n) => n.nodeType === 3 ? n.nodeValue.length : n.childNodes.length;
  function saveSel() {
    const s = getSelection(); if (!s.rangeCount) return null;
    const a = pathOf(s.anchorNode), f = pathOf(s.focusNode);
    return a && f ? { a, ao: s.anchorOffset, f, fo: s.focusOffset } : null;
  }
  function restoreSel(x) {
    if (!x) return;
    const a = nodeAt(x.a), f = nodeAt(x.f);
    if (!a || !f) return;
    try { getSelection().setBaseAndExtent(a, Math.min(x.ao, nlen(a)), f, Math.min(x.fo, nlen(f))); } catch (e) { /* ignore */ }
  }
  function snap() {
    clearTimeout(H.t); H.t = 0;
    const html = root.innerHTML, cur = H.list[H.i];
    if (cur && cur.html === html) { cur.sel = saveSel(); return; }
    H.list.length = H.i + 1;
    H.list.push({ html, sel: saveSel() });
    if (H.list.length > 150) H.list.shift();
    H.i = H.list.length - 1;
  }
  const snapSoon = () => { clearTimeout(H.t); H.t = setTimeout(snap, 700); };
  function applyState(st) {
    ed.deselect();
    root.innerHTML = st.html;
    root.focus({ preventScroll: true });
    restoreSel(st.sel);
    doc.dirtyDom = true; setModified(true);
    ed.refresh(); SW.files.autosaveSoon();
  }
  ed.undo = function () { if (doc.view !== 'doc') { source.focus(); document.execCommand('undo'); return; } if (H.t) snap(); if (H.i > 0) applyState(H.list[--H.i]); };
  ed.redo = function () { if (doc.view !== 'doc') { source.focus(); document.execCommand('redo'); return; } if (H.t) snap(); if (H.i < H.list.length - 1) applyState(H.list[++H.i]); };

  function changed(now) {
    doc.dirtyDom = true; setModified(true);
    refreshSoon(); SW.files.autosaveSoon();
    if (now) snap(); else snapSoon();
  }
  ed.changed = changed;
  // a programmatic change: one undo step
  ed.op = function (fn) {
    if (doc.view !== 'doc') return;
    snap();
    let r;
    try { r = fn(); } finally { changed(true); ed.refresh(); }
    return r;
  };

  /* ---------- refresh: numbering, panes, counts ---------- */
  ed.refresh = function () {
    SW.decorate(root, derived, { meta: doc.fm.meta });
    ensureGaps();
    ed.updateOutline(); ed.updateComments(); ed.updateStats();
    positionBars(); ed.pageStyle(); SW.hf.paintSoon();
  };
  const refreshSoon = SW.debounce(() => ed.refresh(), 400);
  const emptyP = () => { const p = document.createElement('p'); p.appendChild(document.createElement('br')); return p; };
  function ensureGaps() {
    if (!root.firstChild) { root.appendChild(emptyP()); return; }
    [...root.children].forEach((k, i) => {
      if (!k.matches(GAP)) return;
      const next = k.nextElementSibling;
      if (!next || next.matches(GAP)) k.after(emptyP());
      if (i === 0) k.before(emptyP());
    });
    // text typed straight into the editing root goes into a paragraph
    [...root.childNodes].forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.trim()) { const p = document.createElement('p'); n.before(p); p.appendChild(n); }
    });
  }

  ed.updateOutline = function () {
    const box = $('outline-list'); if (!box || $('outline-pane').hidden) return;
    const hs = [...root.querySelectorAll('h1,h2,h3,h4')];
    box.innerHTML = hs.length ? '' : '<div class="empty-note">Headings appear here.</div>';
    for (const h of hs) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'outline-item';
      b.style.paddingLeft = (0.7 + (+h.nodeName[1] - 1) * 0.9) + 'rem';
      b.textContent = (h.getAttribute('data-secnum') ? h.getAttribute('data-secnum') + ' ' : '') + h.textContent;
      b.addEventListener('click', () => { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); const r = document.createRange(); r.selectNodeContents(h); r.collapse(true); root.focus({ preventScroll: true }); getSelection().removeAllRanges(); getSelection().addRange(r); });
      box.appendChild(b);
    }
  };

  const splitAuthor = (c) => { const m = String(c || '').match(/^([^:\n]{1,40}):\s([\s\S]*)$/); return m ? { who: m[1], text: m[2] } : { who: '', text: c || '' }; };
  ed.splitAuthor = splitAuthor;
  ed.updateComments = function () {
    const box = $('comments-list'), all = [...root.querySelectorAll('mark.comment, .cpin')];
    SW.ui && SW.ui.commentCount(all.length);
    if (!box || $('comments-pane').hidden) return;
    box.innerHTML = all.length ? '' : '<div class="empty-note">No comments. Select some text and press the comment button (Ctrl+Alt+M).</div>';
    for (const m of all) {
      const c = splitAuthor(m.dataset.comment);
      const card = document.createElement('div'); card.className = 'cmt-card';
      card.innerHTML = '<div class="who"></div><div class="quote"></div><div class="txt"></div><div class="acts"><button type="button" data-a="edit">Edit</button><button type="button" data-a="del">Delete</button></div>';
      card.querySelector('.who').textContent = c.who || 'Comment';
      card.querySelector('.quote').textContent = m.textContent ? '\u201C' + m.textContent + '\u201D' : '';
      card.querySelector('.txt').textContent = c.text;
      card.addEventListener('click', (e) => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === 'edit') return SW.dlg.comment(m);
        if (a === 'del') return ed.deleteComment(m);
        ed.showComment(m);
      });
      m._card = card;
      box.appendChild(card);
    }
  };
  ed.showComment = function (m) {
    root.querySelectorAll('mark.comment.active').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.cmt-card.active').forEach((x) => x.classList.remove('active'));
    if (m.nodeName === 'MARK') m.classList.add('active');
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if ($('comments-pane').hidden) SW.ui.togglePane('comments', true);
    if (m._card) { m._card.classList.add('active'); m._card.scrollIntoView({ block: 'nearest' }); }
  };
  ed.deleteComment = (m) => ed.op(() => { if (m.classList.contains('cpin')) m.remove(); else m.replaceWith(...m.childNodes); });
  ed.addComment = function (text) {
    const who = SW.ui.userName();
    const full = (who ? who + ': ' : '') + text;
    ed.op(() => {
      const r = useRange();
      if (r.collapsed) { const pin = SW.makeCommentPin(full); r.insertNode(pin); caretAfter(pin); return; }
      const b1 = topBlock(r.startContainer), b2 = topBlock(r.endContainer);
      if (b1 && b2 && b1 !== b2) r.setEnd(b1, b1.childNodes.length);
      const m = document.createElement('mark'); m.className = 'comment'; m.dataset.comment = full;
      m.appendChild(r.extractContents());
      m.querySelectorAll('mark.comment').forEach((x) => x.replaceWith(...x.childNodes));
      r.insertNode(m);
      caretAfter(m);
    });
  };

  function textOf(el) {
    let t = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentNode.closest('.obj') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (w.nextNode()) t += w.currentNode.nodeValue + ' ';
    return t;
  }
  ed.textOf = textOf;
  ed.updateStats = function () {
    const t = textOf(root);
    const words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019.\-]*/gu) || []).length;
    const s = ed.settings();
    const inch = (v) => parseFloat(v) / (/cm/.test(v) ? 2.54 : /mm/.test(v) ? 25.4 : /pt/.test(v) ? 72 : 1);
    const pageIn = (s.paper === 'a4' ? 11.69 : 11) - inch(s.mt) - inch(s.mb);
    const zoom = parseFloat(page.style.zoom || '1') || 1;
    const h = (root.getBoundingClientRect().height + derived.getBoundingClientRect().height) / zoom;
    const pages = Math.max(1, Math.ceil(h / (pageIn * 96) - 0.03));
    $('st-pages').textContent = doc.view === 'doc' ? 'About ' + pages + (pages === 1 ? ' page' : ' pages') : 'Markdown source';
    $('st-words').textContent = words + (words === 1 ? ' word' : ' words');
  };

  /* ---------- selection helpers ---------- */
  function topBlock(node) {
    let n = node && (node.nodeType === 1 ? node : node.parentNode);
    if (!n || !root.contains(n) || n === root) return null;
    while (n.parentNode && n.parentNode !== root && !/^(LI|TD|TH|BLOCKQUOTE)$/.test(n.parentNode.nodeName)) n = n.parentNode;
    return n.parentNode ? n : null;
  }
  ed.topBlock = topBlock;
  function caretAfter(node) {
    const r = document.createRange();
    // Chrome draws no caret after a picture that ends its line: give it a line-end placeholder
    if ((node.nodeName === 'IMG' || (node.classList && node.classList.contains('tab'))) && node.parentNode && !(node.nextSibling && (node.nextSibling.nodeName !== '#text' || node.nextSibling.nodeValue)) && /^(P|LI|TD|TH|H[1-6]|DIV|BLOCKQUOTE)$/.test(node.parentNode.nodeName)) node.after(document.createElement('br'));
    if (node.nodeType === 1 && node.matches(GAP)) {
      let next = node.nextElementSibling;
      if (!next || next.matches(GAP)) { next = emptyP(); node.after(next); }
      r.setStart(next, 0);
    } else r.setStartAfter(node);
    r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  ed.caretAfter = caretAfter;
  function caretBefore(node) { const r = document.createRange(); r.setStartBefore(node); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  ed.saveRange = function () {
    const s = getSelection();
    ed.saved = s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0).cloneRange() : null;
    return ed.saved;
  };
  function useRange() {
    let r = ed.saved; ed.saved = null;
    root.focus({ preventScroll: true });
    if (!r || !root.contains(r.startContainer)) {
      const s0 = getSelection();
      if (s0.rangeCount && root.contains(s0.getRangeAt(0).commonAncestorContainer)) r = s0.getRangeAt(0);
      else { r = document.createRange(); r.selectNodeContents(root); r.collapse(false); }
    }
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return r;
  }
  ed.useRange = useRange;
  ed.selectionText = () => { const r = ed.saved || (getSelection().rangeCount ? getSelection().getRangeAt(0) : null); return r && root.contains(r.commonAncestorContainer) ? r.toString() : ''; };
  const isEmptyBlock = (b) => !b.textContent.replace(/\u200B/g, '').trim() && !b.querySelector('img, .obj, input, table');

  /* ---------- inserting ---------- */
  ed.insertNodes = function (nodes) {
    nodes = nodes.filter(Boolean);
    if (!nodes.length) return;
    ed.op(() => {
      const r = useRange();
      ed.deselect();
      r.deleteContents();
      const isBlock = (n) => n.nodeType === 1 && (BLOCKS.test(n.nodeName) && !(n.nodeName === 'DIV' && !n.classList.contains('obj') && !n.classList.contains('display')));
      const last = nodes[nodes.length - 1];
      if (!nodes.some(isBlock)) {
        const frag = document.createDocumentFragment(); nodes.forEach((n) => frag.appendChild(n));
        r.insertNode(frag); caretAfter(last); return;
      }
      if (r.startContainer === root) {
        const frag = document.createDocumentFragment(); nodes.forEach((n) => frag.appendChild(n));
        r.insertNode(frag); caretAfter(last); return;
      }
      const blk = topBlock(r.startContainer);
      if (!blk) { root.append(...nodes); caretAfter(last); return; }
      if (/^(LI|TD|TH)$/.test(blk.parentNode.nodeName) && blk.parentNode !== root) { /* fall through: split inside the item */ }
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset); tail.setEnd(blk, blk.childNodes.length);
      const rest = blk.cloneNode(false); rest.removeAttribute('id');
      rest.appendChild(tail.extractContents());
      blk.after(rest);
      nodes.forEach((n) => rest.before(n));
      if (isEmptyBlock(blk)) blk.remove();
      const keepRest = !isEmptyBlock(rest) || !rest.nextElementSibling || rest.nextElementSibling.matches(GAP);
      if (keepRest && isEmptyBlock(rest) && /^H[1-6]|BLOCKQUOTE$/.test(rest.nodeName)) { const p = emptyP(); rest.replaceWith(p); caretInto(p); return; }
      if (keepRest) { if (isEmptyBlock(rest)) { rest.innerHTML = '<br>'; } caretInto(rest); } else { rest.remove(); caretAfter(last); }
    });
    ed.reveal();
  };
  function caretInto(el) { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  ed.insertMarkdown = function (md, opts) {
    opts = opts || {};
    const r = SW.renderBody(md);
    let nodes = [...r.childNodes].filter((n) => !(n.nodeType === 3 && !n.nodeValue.trim()));
    const cur = ed.saved || (getSelection().rangeCount ? getSelection().getRangeAt(0) : null);
    const cell = cur && cur.startContainer && (cur.startContainer.nodeType === 1 ? cur.startContainer : cur.startContainer.parentNode).closest('td, th');
    if (nodes.length === 1 && nodes[0].nodeName === 'P' && !nodes[0].style.textAlign) nodes = [...nodes[0].childNodes];
    else if (cell && root.contains(cell)) {
      const flat = [];
      nodes.forEach((n, i) => { if (i) flat.push(document.createElement('br')); if (n.nodeName === 'P' || /^H[1-6]$/.test(n.nodeName)) flat.push(...n.childNodes); else flat.push(document.createTextNode(n.textContent)); });
      nodes = flat;
    }
    ed.insertNodes(nodes);
  };
  ed.replaceObj = function (old, el) {
    ed.op(() => { old.replaceWith(el); ed.selectObj(el); });
  };
  ed.insertImages = function (files) {
    const nodes = files.map((f) => {
      const name = SW.addAssetBlob(f, f.name || 'picture');
      const img = document.createElement('img');
      img.dataset.src = name; img.src = SW.resolveAsset(name); img.alt = '';
      return img;
    });
    ed.insertNodes(nodes);
  };

  /* ---------- objects (equations, pictures, notes...) ---------- */
  function objOf(t) {
    const el = t && (t.nodeType === 1 ? t : t.parentNode);
    if (!el || !el.closest) return null;
    const o = el.closest('.obj') || (el.nodeName === 'IMG' ? el : null);
    return o && root.contains(o) && o !== root ? o : null;
  }
  ed.selectObj = function (o) {
    ed.deselect();
    ed.selObj = o; o.classList.add('sel');
    root.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNode(o);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    positionBars();
  };
  ed.deselect = function () {
    if (ed.selObj) { ed.selObj.classList.remove('sel'); ed.selObj = null; }
    root && root.querySelectorAll('.obj.sel, img.sel').forEach((x) => x.classList.remove('sel'));
    $('imagebar').hidden = true; $('mediabar').hidden = true;
  };
  ed.editObj = function (o) {
    if (!o) return;
    if (o.classList.contains('math')) return SW.dlg.equation(o);
    if (o.classList.contains('code-block')) return SW.dlg.code(o);
    if (o.nodeName === 'FIGURE' || o.nodeName === 'IMG') return SW.dlg.image(o);
    if (o.classList.contains('fn')) return SW.dlg.footnote(o);
    if (o.classList.contains('cite')) return SW.dlg.cite(o);
    if (o.classList.contains('xref')) return SW.dlg.xref(o);
    if (o.classList.contains('cpin')) return SW.dlg.comment(o);
    if (o.classList.contains('toc')) return SW.message('The table of contents follows the headings by itself.');
    if (o.classList.contains('pagebreak')) return SW.message('Press Delete to remove the page break.');
  };
  function onMouseDown(e) {
    if (e.target.nodeName === 'INPUT' && e.target.type === 'checkbox') {
      e.preventDefault();
      const cb = e.target;
      ed.op(() => { if (cb.hasAttribute('checked')) { cb.removeAttribute('checked'); cb.checked = false; } else { cb.setAttribute('checked', ''); cb.checked = true; } });
      return;
    }
    const o = objOf(e.target);
    if (o) { e.preventDefault(); ed.selectObj(o); return; }
    ed.deselect();
  }
  function onClick(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && !a.classList.contains('xref') && (e.ctrlKey || e.metaKey)) { window.open(a.href, '_blank', 'noopener'); return; }
    const x = e.target.closest && e.target.closest('a.xref, .toc a');
    if (x && x.getAttribute('href') && (e.ctrlKey || e.metaKey || x.closest('.toc'))) {
      const t = document.getElementById(decodeURIComponent(x.getAttribute('href').slice(1)));
      if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const mo = e.target.closest && e.target.closest('.media');
    if (mo && !e.target.closest('.mc-bar') && ed.selObj !== mo) { ed.selectObj(mo); return; }   // the player takes over the mouse: select it again
    const m = e.target.closest && (e.target.closest('mark.comment') || e.target.closest('.cpin'));
    if (m) ed.showComment(m);
  }
  function onDblClick(e) { const o = objOf(e.target); if (o) { e.preventDefault(); ed.editObj(o); } }

  /* ---------- typing ---------- */
  function onBeforeInput(e) {
    if (e.inputType === 'historyUndo') { e.preventDefault(); ed.undo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); ed.redo(); }
  }
  function onInput(e) {
    ed.deselect();
    changed(false);
    if (e.inputType === 'insertText' && e.data) inputRules(e.data);
  }
  function inputRules(ch) {
    const s = getSelection(); if (!s.isCollapsed) return;
    const n = s.anchorNode, off = s.anchorOffset;
    if (!n || n.nodeType !== 3) return;
    const before = n.nodeValue.slice(0, off);
    if (ch === '$') {
      const m = before.match(/(^|[^\\$\w])\$([^$\s\u00A0](?:[^$]*[^$\s\u00A0])?)\$$/);
      if (m) {
        const start = off - m[2].length - 2;
        ed.op(() => {
          const r = document.createRange(); r.setStart(n, start); r.setEnd(n, off); r.deleteContents();
          const el = SW.makeMath(m[2].replace(/\u00A0/g, ' '), false); r.insertNode(el); caretAfter(el);
        });
      }
      return;
    }
    if (ch === ' ') {
      const blk = topBlock(n);
      if (!blk || blk.nodeName !== 'P') return;
      const head = before.replace(/\u00A0/g, ' ');
      const all = blk.textContent.replace(/\u00A0/g, ' ');
      if (!all.startsWith(head)) return;
      const m = head.match(/^(#{1,6}|[-*+]|1[.)]|>|\[[ xX]?\]) $/);
      if (!m) return;
      ed.op(() => {
        const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, off); r.deleteContents();
        if (!blk.textContent) blk.innerHTML = '<br>';
        caretInto(blk);
        const k = m[1];
        if (k[0] === '#') document.execCommand('formatBlock', false, 'h' + k.length);
        else if (k === '>') document.execCommand('formatBlock', false, 'blockquote');
        else if (k[0] === '[') toggleChecklist();
        else if (/\d/.test(k)) document.execCommand('insertOrderedList');
        else document.execCommand('insertUnorderedList');
      });
    }
  }

  // the tab character right before (Backspace) or after (Delete) a collapsed caret
  function tabNear(back) {
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return null;
    let c = s.anchorNode, o = s.anchorOffset, n = null;
    if (c.nodeType === 3) {
      if (back ? o > 0 : o < c.nodeValue.length) return null;
      n = back ? c.previousSibling : c.nextSibling;
    } else n = back ? c.childNodes[o - 1] : c.childNodes[o];
    // at the edge of an inline element (bold, italic...): look beside the element
    while (!n && c !== root && c.parentNode && c.parentNode !== root && !/^(P|LI|TD|TH|H[1-6]|DIV|BLOCKQUOTE)$/.test(c.parentNode.nodeName)) { c = c.parentNode; n = back ? c.previousSibling : c.nextSibling; }
    while (n && n.nodeType === 3 && !n.nodeValue) n = back ? n.previousSibling : n.nextSibling;
    return n && n.nodeType === 1 && n.classList.contains('tab') && root.contains(n) ? n : null;
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if ((k === 'Backspace' || k === 'Delete') && !mod && !e.altKey && !e.shiftKey && !ed.selObj) {
      const t = tabNear(k === 'Backspace');
      if (t) { e.preventDefault(); ed.op(() => { t.remove(); }); return; }
    }
    if (ed.selObj) {
      const o = ed.selObj;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); ed.op(() => { const next = o.nextSibling; const blockish = o.matches(GAP); o.remove(); ed.deselect(); if (blockish) { const p = next && next.nodeType === 1 ? next : null; if (p) caretInto(p); } }); return; }
      if (k === 'Enter' && !mod) { e.preventDefault(); ed.editObj(o); return; }
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); ed.deselect(); caretAfter(o); return; }
      if (k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault(); ed.deselect();
        if (o.matches(GAP)) { let p = o.previousElementSibling; if (!p || p.matches(GAP)) { p = emptyP(); o.before(p); } const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }
        else caretBefore(o);
        return;
      }
      if (k === 'Escape') { ed.deselect(); return; }
    }
    if (mod && !e.altKey) {
      const c = e.code;
      if (c === 'KeyB') return run(e, () => ed.cmd('bold'));
      if (c === 'KeyI') return run(e, () => ed.cmd('italic'));
      if (c === 'KeyU') return run(e, () => ed.cmd('underline'));
      if (c === 'KeyE') return run(e, () => ed.cmd('justifyCenter'));
      if (c === 'KeyL') return run(e, () => ed.cmd(e.shiftKey ? 'insertUnorderedList' : 'justifyLeft'));
      if (c === 'KeyR') return run(e, () => ed.cmd('justifyRight'));
      if (c === 'KeyJ') return run(e, () => ed.cmd('justifyFull'));
      if (c === 'KeyK') return run(e, () => ed.cmd('link'));
      if (c === 'Equal' || k === '+') return run(e, () => ed.cmd(e.shiftKey || k === '+' ? 'superscript' : 'subscript'));
      if (c === 'KeyZ') return run(e, () => (e.shiftKey ? ed.redo() : ed.undo()));
      if (c === 'KeyY') return run(e, () => ed.redo());
      if (c === 'Space' && !e.shiftKey) return run(e, () => ed.cmd('clear'));
      if (c === 'Backquote') return run(e, () => ed.cmd('code'));
      if (k === 'Enter') return run(e, () => ed.cmd('pagebreak'));
      if (c === 'KeyN' && e.shiftKey) return run(e, () => ed.cmd('formatBlock', 'p'));
      if (c === 'KeyV' && e.shiftKey) { ed.plainNext = true; return; }
    }
    if (mod && e.altKey) {
      const c = e.code;
      if (/^Digit[1-6]$/.test(c)) return run(e, () => ed.cmd('formatBlock', 'h' + c[5]));
      if (c === 'KeyF') return run(e, () => ed.cmd('footnote'));
      if (c === 'KeyM') return run(e, () => ed.cmd('comment'));
    }
    if (e.altKey && !mod && e.code === 'Equal') return run(e, () => ed.cmd('equation'));
    if (k === 'Tab' && !mod && !e.altKey) {
      const s = getSelection(); const node = s.rangeCount ? s.getRangeAt(0).startContainer : null;
      const el = node && (node.nodeType === 1 ? node : node.parentNode);
      const cell = el && el.closest('td, th');
      if (cell && root.contains(cell)) { e.preventDefault(); moveCell(cell, e.shiftKey ? -1 : 1); return; }
      if (el && el.closest('li') && root.contains(el.closest('li'))) { e.preventDefault(); ed.cmd(e.shiftKey ? 'outdent' : 'indent'); return; }
      e.preventDefault();
      if (!e.shiftKey && el && !el.closest('.obj')) ed.insertNodes([SW.makeTab()]);
    }
  }
  const run = (e, fn) => { e.preventDefault(); fn(); };

  function onSourceKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const wrap = (a) => {
      e.preventDefault();
      const s = source.selectionStart, en = source.selectionEnd, t = source.value.slice(s, en);
      const on = t.startsWith(a) && t.endsWith(a) && t.length >= 2 * a.length;
      const rep = on ? t.slice(a.length, t.length - a.length) : a + t + a;
      source.focus(); document.execCommand('insertText', false, rep);
      source.setSelectionRange(s + (on ? 0 : a.length), s + (on ? 0 : a.length) + (on ? rep.length : t.length));
    };
    if (e.code === 'KeyB') wrap('**');
    else if (e.code === 'KeyI') wrap('*');
  }

  /* ---------- clipboard ---------- */
  function clipboardHtml(container) {
    const out = container.cloneNode(true);
    out.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    out.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
    out.querySelectorAll('.math[data-tex]').forEach((m) => {
      const display = m.classList.contains('display');
      let tex = m.dataset.tex; if (display && m.dataset.num) tex += ' \\tag{' + m.dataset.num + '}';
      try { m.innerHTML = katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, strict: false }); } catch (e) { m.textContent = tex; }
    });
    out.querySelectorAll('img').forEach((img) => { const d = SW.assetDataUrl && SW.assetDataUrl(img.dataset.src || ''); if (d) img.src = d; });
    return '<div data-sw="1">' + out.innerHTML + '</div>';
  }
  ed.clipboardFor = function (container) {
    return { html: clipboardHtml(container), md: SW.toMarkdown(container, { defaults: SW.styleDefaults() }).trim() };
  };
  function selectionContainer(given) {
    let r = given;
    if (!r) { const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return null; r = s.getRangeAt(0); }
    if (r.collapsed || !root.contains(r.commonAncestorContainer)) return null;
    const wrap = document.createElement('div');
    wrap.appendChild(r.cloneContents());
    // a selection inside one list item or heading keeps its block
    const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    const h = anc.closest('h1,h2,h3,h4,h5,h6');
    if (h && root.contains(h)) { const c = h.cloneNode(false); c.append(...wrap.childNodes); wrap.appendChild(c); }
    return wrap;
  }
  // the Markdown of a range in the document ('' when it is empty)
  ed.rangeMarkdown = (r) => { const c = selectionContainer(r); return c ? SW.toMarkdown(c, { defaults: SW.styleDefaults() }).trim() : ''; };
  function onCopy(e) {
    const c = selectionContainer(); if (!c) return;
    e.preventDefault();
    const x = ed.clipboardFor(c);
    e.clipboardData.setData('text/html', x.html);
    e.clipboardData.setData('text/plain', x.md);
  }
  function onCut(e) {
    onCopy(e);
    if (!e.defaultPrevented) return;
    ed.op(() => { const s = getSelection(); if (s.rangeCount) s.getRangeAt(0).deleteContents(); ed.deselect(); });
  }
  function onPaste(e) {
    e.preventDefault();
    const cd = e.clipboardData; if (!cd) return;
    const plain = ed.plainNext; ed.plainNext = false;
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    const files = [...(cd.files || [])].filter((f) => /^image\//.test(f.type));
    if (plain) { if (text) ed.op(() => document.execCommand('insertText', false, text)); return; }
    if (files.length) {
      const d = html ? new DOMParser().parseFromString(html, 'text/html').body : null;
      if (!d || (!d.textContent.trim() && d.querySelectorAll('img').length <= 1)) { ed.saveRange(); ed.insertImages(files); return; }
    }
    ed.saveRange();
    ed.pasteContent(html, text);
  }
  ed.pasteContent = function (html, text) {
    let md = '';
    if (html && html.trim()) { try { md = SW.htmlToMarkdown(html); } catch (err) { console.error(err); md = text || ''; } }
    else if (text) {
      const t = text.trim();
      if (/^<math[\s>]/i.test(t)) {
        const tex = SW.mmlStringToTex(t) || '';
        const r = ed.saved, blk = r && topBlock(r.startContainer);
        md = blk && blk.textContent.trim() ? '$' + tex + '$' : '$$' + tex + '$$';
      } else md = text;
    }
    if (md.trim()) ed.insertMarkdown(md);
  };
  function onDrop(e) {
    if (ed.dragInside) { ed.dragInside = false; setTimeout(() => changed(true), 0); return; }
    const dt = e.dataTransfer; if (!dt) return;
    const files = [...dt.files];
    e.preventDefault();
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    if (r && root.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.saveRange(); }
    if (files.length) {
      const imgs = files.filter((f) => /^image\//.test(f.type));
      const docs = files.filter((f) => !/^image\//.test(f.type));
      if (docs.length) { SW.files.openFiles(files); return; }
      if (imgs.length) ed.insertImages(imgs);
      return;
    }
    ed.pasteContent(dt.getData('text/html'), dt.getData('text/plain'));
  }

  /* ---------- formatting commands ---------- */
  function exec(c, v, css) {
    try { document.execCommand('styleWithCSS', false, !!css); } catch (e) { /* ignore */ }
    const r = document.execCommand(c, false, v);
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
    return r;
  }
  function selRange() { const s = getSelection(); return s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null; }
  function intersecting(sel) { const r = selRange(); if (!r) return []; return [...root.querySelectorAll(sel)].filter((el) => r.intersectsNode(el)); }
  const unwrap = (el) => el.replaceWith(...el.childNodes);
  function clearStyleProp(prop) {
    intersecting('span[style]').forEach((s) => { if (s.classList.contains('obj')) return; s.style.removeProperty(prop); if (!s.getAttribute('style')) unwrap(s); });
    intersecting('font').forEach((f) => { if (prop === 'color') f.removeAttribute('color'); if (prop === 'font-family') f.removeAttribute('face'); if (!f.attributes.length) unwrap(f); });
  }
  function setFontSize(pt) {
    if (!pt) { clearStyleProp('font-size'); return; }
    exec('fontSize', '7', true);
    root.querySelectorAll('span[style*="xxx-large"], font[size="7"]').forEach((s) => {
      if (s.nodeName === 'FONT') { const n = document.createElement('span'); n.append(...s.childNodes); s.replaceWith(n); s = n; }
      s.style.fontSize = pt;
    });
  }
  function toggleCode() {
    const r = selRange(); if (!r) return;
    const anc = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode).closest('code');
    if (anc && root.contains(anc) && !anc.closest('.obj')) { const t = document.createTextNode(anc.textContent); anc.replaceWith(t); return; }
    const c = document.createElement('code');
    if (r.collapsed) { c.textContent = 'code'; r.insertNode(c); const s = document.createRange(); s.selectNodeContents(c); getSelection().removeAllRanges(); getSelection().addRange(s); return; }
    c.textContent = r.toString(); r.deleteContents(); r.insertNode(c); caretAfter(c);
  }
  function clearFormat() {
    exec('removeFormat');
    intersecting('span[style], font, code, mark:not(.comment), u, sub, sup, s, strike, del').forEach((el) => { if (!el.closest('.obj')) unwrap(el); });
  }
  function toggleChecklist() {
    let r = selRange(); if (!r) return;
    const inList = (n) => { const el = n.nodeType === 1 ? n : n.parentNode; return el.closest('ul, ol'); };
    let list = inList(r.startContainer);
    if (list && list.nodeName === 'UL' && list.querySelector(':scope > li > input[type=checkbox]')) {
      list.querySelectorAll(':scope > li > input[type=checkbox]').forEach((c) => { c.parentNode.classList.remove('task'); c.remove(); });
      return;
    }
    if (!list || list.nodeName !== 'UL') { exec('insertUnorderedList'); r = selRange(); list = r && inList(r.startContainer); }
    if (!list) return;
    list.querySelectorAll(':scope > li').forEach((li) => {
      if (li.querySelector(':scope > input[type=checkbox]')) return;
      const c = document.createElement('input'); c.type = 'checkbox'; li.prepend(c); li.classList.add('task');
    });
  }
  function formatBlock(tag) {
    const r = selRange(); if (!r) return;
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const bq = el.closest('blockquote');
    if (tag === 'blockquote' && bq && root.contains(bq)) { unwrap(bq); return; }
    if (tag !== 'blockquote' && bq && root.contains(bq) && tag === 'p') { unwrap(bq); }
    document.execCommand('formatBlock', false, tag);
    // a heading cannot hold a list: if the caret was in a list item, take it out of the list first
  }

  // painter
  let painter = null;
  function captureFormat() {
    const r = selRange(); if (!r) return null;
    let el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const f = { tags: new Set(), css: {} };
    while (el && el !== root && !BLOCKS.test(el.nodeName)) {
      const t = el.nodeName;
      if (t === 'B' || t === 'STRONG') f.tags.add('bold');
      if (t === 'I' || t === 'EM') f.tags.add('italic');
      if (t === 'U') f.tags.add('underline');
      if (t === 'S' || t === 'STRIKE' || t === 'DEL') f.tags.add('strikeThrough');
      if (t === 'SUB') f.tags.add('subscript');
      if (t === 'SUP') f.tags.add('superscript');
      if (t === 'CODE') f.tags.add('code');
      if (t === 'SPAN' && el.style) for (const p of ['color', 'background-color', 'font-family', 'font-size']) { const v = el.style.getPropertyValue(p); if (v && !f.css[p]) f.css[p] = v; }
      el = el.parentNode;
    }
    return f;
  }
  function applyFormat(f) {
    ed.op(() => {
      clearFormat();
      for (const t of f.tags) { if (t === 'code') toggleCode(); else exec(t); }
      if (f.css.color) exec('foreColor', SW.cssColorToHex(f.css.color), true);
      if (f.css['background-color']) exec('hiliteColor', SW.cssColorToHex(f.css['background-color']), true);
      if (f.css['font-family']) exec('fontName', f.css['font-family'].split(',')[0].replace(/['"]/g, ''), true);
      if (f.css['font-size']) setFontSize(f.css['font-size']);
    });
  }
  function onMouseUp() {
    if (!painter) return;
    setTimeout(() => {
      const s = getSelection();
      if (s.isCollapsed) return;
      const f = painter; painter = null; $('btn-painter').classList.remove('on');
      applyFormat(f);
    }, 0);
  }

  ed.cmd = function (name, val) {
    if (doc.view !== 'doc') { if (name === 'undo' || name === 'redo') ed[name](); return; }
    const inDoc = selRange();
    if (!inDoc && !/^(undo|redo)$/.test(name)) { root.focus(); }
    switch (name) {
      case 'undo': return ed.undo();
      case 'redo': return ed.redo();
      case 'bold': case 'italic': case 'underline': case 'strikeThrough': case 'subscript': case 'superscript':
      case 'justifyLeft': case 'justifyCenter': case 'justifyRight': case 'justifyFull':
      case 'insertUnorderedList': case 'insertOrderedList': case 'indent': case 'outdent':
        return ed.op(() => exec(name));
      case 'code': return ed.op(toggleCode);
      case 'clear': return ed.op(clearFormat);
      case 'checklist': return ed.op(toggleChecklist);
      case 'formatBlock': return ed.op(() => formatBlock(val));
      case 'font': return ed.op(() => { if (val) exec('fontName', val, true); else clearStyleProp('font-family'); });
      case 'size': return ed.op(() => setFontSize(val));
      case 'color': return ed.op(() => { if (val) exec('foreColor', val, true); else clearStyleProp('color'); });
      case 'hilite': return ed.op(() => { if (val) exec('hiliteColor', val, true); else clearStyleProp('background-color'); });
      case 'painter':
        if (painter) { painter = null; $('btn-painter').classList.remove('on'); return; }
        painter = captureFormat();
        if (painter) { $('btn-painter').classList.add('on'); SW.message('Now select the text that should get this formatting.'); }
        return;
      case 'marks': return ed.toggleMarks();
      case 'hr': return ed.insertNodes([document.createElement('hr')]);
      case 'pagebreak': return ed.insertNodes([SW.makePagebreak()]);
      case 'toc': return ed.insertNodes([SW.makeToc()]);
      default:
        if (SW.dlg[name]) { ed.saveRange(); return SW.dlg[name](); }
    }
  };

  /* ---------- tables ---------- */
  function cellOf(n) { const el = n && (n.nodeType === 1 ? n : n.parentNode); const c = el && el.closest && el.closest('td, th'); return c && root.contains(c) ? c : null; }
  function focusCell(c) { if (!c) return; const r = document.createRange(); r.selectNodeContents(c); r.collapse(false); root.focus({ preventScroll: true }); getSelection().removeAllRanges(); getSelection().addRange(r); }
  function moveCell(cell, dir) {
    const table = cell.closest('table'), cells = [...table.querySelectorAll('th, td')];
    const i = cells.indexOf(cell) + dir;
    if (i >= cells.length) { ed.lastCell = cell; ed.tableOp('rowBelow'); return; }
    if (i >= 0) { const r = document.createRange(); r.selectNodeContents(cells[i]); getSelection().removeAllRanges(); getSelection().addRange(r); }
  }
  const newCell = (tag, align) => { const c = document.createElement(tag); c.appendChild(document.createElement('br')); if (align) c.setAttribute('align', align); return c; };
  ed.makeTable = function (cols, rows) {
    const t = document.createElement('table');
    const th = t.createTHead().insertRow();
    for (let j = 0; j < cols; j++) th.appendChild(newCell('th'));
    const tb = t.createTBody();
    for (let i = 0; i < rows - 1; i++) { const tr = tb.insertRow(); for (let j = 0; j < cols; j++) tr.appendChild(newCell('td')); }
    return t;
  };
  ed.tableOp = function (op) {
    const r = selRange();
    const cell = (r && cellOf(r.startContainer)) || ed.lastCell;
    if (!cell || !root.contains(cell)) return;
    const tr = cell.parentNode, table = cell.closest('table'), ci = cell.cellIndex;
    if (op === 'caption') { ed.saveRange(); return SW.dlg.tableCaption(table); }
    let focus = null;
    ed.op(() => {
      const rows = [...table.rows];
      const alignOf = (i) => (rows[0] && rows[0].cells[i] && rows[0].cells[i].getAttribute('align')) || '';
      switch (op) {
        case 'rowAbove': case 'rowBelow': {
          const n = rows[0].cells.length, nr = document.createElement('tr');
          for (let j = 0; j < n; j++) nr.appendChild(newCell('td', alignOf(j)));
          const inHead = tr.parentNode.nodeName === 'THEAD';
          if (op === 'rowAbove' && !inHead) tr.before(nr);
          else if (inHead) { const tb = table.tBodies[0] || table.createTBody(); tb.prepend(nr); }
          else tr.after(nr);
          focus = nr.cells[ci]; break;
        }
        case 'colLeft': case 'colRight':
          rows.forEach((row) => { const c = newCell(row.parentNode.nodeName === 'THEAD' ? 'th' : 'td'); const ref = row.cells[ci]; if (!ref) row.appendChild(c); else if (op === 'colLeft') ref.before(c); else ref.after(c); if (row === tr) focus = c; });
          break;
        case 'delRow':
          if (rows.length <= 1) { removeTable(table); break; }
          if (tr.parentNode.nodeName === 'THEAD') {
            const next = rows[1];
            [...next.cells].forEach((c) => { const h = document.createElement('th'); for (const a of c.attributes) h.setAttribute(a.name, a.value); h.append(...c.childNodes); c.replaceWith(h); });
            tr.parentNode.appendChild(next); tr.remove(); focus = next.cells[ci];
          } else { focus = (tr.nextElementSibling || tr.previousElementSibling || rows[0]).cells[ci]; tr.remove(); }
          break;
        case 'delCol':
          if (rows[0].cells.length <= 1) { removeTable(table); break; }
          rows.forEach((row) => { if (row.cells[ci]) row.cells[ci].remove(); });
          focus = tr.cells[Math.min(ci, tr.cells.length - 1)]; break;
        case 'alignLeft': case 'alignCenter': case 'alignRight': {
          const a = op.slice(5).toLowerCase();
          rows.forEach((row) => { const c = row.cells[ci]; if (c) c.setAttribute('align', a); });
          focus = cell; break;
        }
        case 'delTable': removeTable(table); break;
      }
    });
    if (focus && focus.isConnected) focusCell(focus);
    positionBars();
  };
  function removeTable(t) {
    for (const s of [t.previousElementSibling, t.nextElementSibling]) if (s && s.classList.contains('tcap')) s.remove();
    const p = emptyP(); t.replaceWith(p); caretInto(p);
  }
  ed.imageOp = function (op) {
    const o = ed.selObj; if (!o) return;
    const img = o.nodeName === 'IMG' ? o : o.querySelector('img'); if (!img) return;
    if (op === 'edit') return SW.dlg.image(o);
    if (op === 'delete') { ed.op(() => { o.remove(); ed.deselect(); }); return; }
    if (op === 'rotl' || op === 'rotr') return SW.pic.rotate(o, op === 'rotr' ? 90 : -90);
    if (op === 'flip') return SW.pic.rotate(o, 0, true);
    if (op === 'crop') return SW.pic.crop(o);
    ed.op(() => {
      if (op.startsWith('float:')) { const v = op.slice(6); if (v === 'none') delete o.dataset.float; else o.dataset.float = v; }
      else if (op === 'auto') { delete img.dataset.width; delete img.dataset.height; }
      else { img.dataset.width = op + '%'; delete img.dataset.height; }
      SW.layoutImg(o);
    });
    ed.selectObj(o);
  };

  /* ---------- floating bars and toolbar state ---------- */
  function positionBars() {
    const tb = $('tablebar'), ib = $('imagebar'), mb = $('mediabar');
    if (doc.view !== 'doc') { tb.hidden = true; ib.hidden = true; mb.hidden = true; return; }
    const r = selRange();
    const cell = r && cellOf(r.startContainer);
    if (cell) {
      ed.lastCell = cell;
      const t = cell.closest('table').getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      tb.hidden = false;
      const top = Math.max(sr.top + 4, t.top - tb.offsetHeight - 6);
      tb.style.top = top + 'px'; tb.style.left = Math.max(sr.left + 4, Math.min(t.left, sr.right - tb.offsetWidth - 8)) + 'px';
      if (top > t.bottom) tb.hidden = true;
    } else tb.hidden = true;
    const o = ed.selObj;
    if (o && o.isConnected && (o.nodeName === 'IMG' || o.nodeName === 'FIGURE')) {
      const b = (o.querySelector('img') || o).getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      ib.hidden = false;
      const above = b.top - ib.offsetHeight - 6;
      ib.style.top = (above >= sr.top + 2 ? above : Math.min(b.bottom + 6, sr.bottom - ib.offsetHeight - 4)) + 'px';
      ib.style.left = Math.max(sr.left + 4, Math.min(b.left, sr.right - ib.offsetWidth - 8)) + 'px';
    } else ib.hidden = true;
    if (o && o.isConnected && o.classList.contains('media')) {
      const b = (o.querySelector('.mv') || o).getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      mb.hidden = false; mb.classList.toggle('audio', !!o.querySelector('audio')); mb.classList.toggle('embed', !!o.querySelector('iframe'));
      const above = b.top - mb.offsetHeight - 6;
      mb.style.top = (above >= sr.top + 2 ? above : Math.min(b.bottom + 6, sr.bottom - mb.offsetHeight - 4)) + 'px';
      mb.style.left = Math.max(sr.left + 4, Math.min(b.left, sr.right - mb.offsetWidth - 8)) + 'px';
    } else mb.hidden = true;
  }
  ed.positionBars = positionBars;
  function onSelChange() {
    if (doc.view !== 'doc') return;
    const s = getSelection();
    if (ed.selObj && !ed.selObj.classList.contains('media') && (!s.rangeCount || !s.containsNode(ed.selObj, true))) ed.deselect();   // a player moves the selection itself
    positionBars();
    const r = selRange(); if (!r) return;
    SW.ui && SW.ui.syncToolbar(r);
  }
  ed.queryState = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };

  /* ---------- the caret survives a change of view ----------
     A private-use character marks the caret. In one direction it goes into a copy of the page, which is
     converted to Markdown; in the other it goes into the Markdown, which is rendered to a throwaway page.
     Where the mark ends up gives the place in the other view. */
  const MK1 = '\uE000', MK2 = '\uE001';
  const nonWs = (s) => s.replace(/\s+/g, '').length;
  // the place in `text` that has as many non-blank characters before it as `before` has (blanks differ between the two forms)
  function posFromBefore(before, text) {
    const n = nonWs(before), tail = before.length - before.replace(/\s+$/, '').length;
    let i = 0, seen = 0;
    while (i < text.length && seen < n) { if (!/\s/.test(text[i])) seen++; i++; }
    for (let t = 0; t < tail && i < text.length && /\s/.test(text[i]); t++) i++;
    return i;
  }
  const nodeIn = (base, path) => path.reduce((n, i) => n && n.childNodes[i], base);
  function sourceCaret() {
    const text = ed.getMarkdown(), fmLen = text.length - doc.body.length;
    const r = selRange();
    if (!r) return { text, s: 0, e: 0, range: null };
    const clone = root.cloneNode(true);
    const lift = (c, o) => {                      // a position inside an object counts as just before it
      const obj = (c.nodeType === 1 ? c : c.parentNode).closest('.obj');
      return obj && obj !== root && root.contains(obj) ? [obj.parentNode, Array.prototype.indexOf.call(obj.parentNode.childNodes, obj)] : [c, o];
    };
    const put = (pos, mk) => {
      const [c, o] = lift(pos[0], pos[1]), path = pathOf(c), n = path && nodeIn(clone, path);
      if (!n) return;
      const t = document.createTextNode(mk);
      if (n.nodeType === 3) n.splitText(o).before(t); else n.insertBefore(t, n.childNodes[o] || null);
    };
    const ranged = !r.collapsed;
    if (ranged) put([r.endContainer, r.endOffset], MK2);
    put([r.startContainer, r.startOffset], MK1);
    const md = SW.toMarkdown(clone, { defaults: SW.styleDefaults() });
    const i1 = md.indexOf(MK1), i2 = ranged ? md.indexOf(MK2) : -1;
    if (i1 < 0) return { text, s: 0, e: 0, range: r.cloneRange() };
    const s = fmLen + posFromBefore(md.slice(0, i1), doc.body);
    const e = i2 >= 0 ? fmLen + posFromBefore(md.slice(0, i2).replace(MK1, ''), doc.body) : s;
    return { text, s, e: Math.max(s, e), range: r.cloneRange() };
  }
  function scrollSourceTo(pos) {
    const cs = getComputedStyle(source), m = document.createElement('div');
    m.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;width:' + source.clientWidth + 'px;font:' + cs.font + ';padding:' + cs.padding + ';tab-size:' + cs.tabSize;
    m.textContent = source.value.slice(0, pos) + '\u200b';
    document.body.appendChild(m);
    const y = m.scrollHeight - (parseFloat(cs.paddingBottom) || 0); m.remove();
    source.scrollTop = Math.max(0, y - source.clientHeight / 3);
  }
  const realBlock = (x) => !(x.nodeName === 'P' && x.childNodes.length === 1 && x.firstChild.nodeName === 'BR');
  const eligible = (n, top) => { for (let p = n.parentNode; p && p !== top; p = p.parentNode) if (p.nodeType === 1 && p.matches('.obj, .num')) return false; return true; };
  // (block number, character offset in the block) of a mark in a rendered tree, or a polluted element when the mark went into an attribute
  function whereMark(tree, mk) {
    const blocks = [...tree.children].filter(realBlock);
    const w = document.createTreeWalker(tree, NodeFilter.SHOW_TEXT);
    let node;
    while (w.nextNode()) if (w.currentNode.nodeValue.includes(mk) && eligible(w.currentNode, tree)) { node = w.currentNode; break; }
    if (node) {
      let b = node; while (b.parentNode !== tree) b = b.parentNode;
      let off = 0; const w2 = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while (w2.nextNode()) { const t = w2.currentNode; if (t === node) { off += t.nodeValue.indexOf(mk); break; } if (eligible(t, b)) off += t.nodeValue.replace(/[\uE000\uE001]/g, '').length; }
      return { block: blocks.indexOf(b), off };
    }
    for (const el of tree.querySelectorAll('*')) {
      if (![...el.attributes].some((a) => a.value.includes(mk))) continue;
      let b = el; while (b.parentNode !== tree) b = b.parentNode;
      const objs = [...b.querySelectorAll('.obj')];
      return { block: blocks.indexOf(b), self: el === b, k: objs.indexOf(el.closest('.obj')) };
    }
    return null;
  }
  function placeFromSource(md, s, e) {
    const sp = SW.splitFrontMatter(md), fmLen = md.length - sp.body.length, b = sp.body;
    const blocks = [...root.children].filter(realBlock);
    if (!blocks.length) return;
    const bs = Math.max(0, s - fmLen), be = Math.max(bs, e - fmLen);
    const marked = b.slice(0, bs) + MK1 + (be > bs ? b.slice(bs, be) + MK2 : '') + b.slice(be);
    let w1 = null, w2 = null;
    if (s >= fmLen) { const tree = SW.renderBody(marked); w1 = whereMark(tree, MK1); w2 = be > bs ? whereMark(tree, MK2) : null; }
    if (!w1 || w1.block < 0) w1 = { block: s < fmLen ? 0 : Math.min(blocks.length - 1, Math.floor(bs / Math.max(1, b.length) * blocks.length)), off: 0 };
    const blk = blocks[Math.min(w1.block, blocks.length - 1)];
    const at = (bl, off) => {
      const w = document.createTreeWalker(bl, NodeFilter.SHOW_TEXT); let last = null;
      while (w.nextNode()) { const t = w.currentNode; if (!eligible(t, bl)) continue; last = t; if (off <= t.nodeValue.length) return [t, off]; off -= t.nodeValue.length; }
      return last ? [last, last.nodeValue.length] : [bl, 0];
    };
    const sel = getSelection(), r = document.createRange();
    if (w1.off === undefined) {                    // the mark was inside an object (equation, code...)
      if (w1.self || w1.k < 0) { if (blk.matches('.obj')) { ed.selectObj(blk); return; } r.setStart(blk, 0); }
      else { const o = blk.querySelectorAll('.obj')[w1.k]; if (o) { caretAfter(o); return; } r.setStart(blk, 0); }
      r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return;
    }
    const [n1, o1] = at(blk, w1.off);
    r.setStart(n1, o1); r.collapse(true);
    if (w2 && w2.off !== undefined && w2.block >= 0) { const [n2, o2] = at(blocks[Math.min(w2.block, blocks.length - 1)], w2.off); r.setEnd(n2, o2); }
    sel.removeAllRanges(); sel.addRange(r);
  }
  function scrollCaretIntoView() {
    const s = getSelection(); if (!s.rangeCount) return;
    let rect = s.getRangeAt(0).getBoundingClientRect();
    if (!rect.height) { const el = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode); if (el) rect = el.getBoundingClientRect(); }
    const sc = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - sc.top - scroller.clientHeight / 3;
  }

  /* scroll only when the caret is off screen (after inserting something tall, say) */
  ed.reveal = function () {
    const s = getSelection(); if (!s.rangeCount || !root.contains(s.anchorNode)) return;
    const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode;
    let rect = s.getRangeAt(0).getBoundingClientRect();
    if (!rect.height && el) rect = el.getBoundingClientRect();
    const sc = scroller.getBoundingClientRect();
    if (rect.bottom > sc.bottom - 24) scroller.scrollTop += rect.bottom - sc.bottom + scroller.clientHeight / 3;
    else if (rect.top < sc.top + 24) scroller.scrollTop -= sc.top - rect.top + scroller.clientHeight / 3;
  };

  /* ---------- views ---------- */
  ed.setView = function (v) {
    if (v === doc.view) return;
    if (v === 'md') {
      const c = sourceCaret();
      doc.view = 'md';
      source.value = c.text; ed.srcOrig = c.text;
      page.hidden = true; source.hidden = false;
      $('tablebar').hidden = true; $('imagebar').hidden = true; $('mediabar').hidden = true;
      source.focus(); source.setSelectionRange(c.s, c.e);
      ed.leave = { range: c.range, s: c.s, e: c.e };
      scrollSourceTo(c.s);
    } else {
      const md = source.value, s = source.selectionStart, e = source.selectionEnd, lv = ed.leave;
      const same = md === ed.srcOrig;
      doc.view = 'doc';
      source.hidden = true; page.hidden = false;
      if (!same) ed.setMarkdown(md, true);
      root.focus();
      try {
        if (same && lv && lv.range && lv.s === s && lv.e === e && root.contains(lv.range.startContainer) && root.contains(lv.range.endContainer)) { const sl = getSelection(); sl.removeAllRanges(); sl.addRange(lv.range); }
        else placeFromSource(md, s, e);
        scrollCaretIntoView();
      } catch (err) { console.warn(err); }
    }
    SW.ui && SW.ui.viewChanged(v);
    ed.updateStats();
  };
  ed.toggleMarks = function (force) {
    const on = force === undefined ? !root.classList.contains('marks') : force;
    root.classList.toggle('marks', on);
    const b = $('btn-marks'); if (b) b.classList.toggle('on', on);
    const k = $('ck-marks'); if (k) k.classList.toggle('on', on);
    SW.store.set('sw.marks', on ? '1' : '0');
  };
  ed.root = () => root;
  ed.derived = () => derived;
})();
