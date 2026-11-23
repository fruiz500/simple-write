/* Simple Write: reading Word (.docx) files */
(function () {
  'use strict';
  const SW = window.SW;
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const { GREEK_TEX, OP_TEX, LOWER_FN } = SW.TEX_MAPS;
  const NARY_TEX = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⨁': '\\bigoplus', '⨂': '\\bigotimes' };
  const ACC_TEX = { '\u0302': 'hat', '^': 'hat', '\u0303': 'tilde', '~': 'tilde', '\u0304': 'bar', '\u0305': 'overline', '\u0307': 'dot', '\u0308': 'ddot', '\u20D7': 'vec', '\u20D6': 'overleftarrow', '\u0301': 'acute', '\u0300': 'grave', '\u030C': 'check', '\u0306': 'breve' };
  const FENCE = { '': '.', '{': '\\{', '}': '\\}', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil' };

  /* ---------- Word equations (OMML) -> LaTeX ---------- */
  const el = (n) => [...n.childNodes].filter((c) => c.nodeType === 1);
  const child = (n, name) => el(n).find((c) => c.localName === name);
  function val(n, pr, name, def) {
    const p = child(n, pr); const c = p && child(p, name);
    if (!c) return def;
    const v = c.getAttributeNS(M, 'val');
    return v === null || v === undefined || (v === '' && !c.hasAttributeNS(M, 'val')) ? (c.getAttribute('m:val') ?? def) : v;
  }
  const on = (v) => v === '1' || v === 'on' || v === 'true';
  const g = (t) => { t = t.trim(); return /^(\\[A-Za-z]+|[^\\{}\s])$/.test(t) ? t : '{' + t + '}'; };
  let ctx = { arr: 0, num: null };
  function mapText(t, plain, normal) {
    if (normal) return '\\text{' + t.replace(/[{}\\#%&$_^~]/g, (c) => '\\' + c) + '}';
    if (plain && /^[A-Za-z]{2,}$/.test(t)) return LOWER_FN.test(t) ? '\\' + t + ' ' : '\\mathrm{' + t + '}';
    let out = '';
    for (const c of [...t]) {
      if (c === '&' && ctx.arr) out += '&';
      else if (GREEK_TEX[c]) out += '\\' + GREEK_TEX[c] + ' ';
      else if (OP_TEX[c] !== undefined) out += OP_TEX[c] + (/^\\[A-Za-z]+$/.test(OP_TEX[c]) ? ' ' : '');
      else if (c === ' ' || c === '\u00A0') out += ' ';
      else if (/[A-Za-z]/.test(c) && plain) out += '\\mathrm{' + c + '}';
      else out += c;
    }
    return out;
  }
  function o2t(n) {
    const kids = () => el(n).map(o2t).join('');
    const sub = (name) => { const c = child(n, name); return c ? o2t(c) : ''; };
    switch (n.localName) {
      case 'oMathPara': return el(n).filter((c) => c.localName === 'oMath').map(o2t).join(' \\\\ ');
      case 'oMath': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName': case 'box': case 'borderBox': case 'phant':
        return kids();
      case 'r': {
        const text = [...n.getElementsByTagNameNS(M, 't'), ...n.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('');
        const rp = child(n, 'rPr');
        const normal = rp && child(rp, 'nor');
        const sty = rp && child(rp, 'sty') ? (child(rp, 'sty').getAttributeNS(M, 'val') || child(rp, 'sty').getAttribute('m:val')) : '';
        return mapText(text, sty === 'p' || sty === 'b', !!normal);
      }
      case 'f': {
        const t = val(n, 'fPr', 'type', 'bar'), a = sub('num'), b = sub('den');
        return t === 'lin' ? g(a) + '/' + g(b) : t === 'noBar' ? '\\genfrac{}{}{0pt}{}{' + a + '}{' + b + '}' : '\\frac{' + a + '}{' + b + '}';
      }
      case 'sSup': return g(sub('e')) + '^{' + sub('sup') + '}';
      case 'sSub': return g(sub('e')) + '_{' + sub('sub') + '}';
      case 'sSubSup': return g(sub('e')) + '_{' + sub('sub') + '}^{' + sub('sup') + '}';
      case 'sPre': return '{}_{' + sub('sub') + '}^{' + sub('sup') + '}' + g(sub('e'));
      case 'rad': { const d = sub('deg').trim(); return on(val(n, 'radPr', 'degHide', '0')) || !d ? '\\sqrt{' + sub('e') + '}' : '\\sqrt[' + d + ']{' + sub('e') + '}'; }
      case 'nary': {
        const chr = val(n, 'naryPr', 'chr', '∫');
        const s = sub('sub').trim(), p = sub('sup').trim();
        return (NARY_TEX[chr] || chr) + (s && !on(val(n, 'naryPr', 'subHide', '0')) ? '_{' + s + '}' : '') + (p && !on(val(n, 'naryPr', 'supHide', '0')) ? '^{' + p + '}' : '') + ' ' + sub('e');
      }
      case 'd': {
        const beg = val(n, 'dPr', 'begChr', '('), end = val(n, 'dPr', 'endChr', ')'), sep = val(n, 'dPr', 'sepChr', '|');
        const es = el(n).filter((c) => c.localName === 'e').map(o2t);
        const f = (c) => FENCE[c] !== undefined ? FENCE[c] : c;
        return '\\left' + f(beg) + ' ' + es.join(' ' + (sep === '|' ? '\\mid' : sep) + ' ') + ' \\right' + f(end);
      }
      case 'func': return sub('fName').trim() + ' ' + sub('e');
      case 'limLow': { const b = sub('e').trim(); return /^\\(lim|max|min|sup|inf|liminf|limsup)\b/.test(b) || /^\\mathrm\{(lim|max|min)\}$/.test(b) ? b.replace(/^\\mathrm\{(\w+)\}$/, '\\$1') + '_{' + sub('lim') + '}' : '\\underset{' + sub('lim') + '}{' + b + '}'; }
      case 'limUpp': return '\\overset{' + sub('lim') + '}{' + sub('e') + '}';
      case 'acc': { const c = val(n, 'accPr', 'chr', '\u0302'); return '\\' + (ACC_TEX[c] || 'hat') + '{' + sub('e') + '}'; }
      case 'bar': return (val(n, 'barPr', 'pos', 'bot') === 'top' ? '\\overline{' : '\\underline{') + sub('e') + '}';
      case 'groupChr': { const c = val(n, 'groupChrPr', 'chr', '⏟'), pos = val(n, 'groupChrPr', 'pos', 'bot'); return (c === '⏞' || pos === 'top' ? '\\overbrace{' : '\\underbrace{') + sub('e') + '}'; }
      case 'm': return '\\begin{matrix} ' + el(n).filter((r) => r.localName === 'mr').map((r) => el(r).filter((c) => c.localName === 'e').map(o2t).join(' & ')).join(' \\\\ ') + ' \\end{matrix}';
      case 'eqArr': {
        ctx.arr++;
        const rows = el(n).filter((c) => c.localName === 'e').map(o2t);
        ctx.arr--;
        // Word's numbered equations: equation#(1)
        const out = rows.map((r) => {
          const m = r.match(/\\#\s*\\left\(\s*([^()]*?)\s*\\right\)\s*$/) || r.match(/#\s*\\left\(\s*([^()]*?)\s*\\right\)\s*$/);
          if (m) { ctx.num = m[1].trim(); return r.slice(0, m.index); }
          return r;
        });
        return out.length === 1 ? out[0] : '\\begin{aligned} ' + out.join(' \\\\ ') + ' \\end{aligned}';
      }
      default:
        if (/Pr$/.test(n.localName)) return '';
        return kids();
    }
  }
  SW.ommlToTex = (n) => { ctx = { arr: 0, num: null }; const t = SW.cleanTex(o2t(n)); return { tex: t, num: ctx.num }; };

  /* ---------- Word ---------- */

  /* ---------- Word drawings (shapes, charts) -> text / table ---------- */
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const byName = (n, name) => [...n.getElementsByTagName('*')].filter((x) => x.localName === name);
  const shapeText = (n) => byName(n, 'p').filter((p) => !byName(p, 'p').length || true).map((p) => byName(p, 't').map((t) => t.textContent).join('')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  function flowFromShapes(drawing) {
    const wsp = byName(drawing, 'wsp');
    const nodes = [], edges = [];
    wsp.forEach((s) => {
      const cx = byName(s, 'cNvCnPr')[0], pr = byName(s, 'cNvPr')[0];
      const id = pr && pr.getAttribute('id');
      if (cx) {
        const st = byName(cx, 'stCxn')[0], en = byName(cx, 'endCxn')[0];
        if (st && en) edges.push([st.getAttribute('id'), en.getAttribute('id')]);
        return;
      }
      const geom = byName(s, 'prstGeom')[0];
      const off = byName(s, 'off')[0];
      nodes.push({ id, text: shapeText(s), g: geom ? geom.getAttribute('prst') : 'rect', x: off ? +off.getAttribute('x') : 0, y: off ? +off.getAttribute('y') : 0 });
    });
    return { nodes, edges };
  }
  function chartTable(xml) {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    const vals = (n) => byName(n, 'pt').map((pt) => (byName(pt, 'v')[0] || {}).textContent || '');
    const sers = byName(d, 'ser').map((s) => {
      const tx = [...s.children].find((c) => c.localName === 'tx'), cat = [...s.children].find((c) => c.localName === 'cat' || c.localName === 'xVal'), val = [...s.children].find((c) => c.localName === 'val' || c.localName === 'yVal');
      return { name: tx ? vals(tx).join(' ') : '', cat: cat ? vals(cat) : [], val: val ? vals(val) : [] };
    });
    if (!sers.length) return '';
    const title = byName(d, 'title')[0], esc = SW.esc;
    const rows = Math.max(...sers.map((s) => s.val.length));
    let h = '<table><thead><tr><th></th>' + sers.map((s, i) => '<th>' + esc(s.name || 'Series ' + (i + 1)) + '</th>').join('') + '</tr></thead><tbody>';
    for (let i = 0; i < rows; i++) h += '<tr><td>' + esc(sers[0].cat[i] || String(i + 1)) + '</td>' + sers.map((s) => '<td>' + esc(s.val[i] || '') + '</td>').join('') + '</tr>';
    return (title && shapeText(title) ? '<p><em>Chart: ' + esc(shapeText(title)) + '</em></p>' : '') + h + '</tbody></table>';
  }
  SW.chartToHtml = chartTable;
  SW.tabify = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [];
    while (w.nextNode()) { const n = w.currentNode; if (n.nodeValue.includes('\t') && !n.parentNode.closest('pre,code')) hits.push(n); }
    hits.forEach((n) => {
      const f = document.createDocumentFragment();
      n.nodeValue.split('\t').forEach((part, i) => { if (i) { const s = document.createElement('span'); s.className = 'tab'; f.appendChild(s); } if (part) f.appendChild(document.createTextNode(part)); });
      n.replaceWith(f);
    });
  };

  SW.importDocx = async function (file) {
    await SW.libs.jszip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const html = await SW.readDocx(zip);
    const result = { messages: [] };
    // captions written by Word or by Simple Write: "Figure 1: ..." under a picture, "Table 1: ..." next to a table
    const d = new DOMParser().parseFromString('<div data-sw="1">' + html + '</div>', 'text/html');
    d.querySelectorAll('img').forEach((img) => { img.setAttribute('data-src', img.getAttribute('src')); });
    d.querySelectorAll('p.caption').forEach((p) => {
      const t = p.textContent.trim();
      const fig = t.match(/^(?:Figure|Fig\.?)\s+(\d+)\s*[:.\u2013\u2014-]\s*([\s\S]*)$/i);
      const tab = t.match(/^Table\s+(\d+)\s*[:.\u2013\u2014-]\s*([\s\S]*)$/i);
      const prev = p.previousElementSibling, next = p.nextElementSibling;
      if (fig && prev && prev.nodeName === 'P' && prev.querySelectorAll('img').length === 1 && !prev.textContent.trim()) {
        const img = prev.querySelector('img');
        const f = d.createElement('figure'); f.className = 'fig'; f.setAttribute('data-id', 'fig:' + fig[1]);
        f.innerHTML = '<figcaption><span class="cap"></span></figcaption>';
        f.querySelector('.cap').textContent = fig[2];
        f.prepend(img); prev.replaceWith(f); p.remove();
      } else if (tab && ((next && next.nodeName === 'TABLE') || (prev && prev.nodeName === 'TABLE'))) {
        p.className = 'tcap'; p.setAttribute('data-id', 'tbl:' + tab[1]); p.textContent = tab[2];
      } else p.removeAttribute('class');
    });
    // numbered headings ("1.2 Title", as Simple Write and many reports write them) become automatic numbering
    const hs = [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const isNum = (h) => /^\s*\d+(\.\d+)*\.?\s+\S/.test(h.textContent);
    const numbered = hs.filter(isNum).length >= 2 && hs.filter(isNum).length * 2 >= hs.length;
    if (numbered) hs.filter(isNum).forEach((h) => { const w = d.createTreeWalker(h, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const t = w.currentNode; if (t.nodeValue.trim()) { t.nodeValue = t.nodeValue.replace(/^\s*\d+(\.\d+)*\.?\s+/, ''); break; } } });
    let md = SW.htmlToMarkdown(d.body.innerHTML);
    if (numbered) md = '---\nnumbersections: true\n---\n\n' + md;
    if (result.messages && result.messages.some((m) => m.type === 'error')) console.warn(result.messages);
    return md;
  };
})();
