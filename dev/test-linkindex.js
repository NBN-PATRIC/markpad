// Testes do indice de links (web/linkindex.js), sem navegador.
//   node dev/test-linkindex.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'linkindex.js'), 'utf8'), sandbox);
const L = sandbox.MarkPadLinkIndex;

let ok = 0, falhas = 0;
function igual(nome, obtido, esperado) {
  const a = JSON.stringify(obtido), b = JSON.stringify(esperado);
  if (a === b) { ok++; return; }
  falhas++;
  console.log('FALHOU: ' + nome + '\n   esperado: ' + b + '\n   obtido:   ' + a);
}

// Uma pasta de mentira: rel -> texto (null = arquivo que nao e nota)
function pasta(mapa) {
  return L.cria(Object.keys(mapa).map(function (rel) {
    const md = L.ehNota(rel);
    return {
      path: 'C:\\raiz\\' + rel.replace(/\//g, '\\'),
      rel: rel, name: rel.split('/').pop(), md: md,
      analise: md ? L.analisa(mapa[rel] || '') : null
    };
  }));
}
const rels = (lista) => lista.map((a) => a && a.rel);

// ------------------------------------------------------------- analise
let a = L.analisa('# Titulo\n\nVer [[Nota A]] e [[pasta/Nota B#Secao|apelido]] e ![[img.png]].\n' +
  'Link [texto](outra%20nota.md#parte "titulo") e [site](https://x.com) e [ancora](#so-aqui).\n' +
  '`[[nao e link]]` mas [[sim]]\n```\n[[dentro da cerca]]\n```\n| a | [[Tab\\|ap]] |\n#tag1 e #tag2/sub e #tag1');
igual('alvos', a.links.map((l) => l.alvo), ['Nota A', 'pasta/Nota B', 'img.png', 'outra nota.md', 'sim', 'Tab']);
igual('tipos', a.links.map((l) => l.tipo + (l.embed ? '!' : '')), ['wiki', 'wiki', 'wiki!', 'md', 'wiki', 'wiki']);
igual('secao do wikilink', a.links[1].secao, 'Secao');
igual('secao do link md, decodificada', a.links[3].secao, 'parte');
igual('linhas', a.links.map((l) => l.linha), [3, 3, 3, 4, 5, 9]);
igual('titulos', a.titulos.map((t) => t.nivel + ':' + t.texto), ['1:Titulo']);
igual('tags sem repetir', a.tags, ['tag1', 'tag2/sub']);

a = L.analisa('---\ntitle: x\naliases: [Apelido Um, "Outro"]\ntags:\n  - proj\n  - "#doc"\nrelacionado: "[[Nota Front]]"\n---\ncorpo');
igual('apelidos do frontmatter', a.apelidos, ['Apelido Um', 'Outro']);
igual('tags do frontmatter', a.tags, ['proj', 'doc']);
igual('wikilink no frontmatter', a.links.map((l) => l.alvo), ['Nota Front']);

a = L.analisa('[![capa](img/capa.png)](notas/destino.md)');
igual('imagem dentro de link', a.links.map((l) => l.alvo).sort(), ['img/capa.png', 'notas/destino.md']);

a = L.analisa('``codigo com [[x]] e ` solta`` depois [[y]]');
igual('crase dupla com crase simples dentro', a.links.map((l) => l.alvo), ['y']);

a = L.analisa('[a](<pasta com espaco/nota.md>) [b](C:/abs/n.md) [c](mailto:x@y.z)');
igual('destino <...> e caminho do Windows; mailto fora', a.links.map((l) => l.alvo), ['pasta com espaco/nota.md', 'C:/abs/n.md']);

a = L.analisa('texto\n\n    [[codigo indentado]]\n\n- item\n    [[continua lista]]');
igual('bloco indentado nao e link; continuacao de lista e', a.links.map((l) => l.alvo), ['continua lista']);

a = L.analisa('~~~\n```\n[[ainda codigo]]\n~~~\n[[fora]]');
igual('cerca so fecha com o mesmo marcador', a.links.map((l) => l.alvo), ['fora']);

// ------------------------------------------------------------ resolver
const p = pasta({
  'Inicio.md': 'Ver [[Nota A]], [[sub/Nota A]], [[Profunda]], [[Inexistente]], [[img.png]] e [rel](sub/Nota%20A.md) e [[#Topo]]',
  'Nota A.md': '# Topo\nvolta para [[Inicio]]',
  'sub/Nota A.md': 'Irma: [[Nota A]] e [cima](../Inicio.md)',
  'sub/fundo/Profunda.md': '[[Inicio|casa]]',
  'img.png': null,
  'v1.2.md': '[[v1.2]]'
});
const ini = p.porRel['inicio.md'];
igual('saidas resolvidas do Inicio', rels(ini.saidas.map((s) => s.para)),
  ['Nota A.md', 'sub/Nota A.md', 'sub/fundo/Profunda.md', undefined, 'img.png', 'sub/Nota A.md', 'Inicio.md']);
igual('mesma pasta ganha do mais raso', p.porRel['sub/nota a.md'].saidas[0].para.rel, 'sub/Nota A.md');
igual('link md relativo com ..', p.porRel['sub/nota a.md'].saidas[1].para.rel, 'Inicio.md');
igual('nome com ponto continua nota', p.porRel['v1.2.md'].saidas[0].para.rel, 'v1.2.md');
igual('quebrados', p.quebrados.map((q) => q.link.alvo), ['Inexistente']);

// ----------------------------------------------------------- backlinks
igual('backlinks do Inicio', L.backlinks(p, 'C:\\raiz\\Inicio.md').map((b) => b.rel),
  ['Nota A.md', 'sub/fundo/Profunda.md', 'sub/Nota A.md']);
igual('backlinks: dois links na mesma linha contam uma', L.backlinks(p, 'sub/Nota A.md').map((b) => b.rel + ':' + b.hits.length),
  ['Inicio.md:1']);
igual('[[#Topo]] nao e backlink de si mesma', L.backlinks(p, 'Inicio.md').some((b) => b.rel === 'Inicio.md'), false);
igual('trecho do backlink e a linha', L.backlinks(p, 'Nota A.md')[0].hits[0].text.slice(0, 16), 'Ver [[Nota A]], ');

// -------------------------------------------------------------- saidas
const s = L.saidas(p, '[[Nota A]] [[Nota A#Topo]] [[Nada]]\n[x](Nota%20A.md)', 'Inicio.md');
igual('saidas agrupam por destino', s.map((x) => (x.para ? x.para.rel : '?' + x.alvo) + '@' + x.linhas.join(',')),
  ['Nota A.md@1,2', '?Nada@1']);

// ---------------------------------------------------- mencao sem link
igual('mencao solta', L.mencionaSemLink('Falei da Nota A ontem', 'Nota A'), true);
igual('mencao dentro de link nao conta', L.mencionaSemLink('Ver [[Nota A]] e [x](<Nota A.md>)', 'Nota A'), false);
igual('palavra maior nao conta', L.mencionaSemLink('Reação', 'Ação'), false);
igual('acento e caixa', L.mencionaSemLink('a ação começou', 'Ação'), true);
igual('dentro de crase nao conta', L.mencionaSemLink('`Nota A`', 'Nota A'), false);
igual('tag nao e mencao', L.mencionaSemLink('alem de #projeto/api e #api', 'api'), false);
igual('pedaco de caminho nao e mencao', L.mencionaSemLink('tags: [projeto/api]', 'api'), false);
igual('fim de frase e mencao', L.mencionaSemLink('Falta documentar a api.', 'api'), true);

// ----------------------------------------------------------- reescrever
let r = L.reescreve(p, 'Ver [[Nota A]], [[Nota A#Topo|t]] e [rel](Nota%20A.md#Topo) e [[sub/Nota A]]',
  { origem: 'Inicio.md', de: 'Nota A.md', para: 'Nota Nova.md' });
igual('renomear: wikilink, secao, apelido e link md', r.texto,
  'Ver [[Nota Nova]], [[Nota Nova#Topo|t]] e [rel](Nota%20Nova.md#Topo) e [[sub/Nota A]]');
igual('renomear: contagem', r.trocas, 3);

r = L.reescreve(p, 'Ver [[Nota A]] e [[Profunda]]', { origem: 'Inicio.md', de: 'Nota A.md', para: 'outra/Nota A.md' });
igual('nome novo ambiguo vira caminho', r.texto, 'Ver [[outra/Nota A]] e [[Profunda]]');
r = L.reescreve(p, 'Ver [[Profunda]]', { origem: 'Inicio.md', de: 'sub/fundo/Profunda.md', para: 'Profunda.md' });
igual('mover sem homonimo: so o nome continua', r.texto, 'Ver [[Profunda]]');
igual('mover sem homonimo: nada a trocar', r.trocas, 0);

r = L.reescreve(p, '[[Inicio]] e [img](<../img.png>)', { origem: 'sub/Nota A.md', de: 'img.png', para: 'midia/img.png' });
igual('anexo movido, link <...> continua <...>', r.texto, '[[Inicio]] e [img](<../midia/img.png>)');

r = L.reescreve(p, 'Irma: [[Nota A]] e [cima](../Inicio.md)', { origem: 'sub/Nota A.md', origemNova: 'sub/fundo/Nota A.md' });
igual('a propria nota movida: links relativos acompanham', r.texto, 'Irma: [[Nota A]] e [cima](../../Inicio.md)');

r = L.reescreve(p, '`[[Nota A]]` e\n```\n[[Nota A]]\n```\n[[Nota A]]', { origem: 'Inicio.md', de: 'Nota A.md', para: 'B.md' });
igual('codigo fica intocado', r.texto, '`[[Nota A]]` e\n```\n[[Nota A]]\n```\n[[B]]');

r = L.reescreve(p, '| x | [[Nota A\\|apelido]] |', { origem: 'Inicio.md', de: 'Nota A.md', para: 'B.md' });
igual('wikilink com barra escapada em tabela', r.texto, '| x | [[B\\|apelido]] |');

r = L.reescreve(p, '[a](Nota%20A.md)', { origem: 'Inicio.md', de: 'Nota A.md', para: 'pasta (2)/Nota A.md' });
igual('parenteses no caminho novo sao codificados', r.texto, '[a](pasta%20%282%29/Nota%20A.md)');

igual('relativo de pasta a arquivo', L.relativo('a/b', 'a/c/d.md'), '../c/d.md');
igual('relativo da raiz', L.relativo('', 'x/y.md'), 'x/y.md');

// ---------------------------------------------------- operadores de busca
let c = L.analisaConsulta('tag:proj -path:arquivo reuniao de equipe');
igual('operadores saem do texto', c.texto, 'reuniao de equipe');
igual('operadores', c.filtros.map((f) => (f.nao ? '-' : '') + f.op + '=' + f.valor), ['tag=proj', '-path=arquivo']);
c = L.analisaConsulta('path:"minha pasta" "frase exata"');
igual('valor com aspas', c.filtros[0].valor, 'minha pasta');
igual('frase entre aspas perde as aspas', c.texto, 'frase exata');
c = L.analisaConsulta('tag:');
igual('operador sem valor fica no texto', [c.texto, c.filtros.length], ['tag:', 0]);
c = L.analisaConsulta('http://x.com/file:y');
igual('file: no meio de palavra nao e operador', c.filtros.length, 0);

const q = pasta({
  'a/proj.md': '#proj/api texto',
  'a/outro.md': '---\ntags: [projeto]\n---\n',
  'arquivo/velho.md': '#proj',
  'img.png': null
});
igual('tag pega subtag, mas nao prefixo solto', rels(L.filtra(q, L.analisaConsulta('tag:#proj').filtros)), ['a/proj.md', 'arquivo/velho.md']);
igual('-path exclui', rels(L.filtra(q, L.analisaConsulta('tag:proj -path:arquivo').filtros)), ['a/proj.md']);
igual('file: pelo nome', rels(L.filtra(q, L.analisaConsulta('file:png').filtros)), ['img.png']);

console.log(ok + ' ok, ' + falhas + ' falhas');
process.exit(falhas ? 1 : 0);
