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
    'Wikilink para [[Outra Nota]], com apelido [[Outra Nota|texto alternativo]],',
    'e tags como #exemplo/basico, #exemplo/avancado, #exemplo/basico de novo,',
    'alem de #projeto/api, #projeto/ui, #projeto e #ideia solta.',
    '',
    'Notas de rodape tambem funcionam[^1].',
    '',
    '[^1]: E o link de volta leva ao ponto de origem.'
  ].join('\n');

  var FILES = {
    'C:\\notas\\guia.md': SAMPLE,
    'C:\\notas\\leiame.md': '---\ntags:\n  - ideia\n  - projeto/api\n---\n\n# Leiame\n\nArquivo curto de teste com #ideia.\n\n- um\n- dois\n'
  };

  /* Fora do WebView nao ha rede nem instalador. Abra o preview com
     ?update=1 para o atualizador encenar o fluxo inteiro: aviso, download
     com barra de progresso e "pronta para instalar". */
  var ENCENA_UPDATE = /[?&]update=1\b/.test(location.search);
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
              result = { version: '1.0.0', openPaths: ['C:\\notas\\guia.md'], associated: false, exePath: 'C:\\MarkPad.exe' };
              break;
            case 'loadSettings': result = null; break;
            case 'saveSettings': case 'setTitleBarTheme': case 'setTitle':
            case 'watchFile': case 'unwatchFile': result = true; break;
            case 'readFile':
              var p = msg.args.path;
              if (!FILES[p]) throw new Error('nao encontrado');
              result = {
                path: p, name: p.split('\\').pop(), dir: 'C:\\notas',
                content: FILES[p], encoding: 'utf-8', eol: '\r\n',
                size: FILES[p].length, mtime: Date.now(), readOnlyOnDisk: false
              };
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
              var deR = msg.args.path, paraR = 'C:\\notas\\' + msg.args.name;
              if (!FILES[deR]) throw new Error('o arquivo nao esta mais no disco.');
              if (paraR !== deR && FILES[paraR]) throw new Error('ja existe um arquivo com esse nome nesta pasta.');
              FILES[paraR] = FILES[deR];
              if (paraR !== deR) delete FILES[deR];
              result = { path: paraR, name: msg.args.name, dir: 'C:\\notas', size: FILES[paraR].length, mtime: Date.now() };
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
            case 'pathInfo': result = { path: msg.args.path, kind: 'file', exists: true }; break;
            case 'resolveAsset': result = null; break;
            case 'grepFolder': result = { results: [], truncated: false }; break;

            // ------------------------------------------------ atualizacao
            case 'updateCheck':
              result = ENCENA_UPDATE
                ? { ok: true, available: true, current: '1.2.0', latest: '1.3.0',
                    name: 'MarkPad 1.3.0', notes: 'Atualizador automatico.',
                    page: 'https://github.com/NBN-PATRIC/markpad/releases',
                    asset: 'MarkPad-1.3.0-setup-win-x64.exe',
                    url: 'https://example.invalid/setup.exe',
                    sha256: new Array(65).join('0'), size: 57 * 1024 * 1024,
                    canInstall: true, portable: false }
                : { ok: true, available: false, current: '1.2.0', latest: '1.2.0' };
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
