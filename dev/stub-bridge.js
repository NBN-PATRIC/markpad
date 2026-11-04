/* Simula o host WebView2 pra conferir a interface no navegador. */
(function () {
  var SAMPLE = [
    '---',
    'title: Guia rapido do MarkPad',
    'tags:',
    '  - exemplo',
    '  - markdown',
    '---',
    '',
    '# Guia rapido do MarkPad',
    '',
    'Documento de demonstracao. Tem *italico*, **negrito**, ***os dois***,',
    '~~riscado~~, ==destaque==, `codigo inline` e um [link](https://exemplo.com).',
    '',
    'Clique na setinha ao lado de qualquer titulo (ou de duplo clique nele) para',
    'recolher a secao inteira.',
    '',
    '## Tarefas',
    '',
    '- [x] Abrir um arquivo `.md`',
    '- [x] Ler sem medo de digitar sem querer',
    '- [ ] Acionar o giz para liberar a edicao',
    '- [ ] Explorar os atalhos',
    '  - `Ctrl+E` alterna a trava',
    '  - `Ctrl+F` localiza no documento',
    '    1. `Enter` vai para o proximo',
    '    2. `Shift+Enter` volta',
    '',
    '## Avisos',
    '',
    '> [!warning] Callout de atencao',
    '> Os callouts do Obsidian funcionam, com icone e cor por tipo.',
    '',
    '> [!tip] Dica',
    '> Existem `note`, `info`, `tip`, `success`, `question`, `warning`,',
    '> `failure`, `danger`, `bug`, `example` e `quote`.',
    '',
    '> [!example]- Este aqui e dobravel (clique para abrir)',
    '> Basta acrescentar `-` ou `+` depois do tipo: `> [!example]-`.',
    '',
    '> Citacao comum, sem tipo,',
    '> continuando na linha de baixo.',
    '',
    '## Tabelas',
    '',
    'O alinhamento por coluna e respeitado e o cabecalho fica fixo ao rolar.',
    '',
    '| Recurso           | Atalho         | Disponivel travado |',
    '|:------------------|:--------------:|-------------------:|',
    '| Localizar         | `Ctrl+F`       |                sim |',
    '| Recolher secoes   | `Ctrl+Shift+-` |                sim |',
    '| Copiar trecho     | `Ctrl+C`       |                sim |',
    '| Salvar            | `Ctrl+S`       |                nao |',
    '| Substituir texto  | —              |                nao |',
    '',
    '## Codigo',
    '',
    '```bash',
    '# conta quantos titulos existem em cada nota',
    'grep -c "^#" *.md | sort -t: -k2 -rn | head',
    '```',
    '',
    '```javascript',
    '// o realce cobre cerca de 20 linguagens',
    'async function contarPalavras(texto) {',
    '  const palavras = texto.match(/[\\wA-Za-z]+/g) ?? [];',
    '  return { total: palavras.length, unicas: new Set(palavras).size };',
    '}',
    '```',
    '',
    '```python',
    'def titulos(caminho):',
    '    with open(caminho, encoding="utf-8") as f:',
    '        return [l.strip() for l in f if l.startswith("#")]',
    '```',
    '',
    '## Extensoes do Obsidian',
    '',
    'Wikilink para [[leiame]], com apelido [[leiame|texto alternativo]],',
    'e tags como #exemplo/basico, #exemplo/avancado, #exemplo/basico de novo,',
    'alem de #projeto/api, #projeto/ui, #projeto e #ideia solta.',
    'Pare o mouse sobre um wikilink para ver a previa em cartao.',
    '',
    'Este paragrafo tem um marcador de bloco e da para saltar ate ele',
    'com [[#^marco]] ou embuti-lo de outra nota. ^marco',
    '',
    '### Transclusao',
    '',
    'A nota inteira, incrustada:',
    '',
    '![[leiame]]',
    '',
    'So uma secao: ![[leiame#Historico]] — e um bloco so: ![[leiame#^dois]].',
    '',
    'Notas de rodape tambem funcionam[^1].',
    '',
    '[^1]: E o link de volta leva ao ponto de origem.'
  ].join('\n');

  var FILES = {
    'C:\\notas\\guia.md': SAMPLE,
    'C:\\notas\\leiame.md': '---\ntags:\n  - ideia\n  - projeto/api\n---\n\n# Leiame\n\nArquivo curto de teste com #ideia, que aponta de volta para o [[guia]].\n\n- um\n- dois ^dois\n\n## Historico\n\nSo esta secao aparece em `![[leiame#Historico]]`.\n',
    // Subpasta, link markdown relativo, link quebrado e mencao sem link:
    // o que o indice de links (web/linkindex.js) precisa para aparecer.
    'C:\\notas\\projeto\\api.md': '---\ntags: [projeto/api, rascunho]\naliases: [Interface]\n---\n\n# API\n\nVolta para o [guia](../guia.md) e para o [[leiame#Historico]].\n\nAinda falta escrever a [[Nota que nao existe]].\n\nO leiame explica o resto, mas sem link.\n\n![[capa.png|200]]\n\n![[aula.mp4]]\n'
  };
  // mtime fingido por arquivo: o indexFolder so manda texto do que mudou.
  var MTIMES = {};
  function mtimeDe(k) { return MTIMES[k] || (MTIMES[k] = 1000); }

  // Historico de versoes fingido: o guia ja nasce com uma versao de ontem
  // (titulo e uma tarefa diferentes), e todo writeFile guarda a anterior.
  var VERSOES = {};
  function guardaVersao(k, texto, quando) {
    var lista = VERSOES[k] || (VERSOES[k] = []);
    var d = new Date(quando);
    var id = d.toISOString().replace(/[-:]/g, '').replace('.', '').slice(0, 18) + '.txt';
    lista.push({ id: id, when: quando, size: texto.length, content: texto });
  }
  guardaVersao('C:\\notas\\guia.md', SAMPLE.replace('# Guia rapido do MarkPad', '# Guia do MarkPad (rascunho)')
    .replace('- [ ] Explorar os atalhos\n', '- [ ] Explorar os atalhos\n- [ ] Tarefa que foi apagada depois\n'),
    Date.now() - 26 * 3600 * 1000);

  /* Fora do WebView nao ha rede nem instalador. Abra o preview com
     ?update=1 para o atualizador encenar o fluxo inteiro: aviso, download
     com barra de progresso e "pronta para instalar". */
  var ENCENA_UPDATE = /[?&]update=1\b/.test(location.search);

  // A encenacao do atualizador dizia, na unha, "voce esta na 1.2.0 e saiu a
  // 1.3.0" — e no dia em que a 1.3.0 saiu de verdade a tela de teste passou a
  // anunciar como novidade uma versao ja lancada. Agora a versao nova e
  // derivada da atual (sobe a minor), entao a encenacao nao envelhece.
  var VERSAO_FINGIDA = '1.3.0';
  var VERSAO_NOVA = VERSAO_FINGIDA.replace(/^(\d+)\.(\d+)/, function (tudo, maior, menor) {
    return maior + '.' + (Number(menor) + 1);
  });
  var pendenteFalso = null;

  window.chrome = {
    webview: {
      _handlers: [],
      addEventListener: function (_, fn) { this._handlers.push(fn); },
      postMessage: function (msg) {
        var self = this;
        var result = null, error = null;

        try {
          switch (msg.op) {
            case 'ready':
              result = { version: VERSAO_FINGIDA, openPaths: ['C:\\notas\\guia.md'], associated: false, exePath: 'C:\\MarkPad.exe' };
              break;
            case 'loadSettings': result = null; break;
            case 'saveSettings': case 'setTitleBarTheme': case 'setTitle':
            case 'watchFile': case 'unwatchFile': result = true; break;
            case 'readFile':
              var p = msg.args.path;
              if (FILES[p] === undefined) throw new Error('nao encontrado');
              result = {
                path: p, name: p.split('\\').pop(), dir: p.replace(/\\[^\\]*$/, ''),
                content: FILES[p], encoding: 'utf-8', eol: '\r\n',
                size: FILES[p].length, mtime: mtimeDe(p), readOnlyOnDisk: false
              };
              break;
            case 'writeFile':
              if (FILES[msg.args.path] !== undefined && FILES[msg.args.path] !== msg.args.content) {
                guardaVersao(msg.args.path, FILES[msg.args.path], Date.now());
              }
              FILES[msg.args.path] = msg.args.content;
              MTIMES[msg.args.path] = mtimeDe(msg.args.path) + 1;
              result = { path: msg.args.path, mtime: MTIMES[msg.args.path] };
              break;
            case 'mapFolder':
              // Sem disco de verdade no preview: sem URL, o casulo mostra o nome.
              result = { host: null };
              break;
            case 'listVersions':
              result = { versions: (VERSOES[msg.args.path] || []).slice().reverse().map(function (v) {
                return { id: v.id, when: v.when, size: v.size };
              }) };
              break;
            case 'readVersion':
              var achadaV = (VERSOES[msg.args.path] || []).filter(function (v) { return v.id === msg.args.id; })[0];
              if (!achadaV) throw new Error('essa versao nao existe mais.');
              result = { content: achadaV.content };
              break;
            case 'indexFolder':
              // Mesmo contrato do C#, com lote minusculo (1 KB) para o preview
              // exercitar as voltas de `pending` que o hub inteiro provoca.
              var conhecidos = msg.args.known || {};
              var usados = 0, pendentes = 0;
              result = { root: 'C:\\notas', read: 0, truncated: false, files: Object.keys(FILES).map(function (k) {
                var rel = k.slice('C:\\notas\\'.length).replace(/\\/g, '/');
                if (!/\.md$/i.test(k)) return { rel: rel };
                var muda = conhecidos[k] !== mtimeDe(k);
                var vai = muda && usados < 1024;
                if (vai) usados += FILES[k].length;
                if (muda && !vai) pendentes++;
                return { rel: rel, md: true, mtime: mtimeDe(k), big: false, pending: muda && !vai, text: vai ? FILES[k] : null };
              }) };
              result.pending = pendentes;
              break;
            case 'listDir':
              result = { path: 'C:\\notas', name: 'notas', entries: [
                { name: 'arquivo', path: 'C:\\notas\\arquivo', dir: true },
                { name: 'guia.md', path: 'C:\\notas\\guia.md', dir: false, size: 900, markdown: true },
                { name: 'leiame.md', path: 'C:\\notas\\leiame.md', dir: false, size: 40, markdown: true },
                { name: 'planilha.csv', path: 'C:\\notas\\planilha.csv', dir: false, size: 120, markdown: false }
              ] };
              break;
            case 'listFiles':
              result = { files: Object.keys(FILES).map(function (k) {
                return { path: k, name: k.split('\\').pop(), dir: k.replace(/\\[^\\]*$/, ''),
                         markdown: /\.md$/i.test(k), size: FILES[k].length };
              }) };
              break;
            case 'listTags':
              var conta = Object.create(null), quantos = Object.create(null);
              Object.keys(FILES).forEach(function (k) {
                if (!/\.md$/i.test(k)) return;
                var vistas = Object.create(null);
                var re = /(?:^|[\s(\[])#([A-Za-z\u00C0-\u024F][\w\u00C0-\u024F/-]*)/g;
                var m;
                while ((m = re.exec(FILES[k]))) {
                  var t = m[1].replace(/\/+$/, '');
                  conta[t] = (conta[t] || 0) + 1;
                  vistas[t] = true;
                }
                Object.keys(vistas).forEach(function (t) { quantos[t] = (quantos[t] || 0) + 1; });
              });
              result = {
                tags: Object.keys(conta).map(function (t) {
                  return { tag: t, count: conta[t], files: quantos[t] };
                }).sort(function (x, y) { return y.count - x.count; }),
                scanned: Object.keys(FILES).length,
                truncated: false
              };
              break;
            case 'openFolderDialog': result = 'C:\\notas'; break;
            case 'renameFile':
              var deR = msg.args.path, paraR = deR.replace(/[^\\]*$/, '') + msg.args.name;
              if (!FILES[deR]) throw new Error('o arquivo nao esta mais no disco.');
              if (paraR !== deR && FILES[paraR]) throw new Error('ja existe um arquivo com esse nome nesta pasta.');
              FILES[paraR] = FILES[deR];
              if (paraR !== deR) delete FILES[deR];
              result = { path: paraR, name: msg.args.name, dir: paraR.replace(/\\[^\\]*$/, ''), size: FILES[paraR].length, mtime: Date.now() };
              break;
            case 'moveFile':
              var deM = msg.args.path, nomeM = deM.split('\\').pop();
              var paraM = msg.args.dir + '\\' + nomeM;
              if (!FILES[deM]) throw new Error('o arquivo nao esta mais no disco.');
              FILES[paraM] = FILES[deM];
              if (paraM !== deM) delete FILES[deM];
              result = { path: paraM, name: nomeM, dir: msg.args.dir, size: FILES[paraM].length, mtime: Date.now() };
              break;
            case 'duplicateFile':
              var deD = msg.args.path;
              if (!FILES[deD]) throw new Error('o arquivo nao esta mais no disco.');
              var nomeD = deD.split('\\').pop().replace(/(\.[^.]+)?$/, ' copia$1');
              var paraD = 'C:\\notas\\' + nomeD;
              FILES[paraD] = FILES[deD];
              result = { path: paraD, name: nomeD, dir: 'C:\\notas', size: FILES[paraD].length, mtime: Date.now() };
              break;
            case 'deleteFile':
              if (!FILES[msg.args.path]) throw new Error('o arquivo nao esta mais no disco.');
              delete FILES[msg.args.path];
              result = true;
              break;
            case 'openWithDefault':
              if (/\\.(exe|bat|cmd|ps1)$/i.test(msg.args.path)) throw new Error('e executavel: abrir seria executar.');
              result = true;
              break;
            case 'pathInfo':
              // O de verdade olha o disco; aqui o disco e o mapa FILES.
              var pedidoPI = String(msg.args.path || '').toLowerCase();
              var achadoPI = Object.keys(FILES).filter(function (k) { return k.toLowerCase() === pedidoPI; })[0];
              result = achadoPI
                ? { path: achadoPI, kind: 'file', exists: true }
                : { path: msg.args.path, kind: 'none', exists: false };
              break;
            // Qualquer imagem local vira o mesmo retangulo: o visor e o tamanho
            // tem o que mostrar sem disco de verdade.
            case 'resolveAsset': result = { url: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgZmlsbD0iIzNjNWFhMCIvPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9IjU2MCIgaGVpZ2h0PSIyODAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSI2Ii8+PC9zdmc+', path: msg.args.src }; break;
            case 'grepFolder':
              var agulha = String(msg.args.query || '');
              if (!msg.args.caseSensitive) agulha = agulha.toLowerCase();
              var grupos = [];
              var so = msg.args.paths && msg.args.paths.map(function (x) { return x.toLowerCase(); });
              Object.keys(FILES).forEach(function (k) {
                if (so && so.indexOf(k.toLowerCase()) < 0) return;   // filtros file:, path:, tag:
                var hits = [];
                FILES[k].split('\n').forEach(function (linha, idx) {
                  var palheiro = msg.args.caseSensitive ? linha : linha.toLowerCase();
                  if (agulha && palheiro.indexOf(agulha) !== -1) hits.push({ line: idx + 1, text: linha });
                });
                if (hits.length) grupos.push({ path: k, relative: k.split('\\').pop(), hits: hits });
              });
              result = { results: grupos, truncated: false };
              break;

            // ------------------------------------------------ atualizacao
            case 'updateCheck':
              result = ENCENA_UPDATE
                ? { ok: true, available: true, current: VERSAO_FINGIDA, latest: VERSAO_NOVA,
                    name: 'MarkPad ' + VERSAO_NOVA, notes: 'Atualizador automatico.',
                    page: 'https://github.com/NBN-PATRIC/markpad/releases',
                    asset: 'MarkPad-' + VERSAO_NOVA + '-setup-win-x64.exe',
                    url: 'https://example.invalid/setup.exe',
                    sha256: new Array(65).join('0'), size: 57 * 1024 * 1024,
                    canInstall: true, portable: false }
                : { ok: true, available: false, current: VERSAO_FINGIDA, latest: VERSAO_FINGIDA };
              break;

            case 'updatePending': result = pendenteFalso; break;
            case 'updateDiscard': pendenteFalso = null; result = true; break;

            case 'updateApply':
              if (!pendenteFalso) throw new Error('nao ha atualizacao pronta para instalar.');
              console.log('(preview) aqui o MarkPad fecharia e o instalador rodaria.');
              result = true;
              break;

            case 'updateDownload':
              baixaFalso(msg.args, self, msg.id);
              return; // a resposta sai la de dentro, depois da barra encher

            default: result = true;
          }
        } catch (e) { error = e.message; }

        setTimeout(function () {
          self._handlers.forEach(function (h) {
            h({ data: { id: msg.id, ok: !error, result: result, error: error } });
          });
        }, 5);
      }
    }
  };

  /* Emite os mesmos eventos updateProgress do lado C# — um por pedaco — e
     so entao resolve a chamada, para a barra do canto percorrer os quatro
     estados sem precisar de rede nem de um .exe de verdade. */
  function baixaFalso(args, bridge, id) {
    var total = 57 * 1024 * 1024;
    var feito = 0;

    var passo = setInterval(function () {
      feito = Math.min(total, feito + Math.round(total / 12));
      bridge._handlers.forEach(function (h) {
        h({ data: { evt: 'updateProgress', data: { done: feito, total: total } } });
      });

      if (feito < total) return;

      clearInterval(passo);
      pendenteFalso = { version: args.version, file: args.asset };
      bridge._handlers.forEach(function (h) {
        h({ data: { id: id, ok: true, result: pendenteFalso, error: null } });
      });
    }, 260);
  }
})();
