// Testes do realce do modo codigo-fonte, sem navegador.
//   node dev/test-highlight.js
//
// O modo fonte e um textarea transparente por cima de uma camada colorida.
// So funciona se, em cada linha, a camada mostrar EXATAMENTE o texto do
// arquivo: um caractere a mais (ou uma tag escapada duas vezes) e o cursor
// passa a cair longe do que se ve. Em 03/11/2026 uma citacao com `codigo`
// mostrava <span class="tok-md-code"> como texto e, somado ao tamanho de
// fonte dos titulos, o fim do arquivo ficava 11 linhas abaixo do cursor.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'highlight.js'), 'utf8'), sandbox, { filename: 'highlight.js' });
const H = sandbox.MarkPadHighlight;

let ok = 0, falhas = 0;
function check(nome, cond, detalhe) {
  if (cond) { ok++; return; }
  falhas++;
  console.log('FALHOU: ' + nome + (detalhe ? '\n   ' + detalhe : ''));
}

function textoVisivel(html) {
  return html.replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const AMOSTRA = [
  '---',
  'title: Teste <com> & sinais',
  '---',
  '# Titulo com `codigo` e **negrito**',
  '## Segundo nivel',
  '',
  'Paragrafo com *italico*, ==destaque==, ~~riscado~~, [link](https://x.com "t") e <b>html</b>.',
  '> Citacao com `codigo`, **negrito** e [[wikilink|apelido]].',
  '> [!tip] Callout com `note` e `info`',
  '> [!example]- Dobravel com <tag> e &amp;',
  '>> citacao aninhada com `a < b`',
  '- item com `x` e #tag',
  '  1. numerado com **b**',
  '- [ ] tarefa com $x^2$',
  '| a | `b \\| c` | <c> |',
  '|---|:-:|--:|',
  '```js',
  'const a = "<div>" && b < c;',
  '```',
  '%% comentario com <html> %%',
  'Linha com & e < e > soltos'
];

const linhas = H.highlightMarkdownSource(AMOSTRA.join('\n')).split('\n');

check('a camada tem uma linha para cada linha do arquivo', linhas.length === AMOSTRA.length,
  linhas.length + ' x ' + AMOSTRA.length);

AMOSTRA.forEach(function (src, i) {
  const vis = textoVisivel(linhas[i] || '');
  check('linha ' + (i + 1) + ' mostra o texto do arquivo', vis === src,
    'arquivo: ' + JSON.stringify(src) + '\n   camada:  ' + JSON.stringify(vis));
});

check('citacao com codigo nao escapa as proprias tags', !/&lt;span/.test(linhas[7] + linhas[8]));

// (A camada de realce do modo fonte saiu: o modo fonte agora e o editor
// CodeMirror, sem textarea por cima de outra camada para desalinhar.)

console.log(ok + '/' + (ok + falhas) + ' passaram');
process.exit(falhas ? 1 : 0);
