/*
 * Testa as paletas e o import de tema do VS Code.
 *
 * O risco aqui é duplo. O bobo: uma paleta com fundo e texto perto demais
 * deixa a interface ilegível, e ninguém percebe até abrir naquele tema. O
 * sério: o tema importado é um arquivo de fora que acaba dentro do CSS da
 * janela — se o filtro deixar passar o que não é cor, a página inteira fica
 * refém de um .json que alguém mandou por e-mail.
 *
 *   node dev/test-themes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// themes.js escreve no <body> quando aplica; aqui só as funções puras
// interessam, então o documento é um boneco que registra o que recebeu.
const escritas = {};
const sandbox = {
  console,
  window: {},
  document: {
    body: {
      style: {
        setProperty: (k, v) => { escritas[k] = v; },
        removeProperty: (k) => { delete escritas[k]; }
      },
      classList: { contains: () => true }
    }
  }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'web', 'themes.js'), 'utf8'), sandbox);
const T = sandbox.window.MarkPadThemes;

let passed = 0, failed = 0;

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FALHA ' + name + (detail ? '\n        ' + detail : '')); }
}

// ------------------------------------------------------------- contraste

function rgb(hex) {
  let s = String(hex).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lum(hex) {
  const c = rgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contraste(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

console.log('\ncada paleta e legivel nos dois modos');
T.PALETAS.forEach((p) => {
  ['dark', 'light'].forEach((modo) => {
    const m = p[modo];
    if (!m) return; // 'markpad' e a propria folha embutida
    const fundo = m['--color-base-00'];
    const texto = m['--color-base-100'];
    // Tudo nesta interface e texto de tamanho normal, inclusive o "apagado"
    // (--text-muted): a regua e 4.5:1 para os dois, nao 3:1.
    const c = contraste(fundo, texto);
    check(p.id + '/' + modo + ': texto sobre fundo >= 4.5:1 (WCAG AA)', c >= 4.5,
      c.toFixed(2) + ':1  (' + fundo + ' / ' + texto + ')');

    const fraco = m['--color-base-70']; // --text-muted
    const cf = contraste(fundo, fraco);
    check(p.id + '/' + modo + ': texto apagado >= 4.5:1 (WCAG AA)', cf >= 4.5,
      cf.toFixed(2) + ':1  (' + fundo + ' / ' + fraco + ')');

    check(p.id + '/' + modo + ': a escada tem os 12 degraus',
      ['00', '05', '10', '20', '25', '30', '35', '40', '50', '60', '70', '100']
        .every((d) => !!m['--color-base-' + d]));

    check(p.id + '/' + modo + ': modo bate com a luminancia do fundo',
      T.ehEscuro(fundo) === (modo === 'dark'), fundo);
  });
});

console.log('\nfiltro de cor');
{
  const bons = ['#fff', '#1e1e1e', '#1e1e1eff', 'rgb(1,2,3)', 'rgba(1,2,3,.5)',
    'rgb(1 2 3 / 50%)', 'hsl(258, 88%, 66%)', 'transparent', 'white'];
  bons.forEach((v) => check('aceita ' + v, T.corSegura(v)));

  const maus = [
    '#fff; } * { display: none }',
    'url(https://exemplo/pixel.png)',
    'var(--outra)',
    'red !important',
    'expression(alert(1))',
    '#gggggg',
    '',
    '   ',
    'rgb(1,2,3) url(x)',
    'a'.repeat(80),
    42,
    null
  ];
  maus.forEach((v) => check('recusa ' + JSON.stringify(v).slice(0, 40), !T.corSegura(v)));
}

console.log('\nimport de tema do VS Code');
{
  const tema = JSON.stringify({
    name: 'Meu Tema',
    type: 'dark',
    colors: {
      'editor.background': '#101418',
      'editor.foreground': '#e8eef4',
      'sideBar.background': '#161b21',
      focusBorder: '#4aa3ff'
    }
  });
  const t = T.doVSCode(tema, 'arquivo');
  check('le o nome', t.nome === 'Meu Tema', t.nome);
  check('reconhece que e escuro', t.escuro === true);
  check('fundo veio do editor', t.vars['--color-base-00'] === '#101418', t.vars['--color-base-00']);
  check('texto veio do editor', t.vars['--color-base-100'] === '#e8eef4');
  check('barra lateral veio da sideBar', t.vars['--color-base-20'] === '#161b21');
  check('acento veio do focusBorder', t.acento === '#4aa3ff', String(t.acento));
  check('a escada foi interpolada', !!t.vars['--color-base-40'] && !!t.vars['--color-base-60']);
  const c = contraste(t.vars['--color-base-00'], t.vars['--color-base-100']);
  check('o tema importado e legivel', c >= 7, c.toFixed(2) + ':1');
}

console.log('\ntema do VS Code com jsonc (comentario e virgula sobrando)');
{
  const tema = `{
    // o tema favorito
    "name": "Com Comentario",
    "type": "light",
    "colors": {
      "editor.background": "#ffffff", /* fundo */
      "editor.foreground": "#1a1a1a",
    },
  }`;
  const t = T.doVSCode(tema, 'x');
  check('leu mesmo assim', t.nome === 'Com Comentario' && t.escuro === false);
  check('nao confundiu // dentro de string',
    T.doVSCode('{"name":"http://exemplo.com","colors":{"editor.background":"#fff","editor.foreground":"#000"}}', 'x')
      .nome === 'http://exemplo.com');
}

console.log('\ntema hostil nao chega ao CSS');
{
  const tema = JSON.stringify({
    name: 'Cavalo'.repeat(40),
    type: 'dark',
    colors: {
      'editor.background': '#101418',
      'editor.foreground': '#e8eef4',
      'sideBar.background': 'url(https://exemplo/farol.png)',
      'input.background': '#fff; } html { display: none } :root {',
      errorForeground: 'expression(alert(1))',
      focusBorder: 'javascript:alert(1)'
    }
  });
  const t = T.doVSCode(tema, 'x');
  check('nome fica curto', t.nome.length <= 60, String(t.nome.length));
  check('url() nao virou fundo da lateral',
    String(t.vars['--color-base-20']).indexOf('url(') === -1, String(t.vars['--color-base-20']));
  check('valor com } nao entrou',
    Object.keys(t.vars).every((k) => String(t.vars[k]).indexOf('}') === -1));
  check('acento hostil caiu no padrao',
    t.acento && t.acento.indexOf('javascript') === -1, String(t.acento));
  check('nada de expression()',
    Object.keys(t.vars).every((k) => String(t.vars[k]).indexOf('expression') === -1));
}

console.log('\ntema sem o minimo necessario');
{
  const casos = [
    ['nao e json', 'isso nao e json'],
    ['sem colors', '{"name":"x"}'],
    ['sem fundo e texto', '{"colors":{"sideBar.background":"#fff"}}']
  ];
  casos.forEach(([nome, txt]) => {
    let erro = null;
    try { T.doVSCode(txt, 'x'); } catch (e) { erro = e; }
    check('recusa: ' + nome, !!erro && !!erro.message, erro ? erro.message : 'nao lancou');
  });
}

console.log('\naplicar e trocar de paleta nao deixa sobra');
{
  T.aplicar({ paletaId: 'nord', escuro: true, acento: '', importado: null });
  const depoisNord = Object.keys(escritas).length;
  check('nord escreveu variaveis', depoisNord > 10, String(depoisNord));
  check('escreveu o acento como componentes', escritas['--accent-s'].endsWith('%'),
    escritas['--accent-h'] + ' / ' + escritas['--accent-s'] + ' / ' + escritas['--accent-l']);

  T.aplicar({ paletaId: 'markpad', escuro: true, acento: '', importado: null });
  check('voltar para a paleta de casa limpa tudo', Object.keys(escritas).length === 0,
    JSON.stringify(Object.keys(escritas)));

  T.aplicar({ paletaId: 'markpad', escuro: true, acento: '#ff0000', importado: null });
  check('acento a mao vale sozinho', escritas['--accent-h'] === '0', JSON.stringify(escritas));

  // Tema claro com a janela escura: o importado nao entra, a paleta manda.
  const claro = { nome: 'c', escuro: false, vars: { '--color-base-00': '#ffffff' }, acento: '#000000' };
  T.aplicar({ paletaId: 'nord', escuro: true, acento: '', importado: claro });
  check('tema importado de outro modo nao entra',
    escritas['--color-base-00'] !== '#ffffff', escritas['--color-base-00']);

  // E o importado guardado nas configuracoes passa pelo filtro de novo.
  const adulterado = { nome: 'c', escuro: true, vars: { '--color-base-00': 'url(https://x/p.png)' }, acento: 'nada' };
  T.aplicar({ paletaId: 'markpad', escuro: true, acento: '', importado: adulterado });
  check('importado adulterado em disco nao passa',
    !escritas['--color-base-00'], String(escritas['--color-base-00']));
}

console.log('\n' + passed + '/' + (passed + failed) + ' passaram');
process.exit(failed ? 1 : 0);
