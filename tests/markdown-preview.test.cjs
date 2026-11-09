const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const built = buildSync({ entryPoints: ['src/markdown-preview.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = new Module('mp', module); mod._compile(built.outputFiles[0].text, 'mp.js');
const { parseMarkdown, parseInline, isMarkdownPath, MAX_PREVIEW_CHARS } = mod.exports;
const J = v => JSON.parse(JSON.stringify(v));
const blocks = s => J(parseMarkdown(s).blocks);

test('detects markdown files by extension only', () => {
  for (const p of ['a.md', 'dir/README.MD', 'x.markdown', 'y.mkd']) assert.equal(isMarkdownPath(p), true, p);
  for (const p of ['a.mdx', 'a.txt', 'md', 'a.md.bak', '', undefined]) assert.equal(isMarkdownPath(p), false, String(p));
});

test('headings, paragraphs (soft breaks join), hr, quote', () => {
  const b = blocks('# Title #\n\nline one\nline two\n\n---\n\n> quoted\n> more');
  assert.equal(b[0].t, 'heading'); assert.equal(b[0].level, 1); assert.equal(b[0].children[0].text, 'Title');
  assert.deepEqual(b[1].children, [{ t: 'text', text: 'line one line two' }]);
  assert.equal(b[2].t, 'hr');
  assert.equal(b[3].t, 'quote'); assert.equal(b[3].children[0].children[0].text, 'quoted more');
});

test('fenced code keeps text verbatim, including markdown and HTML, and survives an unclosed fence', () => {
  const b = blocks('```js\nconst a = "<b>x</b>"; # not heading\n```\nafter\n\n~~~\nnever closed\n# still code');
  assert.deepEqual([b[0].t, b[0].lang, b[0].text], ['code', 'js', 'const a = "<b>x</b>"; # not heading']);
  assert.equal(b[1].children[0].text, 'after');
  assert.deepEqual([b[2].t, b[2].text], ['code', 'never closed\n# still code']);
});

test('lists: bullets, ordered with start, nesting, continuation', () => {
  const b = blocks('- one\n- two\n  - nested\n  - nested2\n- three\n\n3. third\n4. fourth');
  assert.equal(b[0].t, 'list'); assert.equal(b[0].ordered, false); assert.equal(b[0].items.length, 3);
  assert.equal(b[0].items[1][1].t, 'list'); assert.equal(b[0].items[1][1].items.length, 2);
  assert.equal(b[1].ordered, true); assert.equal(b[1].start, 3); assert.equal(b[1].items.length, 2);
});

test('inline: code, strong, em, escapes, snake_case stays literal', () => {
  const i = J(parseInline('a `x*y` **b *c* d** \\*lit\\* snake_case_name _em_'));
  assert.deepEqual(i.find(n => n.t === 'code'), { t: 'code', text: 'x*y' });
  assert.equal(i.find(n => n.t === 'strong').children.length, 3);
  const flat = i.map(n => n.t === 'text' ? n.text : n.t).join('|');
  assert.match(flat, /\*lit\*/); assert.match(flat, /snake_case_name/);
  assert.ok(i.some(n => n.t === 'em' && n.children[0].text === 'em'));
});

test('links: only http(s)/mailto are marked safe; images never load, javascript: is inert text', () => {
  const i = J(parseInline('[ok](https://x.dev/a) [bad](javascript:alert(1)) [rel](./doc.md) ![pic](https://evil/p.png) <https://auto.link>'));
  const links = i.filter(n => n.t === 'link');
  assert.deepEqual(links.map(l => [l.href, l.safe]), [['https://x.dev/a', true], ['javascript:alert(1', false], ['./doc.md', false], ['https://auto.link', true]]);
  assert.deepEqual(i.find(n => n.t === 'image'), { t: 'image', alt: 'pic', href: 'https://evil/p.png' });
});

test('raw HTML is plain text, never structure', () => {
  const b = blocks('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.equal(b.length, 2);
  assert.equal(b[0].children[0].text, '<script>alert(1)</script>');
  assert.ok(b.every(x => x.t === 'paragraph' && x.children.every(c => c.t === 'text')));
});

test('tables with alignment, and a pipe line without a separator stays a paragraph', () => {
  const b = blocks('| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | x\\|y |\n\nsolo | pipe');
  assert.equal(b[0].t, 'table'); assert.deepEqual(b[0].align, ['left', 'right']);
  assert.equal(b[0].rows.length, 2); assert.equal(b[0].rows[1][1][0].text, 'x|y');
  assert.equal(b[1].t, 'paragraph');
});

test('indented code after a blank line; huge and hostile input is bounded', () => {
  assert.equal(blocks('para\n\n    code line\n    more')[1].t, 'code');
  const big = parseMarkdown('x'.repeat(MAX_PREVIEW_CHARS + 500));
  assert.equal(big.truncated, true);
  const deep = '>'.repeat(200) + ' deep\n' + '- a\n'.repeat(1) + ' '.repeat(2) + '- '.repeat(100) + 'x';
  assert.doesNotThrow(() => parseMarkdown(deep));
  assert.doesNotThrow(() => parseMarkdown('*'.repeat(5000) + '_'.repeat(5000) + '['.repeat(3000)));
  assert.deepEqual(J(parseMarkdown('').blocks), []);
  assert.equal(parseMarkdown(null).truncated, false);
});

const fs = require('node:fs');
test('EditorPanel wiring: toggle only for markdown files, editor stays mounted (content preserved), no HTML injection', () => {
  const panel = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  assert.match(panel, /!diff && !compare && isMarkdownPath\(config\.path\)/);
  assert.match(panel, /<MarkdownPreview source=\{value\} \/>/);
  assert.match(panel, /wrapperProps=\{mdPreview && isMarkdownPath\(config\.path\)/, 'Monaco is hidden, never unmounted');
  assert.match(panel, /aria-pressed=\{mdPreview\}/);
  const ui = fs.readFileSync('src/MarkdownPreview.tsx', 'utf8');
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML|innerHTML|<a |<img|href=|src=|window\.hrig/);
  assert.match(fs.readFileSync('src/markdown-preview.ts', 'utf8'), /never HTML strings/);
});

test('actual MarkdownPreview renders elements only: links inert, images unloaded, HTML as text', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const view = mountComponent('src/MarkdownPreview.tsx', 'default', {
    source: '# Hi\n\n[x](https://a.dev) ![p](https://e/p.png) <script>1</script>\n\n- a\n- b\n\n```\ncode\n```',
  }, { actualComponents: true, resolvedChildren: true, height: 400, rowHeight: 20 });
  view.update({ source: '# Hi\n\n[x](https://a.dev) ![p](https://e/p.png) <script>1</script>\n\n- a\n- b\n\n```\ncode\n```' });
  const nodes = view.nodes();
  const types = new Set(nodes.map(n => n.type));
  for (const bad of ['a', 'img', 'script', 'iframe']) assert.ok(!types.has(bad), bad + ' must not be rendered');
  for (const good of ['h1', 'ul', 'li', 'pre']) assert.ok(types.has(good), good);
  const text = view.text(nodes.find(n => n.props?.className === 'markdown-preview'));
  assert.match(text, /<script>1<\/script>/); assert.match(text, /\[image: p\]/); assert.match(text, /\(https:\/\/a\.dev\)/);
});

test('pathological inline input stays fast (unclosed openers are bounded)', () => {
  const t = () => Date.now();
  for (const unit of ['**a ', '__a ', '*a ', '`a ', '[a](b ', '![a](b ', '_ a ']) {
    const src = unit.repeat(Math.floor(200000 / unit.length));
    const t0 = t();
    parseMarkdown(src);
    assert.ok(t() - t0 < 1500, `${JSON.stringify(unit)} took ${t() - t0} ms`);
  }
  // Short paragraphs still format; very long single paragraphs fall back to plain text.
  assert.equal(parseInline('a **b** c')[1].t, 'strong');
  assert.deepEqual(parseInline('**x** '.repeat(5000)).map(n => n.t), ['text']);
});

test('link and autolink openers are bounded too (QA f920a90)', () => {
  for (const unit of ['[', '[a](', '![', '[a](b "c', '<http://a', '[a]( ']) {
    const src = unit.repeat(Math.floor(19990 / unit.length));
    const t0 = Date.now();
    parseInline(src);
    assert.ok(Date.now() - t0 < 300, `${JSON.stringify(unit)} paragraph took ${Date.now() - t0} ms`);
    const big = unit.repeat(Math.floor(200000 / unit.length));
    const t1 = Date.now(); parseMarkdown(big);
    assert.ok(Date.now() - t1 < 1500, `${JSON.stringify(unit)} 200KB took ${Date.now() - t1} ms`);
  }
  // Normal links still parse, including a title and spaces inside the parens.
  assert.equal(parseInline('see [docs]( https://x.io/a "T" ) now')[1].t, 'link');
  assert.equal(parseInline('see [docs](https://x.io/a) now')[1].href, 'https://x.io/a');
  assert.equal(parseInline('<https://x.io>')[0].t, 'link');
});
