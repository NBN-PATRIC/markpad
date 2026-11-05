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
const semMapa = window.MarkPadMarkdown.render(SAMPLE, {});

// Bloco dentro de item de lista ja saiu com a regua trocada uma vez:
// item.line e local, baseLine e absoluto, e a soma contava duas vezes.
const ANINHADO = ['titulo', '', '- item', '', '  paragrafo do item', ''].join(String.fromCharCode(10));
const aninhado = window.MarkPadMarkdown.render(ANINHADO, { lineMap: true });

console.log('=== FRONTMATTER ===');
console.log(JSON.stringify(out.frontmatter));
console.log('\n=== SUMARIO ===');
out.toc.forEach(h => console.log(`  h${h.level} L${h.line} #${h.slug} — ${h.text}`));

console.log('\n=== VERIFICACOES ===');
const checks = [
  ['sem <script>', !/<script/i.test(out.html)],
  ['nenhum atributo on* vivo', !/<[^>]*\son[a-z]+\s*=/i.test(out.html)],
  // Bloco HTML agora aparece renderizado, mas pela peneira: sem on*, sem
  // script, e a imagem vai pelo mesmo caminho do ![](...).
  ['bloco html: img sem onerror', /<div class="html-block"[^>]*><img class="local-image" data-src="x" alt=""><\/div>/.test(out.html)],
  ['bloco html: div sem onclick', /<div class="html-block"[^>]*><div>bloco html<\/div><\/div>/.test(out.html)],
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
  ['segundo paragrafo inline', /<em>Outro<\/em> desses/.test(out.html)],
  ['tarefa com data-task-line', /class="task-item"[^>]*data-task-line="\d+"/.test(out.html)],
  ['tarefa marcada com data-task-line', /class="task-item is-checked" data-task="x" data-task-line="\d+"/.test(out.html)],
  ['data-task-line aponta a linha certa', conferaLinhasDeTarefa(SAMPLE, out.html)],
  ['data-task-line desliga sem lineMap', !/data-task-line/.test(semMapa.html)],
  ['bloco aninhado em lista usa a linha certa', /<p data-line="4"[^>]*>paragrafo do item/.test(aninhado.html)],

  // --- o que entrou depois da 1.2.0
  ['lista apertada nao deixa </p> orfao', !/<\/p>/.test(r('- a\n  - b\n').html)],
  ['lista apertada aninhada mantem o texto', /<li>a\s*<ul>/.test(r('- a\n  - b\n').html)],
  ['lista solta continua com <p>', /<li><p[^>]*>a<\/p>/.test(r('- a\n\n- b\n').html)],

  ['comentario %% some do texto', r('antes %%oculto%% depois\n').html === '<p>antes  depois</p>'],
  ['comentario %% em bloco some inteiro',
    !/segredo/.test(r('# t\n\n%%\nsegredo\n\nmais segredo\n%%\n\nfim\n').html)],
  ['comentario %% em bloco preserva o resto', /<p[^>]*>fim<\/p>/.test(r('%%\nx\n%%\n\nfim\n').html)],
  ['comentario %% nao vaza <p> vazio', !/<p[^>]*><\/p>/.test(r('%%so isso%%\n\nfim\n').html)],
  ['crase protege o %%', /<code>%%isto%%<\/code>/.test(r('`%%isto%%`\n').html)],

  ['nota inline ^[] vira referencia', /<sup class="footnote-ref">/.test(r('texto^[a nota]\n').html)],
  ['nota inline ^[] rende o corpo', /<li id="fn-mp-inline-1"[^>]*><p>a <strong>nota<\/strong>/
    .test(r('texto^[a **nota**]\n').html)],
  ['nota inline ^[] numera junto das outras',
    (r('a^[um] b^[dois]\n').html.match(/footnote-ref/g) || []).length === 2],

  ['tamanho no alt vira style', /style="width:300px"/.test(r('![alt|300](f.png)\n').html)],
  ['tamanho no alt sai do alt', /alt="alt"/.test(r('![alt|300](f.png)\n').html)],
  ['largura x altura no alt', /style="width:300px;height:200px"/.test(r('![a|300x200](f.png)\n').html)],
  ['barra que nao e medida fica no alt',
    /alt="foto \| do gato"/.test(r('![foto | do gato](f.png)\n').html)],
  ['embed ![[x|300]] continua funcionando', /style="width:300px"/.test(r('![[f.png|300]]\n').html)],

  // Como no Obsidian: todo estado que nao e espaco marca a caixa; so x/X
  // riscam o texto, e isso e do CSS.
  ['estado custom de tarefa marca a caixa', /class="task-item is-checked" data-task="&gt;"/.test(r('- [>] adiada\n').html)],
  ['estado custom desenha o caractere', /<input type="checkbox" disabled checked data-task="&gt;">/.test(r('- [>] adiada\n').html)],
  ['[x] marca sem desenho proprio', /<input type="checkbox" disabled checked>/.test(r('- [x] feita\n').html)],
  ['tarefa aberta leva data-task de espaco', /class="task-item" data-task=" "/.test(r('- [ ] aberta\n').html)],
  ['tarefa aberta desmarcada', !/checked/.test(r('- [ ] aberta\n').html)],
  ['[ ] colado ao fim nao e tarefa', !/task-item/.test(r('- [ ]\n').html)],
  ['link no comeco do item nao vira tarefa', /<a /.test(r('- [x](http://e.com) nao\n').html)],

  // --- backlog de baixo risco
  // Regra de tag do Obsidian (a mesma do painel, do indice e do C#): '#' no
  // comeco ou depois de espaco; qualquer escrita, digito, _ - / e emoji;
  // pontuacao encerra; so digitos nao vale.
  ['(#x) nao e tag', !/data-tag/.test(r('x (#outra) y\n').html)],
  ['[#x] nao e tag', !/data-tag/.test(r('x [#terceira] y\n').html)],
  ['a#x nao e tag', !/data-tag/.test(r('a#nada\n').html)],
  ['#1984 nao e tag', !/data-tag/.test(r('ano #1984\n').html)],
  ['#1984a e tag', /data-tag="1984a"/.test(r('ano #1984a\n').html)],
  ['#2026-q4 e tag', /data-tag="2026-q4"/.test(r('#2026-q4 no comeco\n').html)],
  ['tag com acento inteiro', /data-tag="revisão"/.test(r('em #revisão hoje\n').html)],
  ['tag em outra escrita', /data-tag="日本"/.test(r('x #日本 y\n').html)],
  ['tag com emoji', /data-tag="✅revisado"/.test(r('x #✅revisado\n').html)],
  ['pontuacao encerra a tag', /data-tag="fim"[^>]*>#fim<\/a>\./.test(r('ate o #fim.\n').html)],
  ['tag aninhada', /data-tag="pop\/manaus"/.test(r('#pop/manaus\n').html)],
  ['tag depois de quebra de linha', /data-tag="dois"/.test(r('um\n#dois\n').html)],

  // Callouts como no Obsidian.
  ['callout: tipo com hifen', /class="callout callout-note" data-callout="meu-tipo"/.test(r('> [!meu-tipo] T\n> corpo\n').html)],
  ['callout: espaco no tipo vira hifen', /data-callout="meu-tipo"/.test(r('> [!Meu Tipo]\n').html)],
  ['callout: metadado depois de |', /data-callout="note" data-callout-metadata="largo"/.test(r('> [!note|largo] T\n').html)],
  ['callout: titulo colado nao e callout', /<blockquote/.test(r('> [!note]Titulo\n').html)],
  ['callout: titulo padrao e o tipo', /callout-title-inner">Faq<\/span>/.test(r('> [!FAQ]\n> x\n').html)],
  ['callout: titulo padrao com hifen', /callout-title-inner">Meu tipo<\/span>/.test(r('> [!meu-tipo]\n').html)],
  ['callout: apelido guarda o nome escrito', /class="callout callout-abstract" data-callout="tldr"/.test(r('> [!tldr]\n').html)],
  ['callout: nome do prototipo nao quebra', /class="callout callout-note" data-callout="constructor"/.test(r('> [!constructor]\n').html)],
  ['callout: dobra marcada', /data-callout-fold="-"/.test(r('> [!tip]- X\n> y\n').html)],

  // Notas de rodape.
  ['nota: numero entre colchetes', /data-anchor="fn-1">\[1\]<\/a>/.test(r('a[^1]\n\n[^1]: n\n').html)],
  ['nota: rotulo sem maiusculas', /footnote-ref/.test(r('x[^B]\n\n[^b]: nota\n').html)],
  ['nota: segundo paragrafo pela indentacao', (function () {
    var h = r('x[^a]\n\n[^a]: um\n\n    dois\n\nfora\n').html;
    return /<li id="fn-a"[^>]*><p>um<\/p>\n<p>dois <a class="footnote-backref"/.test(h) && /<p>fora<\/p>/.test(h);
  })()],
  ['nota: lista dentro da nota', /<li id="fn-a"[^>]*><p>um<\/p>\n<ul>/.test(r('x[^a]\n\n[^a]: um\n\n    - item\n').html)],
  ['nota: citada duas vezes, ids proprios', (function () {
    var h = r('a[^1] b[^1]\n\n[^1]: n\n').html;
    return /id="fnref-1"/.test(h) && /id="fnref-1-1"/.test(h) && (h.match(/footnote-backref/g) || []).length === 2;
  })()],
  ['nota inline com colchetes dentro', (function () {
    var h = r('x^[veja [site](https://e.com) e mais] y\n').html;
    return (h.match(/footnote-ref/g) || []).length === 1 && /data-external="https:\/\/e\.com"/.test(h) && /<\/sup> y<\/p>/.test(h);
  })()],
  ['nota inline com ] em codigo', /<code>a]b<\/code>/.test(r('x^[o `a]b` dentro]\n').html)],
  ['^[ dentro de crase nao e nota', !/footnote-ref/.test(r('`^[x]` y\n').html)],
  ['definicao dentro de cerca nao e nota', !/footnote-ref/.test(r('```\n[^1]: nao\n```\nx[^1]\n').html)],
  ['rotulo do prototipo nao quebra', !/footnote-ref/.test(r('x[^constructor]\n').html)],

  // Bloco HTML renderizado pela peneira.
  ['html: details com markdown no miolo', /<div class="html-block"[^>]*><details><summary>Ver<\/summary><p[^>]*><strong>negrito<\/strong><\/p><\/details><\/div>/
    .test(r('<details><summary>Ver</summary>\n\n**negrito**\n\n</details>\n').html)],
  ['html: details fechado no mesmo bloco', /<details open><summary>a<\/summary>\nb\n<\/details>/.test(r('<details open><summary>a</summary>\nb\n</details>\n').html)],
  ['html: imagem remota continua barrada', (function () {
    var h = r('<img src="https://e.com/x.png">\n').html;
    return /data-remote="https:\/\/e\.com\/x\.png"/.test(h) && !/src="https/.test(h);
  })()],
  ['html: largura da imagem', /data-src="f\.png"[^>]*style="width:120px"/.test(r('<img src="f.png" width="120">\n').html)],
  ['html: video vira casulo', /data-media="video" data-file="clip\.mp4"/.test(r('<video controls>\n<source src="clip.mp4">\n</video>\n').html)],
  ['html: link externo pelo app', /<a class="external-link" data-external="https:\/\/e\.com"[^>]*>site<\/a>/.test(r('<p><a href="https://e.com">site</a></p>\n').html)],
  ['html: javascript: barrado', /<span class="blocked-link"[^>]*>x<\/span>/.test(r('<div><a href="javascript:alert(1)">x</a></div>\n').html)],
  ['html: style some com o conteudo', !/display/.test(r('<style>body{display:none}</style>\n').html)],
  ['html: script some com o conteudo', !/alert/.test(r('<div>\n<script>alert(1)</script>\n</div>\n').html)],
  ['html: tag desconhecida some, texto fica', (function () {
    var h = r('<center>meio</center>\n').html;
    return /meio/.test(h) && !/<center/.test(h);
  })()],
  ['html: align passa', /<div align="center">x<\/div>/.test(r('<div align="center">x</div>\n').html)],
  ['html: atributo qualquer some', !/data-x|onmouseover/.test(r('<div data-x="1" onmouseover="y()">x</div>\n').html)],
  ['html: texto com < solto escapado', /a &lt; b/.test(r('<div>a < b</div>\n').html)],
  ['comentario html em bloco some', (function () {
    var h = r('<!-- oculto\nainda oculto -->\n\nfim\n').html;
    return !/oculto/.test(h) && /<p[^>]*>fim<\/p>/.test(h);
  })()],
  ['comentario html no meio do texto some', !/escondido/.test(r('a <!-- escondido --> c\n').html)],
  ['comentario html em crase aparece', /<code>&lt;!-- x --&gt;<\/code>/.test(r('`<!-- x -->`\n').html)],

  // O rotulo do wikilink mostra o caminho inteiro, como no Obsidian.
  ['wikilink com secao mostra a secao', />Nota &gt; Secao</.test(r('[[Nota#Secao]]\n').html)],
  ['wikilink so de secao perde o #', />Secao</.test(r('[[#Secao]]\n').html)],
  ['wikilink so de secao mantem o alvo', /data-wikilink="#Secao"/.test(r('[[#Secao]]\n').html)],
  ['wikilink de bloco mostra o ^id', />\^abc</.test(r('[[#^abc]]\n').html)],
  ['apelido ainda ganha do caminho', />apelido</.test(r('[[Nota#Secao|apelido]]\n').html)],

  // Marcador de bloco do Obsidian: 'texto ^id' vira o id do elemento e some
  // da tela — e endereco, nao conteudo. No meio da linha continua literal.
  ['marcador ^id vira id do paragrafo', /<p id="abc"[^>]*>um paragrafo<\/p>/.test(r('um paragrafo ^abc\n').html)],
  ['marcador ^id some do texto', !/\^abc/.test(r('um paragrafo ^abc\n').html)],
  ['marcador ^id vira id do item de lista', /<li id="meta"[^>]*>item<\/li>/.test(r('- item ^meta\n').html)],
  ['^id no meio da linha continua literal', /\^abc/.test(r('um ^abc no meio\n').html)],
  ['paragrafo de varias linhas leva o id', /<p id="fim"[^>]*>/.test(r('linha um\nlinha dois ^fim\n').html)],
  // O marcador e do paragrafo do PROPRIO item: com sublista embaixo ele nao
  // pode sumir nem escorregar para o pai/filho errado.
  ['item com sublista mantem o proprio ^id', /<li id="alvo"[^>]*>/.test(r('- primeiro ^alvo\n    - filho\n').html)],
  ['item com sublista nao mostra o marcador', !/\^alvo/.test(r('- primeiro ^alvo\n    - filho\n').html)],
  ['^id no filho pertence ao filho', /<li id="ref"[^>]*>filho<\/li>/.test(r('- pai\n    - filho ^ref\n').html)],
  ['^id em titulo some do texto e do slug', (function () {
    var h = r('# Titulo ^abc\n').html;
    return /<h1 id="titulo"[^>]*>Titulo<\/h1>/.test(h) && !/\^abc/.test(h);
  })()],
  // Linha sozinha '^id' enderece o bloco ANTERIOR — e o unico jeito de dar
  // ancora a tabela e bloco de codigo, como no Obsidian.
  ['linha isolada ^id marca o bloco anterior', /<p id="tab"[^>]*>um paragrafo<\/p>/.test(r('um paragrafo\n\n^tab\n').html)],
  ['linha isolada ^id some da tela', !/\^tab/.test(r('um paragrafo\n\n^tab\n').html)],
  ['linha isolada ^id marca tabela', /<div id="dados" class="table-wrap"/.test(r('| a | b |\n|---|---|\n| 1 | 2 |\n\n^dados\n').html)],
  ['linha isolada ^id nao rouba id de titulo', /<h1 id="titulo"/.test(r('# Titulo\n\n^outro\n').html)],

  // ![[Nota]] deixa um casulo de transclusao: o app troca o miolo pelo
  // conteudo; fora dele o link de dentro segue abrindo a nota.
  ['embed de nota vira casulo', /<span class="note-embed" data-embed="Nota">/.test(r('![[Nota]]\n').html)],
  ['casulo guarda a secao junto', /data-embed="Nota#Secao"/.test(r('![[Nota#Secao]]\n').html)],
  ['casulo ainda tem o link de dentro', /note-embed[^>]*><a class="internal-link embed-link" data-wikilink="Nota"/.test(r('![[Nota]]\n').html)],
  ['embed de imagem continua imagem', /<img class="local-image" data-src="foto.png"/.test(r('![[foto.png|300]]\n').html)],
  ['apelido de embed vai no data-alias', /data-alias="Meu titulo"/.test(r('![[Nota|Meu titulo]]\n').html)],
  ['apelido de embed vira o rotulo do link', />Meu titulo</.test(r('![[Nota|Meu titulo]]\n').html)],

  // Passada inline reordenada (04/11/2026): links, imagens e wikilinks sao
  // reconhecidos no texto cru, antes do escape geral. Antes o escape vinha
  // primeiro, e cada um destes casos saia errado.
  ['link com titulo entre aspas', /data-external="https:\/\/x\.com" href="#" title="T"/.test(r('[t](https://x.com "T")\n').html)],
  ['link com titulo entre apostrofos', /title="T"/.test(r("[t](https://x.com 'T')\n").html)],
  ['link com titulo entre parenteses', /title="T"/.test(r('[t](https://x.com (T))\n').html)],
  ['imagem com titulo', /<img class="local-image" data-src="a\.png" alt="i" title="T">/.test(r('![i](a.png "T")\n').html)],
  ['destino com espaco entre < >', /data-file="minha nota\.md"/.test(r('[nota](<minha nota.md>)\n').html)],
  ['& na URL do link escapa uma vez so', /data-external="https:\/\/x\.com\/\?a=1&amp;b=2"/.test(r('[x](https://x.com/?a=1&b=2)\n').html)],
  ['& na URL solta escapa uma vez so', /data-external="https:\/\/x\.com\/\?a=1&amp;b=2"/.test(r('veja https://x.com/?a=1&b=2 aqui\n').html)],
  ['& no nome da nota do wikilink', /data-wikilink="A &amp; B"/.test(r('[[A & B]]\n').html)],
  ['wikilink com \\| em tabela usa o apelido', /data-wikilink="Nota" href="#">apelido</.test(r('| a | b |\n|---|---|\n| [[Nota\\|apelido]] | x |\n').html)],
  ['\\%% nao abre comentario', />%%visivel%%</.test(r('\\%%visivel\\%%\n').html)],
  ['entidade com nome', /&copy;/.test(r('a &copy; b\n').html) && !/&amp;copy;/.test(r('a &copy; b\n').html)],
  ['entidade numerica', /&#169;/.test(r('a &#169; b\n').html)],
  ['& solto continua escapado', /a &amp; b/.test(r('a & b\n').html)],
  ['escape de qualquer pontuacao some a barra', />\^ : &lt;b&gt;</.test(r('\\^ \\: \\<b>\n').html)],
  ['autolink no inicio da linha nao e bloco HTML', /<p[^>]*><a class="external-link" data-external="https:\/\/x\.com"/.test(r('<https://x.com>\n').html)],
  ['javascript: com titulo continua bloqueado', /blocked-link/.test(r('[x](javascript:alert(1) "t")\n').html) && !/javascript:/.test(r('[x](javascript:alert(1) "t")\n').html)],
  ['javascript: entre < > continua bloqueado', !/javascript:/.test(r('[x](<javascript:alert(1)>)\n').html)],
  ['tag com onerror no meio do texto continua inerte', !/<[^>]*\sonerror\s*=/i.test(r('oi <img src=x onerror=alert(1)> tchau\n').html)],
  ['% solto no caminho da imagem nao derruba o render', (() => { try { return /data-src="100% certo\.png"/.test(r('![x](<100% certo.png>)\n').html) && /data-src="100%\.png"/.test(r('![x](100%.png)\n').html); } catch (e) { return false; } })()],
  ['% codificado continua decodificado', /data-file="minha nota\.md"/.test(r('[n](minha%20nota.md)\n').html)],
  ['URL com parenteses (Wikipedia)', /data-external="https:\/\/pt\.wikipedia\.org\/wiki\/Fulano_\(cantor\)"/.test(r('[f](https://pt.wikipedia.org/wiki/Fulano_(cantor))\n').html)],
  ['imagem dentro de link', /<a class="external-link"[^>]*><img class="local-image" data-src="i\.png"/.test(r('[![x](i.png)](https://x.com)\n').html)],
  ['& no rotulo do link aparece uma vez', />a &amp; b<\/a>/.test(r('[a & b](https://x.com)\n').html)],
  // audio, video e PDF: casulo que o app troca pelo player
  ['![[x.mp4]] vira casulo de video', /<span class="media-embed" data-media="video" data-embed="aula\.mp4">aula\.mp4<\/span>/.test(r('![[aula.mp4]]\n').html)],
  ['![[x.mp3]] vira casulo de audio', /data-media="audio" data-embed="som\.mp3"/.test(r('![[som.mp3]]\n').html)],
  ['![[x.pdf#page=3]] guarda a pagina', /data-media="pdf" data-embed="a\.pdf#page=3"/.test(r('![[a.pdf#page=3]]\n').html)],
  ['![](clip.webm) tambem', /data-media="video" data-file="midia\/clip\.webm"/.test(r('![c](midia/clip.webm)\n').html)],
  ['tamanho no video', /data-media="video"[^>]*style="width:400px"/.test(r('![[v.mp4|400]]\n').html)],
  ['video remoto continua bloqueado', !/media-embed/.test(r('![v](https://x.com/v.mp4)\n').html)]
];

/** Render curto para os casos acima — sem mapa de linha, so o HTML. */
function r(src) { return sandbox.MarkPadMarkdown.render(src); }

// A linha apontada tem de ser mesmo a linha da tarefa no texto original —
// incluindo o deslocamento do bloco --- do topo, que nao vira HTML.
function conferaLinhasDeTarefa(src, html) {
  const linhas = src.split(String.fromCharCode(10));
  const re = /data-task-line="(\d+)"/g;
  let m, achou = 0;
  while ((m = re.exec(html))) {
    achou++;
    const linha = linhas[Number(m[1])];
    if (linha === undefined) return false;
    if (!/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/.test(linha)) return false;
  }
  return achou >= 2;
}

let fails = 0;
// Matematica: o TeX chega cru ao KaTeX (o escape do Markdown comia a barra:
// \, virava virgula) e \$ escapado nao abre formula.
checks.push(['matematica inline guarda a barra do TeX', /<code class="math">\\frac\{a\}\{b\}\\,x<\/code>/.test(r('vale $\\frac{a}{b}\\,x$ aqui').html)]);
checks.push(['bloco $$ guarda a barra do TeX', /<code class="math math-block">\\int x\\,dx<\/code>/.test(r('$$\\int x\\,dx$$').html)]);
checks.push(['\\$ escapado nao abre formula', !/class="math/.test(r('custa \\$5 e \\$10').html)]);
checks.push(['$5 e $10 nao e formula', !/class="math/.test(r('custa $5 e $10').html)]);

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
