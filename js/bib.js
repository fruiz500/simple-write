/* Simple Write: BibTeX references (numbered, IEEE-like style) */
(function () {
  'use strict';
  const SW = window.SW;
  let text = '', entries = {};

  const ACC = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', 'u': '̆', 'v': '̌', 'H': '̋', 'c': '̧', 'k': '̨', 'r': '̊' };
  const SPECIAL = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', '&': '&', '%': '%', '$': '$', '#': '#', '_': '_' };
  function clean(v) {
    return String(v || '')
      .replace(/\\([`'^"~=.uvHckr])\s*\{?\s*\\?([A-Za-z])\s*\}?/g, (m, a, ch) => (ch + ACC[a]).normalize('NFC'))
      .replace(/\{?\\(ss|o|O|ae|AE|oe|OE|aa|AA|l|L|i|j)\}?(?![A-Za-z])/g, (m, s) => SPECIAL[s])
      .replace(/\\([&%$#_])/g, '$1')
      .replace(/\\(?:textit|emph|textbf|textrm|mathrm|text)\{([^{}]*)\}/g, '$1')
      .replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ')
      .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }

  function parse(src) {
    const out = {};
    let i = 0;
    const n = src.length;
    while (i < n) {
      const at = src.indexOf('@', i);
      if (at < 0) break;
      const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(at, at + 60));
      if (!m) { i = at + 1; continue; }
      const type = m[1].toLowerCase();
      const close = m[2] === '{' ? '}' : ')';
      let j = at + m[0].length;
      // find the end of the entry by brace depth
      let depth = 1, k = j;
      while (k < n && depth > 0) { const c = src[k]; if (c === '{' || (c === '(' && close === ')')) depth++; else if (c === '}' || (c === ')' && close === ')')) depth--; k++; }
      const body = src.slice(j, k - 1);
      i = k;
      if (type === 'comment' || type === 'preamble' || type === 'string') continue;
      const comma = body.indexOf(',');
      if (comma < 0) continue;
      const key = body.slice(0, comma).trim();
      const fields = {};
      let p = comma + 1;
      while (p < body.length) {
        const fm = /^\s*([A-Za-z][\w\-:]*)\s*=\s*/.exec(body.slice(p));
        if (!fm) break;
        p += fm[0].length;
        let val = '';
        if (body[p] === '{') {
          let d = 0, q = p;
          for (; q < body.length; q++) { if (body[q] === '{') d++; else if (body[q] === '}') { d--; if (d === 0) break; } }
          val = body.slice(p + 1, q); p = q + 1;
        } else if (body[p] === '"') {
          let q = p + 1, d = 0;
          for (; q < body.length; q++) { if (body[q] === '{') d++; else if (body[q] === '}') d--; else if (body[q] === '"' && d === 0) break; }
          val = body.slice(p + 1, q); p = q + 1;
        } else { const vm = /^[^,]*/.exec(body.slice(p)); val = vm[0].trim(); p += vm[0].length; }
        fields[fm[1].toLowerCase()] = val;
        const cm = /^\s*,?/.exec(body.slice(p)); p += cm[0].length;
      }
      if (key) out[key] = { key, type, fields };
    }
    return out;
  }

  function names(list) {
    return String(list || '').split(/\s+and\s+/i).map((a) => a.trim()).filter(Boolean).map((a) => {
      a = clean(a);
      let first = '', last = a;
      if (a.includes(',')) { [last, first] = a.split(',').map((x) => x.trim()); }
      else { const parts = a.split(/\s+/); last = parts.pop(); first = parts.join(' '); }
      const ini = first.split(/[\s-]+/).filter(Boolean).map((w) => /^[A-Z]\.?$/.test(w) ? w[0] + '.' : w[0] + '.').join(' ');
      return { first, last, short: (ini ? ini + ' ' : '') + last };
    });
  }
  function authorList(e) {
    const a = names(e.fields.author || e.fields.editor);
    if (!a.length) return '';
    if (a.length > 6) return a[0].short + ' et al.';
    if (a.length === 1) return a[0].short;
    return a.slice(0, -1).map((x) => x.short).join(', ') + (a.length > 2 ? ',' : '') + ' and ' + a[a.length - 1].short;
  }

  // pieces of formatted text: [{t: text, i: italic}]
  function parts(e) {
    const f = (k) => clean(e.fields[k]);
    const out = [];
    const add = (t, i) => { if (t) out.push({ t, i: !!i }); };
    const au = authorList(e);
    if (au) add(au + ', ');
    const title = f('title');
    const pages = f('pages') ? (f('pages').includes('–') || f('pages').includes('-') ? 'pp. ' : 'p. ') + f('pages').replace(/-+/g, '–') : '';
    const year = f('year') || (f('date') || '').slice(0, 4);
    if (e.type === 'book') {
      add(title, true); add('. ');
      add([f('edition') ? f('edition') + ' ed.' : '', [f('address'), f('publisher')].filter(Boolean).join(': '), year].filter(Boolean).join(', '));
    } else if (e.type === 'inproceedings' || e.type === 'conference' || e.type === 'incollection') {
      add('“' + title + ',” in ');
      add(f('booktitle'), true);
      add([f('address'), f('publisher'), year, pages].filter(Boolean).map((x) => ', ' + x).join(''));
    } else if (e.type === 'article') {
      add('“' + title + ',” ');
      add(f('journal') || f('journaltitle'), true);
      add([f('volume') ? 'vol. ' + f('volume') : '', f('number') ? 'no. ' + f('number') : '', pages, year].filter(Boolean).map((x) => ', ' + x).join(''));
    } else if (e.type === 'phdthesis' || e.type === 'mastersthesis') {
      add('“' + title + ',” ' + (e.type === 'phdthesis' ? 'Ph.D. dissertation' : 'M.S. thesis'));
      add([f('school') || f('institution'), year].filter(Boolean).map((x) => ', ' + x).join(''));
    } else {
      add(title ? '“' + title + ',” ' : '');
      add([f('howpublished'), f('institution'), f('publisher'), f('organization'), year].filter(Boolean).join(', '));
    }
    let tail = '.';
    const last = out[out.length - 1];
    if (last && /[.,]\s*$/.test(last.t)) last.t = last.t.replace(/[,\s]+$/, '');
    out.push({ t: tail });
    const doi = clean(e.fields.doi), url = clean(e.fields.url);
    if (doi) out.push({ t: ' doi: ' + doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '') + '.', link: 'https://doi.org/' + doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '') });
    else if (url) out.push({ t: ' ' + url, link: url });
    return out;
  }

  SW.bib = {
    get text() { return text; },
    set(t) { text = t || ''; entries = parse(text); },
    add(t) {
      const fresh = parse(t);
      const keys = Object.keys(fresh);
      if (!keys.length) return { added: 0, replaced: 0 };
      let replaced = 0;
      for (const k of keys) {
        if (entries[k]) {
          replaced++;
          // drop the old entry from the text
          const re = new RegExp('@\\s*\\w+\\s*\\{\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,');
          const m = re.exec(text);
          if (m) { let d = 0, q = text.indexOf('{', m.index); for (; q < text.length; q++) { if (text[q] === '{') d++; else if (text[q] === '}') { d--; if (d === 0) break; } } text = text.slice(0, m.index) + text.slice(q + 1); }
        }
      }
      text = (text.trim() ? text.trim() + '\n\n' : '') + t.trim() + '\n';
      entries = parse(text);
      return { added: keys.length - replaced, replaced };
    },
    entries: () => entries,
    parts,
    html(e) { return parts(e).map((p) => { const t = SW.esc(p.t); return p.link ? '<a href="' + SW.esc(p.link) + '" target="_blank" rel="noopener">' + t + '</a>' : p.i ? '<i>' + t + '</i>' : t; }).join(''); },
    plain(e) { return parts(e).map((p) => p.t).join(''); },
    shortText(e) { const a = names(e.fields.author || e.fields.editor); return (a.length ? a[0].last + (a.length > 1 ? ' et al.' : '') + ', ' : '') + (clean(e.fields.year) ? clean(e.fields.year) + ': ' : '') + clean(e.fields.title); },
    clean
  };
})();
