/* Simple Write: reading a Word (.docx) file into HTML, which import.js then turns into Markdown.
   A .docx is a zip of XML files; this reads the parts that matter for a Markdown document:
   headings, paragraphs and their bold/italic/underline/strike/sub/superscript, lists, tables, links, pictures,
   shapes and charts, footnotes, endnotes, comments and page breaks. Equations (OMML) become LaTeX through SW.ommlToTex. */
(function () {
  'use strict';
  const SW = window.SW;
  const NSW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NSM = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const NSA = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NSPIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const NSWP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const esc = (t) => SW.esc(t);
  const ln = (n) => n.localName;
  const ch = (n) => [...n.children];
  const first = (n, name) => (n ? ch(n).find((c) => ln(c) === name) || null : null);
  const wattr = (n, name) => { const v = n.getAttributeNS(NSW, name); return v === null ? n.getAttribute('w:' + name) : v; };
  const wv = (n) => (n ? wattr(n, 'val') : null);
  const on = (n) => { if (!n) return undefined; const v = wv(n); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); };
  const MONO = /^(courier|consolas|lucida console|monaco|menlo|source code|dejavu sans mono|liberation mono|andale mono|fixedsys)/i;

  /* ---------- styles and numbering ---------- */
  function rprops(rpr) {
    const o = {};
    for (const c of ch(rpr)) {
      switch (ln(c)) {
        case 'b': o.b = on(c); break;
        case 'i': o.i = on(c); break;
        case 'u': o.u = on(c); break;
        case 'strike': case 'dstrike': o.s = on(c); break;
        case 'vertAlign': o.v = wv(c); break;
        case 'rFonts': o.font = c.getAttributeNS(NSW, 'ascii') || c.getAttribute('w:ascii') || ''; break;
        case 'rStyle': o.rstyle = wv(c); break;
        default: break;
      }
    }
    return o;
  }
  const numOf = (ppr) => {
    const np = first(ppr, 'numPr'); if (!np) return null;
    const id = first(np, 'numId'), lv = first(np, 'ilvl');
    return { id: id ? wv(id) : null, lvl: lv ? +wv(lv) : null };
  };
  function parseStyles(doc) {
    const S = new Map();
    if (!doc) return S;
    for (const st of doc.getElementsByTagNameNS(NSW, 'style')) {
      const ppr = first(st, 'pPr'), rpr = first(st, 'rPr'), ol = ppr && first(ppr, 'outlineLvl');
      S.set(wattr(st, 'styleId'), { name: wv(first(st, 'name')) || '', based: wv(first(st, 'basedOn')), num: ppr ? numOf(ppr) : null, outline: ol ? +wv(ol) : null, r: rpr ? rprops(rpr) : {} });
    }
    return S;
  }
  function parseNumbering(doc) {
    const abs = new Map(), nums = new Map();
    if (doc) {
      for (const a of doc.getElementsByTagNameNS(NSW, 'abstractNum')) {
        const lv = {};
        for (const l of ch(a)) if (ln(l) === 'lvl') lv[+wattr(l, 'ilvl')] = { fmt: wv(first(l, 'numFmt')) || 'decimal', start: +(wv(first(l, 'start')) || 1) };
        abs.set(wattr(a, 'abstractNumId'), lv);
      }
      for (const n of doc.getElementsByTagNameNS(NSW, 'num')) {
        const ov = {};
        for (const o of ch(n)) if (ln(o) === 'lvlOverride') { const so = first(o, 'startOverride'); if (so) ov[+wattr(o, 'ilvl')] = +wv(so); }
        nums.set(wattr(n, 'numId'), { abs: wv(first(n, 'abstractNumId')), ov });
      }
    }
    return (numId, il) => {
      const n = nums.get(numId); if (!n) return null;
      const lv = (abs.get(n.abs) || {})[il] || (abs.get(n.abs) || {})[0] || { fmt: 'decimal', start: 1 };
      return { ordered: !/^(bullet|none)$/.test(lv.fmt), start: n.ov[il] !== undefined ? n.ov[il] : lv.start };
    };
  }

  /* ---------- the reader ---------- */
  SW.readDocx = async function (zip, env) {
    const parse = async (name) => { const f = zip.file(name); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const docX = await parse('word/document.xml'); if (!docX) throw new Error('This is not a Word document.');
    const S = parseStyles(await parse('word/styles.xml'));
    const numLevel = parseNumbering(await parse('word/numbering.xml'));
    const fnX = await parse('word/footnotes.xml'), enX = await parse('word/endnotes.xml'), cmX = await parse('word/comments.xml');
    const relsX = await parse('word/_rels/document.xml.rels'), rels = {};
    if (relsX) for (const r of relsX.getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = { target: r.getAttribute('Target'), ext: r.getAttribute('TargetMode') === 'External' };
    const themeX = await parse('word/theme/theme1.xml');
    env = Object.assign({ zip, rels, theme: themeX }, env || {});

    /* style helpers */
    const chain = (id) => { const out = [], seen = new Set(); while (id && S.has(id) && !seen.has(id)) { seen.add(id); out.unshift(S.get(id)); id = S.get(id).based; } return out; };
    const styleInfo = (id) => {
      const c = chain(id), r = {}; let level = 0, kind = '', num = null;
      c.forEach((s) => { Object.assign(r, s.r); if (s.num && s.num.id !== null) num = s.num; });
      for (const s of c.slice().reverse()) {
        const nm = s.name.toLowerCase();
        let m = nm.match(/^heading\s*(\d)/);
        if (m) { level = +m[1]; break; }
        if (nm === 'title') { level = 1; break; }
        if (nm === 'subtitle') { level = 2; break; }
        if (s.outline !== null && s.outline < 9) { level = s.outline + 1; break; }
        if (/^(quote|intense quote|block text)$/.test(nm)) { kind = 'quote'; break; }
        if (/^(code|html preformatted|source code|preformatted text|plain text)$/.test(nm) && nm !== 'plain text') { kind = 'code'; break; }
        if (/^caption$/.test(nm)) { kind = 'caption'; break; }
        if (/^(toc \d|toc heading|table of contents|header|footer)/.test(nm)) { kind = 'skip'; break; }
        m = nm.match(/^list (bullet|number)/); if (m) { kind = 'list-' + m[1]; break; }
      }
      return { r, level, kind, num };
    };
    const charProps = (rstyle) => { const o = {}; chain(rstyle).forEach((s) => Object.assign(o, s.r)); return o; };

    /* notes and comments */
    const notes = [], commentTxt = new Map();
    if (cmX) {
      for (const c of cmX.getElementsByTagNameNS(NSW, 'comment')) {
        const text = [...c.getElementsByTagNameNS(NSW, 'p')].map((p) => [...p.getElementsByTagNameNS(NSW, 't')].map((t) => t.textContent).join('')).filter(Boolean).join(' ');
        const who = c.getAttributeNS(NSW, 'author') || c.getAttribute('w:author') || '';
        commentTxt.set(wattr(c, 'id'), (who && !/:/.test(who) ? who + ': ' : '') + text);
      }
    }
    const counters = new Map();                    // list numbering: next number per list and level
    const ctx = { fieldDepth: 0, tocDepth: 0, fieldStack: [] };

    /* ----- inline content: runs -> tokens ----- */
    function runProps(r, pRun) {
      const rpr = first(r, 'rPr'), d = rpr ? rprops(rpr) : {};
      const cs = d.rstyle ? charProps(d.rstyle) : {};
      const m = Object.assign({}, pRun, cs, d);
      const f = {};
      if (m.b) f.b = 1; if (m.i) f.i = 1; if (m.u) f.u = 1; if (m.s) f.s = 1;
      if (m.v === 'superscript') f.sup = 1; else if (m.v === 'subscript') f.sub = 1;
      if (m.font && MONO.test(m.font)) f.code = 1;
      return f;
    }
    function drawingHtml(d) { return (env.drawings && env.drawings.get(d)) || ''; }
    function inline(par, pRun, out) {
      for (const n of ch(par)) {
        switch (ln(n)) {
          case 'r': run(n, pRun, out); break;
          case 'hyperlink': {
            const rid = n.getAttributeNS(NSR, 'id') || n.getAttribute('r:id'), r = rid && rels[rid];
            const sub = []; inline(n, pRun, sub);
            if (r && r.ext && /^(https?:|mailto:)/i.test(r.target)) out.push({ t: 'link', href: r.target, kids: sub }); else out.push(...sub);
            break;
          }
          case 'fldSimple': {
            const sub = []; inline(n, pRun, sub);
            const m = (wattr(n, 'instr') || '').match(/^\s*HYPERLINK\s+"([^"]+)"/i);
            if (m && /^(https?:|mailto:)/i.test(m[1])) out.push({ t: 'link', href: m[1], kids: sub }); else out.push(...sub);
            break;
          }
          case 'ins': case 'moveTo': case 'smartTag': case 'customXml': case 'sdtContent': case 'sdt': case 'dir': case 'bdo': {
            inline(ln(n) === 'sdt' ? (first(n, 'sdtContent') || n) : n, pRun, out); break;
          }
          case 'oMath': math(n, false, out); break;
          case 'oMathPara': math(n, true, out); break;
          case 'commentRangeStart': out.push({ t: 'cs', id: wattr(n, 'id') }); break;
          case 'commentRangeEnd': out.push({ t: 'ce', id: wattr(n, 'id') }); break;
          default: break;                          // del, bookmarks, proofing marks...
        }
      }
    }
    function math(n, display, out) {
      let tex = '', num = null;
      try { const r = SW.ommlToTex(n); tex = r.tex; num = r.num; } catch (e) { return; }
      if (!tex.trim()) return;
      const id = display && num && /^\d+$/.test(num) ? ' data-id="eq:' + num + '"' : '';
      out.push({ t: 'html', h: '<span class="math' + (display ? ' display' : '') + '" data-tex="' + esc(tex) + '"' + id + '></span>', math: true, display });
    }
    function run(r, pRun, out) {
      const f = runProps(r, pRun);
      let fieldCollect = null;
      for (const c of ch(r)) {
        const name = ln(c);
        if (name === 'fldChar') {
          const type = wattr(c, 'fldCharType');
          if (type === 'begin') { ctx.fieldDepth++; ctx.fieldStack.push({ instr: '', phase: 'instr', start: out.length, depth: ctx.fieldDepth }); }
          else if (type === 'separate') { const t = ctx.fieldStack[ctx.fieldStack.length - 1]; if (t) { t.phase = 'result'; if (/^\s*TOC\b/.test(t.instr) && !ctx.tocDepth) { ctx.tocDepth = t.depth; ctx.tocNew = true; } } }
          else if (type === 'end') {
            const t = ctx.fieldStack.pop(); ctx.fieldDepth = Math.max(0, ctx.fieldDepth - 1);
            if (t && ctx.tocDepth && t.depth === ctx.tocDepth) ctx.tocDepth = 0;
            else if (t) {
              const m = t.instr.match(/^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i);
              if (m && /^(https?:|mailto:)/i.test(m[1]) && out.length > t.start) { const kids = out.splice(t.start); out.push({ t: 'link', href: m[1], kids }); }
            }
          }
          continue;
        }
        const top = ctx.fieldStack[ctx.fieldStack.length - 1];
        if (name === 'instrText') { if (top) top.instr += c.textContent; continue; }
        if (top && top.phase === 'instr') continue;
        switch (name) {
          case 't': out.push({ t: 'text', s: c.textContent, f }); break;
          case 'tab': out.push({ t: 'text', s: '\t', f: {} }); break;
          case 'noBreakHyphen': out.push({ t: 'text', s: '‑', f }); break;
          case 'sym': { const code = parseInt(c.getAttributeNS(NSW, 'char') || c.getAttribute('w:char') || '0', 16); if (code >= 0xF020) out.push({ t: 'text', s: String.fromCharCode(code - 0xF000), f }); break; }
          case 'br': case 'cr': {
            const type = wattr(c, 'type');
            if (type === 'page') out.push({ t: 'pb' }); else if (type !== 'column') out.push({ t: 'br' });
            break;
          }
          case 'footnoteReference': case 'endnoteReference': {
            const kind = name === 'footnoteReference' ? 'footnote' : 'endnote', n = notes.length + 1;
            notes.push({ kind, id: wattr(c, 'id') });
            out.push({ t: 'html', h: '<sup><a href="#' + kind + '-' + n + '" id="' + kind + '-ref-' + n + '">[' + n + ']</a></sup>' });
            break;
          }
          case 'drawing': out.push({ t: 'html', h: drawingHtml(c), pic: true }); break;
          case 'pict': case 'object': { const h = drawingHtml(c); if (h) out.push({ t: 'html', h, pic: true }); break; }
          case 'AlternateContent': {
            const choice = first(c, 'Choice') || first(c, 'Fallback');
            if (choice) for (const d of choice.getElementsByTagNameNS(NSW, 'drawing')) out.push({ t: 'html', h: drawingHtml(d), pic: true });
            break;
          }
          default: break;
        }
      }
      return fieldCollect;
    }

    /* tokens -> HTML */
    const FMT = [['b', 'strong'], ['i', 'em'], ['u', 'u'], ['s', 's'], ['sup', 'sup'], ['sub', 'sub'], ['code', 'code']];
    function trimTokens(tokens) {
      const t = tokens.slice();
      while (t.length && (t[0].t === 'br' || (t[0].t === 'text' && !t[0].s.trim()))) t.shift();
      while (t.length && (t[t.length - 1].t === 'br' || (t[t.length - 1].t === 'text' && !t[t.length - 1].s.trim()))) t.pop();
      if (t.length && t[0].t === 'text') t[0] = { t: 'text', s: t[0].s.replace(/^\s+/, ''), f: t[0].f };
      if (t.length && t[t.length - 1].t === 'text') { const l = t[t.length - 1]; t[t.length - 1] = { t: 'text', s: l.s.replace(/\s+$/, ''), f: l.f }; }
      return t;
    }
    function resolveComments(tokens) {
      const out = tokens.slice();
      const ids = [...new Set(out.filter((t) => t.t === 'cs' || t.t === 'ce').map((t) => t.id))];
      for (const id of ids) {
        const si = out.findIndex((t) => t.t === 'cs' && t.id === id), ei = out.findIndex((t) => t.t === 'ce' && t.id === id);
        const txt = commentTxt.get(id);
        if (txt === undefined) { [si, ei].filter((i) => i >= 0).sort((a, b) => b - a).forEach((i) => out.splice(i, 1)); continue; }
        if (si >= 0 && ei > si) {
          const inner = out.splice(si, ei - si + 1).slice(1, -1);
          out.splice(si, 0, { t: 'mark', txt, kids: inner });
        } else {
          if (si >= 0) out[si] = { t: 'pin', txt };
          const e2 = out.findIndex((t) => t.t === 'ce' && t.id === id); if (e2 >= 0) out.splice(e2, 1);
        }
      }
      return out;
    }
    function render(tokens, opts) {
      opts = opts || {};
      const parts = [];
      let i = 0;
      const sameF = (a, b) => FMT.every(([k]) => !!a[k] === !!b[k]);
      while (i < tokens.length) {
        const t = tokens[i];
        if (t.t === 'text') {
          let s = t.s, f = t.f, j = i + 1;
          while (j < tokens.length && tokens[j].t === 'text' && (sameF(tokens[j].f, f) || !tokens[j].s.trim())) { s += tokens[j].s; j++; }
          i = j;
          let lead = '', trail = '';
          const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/); lead = m[1]; s = m[2]; trail = m[3];
          let h = esc(s);
          if (s) for (const [k, tag] of FMT.slice().reverse()) if (f[k] && !(opts.heading && (k === 'b' || k === 'i'))) h = '<' + tag + '>' + h + '</' + tag + '>';
          parts.push(esc(lead) + h + esc(trail));
          continue;
        }
        i++;
        if (t.t === 'html') parts.push(t.h);
        else if (t.t === 'br') parts.push('<br>');
        else if (t.t === 'link') parts.push('<a href="' + esc(t.href) + '">' + render(t.kids, opts) + '</a>');
        else if (t.t === 'mark') parts.push('<mark class="comment" data-comment="' + esc(t.txt) + '">' + render(t.kids, opts) + '</mark>');
        else if (t.t === 'pin') parts.push('<span class="cpin" data-comment="' + esc(t.txt) + '"></span>');
      }
      return parts.join('');
    }
    const plainOf = (tokens) => tokens.map((t) => (t.t === 'text' ? t.s : t.t === 'link' || t.t === 'mark' ? plainOf(t.kids) : t.t === 'html' && !t.math ? '' : t.t === 'html' ? '∑' : '')).join('');

    /* ----- blocks ----- */
    const el = (tag, html) => { const e = document.createElement(tag); if (html !== undefined) e.innerHTML = html; return e; };
    const hasContent = (e) => !!(e.textContent.trim() || e.querySelector('img, .math, .pagebreak, .cpin, hr, table'));
    function blocks(container, out, st) {
      for (const n of ch(container)) {
        const name = ln(n);
        if (name === 'p') para(n, out, st);
        else if (name === 'tbl') { st.list = null; table(n, out); }
        else if (name === 'sdt') blocks(first(n, 'sdtContent') || n, out, st);
        else if (name === 'ins' || name === 'moveTo' || name === 'customXml') blocks(n, out, st);
      }
    }
    function listItem(li, info, out, st) {
      const L = st.list || (st.list = []);
      let lvl = Math.min(info.lvl, L.length);
      while (L.length > lvl + 1) L.pop();
      if (L.length === lvl + 1 && (L[lvl].numId !== info.numId && lvl === 0 || L[lvl].ordered !== info.ordered)) { L.length = lvl; }
      if (L.length === lvl) {
        const key = info.numId + '/' + lvl;
        const list = el(info.ordered ? 'ol' : 'ul');
        const next = counters.has(key) ? counters.get(key) : info.start;
        if (info.ordered && next !== 1) list.setAttribute('start', String(next));
        if (lvl === 0) out.push(list);
        else { const par = L[lvl - 1].el.lastElementChild; (par || L[lvl - 1].el.appendChild(el('li'))).appendChild(list); }
        L.push({ el: list, numId: info.numId, ordered: info.ordered });
      }
      L[lvl].el.appendChild(li);
      const key = info.numId + '/' + lvl;
      counters.set(key, (counters.has(key) ? counters.get(key) : info.start) + 1);
      for (const k of [...counters.keys()]) if (k.startsWith(info.numId + '/') && +k.split('/')[1] > lvl) counters.delete(k);
    }
    function para(p, out, st) {
      const ppr = first(p, 'pPr');
      const sid = ppr ? wv(first(ppr, 'pStyle')) : null;
      const si = styleInfo(sid);
      const inToc = ctx.tocDepth; let tokens = []; inline(p, si.r, tokens);
      const wasToc = inToc || ctx.tocNew;
      if (ctx.tocNew) { ctx.tocNew = false; st.list = null; out.push(Object.assign(el('div'), { className: 'toc' })); }
      if (wasToc || si.kind === 'skip') { return; }
      tokens = resolveComments(tokens);
      // heading, list and other kinds
      let level = si.level, lvlOutline = ppr && first(ppr, 'outlineLvl');
      if (!level && lvlOutline && +wv(lvlOutline) < 9) level = +wv(lvlOutline) + 1;
      let num = ppr ? numOf(ppr) : null; if (!num || num.id === null) num = si.num;
      const numId = num && num.id !== null && num.id !== '0' ? num.id : null;
      if (ppr && first(ppr, 'pageBreakBefore') && on(first(ppr, 'pageBreakBefore'))) { st.list = null; out.push(Object.assign(el('div'), { className: 'pagebreak' })); }
      // page breaks inside the paragraph split it
      const segs = [[]]; const breaks = [];
      for (const t of tokens) { if (t.t === 'pb') { segs.push([]); breaks.push(1); } else segs[segs.length - 1].push(t); }
      segs.forEach((seg, k) => {
        if (k > 0) { st.list = null; out.push(Object.assign(el('div'), { className: 'pagebreak' })); }
        const rawSeg = seg; seg = trimTokens(seg);
        for (let q = seg.length - 1; q >= 0; q--) if (seg[q].t === 'html' && seg[q].pic && /data-float=/.test(seg[q].h)) { st.list = null; out.push(el('p', seg[q].h)); seg.splice(q, 1); }
        seg = trimTokens(seg);
        const html = render(seg, { heading: !!level }).replace(/(:|<\/strong>)(?:\s|&nbsp;)*\t(?!\t)/g, '$1 ');
        const plain = plainOf(seg);
        const isEmpty = !plain.trim() && !seg.some((t) => t.t === 'html' || t.t === 'pin');
        if (isEmpty) { if (!seg.length) return; return; }
        if (level) { st.list = null; const h = el('h' + Math.min(6, level), html); h._level = level; out.push(h); return; }
        if (numId && k === 0) {
          const lv = numLevel(numId, num.lvl || 0);
          if (lv) { listItem(el('li', html), { numId, lvl: num.lvl || 0, ordered: lv.ordered, start: lv.start }, out, st); return; }
        }
        if (si.kind.startsWith('list-')) { listItem(el('li', html), { numId: 'style-' + si.kind, lvl: 0, ordered: si.kind === 'list-number', start: 1 }, out, st); return; }
        st.list = null;
        const mono = seg.some((t) => t.t === 'text' && t.s.trim()) && seg.every((t) => t.t !== 'text' || !t.s.trim() || t.f.code);
        if (si.kind === 'code' || mono) {
          const prev = out[out.length - 1];
          const text = rawSeg.map((t) => (t.t === 'text' ? t.s : t.t === 'br' ? '\n' : '')).join('').replace(/\s+$/, '');
          if (prev && prev.nodeName === 'PRE') prev.firstChild.textContent += '\n' + text;
          else { const pre = el('pre'); pre.appendChild(el('code')).textContent = text; out.push(pre); }
          return;
        }
        if (si.kind === 'quote') {
          const prev = out[out.length - 1];
          if (prev && prev.nodeName === 'BLOCKQUOTE') prev.appendChild(el('p', html)); else { const q = el('blockquote'); q.appendChild(el('p', html)); out.push(q); }
          return;
        }
        const e = el('p', html);
        if (si.kind === 'caption') e.className = 'caption';
        else e._plain = sid || '_';
        out.push(e);
      });
    }

    /* ----- tables ----- */
    function cellBlocks(tc) {
      const o = []; const st = { list: null };
      blocks(tc, o, st);
      return o;
    }
    function table(tbl, out) {
      const rows = [];
      const trs = ch(tbl).filter((c) => ln(c) === 'tr');
      const grid = [];                                  // grid[row][col]: the cell that covers it
      trs.forEach((tr, ri) => {
        const cells = []; let col = 0;
        grid[ri] = grid[ri] || [];
        for (const tc of ch(tr).filter((c) => ln(c) === 'tc')) {
          while (grid[ri][col]) col++;
          const pr = first(tc, 'tcPr'), gs = pr && first(pr, 'gridSpan'), vm = pr && first(pr, 'vMerge');
          const span = gs ? +wv(gs) || 1 : 1;
          const cont = vm && wv(vm) !== 'restart';
          const cell = { tc, span, col, cont: !!cont, rowspan: 1 };
          if (cont) { const above = (grid[ri - 1] || [])[col]; if (above) { above.rowspan++; cell.head = above; } }
          for (let k = 0; k < span; k++) grid[ri][col + k] = cont && cell.head ? cell.head : cell;
          cells.push(cell); col += span;
        }
        rows.push(cells);
      });
      const trows = rows.map((cells) => cells.map((c) => {
        if (c.cont) return { empty: true, span: c.span };
        const bl = cellBlocks(c.tc);
        const html = bl.map((b) => (b.nodeName === 'P' ? b.innerHTML : b.nodeName === 'UL' || b.nodeName === 'OL' ? [...b.querySelectorAll('li')].map((li) => '• ' + li.innerHTML).join('<br>') : b.textContent)).filter((h) => h.trim()).join('<br>');
        const jc = (() => { const p = first(c.tc, 'p'), pp = p && first(p, 'pPr'), j = pp && first(pp, 'jc'); return j ? wv(j) : ''; })();
        return { html, span: c.span, jc };
      }));
      // a title row (one filled cell, the rest empty) and rows with nothing in them are not table material
      let title = '';
      const filled = (r) => r.filter((c) => c.html && c.html.trim()).length;
      while (trows.length && !filled(trows[0])) trows.shift();
      if (trows.length > 2 && filled(trows[0]) === 1 && trows.slice(1).filter((r) => filled(r) > 1).length) { title = trows[0].find((c) => c.html && c.html.trim()).html; trows.shift(); }
      const body = trows.filter((r) => filled(r));
      if (title) out.push(el('p', '<strong>' + title.replace(/<\/?strong>/g, '') + '</strong>'));
      if (!body.length) return;
      const width = Math.max(...body.map((r) => r.reduce((a, c) => a + c.span, 0)));
      const t = el('table');
      body.forEach((r, ri) => {
        const tr = el('tr'); let used = 0;
        r.forEach((c) => {
          const cell = el(ri === 0 ? 'th' : 'td', c.html || '');
          if (c.jc === 'center' || c.jc === 'right') cell.setAttribute('align', c.jc);
          tr.appendChild(cell);
          for (let k = 1; k < c.span; k++) tr.appendChild(el(ri === 0 ? 'th' : 'td'));
          used += c.span;
        });
        for (; used < width; used++) tr.appendChild(el(ri === 0 ? 'th' : 'td'));
        t.appendChild(tr);
      });
      out.push(t);
    }

    /* ----- pictures, shapes and charts in the document: made first, because they need reading ----- */
    env.drawings = new Map();
    const hrefOf = (rid) => (rels[rid] ? rels[rid].target : null);
    async function imageHtml(rid, extent, alt, anchor) {
      const target = hrefOf(rid); if (!target) return '';
      const f = env.zip.file('word/' + target.replace(/^\/?(word\/)?/, '')) || env.zip.file(target.replace(/^\//, ''));
      if (!f) return '';
      const ext = (target.match(/\.(\w+)$/) || [])[1] || 'png';
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext.toLowerCase()];
      if (!type) return '<p><em>[Picture not imported: ' + esc(ext) + ' format]</em></p>';
      const blob = new Blob([await f.async('arraybuffer')], { type });
      return pictureTag(SW.addAssetBlob(blob, 'image'), extent, alt, anchor);
    }
    function pictureTag(src, extent, alt, anchor) {
      const w = extent ? Math.round(extent.cx / 9525) : 0;
      let fl = '';
      if (anchor) {
        const wrap = ch(anchor).find((c) => /^wrap(Square|Tight|Through)$/.test(ln(c)));
        if (wrap) {
          const ph = first(anchor, 'positionH'), al = ph && first(ph, 'align'), off = ph && first(ph, 'posOffset');
          fl = al ? (/right|outside/.test(al.textContent) ? 'right' : /left|inside/.test(al.textContent) ? 'left' : 'center') : off ? (+off.textContent > 2400000 ? 'right' : 'left') : '';
          if (fl === 'center') fl = '';
        }
      }
      return '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '"' + (w > 8 ? ' data-width="' + w + 'px"' : '') + (fl ? ' data-float="' + fl + '"' : '') + '>';
    }
    for (const d of [...docX.getElementsByTagNameNS(NSW, 'drawing')]) {
      let inFallback = false;
      for (let a = d.parentNode; a && a.nodeType === 1; a = a.parentNode) if (ln(a) === 'Fallback') { inFallback = true; break; }
      if (inFallback) continue;
      const holder = d.firstElementChild, ext = holder && first(holder, 'extent');
      const extent = ext ? { cx: +ext.getAttribute('cx'), cy: +ext.getAttribute('cy') } : null;
      const anchor = holder && ln(holder) === 'anchor' ? holder : null;
      const dp = holder && first(holder, 'docPr'), alt = dp ? dp.getAttribute('descr') || '' : '';
      const gd = d.getElementsByTagNameNS(NSA, 'graphicData')[0], uri = gd ? gd.getAttribute('uri') || '' : '';
      let html = '';
      try {
        if (/picture$/.test(uri)) {
          const blip = d.getElementsByTagNameNS(NSA, 'blip')[0], rid = blip && (blip.getAttributeNS(NSR, 'embed') || blip.getAttribute('r:embed'));
          html = rid ? await imageHtml(rid, extent, alt, anchor) : '';
        } else if (/chart$/.test(uri)) {
          const c = gd.firstElementChild, rid = c && (c.getAttributeNS(NSR, 'id') || c.getAttribute('r:id')), t = rid && hrefOf(rid);
          const f = t && env.zip.file('word/' + t.replace(/^\/?(word\/)?/, ''));
          html = f && SW.chartToHtml ? SW.chartToHtml(await f.async('string')) : '';
          if (!html) html = '<p><em>[Chart not imported]</em></p>';
        } else if (/wordprocessing(Shape|Group)$/.test(uri) || d.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'wsp').length) {
          const r = SW.drawShapes ? await SW.drawShapes(d, extent, env) : null;
          if (r && r.blob) html = pictureTag(SW.addAssetBlob(r.blob, 'drawing'), { cx: r.w * 9525 }, alt || 'Drawing', anchor);
          else { const texts = [...d.getElementsByTagNameNS(NSW, 't')].map((t) => t.textContent); html = texts.length ? '<p>' + esc(texts.join(' ')) + '</p>' : '<p><em>[Drawing not imported]</em></p>'; }
        } else html = '<p><em>[Drawing not imported]</em></p>';
      } catch (e) { console.warn(e); html = '<p><em>[Drawing not imported]</em></p>'; }
      env.drawings.set(d, html);
    }
    for (const p of [...docX.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'imagedata')]) {   // older pictures (VML)
      let inFallback = false;
      for (let a = p.parentNode; a && a.nodeType === 1; a = a.parentNode) if (ln(a) === 'Fallback') { inFallback = true; break; }
      if (inFallback) continue;
      const rid = p.getAttributeNS(NSR, 'id') || p.getAttribute('r:id');
      let host = p.parentNode; while (host && !['pict', 'object'].includes(ln(host))) host = host.parentNode;
      if (rid && host) env.drawings.set(host, await imageHtml(rid, null, '', null));
    }

    /* ----- the body ----- */
    const body = docX.getElementsByTagNameNS(NSW, 'body')[0];
    const out = [];
    blocks(body, out, { list: null });

    /* hard-wrapped lines (one paragraph per line, as in typed or converted documents) are joined again */
    const endsSentence = /[.!?:;)\]”"'…]\s*$/;
    for (let i = 0; i < out.length - 1;) {
      const a = out[i], b = out[i + 1];
      if (a._plain && b._plain && a._plain === b._plain && a.textContent.trim().length >= 30 && !endsSentence.test(a.textContent) && /^\p{Ll}/u.test(b.textContent.trim()) && !a.lastElementChild?.matches?.('br')) {
        a.insertAdjacentHTML('beforeend', ' ' + b.innerHTML); out.splice(i + 1, 1);
      } else i++;
    }
    /* "1.<tab>text" and "•<tab>text" typed by hand become lists */
    for (let i = 0; i < out.length; i++) {
      const p = out[i]; if (!p._plain) continue;
      const m = p.textContent.match(/^(\d{1,3})[.)][\t ]+\S/);
      const bu = p.textContent.match(/^[•·▪●◦○\-–*][\t ]+\S/);
      if (!m && !bu) continue;
      let j = i, n = m ? +m[1] : 0; const items = [];
      while (j < out.length && out[j]._plain) {
        const t = out[j].textContent, mm = m ? t.match(/^(\d{1,3})[.)][\t ]+\S/) : t.match(/^[•·▪●◦○\-–*][\t ]+\S/);
        if (!mm || (m && +mm[1] !== n + items.length)) break;
        items.push(out[j]); j++;
      }
      if (items.length < 2) continue;
      const list = el(m ? 'ol' : 'ul'); if (m && n !== 1) list.setAttribute('start', String(n));
      for (const it of items) {
        const li = el('li'); li.innerHTML = it.innerHTML;
        const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT); const t0 = w.nextNode();
        if (t0) t0.nodeValue = t0.nodeValue.replace(m ? /^\d{1,3}[.)][\t ]+/ : /^[^\s\t]+[\t ]+/, '');
        list.appendChild(li);
      }
      out.splice(i, items.length, list);
    }
    /* heading levels start at 1 */
    const hs = out.filter((e) => e._level);
    if (hs.length) {
      const min = Math.min(...hs.map((h) => h._level));
      if (min > 1) hs.forEach((h) => { const n = el('h' + Math.max(1, h._level - min + 1)); n.innerHTML = h.innerHTML; out[out.indexOf(h)] = n; });
    }
    const root = el('div'); out.forEach((e) => root.appendChild(e));
    /* footnotes and endnotes */
    if (notes.length) {
      const ol = el('ol');
      const dd = { footnote: fnX, endnote: enX };
      notes.forEach((n, k) => {
        const X = dd[n.kind]; let html = '';
        if (X) {
          const node = [...X.getElementsByTagNameNS(NSW, n.kind)].find((e) => wattr(e, 'id') === n.id);
          if (node) { const ps = ch(node).filter((c) => ln(c) === 'p').map((p) => { const t = []; inline(p, {}, t); return render(trimTokens(resolveComments(t))); }).filter((h) => h.trim()); html = ps.join(' '); }
        }
        const li = el('li', '<p>' + html + '</p>'); li.id = n.kind + '-' + (k + 1); ol.appendChild(li);
      });
      root.appendChild(ol);
    }
    SW.tabify(root);
    return root.innerHTML;
  };
})();
