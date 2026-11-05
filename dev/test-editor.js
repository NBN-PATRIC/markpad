// Testes do editor (web/editor.js) sem navegador: a gramatica do dialeto do
// Obsidian e os comandos de formatacao e de lista, sobre o CodeMirror
// embutido (web/codemirror.js).
//   node dev/test-editor.js
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
global.window = global;
(0, eval)(fs.readFileSync(path.join(WEB, 'codemirror.js'), 'utf8') + ';global.CM=CM;');
(0, eval)(fs.readFileSync(path.join(WEB, 'editor.js'), 'utf8'));

const E = global.MarkPadEditor._interno;
const { EditorState, EditorSelection } = CM.state;

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log('  ok   ' + nome); }
  catch (e) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + e.message); }
}
function igual(a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('esperava ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));
}

function nos(doc) {
  const st = EditorState.create({ doc, extensions: [E.linguagemMarkdown()] });
  const tree = CM.language.ensureSyntaxTree(st, st.doc.length, 5000);
  const out = [];
  tree.iterate({ enter(n) { if (!/^(Document|Paragraph)$/.test(n.name)) out.push(n.name + ':' + doc.slice(n.from, n.to)); } });
  return out;
}
function tem(doc, nome, texto) {
  return nos(doc).indexOf(nome + ':' + texto) >= 0;
}

// Um "editor" minimo: estado + dispatch, o bastante para os comandos.
function editor(doc, ancora, cabeca) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(ancora, cabeca == null ? ancora : cabeca),
    // o mesmo recuo do editor de verdade (quatro espacos)
    extensions: [E.linguagemMarkdown(), CM.language.indentUnit.of('    ')]
  });
  const v = {
    get state() { return state; },
    dispatch(tr) { state = tr.state ? tr : state.update(tr); state = state.state || state; }
  };
  return v;
}
function sel(v) { const r = v.state.selection.main; return [r.from, r.to]; }

console.log('dialeto');
teste('wikilink, apelido e embed', () => {
  igual(tem('[[Nota]]', 'WikiLink', '[[Nota]]'), true);
  igual(tem('[[Nota#Sec|apelido]]', 'WikiApelido', 'apelido'), true);
  igual(tem('[[Nota#Sec|apelido]]', 'WikiAlvo', 'Nota#Sec'), true);
  igual(tem('![[img.png]]', 'Embed', '![[img.png]]'), true);
});
teste('wikilink em tabela com barra escapada', () => {
  const doc = '| a | b |\n|---|---|\n| [[x\\|y]] | 2 |';
  igual(tem(doc, 'WikiBarra', '\\|'), true);
  igual(tem(doc, 'WikiApelido', 'y'), true);
});
teste('==destaque==', () => {
  igual(tem('a ==isto== b', 'Destaque', '==isto=='), true);
  igual(tem('a == nao == b', 'Destaque', '== nao =='), false);
});
teste('%%comentario%% em linha e em bloco', () => {
  igual(tem('a %%some%% b', 'Comentario', '%%some%%'), true);
  igual(tem('%%\nbloco\n%%\ndepois', 'ComentarioBloco', '%%\nbloco\n%%'), true);
});
teste('tags: as mesmas regras do leitor', () => {
  igual(tem('#tag e mais', 'Hashtag', '#tag'), true);
  igual(tem('#ok/sub', 'Hashtag', '#ok/sub'), true);
  igual(nos('#123 e a#b').some((n) => n.indexOf('Hashtag') === 0), false);
  igual(nos('# Titulo').some((n) => n.indexOf('Hashtag') === 0), false);
});
teste('^bloco so no fim da linha', () => {
  igual(tem('texto ^bloco-1', 'BlockId', '^bloco-1'), true);
  igual(nos('a ^b c').some((n) => n.indexOf('BlockId') === 0), false);
});
teste('notas de rodape', () => {
  igual(tem('ref[^1] fim', 'RodapeRef', '[^1]'), true);
  igual(tem('ref ^[inline [x]] fim', 'RodapeInline', '^[inline [x]]'), true);
});
teste('matematica: $x$ sim, $5 e $10 nao', () => {
  igual(tem('vale $x^2$ aqui', 'MathInline', '$x^2$'), true);
  igual(nos('custa $5 e $10').some((n) => n.indexOf('MathInline') === 0), false);
  igual(tem('$$\nE=mc^2\n$$\nfim', 'MathBloco', '$$\nE=mc^2\n$$'), true);
});
teste('propriedades so com o --- de fechamento', () => {
  igual(tem('---\ntitle: x\n---\n# Oi', 'Frontmatter', '---\ntitle: x\n---'), true);
  igual(tem('---\nsem fim\n# Oi', 'HorizontalRule', '---'), true);
  igual(nos('---\nsem fim\n# Oi').some((n) => n.indexOf('Frontmatter') === 0), false);
});
teste('callout continua citacao (o desenho e decoracao)', () => {
  igual(tem('> [!note] T\n> corpo', 'Blockquote', '> [!note] T\n> corpo'), true);
});

