/* Simple Write: headers and footers.
   Front matter: header, footer (text; "left | center | right" puts text in three places; {page} {pages} {title} {author} {date}
   are filled in), pagenumbers (adds {page}), skipfirst (nothing on the first page).
   On screen they are drawn on the page at each page break (page numbers there count the page breaks; the true page numbers
   come out in print, PDF and Word). */
(function () {
  'use strict';
  const SW = window.SW, H = SW.hf = {};
  const q = (t) => '"' + String(t).replace(/["\\]/g, '\\$&').replace(/\s+/g, ' ') + '"';

  H.zones = function (str) {
    str = String(str || '');
    if (!str.includes('|')) return ['', str.trim(), ''];
    const p = str.split('|').map((x) => x.trim());
    return [p[0] || '', p[1] || '', p.slice(2).join(' | ')];
  };
  H.effective = function (s) {
    const head = H.zones(s.header), foot = H.zones(s.footer);
    if (s.pagenum && !/\{page\}/.test(s.header + s.footer)) {
      if (!s.footer) foot[1] = '{page}'; else if (!foot[2]) foot[2] = '{page}'; else foot[2] += ' {page}';
    }
    return { head, foot, skipFirst: !!s.skipfirst, any: head.some(Boolean) || foot.some(Boolean), hasHead: head.some(Boolean), hasFoot: foot.some(Boolean) };
  };
  H.ctx = function (meta, root) {
    const h1 = root && root.querySelector && root.querySelector('h1');
    return { title: String(meta.title || (h1 && h1.textContent) || '').trim(), author: String(meta.author || ''), date: String(meta.date || new Date().toLocaleDateString()) };
  };
  H.text = (t, c) => String(t).replace(/\{(page|pages|title|author|date)\}/g, (m, k) => (c[k] != null ? String(c[k]) : ''));

  // print and PDF: page margin boxes
  const NAMES = ['left', 'center', 'right'];
  H.cssContent = function (t, c) {
    const out = [];
    String(t).split(/(\{page\}|\{pages\})/).forEach((p) => {
      if (p === '{page}') out.push('counter(page)'); else if (p === '{pages}') out.push('counter(pages)'); else if (p) out.push(q(H.text(p, c)));
    });
    return out.join(' ') || 'none';
  };
  H.printCss = function (s, meta, root) {
    const e = H.effective(s), c = H.ctx(meta, root);
    let inner = '', first = '';
    e.head.forEach((t, i) => { if (t) { inner += ' @top-' + NAMES[i] + ' { content: ' + H.cssContent(t, c) + '; font: 9pt sans-serif; color: #555; }'; first += ' @top-' + NAMES[i] + ' { content: none; }'; } });
    e.foot.forEach((t, i) => { if (t) { inner += ' @bottom-' + NAMES[i] + ' { content: ' + H.cssContent(t, c) + '; font: 10pt sans-serif; }'; first += ' @bottom-' + NAMES[i] + ' { content: none; }'; } });
    return { inner, after: e.skipFirst && first ? ' @page :first {' + first + ' }' : '' };
  };

  // the editor: rows (and the gaps between automatic pages) drawn on the page, outside the document itself
  H.layer = function () {
    const page = SW.$('page');
    let L = SW.$('hf-layer');
    if (!L) { L = document.createElement('div'); L.id = 'hf-layer'; L.className = 'hf-layer'; L.setAttribute('contenteditable', 'false'); L.setAttribute('aria-hidden', 'true'); page.appendChild(L); }
    return L;
  };
  H.paint = function (bounds, total) {
    const page = SW.$('page'), root = SW.$('doc'); if (!page || !root) return;
    const L = H.layer(); L.textContent = '';
    const s = SW.ed.settings(), e = H.effective(s);
    bounds = bounds || []; total = total || bounds.length + 1;
    const cs = getComputedStyle(page), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom), pl = cs.paddingLeft, pr = cs.paddingRight;
    bounds.forEach((b) => { if (b.band) { const d = document.createElement('div'); d.className = 'hf-band'; d.style.top = b.band.top + 'px'; d.style.height = b.band.h + 'px'; L.appendChild(d); } });
    if (!e.any || SW.doc.view !== 'doc') return;
    const ctx = H.ctx(SW.doc.fm.meta, root);
    const add = (zones, y, n) => {
      if (!zones.some(Boolean) || (n === 1 && e.skipFirst)) return;
      const row = document.createElement('div'); row.className = 'hf-row'; row.style.top = y + 'px'; row.style.left = pl; row.style.right = pr;
      zones.forEach((z) => { const sp = document.createElement('span'); sp.textContent = H.text(z, Object.assign({ page: n, pages: total }, ctx)); row.appendChild(sp); });
      L.appendChild(row);
    };
    add(e.head, pt / 2, 1);
    bounds.forEach((b) => { add(e.foot, b.foot, b.end); add(e.head, b.head, b.end + 1); });
    add(e.foot, page.offsetHeight - pb / 2, total);
  };
  H.paintSoon = () => SW.pg.schedule();
  window.addEventListener('load', () => {
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => SW.pg.heightChanged()); ro.observe(SW.$('doc')); ro.observe(SW.$('page')); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => SW.pg.schedule());
  });
})();
