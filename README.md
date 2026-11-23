# Simple Write

A browser word processor in the spirit of Microsoft Word, simplified, that keeps documents as Markdown.

- Word-like editing with a toolbar, plus a switch to the Markdown source
- Equations in LaTeX (KaTeX) with a palette and live preview; pasted equations from Simple Solver, Word and web pages are converted
- Figures, tables with captions, numbered equations, cross-references, BibTeX citations, footnotes, comments (CriticMarkup), table of contents, code blocks
- Headers, footers and page numbers; page breaks on screen follow the text
- Present pages as full-screen slides, with backgrounds, transitions and a slide sorter
- Video and audio files inside the document, or links to online video
- Opens and saves Markdown, Word (.docx, with native Word equations, footnotes and comments), HTML, plain text and zip; saves PDF through printing
- Autosaved drafts in the browser, one document per tab
- Optional AI: a prompt line, notes to the AI inside the text, and dictation, using your own provider key or a model on your computer

## Getting started

Open `index.html` in a browser. No build step and no installation are needed. It works offline from a local folder: the libraries are in `lib/`, with CDN copies as a fallback when `lib/` is missing.

Opened from a web address (https, or `localhost`), the app can also be installed to the Home Screen or desktop, and then runs with no Internet connection. It picks up changed files whenever it is online. Install and offline use are provided by `sw.js`, which must be served from the same folder as `index.html`.

YouTube embeds need the page to come from a web address. Opened straight from a folder, YouTube refuses to play; use a local server such as `python3 -m http.server` instead.

See `help.html` for the user guide.

## Privacy and AI

Documents stay in your browser unless you save them to a file or use AI. AI is off until you add a key in **Set up AI**. When you invoke it, the text you send (the document or the selection, with your request), the notes to the AI, or the audio you dictate goes to the provider you chose. Providers: OpenAI, Anthropic (Claude), Google Gemini, OpenRouter, Ollama running on your own computer, and any OpenAI-compatible server such as LM Studio. Keys are kept only in the browser and sent only to their provider.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout, menus and dialogs |
| `help.html` | User guide |
| `LICENSE` | GNU General Public License, version 3 |
| `css/style.css` | Styles, including print |
| `js/util.js` | Shared helpers, library loader, MathML to LaTeX |
| `js/render.js` | Markdown to document: math, figures, numbering, references |
| `js/tomd.js` | Document or pasted HTML to Markdown |
| `js/editor.js` | Editing, undo history, objects, tables, clipboard |
| `js/dialogs.js` | Equation, picture, table, citation, page setup and other dialogs |
| `js/files.js` | Opening, saving, pictures, drafts, HTML and text export |
| `js/docx.js` | Word export, LaTeX to Word equations |
| `js/docxread.js` | Word import: reads the .docx package directly |
| `js/import.js` | Word import helpers, Word equations to LaTeX |
| `js/shapes.js` | Word drawings (shapes and groups) to pictures |
| `js/bib.js` | BibTeX reading and reference formatting |
| `js/layout.js` | Zoom, ruler (margins, tab stops), tab layout, picture resize handles |
| `js/csv.js` | Table from a CSV/TSV file |
| `js/picture.js` | Rotating, flipping and cropping pictures |
| `js/media.js` | Video and audio files, and online video links, in the document |
| `js/paginate.js` | Page boundaries on screen: pushes the block that does not fit to the next sheet (screen-only margin), draws the gap, numbers the pages |
| `js/headfoot.js` | Headers and footers: zones, {page} {pages} {title} {author} {date}, on-screen rows, print and Word output |
| `js/present.js` | Present: pages as full-screen slides (keys, swipe, backgrounds, transitions, list reveal) |
| `js/sorter.js` | Slide sorter: thumbnails of the pages, drag to reorder, duplicate, delete, add |
| `js/dictate.js` | Dictation: the browser's speech recognition, or recording sent to the AI provider, speech from audio files |
| `js/ai.js` | AI prompt line: providers, model lists, streaming answers |
| `js/app.js` | Menus, toolbar, views, start-up, service worker registration |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install to the Home Screen and run offline. Files are fetched fresh when online and kept for offline use. Add new files to the list in `sw.js` (anything missed is still stored after its first use) |
| `favicon.svg` | Icon for the app and its help page |

## Libraries

Bundled in `lib/`, each under its own license:

| Library | License |
|---|---|
| KaTeX | MIT |
| marked | MIT |
| DOMPurify | Apache-2.0 or MPL-2.0 (dual) |
| Turndown | MIT |
| highlight.js | BSD-3-Clause |
| JSZip | MIT or GPL-3.0 (dual) |

## License

Copyright © 2026 Francisco Ruiz

Simple Write is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the `LICENSE` file for the full text.
