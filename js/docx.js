/* Simple Write: Word (.docx) export. Equations become native Word equations (OMML), footnotes and comments are real ones. */
(function () {
  'use strict';
  const SW = window.SW;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const x = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* ---------- LaTeX -> MathML (KaTeX) -> OMML ---------- */
  const NARY = '∑∏∐∫∬∭∮⋃⋂⨁⨂';
  const REL = /^[=<>≤≥≈≠≡∼≃≅∝→←⇒⇐⇔↔⟶≪≫∈⊂⊆]$/;
  const ACC = { '^': '̂', 'ˆ': '̂', '~': '̃', '˜': '̃', 'ˉ': '̄', '¯': '̄', '˙': '̇', '¨': '̈', '⃗': '⃗', '→': '⃗', 'ˇ': '̌', '˘': '̆', '´': '́', '`': '̀', '˚': '̊' };
  const isFence = (n) => n && n.localName === 'mo' && n.getAttribute('fence') === 'true';
  const isRel = (n) => n && n.localName === 'mo' && REL.test(n.textContent.trim());
  function mr(text, sty, variant) {
    let p = '';
    if (variant === 'bold') p = '<m:sty m:val="b"/>';
    else if (variant === 'bold-italic') p = '<m:sty m:val="bi"/>';
    else if (variant === 'double-struck') p = '<m:scr m:val="double-struck"/><m:sty m:val="p"/>';
    else if (variant === 'script') p = '<m:scr m:val="script"/><m:sty m:val="p"/>';
    else if (variant === 'fraktur') p = '<m:scr m:val="fraktur"/><m:sty m:val="p"/>';
    else if (sty === 'p') p = '<m:sty m:val="p"/>';
    return '<m:r>' + (p ? '<m:rPr>' + p + '</m:rPr>' : '') + '<m:t xml:space="preserve">' + x(text) + '</m:t></m:r>';
  }
  const mtext = (t) => '<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">' + x(t) + '</m:t></m:r>';
  const e = (inner) => '<m:e>' + inner + '</m:e>';
  function naryOf(n) {
    if (!n) return null;
    const t = n.localName, k = [...n.children];
    if (t === 'mo' && NARY.includes(n.textContent.trim())) return { chr: n.textContent.trim(), sub: null, sup: null, loc: 'subSup' };
    if (/^(msub|msup|msubsup|munder|mover|munderover)$/.test(t) && k[0] && k[0].localName === 'mo' && NARY.includes(k[0].textContent.trim())) {
      const loc = /^m(under|over|underover)$/.test(t) ? 'undOvr' : 'subSup';
      const sub = /sub|under/.test(t) ? k[1] : null;
      const sup = t === 'msup' || t === 'mover' ? k[1] : (t === 'msubsup' || t === 'munderover' ? k[2] : null);
      return { chr: k[0].textContent.trim(), sub, sup, loc };
    }
    return null;
  }
  function seq(list) {
    list = list.filter((n) => n.nodeType === 1 && !/^annotation/.test(n.localName));
    if (list.length >= 2 && isFence(list[0])) {
      const lastF = list.length > 1 && isFence(list[list.length - 1]);
      const beg = list[0].textContent.trim(), end = lastF ? list[list.length - 1].textContent.trim() : '';
      const inner = list.slice(1, lastF ? -1 : undefined);
      return '<m:d><m:dPr><m:begChr m:val="' + x(beg) + '"/><m:endChr m:val="' + x(end) + '"/></m:dPr>' + e(seq(inner)) + '</m:d>';
    }
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const nary = naryOf(list[i]);
      if (nary) {
        let j = i + 1; while (j < list.length && !isRel(list[j])) j++;
        out += '<m:nary><m:naryPr><m:chr m:val="' + x(nary.chr) + '"/><m:limLoc m:val="' + nary.loc + '"/>' + (nary.sub ? '' : '<m:subHide m:val="1"/>') + (nary.sup ? '' : '<m:supHide m:val="1"/>') + '</m:naryPr><m:sub>' + om(nary.sub) + '</m:sub><m:sup>' + om(nary.sup) + '</m:sup>' + e(seq(list.slice(i + 1, j))) + '</m:nary>';
        i = j - 1; continue;
      }
      out += om(list[i]);
    }
    return out;
  }
  function om(n) {
    if (!n || n.nodeType !== 1) return '';
    const t = n.localName, k = [...n.children];
    switch (t) {
      case 'math': case 'semantics': case 'mrow': case 'mstyle': case 'mpadded': case 'mtd': case 'merror': return seq(k);
      case 'annotation': case 'annotation-xml': case 'mphantom': case 'mspace': return '';
      case 'mi': { const s = n.textContent; const v = n.getAttribute('mathvariant'); return mr(s, s.length > 1 || v === 'normal' ? 'p' : '', v); }
      case 'mn': return mr(n.textContent, 'p', n.getAttribute('mathvariant'));
      case 'mo': { const s = n.textContent.replace(/[⁡-⁤]/g, ''); return s ? mr(s, 'p') : ''; }
      case 'mtext': return n.textContent.trim() ? mtext(n.textContent) : '';
      case 'mfrac': return '<m:f>' + (/^0/.test(n.getAttribute('linethickness') || '') ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : '') + '<m:num>' + om(k[0]) + '</m:num><m:den>' + om(k[1]) + '</m:den></m:f>';
      case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>' + e(seq(k)) + '</m:rad>';
      case 'mroot': return '<m:rad><m:deg>' + om(k[1]) + '</m:deg>' + e(om(k[0])) + '</m:rad>';
      case 'msup': return '<m:sSup>' + e(om(k[0])) + '<m:sup>' + om(k[1]) + '</m:sup></m:sSup>';
      case 'msub': return '<m:sSub>' + e(om(k[0])) + '<m:sub>' + om(k[1]) + '</m:sub></m:sSub>';
      case 'msubsup': return '<m:sSubSup>' + e(om(k[0])) + '<m:sub>' + om(k[1]) + '</m:sub><m:sup>' + om(k[2]) + '</m:sup></m:sSubSup>';
      case 'mover': {
        const top = (k[1] && k[1].textContent.trim()) || '';
        if (top === '‾') return '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>' + e(om(k[0])) + '</m:bar>';
        if (top === '⏞') return '<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr>' + e(om(k[0])) + '</m:groupChr>';
        if (ACC[top]) return '<m:acc><m:accPr><m:chr m:val="' + ACC[top] + '"/></m:accPr>' + e(om(k[0])) + '</m:acc>';
        return '<m:limUpp>' + e(om(k[0])) + '<m:lim>' + om(k[1]) + '</m:lim></m:limUpp>';
      }
      case 'munder': {
        const bot = (k[1] && k[1].textContent.trim()) || '';
        if (bot === '‾' || bot === '_' || bot === '¯') return '<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>' + e(om(k[0])) + '</m:bar>';
        if (bot === '⏟') return '<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/></m:groupChrPr>' + e(om(k[0])) + '</m:groupChr>';
        return '<m:limLow>' + e(om(k[0])) + '<m:lim>' + om(k[1]) + '</m:lim></m:limLow>';
      }
      case 'munderover': return '<m:limUpp>' + e('<m:limLow>' + e(om(k[0])) + '<m:lim>' + om(k[1]) + '</m:lim></m:limLow>') + '<m:lim>' + om(k[2]) + '</m:lim></m:limUpp>';
      case 'mtable': {
        const rows = [...n.children].filter((r) => r.localName === 'mtr' || r.localName === 'mlabeledtr');
        const aligned = /right\s+left/.test(n.getAttribute('columnalign') || '');
        if (aligned) return '<m:eqArr>' + rows.map((r) => e([...r.children].map(om).join(''))).join('') + '</m:eqArr>';
        return '<m:m>' + rows.map((r) => '<m:mr>' + [...r.children].map((c) => e(om(c))).join('') + '</m:mr>').join('') + '</m:m>';
      }
      case 'menclose': return '<m:borderBox>' + e(seq(k)) + '</m:borderBox>';
      default: return seq(k);
    }
  }
  SW.texToOmml = function (tex, display, num) {
    let html;
    try { html = katex.renderToString(tex, { output: 'mathml', displayMode: !!display, throwOnError: true, strict: false }); }
    catch (err) { return '<m:oMath>' + mtext(tex) + '</m:oMath>'; }
    const d = new DOMParser().parseFromString(html, 'text/html');
    const m = d.querySelector('math');
    let inner = m ? om(m) : mtext(tex);
    if (num) inner = '<m:eqArr>' + e(inner + mr('#', 'p') + '<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>' + e(mr(String(num), 'p')) + '</m:d>') + '</m:eqArr>';
    return '<m:oMath>' + inner + '</m:oMath>';
  };

  /* ---------- pictures ---------- */
  const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('picture could not be read')); i.src = url; });
  async function rasterize(blob, scale) {
    let url = URL.createObjectURL(blob);
    try {
      let img = await loadImg(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { w = 600; h = 400; }
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      return { blob: png, w, h, ext: 'png' };
    } finally { URL.revokeObjectURL(url); }
  }
  async function pictureFor(img) {
    const src = img.dataset.src || img.getAttribute('src') || '';
    let blob = SW.assetBlob(src);
    if (!blob && /^https?:/.test(src)) { try { const r = await fetch(src); if (r.ok) blob = await r.blob(); } catch (e) { blob = null; } }
    if (!blob && /^data:/.test(src)) blob = SW.dataUrlToBlob(src);
    if (!blob) return null;
    if (/^image\/(png|jpeg|gif)$/.test(blob.type)) {
      const url = URL.createObjectURL(blob);
      try { const i = await loadImg(url); return { blob, w: i.naturalWidth, h: i.naturalHeight, ext: blob.type === 'image/jpeg' ? 'jpeg' : blob.type.split('/')[1] }; }
      finally { URL.revokeObjectURL(url); }
    }
    return rasterize(blob, /svg/.test(blob.type) ? 2 : 1);
  }

  /* ---------- the writer ---------- */
  function Writer(settings, meta) {
    this.s = settings; this.meta = meta;
    const twip = (v) => { const n = parseFloat(v); return /cm/.test(v) ? n * 567 : /mm/.test(v) ? n * 56.7 : /pt/.test(v) ? n * 20 : n * 1440; };
    { const pi = SW.paperInfo(settings.paper); this.pageW = Math.round(pi.w * 1440); this.pageH = Math.round(pi.h * 1440); if (settings.paper === 'a4') { this.pageW = 11906; this.pageH = 16838; } }
    this.mL = Math.round(twip(settings.ml)); this.mR = Math.round(twip(settings.mr)); this.mT = Math.round(twip(settings.mt)); this.mB = Math.round(twip(settings.mb));
    this.cols = settings.cols === 2 ? 2 : 1;
    this.textW = Math.round((this.pageW - this.mL - this.mR - (this.cols === 2 ? 720 : 0)) / this.cols);
    this.base = parseFloat(settings.size) || 12;
    this.rels = []; this.media = []; this.footnotes = []; this.comments = []; this.nums = []; this.listNum = new Map();
    this.pid = 1;
  }
  Writer.prototype.rel = function (type, target, external) {
    const id = 'rId' + (this.rels.length + 10);
    this.rels.push({ id, type, target, external });
    return id;
  };
  // run properties in schema order
  function rpr(f) {
    let p = '';
    if (f.rstyle) p += '<w:rStyle w:val="' + f.rstyle + '"/>';
    const font = f.code ? 'Consolas' : f.font;
    if (font) p += '<w:rFonts w:ascii="' + x(font) + '" w:hAnsi="' + x(font) + '" w:cs="' + x(font) + '"/>';
    if (f.b) p += '<w:b/>';
    if (f.i) p += '<w:i/>';
    if (f.s) p += '<w:strike/>';
    if (f.color) p += '<w:color w:val="' + f.color + '"/>';
    if (f.sz) p += '<w:sz w:val="' + f.sz + '"/><w:szCs w:val="' + f.sz + '"/>';
    if (f.u) p += '<w:u w:val="single"/>';
    if (f.shd || f.code) p += '<w:shd w:val="clear" w:color="auto" w:fill="' + (f.shd || 'F0F0F0') + '"/>';
    if (f.sub) p += '<w:vertAlign w:val="subscript"/>'; else if (f.sup) p += '<w:vertAlign w:val="superscript"/>';
    return p ? '<w:rPr>' + p + '</w:rPr>' : '';
  }
  const run = (t, f) => t ? '<w:r>' + rpr(f) + '<w:t xml:space="preserve">' + x(t) + '</w:t></w:r>' : '';
  const hexOf = (c) => { const h = SW.cssColorToHex(c || ''); return /^#[0-9a-f]{6}$/i.test(h) ? h.slice(1).toUpperCase() : ''; };
  const ptOf = (v) => { const n = parseFloat(v); if (!n) return 0; return /px/.test(v) ? n * 0.75 : /em/.test(v) ? n * 12 : n; };

  Writer.prototype.inline = function (node, f, ctx) {
    let out = '';
    for (const n of node.childNodes) out += this.inl(n, f, ctx);
    return out;
  };
  Writer.prototype.inl = function (n, f, ctx) {
    if (n.nodeType === 3) {
      let t = n.nodeValue.replace(/\s+/g, ' ');
      if (ctx.atStart) { t = t.replace(/^ /, ''); }
      if (t) ctx.atStart = false;
      return run(t, f);
    }
    if (n.nodeType !== 1) return '';
    const tag = n.nodeName, cl = n.classList;
    const F = (extra) => Object.assign({}, f, extra);
    if (cl.contains('math')) { ctx.atStart = false; return SW.texToOmml(n.dataset.tex, false); }
    if (cl.contains('fn')) {
      const id = this.footnotes.length + 1;
      this.footnotes.push(this.noteXml(id, n.dataset.note || ''));
      ctx.atStart = false;
      return '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="' + id + '"/></w:r>';
    }
    if (cl.contains('cite') || cl.contains('xref') || cl.contains('num')) { ctx.atStart = false; return run(n.textContent, cl.contains('num') ? F({ b: true }) : f); }
    if (cl.contains('cpin') || (tag === 'MARK' && cl.contains('comment'))) {
      const id = this.comments.length;
      const c = SW.ed.splitAuthor(n.dataset.comment || '');
      this.comments.push({ id, who: c.who || SW.ui.userName() || 'Author', text: c.text });
      const inner = tag === 'MARK' ? this.inline(n, f, ctx) : '';
      return '<w:commentRangeStart w:id="' + id + '"/>' + inner + '<w:commentRangeEnd w:id="' + id + '"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="' + id + '"/></w:r>';
    }
    switch (tag) {
      case 'BR': return '<w:r><w:br/></w:r>';
      case 'STRONG': case 'B': return this.inline(n, F({ b: true }), ctx);
      case 'EM': case 'I': return this.inline(n, F({ i: true }), ctx);
      case 'U': case 'INS': return this.inline(n, F({ u: true }), ctx);
      case 'S': case 'DEL': case 'STRIKE': return this.inline(n, F({ s: true }), ctx);
      case 'SUB': return this.inline(n, F({ sub: true }), ctx);
      case 'SUP': return this.inline(n, F({ sup: true }), ctx);
      case 'CODE': return this.inline(n, F({ code: true }), ctx);
      case 'MARK': return this.inline(n, F({ shd: 'FFF59D' }), ctx);
      case 'SPAN': {
        if (n.classList.contains('tab')) return '<w:r><w:tab/></w:r>';
        const st = n.style, g = {};
        if (st.color) g.color = hexOf(st.color);
        if (st.backgroundColor) g.shd = hexOf(st.backgroundColor);
        if (st.fontFamily) g.font = st.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        if (st.fontSize && ptOf(st.fontSize)) g.sz = Math.round(ptOf(st.fontSize) * 2);
        return this.inline(n, F(g), ctx);
      }
      case 'A': {
        const href = n.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href) || ctx.noLinks) return this.inline(n, f, ctx);
        const id = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', href, true);
        return '<w:hyperlink r:id="' + id + '" w:history="1">' + this.inline(n, F({ rstyle: 'Hyperlink' }), ctx) + '</w:hyperlink>';
      }
      case 'IMG': ctx.atStart = false; return this.drawing(n._pic, n.dataset.width, n.alt, n.dataset.float, n.dataset.height);
      case 'INPUT': return run(n.hasAttribute('checked') ? '☒ ' : '☐ ', f);
      default: return this.inline(n, f, ctx);
    }
  };
  Writer.prototype.drawing = function (pic, width, alt, float, height) {
    if (!pic) return run('[picture]', {});
    let wTw;
    if (width && /%$/.test(width)) wTw = this.textW * parseFloat(width) / 100;
    else if (width && /px$/.test(width)) wTw = parseFloat(width) * 15;
    else wTw = Math.min(this.textW, (pic.dispW || pic.w) * 15);
    const hPx = height && /^[\d.]+(px)?$/.test(height) ? parseFloat(height) : 0;
    const k = wTw > this.textW ? this.textW / wTw : 1;   // too wide: shrink, keeping any stretch
    wTw *= k;
    const cx = Math.round(wTw * 635), cy = hPx ? Math.round(hPx * 15 * k * 635) : Math.round(cx * pic.h / pic.w);
    const id = this.pid++;
    const anchored = float === 'left' || float === 'right';
    const open = anchored
      ? '<wp:anchor distT="0" distB="91440" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>' + float + '</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>'
      : '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>';
    return '<w:r><w:drawing>' + open + '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + x(alt || '') + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + pic.file + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + pic.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></' + (anchored ? 'wp:anchor' : 'wp:inline') + '></w:drawing></w:r>';
  };
  Writer.prototype.noteXml = function (id, md) {
    const r = SW.renderBody(md);
    let runs = '';
    [...r.children].forEach((b, i) => { if (i) runs += '<w:r><w:br/></w:r>'; runs += this.inline(b, {}, { atStart: true, noLinks: true }); });
    if (!r.children.length) runs = run(r.textContent, {});
    return '<w:footnote w:id="' + id + '"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' + runs + '</w:p></w:footnote>';
  };
  Writer.prototype.para = function (content, o) {
    o = o || {};
    let p = '';
    if (o.style) p += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.keepNext) p += '<w:keepNext/>';
    if (o.num) p += '<w:numPr><w:ilvl w:val="' + o.num.lvl + '"/><w:numId w:val="' + o.num.id + '"/></w:numPr>';
    if (o.border) p += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr>';
    if (o.tabs) p += '<w:tabs>' + o.tabs + '</w:tabs>';
    if (o.spacing) p += o.spacing;
    if (o.ind) p += o.ind;
    if (o.jc) p += '<w:jc w:val="' + o.jc + '"/>';
    return '<w:p>' + (p ? '<w:pPr>' + p + '</w:pPr>' : '') + content + '</w:p>';
  };
  const JC = { center: 'center', right: 'right', justify: 'both' };
  Writer.prototype.blocks = function (parent, ctx) {
    let out = '', loose = [];
    const flush = () => {
      if (!loose.length) return;
      const box = document.createElement('p'); loose.forEach((n) => box.appendChild(n.cloneNode(true)));
      if (box.textContent.trim() || box.querySelector('img, .math')) out += this.para(this.inline(box, {}, { atStart: true }), { style: ctx.quote ? 'Quote' : undefined });
      loose = [];
    };
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) loose.push(n); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.nodeName, cl = n.classList;
      const block = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|FIGURE|HR|DIV|PRE|SECTION)$/.test(tag);
      if (!block) { loose.push(n); continue; }
      flush();
      out += this.block(n, ctx);
    }
    flush();
    return out;
  };
  Writer.prototype.block = function (n, ctx) {
    const tag = n.nodeName, cl = n.classList;
    const jc = JC[(n.style && n.style.textAlign) || ''];
    if (/^H[1-6]$/.test(tag)) {
      const num = n.getAttribute('data-secnum');
      return this.para((num ? run(num + ' ', {}) : '') + this.inline(n, {}, { atStart: true }), { style: 'Heading' + tag[1], jc });
    }
    if (tag === 'P') {
      if (cl.contains('tcap')) return this.para(this.inline(n, {}, { atStart: true }), { style: 'Caption', keepNext: !!(n.nextElementSibling && n.nextElementSibling.nodeName === 'TABLE'), jc: 'center' });
      const content = this.inline(n, {}, { atStart: true });
      return this.para(content, { style: ctx.quote ? 'Quote' : undefined, jc });
    }
    if (tag === 'UL' || tag === 'OL') return this.list(n, ctx, 0);
    if (tag === 'BLOCKQUOTE') return this.blocks(n, Object.assign({}, ctx, { quote: (ctx.quote || 0) + 1 }));
    if (tag === 'TABLE') return this.table(n);
    if (tag === 'HR') return this.para('', { border: true });
    if (tag === 'FIGURE') {
      const img = n.querySelector('img');
      const cap = n.querySelector('figcaption');
      let out = this.para(img ? this.drawing(img._pic, img.dataset.width, img.alt, n.dataset.float, img.dataset.height) : '', { jc: 'center', keepNext: !!(cap && cap.textContent.trim()) });
      if (cap && cap.textContent.trim()) out += this.para(this.inline(cap, {}, { atStart: true }), { style: 'Caption', jc: 'center' });
      return out;
    }
    if (cl.contains('math') && cl.contains('display')) {
      return this.para('<m:oMathPara>' + SW.texToOmml(n.dataset.tex, true, n.dataset.id ? n.dataset.num : '') + '</m:oMathPara>', { jc: 'center' });
    }
    if (cl.contains('code-block')) {
      const lines = (n.dataset.code || '').replace(/\t/g, '    ').split('\n');
      return lines.map((l, i) => this.para(run(l || ' ', {}), { style: 'Code', spacing: i === lines.length - 1 ? '<w:spacing w:after="160"/>' : undefined })).join('');
    }
    if (cl.contains('media')) { const m = n.querySelector('video, audio, iframe'); return m ? this.para(run('[' + (m.nodeName === 'AUDIO' ? 'Audio' : 'Video') + ': ' + (m.nodeName === 'IFRAME' ? m.dataset.src || '' : (m.dataset.src || '').split('/').pop()) + ']', {}), {}) : ''; }
    if (cl.contains('pagebreak')) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (cl.contains('toc')) return this.toc(n);
    if (cl.contains('derived')) {
      let out = '';
      const refs = n.querySelector('.refs');
      if (refs) {
        out += this.para(run('References', {}), { style: 'Heading1' });
        refs.querySelectorAll(':scope > li').forEach((li) => {
          const c = li.cloneNode(true); const rn = c.querySelector('.rn'); const label = rn ? rn.textContent : ''; if (rn) rn.remove();
          out += this.para(run(label, {}) + '<w:r><w:tab/></w:r>' + this.inline(c, {}, { atStart: true }), { tabs: '<w:tab w:val="left" w:pos="567"/>', ind: '<w:ind w:left="567" w:hanging="567"/>' });
        });
      }
      return out;
    }
    if (tag === 'PRE') return n.textContent.split('\n').map((l) => this.para(run(l || ' ', {}), { style: 'Code' })).join('');
    return this.blocks(n, ctx);
  };
  Writer.prototype.numFor = function (list) {
    if (this.listNum.has(list)) return this.listNum.get(list);
    let id;
    if (list.nodeName === 'UL') id = 1;
    else {
      const up = list.parentNode && list.parentNode.closest('ol');
      if (up && this.listNum.has(up)) id = this.listNum.get(up);
      else { id = 2 + this.nums.length; this.nums.push({ id, start: parseInt(list.getAttribute('start') || '1', 10) || 1 }); }
    }
    this.listNum.set(list, id);
    return id;
  };
  Writer.prototype.list = function (list, ctx, lvl) {
    let out = '';
    const id = this.numFor(list);
    for (const li of list.children) {
      if (li.nodeName !== 'LI') continue;
      let first = true, buf = [];
      const emit = () => {
        const box = document.createElement('p'); buf.forEach((b) => box.appendChild(b.cloneNode(true)));
        out += this.para(this.inline(box, {}, { atStart: true }), first ? { style: 'ListParagraph', num: { lvl: Math.min(lvl, 8), id } } : { style: 'ListParagraph', ind: '<w:ind w:left="' + (720 + 360 * lvl) + '"/>' });
        first = false; buf = [];
      };
      for (const c of [...li.childNodes]) {
        if (c.nodeType === 1 && (c.nodeName === 'UL' || c.nodeName === 'OL')) { if (first || buf.some((b) => b.nodeType !== 3 || b.nodeValue.trim())) emit(); out += this.list(c, ctx, lvl + 1); continue; }
        if (c.nodeType === 1 && c.nodeName === 'P') { if (buf.length) emit(); buf = [...c.childNodes]; emit(); continue; }
        if (c.nodeType === 1 && /^(TABLE|FIGURE|BLOCKQUOTE|DIV|PRE)$/.test(c.nodeName)) { if (buf.length || first) emit(); out += this.block(c, ctx); continue; }
        buf.push(c);
      }
      if (first || buf.some((b) => b.nodeType !== 3 || b.nodeValue.trim())) emit();
    }
    return out;
  };
  Writer.prototype.table = function (t) {
    const rows = [...t.rows];
    if (!rows.length) return '';
    const cols = Math.max(...rows.map((r) => r.cells.length));
    const lens = new Array(cols).fill(3);
    rows.forEach((r) => [...r.cells].forEach((c, i) => { lens[i] = Math.max(lens[i], Math.min(40, c.textContent.trim().length + 2)); }));
    const total = lens.reduce((a, b) => a + b, 0);
    const scale = Math.min(this.textW / (total * 120), 1);
    const widths = lens.map((l) => Math.round(l * 120 * scale));
    let out = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>' + widths.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
    rows.forEach((r, ri) => {
      const head = ri === 0;
      out += '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
      for (let i = 0; i < cols; i++) {
        const c = r.cells[i];
        const jc = JC[((c && (c.getAttribute('align') || c.style.textAlign)) || '').toLowerCase()];
        out += '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '') + '</w:tcPr>' +
          this.para(c ? this.inline(c, head ? { b: true } : {}, { atStart: true }) : '', { spacing: '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', jc: jc || (head ? 'center' : undefined) }) + '</w:tc>';
      }
      out += '</w:tr>';
    });
    return out + '</w:tbl>' + this.para('', { spacing: '<w:spacing w:after="0" w:line="120" w:lineRule="auto"/>' });
  };
  Writer.prototype.toc = function (n) {
    const items = [...n.querySelectorAll('li > a')];
    let out = this.para(run('Contents', { b: true, sz: Math.round(this.base * 2.6) }), { spacing: '<w:spacing w:after="120"/>' });
    const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    if (!items.length) return out + this.para(begin + run('(no headings)', {}) + end);
    items.forEach((a, i) => {
      let lvl = 0, p = a.parentNode.parentNode; while (p && p !== n) { if (p.nodeName === 'UL') lvl++; p = p.parentNode; }
      out += this.para((i === 0 ? begin : '') + run(a.textContent, {}) + (i === items.length - 1 ? end : ''), { ind: '<w:ind w:left="' + (Math.max(0, lvl - 1) * 360) + '"/>', spacing: '<w:spacing w:after="40"/>' });
    });
    return out;
  };

  /* ---------- package parts ---------- */
  Writer.prototype.styles = function () {
    const font = this.s.font || 'Calibri', sz = Math.round(this.base * 2), line = Math.round(240 * (parseFloat(this.s.line) || 1.15));
    const hs = [1.65, 1.35, 1.15, 1.05, 1, 0.95];
    const heading = (i) => '<w:style w:type="paragraph" w:styleId="Heading' + i + '"><w:name w:val="heading ' + i + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + (i < 3 ? 360 : 240) + '" w:after="120"/><w:outlineLvl w:val="' + (i - 1) + '"/></w:pPr><w:rPr><w:b/>' + (i === 6 ? '<w:i/>' : '') + '<w:color w:val="1F3864"/><w:sz w:val="' + Math.round(sz * hs[i - 1]) + '"/><w:szCs w:val="' + Math.round(sz * hs[i - 1]) + '"/></w:rPr></w:style>';
    return HEAD + '<w:styles ' + NS + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + x(font) + '" w:hAnsi="' + x(font) + '" w:eastAsia="' + x(font) + '" w:cs="' + x(font) + '"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="' + line + '" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' + (this.s.tabs && this.s.tabs.length ? '<w:pPr><w:tabs>' + this.s.tabs.map((t) => '<w:tab w:val="left" w:pos="' + Math.round(t * 1440) + '"/>').join('') + '</w:tabs></w:pPr>' : '') + '</w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      [1, 2, 3, 4, 5, 6].map(heading).join('') +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B4C3DC"/></w:pBdr><w:ind w:left="300"/></w:pPr><w:rPr><w:color w:val="444444"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="' + Math.round(sz * 0.8) + '"/><w:szCs w:val="' + Math.round(sz * 0.8) + '"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="' + Math.round(sz * 0.92) + '"/><w:szCs w:val="' + Math.round(sz * 0.92) + '"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders></w:tblPr></w:style>' +
      '</w:styles>';
  };
  Writer.prototype.numbering = function () {
    const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    const lvl = (i, fmt, text) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * i) + '" w:hanging="360"/></w:pPr></w:lvl>';
    let a0 = '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>', a1 = '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>';
    for (let i = 0; i < 9; i++) { a0 += lvl(i, 'bullet', bullets[i % 3]); a1 += lvl(i, fmts[i % 3], '%' + (i + 1) + '.'); }
    a0 += '</w:abstractNum>'; a1 += '</w:abstractNum>';
    return HEAD + '<w:numbering ' + NS + '>' + a0 + a1 + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      this.nums.map((n) => '<w:num w:numId="' + n.id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride></w:num>').join('') + '</w:numbering>';
  };
  Writer.prototype.footnotesXml = function () {
    const sep = (type, id, el) => '<w:footnote w:type="' + type + '" w:id="' + id + '"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>' + el + '</w:r></w:p></w:footnote>';
    return HEAD + '<w:footnotes ' + NS + '>' + sep('separator', -1, '<w:separator/>') + sep('continuationSeparator', 0, '<w:continuationSeparator/>') + this.footnotes.join('') + '</w:footnotes>';
  };
  Writer.prototype.commentsXml = function () {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return HEAD + '<w:comments ' + NS + '>' + this.comments.map((c) => {
      const ini = c.who.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 3).toUpperCase();
      return '<w:comment w:id="' + c.id + '" w:author="' + x(c.who) + '" w:date="' + now + '" w:initials="' + x(ini) + '"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">' + x(c.text) + '</w:t></w:r></w:p></w:comment>';
    }).join('') + '</w:comments>';
  };

  SW.exportDocx = async function (md) {
    await SW.libs.jszip();
    const { root, meta } = SW.renderForExport(md);
    const s = SW.ed.settings();
    const W = new Writer(s, meta);
    // pictures first (they need reading); remove the endnote list (Word gets real footnotes)
    root.querySelectorAll('.notes-sec').forEach((n) => n.remove());
    let mi = 0;
    const addMedia = (pic) => { mi++; pic.file = 'image' + mi + '.' + pic.ext; pic.rid = W.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + pic.file); W.media.push(pic); return pic; };
    for (const img of root.querySelectorAll('img')) {
      try { const p = await pictureFor(img); if (p) img._pic = addMedia(p); } catch (e) { console.warn(e); }
    }
    const body = W.blocks(root, {});
    let sect = '';
    const HF = SW.hf.effective(s), hfCtx = SW.hf.ctx(meta, root);
    if (HF.hasHead) { const id = W.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'header1.xml'); sect += '<w:headerReference w:type="default" r:id="' + id + '"/>'; }
    if (HF.hasFoot) { const id = W.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', 'footer1.xml'); sect += '<w:footerReference w:type="default" r:id="' + id + '"/>'; }
    sect += '<w:pgSz w:w="' + W.pageW + '" w:h="' + W.pageH + '"/><w:pgMar w:top="' + W.mT + '" w:right="' + W.mR + '" w:bottom="' + W.mB + '" w:left="' + W.mL + '" w:header="708" w:footer="708" w:gutter="0"/>' + (W.cols === 2 ? '<w:cols w:num="2" w:space="720"/>' : '<w:cols w:space="708"/>') + (HF.skipFirst && (HF.any) ? '<w:titlePg/>' : '');
    const docXml = HEAD + '<w:document ' + NS + '><w:body>' + body + '<w:sectPr>' + sect + '</w:sectPr></w:body></w:document>';

    const zip = new JSZip();
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const fixed = [['rId1', R + 'styles', 'styles.xml'], ['rId2', R + 'settings', 'settings.xml'], ['rId3', R + 'numbering', 'numbering.xml'], ['rId4', R + 'footnotes', 'footnotes.xml']];
    if (W.comments.length) fixed.push(['rId5', R + 'comments', 'comments.xml']);
    zip.file('[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
      (W.comments.length ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : '') +
      (HF.hasHead ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
      (HF.hasFoot ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    zip.file('_rels/.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + 'officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const title = (root.querySelector('h1') || {}).textContent || SW.doc.name || '';
    zip.file('docProps/core.xml', HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + x(title) + '</dc:title><dc:creator>' + x(SW.ui.userName() || '') + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
    zip.file('word/document.xml', docXml);
    zip.file('word/styles.xml', W.styles());
    zip.file('word/numbering.xml', W.numbering());
    zip.file('word/footnotes.xml', W.footnotesXml());
    zip.file('word/settings.xml', HEAD + '<w:settings ' + NS + '><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr></w:settings>');
    if (W.comments.length) zip.file('word/comments.xml', W.commentsXml());
    // header and footer: left, center and right zones with tab stops; {page} and {pages} are Word fields
    const fld = (code) => '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + code + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const hfPara = (zones, style) => {
      const cell = (t) => String(t).split(/(\{pages?\})/).map((p) => p === '{page}' ? fld('PAGE') : p === '{pages}' ? fld('NUMPAGES') : run(SW.hf.text(p, hfCtx), {})).join('');
      const tw = W.pageW - W.mL - W.mR;
      return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/><w:tabs><w:tab w:val="clear" w:pos="4513"/><w:tab w:val="clear" w:pos="9026"/><w:tab w:val="center" w:pos="' + Math.round(tw / 2) + '"/><w:tab w:val="right" w:pos="' + tw + '"/></w:tabs><w:jc w:val="left"/></w:pPr>' + cell(zones[0]) + '<w:r><w:tab/></w:r>' + cell(zones[1]) + '<w:r><w:tab/></w:r>' + cell(zones[2]) + '</w:p>';
    };
    if (HF.hasHead) zip.file('word/header1.xml', HEAD + '<w:hdr ' + NS + '>' + hfPara(HF.head, 'Header') + '</w:hdr>');
    if (HF.hasFoot) zip.file('word/footer1.xml', HEAD + '<w:ftr ' + NS + '>' + hfPara(HF.foot, 'Footer') + '</w:ftr>');
    zip.file('word/_rels/document.xml.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      fixed.map((f) => '<Relationship Id="' + f[0] + '" Type="' + f[1] + '" Target="' + f[2] + '"/>').join('') +
      W.rels.map((r) => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + x(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>');
    for (const m of W.media) zip.file('word/media/' + m.file, m.blob);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  };
})();
