/*
 * Testa os dicionários de idioma.
 *
 * Como a chave de tradução é o próprio texto em português, o risco não é a
 * tela quebrar — é a tradução morrer calada: alguém corrige um acento numa
 * frase do app.js, a chave deixa de casar e aquela linha volta ao português
 * para sempre, sem erro nenhum. Este teste é o alarme disso.
 *
 *   node dev/test-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

const sandbox = {
  window: {}, document: { documentElement: { setAttribute() {} } },
  navigator: { language: 'pt-BR' }, console
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'web', 'i18n.js'), 'utf8'), sandbox);
const I = sandbox.window.MarkPadI18n;

const app = fs.readFileSync(path.join(RAIZ, 'web', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(RAIZ, 'web', 'index.html'), 'utf8')
  .replace(/&middot;/g, '·');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FALHA ' + name + (detail ? '\n        ' + detail : '')); }
}

/** A chave aparece no código (como t('...')) ou na marcação estática? */
function existeNaFonte(chave) {
  const lit = "'" + chave.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (app.includes('t(' + lit) || app.includes('t(\n' + lit)) return true;
  // marcação estática: atributo ou nó de texto do index.html
  if (html.includes('"' + chave + '"')) return true;
  if (html.includes('>' + chave + '<')) return true;
  if (html.includes(chave)) return true;
  return false;
}

console.log('\ntoda chave do dicionario ainda existe no codigo');
{
  const orfas = Object.keys(I.DICIONARIOS.en).filter((k) => !existeNaFonte(k));
  check('nenhuma frase orfa em en', orfas.length === 0,
    orfas.length ? orfas.map((k) => JSON.stringify(k)).join('\n        ') : '');
}

console.log('\ntoda frase pedida pelo codigo esta no dicionario');
{
  // O caminho inverso do anterior: t('...') escrito no app.js sem entrada no
  // dicionário é uma frase que nunca vai traduzir — a tela fica metade em
  // inglês, metade em português, e ninguém percebe até ver a captura de tela.
  const pedidas = new Set();
  const re = /(^|[^A-Za-z0-9_$.])t\(\s*'((?:[^'\\\n]|\\.)+)'/g;
  let m;
  while ((m = re.exec(app))) {
    pedidas.add(m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  const semTraducao = [...pedidas].filter((k) => !(k in I.DICIONARIOS.en));
  check('nenhuma frase pedida sem traducao', semTraducao.length === 0,
    semTraducao.length + ' sem entrada:\n        ' +
      semTraducao.map((k) => JSON.stringify(k)).join('\n        '));
  check('o codigo pede um numero plausivel de frases', pedidas.size > 200, String(pedidas.size));
}

console.log('\nos idiomas cobrem as mesmas frases');
{
  const en = Object.keys(I.DICIONARIOS.en);
  const es = new Set(Object.keys(I.DICIONARIOS.es));
  const faltam = en.filter((k) => !es.has(k));
  check('es cobre tudo que en cobre', faltam.length === 0,
    faltam.length ? faltam.length + ' faltando, ex.: ' +
      faltam.slice(0, 6).map((k) => JSON.stringify(k)).join(', ') : '');

  const sobrando = [...es].filter((k) => !I.DICIONARIOS.en[k]);
  check('es nao inventa frase que en nao tem', sobrando.length === 0,
    sobrando.slice(0, 6).map((k) => JSON.stringify(k)).join(', '));
}

console.log('\nos marcadores {} batem dos dois lados');
{
  const quebradas = [];
  for (const [idioma, dic] of Object.entries(I.DICIONARIOS)) {
    for (const [pt, traduzido] of Object.entries(dic)) {
      const a = (pt.match(/\{\w+\}/g) || []).sort().join(',');
      const b = (traduzido.match(/\{\w+\}/g) || []).sort().join(',');
      if (a !== b) quebradas.push(idioma + ': ' + JSON.stringify(pt) + ' -> ' + JSON.stringify(traduzido));
    }
  }
  check('nenhum marcador perdido na traducao', quebradas.length === 0,
    quebradas.slice(0, 6).join('\n        '));
}

console.log('\nnenhuma traducao vazia ou igual por descuido');
{
  const vazias = [];
  for (const [idioma, dic] of Object.entries(I.DICIONARIOS)) {
    for (const [pt, tr] of Object.entries(dic)) {
      if (!tr || !String(tr).trim()) vazias.push(idioma + ': ' + JSON.stringify(pt));
    }
  }
  check('nenhuma traducao vazia', vazias.length === 0, vazias.join('\n        '));
}

console.log('\nt() em si');
{
  I.definir('pt-BR');
  check('portugues devolve a propria chave', I.t('Salvar como...') === 'Salvar como...');
  check('frase nao cadastrada atravessa', I.t('frase inventada') === 'frase inventada');

  I.definir('en');
  check('ingles traduz', I.t('Salvar como...') === 'Save as...');
  check('frase nao cadastrada cai no portugues', I.t('frase inventada') === 'frase inventada');
  check('marcador e substituido',
    I.t('Ir para a linha (1-{total}):', { total: 42 }) === 'Go to line (1-42):',
    I.t('Ir para a linha (1-{total}):', { total: 42 }));
  check('marcador sem valor fica visivel em vez de virar undefined',
    I.t('Ir para a linha (1-{total}):', {}).includes('{total}'));

  I.definir('es');
  check('espanhol traduz', I.t('Cancelar') === 'Cancelar' && I.t('Salvar') === 'Guardar');

  check('idioma desconhecido cai no portugues', I.definir('kl-KL') === 'pt-BR');
  check('auto resolve para algum idioma da lista',
    I.IDIOMAS.some((i) => i.code === I.definir('auto')));
}

console.log('\n' + passed + '/' + (passed + failed) + ' passaram');
process.exit(failed ? 1 : 0);
