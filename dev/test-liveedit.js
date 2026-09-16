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

/*
 * Qual bloco o clique abre.
 *
 * Até aqui o teste cobria a aritmética de fatiar o documento, que é onde mora
 * o risco de corromper arquivo. Mas o modo ao vivo já ficou inteiro inútil por
 * outro motivo, e sem nenhum teste reclamar: o recolhimento embrulha tudo que
 * segue um título numa `.heading-section` sem `data-line`, e a regra antiga
 * procurava o bloco entre os filhos DIRETOS do painel. Num documento com
 * títulos — ou seja, em todos — clicar num parágrafo não abria editor nenhum,
 * e o modo parecia "só leitura que não deixa editar".
 *
 * Então aqui o alvo é o `topBlock` de verdade, exercitado pelo mesmo
 * `mousedown` que o app dispara, sobre a forma de DOM que o app realmente
 * monta (app.js move os nós para dentro da `.heading-section`, e as seções
 * aninham).
 */
console.log('\nqual bloco o clique abre');
{
  const liveSandbox = { window: {}, document: {}, console };
  liveSandbox.global = liveSandbox;
  vm.createContext(liveSandbox);
  vm.runInContext(fs.readFileSync(path.join(web, 'liveedit.js'), 'utf8'), liveSandbox);

  /** Casa seletores simples separados por vírgula: `tag`, `.classe`. */
  function casa(no, seletor) {
    return seletor.split(',').some((parte) => {
      const s = parte.trim();
      if (s.startsWith('.')) return no.classList.contains(s.slice(1));
      return no.tagName === s.toUpperCase();
    });
  }

  function criar(tag, attrs = {}, filhos = []) {
    const no = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: attrs.class || '',
      _attrs: attrs,
      parentNode: null,
      hasAttribute: (n) => Object.prototype.hasOwnProperty.call(no._attrs, n),
      getAttribute: (n) => (no.hasAttribute(n) ? String(no._attrs[n]) : null),
      classList: { contains: (c) => (no.className || '').split(/\s+/).includes(c) },
      closest(sel) {
        let p = no;
        while (p && p.nodeType === 1) { if (casa(p, sel)) return p; p = p.parentNode; }
        return null;
      },
      addEventListener(tipo, fn) { (no._ouvintes[tipo] = no._ouvintes[tipo] || []).push(fn); },
      _ouvintes: {}
    };
    filhos.forEach((f) => { f.parentNode = no; });
    no.childNodes = filhos;
    return no;
  }

  // A forma que app.js monta: cada título leva o que vem depois para dentro de
  // uma .heading-section, e uma seção dentro da outra quando os níveis aninham.
  const alvoParagrafo = criar('p', { 'data-line': 6, 'data-line-end': 6 });
  const link = criar('a', { href: '#' });
  const paragrafoComLink = criar('p', { 'data-line': 8, 'data-line-end': 8 }, [link]);
  const subLista = criar('ul', { 'data-line': 11, 'data-line-end': 12 });
  const itemComSubLista = criar('li', {}, [subLista]);
  const listaExterna = criar('ul', { 'data-line': 10, 'data-line-end': 12 }, [itemComSubLista]);
  const chevron = criar('span', { class: 'fold-chevron' });
  const h2 = criar('h2', { 'data-line': 4, 'data-line-end': 4, class: 'is-foldable' }, [chevron]);

  const secaoInterna = criar('div', { class: 'heading-section' },
    [alvoParagrafo, paragrafoComLink, listaExterna]);
  const secaoExterna = criar('div', { class: 'heading-section' }, [h2, secaoInterna]);
  const h1 = criar('h1', { 'data-line': 0, 'data-line-end': 0 });
  const raiz = criar('div', { id: 'preview' }, [h1, secaoExterna]);

  let editavel = true;
  const live = liveSandbox.window.MarkPadLiveEdit.create(raiz, {
    getContent: () => '', setContent: () => {}, isEditable: () => editavel
  });

  let abriu = null;
  live.enter = function (block) { abriu = block; };

  function clicar(alvo) {
    abriu = null;
    raiz._ouvintes.mousedown.forEach((fn) => fn({
      button: 0, target: alvo, clientX: 10, clientY: 10, preventDefault() {}
    }));
    return abriu;
  }

  check('paragrafo dentro de duas heading-section abre editor',
    clicar(alvoParagrafo) === alvoParagrafo,
    'foi ' + (abriu ? abriu.tagName : 'nenhum'));

  check('e o bloco NAO e filho direto da raiz (era esse o bug)',
    alvoParagrafo.parentNode !== raiz);

  check('o titulo embrulhador tambem abre',
    clicar(h2) === h2, 'foi ' + (abriu ? abriu.tagName : 'nenhum'));

  check('clique na sublista edita a lista inteira, nao a sublista',
    clicar(subLista) === listaExterna,
    'foi ' + (abriu ? abriu.tagName + ' linha ' + abriu.getAttribute('data-line') : 'nenhum'));

  check('a setinha de recolher nao abre editor', clicar(chevron) === null);
  check('link continua clicavel', clicar(link) === null);
  check('clique na propria seccao (sem data-line) nao abre nada',
    clicar(secaoInterna) === null);

  editavel = false;
  check('com o documento travado nao abre nada', clicar(alvoParagrafo) === null);
}

console.log('\n' + passed + '/' + (passed + failed) + ' passaram');
process.exit(failed ? 1 : 0);
