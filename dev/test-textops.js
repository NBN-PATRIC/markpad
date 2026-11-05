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

// ------------------------------------------------ operacoes com linhas
function aplica(texto, r) { return r ? texto.slice(0, r.ini) + r.texto + texto.slice(r.fim) : texto; }
var tx;

tx = 'cebola\nAbacate\n10 itens\n2 itens\nbanana';
igual('ordenar A-Z pt-BR (caixa e numeros naturais)', aplica(tx, T.ordenaLinhas(tx, 0, tx.length, 'az')), '2 itens\n10 itens\nAbacate\nbanana\ncebola');
igual('ordenar Z-A', aplica(tx, T.ordenaLinhas(tx, 0, tx.length, 'za')), 'cebola\nbanana\nAbacate\n10 itens\n2 itens');
igual('inverter', aplica('a\nb\nc', T.ordenaLinhas('a\nb\nc', 0, 5, 'inverter')), 'c\nb\na');
igual('por tamanho', aplica('ccc\na\nbb', T.ordenaLinhas('ccc\na\nbb', 0, 8, 'tamanho')), 'a\nbb\nccc');
tx = 'x\nc\nb\na\ny';
igual('so as linhas da selecao', aplica(tx, T.ordenaLinhas(tx, 2, 7, 'az')), 'x\na\nb\nc\ny');
igual('fim no comeco da linha nao inclui ela', aplica(tx, T.ordenaLinhas(tx, 2, 6, 'az')), 'x\nb\nc\na\ny');
igual('acentos ordenam como letra', aplica('éa\neb\nea', T.ordenaLinhas('éa\neb\nea', 0, 8, 'az')), 'éa\nea\neb');

tx = '- [ ] zebra\n  - filho z\n- [x] abelha\n  continua\n- macaco';
igual('lista: subitens e continuacao vao junto', aplica(tx, T.ordenaLista(tx, 0, tx.length, 'az')),
  '- [x] abelha\n  continua\n- macaco\n- [ ] zebra\n  - filho z');
tx = '1. zeta\n2. alfa\n   detalhe\n3. beta';
igual('lista numerada renumera', aplica(tx, T.ordenaLista(tx, 0, tx.length, 'az')), '1. alfa\n   detalhe\n2. beta\n3. zeta');

tx = 'a\nb\na\na\nc\nb';
igual('remove duplicadas (todas)', aplica(tx, T.removeDuplicadas(tx, 0, tx.length, false)), 'a\nb\nc');
igual('remove duplicadas seguidas', aplica(tx, T.removeDuplicadas(tx, 0, tx.length, true)), 'a\nb\na\nc\nb');
tx = 'a\n\n\n\nb\n\nc';
igual('reduz vazias seguidas a uma', aplica(tx, T.reduzVazias(tx, 0, tx.length)), 'a\n\nb\n\nc');
igual('remove vazias', aplica(tx, T.removeVazias(tx, 0, tx.length)), 'a\nb\nc');

tx = 'Texto colado de um\n  PDF com manu-\ntencao e\n> citacao';
igual('unir linhas tira recuo, citacao e hifen de quebra', aplica(tx, T.unirLinhas(tx, 0, tx.length)), 'Texto colado de um PDF com manutencao e citacao');
tx = 'linha um\nlinha dois\nlinha tres';
igual('unir sem selecao junta com a de baixo', aplica(tx, T.unirLinhas(tx, 3, 3)), 'linha um linha dois\nlinha tres');
igual('unir na ultima linha nao faz nada', T.unirLinhas(tx, tx.length, tx.length), null);

tx = 'quebra forcada   \nproxima\nlixo  \t\n\n```\ncodigo   \n```\nfim   ';
igual('aparar preserva quebra forcada e o codigo cercado', aplica(tx, T.aparaDireita(tx, 0, 0)),
  'quebra forcada  \nproxima\nlixo\n\n```\ncodigo   \n```\nfim');
tx = '\t- item\n  \t- sub';
igual('TAB para espacos so no recuo', aplica(tx, T.trocaRecuo(tx, 0, 0, true, 4)), '    - item\n    - sub');
igual('espacos para TAB', aplica('        x\n  y', T.trocaRecuo('        x\n  y', 0, 0, false, 4)), '\t\tx\n  y');

