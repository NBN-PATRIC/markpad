/*
 * Testa a edição bloco a bloco sem navegador.
 *
 * O risco real dessa funcionalidade é corromper o arquivo: trocar um bloco
 * pelo texto editado tem que deixar TODO o resto byte a byte igual. É isso
 * que este teste cobre, usando o mapa data-line/data-line-end que o parser
 * emite e a mesma aritmética de fatiamento do liveedit.js.
 *
 *   node dev/test-liveedit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const web = path.join(__dirname, '..', 'web');
const sandbox = { window: {}, document: {}, console };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['highlight.js', 'markdown.js']) {
  vm.runInContext(fs.readFileSync(path.join(web, f), 'utf8'), sandbox);
}
const md = sandbox.window.MarkPadMarkdown;

let passed = 0, failed = 0;

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FALHA ' + name + (detail ? '\n        ' + detail : '')); }
}

/** Os blocos de primeiro nível, na ordem, com seu intervalo de linhas. */
function topBlocks(source) {
  const html = md.render(source, { lineMap: true }).html;
  const out = [];
  let depth = 0;

  // Só interessam as marcações que não estão aninhadas dentro de outro bloco.
  const re = /<(\/?)(\w+)([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const fechando = m[1] === '/';
    const attrs = m[3] || '';
    const autoFechado = /\/$/.test(attrs) || /^(hr|img|br|input)$/i.test(m[2]);

    if (!fechando && depth === 0) {
      const a = /data-line="(\d+)"/.exec(attrs);
      const b = /data-line-end="(\d+)"/.exec(attrs);
      if (a && b) out.push({ start: +a[1], end: +b[1] });
    }
    if (autoFechado) continue;
    depth += fechando ? -1 : 1;
    if (depth < 0) depth = 0;
  }
  return out;
}

/** A mesma aritmética do liveedit.js: troca [start..end] pelo texto novo. */
function spliceBlock(source, start, end, replacement) {
  const lines = source.split('\n');
  return lines.slice(0, start)
    .concat(replacement.split('\n'), lines.slice(end + 1))
    .join('\n');
}

const DOC = [
  '---',
  'title: Exemplo',
  '---',
  '',
  '# Titulo',
  '',
  'Paragrafo de',
  'duas linhas.',
  '',
  '- item um',
  '- item dois',
  '',
  '> [!note] Aviso',
  '> corpo do aviso',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  'Fim.'
].join('\n');

console.log('\nmapa de blocos');
const blocks = topBlocks(DOC);
check('encontrou blocos de primeiro nivel', blocks.length >= 6, blocks.length + ' blocos');

console.log('\nextracao do markdown cru de cada bloco');
const linhas = DOC.split('\n');
const esperados = ['# Titulo', 'Paragrafo de', '- item um', '> [!note] Aviso', '| a | b |', '```js', 'Fim.'];
let achou = 0;
for (const b of blocks) {
  const src = linhas.slice(b.start, b.end + 1).join('\n');
  if (esperados.some(function (e) { return src.startsWith(e); })) achou++;
}
check('cada bloco extrai o fonte certo', achou === blocks.length,
  achou + ' de ' + blocks.length + ' baterem');

console.log('\nround-trip: reescrever o bloco com o proprio texto nao muda nada');
let intacto = true;
let culpado = null;
for (const b of blocks) {
  const src = linhas.slice(b.start, b.end + 1).join('\n');
  const depois = spliceBlock(DOC, b.start, b.end, src);
  if (depois !== DOC) { intacto = false; culpado = JSON.stringify(src.slice(0, 40)); break; }
}
check('documento identico apos reescrita', intacto, culpado ? 'bloco: ' + culpado : '');

console.log('\nedicao real preserva o resto do arquivo');
const alvo = blocks.find(function (b) { return linhas[b.start] === 'Paragrafo de'; });
check('achou o paragrafo de duas linhas', !!alvo);

if (alvo) {
  const editado = spliceBlock(DOC, alvo.start, alvo.end, 'Paragrafo **editado**.');
  const antes = DOC.split('\n').slice(0, alvo.start).join('\n');
  const depois = DOC.split('\n').slice(alvo.end + 1).join('\n');

  check('tudo antes do bloco intacto', editado.startsWith(antes));
  check('tudo depois do bloco intacto', editado.endsWith(depois));
  check('bloco realmente trocado', editado.includes('Paragrafo **editado**.'));
  check('texto antigo sumiu', !editado.includes('duas linhas.'));
  check('frontmatter preservado', editado.startsWith('---\ntitle: Exemplo\n---'));
  check('bloco de codigo preservado', editado.includes('```js\nconst x = 1;\n```'));
}

console.log('\nbloco que cresce e encolhe');
if (alvo) {
  const cresceu = spliceBlock(DOC, alvo.start, alvo.end, 'a\nb\nc\nd');
  check('crescer nao come as linhas seguintes', cresceu.includes('- item um') && cresceu.includes('Fim.'));

  const encolheu = spliceBlock(DOC, alvo.start, alvo.end, 'so uma linha');
  check('encolher nao come as linhas seguintes', encolheu.includes('- item um') && encolheu.includes('Fim.'));

  const vazio = spliceBlock(DOC, alvo.start, alvo.end, '');
  check('esvaziar nao corrompe', vazio.includes('# Titulo') && vazio.includes('Fim.'));
}

console.log('\nsincronizacao repetida (o caso que ja quebrou uma vez)');
if (alvo) {
  // Simula a digitação: cada tecla sincroniza. Depois da primeira vez o
  // intervalo original não vale mais, então o liveedit acompanha quantas
  // linhas o bloco ocupa AGORA. Se essa contabilidade estiver errada, o
  // documento vai duplicando ou comendo linhas.
  let doc = DOC;
  let ocupadas = alvo.end - alvo.start + 1;
  for (const texto of ['P', 'Pa\nra', 'Pa\nra\ngrafo', 'final']) {
    const l = doc.split('\n');
    doc = l.slice(0, alvo.start).concat(texto.split('\n'), l.slice(alvo.start + ocupadas)).join('\n');
    ocupadas = texto.split('\n').length;
  }
  check('documento nao duplicou linhas', (doc.match(/- item um/g) || []).length === 1, doc);
  check('nada foi comido depois do bloco', doc.includes('Fim.') && doc.includes('```js'));
  check('conteudo final correto', doc.includes('\nfinal\n'));
}

console.log('\n' + passed + '/' + (passed + failed) + ' passaram');
process.exit(failed ? 1 : 0);
