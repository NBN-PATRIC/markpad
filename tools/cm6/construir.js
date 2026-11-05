// Gera web/codemirror.js (CodeMirror 6 + Lezer, num arquivo so, global CM)
// e o THIRD-PARTY-NOTICES.md com as licencas do que foi embutido.
//
//   node tools/cm6/construir.js
//
// A compilacao e o node_modules ficam FORA da pasta sincronizada (regra do
// hub: o ownCloud ja cortou arquivo recem-gravado), em C:\dev\markpad-cm6 ou
// em MARKPAD_CM6_DIR. As versoes sao as do package-lock.json desta pasta:
// `npm ci` instala exatamente elas. Para atualizar uma biblioteca, troque a
// versao no package.json daqui, rode `npm install` na pasta de compilacao,
// copie o package-lock.json de volta e confira o diff antes de commitar.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AQUI = __dirname;
const RAIZ = path.join(AQUI, '..', '..');
const DIR = process.env.MARKPAD_CM6_DIR || 'C:\\dev\\markpad-cm6';

fs.mkdirSync(DIR, { recursive: true });
for (const f of ['package.json', 'package-lock.json', 'entrada.js']) {
  fs.copyFileSync(path.join(AQUI, f), path.join(DIR, f));
}

const lock = JSON.parse(fs.readFileSync(path.join(AQUI, 'package-lock.json'), 'utf8'));
const marca = path.join(DIR, 'node_modules', '.markpad-lock');
const lockTexto = fs.readFileSync(path.join(AQUI, 'package-lock.json'), 'utf8');
if (!fs.existsSync(marca) || fs.readFileSync(marca, 'utf8') !== lockTexto) {
  console.log('npm ci em ' + DIR);
  execSync('npm ci --no-audit --no-fund', { cwd: DIR, stdio: 'inherit' });
  fs.writeFileSync(marca, lockTexto);
}

const esbuild = path.join(DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const saida = path.join(DIR, 'codemirror.js');
execSync('"' + esbuild + '" entrada.js --bundle --format=iife --global-name=CM --minify --target=chrome110 --legal-comments=none --outfile=codemirror.js',
  { cwd: DIR, stdio: 'inherit' });

// Pacotes embutidos: tudo do lock, menos as ferramentas de compilacao.
const pacotes = Object.keys(lock.packages)
  .filter((k) => k.indexOf('node_modules/') === 0)
  .map((k) => ({ nome: k.slice('node_modules/'.length), info: lock.packages[k] }))
  // Fora do que vai para o app: o compilador, o DOM do turndown fora do
  // navegador (no pacote do navegador nao entra) e a linha de comando do KaTeX.
  .filter((p) => !/^(@esbuild\/|esbuild$|@mixmark-io\/domino$|commander$)/.test(p.nome) && !p.info.dev)
  .sort((a, b) => (a.nome < b.nome ? -1 : 1));

// KaTeX vai a parte (web/katex): o JS ja minificado, a folha e so as fontes
// woff2 (o WebView2 sempre aceita woff2; woff e ttf sairiam como peso morto).
const katexDist = path.join(DIR, 'node_modules', 'katex', 'dist');
const katexDest = path.join(RAIZ, 'web', 'katex');
fs.rmSync(katexDest, { recursive: true, force: true });
fs.mkdirSync(path.join(katexDest, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(katexDist, 'katex.min.js'), path.join(katexDest, 'katex.min.js'));
const folhaKatex = fs.readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8')
  .replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '');
fs.writeFileSync(path.join(katexDest, 'katex.min.css'), folhaKatex);
for (const f of fs.readdirSync(path.join(katexDist, 'fonts'))) {
  if (/\.woff2$/.test(f)) fs.copyFileSync(path.join(katexDist, 'fonts', f), path.join(katexDest, 'fonts', f));
}

const cabecalho = '/*! MarkPad: CodeMirror 6, Lezer e Turndown (licenca MIT), embutidos para o editor funcionar sem rede.\n' +
  ' * Gerado por tools/cm6/construir.js; versoes e licencas em THIRD-PARTY-NOTICES.md.\n' +
  ' * ' + pacotes.map((p) => p.nome + '@' + p.info.version).join(', ').replace(/(.{1,110})(, |$)/g, '$1$2\n * ').replace(/\n \* $/, '') + '\n */\n';
fs.writeFileSync(path.join(RAIZ, 'web', 'codemirror.js'), cabecalho + fs.readFileSync(saida, 'utf8'));

let avisos = '# Componentes de terceiros\n\n' +
  'O MarkPad embute no executavel as bibliotecas abaixo, todas sob a licenca MIT: em `web/codemirror.js`, o editor\n' +
  'de texto dos modos ao vivo e fonte e a conversao de HTML colado em Markdown; em `web/katex/`, a matematica\n' +
  '(KaTeX e as fontes dele). Gerado por `tools/cm6/construir.js`.\n\n' +
  '| Pacote | Versao | Licenca |\n|---|---|---|\n';
const textos = new Map();
for (const p of pacotes) {
  avisos += '| `' + p.nome + '` | ' + p.info.version + ' | ' + (p.info.license || '?') + ' |\n';
  const pasta = path.join(DIR, 'node_modules', p.nome);
  const arq = fs.readdirSync(pasta).find((f) => /^licen[cs]e/i.test(f));
  if (!arq) continue;
  const txt = fs.readFileSync(path.join(pasta, arq), 'utf8').replace(/\r\n/g, '\n').trim();
  if (!textos.has(txt)) textos.set(txt, []);
  textos.get(txt).push(p.nome);
}
avisos += '\n## Textos das licencas\n';
for (const [txt, nomes] of textos) {
  avisos += '\n### ' + nomes.join(', ') + '\n\n```\n' + txt + '\n```\n';
}
fs.writeFileSync(path.join(RAIZ, 'THIRD-PARTY-NOTICES.md'), avisos);

const tam = fs.statSync(path.join(RAIZ, 'web', 'codemirror.js')).size;
console.log('web/codemirror.js: ' + (tam / 1024).toFixed(0) + ' KB, ' + pacotes.length + ' pacotes');