console.log('formatacao');
teste('Ctrl+B sem selecao pega a palavra', () => {
  const v = editor('ola mundo', 6);
  E.alternaMarca('**')(v);
  igual(v.state.doc.toString(), 'ola **mundo**');
});
teste('Ctrl+B de novo tira', () => {
  const v = editor('ola **mundo**', 8);
  E.alternaMarca('**')(v);
  igual(v.state.doc.toString(), 'ola mundo');
});
teste('espaco da ponta da selecao fica de fora', () => {
  const v = editor('ola mundo fim', 4, 10);
  E.alternaMarca('**')(v);
  igual(v.state.doc.toString(), 'ola **mundo** fim');
});
teste('Ctrl+I dentro de negrito vira negrito e italico', () => {
  const v = editor('**negrito**', 4);
  E.alternaMarca('*')(v);
  igual(v.state.doc.toString(), '***negrito***');
});
teste('Ctrl+B em selecao ja marcada por dentro tira', () => {
  const v = editor('a **b** c', 2, 7);
  E.alternaMarca('**')(v);
  igual(v.state.doc.toString(), 'a b c');
});
teste('Ctrl+K com texto vira link com url selecionada', () => {
  const v = editor('veja isto', 5, 9);
  E.insereLink(v);
  igual(v.state.doc.toString(), 'veja [isto](url)');
  igual(v.state.doc.sliceString(sel(v)[0], sel(v)[1]), 'url');
});
teste('Ctrl+K com url selecionada poe o cursor no texto', () => {
  const v = editor('https://x.com', 0, 13);
  E.insereLink(v);
  igual(v.state.doc.toString(), '[](https://x.com)');
  igual(sel(v), [1, 1]);
});

console.log('listas (Enter)');
function enter(doc, pos) {
  const v = editor(doc, pos == null ? doc.length : pos);
  E.tecladoEnter(v);
  return v.state.doc.toString();
}
teste('continua item com marcador', () => igual(enter('- item'), '- item\n- '));
teste('numerada soma um', () => igual(enter('1. um'), '1. um\n2. '));
teste('tarefa nova nasce desmarcada', () => igual(enter('- [x] feito'), '- [x] feito\n- [ ] '));
teste('item vazio sai da lista', () => igual(enter('- a\n- '), '- a\n'));
teste('citacao continua', () => igual(enter('> linha'), '> linha\n> '));
teste('item vazio aninhado volta um nivel', () => igual(enter('- a\n    - '), '- a\n- '));
teste('citacao vazia sai da citacao', () => igual(enter('> a\n> '), '> a\n'));

