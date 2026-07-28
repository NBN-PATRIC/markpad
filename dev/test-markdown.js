// Testes do parser de markdown, sem navegador.
//   node dev/test-markdown.js            -> roda as verificacoes
//   node dev/test-markdown.js --dump x.html  -> grava o HTML gerado
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['highlight.js', 'markdown.js']) {
  vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), sandbox, { filename: f });
}

const SAMPLE = `---
title: Documento de teste
tags:
  - alfa
  - beta
---

# Titulo 1

Paragrafo com **negrito**, *italico*, ***os dois***, ~~riscado~~, ==destaque==,
\`codigo\` e um [link](https://exemplo.com "titulo").

Setext H2
---------

## Listas

- item um
- item dois
  - aninhado a
  - aninhado b
    1. numerado
    2. outro
- [ ] tarefa aberta
- [x] tarefa feita

1. primeiro
2. segundo
   continuacao do segundo

## Citacao e callout

> uma citacao simples
> em duas linhas

> [!warning] Cuidado
> Corpo do callout com **negrito**.

> [!tip]- Dobravel
> Escondido por padrao.

## Tabela

| Coluna A | Coluna B | Numero |
|:---------|:--------:|-------:|
| um       | dois     |     42 |
| \`code\`   | [l](https://x.com) |  3.14 |

## Codigo

\`\`\`javascript
// comentario
function ola(nome) {
  const msg = \`oi \${nome}\`;
  return console.log(msg, 42);
}
\`\`\`

\`\`\`python
def f(x):
    return [i for i in range(x) if i % 2 == 0]  # par
\`\`\`

## Obsidian

Wikilink [[Outra Nota]] e com apelido [[Outra Nota|apelido]].
Imagem embutida ![[foto.png|300]].
Tag #projeto/ativo aqui.

Nota de rodape aqui[^1].

[^1]: Texto da nota de rodape.

---

## Seguranca

<script>alert('xss')</script>

<img src=x onerror="alert(1)">

[clique](javascript:alert(1))

<div onclick="alert(1)">bloco html</div>

Texto com <b>negrito html</b> e <em>enfase</em>.

<b>Paragrafo</b> que comeca com tag inline.

<em>Outro</em> desses.
`;

const window = sandbox;
const out = window.MarkPadMarkdown.render(SAMPLE, { lineMap: true });

console.log('=== FRONTMATTER ===');
console.log(JSON.stringify(out.frontmatter));
console.log('\n=== SUMARIO ===');
out.toc.forEach(h => console.log(`  h${h.level} L${h.line} #${h.slug} — ${h.text}`));

console.log('\n=== VERIFICACOES ===');
const checks = [
  ['sem <script>', !/<script/i.test(out.html)],
  ['nenhum atributo on* vivo', !/<[^>]*\son[a-z]+\s*=/i.test(out.html)],
  ['html perigoso virou texto', /<pre class="raw-html"[^>]*><code>&lt;img src=x onerror/.test(out.html)],
  ['link javascript: bloqueado', /<span class="blocked-link"[^>]*>clique<\/span>/.test(out.html)],
  ['sem href=javascript', !/javascript:/i.test(out.html)],
  ['negrito', /<strong>negrito<\/strong>/.test(out.html)],
  ['italico', /<em>italico<\/em>/.test(out.html)],
  ['riscado', /<del>riscado<\/del>/.test(out.html)],
  ['destaque', /<mark>destaque<\/mark>/.test(out.html)],
  ['tarefa aberta', /type="checkbox" disabled>/.test(out.html)],
  ['tarefa feita', /checked/.test(out.html)],
  ['lista aninhada', /<ul[^>]*>[\s\S]*<ul/.test(out.html)],
  ['lista ordenada aninhada', /<ol/.test(out.html)],
  ['tabela com alinhamento', /text-align:right/.test(out.html)],
  ['callout warning', /callout-warning/.test(out.html)],
  ['callout dobravel', /<details class="callout callout-tip"/.test(out.html)],
  ['citacao', /<blockquote/.test(out.html)],
  ['codigo js realcado', /tok-kw/.test(out.html)],
  ['codigo py realcado', /language-python/.test(out.html)],
  ['wikilink', /data-wikilink="Outra Nota"/.test(out.html)],
  ['wikilink apelido', />apelido</.test(out.html)],
  ['imagem embutida', /data-src="foto\.png"/.test(out.html)],
  ['tag obsidian', /data-tag="projeto\/ativo"/.test(out.html)],
  ['nota de rodape ref', /footnote-ref/.test(out.html)],
  ['nota de rodape corpo', /id="fn-1"/.test(out.html)],
  ['html inline permitido', /<b>negrito html<\/b>/.test(out.html)],
  ['setext h2', out.toc.some(h => h.level === 2 && /Setext/.test(h.text))],
  ['link externo', /data-external="https:\/\/exemplo\.com"/.test(out.html)],
  ['hr', /<hr/.test(out.html)],
  ['data-line presente', /data-line="/.test(out.html)],
  ['paragrafo iniciado por tag inline', /<b>Paragrafo<\/b> que comeca com tag inline/.test(out.html)],
  ['segundo paragrafo inline', /<em>Outro<\/em> desses/.test(out.html)]
];

let fails = 0;
for (const [name, ok] of checks) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${name}`);
}

console.log(`\n${checks.length - fails}/${checks.length} passaram`);

if (process.argv[2] === '--dump') {
  fs.writeFileSync(process.argv[3] || 'out.html', out.html);
  console.log('html gravado');
}
process.exit(fails ? 1 : 0);
