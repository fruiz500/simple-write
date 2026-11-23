/* Simple Write: document (or pasted HTML) -> Markdown */
(function () {
  'use strict';
  const SW = window.SW;
  const BLOCK = /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|TABLE|FIGURE|PRE|DIV|HR|SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV|ASIDE|DL|DD|DT|THEAD|TBODY|TR|TD|TH)$/;
  const has = (n, c) => n.nodeType === 1 && n.classList && n.classList.contains(c);
  const STYLE_KEEP = ['color', 'background-color', 'font-family', 'font-size'];

  function escapeMd(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/^-(?=\s|$)/g, '\\-')
      .replace(/^\+(?= )/g, '\\+')
      .replace(/^(=+)/g, '\\$1')
      .replace(/^(#{1,6})(?= |$)/g, '\\$1')
      .replace(/`/g, '\\`')
      .replace(/^~~~/g, '\\~~~')
      .replace(/~~/g, '\\~\\~')
      .replace(/\[(?=[^\]]*\](?:\(|\[))/g, '\\[')
      .replace(/\[(?=[\^@])/g, '\\[')
      .replace(/^>/g, '\\>')
      .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
      .replace(/^(\d+)\. /g, '$1\\. ')
      .replace(/\$/g, '\\$')
      .replace(/<(?=[A-Za-z\/!?])/g, '\\<')
      .replace(/(^|[^\w.\\])@(?=(?:fig|eq|tbl|sec):)/g, '$1\\@')
      .replace(/\{(?=[=>])/g, '\\{')
      .replace(/^\|/g, '\\|');
  }

  function fence(code, lang) {
    const runs = code.match(/`{3,}/g) || [];
    const n = Math.max(3, ...runs.map((r) => r.length + 1));
    const f = '`'.repeat(n);
    return '\n\n' + f + (lang || '') + '\n' + code.replace(/\n$/, '') + '\n' + f + '\n\n';
  }
  const mdAlt = (t) => String(t || '').replace(/\s+/g, ' ').trim().replace(/([\\\[\]])/g, '\\$1');
  const mdUrl = (u) => /[\s()<>]/.test(u) ? '<' + u.replace(/>/g, '%3E') + '>' : u;
  const attrs = (id, width, fl, height) => { const a = []; if (id) a.push('#' + id); if (width) a.push('width=' + width); if (height) a.push('height=' + height); if (fl) a.push('float=' + fl); return a.length ? '{' + a.join(' ') + '}' : ''; };
  const imgSrc = (img) => {
    let s = img.getAttribute('data-src') || img.getAttribute('src') || '';
    if (/^blob:/.test(s) && SW.assetNameForUrl) s = SW.assetNameForUrl(s) || s;
    return s;
  };

  function makeService(ctx) {
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', hr: '---', br: '\\' });
    td.escape = escapeMd;
    td.remove((n) => has(n, 'num') || has(n, 'derived') || n.nodeName === 'STYLE' || n.nodeName === 'SCRIPT');

    td.addRule('strike', { filter: ['del', 's', 'strike'], replacement: (c) => c.trim() ? '~~' + c + '~~' : '' });
    td.addRule('html-inline', {
      filter: (n) => /^(U|SUB|SUP|MARK|INS)$/.test(n.nodeName),
      replacement: (c, n) => { const t = n.nodeName === 'INS' ? 'u' : n.nodeName.toLowerCase(); return c ? '<' + t + '>' + c + '</' + t + '>' : ''; }
    });
    td.addRule('styled-span', {
      filter: (n) => n.nodeName === 'SPAN' && !!n.getAttribute('style') && !has(n, 'obj'),
      replacement: (c, n) => c ? '<span style="' + n.getAttribute('style').replace(/"/g, "'") + '">' + c + '</span>' : ''
    });
    td.addRule('heading', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: (c, n) => {
        const t = c.replace(/\\\n/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
        return t ? '\n\n' + '#'.repeat(+n.nodeName[1]) + ' ' + t + (n.dataset && n.dataset.id ? ' {#' + n.dataset.id + '}' : '') + '\n\n' : '';
      }
    });
    td.addRule('list-item', {
      filter: 'li',
      replacement: (c, n) => {
        c = c.replace(/^\n+/, '').replace(/\n+$/, '\n');
        const p = n.parentNode;
        let prefix = '- ';
        if (p && p.nodeName === 'OL') {
          const start = parseInt(p.getAttribute('start') || '1', 10) || 1;
          prefix = (start + [...p.children].filter((x) => x.nodeName === 'LI').indexOf(n)) + '. ';
        }
        c = c.replace(/^(\[[ x]\]) +/, '$1 ');
        const ind = ' '.repeat(prefix.length);
        c = c.replace(/\n/g, '\n' + ind).replace(/\n +(?=\n|$)/g, '\n');
        return prefix + c + (n.nextSibling && !/\n$/.test(c) ? '\n' : '');
      }
    });
    td.addRule('task', { filter: (n) => n.nodeName === 'INPUT' && (n.getAttribute('type') || '').toLowerCase() === 'checkbox', replacement: (c, n) => (n.hasAttribute('checked') || n.checked) ? '[x] ' : '[ ] ' });
    // tables
    td.addRule('table-cell', {
      filter: ['th', 'td'],
      replacement: (c) => ' ' + c.trim().replace(/\\\n/g, '<br>').replace(/\s*\n\s*\n?\s*/g, '<br>').replace(/(^|[^\\])\|/g, '$1\\|') + ' |'
    });
    td.addRule('table-row', {
      filter: 'tr',
      replacement: (c, n) => {
        const table = n.closest('table');
        const first = table && table.rows[0] === n;
        let out = '\n|' + c;
        if (first) {
          const map = { left: ':--', right: '--:', center: ':-:' };
          out += '\n|' + [...n.cells].map((cell) => ' ' + (map[(cell.getAttribute('align') || cell.style.textAlign || '').toLowerCase()] || '---') + ' |').join('');
        }
        return out;
      }
    });
    td.addRule('table-section', { filter: ['thead', 'tbody', 'tfoot'], replacement: (c) => c });
    td.addRule('table', { filter: 'table', replacement: (c) => '\n\n' + c.replace(/^\n+/, '') + '\n\n' });
    td.addRule('caption-el', { filter: 'caption', replacement: () => '' });
    // alignment wrappers made in prep()
    td.addRule('align', { filter: (n) => n.nodeName === 'DIV' && n.hasAttribute('data-align'), replacement: (c, n) => '\n\n<div align="' + n.getAttribute('data-align') + '">\n\n' + c.trim() + '\n\n</div>\n\n' });
    // objects
    td.addRule('table-caption', {
      filter: (n) => has(n, 'tcap'),
      replacement: (c, n) => { const t = c.replace(/\s*\n\s*/g, ' ').trim(); return t || n.dataset.id ? '\n\n: ' + t + (n.dataset.id ? ' {#' + n.dataset.id + '}' : '') + '\n\n' : ''; }
    });
    td.addRule('math', {
      filter: (n) => has(n, 'math') && n.hasAttribute('data-tex'),
      replacement: (c, n) => {
        let tex = (n.getAttribute('data-tex') || '').trim();
        if (!tex) return '';
        if (n.closest && n.closest('td,th')) tex = tex.replace(/\\\|/g, '\\Vert ').replace(/\|/g, '\\vert ');
        if (has(n, 'display')) return '\n\n$$\n' + tex + '\n$$' + (n.dataset.id ? ' {#' + n.dataset.id + '}' : '') + '\n\n';
        return '$' + tex.replace(/\n+/g, ' ') + '$';
      }
    });
    td.addRule('footnote', {
      filter: (n) => has(n, 'fn'),
      replacement: (c, n) => { ctx.notes.push(n.getAttribute('data-note') || ''); return '[^' + ctx.notes.length + ']'; }
    });
    td.addRule('xref', { filter: (n) => has(n, 'xref') && n.dataset.ref, replacement: (c, n) => '@' + n.dataset.ref });
    td.addRule('cite', { filter: (n) => has(n, 'cite') && n.dataset.keys, replacement: (c, n) => '[' + n.dataset.keys.split(';').filter(Boolean).map((k) => '@' + k).join('; ') + ']' });
    td.addRule('comment', {
      filter: (n) => n.nodeName === 'MARK' && has(n, 'comment'),
      replacement: (c, n) => { const t = (n.getAttribute('data-comment') || '').replace(/<</g, '< <'); return c ? '{==' + c + '==}{>>' + t + '<<}' : '{>>' + t + '<<}'; }
    });
    td.addRule('comment-pin', { filter: (n) => has(n, 'cpin'), replacement: (c, n) => '{>>' + (n.getAttribute('data-comment') || '').replace(/<</g, '< <') + '<<}' });
    td.addRule('figure', {
      filter: (n) => n.nodeName === 'FIGURE',
      replacement: (c, n) => {
        const img = n.querySelector('img');
        if (!img) return c;
        const capEl = n.querySelector('figcaption .cap') || n.querySelector('figcaption');
        const cap = capEl ? capEl.textContent : img.getAttribute('alt') || '';
        return '\n\n![' + mdAlt(cap) + '](' + mdUrl(imgSrc(img)) + ')' + attrs(n.dataset.id, img.dataset.width || '', n.dataset.float || '', img.dataset.height || '') + '\n\n';
      }
    });
    td.addRule('image', {
      filter: 'img',
      replacement: (c, n) => { const s = imgSrc(n); return s ? '![' + mdAlt(n.getAttribute('alt')) + '](' + mdUrl(s) + ')' + attrs('', n.dataset.width || '', n.dataset.float || '', n.dataset.height || '') : ''; }
    });
    td.addRule('media', { filter: (n) => has(n, 'media'), replacement: (c, n) => {
      const fr = n.querySelector('iframe');
      if (fr) return '\n\n<iframe src="' + (fr.getAttribute('data-src') || '').replace(/"/g, '%22') + '"' + (fr.getAttribute('data-width') ? ' width="' + fr.getAttribute('data-width') + '"' : '') + (n.getAttribute('data-float') ? ' data-float="' + n.getAttribute('data-float') + '"' : '') + ' allowfullscreen></iframe>\n\n';
      const m = n.querySelector('video, audio'); if (!m) return '';
      const w = m.getAttribute('data-width') || '', rot = m.getAttribute('data-rotate') || '', crop = m.getAttribute('data-crop') || '', fl = n.getAttribute('data-float') || '';
      return '\n\n<' + m.nodeName.toLowerCase() + ' src="' + (m.getAttribute('data-src') || '').replace(/"/g, '%22') + '" controls' + (w ? ' width="' + w + '"' : '') + (rot ? ' data-rotate="' + rot + '"' : '') + (crop ? ' data-crop="' + crop + '"' : '') + (fl ? ' data-float="' + fl + '"' : '') + '></' + m.nodeName.toLowerCase() + '>\n\n';
    } });
    td.addRule('code-block', { filter: (n) => has(n, 'code-block'), replacement: (c, n) => fence(n.getAttribute('data-code') || '', n.getAttribute('data-lang') || '') });
    td.addRule('tab', { filter: (n) => n.nodeName === 'SPAN' && n.classList && n.classList.contains('tab'), replacement: () => '&#9;' });
    td.addRule('pagebreak', { filter: (n) => has(n, 'pagebreak'), replacement: () => '\n\n<div style="page-break-after: always;"></div>\n\n' });
    td.addRule('toc', { filter: (n) => has(n, 'toc'), replacement: (c, n) => '\n\n<!-- toc -->\n' + (n.getAttribute('data-md') || '') + '\n<!-- tocstop -->\n\n' });
    td.addRule('pre', {
      filter: (n) => n.nodeName === 'PRE',
      replacement: (c, n) => { const code = n.querySelector('code'); const lang = code ? ((code.className.match(/language-(\S+)/) || [])[1] || '') : ''; return fence((code || n).textContent, lang); }
    });
    return td;
  }

  /* ---------- clean the copy before conversion ---------- */
  function prep(root, opts) {
    const doc = root.ownerDocument;
    // Turndown skips empty elements: give objects a zero-width character (their rules ignore the content)
    root.querySelectorAll('.math, .fn, .cite, .xref, .cpin, .pagebreak, .code-block, .tab').forEach((n) => { if (!n.textContent) n.textContent = '\u200B'; });
    root.querySelectorAll('.num, .derived, .toc-title').forEach((n) => n.remove());
    root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    // <font> from execCommand
    root.querySelectorAll('font').forEach((f) => {
      const s = doc.createElement('span');
      if (f.getAttribute('color')) s.style.color = f.getAttribute('color');
      if (f.getAttribute('face')) s.style.fontFamily = f.getAttribute('face');
      while (f.firstChild) s.appendChild(f.firstChild);
      f.replaceWith(s);
    });
    // non-breaking spaces from typing, outside objects
    const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const t = w.currentNode; if (t.nodeValue.includes(' ') && !(t.parentNode.closest && t.parentNode.closest('.obj, pre, code'))) t.nodeValue = t.nodeValue.replace(/ /g, ' '); }
    // plain <div>s (the browser makes them on Enter in some cases) are paragraphs
    root.querySelectorAll('div:not([class]):not([data-align])').forEach((d) => {
      if ([...d.children].some((k) => BLOCK.test(k.nodeName))) { d.replaceWith(...d.childNodes); return; }
      const p = doc.createElement('p'); p.setAttribute('style', d.getAttribute('style') || ''); if (!p.getAttribute('style')) p.removeAttribute('style');
      while (d.firstChild) p.appendChild(d.firstChild); d.replaceWith(p);
    });
    // lists nested directly in lists belong to the previous item
    root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach((l) => {
      const prev = l.previousElementSibling;
      if (prev && prev.nodeName === 'LI') prev.appendChild(l);
      else { const li = doc.createElement('li'); l.before(li); li.appendChild(l); }
    });
    // trailing <br> in blocks, empty blocks
    root.querySelectorAll('br').forEach((br) => {
      let n = br.nextSibling; while (n && n.nodeType === 3 && !n.nodeValue.trim()) n = n.nextSibling;
      const p = br.parentNode;
      if (!n && p && p !== root && (BLOCK.test(p.nodeName) || p.nodeName === 'SPAN' || p.nodeName === 'B' || p.nodeName === 'STRONG' || p.nodeName === 'I' || p.nodeName === 'EM')) br.remove();
    });
    root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote').forEach((b) => {
      if (!b.textContent.trim() && !b.querySelector('img, .obj, input, table, br, ul, ol, .tab')) b.remove();
    });
    // styled spans: keep only meaningful styles that differ from the page defaults
    const defs = opts.defaults || {};
    root.querySelectorAll('span[style]').forEach((s) => {
      if (has(s, 'obj')) return;
      if (opts.foreign) { s.removeAttribute('style'); return; }
      const keep = [];
      for (const prop of STYLE_KEEP) {
        let v = s.style.getPropertyValue(prop);
        if (!v || /^(inherit|initial|unset|normal|transparent)$/.test(v)) continue;
        if (/color/.test(prop)) { v = SW.cssColorToHex(v); if (v === 'transparent') continue; }
        if (prop === 'font-family') v = v.replace(/"/g, "'");
        if (defs[prop] && defs[prop] === v) continue;
        keep.push(prop + ': ' + v);
      }
      if (keep.length) s.setAttribute('style', keep.join('; ')); else s.removeAttribute('style');
    });
    // paragraph alignment
    const ALIGN = { center: 'center', right: 'right', justify: 'justify' };
    root.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((b) => {
      const a = ALIGN[(b.style.textAlign || b.getAttribute('align') || '').toLowerCase()];
      b.style.textAlign = ''; b.removeAttribute('align');
      if (!b.getAttribute('style')) b.removeAttribute('style');
      if (!a || opts.foreign || b.closest('li, td, th, blockquote')) return;
      const prev = b.previousElementSibling;
      if (prev && prev.getAttribute('data-align') === a) { prev.appendChild(b); return; }
      const wrap = doc.createElement('div'); wrap.setAttribute('data-align', a);
      b.before(wrap); wrap.appendChild(b);
    });
    // table of contents as a plain list
    root.querySelectorAll('.toc').forEach((toc) => {
      const items = [...root.querySelectorAll('h1, h2, h3')].filter((h) => !h.closest('.toc'));
      const min = Math.min(...items.map((h) => +h.nodeName[1]), 9);
      toc.setAttribute('data-md', items.map((h) => '  '.repeat(+h.nodeName[1] - min) + '- [' + mdAlt(h.textContent) + '](#' + SW.slug(h.textContent) + ')').join('\n'));
      toc.textContent = '\u200B';
    });
    // tables: header row and plain cells
    root.querySelectorAll('table').forEach((t) => {
      SW.cleanTable(t);
      const first = t.rows[0];
      if (first) [...first.cells].forEach((c) => { if (c.nodeName === 'TD') { const th = doc.createElement('th'); for (const a of c.attributes) th.setAttribute(a.name, a.value); while (c.firstChild) th.appendChild(c.firstChild); c.replaceWith(th); } });
      t.querySelectorAll('th').forEach((c) => { const k = [...c.childNodes].filter((n) => n.nodeType === 1 || n.nodeValue.trim()); if (k.length === 1 && /^(STRONG|B)$/.test(k[0].nodeName)) k[0].replaceWith(...k[0].childNodes); });
      t.querySelectorAll('td, th').forEach((c) => c.querySelectorAll('p, div').forEach((p) => { if (p.nextSibling) p.after(doc.createElement('br')); p.replaceWith(...p.childNodes); }));
      t.querySelectorAll('td table, th table').forEach((inner) => inner.replaceWith(doc.createTextNode(inner.textContent)));
    });
  }

  // root: an element (left untouched). Returns the Markdown body (no front matter).
  SW.toMarkdown = function (root, opts) {
    opts = opts || {};
    const copy = root.cloneNode(true);
    prep(copy, opts);
    const ctx = { notes: [] };
    let md = makeService(ctx).turndown(copy);
    md = md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (ctx.notes.length) md += '\n\n' + ctx.notes.map((t, i) => '[^' + (i + 1) + ']: ' + t.trim().replace(/\n/g, '\n    ')).join('\n');
    return md ? md + '\n' : '';
  };

  /* ---------- pasted or imported HTML -> Markdown ---------- */
  const MATH_SELECTOR = '.math[data-tex], .katex-display, .katex, mjx-container, .MathJax_Display, script[type^="math/tex"], math, [data-tex], img[alt]';
  const MATH_LEFTOVERS = '.MathJax_Preview, .MathJax, .MathJax_SVG, .MathJax_CHTML, .MathJax_Display, .katex-html, mjx-assistive-mml, noscript, style, meta, link, title, head > *';

  SW.normalizeHtml = function (html, opts) {
    opts = opts || {};
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    const ours = !!body.querySelector('[data-sw]');
    body.querySelectorAll('script:not([type^="math/tex"]), template, iframe, object, embed, form, button, select, textarea, svg:not(.obj svg)').forEach((n) => n.remove());
    body.querySelectorAll('.derived').forEach((n) => n.remove());
    // equations of every kind become <span class="math" data-tex>
    const alone = (el) => { const b = el.closest('p, div, li, td, th, dd, blockquote') || body; return b !== el && b.textContent.replace(/\s+/g, '') === el.textContent.replace(/\s+/g, ''); };
    const mathText = (el) => {
      const ann = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"], annotation[encoding="TeX"]');
      if (ann) return ann.textContent;
      const mm = el.localName === 'math' ? el : el.querySelector('math');
      return mm ? SW.mmlToTex(mm) : null;
    };
    for (const el of [...body.querySelectorAll(MATH_SELECTOR)]) {
      if (!el.isConnected) continue;
      let tex = null, display = false, id = '';
      if (el.matches('.math[data-tex]')) { tex = el.getAttribute('data-tex'); display = el.classList.contains('display'); id = el.getAttribute('data-id') || ''; }
      else if (el.matches('img')) {
        const m = (el.getAttribute('alt') || '').match(/^\{\\(?:displaystyle|textstyle)\s+([\s\S]*)\}$/);
        if (!m) continue;
        tex = m[1]; display = alone(el);
      } else if (el.matches('script')) { tex = el.textContent; display = /mode=display/.test(el.getAttribute('type')); }
      else if (el.hasAttribute('data-tex')) { tex = el.getAttribute('data-tex'); display = el.matches('div, p') || alone(el); }
      else if (el.matches('.katex, .katex-display')) { tex = mathText(el); display = el.matches('.katex-display') || !!el.closest('.katex-display'); }
      else if (el.matches('mjx-container, .MathJax_Display')) {
        const sc = el.querySelector('script[type^="math/tex"]');
        tex = sc ? sc.textContent : mathText(el);
        display = el.getAttribute('display') === 'true' || el.matches('.MathJax_Display');
      } else if (el.matches('math')) { tex = mathText(el); display = el.getAttribute('display') === 'block' || alone(el); }
      if (tex == null || !String(tex).trim()) continue;
      const m = doc.createElement(display ? 'div' : 'span');
      m.className = 'math' + (display ? ' display' : '');
      m.setAttribute('data-tex', SW.cleanTex(tex));
      if (id) m.setAttribute('data-id', id);
      el.replaceWith(m);
    }
    body.querySelectorAll(MATH_LEFTOVERS).forEach((n) => n.remove());
    // pictures: our own assets, embedded data, or web addresses
    body.querySelectorAll('img').forEach((img) => {
      const ds = img.getAttribute('data-src'), src = img.getAttribute('src') || '';
      if (ds && SW.hasAsset && SW.hasAsset(ds)) { img.setAttribute('src', ds); return; }
      if (/^data:image\//.test(src) && SW.addAssetBlob) {
        const blob = SW.dataUrlToBlob(src);
        if (blob) { const name = SW.addAssetBlob(blob, ds ? ds.split('/').pop() : 'pasted'); img.setAttribute('data-src', name); img.setAttribute('src', name); return; }
      }
      if (/^(blob:|file:)/.test(src) || !src) { img.replaceWith(doc.createTextNode('[picture]')); return; }
      img.removeAttribute('data-src');
    });
    if (!ours) {
      // Google Docs and Word mark formatting with styles
      body.querySelectorAll('b[id^="docs-internal-guid"]').forEach((n) => n.replaceWith(...n.childNodes));
      body.querySelectorAll('span[style]').forEach((n) => {
        const st = n.getAttribute('style') || '';
        const wrap = [];
        if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) wrap.push('strong');
        if (/font-style:\s*italic/i.test(st)) wrap.push('em');
        if (/text-decoration[^;]*underline/i.test(st)) wrap.push('u');
        if (/text-decoration[^;]*line-through/i.test(st)) wrap.push('s');
        if (/vertical-align:\s*super/i.test(st)) wrap.push('sup');
        if (/vertical-align:\s*sub/i.test(st)) wrap.push('sub');
        let inner = [...n.childNodes];
        for (const t of wrap.reverse()) { const e = doc.createElement(t); e.append(...inner); inner = [e]; }
        n.replaceChildren(...inner);
        n.removeAttribute('style');
      });
      body.querySelectorAll('[class]').forEach((n) => { if (!/\b(math|display)\b/.test(n.className)) n.removeAttribute('class'); });
      body.querySelectorAll('p.MsoTitle, p[class*="Title"]').forEach((p) => { const h = doc.createElement('h1'); h.append(...p.childNodes); p.replaceWith(h); });
    }
    // footnotes made by mammoth (Word import)
    body.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]').forEach((a) => {
      const li = body.querySelector(CSS.escape ? '#' + CSS.escape(a.getAttribute('href').slice(1)) : a.getAttribute('href'));
      if (!li) return;
      const c = li.cloneNode(true);
      c.querySelectorAll('a[href^="#footnote-ref"], a[href^="#endnote-ref"]').forEach((b) => b.remove());
      const note = SW.toMarkdown(c, { foreign: true }).replace(/\s*\n\s*/g, ' ').trim();
      const sup = doc.createElement('sup'); sup.className = 'fn'; sup.setAttribute('data-note', note);
      (a.parentNode.nodeName === 'SUP' ? a.parentNode : a).replaceWith(sup);
    });
    body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').forEach((li) => { const ol = li.parentNode; li.remove(); if (ol && !ol.children.length) ol.remove(); });
    return { body, ours };
  };

  SW.htmlToMarkdown = function (html, opts) {
    const r = SW.normalizeHtml(html, opts);
    return SW.toMarkdown(r.body, { foreign: !r.ours, defaults: SW.styleDefaults ? SW.styleDefaults() : {} });
  };
})();
