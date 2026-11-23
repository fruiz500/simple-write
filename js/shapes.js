/* Simple Write: draws a Word drawing (a group of lines, arrows, shapes, text boxes and pictures) as one picture.
   The drawing is converted to SVG and then to a PNG, so a sketch comes in looking like the sketch. */
(function () {
  'use strict';
  const SW = window.SW;
  const NSA = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ln = (n) => n.localName;
  const kids = (n, name) => (n ? [...n.children].filter((c) => !name || ln(c) === name) : []);
  const one = (n, name) => kids(n, name)[0] || null;
  const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SCHEME = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
  const PRESET = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080' };

  function themeColors(theme) {
    const m = {};
    if (!theme) return m;
    const cs = theme.getElementsByTagNameNS(NSA, 'clrScheme')[0];
    if (cs) for (const c of cs.children) { const v = c.firstElementChild; m[ln(c)] = v ? (v.getAttribute('val') && ln(v) === 'srgbClr' ? v.getAttribute('val') : v.getAttribute('lastClr') || '000000') : '000000'; }
    return m;
  }
  function hslAdjust(hex, mod, off) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    l = Math.min(1, Math.max(0, l * mod + off));
    const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    let R, G, B;
    if (!s) R = G = B = l; else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; R = f(p, q, h + 1 / 3); G = f(p, q, h); B = f(p, q, h - 1 / 3); }
    return '#' + [R, G, B].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  function colorOf(c, theme) {
    if (!c) return null;
    const v = c.getAttribute('val'); let hex = null;
    switch (ln(c)) {
      case 'srgbClr': hex = '#' + v; break;
      case 'sysClr': hex = '#' + (c.getAttribute('lastClr') || '000000'); break;
      case 'prstClr': hex = PRESET[v] || '#000000'; break;
      case 'schemeClr': hex = '#' + (theme[SCHEME[v] || v] || '000000'); break;
      default: return null;
    }
    let mod = 1, off = 0;
    for (const a of c.children) { if (ln(a) === 'lumMod') mod = num(a.getAttribute('val'), 100000) / 100000; if (ln(a) === 'lumOff') off = num(a.getAttribute('val'), 0) / 100000; }
    return mod !== 1 || off ? hslAdjust(hex, mod, off) : hex;
  }
  const fillOf = (holder, theme) => {                     // holder: an a:solidFill, a:gradFill ...
    if (!holder) return null;
    if (ln(holder) === 'noFill') return 'none';
    if (ln(holder) === 'solidFill') return colorOf(holder.firstElementChild, theme);
    if (ln(holder) === 'gradFill') { const gs = holder.getElementsByTagNameNS(NSA, 'gs')[0]; return gs ? colorOf(gs.firstElementChild, theme) : null; }
    return null;
  };

  /* custom geometry: guides such as "a w b" (a times w over b) are evaluated, then the path commands become an SVG path */
  function custPath(g, W, H, theme) {
    const vars = { w: W, h: H }, val = (t) => (t in vars ? vars[t] : num(t, 0));
    const gd = one(g, 'gdLst');
    if (gd) for (const x of kids(gd, 'gd')) {
      const p = (x.getAttribute('fmla') || '').split(/\s+/), op = p[0], a = p.slice(1).map(val);
      let r = 0;
      if (op === '*/') r = a[2] ? a[0] * a[1] / a[2] : 0; else if (op === '+-') r = a[0] + a[1] - a[2]; else if (op === 'val') r = a[0]; else if (op === '+/') r = a[2] ? (a[0] + a[1]) / a[2] : 0;
      vars[x.getAttribute('name')] = r;
    }
    const out = [];
    for (const path of kids(one(g, 'pathLst'), 'path')) {
      const pw = num(path.getAttribute('w'), W) || W, ph = num(path.getAttribute('h'), H) || H, sx = W / pw, sy = H / ph;
      const pt = (e) => val(e.getAttribute('x')) * sx + ',' + val(e.getAttribute('y')) * sy;
      let d = '';
      for (const c of path.children) {
        const pts = kids(c, 'pt');
        if (ln(c) === 'moveTo') d += 'M' + pt(pts[0]); else if (ln(c) === 'lnTo') d += 'L' + pt(pts[0]);
        else if (ln(c) === 'cubicBezTo') d += 'C' + pts.map(pt).join(' ');
        else if (ln(c) === 'quadBezTo') d += 'Q' + pts.map(pt).join(' ');
        else if (ln(c) === 'close') d += 'Z';
      }
      out.push({ d, fill: path.getAttribute('fill') !== 'none', stroke: path.getAttribute('stroke') !== '0' });
    }
    return out;
  }
  function presetPath(name, W, H) {
    const w = W, h = H;
    switch (name) {
      case 'ellipse': return null;
      case 'triangle': return `M${w / 2},0L${w},${h}L0,${h}Z`;
      case 'rtTriangle': return `M0,0L${w},${h}L0,${h}Z`;
      case 'diamond': case 'flowChartDecision': return `M${w / 2},0L${w},${h / 2}L${w / 2},${h}L0,${h / 2}Z`;
      case 'parallelogram': case 'flowChartInputOutput': return `M${w * 0.2},0L${w},0L${w * 0.8},${h}L0,${h}Z`;
      case 'hexagon': return `M${w * 0.25},0L${w * 0.75},0L${w},${h / 2}L${w * 0.75},${h}L${w * 0.25},${h}L0,${h / 2}Z`;
      case 'rightArrow': return `M0,${h * 0.25}L${w * 0.6},${h * 0.25}L${w * 0.6},0L${w},${h / 2}L${w * 0.6},${h}L${w * 0.6},${h * 0.75}L0,${h * 0.75}Z`;
      case 'leftArrow': return `M${w},${h * 0.25}L${w * 0.4},${h * 0.25}L${w * 0.4},0L0,${h / 2}L${w * 0.4},${h}L${w * 0.4},${h * 0.75}L${w},${h * 0.75}Z`;
      case 'upArrow': return `M${w * 0.25},${h}L${w * 0.25},${h * 0.4}L0,${h * 0.4}L${w / 2},0L${w},${h * 0.4}L${w * 0.75},${h * 0.4}L${w * 0.75},${h}Z`;
      case 'downArrow': return `M${w * 0.25},0L${w * 0.25},${h * 0.6}L0,${h * 0.6}L${w / 2},${h}L${w},${h * 0.6}L${w * 0.75},${h * 0.6}L${w * 0.75},0Z`;
      default: return undefined;                            // rectangle-like
    }
  }

  /* ----- text in a shape: paragraphs, wrapped with a measuring canvas ----- */
  const meas = document.createElement('canvas').getContext('2d');
  function textSvg(sp, W, H, theme) {
    const tb = sp.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'txbx')[0];
    let paras;
    if (tb) paras = [...tb.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p')];
    else { const tx = sp.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'p'); paras = [...tx]; }
    if (!paras.length) return '';
    const NSW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bp = sp.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'bodyPr')[0];
    const inset = (k, d) => (bp && bp.getAttribute(k) !== null ? num(bp.getAttribute(k), d) : d);
    const li = inset('lIns', 91440), ti = inset('tIns', 45720), ri = inset('rIns', 91440), bi = inset('bIns', 45720);
    const avail = Math.max(1, W - li - ri);
    const lines = [];
    for (const p of paras) {
      let size = 11, bold = false, ital = false, text = '';
      const jc = p.getElementsByTagNameNS(NSW, 'jc')[0] || p.getElementsByTagNameNS(NSA, 'pPr')[0];
      const al = jc ? jc.getAttributeNS(NSW, 'val') || jc.getAttribute('w:val') || jc.getAttribute('algn') : '';
      const mathT = [...p.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 't')].map((t) => t.textContent).join('');
      for (const t of [...p.getElementsByTagNameNS(NSW, 't'), ...p.getElementsByTagNameNS(NSA, 't')]) {
        text += t.textContent; const r = t.parentNode, rp = [...r.children].find((c) => ln(c) === 'rPr');
        if (rp) { const sz = [...rp.children].find((c) => ln(c) === 'sz'); if (sz) size = num(sz.getAttribute('w:val') || sz.getAttributeNS(NSW, 'val'), 22) / 2; if ([...rp.children].some((c) => ln(c) === 'b')) bold = true; if ([...rp.children].some((c) => ln(c) === 'i')) ital = true; }
      }
      text = (text + mathT).trim(); if (!text) { lines.push({ s: '', size, al }); continue; }
      const px = size * 12700; meas.font = (ital ? 'italic ' : '') + (bold ? 'bold ' : '') + '100px Arial';
      const words = text.split(/\s+/); let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (cur && meas.measureText(t).width * px / 100 > avail) { lines.push({ s: cur, size, bold, ital, al }); cur = w; } else cur = t;
      }
      lines.push({ s: cur, size, bold, ital, al });
    }
    const total = lines.reduce((a, l) => a + l.size * 12700 * 1.2, 0);
    let y = ti + Math.max(0, (H - ti - bi - total) / 2);                  // centered vertically
    let out = '';
    for (const l of lines) {
      const px = l.size * 12700; y += px * 1.2;
      if (!l.s) continue;
      const center = !l.al || /center|ctr/.test(l.al), right = /right|r$/.test(l.al), left = /left|l$/.test(l.al);
      const x = center && !left ? li + avail / 2 : right ? W - ri : li, anchor = center && !left ? 'middle' : right ? 'end' : 'start';
      const k = px / 100;                                   // big font sizes in tiny scales render badly in Chrome: scale a 100-unit font instead
      out += `<text transform="scale(${k})" x="${x / k}" y="${(y - px * 0.25) / k}" font-family="Arial,Helvetica,sans-serif" font-size="100" text-anchor="${anchor}"${l.bold ? ' font-weight="bold"' : ''}${l.ital ? ' font-style="italic"' : ''} fill="#000">${esc(l.s)}</text>`;
    }
    return out;
  }

  /* ----- walk the drawing ----- */
  SW.drawShapes = async function (d, extent, env) {
    const theme = themeColors(env.theme);
    const gd = d.getElementsByTagNameNS(NSA, 'graphicData')[0];
    const root = gd && gd.firstElementChild; if (!root) return null;
    const images = new Map();
    const relTarget = (rid) => env.rels[rid] && env.rels[rid].target;
    for (const b of root.getElementsByTagNameNS(NSA, 'blip')) {
      const rid = b.getAttributeNS(NSR, 'embed') || b.getAttribute('r:embed'), t = rid && relTarget(rid);
      const f = t && env.zip.file('word/' + t.replace(/^\/?(word\/)?/, ''));
      if (f && !images.has(rid)) {
        const ext = ((t.match(/\.(\w+)$/) || [])[1] || 'png').toLowerCase();
        const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/png';
        images.set(rid, 'data:' + type + ';base64,' + (await f.async('base64')));
      }
    }
    const ids = new Set();
    const markers = new Map();
    const defs = [];
    const marker = (kind, color, tail) => {
      const key = kind + color + tail; if (markers.has(key)) return markers.get(key);
      const id = 'm' + markers.size; markers.set(key, id);
      const shape = kind === 'oval' ? '<circle cx="5" cy="5" r="4"/>' : kind === 'arrow' || kind === 'stealth' ? '<path d="M0,0L10,5L0,10L3,5Z"/>' : '<path d="M0,0L10,5L0,10Z"/>';
      defs.push(`<marker id="${id}" viewBox="0 0 10 10" refX="${tail ? 9 : 1}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth" fill="${color}">${shape}</marker>`);
      return id;
    };
    function xf(n) {
      const x = one(n, 'xfrm'); if (!x) return null;
      const o = one(x, 'off'), e = one(x, 'ext'), co = one(x, 'chOff'), ce = one(x, 'chExt');
      return { x: num(o && o.getAttribute('x'), 0), y: num(o && o.getAttribute('y'), 0), w: num(e && e.getAttribute('cx'), 0), h: num(e && e.getAttribute('cy'), 0), cx: co ? num(co.getAttribute('x'), 0) : 0, cy: co ? num(co.getAttribute('y'), 0) : 0, cw: ce ? num(ce.getAttribute('cx'), 0) : 0, ch: ce ? num(ce.getAttribute('cy'), 0) : 0, rot: num(x.getAttribute('rot'), 0) / 60000, fh: x.getAttribute('flipH') === '1', fv: x.getAttribute('flipV') === '1' };
    }
    const place = (t) => {                                  // transform for a shape's own box
      let s = `translate(${t.x},${t.y})`;
      if (t.rot || t.fh || t.fv) s += ` translate(${t.w / 2},${t.h / 2})${t.rot ? ` rotate(${t.rot})` : ''}${t.fh || t.fv ? ` scale(${t.fh ? -1 : 1},${t.fv ? -1 : 1})` : ''} translate(${-t.w / 2},${-t.h / 2})`;
      return s;
    };
    function shape(sp) {
      const spPr = one(sp, 'spPr'); if (!spPr) return '';
      const t = xf(spPr) || { x: 0, y: 0, w: 0, h: 0 };
      const st = one(sp, 'style'), W = t.w, H = t.h;
      // line
      const lnE = one(spPr, 'ln'); let stroke = null, sw = 9525;
      if (lnE) {
        sw = num(lnE.getAttribute('w'), 9525);
        const f = kids(lnE).find((c) => /Fill$/.test(ln(c)));
        stroke = f ? fillOf(f, theme) : null;
      }
      if (stroke === null && st) { const lr = one(st, 'lnRef'); if (lr && lr.getAttribute('idx') !== '0') { stroke = colorOf(lr.firstElementChild, theme); if (!lnE || !lnE.getAttribute('w')) sw = 9525 * num(lr.getAttribute('idx'), 1); } }
      let fill = null; const fe = kids(spPr).find((c) => /^(solidFill|noFill|gradFill)$/.test(ln(c)));
      if (fe) fill = fillOf(fe, theme);
      else if (st) { const fr = one(st, 'fillRef'); fill = fr && fr.getAttribute('idx') !== '0' ? colorOf(fr.firstElementChild, theme) : 'none'; }
      const dash = lnE && one(lnE, 'prstDash') ? one(lnE, 'prstDash').getAttribute('val') : '';
      let attrs = `fill="${fill || 'none'}"`;
      if (stroke && stroke !== 'none') {
        attrs += ` stroke="${stroke}" stroke-width="${sw}"`;
        if (dash && dash !== 'solid') attrs += ` stroke-dasharray="${/sysDot|dot/.test(dash) ? sw + ' ' + sw * 2 : sw * 4 + ' ' + sw * 3}"`;
        const he = one(lnE, 'headEnd'), te = one(lnE, 'tailEnd');
        if (he && he.getAttribute('type') && he.getAttribute('type') !== 'none') attrs += ` marker-start="url(#${marker(he.getAttribute('type'), stroke, false)})"`;
        if (te && te.getAttribute('type') && te.getAttribute('type') !== 'none') attrs += ` marker-end="url(#${marker(te.getAttribute('type'), stroke, true)})"`;
      }
      let body = '';
      const cg = one(spPr, 'custGeom'), pg = one(spPr, 'prstGeom'), prst = pg ? pg.getAttribute('prst') : '';
      if (cg) {
        for (const p of custPath(cg, W, H, theme)) body += `<path d="${p.d}" ${p.fill ? '' : 'fill="none" '}${attrs.replace(p.fill ? '' : /fill="[^"]*"/, '')}/>`;
      } else if (/^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst)) {
        body = `<line x1="0" y1="0" x2="${W}" y2="${H}" ${attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>`;
      } else if (prst === 'ellipse' || prst === 'flowChartConnector') {
        body = `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" ${attrs}/>`;
      } else if (/^(roundRect|flowChartAlternateProcess|snipRoundRect)$/.test(prst)) {
        const r = Math.min(W, H) * 0.16667; body = `<rect width="${W}" height="${H}" rx="${r}" ${attrs}/>`;
      } else if (prst === 'textNoShape' || (!prst && !cg)) {
        body = '';
      } else {
        const pp = presetPath(prst, W, H);
        body = pp ? `<path d="${pp}" ${attrs}/>` : `<rect width="${W}" height="${H}" ${attrs}/>`;
      }
      const text = textSvg(sp, W, H, theme);
      if (!body && !text) return '';
      return `<g transform="${place(t)}">${body}${text}</g>`;
    }
    function node(n) {
      switch (ln(n)) {
        case 'wsp': return shape(n);
        case 'sp': return shape(n);
        case 'pic': {
          const spPr = one(n, 'spPr'), t = xf(spPr); const b = n.getElementsByTagNameNS(NSA, 'blip')[0];
          const rid = b && (b.getAttributeNS(NSR, 'embed') || b.getAttribute('r:embed'));
          return t && images.get(rid) ? `<g transform="${place(t)}"><image href="${images.get(rid)}" width="${t.w}" height="${t.h}" preserveAspectRatio="none"/></g>` : '';
        }
        case 'grpSp': case 'wgp': {
          const t = xf(one(n, 'grpSpPr')) || { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0, cw: 0, ch: 0 };
          const sx = t.cw ? t.w / t.cw : 1, sy = t.ch ? t.h / t.ch : 1;
          const inner = kids(n).filter((c) => /^(wsp|sp|pic|grpSp|cxnSp)$/.test(ln(c))).map(node).join('');
          return `<g transform="translate(${t.x},${t.y}) scale(${sx},${sy}) translate(${-t.cx},${-t.cy})">${inner}</g>`;
        }
        case 'cxnSp': return shape(n);
        default: return '';
      }
    }
    const top = root;
    let W = extent ? extent.cx : 0, H = extent ? extent.cy : 0;
    const gt = ln(top) === 'wgp' ? xf(one(top, 'grpSpPr')) : null;
    if (gt && !W) { W = gt.w; H = gt.h; }
    if (!W || !H) return null;
    // group at the top: children are in the group's own child space; map it to the drawing's extent
    let inner;
    if (ln(top) === 'wgp') {
      const t = gt || { cw: W, ch: H, cx: 0, cy: 0 };
      const sx = t.cw ? W / t.cw : 1, sy = t.ch ? H / t.ch : 1;
      inner = `<g transform="scale(${sx},${sy}) translate(${-t.cx},${-t.cy})">${kids(top).filter((c) => /^(wsp|pic|wgp|grpSp|cxnSp)$/.test(ln(c))).map(node).join('')}</g>`;
    } else inner = node(top);
    if (!inner.trim()) return null;
    const scale = Math.min(3, Math.max(1, 900 / (W / 9525)));           // raster resolution: at most 3x the display size
    const pw = Math.max(1, Math.round(W / 9525 * scale)), ph = Math.max(1, Math.round(H / 9525 * scale));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${W} ${H}"><defs>${defs.join('')}</defs>${inner}</svg>`;
    const blob = await new Promise((res) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = pw; c.height = ph;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, pw, ph); g.drawImage(img, 0, 0, pw, ph);
        URL.revokeObjectURL(url); c.toBlob(res, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
    return blob ? { blob, w: Math.round(W / 9525), svg } : null;
  };
})();
