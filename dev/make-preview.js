// Gera dev/preview.html a partir de web/index.html.
//   node dev/make-preview.js
//
// A pagina de desenvolvimento era mantida a mao e vivia atrasada em relacao
// ao index de verdade: elemento novo no app, boot quebrado no navegador. Aqui
// ela vira copia derivada — o unico jeito de nunca mais divergir.
//
// O que muda em relacao ao original:
//   - a CSP sai (o stub da ponte e um script a mais, e nada disso vai pro app)
//   - os caminhos passam a apontar para ../web/
//   - stub-bridge.js entra antes de todo o resto
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const origem = path.join(ROOT, 'web', 'index.html');
const destino = path.join(__dirname, 'preview.html');

let html = fs.readFileSync(origem, 'utf8');

html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[\s\S]*?>\n/,
  '\n  <!-- sem CSP: pagina de desenvolvimento, gerada por dev/make-preview.js -->\n');

html = html.replace('<title>MarkPad</title>',
  '<title>MarkPad — preview de desenvolvimento</title>');

html = html.replace('href="style.css"', 'href="../web/style.css"');
html = html.replace(/<script src="(?!\.\.\/)([^"]+)"><\/script>/g,
  '<script src="../web/$1"></script>');

html = html.replace(/(\n<script src="\.\.\/web\/)/,
  '\n<script src="stub-bridge.js"></script>$1');

const aviso = '<!-- GERADO por dev/make-preview.js a partir de web/index.html. Nao edite a mao. -->\n';
html = html.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + aviso);

fs.writeFileSync(destino, html.replace(/\r\n/g, '\n'), 'utf8');
console.log('dev/preview.html gerado a partir de web/index.html');
