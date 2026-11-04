// Testes das operacoes de texto puras (web/textops.js), sem navegador.
//   node dev/test-textops.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'textops.js'), 'utf8'), sandbox);
const T = sandbox.MarkPadTextOps;

let ok = 0, falhas = 0;
function igual(nome, obtido, esperado) {
  if (obtido === esperado) { ok++; return; }
  falhas++;
  console.log('FALHOU: ' + nome + '\n   esperado: ' + JSON.stringify(esperado) + '\n   obtido:   ' + JSON.stringify(obtido));
}

// ------------------------------------------------ substituir tudo, regex
let r = T.replaceAll('2026-11-04 e 2025-01-31', /(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1', true);
igual('grupos numerados', r.text, '04/11/2026 e 31/01/2025');
igual('contagem', r.count, 2);

r = T.replaceAll('ana maria', /(?<primeiro>\w+) (?<segundo>\w+)/g, '$<segundo>, $<primeiro>', true);
igual('grupos com nome', r.text, 'maria, ana');

igual('trecho inteiro com $&', T.replaceAll('abc', /b/g, '[$&]', true).text, 'a[b]c');
igual('cifrao escapado', T.replaceAll('preco', /preco/g, 'R$$ 10', true).text, 'R$ 10');
igual('quebra de linha no modo regex', T.replaceAll('a, b, c', /, /g, '\\n', true).text, 'a\nb\nc');
igual('tab e barra no modo regex', T.replaceAll('a|b', /\|/g, '\\t\\\\', true).text, 'a\t\\b');
igual('$12 sem grupo 12 vira grupo 1 + "2"', T.replaceAll('xy', /(x)(y)/g, '$12', true).text, 'x2');
igual('grupo inexistente fica literal', T.replaceAll('x', /(x)/g, '$5', true).text, '$5');
igual('grupo opcional vazio', T.replaceAll('a', /(a)(b)?/g, '[$2]', true).text, '[]');

// ------------------------------------------- fora do modo regex: literal
igual('literal mantem cifrao', T.replaceAll('a.b', /\./g, '$1 $& \\n', false).text, 'a$1 $& \\nb');

// ---------------------------------------------------- uma ocorrencia so
let um = T.replacementAt('foo bar foo', /(f)(oo)/g, 8, '$2$1', true);
igual('ocorrencia na posicao', um && um.text, 'oof');
igual('fim da ocorrencia', um && um.end, 11);
um = T.replacementAt('xfoo', /(?<=x)foo/g, 1, 'BAR', true);
igual('lookbehind respeita o contexto', um && um.text, 'BAR');
igual('nao casa fora da posicao', T.replacementAt('foo', /foo/g, 1, 'x', true), null);
um = T.replacementAt('Abc', /a/gi, 0, '[$&]', true);
igual('mantem a flag i', um && um.text, '[A]');

console.log(ok + '/' + (ok + falhas) + ' passaram');
process.exit(falhas ? 1 : 0);
