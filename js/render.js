/* Simple Write: Markdown -> document.
   Markdown is the file format. Pandoc conventions are used for what plain Markdown lacks:
   $math$, $$display$$ {#eq:id}, ![caption](img.png){#fig:id width=50%}, ": caption {#tbl:id}" after a table,
   # Heading {#sec:id}, @fig:id cross-references, [@key] citations, [^1] footnotes,
   {==text==}{>>comment<<} comments (CriticMarkup), and front matter for page settings. */
(function () {
  'use strict';
  const SW = window.SW;
  const O = SW.O, C = SW.C, esc = SW.esc;
  const PH = new RegExp(O + '([A-Z])(\\d+)' + C, 'g');

  /* ---------- front matter ---------- */
  const unquote = (v) => /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
  SW.splitFrontMatter = function (md) {
    md = String(md || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const m = md.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
    if (!m) return { fm: { lines: [], meta: {} }, body: md };
    const lines = m[1].split('\n'), meta = {};
    for (const l of lines) { const k = l.match(/^([A-Za-z][\w-]*):[ \t]*(.*)$/); if (k) meta[k[1]] = unquote(k[2].trim()); }
    return { fm: { lines, meta }, body: md.slice(m[0].length).replace(/^\n+/, '') };
  };
  SW.setMeta = function (fm, key, value) {
    const re = new RegExp('^' + key + ':');
    const i = fm.lines.findIndex((l) => re.test(l));
    if (value === null || value === undefined || value === '') {
      if (i >= 0) fm.lines.splice(i, 1);
      delete fm.meta[key];
      return;
    }
    const v = /[:#{}\[\],&*?|<>=!%@`]|^\s|\s$/.test(String(value)) ? '"' + String(value).replace(/"/g, '\\"') + '"' : String(value);
    const line = key + ': ' + v;
    if (i >= 0) fm.lines[i] = line; else fm.lines.push(line);
    fm.meta[key] = String(value);
  };
  SW.joinFrontMatter = (fm, body) => (fm && fm.lines.some((l) => l.trim()) ? '---\n' + fm.lines.join('\n') + '\n---\n\n' : '') + body;

  /* ---------- marked: images with {#fig:id width=50%} attributes ---------- */
  const unbs = (t) => t.replace(/\\([\\`*_{}\[\]()#+\-.!|~$<>@])/g, '$1');
  marked.use({
    gfm: true,
    extensions: [{
      name: 'imgattr', level: 'inline',
      start(src) { const i = src.indexOf('!['); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^!\[((?:\\.|[^\]\\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+"((?:\\.|[^"\\])*)")?\s*\)\{([^}\n]*)\}/.exec(src);
        if (m) return { type: 'imgattr', raw: m[0], alt: m[1], href: m[2], title: m[3] || '', attrs: m[4] };
      },
      renderer(t) { return '<img src="' + esc(t.href) + '" alt="' + esc(unbs(t.alt)) + '"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + ' data-attrs="' + esc(t.attrs) + '">'; }
    }]
  });
  /* web addresses for video and audio: a direct file link plays in the ordinary player; YouTube and Vimeo links become embedded players.
     Only these three hosts may be embedded (the sanitizer drops any other frame). */
  SW.embedOk = (src) => /^https:\/\/(www\.youtube-nocookie\.com\/embed\/[\w-]{6,}|www\.youtube\.com\/embed\/[\w-]{6,}|player\.vimeo\.com\/video\/\d+)/.test(String(src || ''));
  SW.parseMediaUrl = function (text) {
    const t = String(text || '').trim(); let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : 'https://' + t); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    const h = u.hostname.replace(/^(www|m)\./, ''), tm = (u.searchParams.get('t') || u.searchParams.get('start') || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = tm ? (+tm[1] || 0) * 3600 + (+tm[2] || 0) * 60 + (+tm[3] || 0) : 0;
    let id = '';
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') id = u.searchParams.get('v') || ((u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]+)/) || [])[1]) || '';
    if (/^[\w-]{6,}$/.test(id)) return { kind: 'embed', src: 'https://www.youtube-nocookie.com/embed/' + id + (start ? '?start=' + start : '') };
    if (h === 'vimeo.com' || h === 'player.vimeo.com') { const m = u.pathname.match(/\/(\d{4,})(?:\/([0-9a-f]+))?/); if (m) return { kind: 'embed', src: 'https://player.vimeo.com/video/' + m[1] + (m[2] ? '?h=' + m[2] : '') }; }
    return { kind: /\.(mp3|m4a|wav|aac|oga|ogg|opus|flac|weba)$/i.test(u.pathname) ? 'audio' : 'video', src: u.href };
  };
  if (window.DOMPurify) DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node.nodeName === 'IFRAME' && !SW.embedOk(node.getAttribute('src'))) node.remove(); });
  if (window.DOMPurify) DOMPurify.addHook('uponSanitizeAttribute', (node, data) => { if (data.attrName === 'align') data.forceKeepAttr = true; });

  /* ---------- the pipeline ---------- */
  function protect(body, st) {
    const keep = (kind, list, val) => { st[list].push(val); return O + kind + (st[list].length - 1) + C; };
    let t = body
      .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[`~]*[ \t]*$|(?![\s\S]))/gm, (m) => keep('K', 'codes', m))
      .replace(/(`+)(?!`)([^\n]+?)\1(?!`)/g, (m) => keep('K', 'codes', m));
    // blocks that become objects
    t = t.replace(/^[ \t]*<!--\s*toc\s*-->[\s\S]*?<!--\s*tocstop\s*-->[ \t]*$/gim, '\n<div class="toc"></div>\n')
      .replace(/^[ \t]*(?:\[TOC\]|\[\[_TOC_\]\])[ \t]*$/gm, '\n<div class="toc"></div>\n')
      .replace(/^[ \t]*(?:<div\s+style="\s*page-break-(?:after|before)\s*:\s*always;?\s*"\s*>\s*<\/div>|\\newpage|\\pagebreak|<!--\s*pagebreak\s*-->)[ \t]*$/gim, '\n<div class="pagebreak"></div>\n');
    // math: display, then inline
    const math = (raw, tex, display, id) => keep('M', 'maths', { raw, tex: tex.trim(), display, id: id || '' });
    t = t.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$(?:[ \t]*\{#(eq:[^}\s]*)\})?/g, (m, tex, id) => math(m, tex, true, id))
      .replace(/^[ \t]*\\\[([\s\S]+?)\\\][ \t]*(?:\{#(eq:[^}\s]*)\})?[ \t]*$/gm, (m, tex, id) => math(m, tex, true, id))
      .replace(/\\\(((?:(?!\n[ \t]*\n)[\s\S])+?)\\\)/g, (m, tex) => math(m, tex, false))
      .replace(/(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g, (m, tex) => math(m, tex, false));
    // footnotes: definitions (with indented continuation lines), then references
    const defs = {};
    t = t.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.*(?:\n(?: {2,}|\t)(?!\s*\n).*)*)\n?/gm, (m, label, text) => {
      defs[label] = restore(text.replace(/\n(?: {2,}|\t)/g, '\n'), st).trim(); return '';
    });
    t = t.replace(/\[\^([^\]\s]+)\]/g, (m, label) => defs[label] !== undefined ? keep('F', 'notes', defs[label]) : m);
    // cross-references, then citations
    t = t.replace(/\[@((?:fig|eq|tbl|sec):[\w.:-]*[\w-])\]|(?<![\w.\\@])@((?:fig|eq|tbl|sec):[\w.:-]*[\w-])/g, (m, a, b) => keep('X', 'refs', a || b));
    t = t.replace(/\[(\s*-?@[\w:.\-]+(?:\s*[;,]\s*-?@[\w:.\-]+)*\s*)\](?!\()/g, (m, inner) => keep('Q', 'cites', inner.match(/@[\w:.\-]+/g).map((k) => k.slice(1).replace(/[.:]+$/, ''))));
    // comments (CriticMarkup)
    t = t.replace(/\{==([\s\S]+?)==\}[ \t]*\{>>([\s\S]*?)<<\}/g, (m, text, c) => { st.comments.push(c.trim()); return '<mark class="comment" data-cmt="' + (st.comments.length - 1) + '">' + text + '</mark>'; })
      .replace(/\{>>([\s\S]*?)<<\}/g, (m, c) => keep('P', 'comments', c.trim()))
      .replace(/\{==([\s\S]+?)==\}/g, '<mark>$1</mark>');
    // code goes back for marked
    t = t.replace(new RegExp(O + 'K(\\d+)' + C, 'g'), (m, i) => st.codes[+i]);
    return t;
  }
  // a piece of protected text back to its original source
  function restore(t, st) {
    return t.replace(PH, (m, k, i) => k === 'K' ? st.codes[+i] : k === 'M' ? st.maths[+i].raw : m);
  }

  // render a Markdown body into a detached <div>
  SW.renderBody = function (body, opts) {
    const st = { codes: [], maths: [], notes: [], refs: [], cites: [], comments: [] };
    const t = protect(body, st);
    let html;
    try { html = marked.parse(t); } catch (e) { html = '<pre>' + esc(body) + '</pre>'; }
    html = DOMPurify.sanitize(html, { ADD_TAGS: ['iframe'], ADD_ATTR: ['align', 'data-attrs', 'data-cmt', 'allowfullscreen'], FORBID_TAGS: ['style', 'form'] });
    const root = document.createElement('div');
    root.innerHTML = html;
    post(root, st, opts || {});
    return root;
  };

  /* ---------- objects ---------- */
  SW.typeset = function (el) {
    const display = el.classList.contains('display');
    let tex = el.dataset.tex || '';
    if (display && el.dataset.num && !/\\tag\*?\{/.test(tex)) tex += ' \\tag{' + el.dataset.num + '}';
    try { el.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false, output: 'htmlAndMathml' }); el.classList.remove('err'); }
    catch (e) { el.textContent = tex; el.classList.add('err'); }
  };
  const obj = (el) => { el.classList.add('obj'); el.setAttribute('contenteditable', 'false'); return el; };
  SW.makeMath = function (tex, display, id) {
    const el = obj(document.createElement(display ? 'div' : 'span'));
    el.classList.add('math'); if (display) el.classList.add('display');
    el.dataset.tex = tex; if (id) el.dataset.id = id;
    SW.typeset(el);
    return el;
  };
  SW.makeFootnote = (note) => { const el = obj(document.createElement('sup')); el.classList.add('fn'); el.dataset.note = note; el.textContent = '*'; return el; };
  SW.makeXref = (id) => { const el = obj(document.createElement('a')); el.classList.add('xref'); el.dataset.ref = id; el.textContent = '?'; return el; };
  SW.makeCite = (keys) => { const el = obj(document.createElement('span')); el.classList.add('cite'); el.dataset.keys = keys.join(';'); el.textContent = '[?]'; return el; };
  SW.makeCommentPin = (text) => { const el = obj(document.createElement('span')); el.classList.add('cpin'); el.dataset.comment = text; return el; };
  SW.makeCode = function (code, lang) {
    const el = obj(document.createElement('div'));
    el.className = 'code-block obj'; el.dataset.lang = lang || ''; el.dataset.code = code;
    el.innerHTML = '<pre><code class="hljs">' + colorCode(code, lang) + '</code></pre>';
    // the highlighter loads the first time a document has code with a language
    if (lang && !window.hljs) SW.libs.hljs().then(() => document.querySelectorAll('.code-block').forEach((b) => {
      const c = b.querySelector('code'); if (c && b.dataset.lang) c.innerHTML = colorCode(b.dataset.code || '', b.dataset.lang);
    })).catch(() => {});
    return el;
  };
  function colorCode(code, lang) {
    if (window.hljs && lang && hljs.getLanguage(lang)) { try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch (e) { /* plain */ } }
    return esc(code);
  }
  // a video or audio file: the browser's own player, so it plays wherever the browser can play the format.
  // Size, rotation and crop are only how it is shown; the file itself is never changed.
  SW.makeMedia = function (src, kind, width, rotate, crop, float) {
    const el = obj(document.createElement('div')); el.className = 'media obj';
    const mv = document.createElement('div'); mv.className = 'mv';
    if (kind === 'embed') {                                    // YouTube or Vimeo: a frame, only while online
      el.classList.add('embed'); mv.classList.add('emb');
      const f = document.createElement('iframe'); f.dataset.src = src; f.src = src; f.title = 'Online video';
      f.setAttribute('allowfullscreen', ''); f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture'); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      if (width) f.dataset.width = width;
      if (float) el.dataset.float = float;
      mv.appendChild(f); el.appendChild(mv);
      const yt = src.match(/\/embed\/([\w-]+)(?:\?start=(\d+))?/), vm = src.match(/\/video\/(\d+)(?:\?h=(\w+))?/);      // a way out when the frame is refused
      const a = document.createElement('a'); a.className = 'emb-open'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open in a new tab ↗';
      a.href = yt && /youtube/.test(src) ? 'https://www.youtube.com/watch?v=' + yt[1] + (yt[2] ? '&t=' + yt[2] : '') : vm ? 'https://vimeo.com/' + vm[1] + (vm[2] ? '/' + vm[2] : '') : src;
      el.appendChild(a);
      if (SW.media) SW.media.setup(el);
      return el;
    }
    const m = document.createElement(kind === 'audio' ? 'audio' : 'video');
    m.controls = true; m.preload = 'metadata'; m.dataset.src = src;
    m.src = SW.resolveAsset ? SW.resolveAsset(src) : src;
    if (width) m.dataset.width = width;
    if (kind !== 'audio' && rotate) m.dataset.rotate = String(rotate);
    if (kind !== 'audio' && crop) m.dataset.crop = crop;
    m.addEventListener('error', () => {
      if (el.querySelector('.media-bad')) return;
      const n = document.createElement('div'); n.className = 'media-bad';
      n.textContent = /^https?:/.test(src) ? 'Could not load ' + src + ' (you may be offline, or the website does not allow it).' : SW.assetBlob && !SW.assetBlob(src) && !/^(https?:|blob:|data:)/.test(src) ? 'File not found: ' + src : 'This browser cannot play ' + src.split('/').pop() + ' (the format is not supported). MP4 (H.264), WebM and MP3 usually play.';
      el.appendChild(n);
    });
    if (float) el.dataset.float = float;
    mv.appendChild(m); el.appendChild(mv);
    if (SW.media) SW.media.setup(el);
    return el;
  };
  SW.makePagebreak = () => { const el = obj(document.createElement('div')); el.className = 'pagebreak obj'; return el; };
  SW.makeToc = () => { const el = obj(document.createElement('div')); el.className = 'toc obj'; return el; };
  // picture size and text wrapping: width (50%, 320px) on the img; float (left, right, center) on the img or figure
  SW.layoutImg = function (o) {
    const img = o.nodeName === 'IMG' ? o : o.querySelector('img'); if (!img) return;
    const w = img.dataset.width || '', h = img.dataset.height || '', fl = o.dataset.float || '';
    img.style.height = h;                        // a set height (with a width) stretches the picture
    o.classList.remove('fl-left', 'fl-right', 'fl-center');
    if (fl) o.classList.add('fl-' + fl);
    if (o.nodeName === 'FIGURE' && (fl === 'left' || fl === 'right')) { o.style.width = w || '50%'; img.style.width = '100%'; }
    else { if (o.nodeName === 'FIGURE') o.style.width = ''; img.style.width = w; }
  };
  SW.makeTab = function () { const s = document.createElement('span'); s.className = 'tab'; s.contentEditable = 'false'; return s; };
  SW.tabify = function (root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeValue.includes('\t') && !(n.parentNode.closest && n.parentNode.closest('.obj, pre, code, .code-block')) ? 1 : 2 });
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    for (const t of list) {
      const frag = document.createDocumentFragment();
      t.nodeValue.split('\t').forEach((p, i) => { if (i) frag.appendChild(SW.makeTab()); if (p) frag.appendChild(document.createTextNode(p)); });
      t.replaceWith(frag);
    }
  };
  SW.makeFigure = function (src, caption, id, width, float) {
    const f = obj(document.createElement('figure'));
    f.className = 'fig obj';
    const img = document.createElement('img');
    img.dataset.src = src; img.src = SW.resolveAsset ? SW.resolveAsset(src) : src; img.alt = caption || '';
    if (width) { img.dataset.width = width; img.style.width = width; }
    f.appendChild(img);
    if (id) f.dataset.id = id;
    if (float) f.dataset.float = float;
    SW.layoutImg(f);
    const cap = document.createElement('figcaption');
    cap.innerHTML = '<span class="num"></span><span class="cap"></span>';
    cap.lastChild.textContent = caption || '';
    f.appendChild(cap);
    return f;
  };

  /* ---------- after marked: placeholders and structures ---------- */
  const INLINE_PARENT = /^(P|SPAN|EM|STRONG|B|I|U|S|DEL|A|MARK|SUB|SUP|H[1-6])$/;
  function post(root, st, opts) {
    // placeholders inside attributes go back to their source text
    root.querySelectorAll('[alt],[title],[href]').forEach((el) => {
      for (const a of ['alt', 'title', 'href']) { const v = el.getAttribute(a); if (v && v.includes(O)) el.setAttribute(a, restore(v, st)); }
    });
    // placeholders in text become objects
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = []; while (w.nextNode()) if (w.currentNode.nodeValue.includes(O)) texts.push(w.currentNode);
    for (const tn of texts) {
      const parts = tn.nodeValue.split(PH);   // text, kind, index, text, ...
      const frag = document.createDocumentFragment();
      for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) { if (parts[i]) frag.appendChild(document.createTextNode(parts[i])); continue; }
        const k = parts[i], n = +parts[++i];
        let el = null;
        if (k === 'M') { const m = st.maths[n]; el = SW.makeMath(m.tex, m.display, m.id); }
        else if (k === 'F') el = SW.makeFootnote(st.notes[n]);
        else if (k === 'X') el = SW.makeXref(st.refs[n]);
        else if (k === 'Q') el = SW.makeCite(st.cites[n]);
        else if (k === 'P') el = SW.makeCommentPin(st.comments[n]);
        if (el) frag.appendChild(el);
      }
      tn.replaceWith(frag);
    }
    // display math cannot sit inside a paragraph: split it
    root.querySelectorAll('.math.display').forEach((m) => {
      let p = m.parentNode;
      while (p && p !== root && INLINE_PARENT.test(p.nodeName)) {
        const after = p.cloneNode(false);
        while (m.nextSibling) after.appendChild(m.nextSibling);
        p.after(m); m.after(after);
        for (const x of [after, p]) if (!x.textContent.trim() && !x.querySelector('img,.obj')) x.remove();
        p = m.parentNode;
      }
      for (const s of [m.previousSibling, m.nextSibling]) if (s && s.nodeName === 'BR') s.remove();
    });
    // code blocks
    root.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const lang = code ? ((code.className.match(/language-(\S+)/) || [])[1] || '') : '';
      const text = (code || pre).textContent.replace(/\n$/, '');
      pre.replaceWith(SW.makeCode(text, lang));
    });
    // pictures: attributes, assets, figures
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      const attrs = img.getAttribute('data-attrs') || '';
      img.removeAttribute('data-attrs');
      const id = (attrs.match(/#([^\s}]+)/) || [])[1] || '';
      const width = (attrs.match(/width\s*=\s*"?([\d.]+(?:%|px|in|cm)?)/) || [])[1] || '';
      const fl = (attrs.match(/float\s*=\s*"?(left|right|center)/) || [])[1] || '';
      const height = (attrs.match(/height\s*=\s*"?([\d.]+(?:px|in|cm)?)/) || [])[1] || '';
      const p = img.parentNode;
      const alone = p && p.nodeName === 'P' && [...p.childNodes].every((n) => n === img || (n.nodeType === 3 && !n.nodeValue.trim()));
      if (alone && (img.alt || id)) { const f = SW.makeFigure(src, img.alt, id, width, fl); if (height) { f.querySelector('img').dataset.height = height; SW.layoutImg(f); } p.replaceWith(f); return; }
      img.dataset.src = src;
      if (SW.resolveAsset) img.src = SW.resolveAsset(src);
      if (width) img.dataset.width = width;
      if (height) img.dataset.height = height;
      if (fl) img.dataset.float = fl;
      SW.layoutImg(img);
    });
    SW.tabify(root);
    // table captions (": Caption {#tbl:id}" or "Table: Caption" next to a table)
    root.querySelectorAll('p').forEach((p) => {
      const first = p.firstChild;
      if (!first || first.nodeType !== 3 || !/^\s*(Table)?:\s/.test(first.nodeValue)) return;
      const prev = p.previousElementSibling, next = p.nextElementSibling;
      if (!(prev && prev.nodeName === 'TABLE') && !(next && next.nodeName === 'TABLE')) return;
      first.nodeValue = first.nodeValue.replace(/^\s*(Table)?:\s+/, '');
      const last = p.lastChild;
      if (last && last.nodeType === 3) {
        const m = last.nodeValue.match(/\s*\{#([^}\s]+)\}\s*$/);
        if (m) { p.dataset.id = m[1]; last.nodeValue = last.nodeValue.slice(0, m.index); }
      }
      p.classList.add('tcap');
      p.insertAdjacentHTML('afterbegin', '<span class="num" contenteditable="false"></span>');
    });
    // tables: no stray whitespace, header row
    root.querySelectorAll('table').forEach((t) => SW.cleanTable(t));
    // headings: {#id}
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      const last = h.lastChild;
      if (last && last.nodeType === 3) {
        const m = last.nodeValue.match(/\s*\{#([^}\s]+)\}\s*$/);
        if (m) { h.dataset.id = m[1]; last.nodeValue = last.nodeValue.slice(0, m.index); }
      }
    });
    // <div align="center"> wrappers become paragraph alignment
    root.querySelectorAll('div[align], p[align]').forEach((d) => {
      const a = (d.getAttribute('align') || '').toLowerCase();
      const al = { center: 'center', right: 'right', justify: 'justify' }[a];
      if (d.nodeName === 'P') { d.removeAttribute('align'); if (al) d.style.textAlign = al; return; }
      const kids = [...d.childNodes];
      const frag = document.createDocumentFragment();
      let loose = null;
      for (const k of kids) {
        if (k.nodeType === 1 && /^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|FIGURE|DIV)$/.test(k.nodeName)) {
          loose = null;
          if (al && /^(P|H[1-6])$/.test(k.nodeName)) k.style.textAlign = al;
          frag.appendChild(k);
        } else if (k.nodeType === 3 && !k.nodeValue.trim()) { /* skip */ } else {
          if (!loose) { loose = document.createElement('p'); if (al) loose.style.textAlign = al; frag.appendChild(loose); }
          loose.appendChild(k);
        }
      }
      d.replaceWith(frag);
    });
    // comments
    root.querySelectorAll('mark[data-cmt]').forEach((m) => { m.className = 'comment'; m.dataset.comment = st.comments[+m.dataset.cmt] || ''; m.removeAttribute('data-cmt'); });
    // checklists
    root.querySelectorAll('li > input[type=checkbox]').forEach((c) => { c.removeAttribute('disabled'); c.parentNode.classList.add('task'); });
    // simple objects
    root.querySelectorAll('video, audio').forEach((m) => {
      if (m.closest('.obj')) return;
      const src = m.getAttribute('src') || (m.querySelector('source') || { getAttribute: () => '' }).getAttribute('src') || '';
      const el = SW.makeMedia(src, m.nodeName === 'AUDIO' ? 'audio' : 'video', (m.getAttribute('width') || '').replace(/px$/, ''), parseInt(m.getAttribute('data-rotate') || '0', 10) || 0, m.getAttribute('data-crop') || '', (m.getAttribute('data-float') || '').replace(/[^a-z]/g, ''));
      const p = m.parentNode, alone = p && p.nodeName === 'P' && [...p.childNodes].every((n) => n === m || (n.nodeType === 3 && !n.nodeValue.trim()));
      (alone ? p : m).replaceWith(el);
    });
    root.querySelectorAll('iframe').forEach((f) => {
      if (f.closest('.obj')) return;
      const el = SW.makeMedia(f.getAttribute('src') || '', 'embed', (f.getAttribute('width') || '').replace(/px$/, ''), 0, '', (f.getAttribute('data-float') || '').replace(/[^a-z]/g, ''));
      const p = f.parentNode, alone = p && p.nodeName === 'P' && [...p.childNodes].every((n) => n === f || (n.nodeType === 3 && !n.nodeValue.trim()));
      (alone ? p : f).replaceWith(el);
    });
    root.querySelectorAll('div.pagebreak').forEach((d) => d.replaceWith(SW.makePagebreak()));
    root.querySelectorAll('div.toc').forEach((d) => d.replaceWith(SW.makeToc()));
    // links open in a new tab
    root.querySelectorAll('a[href]').forEach((a) => { if (!a.classList.contains('xref')) a.setAttribute('target', '_blank'); });
  }

  SW.cleanTable = function (t) {
    t.querySelectorAll('tr').forEach((tr) => [...tr.childNodes].forEach((n) => { if (n.nodeType !== 1) n.remove(); }));
    [...t.childNodes].forEach((n) => { if (n.nodeType === 3 && !n.nodeValue.trim()) n.remove(); });
    t.querySelectorAll('thead, tbody').forEach((s) => [...s.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); }));
  };

  /* ---------- numbering, references, notes, bibliography, contents ---------- */
  SW.decorate = function (root, derived, opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    const labels = {};
    // sections
    const numsec = /^(true|yes|1)$/i.test(meta.numbersections || '');
    const count = [0, 0, 0, 0, 0, 0];
    const heads = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    for (const h of heads) {
      const lv = +h.nodeName[1];
      if (numsec) {
        count[lv - 1]++; for (let i = lv; i < 6; i++) count[i] = 0;
        let s = count.slice(0, lv); while (s.length > 1 && s[0] === 0) s = s.slice(1);
        h.setAttribute('data-secnum', s.join('.'));
      } else h.removeAttribute('data-secnum');
      if (h.dataset.id) labels[h.dataset.id] = numsec ? 'Section ' + h.getAttribute('data-secnum') : '\u201C' + h.textContent.trim() + '\u201D';
      h.id = h.dataset.id || 'h-' + SW.slug(h.textContent);
    }
    // figures
    let nf = 0;
    root.querySelectorAll('figure.fig').forEach((f) => {
      const num = f.querySelector('.num');
      if (f.dataset.id) { nf++; f.id = f.dataset.id; labels[f.dataset.id] = 'Figure ' + nf; if (num) num.textContent = 'Figure ' + nf + (f.querySelector('.cap').textContent ? ': ' : ''); }
      else if (num) num.textContent = '';
    });
    // tables
    let nt = 0;
    root.querySelectorAll('.tcap').forEach((p) => {
      let num = p.querySelector('.num');
      if (!num) { p.insertAdjacentHTML('afterbegin', '<span class="num" contenteditable="false"></span>'); num = p.firstChild; }
      if (p.dataset.id) { nt++; p.id = p.dataset.id; labels[p.dataset.id] = 'Table ' + nt; num.textContent = 'Table ' + nt + ': '; }
      else num.textContent = '';
    });
    // equations
    let ne = 0;
    root.querySelectorAll('.math.display').forEach((m) => {
      if (m.dataset.id) { ne++; m.id = m.dataset.id; labels[m.dataset.id] = 'Eq. (' + ne + ')'; if (m.dataset.num !== String(ne)) { m.dataset.num = ne; SW.typeset(m); } }
      else if (m.dataset.num) { delete m.dataset.num; SW.typeset(m); }
    });
    // cross-references
    root.querySelectorAll('.xref').forEach((a) => {
      const t = labels[a.dataset.ref];
      a.textContent = t || '??' + a.dataset.ref;
      a.classList.toggle('broken', !t);
      const target = root.querySelector('[data-id="' + CSS.escape(a.dataset.ref) + '"]');
      if (target && target.id) a.setAttribute('href', '#' + target.id); else a.removeAttribute('href');
    });
    const out = [];
    // citations (numbered in order of first use)
    const bib = SW.bib ? SW.bib.entries() : {};
    const order = [];
    root.querySelectorAll('.cite').forEach((c) => {
      const keys = c.dataset.keys.split(';').filter(Boolean);
      const nums = keys.map((k) => { if (!bib[k]) return null; let i = order.indexOf(k); if (i < 0) { order.push(k); i = order.length - 1; } return i + 1; });
      const ok = nums.filter((n) => n);
      c.classList.toggle('broken', ok.length < keys.length);
      c.textContent = '[' + (ok.length ? SW.compressNums(ok) : '') + (ok.length < keys.length ? (ok.length ? ', ' : '') + '?' : '') + ']';
      c.title = keys.map((k) => bib[k] ? SW.bib.shortText(bib[k]) : k + ' (not in the references)').join('\n');
    });
    if (order.length) {
      out.push('<section class="refs-sec"><h2>References</h2><ol class="refs">' + order.map((k, i) => '<li><span class="rn">[' + (i + 1) + ']</span>' + SW.bib.html(bib[k]) + '</li>').join('') + '</ol></section>');
    }
    // footnotes
    const fns = [...root.querySelectorAll('.fn')];
    fns.forEach((f, i) => { f.textContent = i + 1; f.title = f.dataset.note; });
    if (fns.length) out.push('<section class="notes-sec"><h2>Notes</h2><ol>' + fns.map((f) => '<li>' + SW.renderInline(f.dataset.note) + '</li>').join('') + '</ol></section>');
    // table of contents
    root.querySelectorAll('.toc').forEach((toc) => {
      const items = heads.filter((h) => +h.nodeName[1] <= 3 && !h.closest('.toc'));
      let html = '<div class="toc-title">Contents</div>', lv = 0;
      for (const h of items) {
        const l = +h.nodeName[1];
        while (lv < l) { html += '<ul>'; lv++; }
        while (lv > l) { html += '</ul>'; lv--; }
        html += '<li><a href="#' + esc(h.id) + '">' + esc((h.getAttribute('data-secnum') ? h.getAttribute('data-secnum') + ' ' : '') + h.textContent.trim()) + '</a></li>';
      }
      while (lv > 0) { html += '</ul>'; lv--; }
      if (!items.length) html += '<div class="hint">(add headings to fill the contents)</div>';
      if (toc.innerHTML !== html) toc.innerHTML = html;
    });
    const dhtml = out.join('');
    if (derived) { if (derived.innerHTML !== dhtml) derived.innerHTML = dhtml; }
    else if (dhtml) root.insertAdjacentHTML('beforeend', '<div class="derived">' + dhtml + '</div>');
    root.classList && root.classList.toggle('numsec', numsec);
    return labels;
  };
  SW.compressNums = function (nums) {
    nums = [...new Set(nums)].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(j - i >= 2 ? nums[i] + '\u2013' + nums[j] : j > i ? nums[i] + ', ' + nums[j] : String(nums[i]));
      i = j;
    }
    return out.join(', ');
  };
  // a short piece of Markdown (a note) to HTML
  SW.renderInline = function (md) {
    const r = SW.renderBody(md || '');
    const p = r.firstElementChild;
    return p && r.children.length === 1 && p.nodeName === 'P' ? p.innerHTML : r.innerHTML;
  };

  // a full Markdown file rendered for printing or export (no editing affordances needed)
  SW.renderForExport = function (md) {
    const sp = SW.splitFrontMatter(md);
    const root = SW.renderBody(sp.body);
    root.className = 'doc';
    SW.decorate(root, null, { meta: sp.fm.meta });
    return { root, meta: sp.fm.meta };
  };
})();