tx = 'relatório de ação da rede';
igual('maiusculas', aplica(tx, T.trocaCaixa(tx, 0, tx.length, 'maiusculas')), 'RELATÓRIO DE AÇÃO DA REDE');
igual('titulo pt-BR deixa particulas', aplica(tx, T.trocaCaixa(tx, 0, tx.length, 'titulo')), 'Relatório de Ação da Rede');
igual('frase', aplica('ola MUNDO. tudo BEM? sim', T.trocaCaixa('ola MUNDO. tudo BEM? sim', 0, 24, 'frase')), 'Ola mundo. Tudo bem? Sim');
igual('sem selecao: a palavra do cursor', aplica('um ação três', T.trocaCaixa('um ação três', 5, 5, 'maiusculas')), 'um AÇÃO três');

tx = 'abc\ndef';
igual('duplica a selecao depois dela', aplica(tx, T.duplica(tx, 1, 3)), 'abcbc\ndef');
var d = T.duplica(tx, 5, 5);
igual('duplica a linha sem selecao', aplica(tx, d), 'abc\ndef\ndef');
igual('cursor vai para a copia, mesma coluna', d.selIni, 9);
tx = 'a\nb\nc\nd';
var m = T.moveLinhas(tx, 2, 5, -1);
igual('move as linhas da selecao para cima', aplica(tx, m), 'b\nc\na\nd');
igual('a selecao acompanha', [m.selIni, m.selFim].join(','), '0,3');
igual('move para baixo', aplica(tx, T.moveLinhas(tx, 2, 5, 1)), 'a\nd\nb\nc');
igual('nao sobe da primeira', T.moveLinhas(tx, 0, 0, -1), null);
igual('apaga as linhas da selecao (fim no comeco da linha nao a inclui)', aplica(tx, T.apagaLinhas(tx, 2, 4)), 'a\nc\nd');
igual('apaga duas linhas', aplica(tx, T.apagaLinhas(tx, 2, 5)), 'a\nd');
igual('apaga a ultima linha', aplica(tx, T.apagaLinhas(tx, 6, 6)), 'a\nb\nc');

// tabelas
igual('celulas com barra escapada', T.celulasDaLinha('| [[a\\|b]] | 2 |').join(' # '), '[[a\\|b]] # 2');
igual('celulas sem bordas', T.celulasDaLinha('a | b').join(' # '), 'a # b');
igual('formata alinhando as colunas',
  T.formataTabela('|a|bbbb|\n|-|-|\n|ccc|d|'),
  '| a   | bbbb |\n| --- | ---- |\n| ccc | d    |');
igual('respeita o alinhamento da linha de tracos',
  T.formataTabela('| n | v |\n|:-:|--:|\n| x | 10 |\n| yy | 2 |'),
  '|  n  |   v |\n| :-: | --: |\n|  x  |  10 |\n| yy  |   2 |');
igual('linha curta ganha as celulas que faltam',
  T.formataTabela('| a | b | c |\n|---|---|---|\n| 1 |'),
  '| a   | b   | c   |\n| --- | --- | --- |\n| 1   |     |     |');
igual('sem linha de tracos nao mexe', T.formataTabela('| a | b |\n| c | d |'), '| a | b |\n| c | d |');
igual('acento conta como um caractere', T.formataTabela('| ação | b |\n|---|---|\n| x | y |'), '| ação | b   |\n| ---- | --- |\n| x    | y   |');
var f = T.faixaDaCelula('| abc | de  |', 1);
igual('faixa da celula sem os espacos', [f.ini, f.fim].join(','), '8,10');
var fv = T.faixaDaCelula('|      |       |', 0);
igual('celula vazia: cursor depois do espaco da borda', [fv.ini, fv.fim].join(','), '2,2');
igual('coluna do cursor', T.colunaNaLinha('| a | b | c |', 9), 2);
igual('coluna com barra escapada', T.colunaNaLinha('| a\\|x | b |', 9), 1);

console.log(ok + '/' + (ok + falhas) + ' passaram');
process.exit(falhas ? 1 : 0);