console.log('tabela (Tab, Shift+Tab, Enter)');
function editorTabela(doc, pos) {
  // o editor de verdade tem o textops carregado antes
  if (!global.MarkPadTextOps) (0, eval)(fs.readFileSync(path.join(WEB, 'textops.js'), 'utf8'));
  return editor(doc, pos);
}
const TAB = '| a | b |\n|---|---|\n| 1 | 2 |';
teste('Tab vai para a proxima celula e realinha', () => {
  const v = editorTabela(TAB, 2);
  E.navegaTabela(1, false)(v);
  igual(v.state.doc.toString(), '| a   | b   |\n| --- | --- |\n| 1   | 2   |');
  igual(v.state.doc.sliceString(sel(v)[0], sel(v)[1]), 'b');
});
teste('Tab na ultima celula da linha pula a linha de tracos', () => {
  const v = editorTabela(TAB, 6);
  E.navegaTabela(1, false)(v);
  igual(v.state.doc.sliceString(sel(v)[0], sel(v)[1]), '1');
});
teste('Tab na ultima celula da tabela cria uma linha', () => {
  const v = editorTabela(TAB, TAB.length - 2);
  E.navegaTabela(1, false)(v);
  igual(v.state.doc.toString().split('\n').length, 4);
  igual(v.state.doc.lineAt(sel(v)[0]).number, 4);
});
teste('Shift+Tab volta uma celula', () => {
  const v = editorTabela(TAB, TAB.length - 2);
  E.navegaTabela(-1, false)(v);
  igual(v.state.doc.sliceString(sel(v)[0], sel(v)[1]), '1');
});
teste('Enter desce na mesma coluna', () => {
  const v = editorTabela(TAB, 6);
  E.navegaTabela(0, true)(v);
  igual(v.state.doc.sliceString(sel(v)[0], sel(v)[1]), '2');
});
teste('fora de tabela nao age', () => {
  const v = editorTabela('texto', 2);
  igual(E.navegaTabela(1, false)(v), false);
});

console.log('lista numerada');
function editorRenumera(doc) {
  return EditorState.create({ doc, extensions: [E.linguagemMarkdown(), E.renumeraListas] });
}
teste('apagar um item renumera os seguintes', () => {
  const st = editorRenumera('1. a\n2. b\n3. c\n4. d');
  const tr = st.update({ changes: { from: 5, to: 10 } });
  igual(tr.state.doc.toString(), '1. a\n2. c\n3. d');
});
teste('comeca do numero do primeiro item', () => {
  const st = editorRenumera('5. a\n6. b');
  igual(st.update({ changes: { from: 9, insert: '\n9. c' } }).state.doc.toString(), '5. a\n6. b\n7. c');
});
teste('numeracao preguicosa (1. 1.) vira sequencia ao editar', () => {
  const st = editorRenumera('1. a\n1. b');
  igual(st.update({ changes: { from: 9, insert: 'x' } }).state.doc.toString(), '1. a\n2. bx');
});

console.log('realce de codigo (leitor e editor)');
const R = global.MarkPadEditor.realcaCodigo;
teste('PowerShell separa cmdlet, variavel, parametro e operador', () => {
  const h = R('Get-ChildItem -Path $pasta | Where-Object { $_.Length -gt 10 }', 'powershell');
  igual(/tok-fn">Get-ChildItem</.test(h), true);
  igual(/tok-attr">-Path</.test(h), true);
  igual(/tok-var">\$pasta</.test(h), true);
  igual(/tok-op">-gt</.test(h), true);
});
teste('shell: comando no comeco, opcao e variavel', () => {
  const h = R('ping -c 4 $ALVO && echo ok', 'bash');
  igual(/tok-fn">ping</.test(h), true);
  igual(/tok-attr">-c</.test(h), true);
  igual(/tok-var">\$ALVO</.test(h), true);
  igual(/tok-fn">echo</.test(h), true);
});
teste('escapa o HTML do codigo', () => igual(/&lt;div&gt;/.test(R('x = "<div>"', 'python')), true));
teste('linguagem desconhecida devolve null (o leitor usa o realce antigo)', () => igual(R('x', 'klingon'), null));

console.log('links');
teste('classificacao do destino', () => {
  igual(E.atributosDoLink('https://x.com'), { 'data-external': 'https://x.com' });
  igual(E.atributosDoLink('www.x.com'), { 'data-external': 'https://www.x.com' });
  igual(E.atributosDoLink('#secao'), { 'data-anchor': 'secao' });
  igual(E.atributosDoLink('notas/a.md'), { 'data-file': 'notas/a.md' });
  igual(E.atributosDoLink('<a b.md>'), { 'data-file': 'a b.md' });
});

console.log('\n' + ok + '/' + (ok + falhas) + ' passaram');
if (falhas) process.exit(1);
