/*
 * app.js — MarkPad
 *
 * Ideia central: todo arquivo abre TRAVADO. No estado travado nao existe
 * textarea na pagina — so o texto renderizado. Nao ha tecla que edite,
 * apague ou digite nada, porque nao ha onde digitar. A edicao so aparece
 * quando o usuario aciona a trava (o giz) de proposito.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // Texto de interface. A chave e o proprio portugues (ver web/i18n.js), entao
  // um idioma sem a frase cadastrada mostra portugues, nunca um identificador.
  var t = window.MarkPadI18n.t;

  // ============================================================== ponte

  var bridge = (function () {
    var seq = 1;
    var pending = new Map();
    var listeners = Object.create(null);

    if (!window.chrome || !window.chrome.webview) {
      return {
        call: function () { return Promise.reject(new Error(t('ponte indisponivel'))); },
        on: function () {}
      };
    }

    window.chrome.webview.addEventListener('message', function (e) {
      var msg = e.data;
      if (!msg) return;

      if (msg.evt) {
        (listeners[msg.evt] || []).forEach(function (fn) {
          try { fn(msg.data); } catch (err) { console.error(err); }
        });
        return;
      }

      var slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.ok) slot.resolve(msg.result);
      else slot.reject(new Error(msg.error || t('falha desconhecida')));
    });

    return {
      call: function (op, args) {
        var id = seq++;
        return new Promise(function (resolve, reject) {
          pending.set(id, { resolve: resolve, reject: reject });
          window.chrome.webview.postMessage({ id: id, op: op, args: args || {} });
        });
      },
      on: function (evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
      }
    };
  })();

  // ============================================================== estado

  var DEFAULTS = {
    theme: 'dark',
    // Idioma da interface. 'auto' segue o Windows; o resto e o codigo da lista
    // de web/i18n.js. O idioma do documento nao entra nisso.
    language: 'auto',
    // Paleta de cores por cima do modo (claro/escuro): 'markpad' e a folha
    // embutida, o resto reescreve as raizes em themes.js.
    palette: 'markpad',
    // Acento escolhido a mao (hex). Vazio = o acento da paleta.
    accent: '',
    // Tema importado do VS Code: { nome, escuro, vars, acento }. Vale sobre a
    // paleta enquanto o modo da janela bater com o modo do tema.
    vscodeTheme: null,
    lockOnOpen: true,
    confirmUnlock: false,
    showSource: false,
    sideReader: false,
    wordWrap: true,
    lineNumbers: true,
    corretor: false,
    autoPar: true,
    notaDiariaPasta: '',
    notaDiariaFormato: 'YYYY-MM-DD',
    notaDiariaModelo: '',
    notaUnicaPasta: '',
    notaUnicaFormato: 'YYYYMMDDHHmm',
    modelosPasta: 'Modelos',
    fontSize: 16,
    editorFontSize: 14,
    wideLines: false,
    autoSave: false,
    // Ultimas escolhas do "Exportar PDF". Margem em mm, escala em %.
    pdf: { papel: 'a4', orientacao: 'retrato', margem: 20, escala: 100, fundos: true, cabecalho: false },
    loadRemoteImages: false,
    sidebarVisible: true,
    sidebarWidth: 260,
    sidebarPane: 'files',
    splitRatio: 0.5,
    restoreSession: true,
    treeOnlyMarkdown: true,
    treeSort: 'nome-asc',
    tagSort: 'contagem',
    treeFoldersFirst: true,
    warnNonMarkdown: true,
    animations: true,
    showProperties: true,
    showBacklinks: true,
    // secoes do pe da leitura abertas ou recolhidas: vale para todo documento
    peLinks: { ligadas: false, soltas: false, saidas: false },
    hoverPreview: true,
    quickBarVisible: true,
    quickBarLabels: false,
    quickBar: ['open', 'openFolder', 'new', 'save', 'close', 'lock', 'find'],
    checkUpdates: true,
    // Marca da ultima consulta ao GitHub. Sem ela, abrir e fechar o MarkPad
    // dez vezes num dia sao dez consultas — e a API tem limite por IP.
    lastUpdateCheck: 0,
    recent: [],
    lastFolder: null,
    session: [],
    sessionFixadas: [],
    // Cor da aba por caminho (1 a 5), como o Notepad++ guarda na sessao.
    sessionCores: {}
  };

  // Copia funda: DEFAULTS tem arrays (quickBar, recent, session) e o editor
  // da barra rapida muta no lugar — com copia rasa ele adultera o padrao e
  // t('Restaurar o padrao') devolve a lista ja estragada.
  var settings = JSON.parse(JSON.stringify(DEFAULTS));
  var app = {
    tabs: [],
    activeId: null,
    nextId: 1,
    folder: null,
    treeOpen: Object.create(null),
    treeFilter: '',
    indice: null,
    indiceDe: null,
    tags: null,
    tagsDe: null,
    tagFilter: '',
    tagOpen: Object.create(null),
    exePath: '',
    associated: false,
    find: { open: false, query: '', caseSensitive: false, regex: false, index: 0, total: 0 },
    folderSearch: { caseSensitive: false, regex: false },
    // Pilha do Ctrl+Shift+T. O conteudo vai junto porque uma nota que nunca
    // foi salva morre no fechar e nao teria de onde voltar.
    fechadas: [],
    closing: false,
    // Tela dividida: no maximo dois grupos de abas (o Notepad++ tem duas
    // vistas). Cada aba sabe o seu (tab.grupo); o grupo lembra a aba da vez.
    grupos: [{ id: 1, ativa: null }],
    grupoAtivo: 1
  };

  function activeTab() {
    for (var i = 0; i < app.tabs.length; i++) if (app.tabs[i].id === app.activeId) return app.tabs[i];
    return null;
  }

  function tabByPath(path) {
    if (!path) return null;
    var lower = path.toLowerCase();
    for (var i = 0; i < app.tabs.length; i++) {
      if (app.tabs[i].path && app.tabs[i].path.toLowerCase() === lower) return app.tabs[i];
    }
    return null;
  }

  // ======================================================= configuracoes

  // ------------------------------------------------- copia de seguranca
  //
  // Enquanto houver alteração pendente, o texto vai para um arquivo separado
  // a cada dois segundos parados. Fechar o app sem salvar não perde nada, e o
  // arquivo do usuário só é tocado quando ele mandar salvar de verdade.

  var backupTimers = Object.create(null);

  // Nota sem arquivo (nova, ou restaurada de um arquivo que sumiu) tambem tem
  // rascunho. Antes nao tinha: uma nota nova nunca salva se perdia inteira numa
  // queda de energia. A chave e um nome sintetico que nunca existe no disco, e
  // por isso a restauracao ja a traz de volta como aba sem titulo.
  function chaveDeRascunho(tab) {
    if (tab.path) return tab.path;
    if (!tab.rascunhoId) tab.rascunhoId = 'markpad:sem-titulo:' + Date.now().toString(36) + '-' + tab.id;
    return tab.rascunhoId;
  }

  function scheduleBackup(tab) {
    if (!tab) return;
    atualizaEspelhos(tab);
    var chave = chaveDeRascunho(tab);

    clearTimeout(backupTimers[tab.id]);
    backupTimers[tab.id] = setTimeout(function () {
      // Arquivo apagado por fora: o texto so existe na aba, o rascunho fica
      // mesmo sem edicao.
      var soNaAba = tab.apagadoNoDisco && !!tab.content;
      if ((tab.content === tab.savedContent && !soNaAba) || (!tab.path && !tab.content)) {
        bridge.call('dropBackup', { path: chave }).catch(function () {});
        return;
      }
      bridge.call('writeBackup', {
        path: chave, name: tab.name, content: tab.content,
        baseMtime: tab.path ? (tab.mtime || 0) : 0
      }).catch(function () {});
    }, 2000);
  }

  // Apaga o rascunho pelas duas chaves: a nota sem titulo que acabou de ganhar
  // um arquivo ("Salvar como") deixaria o rascunho antigo para tras.
  function dropBackup(tab) {
    if (!tab) return Promise.resolve();
    clearTimeout(backupTimers[tab.id]);
    var chaves = [tab.path, tab.rascunhoId].filter(Boolean);
    return Promise.all(chaves.map(function (c) {
      return bridge.call('dropBackup', { path: c }).catch(function () {});
    }));
  }

  /*
   * Ao iniciar, oferece de volta o que ficou pendente da sessao anterior.
   * Um a um, como no "recuperar" do Notepad++ (estudo 03 §2.2): restaurar,
   * descartar ou decidir depois, vendo a diferenca para o disco. Se o disco
   * mudou depois do rascunho, a linha avisa, e a aba restaurada nasce com o
   * selo "mudou no disco" (o Ctrl+S pergunta antes de gravar por cima).
   * `manual`: veio do comando, entao lista tambem quando nao ha nada.
   */
  function offerBackups(manual) {
    return bridge.call('listBackups', {}).then(function (res) {
      var lista = ((res && res.backups) || []).filter(function (b) {
        // Rascunho igual ao texto de uma aba aberta e o desta sessao, nao
        // pendencia. A aba que a sessao reabriu esta com o texto do disco,
        // entao o rascunho dela (diferente) continua sendo oferecido.
        return !app.tabs.some(function (tab) {
          var mesma = (tab.path && mesmoArquivo(tab.path, b.path)) || tab.rascunhoId === b.path;
          return mesma && tab.content === b.content;
        });
      });
      if (!lista.length) {
        if (manual) toast(t('Nenhum rascunho pendente.'), '', 2200);
        return;
      }
      // Fechou sem perguntar (opcao ligada): o texto volta sozinho, sem aviso.
      if (settings.fecharGuardando && !manual) {
        lista.forEach(function (b) { b.escolha = 'restaurar'; });
        return aplicaRascunhos(lista);
      }
      return dialogoRascunhos(lista).then(aplicaRascunhos);
    }).catch(function () {});
  }

  function rascunhoSemArquivo(b) { return b.path.indexOf('markpad:sem-titulo:') === 0; }
  function rascunhoDiscoMudou(b) {
    return b.fileExists && b.baseMtime && b.diskMtime && b.baseMtime !== b.diskMtime;
  }

  /** A lista de rascunhos com a escolha de cada um. Resolve a lista com `escolha`. */
  function dialogoRascunhos(lista) {
    return new Promise(function (resolve) {
      var overlay = $('overlay');
      var box = document.createElement('div');
      box.className = 'dialog versoes rascunhos';
      box.setAttribute('role', 'dialog');

      var h = document.createElement('h2');
      h.textContent = t('Alterações não salvas da sessão anterior');
      box.appendChild(h);
      var p = document.createElement('p');
      p.textContent = t('O MarkPad guardou o texto que não chegou a ser gravado. O arquivo em disco continua intacto: restaurar só traz o texto de volta para a aba, e quem grava é o Ctrl+S.');
      box.appendChild(p);

      var corpo = document.createElement('div');
      corpo.className = 'versoes-corpo';
      var col = document.createElement('div');
      col.className = 'versoes-lista';
      var vista = document.createElement('div');
      vista.className = 'versoes-diff';
      corpo.appendChild(col);
      corpo.appendChild(vista);
      box.appendChild(corpo);

      var atual = null;
      lista.forEach(function (b) {
        b.escolha = 'restaurar';
        var item = document.createElement('div');
        item.className = 'versoes-item rascunho-item';
        var nome = document.createElement('span');
        nome.textContent = b.name || baseName(b.path);
        var sub = document.createElement('span');
        sub.className = 'pal-sub';
        var partes = [haQuanto(b.when)];
        if (rascunhoSemArquivo(b)) partes.push(t('nota sem arquivo'));
        else if (!b.fileExists) partes.push(t('o arquivo não existe mais'));
        sub.textContent = partes.join(' · ');
        item.appendChild(nome);
        item.appendChild(sub);
        if (rascunhoDiscoMudou(b)) {
          var aviso = document.createElement('span');
          aviso.className = 'rascunho-aviso';
          aviso.textContent = t('o disco mudou depois do rascunho');
          item.appendChild(aviso);
        }
        var sel = document.createElement('select');
        sel.className = 'set-select';
        [['restaurar', t('Restaurar')], ['descartar', t('Descartar')], ['depois', t('Decidir depois')]].forEach(function (o) {
          var op = document.createElement('option');
          op.value = o[0];
          op.textContent = o[1];
          sel.appendChild(op);
        });
        sel.onclick = function (e) { e.stopPropagation(); };
        sel.onchange = function () { b.escolha = sel.value; };
        item.appendChild(sel);
        item.onclick = function () { mostra(b, item); };
        col.appendChild(item);
        if (!atual) atual = [b, item];
      });

      function mostra(b, item) {
        Array.prototype.forEach.call(col.children, function (el) { el.classList.toggle('is-active', el === item); });
        vista.textContent = '';
        var disco = (!b.fileExists || rascunhoSemArquivo(b))
          ? Promise.resolve('')
          : bridge.call('readFile', { path: b.path }).then(function (d) { return d.content; }).catch(function () { return ''; });
        disco.then(function (texto) { desenhaDiff(vista, texto, b.content); });
      }

      var acoes = document.createElement('div');
      acoes.className = 'dialog-actions';
      function botao(rotulo, cls, fn) {
        var bt = document.createElement('button');
        bt.className = 'btn' + (cls ? ' ' + cls : '');
        bt.textContent = rotulo;
        bt.onclick = fn;
        acoes.appendChild(bt);
        return bt;
      }
      function fim(todas) {
        if (todas) lista.forEach(function (b) { b.escolha = todas; });
        overlay.hidden = true;
        box.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(lista);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim('depois'); }
      }
      botao(t('Descartar todos'), 'danger dialog-esquerda', function () { fim('descartar'); });
      botao(t('Decidir depois'), '', function () { fim('depois'); });
      var ok = botao(t('Aplicar'), 'primary', function () { fim(null); });
      box.appendChild(acoes);

      document.body.appendChild(box);
      overlay.hidden = false;
      overlay.onclick = function () { fim('depois'); };
      document.addEventListener('keydown', onKey, true);
      if (atual) mostra(atual[0], atual[1]);
      ok.focus();
    });
  }

  function aplicaRascunhos(lista) {
    app.rascunhosAdiados = app.rascunhosAdiados || {};
    var restaurar = [];
    var adiados = 0;
    lista.forEach(function (b) {
      if (b.escolha === 'descartar') bridge.call('dropBackup', { path: b.path }).catch(function () {});
      else if (b.escolha === 'depois') { app.rascunhosAdiados[b.path.toLowerCase()] = b; adiados++; }
      else restaurar.push(b);
    });
    if (adiados) toast(t('Rascunhos guardados para depois: voltam na próxima abertura ou pelo comando Rascunhos não salvos, na paleta.'), '', 5000);
    if (restaurar.length) return restoreBackups(restaurar);
  }

  /** Abriu um arquivo que tem rascunho adiado: pergunta so desse. */
  function ofereceRascunhoAdiado(tab) {
    var adiados = app.rascunhosAdiados;
    if (!adiados || !tab.path) return;
    var b = adiados[tab.path.toLowerCase()];
    if (!b) return;
    delete adiados[tab.path.toLowerCase()];
    setTimeout(function () { dialogoRascunhos([b]).then(aplicaRascunhos); }, 50);
  }

  function restoreBackups(lista) {
    var cadeia = Promise.resolve();

    lista.forEach(function (b) {
      cadeia = cadeia.then(function () {
        if (!b.fileExists) {
          // Arquivo sumiu do disco: vira aba sem caminho, para não gravar
          // por engano num lugar que o usuário já removeu.
          // Volta como NAO salva (antes voltava "salva": fechar perdia o texto
          // sem aviso) e com a mesma chave, para o rascunho seguir valendo.
          var solto = makeTab({ name: b.name, content: b.content });
          solto.savedContent = '';
          solto.rascunhoId = b.path;
          solto.locked = false;
          insereAba(solto);
          return;
        }
        var aberta = tabByPath(b.path);
        return (aberta ? Promise.resolve(aberta) : doOpenPath(b.path, {})).then(function (tab) {
          if (!tab) return;
          tab.content = b.content;
          tab.locked = false;
          if (rascunhoDiscoMudou(b)) {
            // O rascunho se apoia numa versao mais velha do disco: a aba fica
            // com a data dela, entao o Ctrl+S confere e pergunta, e o selo
            // mostra a diferenca para o que esta no disco agora.
            tab.discoVisto = tab.mtime;
            tab.mtime = b.baseMtime;
            tab.staleOnDisk = true;
            // O texto em que o rascunho se apoiou nao existe mais: o atalho
            // "so a data mudou" do Ctrl+S nao vale para esta aba.
            tab.baseIncerta = true;
          }
          invalidateLineStatus(tab);
        }).catch(function () {});
      });
    });

    return cadeia.then(function () {
      renderAll();
      toast(t('Texto restaurado. Salve com Ctrl+S para gravar no arquivo.'), 'warn', 6000);
    });
  }

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      settings.session = app.tabs.filter(function (t) { return t.path; }).map(function (t) { return t.path; });
      settings.sessionFixadas = app.tabs.filter(function (t) { return t.path && t.fixada; }).map(function (t) { return t.path; });
      settings.sessionCores = {};
      app.tabs.forEach(function (t) { if (t.path && t.cor) settings.sessionCores[t.path] = t.cor; });
      settings.lastFolder = app.folder;
      // A divisao volta na proxima abertura: quais caminhos moram na metade 2.
      settings.sessaoGrupo2 = dividido()
        ? app.tabs.filter(function (t) { return t.path && !t.espelhoDe && grupoDe(t) === 2; }).map(function (t) { return t.path; })
        : [];
      bridge.call('saveSettings', { json: JSON.stringify(settings) }).catch(function () {});
    }, 400);
  }

  function addRecent(path) {
    if (!path) return;
    settings.recent = [path].concat(
      (settings.recent || []).filter(function (p) { return p.toLowerCase() !== path.toLowerCase(); })
    ).slice(0, 25);
    renderRecent();
    persist();
  }

  // ============================================================= avisos

  function toast(message, kind, ms) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 220ms';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 240);
    }, ms || 2600);
  }

  /**
   * Dialogo modal com promessa. buttons: [{label, value, cls}]
   *
   * Com `checkboxLabel`, mostra uma caixa de marcar e resolve
   * `{ value, checked }` em vez do valor puro.
   */
  function dialog(title, message, buttons, checkboxLabel) {
    return new Promise(function (resolve) {
      var overlay = $('overlay');
      var box = document.createElement('div');
      box.className = 'dialog';

      var h = document.createElement('h2');
      h.textContent = title;
      var p = document.createElement('p');
      p.innerHTML = message; // texto nosso, nunca conteudo de arquivo
      var actions = document.createElement('div');
      actions.className = 'dialog-actions';

      var checkbox = null;

      function finish(value) {
        overlay.hidden = true;
        box.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(checkboxLabel ? { value: value, checked: !!(checkbox && checkbox.checked) } : value);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          finish(buttons[buttons.length - 1].value);
        }
      }

      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = 'btn' + (b.cls ? ' ' + b.cls : '');
        btn.textContent = b.label;
        btn.onclick = function () { finish(b.value); };
        actions.appendChild(btn);
      });

      box.appendChild(h);
      box.appendChild(p);

      if (checkboxLabel) {
        var linha = document.createElement('label');
        linha.className = 'dialog-check';
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        linha.appendChild(checkbox);
        linha.appendChild(document.createTextNode(checkboxLabel));
        box.appendChild(linha);
      }

      box.appendChild(actions);
      document.body.appendChild(box);
      overlay.hidden = false;
      overlay.onclick = function () { finish(null); };
      document.addEventListener('keydown', onKey, true);

      var last = actions.lastElementChild;
      if (last) last.focus();
    });
  }

  /**
   * Dialogo de uma linha de texto. Resolve com o texto ou null se cancelar.
   * opts: { value, placeholder, okLabel, selectTo, validate(texto) }
   *
   * Existe porque window.prompt no WebView2 e uma caixa do sistema, fora do
   * tema e fora do jeito — e porque renomear precisa validar antes de fechar.
   */
  function promptDialog(title, message, opts) {
    opts = opts || {};

    return new Promise(function (resolve) {
      var overlay = $('overlay');
      var box = document.createElement('div');
      box.className = 'dialog';

      var h = document.createElement('h2');
      h.textContent = title;

      var p = document.createElement('p');
      p.textContent = message || '';   // pode citar nome de arquivo: nunca innerHTML

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'dialog-input';
      input.value = opts.value || '';
      input.spellcheck = false;
      if (opts.placeholder) input.placeholder = opts.placeholder;

      var erro = document.createElement('p');
      erro.className = 'dialog-error';
      erro.hidden = true;

      var actions = document.createElement('div');
      actions.className = 'dialog-actions';

      function finish(value) {
        overlay.hidden = true;
        box.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      }

      function confirmar() {
        var texto = input.value.trim();
        var problema = opts.validate ? opts.validate(texto) : (texto ? null : t('Digite alguma coisa.'));
        if (problema) {
          erro.textContent = problema;
          erro.hidden = false;
          input.focus();
          return;
        }
        finish(texto);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmar(); }
      }

      var cancelar = document.createElement('button');
      cancelar.className = 'btn';
      cancelar.textContent = t('Cancelar');
      cancelar.onclick = function () { finish(null); };

      var ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = opts.okLabel || 'Confirmar';
      ok.onclick = confirmar;

      actions.appendChild(cancelar);
      actions.appendChild(ok);

      box.appendChild(h);
      if (message) box.appendChild(p);
      box.appendChild(input);
      box.appendChild(erro);
      box.appendChild(actions);
      document.body.appendChild(box);
      overlay.hidden = false;
      overlay.onclick = function () { finish(null); };
      document.addEventListener('keydown', onKey, true);

      input.focus();
      // Como no Explorer: a extensao fica fora da selecao inicial.
      var ate = typeof opts.selectTo === 'number' ? opts.selectTo : input.value.length;
      input.setSelectionRange(0, ate);
    });
  }

  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================== menus

  function showMenu(items, x, y) {
    var menu = $('menu');
    menu.textContent = '';

    // Os menus sao montados por pedacos condicionais, entao sobra separador
    // solto no meio ou na ponta. Limpar aqui vale para todos de uma vez.
    var limpos = [];
    items.forEach(function (item) {
      if (item === '-' && (!limpos.length || limpos[limpos.length - 1] === '-')) return;
      limpos.push(item);
    });
    while (limpos.length && limpos[limpos.length - 1] === '-') limpos.pop();
    items = limpos;

    items.forEach(function (item) {
      if (item === '-') {
        var sep = document.createElement('div');
        sep.className = 'menu-sep';
        menu.appendChild(sep);
        return;
      }
      if (item.label && item.header) {
        var lbl = document.createElement('div');
        lbl.className = 'menu-label';
        lbl.textContent = item.label;
        menu.appendChild(lbl);
        return;
      }
      // Fileira de amostras (cor da aba): um clique escolhe, sem submenu.
      if (item.cores) {
        var fileira = document.createElement('div');
        fileira.className = 'menu-cores';
        var rotulo = document.createElement('span');
        rotulo.className = 'menu-cores-rotulo';
        rotulo.textContent = item.label;
        fileira.appendChild(rotulo);
        item.cores.forEach(function (c) {
          var am = document.createElement('button');
          am.type = 'button';
          am.className = 'menu-cor' + (c.atual ? ' is-atual' : '') + (c.valor ? '' : ' sem-cor');
          if (c.valor) am.setAttribute('data-cor', String(c.valor));
          am.title = c.label;
          am.setAttribute('aria-label', c.label);
          am.onclick = function () { hideMenu(); item.escolhe(c.valor); };
          fileira.appendChild(am);
        });
        menu.appendChild(fileira);
        return;
      }

      var btn = document.createElement('button');
      btn.className = 'menu-item';
      if (item.disabled) btn.setAttribute('disabled', '');

      var ic = document.createElement('span');
      ic.className = 'menu-icon';
      if (item.icon) { var svg = window.MarkPadIcons.build(item.icon, 15); if (svg) ic.appendChild(svg); }
      btn.appendChild(ic);

      var txt = document.createElement('span');
      txt.textContent = item.label;
      btn.appendChild(txt);

      if (item.checked) {
        var ck = document.createElement('span');
        ck.className = 'menu-check';
        var cv = window.MarkPadIcons.build('check', 14);
        if (cv) ck.appendChild(cv);
        btn.appendChild(ck);
      } else if (item.key) {
        var k = document.createElement('span');
        k.className = 'menu-key';
        k.textContent = item.key;
        btn.appendChild(k);
      }

      if (!item.disabled) {
        btn.onclick = function () { hideMenu(); if (item.action) item.action(); };
      }
      menu.appendChild(btn);
    });

    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';

    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(6, left) + 'px';
    menu.style.top = Math.max(6, top) + 'px';
    menu.style.visibility = '';

    setTimeout(function () {
      document.addEventListener('mousedown', onDocDown, true);
    }, 0);
  }

  function onDocDown(e) {
    if ($('menu').contains(e.target)) return;
    hideMenu();
  }

  function hideMenu() {
    $('menu').hidden = true;
    document.removeEventListener('mousedown', onDocDown, true);
  }

  // ================================================== abrir / salvar arquivo

  function makeTab(data) {
    return {
      id: app.nextId++,
      path: data.path || null,
      name: data.name || t('sem titulo'),
      dir: data.dir || null,
      content: data.content || '',
      savedContent: data.content || '',
      // Como o arquivo estava ao ser aberto. É a referência das marcas verdes
      // (alteração já gravada) — sem ela só daria para saber o que falta salvar.
      originContent: data.content || '',
      encoding: data.encoding || 'utf-8',
      eol: data.eol || '\r\n',
      mtime: data.mtime || 0,
      readOnlyOnDisk: !!data.readOnlyOnDisk,
      locked: settings.lockOnOpen,
      showSource: !!settings.showSource,
      showPreview: !!settings.sideReader,
      scrollTop: 0,
      selStart: 0,
      selEnd: 0,
      staleOnDisk: false
    };
  }

  var BARRA = /[\\/]/;
  var SEPARADOR = /[\s\-_.,/\\()\[\]]/;

  var MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;

  /**
   * Abrir qualquer extensão é permitido — o app é um editor de texto, não só
   * de markdown. Mas avisa antes, porque abrir o arquivo errado por engano é
   * fácil e o resultado na tela não ajuda a perceber.
   */
  function confirmNonMarkdown(path) {
    if (!settings.warnNonMarkdown) return Promise.resolve(true);
    if (MARKDOWN_EXT.test(path) || /\.canvas$/i.test(path)) return Promise.resolve(true);

    var nome = path.split(/[\\/]/).pop();
    var ext = (/\.([^.\\/]+)$/.exec(nome) || [])[1];

    return dialog(
      t('Arquivo não identificado como markdown'),
      (ext
        ? t('<strong>{nome}</strong> tem extensão <code>.{ext}</code>, que não é markdown.',
            { nome: escapeText(nome), ext: escapeText(ext) })
        : t('<strong>{nome}</strong> não tem extensão.', { nome: escapeText(nome) })) +
      '<br><br>' + t('Ele será aberto como texto puro. Deseja mesmo abrir?'),
      [{ label: t('Não'), value: false }, { label: t('Sim'), value: true, cls: 'primary' }],
      t('Não exibir esta mensagem novamente')
    ).then(function (r) {
      if (r.checked) { settings.warnNonMarkdown = false; persist(); }
      return r.value;
    });
  }

  function openPath(path, opts) {
    opts = opts || {};
    var existing = tabByPath(path);
    if (existing) {
      selectTab(existing.id);
      if (opts.line) goToLine(opts.line);
      return Promise.resolve(existing);
    }

    return confirmNonMarkdown(path).then(function (ok) {
      if (!ok) return null;
      return doOpenPath(path, opts);
    });
  }

  function doOpenPath(path, opts) {
    return bridge.call('readFile', { path: path }).then(function (data) {
      var tab = makeTab(data);
      insereAba(tab);
      // A pasta entra ANTES da primeira pintura: quem desenha a leitura
      // (mencoes ligadas, wikilinks por indice) ja precisa saber onde esta.
      if (!app.folder && data.dir) setFolder(data.dir, true);
      selectTab(tab.id);
      bridge.call('watchFile', { path: data.path }).catch(function () {});
      addRecent(data.path);
      if (opts.line) goToLine(opts.line);
      ofereceRascunhoAdiado(tab);
      return tab;
    }).catch(function (err) {
      toast(t('Nao consegui abrir: ') + err.message, 'error', 5000);
      throw err;
    });
  }

  function openPaths(paths) {
    if (!paths || !paths.length) return Promise.resolve();
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return bridge.call('pathInfo', { path: p }).then(function (info) {
          if (info.kind === 'dir') { setFolder(info.path); return null; }
          if (info.kind === 'file') return openPath(info.path).catch(function () {});
          return null;
        });
      });
    });
    return chain;
  }

  function newTab() {
    var tab = makeTab({ name: t('sem titulo.md'), content: '' });
    tab.locked = false; // nota nova ja nasce editavel: e o unico caso obvio
    insereAba(tab);
    selectTab(tab.id);
    setTimeout(function () { if (ed) ed.foco(); }, 30);
  }

  /*
   * opts.forcar: grava sem conferir a data do disco (o usuario ja escolheu
   * gravar por cima). opts.ignoraTrava: a gravacao veio de uma escolha
   * explicita num dialogo (fechar e salvar, regravar), nao do Ctrl+S.
   */
  function saveTab(tab, saveAs, opts) {
    opts = opts || {};
    // Garante que o bloco em edicao ja esteja no documento antes de gravar.
    tab = tab || activeTab();
    if (!tab) return Promise.resolve(false);

    if (tab.locked && !saveAs && !opts.ignoraTrava) {
      toast(t('Documento travado — nada foi alterado.'), 'warn');
      return Promise.resolve(false);
    }

    var target = Promise.resolve(tab.path);
    if (!tab.path || saveAs) {
      target = bridge.call('saveAsDialog', {
        suggestedName: tab.name.replace(/[\\/:*?"<>|]/g, '-'),
        initialDir: tab.dir || app.folder || ''
      });
    }

    return target.then(function (path) {
      if (!path) return false;
      // Mesmo arquivo de onde a aba leu: o C# confere se outro programa
      // gravou depois (a data mudou) e devolve conflito em vez de gravar.
      var confere = !opts.forcar && !saveAs && tab.path && mesmoArquivo(path, tab.path) && tab.mtime;
      return bridge.call('writeFile', {
        path: path,
        content: tab.content,
        encoding: tab.encoding,
        eol: tab.eol,
        expectedMtime: confere ? tab.mtime : 0
      }).then(function (res) {
        if (res && res.conflict) return conflitoAoGravar(tab, opts);
        var renamed = tab.path !== res.path;
        tab.path = res.path;
        tab.name = res.path.split(/[\\/]/).pop();
        tab.dir = res.path.replace(/[\\/][^\\/]*$/, '');
        tab.savedContent = tab.content;
        tab.mtime = res.mtime;
        tab.discoVisto = res.mtime;
        tab.staleOnDisk = false;
        tab.suspeita = null;
        tab.apagadoNoDisco = false;
        tab.baseIncerta = false;
        invalidateLineStatus(tab);   // o que era laranja vira verde
        dropBackup(tab);
        invalidaLinks();   // os links desta nota mudaram no disco
        bridge.call('watchFile', { path: res.path }).catch(function () {});
        addRecent(res.path);
        if (renamed) arvoreMudou();
        renderTabs();
        renderHeader();
        renderViews();   // redesenha para as marcas laranjas virarem verdes
        renderStatus();
        toast(t('Salvo: ') + tab.name, 'ok', 1600);
        return true;
      });
    }).catch(function (err) {
      toast(t('Nao consegui salvar: ') + err.message, 'error', 6000);
      return false;
    });
  }

  function closeTab(id, force) {
    var idx = -1;
    for (var i = 0; i < app.tabs.length; i++) if (app.tabs[i].id === id) { idx = i; break; }
    if (idx === -1) return Promise.resolve(true);

    var tab = app.tabs[idx];
    // Fechar uma metade de uma nota aberta nas duas: o espelho herda tudo
    // (inclusive o que nao foi salvo) e nada e perguntado.
    if (!tab.espelhoDe && espelhosDe(tab).length) {
      promoveEspelhos(tab);
      app.tabs.splice(app.tabs.indexOf(tab), 1);
      depoisDeFechar(tab, idx);
      return Promise.resolve(true);
    }
    var dirty = tab.content !== tab.savedContent;
    // Apagado por fora (Notepad++): o texto so existe nesta aba, entao
    // fechar pergunta como se houvesse alteracao.
    var soNaAba = !dirty && tab.apagadoNoDisco && !!tab.content;

    var decide = ((dirty || soNaAba) && !force)
      ? dialog(soNaAba ? t('Arquivo apagado do disco') : t('Alteracoes nao salvas'),
          soNaAba
            ? t('<strong>{nome}</strong> foi apagado do disco por outro programa. O texto só existe nesta aba.',
              { nome: escapeText(tab.name) })
            : t('O arquivo <strong>{nome}</strong> tem mudancas que ainda nao foram gravadas.',
              { nome: escapeText(tab.name) }),
          [{ label: t('Descartar'), value: 'discard', cls: 'danger' },
           { label: t('Cancelar'), value: null },
           { label: t('Salvar'), value: 'save', cls: 'primary' }])
      : Promise.resolve('discard');

    return decide.then(function (choice) {
      if (choice === null) return false;
      var pre = choice === 'save' ? saveTab(tab, false, { ignoraTrava: true }) : Promise.resolve(true);
      return pre.then(function (ok) {
        if (!ok && choice === 'save') return false;

        if (tab.path) bridge.call('unwatchFile', { path: tab.path }).catch(function () {});
        dropBackup(tab);
        if (!tab.espelhoDe) guardaFechada(tab);
        app.tabs.splice(app.tabs.indexOf(tab), 1);
        if (tab.monitorar) ajustaRelogioMonitor();
        depoisDeFechar(tab, idx);
        return true;
      });
    });
  }

  /** Anota a aba na pilha do Ctrl+Shift+T. Aba em branco sem nome fica fora. */
  function guardaFechada(tab) {
    if (!tab.path && !tab.content) return;

    app.fechadas.push({
      path: tab.path, name: tab.name,
      content: tab.content, savedContent: tab.savedContent,
      originContent: tab.originContent,
      encoding: tab.encoding, eol: tab.eol,
      locked: tab.locked, showSource: tab.showSource, scrollTop: tab.scrollTop,
      historico: tab.historico, fixada: tab.fixada, cor: tab.cor
    });
    if (app.fechadas.length > 12) app.fechadas.shift();
  }

  /**
   * Reabre a ultima aba fechada. Com arquivo, le do disco de novo — quem
   * fechou descartando mudancas pediu justamente para descarta-las. Sem
   * arquivo, a nota volta do snapshot, que e a unica copia que sobrou dela.
   */
  function reabrirAba() {
    var snap = app.fechadas.pop();
    if (!snap) { toast(t('Nenhuma aba fechada para reabrir.'), 'warn'); return; }

    if (snap.path) {
      var jaAberta = tabByPath(snap.path);
      if (jaAberta) { selectTab(jaAberta.id); return; }

      doOpenPath(snap.path, {}).then(function (aberta) {
        if (!aberta) return;
        aberta.locked = snap.locked;
        aberta.showSource = snap.showSource;
        aberta.scrollTop = snap.scrollTop;
        // A aba volta com o historico de voltar/avancar e a fixacao dela.
        aberta.historico = snap.historico;
        aberta.fixada = snap.fixada;
        aberta.cor = snap.cor;
        renderAll();
      }).catch(function () {});
      return;
    }

    var tab = makeTab({ name: snap.name, content: snap.content, encoding: snap.encoding, eol: snap.eol });
    tab.savedContent = snap.savedContent;
    tab.originContent = snap.originContent;
    tab.locked = snap.locked;
    tab.showSource = snap.showSource;
    insereAba(tab);
    selectTab(tab.id);
  }

  // ================================================== janela: modos de tela

  function alternaTelaInteira() {
    bridge.call('toggleFullScreen', {}).then(function (ligada) {
      app.telaInteira = !!ligada;
      if (ligada) toast(t('Tela inteira. F11 para sair.'), '', 1800);
    }).catch(function () {});
  }

  // ------------------------------------------------------------ apresentacao
  //
  // O "Slides" do Obsidian: a nota vira apresentacao em tela inteira, um
  // slide por trecho separado por --- (fora de bloco de codigo; o --- das
  // propriedades nao conta). Setas, PageUp/PageDown, espaco e clique andam;
  // Esc sai.

  function slidesDe(texto) {
    var fm = window.MarkPadMarkdown.extractFrontmatter(String(texto || ''));
    var linhas = fm.body.replace(/\r\n?/g, '\n').split('\n');
    var slides = [[]], cerca = null;
    linhas.forEach(function (l) {
      var c = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (c) { if (!cerca) cerca = c[1].charAt(0); else if (l.trim().charAt(0) === cerca) cerca = null; }
      if (!cerca && /^\s{0,3}---+\s*$/.test(l)) { slides.push([]); return; }
      slides[slides.length - 1].push(l);
    });
    return slides.map(function (s) { return s.join('\n').trim(); }).filter(function (s) { return s.length; });
  }

  function iniciaApresentacao() {
    var tab = activeTab();
    if (!tab) return;
    var slides = slidesDe(tab.content);
    if (!slides.length) { toast(t('A nota esta vazia.'), 'warn', 1800); return; }
    var atual = 0;
    var entrouTelaInteira = !app.telaInteira;
    var caixa = document.createElement('div');
    caixa.className = 'apresentacao';
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-label', t('Apresentacao'));
    var palco = document.createElement('div');
    palco.className = 'apresentacao-slide markdown-preview';
    var conta = document.createElement('div');
    conta.className = 'apresentacao-conta';
    caixa.appendChild(palco);
    caixa.appendChild(conta);
    document.body.appendChild(caixa);

    function mostra(i) {
      atual = Math.max(0, Math.min(slides.length - 1, i));
      palco.textContent = '';
      renderTrecho(palco, slides[atual], 'slide', tab);
      conta.textContent = (atual + 1) + ' / ' + slides.length;
    }
    function sai() {
      document.removeEventListener('keydown', tecla, true);
      if (caixa.parentNode) caixa.parentNode.removeChild(caixa);
      if (entrouTelaInteira && app.telaInteira) alternaTelaInteira();
    }
    function tecla(e) {
      var k = e.key;
      if (k === 'Escape') sai();
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') mostra(atual + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') mostra(atual - 1);
      else if (k === 'Home') mostra(0);
      else if (k === 'End') mostra(slides.length - 1);
      else if (k === 'F11') return;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    caixa.addEventListener('click', function (e) {
      if (e.target.closest('a,button,input,video,audio')) return;
      mostra(e.clientX > window.innerWidth / 3 ? atual + 1 : atual - 1);
    });
    document.addEventListener('keydown', tecla, true);
    if (entrouTelaInteira) alternaTelaInteira();
    mostra(0);
  }

  function alternaSempreNoTopo() {
    bridge.call('setTopmost', { on: !app.sempreNoTopo }).then(function (ligado) {
      app.sempreNoTopo = !!ligado;
      toast(ligado ? t('Sempre no topo: ligado.') : t('Sempre no topo: desligado.'), 'ok', 1500);
    }).catch(function () {});
  }

  // ==================================================== abas: ordem e fixacao
  //
  // Aba fixada mora no comeco da faixa (como no Notepad++), mostra um alfinete
  // no lugar do X, nao e trocada quando se segue um link e "fechar as outras"
  // passa por cima dela (como no Obsidian). Aba nova entra logo depois da
  // ativa, e nunca no meio das fixadas.

  function quantasFixadas() {
    var n = 0;
    app.tabs.forEach(function (t) { if (t.fixada) n++; });
    return n;
  }

  function insereAba(tab) {
    if (!tab.grupo) tab.grupo = dividido() ? app.grupoAtivo : 1;
    var ativa = activeTab();
    var idx = ativa ? app.tabs.indexOf(ativa) + 1 : app.tabs.length;
    if (idx <= 0) idx = app.tabs.length;
    app.tabs.splice(Math.max(idx, quantasFixadas()), 0, tab);
  }

  function alternaFixacao(tab) {
    var idx = app.tabs.indexOf(tab);
    if (idx === -1) return;
    app.tabs.splice(idx, 1);
    tab.fixada = !tab.fixada;
    // Fixada vai para o fim do bloco das fixadas; solta, para logo depois dele.
    app.tabs.splice(quantasFixadas(), 0, tab);
    renderTabs();
    persist();
  }

  /** Leva a aba para a posicao final `para`, sem cruzar a fronteira das fixadas. */
  function moveAba(tab, para) {
    var de = app.tabs.indexOf(tab);
    if (de === -1) return;
    var n = quantasFixadas();
    var min = tab.fixada ? 0 : n;
    var max = tab.fixada ? n - 1 : app.tabs.length - 1;
    para = Math.max(min, Math.min(max, para));
    if (para === de) return;
    app.tabs.splice(de, 1);
    app.tabs.splice(para, 0, tab);
    renderTabs();
    persist();
  }

  /** Fecha as abas da lista, uma a uma (cada uma pode perguntar sobre salvar). */
  function fechaAbas(lista) {
    var cadeia = Promise.resolve(true);
    lista.forEach(function (t) {
      cadeia = cadeia.then(function (seguir) { return seguir === false ? false : closeTab(t.id); });
    });
    return cadeia;
  }

  /** Abre outro MarkPad com estes caminhos (arquivo ou pasta). Promessa de true se abriu. */
  function novaJanela(caminhos, solto) {
    var args = { paths: caminhos || [] };
    if (solto && solto.x && solto.y) { args.x = solto.x; args.y = solto.y; }
    return bridge.call('newWindow', args).then(function () {
      toast(t('Abrindo outra janela...'), 'ok', 1400);
      return true;
    }).catch(function (err) {
      toast(t('Não deu para abrir outra janela: ') + (err && err.message || err), 'error', 4000);
      return false;
    });
  }

  /** Leva a aba para uma janela nova (outra instancia, que edita e salva). */
  function destacaAba(tab, x, y) {
    if (!tab) return;
    if (tab.espelhoDe) tab = tabById(tab.espelhoDe) || tab;
    if (!tab.path) { toast(t('Salve a nota antes de levá-la para outra janela.'), 'warn', 3000); return; }
    if (tab.content !== tab.savedContent) { toast(t('Salve as alterações antes de levar a aba para outra janela.'), 'warn', 3000); return; }
    novaJanela([tab.path], { x: x, y: y }).then(function (ok) { if (ok) closeTab(tab.id); });
  }

  function restauraFixadas() {
    (settings.sessionFixadas || []).forEach(function (p) {
      var aba = tabByPath(p);
      if (aba && !aba.fixada) alternaFixacao(aba);
    });
    var cores = settings.sessionCores || {};
    Object.keys(cores).forEach(function (p) {
      var aba = tabByPath(p);
      if (aba && cores[p] >= 1 && cores[p] <= 5) aba.cor = cores[p];
    });
    renderTabs();
  }

  /*
   * Cor da aba, do Notepad++: cinco cores e "sem cor", por documento, guardada
   * na sessao. As cores sao as da paleta (--color-*), entao acompanham o tema.
   */
  function nomeDaCor(n) {
    switch (n) {
      case 1: return t('Amarelo');
      case 2: return t('Verde');
      case 3: return t('Azul');
      case 4: return t('Laranja');
      case 5: return t('Roxo');
    }
    return t('Sem cor');
  }

  function pintaAba(tab, cor) {
    tab.cor = cor || 0;
    renderTabs();
    persist();
  }

  var arrastoAba = null;

  function limpaMarcasDeArrasto() {
    var marcadas = $('tabList').querySelectorAll('.drop-antes, .drop-depois, .is-dragging');
    for (var i = 0; i < marcadas.length; i++) marcadas[i].classList.remove('drop-antes', 'drop-depois', 'is-dragging');
  }

  // ======================================================= voltar e avancar
  //
  // Seguir um link troca o documento DA PROPRIA ABA e guarda onde se estava,
  // como no navegador e no Obsidian. Antes todo link abria aba nova e nao
  // havia como voltar. Ctrl+clique ou botao do meio abrem em aba nova.
  // Seguranca: nota com alteracao nao salva nunca e trocada (o destino abre em
  // aba nova), aba fixada tambem nao, e se o destino ja esta aberto em outra
  // aba vai para ela, em vez de o mesmo arquivo ficar aberto duas vezes.

  var MAX_HISTORICO = 60;

  function historicoDe(tab) {
    if (!tab.historico) tab.historico = { voltar: [], avancar: [] };
    return tab.historico;
  }

  function mesmoArquivo(a, b) {
    return !!a && !!b && a.toLowerCase() === b.toLowerCase();
  }

  /** Onde a aba esta agora: arquivo e rolagem da vista visivel. */
  function fotoDaAba(tab) {
    var ativa = activeTab() === tab;
    var lendo = !ativa || !$('readingView').hidden;
    var rolagem = ativa
      ? (lendo ? $('readingScroll').scrollTop : (ed ? ed.rolagem() : 0))
      : (tab.scrollTop || 0);
    return { path: tab.path, name: tab.name, rolagem: rolagem };
  }

  function empilha(pilha, foto) {
    pilha.push(foto);
    if (pilha.length > MAX_HISTORICO) pilha.shift();
  }

  function aplicaRolagem(foto) {
    // Depois da pintura: antes dela o documento ainda nao tem altura.
    setTimeout(function () {
      var px = (foto && foto.rolagem) || 0;
      if ($('readingView').hidden) { if (ed) ed.rolagem(px); }
      else $('readingScroll').scrollTop = px;
    }, 0);
  }

  /** Antes de um salto dentro do mesmo documento: o Voltar volta para ca. */
  function registraPosicao(tab) {
    if (!tab || !tab.path) return;
    var h = historicoDe(tab);
    empilha(h.voltar, fotoDaAba(tab));
    h.avancar.length = 0;
    renderNavegacao();
  }

  /** Linha (0-based) do titulo ou do ^bloco no texto da aba; -1 se nao achou. */
  function linhaDaSecao(tab, secao) {
    if (!tab || !secao) return -1;
    var linhas = tab.content.split('\n');
    if (secao.charAt(0) === '^') {
      var id = secao.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(^|\\s)\\^' + id + '\\s*$');
      for (var i = 0; i < linhas.length; i++) if (re.test(linhas[i])) return i;
      return -1;
    }
    var slug = window.MarkPadMarkdown.slugify(secao);
    var r;
    try { r = window.MarkPadMarkdown.render(tab.content, { lineMap: true }); } catch (e) { return -1; }
    for (var j = 0; j < r.toc.length; j++) {
      if (r.toc[j].slug === secao || r.toc[j].slug === slug || r.toc[j].text === secao) return r.toc[j].line;
    }
    return -1;
  }

  function saltaParaSecao(secao) {
    if (!secao) return;
    setTimeout(function () {
      var abaS = activeTab();
      if (abaS && !abaS.locked && ed && ed.aba === abaS) {
        var ln = linhaDaSecao(abaS, secao);
        if (ln >= 0) ed.vaiParaLinha(ln);
        return;
      }
      var id = secao.charAt(0) === '^' ? secao.slice(1) : window.MarkPadMarkdown.slugify(secao);
      var alvo = id && $('preview').querySelector('#' + CSS.escape(id));
      if (alvo) { alvo.scrollIntoView({ block: 'start' }); piscaAlvo(alvo); }
    }, 30);
  }

  /** Troca o documento da aba, mantendo a identidade, o historico e a fixacao. */
  function carregaNaAba(tab, path) {
    return bridge.call('readFile', { path: path }).then(function (data) {
      var idx = app.tabs.indexOf(tab);
      if (idx === -1) return null;
      var novo = makeTab(data);
      novo.id = tab.id;
      novo.historico = historicoDe(tab);
      novo.fixada = tab.fixada;
      novo.cor = tab.cor;
      novo.grupo = tab.grupo;
      // A aba saiu da nota: o espelho dela na outra metade vira a propria nota.
      promoveEspelhos(tab);
      app.tabs[idx] = novo;
      if (tab.path && !mesmoArquivo(tab.path, data.path)) {
        bridge.call('unwatchFile', { path: tab.path }).catch(function () {});
      }
      bridge.call('watchFile', { path: data.path }).catch(function () {});
      if (!app.folder && data.dir) setFolder(data.dir, true);
      addRecent(data.path);
      app.find.index = 0;
      renderAll();
      persist();
      return novo;
    });
  }

  /**
   * Abre o destino de um link do documento. `nav`: { origem: a aba de onde se
   * clicou, novaAba: Ctrl ou botao do meio, secao: 'Secao' ou '^bloco' }.
   * Sem `nav` (previa ao pairar, busca) e o openPath de sempre.
   */
  function abreDestino(path, nav) {
    nav = nav || {};
    if (nav.outroGrupo) return abreNoOutroGrupo(path, nav.secao);
    var origem = nav.origem && app.tabs.indexOf(nav.origem) !== -1 ? nav.origem : null;
    var jaAberta = tabByPath(path);

    if (origem && jaAberta === origem) {
      if (nav.secao) { registraPosicao(origem); saltaParaSecao(nav.secao); }
      return Promise.resolve(origem);
    }
    if (jaAberta) {
      selectTab(jaAberta.id);
      saltaParaSecao(nav.secao);
      return Promise.resolve(jaAberta);
    }

    var sujo = origem && origem.content !== origem.savedContent;
    if (!origem || nav.novaAba || origem.fixada || !origem.path || sujo) {
      return openPath(path).then(function (aba) { saltaParaSecao(nav.secao); return aba; });
    }

    var foto = fotoDaAba(origem);
    return confirmNonMarkdown(path).then(function (ok) {
      if (!ok) return null;
      return carregaNaAba(origem, path).then(function (novo) {
        if (!novo) return null;
        var h = historicoDe(novo);
        empilha(h.voltar, foto);
        h.avancar.length = 0;
        renderNavegacao();
        if (nav.secao) saltaParaSecao(nav.secao); else aplicaRolagem(null);
        return novo;
      });
    }).catch(function (err) {
      toast(t('Nao consegui abrir: ') + (err && err.message ? err.message : path), 'error', 5000);
      return null;
    });
  }

  /** Volta (passo -1) ou avanca (+1) `n` entradas do historico da aba ativa. */
  function navega(passo, n) {
    var tab = activeTab();
    if (!tab) return;
    n = Math.max(1, n || 1);
    var h = historicoDe(tab);
    var de = passo < 0 ? h.voltar : h.avancar;
    var para = passo < 0 ? h.avancar : h.voltar;
    if (de.length < n) return;

    var alvo = de[de.length - n];
    var aqui = fotoDaAba(tab);
    // As entradas puladas vao para a outra pilha na ordem em que se passaria
    // por elas uma a uma: quem esta mais perto do destino fica no topo.
    var meio = de.slice(de.length - n + 1).reverse();
    function confirma() {
      de.length = de.length - n;
      empilha(para, aqui);
      meio.forEach(function (f) { empilha(para, f); });
      renderNavegacao();
    }

    if (mesmoArquivo(alvo.path, tab.path)) { confirma(); aplicaRolagem(alvo); return; }
    if (tab.content !== tab.savedContent) {
      toast(t('Salve ou descarte as alterações antes de sair desta nota.'), 'warn', 3500);
      return;
    }
    var outra = tabByPath(alvo.path);
    if (outra) {
      toast(t('Essa nota já está aberta em outra aba.'), '', 2500);
      selectTab(outra.id);
      return;
    }
    carregaNaAba(tab, alvo.path).then(function (novo) {
      if (!novo) return;
      confirma();
      aplicaRolagem(alvo);
    }).catch(function () {
      toast(t('A nota não existe mais: ') + (alvo.name || alvo.path), 'warn', 3500);
    });
  }

  function renderNavegacao() {
    var tab = activeTab();
    var h = tab && tab.historico;
    var voltar = $('btnVoltar'), avancar = $('btnAvancar');
    if (!voltar || !avancar) return;
    voltar.disabled = !(h && h.voltar.length);
    avancar.disabled = !(h && h.avancar.length);
  }

  /** Clique direito em Voltar/Avancar: a lista, do mais perto ao mais longe. */
  function menuHistorico(passo, ev) {
    ev.preventDefault();
    var tab = activeTab();
    var h = tab && tab.historico;
    if (!h) return;
    var pilha = passo < 0 ? h.voltar : h.avancar;
    if (!pilha.length) return;
    var itens = [];
    for (var i = pilha.length - 1, n = 1; i >= 0 && n <= 15; i--, n++) {
      (function (passos, foto) {
        itens.push({ label: foto.name || foto.path, action: function () { navega(passo, passos); } });
      })(n, pilha[i]);
    }
    showMenu(itens, ev.clientX, ev.clientY);
  }

  function selectTab(id) {
    var current = activeTab();
    // Espelho (a mesma nota na outra metade) nunca fica com a visao viva:
    // escolher o espelho troca de lugar com o original, e quem edita passa a
    // ser a metade em que se clicou.
    var escolhida = tabById(id);
    if (escolhida && escolhida.espelhoDe) {
      var original = tabById(escolhida.espelhoDe);
      if (original) { trocaEspelho(escolhida, original); id = original.id; escolhida = original; }
      else escolhida.espelhoDe = null;
    }
    if (current && current.id !== id) stashScroll(current);
    if (current && current.id !== id && $('readingScroll')) stashReadingScroll(current);
    if (escolhida) {
      var gid = grupoDe(escolhida);
      var g = grupoPorId(gid);
      if (g) g.ativa = id;
      app.grupoAtivo = gid;
    }

    app.activeId = id;
    app.usoAbas = [id].concat((app.usoAbas || []).filter(function (x) { return x !== id; }));
    app.find.index = 0;
    renderAll();

    var tab = activeTab();
    if (tab && !tab.locked) restoreScroll(tab);
    if (tab && current !== tab) confereDisco([tab]);
    persist();
  }

  /*
   * Ctrl+Tab pela ordem de uso, como no Notepad++ e no VS Code: um toque
   * alterna entre as duas ultimas abas; com o Ctrl seguro, cada Tab desce na
   * lista (Shift sobe) e soltar o Ctrl abre a escolhida. A lista so aparece
   * a partir do segundo Tab — o toque rapido nao pisca nada na tela.
   */
  function trocaPorUso(passo) {
    var vivas = app.tabs.map(function (t) { return t.id; });
    var ordem = (app.usoAbas || []).filter(function (id) { return vivas.indexOf(id) >= 0; });
    vivas.forEach(function (id) { if (ordem.indexOf(id) < 0) ordem.push(id); });
    if (ordem.length < 2) return;

    if (!app.trocaUso) app.trocaUso = { ordem: ordem, pos: 0, toques: 0, el: null };
    var tu = app.trocaUso;
    tu.pos = (tu.pos + passo + tu.ordem.length) % tu.ordem.length;
    tu.toques++;
    if (tu.toques > 1 || tu.el) desenhaTrocaUso();
  }

  function desenhaTrocaUso() {
    var tu = app.trocaUso;
    if (!tu.el) {
      tu.el = document.createElement('div');
      tu.el.className = 'palette troca-uso';
      tu.el.setAttribute('role', 'listbox');
      document.body.appendChild(tu.el);
    }
    tu.el.textContent = '';
    var lista = document.createElement('div');
    lista.className = 'palette-list';
    tu.ordem.forEach(function (id, i) {
      var tab = tabById(id);
      if (!tab) return;
      var el = document.createElement('div');
      el.className = 'palette-item' + (i === tu.pos ? ' is-active' : '');
      if (tab.cor) el.setAttribute('data-cor', String(tab.cor));
      var nome = document.createElement('span');
      nome.textContent = tab.name;
      el.appendChild(nome);
      // a pasta relativa a aberta; na raiz dela, nada
      var rel = relNaPasta(tab.path || '');
      var pasta = rel.indexOf('/') >= 0 ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (pasta) {
        var sub = document.createElement('span');
        sub.className = 'pal-sub';
        sub.textContent = pasta;
        el.appendChild(sub);
      }
      if (tab.content !== tab.savedContent) {
        var sujo = document.createElement('span');
        sujo.className = 'dirty-dot';
        el.appendChild(sujo);
      }
      el.onmousedown = function (e) { e.preventDefault(); tu.pos = i; concluiTrocaUso(); };
      lista.appendChild(el);
    });
    tu.el.appendChild(lista);
    var ativo = lista.children[tu.pos];
    if (ativo) ativo.scrollIntoView({ block: 'nearest' });
  }

  function concluiTrocaUso(cancelar) {
    var tu = app.trocaUso;
    if (!tu) return;
    app.trocaUso = null;
    if (tu.el && tu.el.parentNode) tu.el.parentNode.removeChild(tu.el);
    if (!cancelar && tabById(tu.ordem[tu.pos])) selectTab(tu.ordem[tu.pos]);
  }

  function tabById(id) {
    for (var i = 0; i < app.tabs.length; i++) if (app.tabs[i].id === id) return app.tabs[i];
    return null;
  }

  function stashScroll(tab) {
    if (tab.locked) {
      tab.scrollTop = $('readingScroll').scrollTop;
    } else if (ed && ed.aba === tab) {
      tab.scrollTop = ed.rolagem();
      var s = ed.selecao();
      tab.selStart = s.inicio;
      tab.selEnd = s.fim;
      tab.cmEstado = ed.estado();
    }
  }

  function restoreScroll(tab) {
    if (!ed || ed.aba !== tab) return;
    var px = tab.scrollTop || 0;
    ed.rolagem(px);
    // O editor so mede depois de aparecer: repete no quadro seguinte.
    requestAnimationFrame(function () { if (ed.aba === tab) ed.rolagem(px); });
  }

  /** Linha (0-based) do primeiro bloco visivel no topo da leitura; -1 sem leitura. */
  function linhaNoTopoDaLeitura() {
    var sc = $('readingScroll');
    if (!sc || $('readingView').hidden) return -1;
    var topo = sc.getBoundingClientRect().top;
    var els = $('preview').querySelectorAll('[data-line]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().bottom > topo + 2) return parseInt(els[i].getAttribute('data-line'), 10) || 0;
    }
    return -1;
  }

  /** Rola a leitura ate o bloco que contem a linha n (0-based). */
  function rolaLeituraParaLinha(n) {
    var els = $('preview').querySelectorAll('[data-line]');
    var melhor = null, melhorLinha = -1;
    for (var i = 0; i < els.length; i++) {
      var l = parseInt(els[i].getAttribute('data-line'), 10);
      if (l <= n && l >= melhorLinha) { melhor = els[i]; melhorLinha = l; }
    }
    if (!melhor) return;
    var sc = $('readingScroll');
    sc.scrollTop += melhor.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
  }

  // ===================================================== mudanca no disco
  //
  // Arquivo alterado por fora, como no Notepad++ (estudo 03 §1.5). O vigia do
  // C# avisa na hora; ao voltar o foco da janela e ao trocar de aba a pagina
  // confere data e tamanho de novo, porque o vigia perde evento em pasta de
  // rede e no arquivo virtual do ownCloud. Regras:
  //  - aba sem edicao recarrega sozinha, MENOS quando a mudanca parece corte
  //    (data que volta no tempo, bytes zero, fim sumido no meio da linha,
  //    arquivo vazio ou ilegivel): ai nada e trocado e o aviso e forte;
  //  - aba com edicao nunca e trocada sem perguntar: ganha o selo e a escolha
  //    entre a versao do disco e a minha, vendo a diferenca;
  //  - o Ctrl+S manda a data que a aba conhece e o C# recusa se o disco mudou.

  /** Motivo de desconfiar da versao nova do disco, ou null. */
  function suspeitaDoDisco(tab, disco) {
    if (disco.erro) return 'ilegivel';
    var antes = tab.savedContent || '';
    var novo = disco.content || '';
    if (novo.indexOf('\u0000') !== -1) return 'zeros';
    if (antes && !novo) return 'vazio';
    if (tab.mtime && disco.mtime && disco.mtime < tab.mtime) return 'antiga';
    // Fim cortado no meio de uma linha: o texto novo e o comeco do antigo e o
    // corte nao caiu numa quebra de linha. Apagar as ultimas linhas num editor
    // cai numa quebra, e isso nao e suspeito.
    if (novo.length < antes.length && antes.lastIndexOf(novo, 0) === 0 &&
        novo.charAt(novo.length - 1) !== '\n' && antes.charAt(novo.length) !== '\n') return 'cortado';
    return null;
  }

  function textoDaSuspeita(motivo, erro) {
    switch (motivo) {
      case 'ilegivel': return t('O arquivo no disco ficou ilegível: {erro}.', { erro: erro || '' });
      case 'zeros': return t('O arquivo no disco tem bytes zero no lugar do texto.');
      case 'vazio': return t('O arquivo no disco ficou vazio.');
      case 'antiga': return t('A data do arquivo no disco voltou para trás: a sincronização pode ter devolvido uma versão antiga.');
      case 'cortado': return t('O arquivo no disco agora termina no meio de uma linha, antes do fim que estava aberto.');
    }
    return '';
  }

  /** Le o disco sem estourar: erro vira { erro }, depois de uma segunda tentativa. */
  function leDisco(path) {
    function tenta() { return bridge.call('readFile', { path: path }); }
    return tenta().catch(function () {
      return new Promise(function (r) { setTimeout(r, 500); }).then(tenta);
    }).catch(function (err) { return { erro: (err && err.message) || String(err) }; });
  }

  /** "Usar a do disco": o texto do disco passa a ser o da aba. */
  function aplicaDoDisco(tab, disco) {
    tab.content = disco.content;
    tab.savedContent = disco.content;
    tab.originContent = disco.content;   // recarregar zera o historico da sessao
    if (disco.encoding) tab.encoding = disco.encoding;
    if (disco.eol) tab.eol = disco.eol;
    tab.mtime = disco.mtime;
    tab.discoVisto = disco.mtime;
    tab.readOnlyOnDisk = !!disco.readOnlyOnDisk;
    tab.staleOnDisk = false;
    tab.suspeita = null;
    tab.apagadoNoDisco = false;
    tab.baseIncerta = false;
    invalidateLineStatus(tab);
    dropBackup(tab);
    renderAll();
  }

  /** "Manter a minha": o disco vira a referencia e o texto da aba fica pendente. */
  function mantemAMinha(tab, disco) {
    // Disco ilegivel: nao ha referencia, entao tudo conta como nao salvo.
    tab.savedContent = disco.erro ? '' : disco.content;
    if (!disco.erro) { tab.mtime = disco.mtime; tab.discoVisto = disco.mtime; }
    tab.staleOnDisk = false;
    tab.suspeita = null;
    tab.baseIncerta = false;
    invalidateLineStatus(tab);
    scheduleBackup(tab);
    renderAll();
  }

  /**
   * A escolha entre o texto da aba e o do disco, com a diferenca na tela.
   * modo: 'mudou' (aba com edicao), 'gravar' (o Ctrl+S achou o disco mudado)
   * ou 'suspeito' (parece corte). Resolve 'disco', 'minha', 'regravar',
   * 'sobrescrever' ou null.
   */
  function dialogoDisco(tab, disco, modo) {
    return new Promise(function (resolve) {
      var overlay = $('overlay');
      var box = document.createElement('div');
      box.className = 'dialog versoes disco-escolha' + (modo === 'suspeito' ? ' is-suspeito' : '');
      box.setAttribute('role', 'alertdialog');

      var h = document.createElement('h2');
      var p = document.createElement('p');
      var botoes;
      if (modo === 'suspeito') {
        h.textContent = t('{nome} parece ter sido cortado no disco', { nome: tab.name });
        p.textContent = textoDaSuspeita(tab.suspeita, disco.erro) + ' ' +
          t('O MarkPad não trocou nada: o texto aberto aqui está inteiro. Regravar põe ele de volta no disco, e a versão do disco fica no histórico de versões.');
        botoes = [[t('Usar a do disco'), 'disco', ''], [t('Manter sem gravar'), 'minha', ''], [t('Regravar a minha'), 'regravar', 'primary']];
      } else if (modo === 'gravar') {
        h.textContent = t('{nome} mudou no disco', { nome: tab.name });
        p.textContent = t('Outro programa gravou este arquivo depois que você o abriu. Gravar agora substitui essa versão, que fica no histórico de versões. Abaixo, o que muda se usar a versão do disco.');
        botoes = [[t('Cancelar'), null, ''], [t('Usar a do disco'), 'disco', ''], [t('Gravar a minha por cima'), 'sobrescrever', 'primary']];
      } else {
        h.textContent = t('{nome} mudou no disco', { nome: tab.name });
        p.textContent = t('Outro programa gravou este arquivo enquanto você editava. Escolha qual texto fica. Abaixo, o que muda se usar a versão do disco.');
        botoes = [[t('Cancelar'), null, ''], [t('Usar a do disco'), 'disco', 'danger'], [t('Manter a minha'), 'minha', 'primary']];
      }
      box.appendChild(h);
      box.appendChild(p);

      if (!disco.erro) {
        var vista = document.createElement('div');
        vista.className = 'versoes-diff disco-diff';
        desenhaDiff(vista, tab.content, disco.content);
        box.appendChild(vista);
      }

      var acoes = document.createElement('div');
      acoes.className = 'dialog-actions';
      var copiar = document.createElement('button');
      copiar.className = 'btn dialog-esquerda';
      copiar.textContent = t('Copiar a minha');
      copiar.onclick = function () {
        navigator.clipboard.writeText(tab.content);
        toast(t('Texto da aba copiado.'), 'ok', 1600);
      };
      acoes.appendChild(copiar);
      var principal = null;
      botoes.forEach(function (b) {
        var bt = document.createElement('button');
        bt.className = 'btn' + (b[2] ? ' ' + b[2] : '');
        bt.textContent = b[0];
        if (b[1] === 'disco' && disco.erro) bt.disabled = true;
        bt.onclick = function () { fim(b[1]); };
        acoes.appendChild(bt);
        if (b[2] === 'primary') principal = bt;
      });
      box.appendChild(acoes);

      // Fechar sem escolher nunca troca nada: na suspeita vale "manter".
      var neutro = modo === 'suspeito' ? 'minha' : null;
      function fim(v) {
        overlay.hidden = true;
        box.remove();
        document.removeEventListener('keydown', onKey, true);
        app.dialogoDisco = null;
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(neutro); }
      }

      app.dialogoDisco = box;
      document.body.appendChild(box);
      overlay.hidden = false;
      overlay.onclick = function () { fim(neutro); };
      document.addEventListener('keydown', onKey, true);
      if (principal) principal.focus();
    });
  }

  /** O selo, o "Recarregar" com edicao ou a suspeita: mostra e aplica a escolha. */
  function resolveDisco(tab, modo, discoLido) {
    if (!tab || !tab.path || app.dialogoDisco) return Promise.resolve();
    return (discoLido ? Promise.resolve(discoLido) : leDisco(tab.path)).then(function (disco) {
      if (app.tabs.indexOf(tab) === -1) return;
      if (disco.erro && tab.apagadoNoDisco) return;
      if (!modo) modo = tab.suspeita || disco.erro ? 'suspeito' : 'mudou';
      if (modo === 'suspeito' && !tab.suspeita) tab.suspeita = suspeitaDoDisco(tab, disco) || 'ilegivel';
      return dialogoDisco(tab, disco, modo).then(function (escolha) {
        if (escolha === 'disco' && !disco.erro) {
          aplicaDoDisco(tab, disco);
          toast(t('Recarregado do disco.'), 'ok', 1500);
        } else if (escolha === 'minha') {
          mantemAMinha(tab, disco);
        } else if (escolha === 'regravar') {
          mantemAMinha(tab, disco);
          return saveTab(tab, false, { forcar: true, ignoraTrava: true });
        } else if (escolha === 'sobrescrever') {
          return saveTab(tab, false, { forcar: true });
        }
      });
    });
  }

  /** O Ctrl+S achou o disco mudado (o C# recusou gravar). */
  function conflitoAoGravar(tab, opts) {
    return leDisco(tab.path).then(function (disco) {
      // So a data mudou (a sincronizacao tocou o arquivo): grava sem perguntar.
      if (!disco.erro && disco.content === tab.savedContent && !tab.baseIncerta) {
        tab.mtime = disco.mtime;
        return saveTab(tab, false, { forcar: true, ignoraTrava: opts && opts.ignoraTrava });
      }
      return dialogoDisco(tab, disco, 'gravar').then(function (escolha) {
        if (escolha === 'sobrescrever') return saveTab(tab, false, { forcar: true, ignoraTrava: opts && opts.ignoraTrava });
        if (escolha === 'disco' && !disco.erro) {
          aplicaDoDisco(tab, disco);
          toast(t('Recarregado do disco.'), 'ok', 1500);
        }
        return false;
      });
    });
  }

  function reloadFromDisk(tab) {
    tab = tab || activeTab();
    if (!tab || !tab.path) return;

    // Com edicao (ou suspeita) nunca recarrega calado: antes o selo e o menu
    // jogavam fora o que se tinha editado sem perguntar.
    if (tab.content !== tab.savedContent || tab.suspeita) { resolveDisco(tab); return; }

    leDisco(tab.path).then(function (disco) {
      if (disco.erro) { toast(t('Falha ao recarregar: ') + disco.erro, 'error'); return; }
      aplicaDoDisco(tab, disco);
      toast(t('Recarregado do disco.'), 'ok', 1500);
    });
  }

  /** O arquivo sumiu do disco: a aba fica, com o texto guardado como rascunho. */
  function marcaApagado(tab) {
    if (tab.apagadoNoDisco) return;
    tab.apagadoNoDisco = true;
    tab.staleOnDisk = true;
    tab.suspeita = null;
    scheduleBackup(tab);
    renderHeader();
    renderTabs();
  }

  /** Renomeado fora do MarkPad (na mesma pasta): a aba acompanha o arquivo. */
  function seguiuRenomeio(tab, destino) {
    if (!destino || tabByPath(destino)) { marcaApagado(tab); return; }
    var antigo = tab.name;
    var chaveVelha = tab.path;
    marcadoresSeguem(chaveVelha, destino);
    tab.path = destino;
    tab.name = baseName(destino);
    tab.dir = destino.replace(/[\\/][^\\/]*$/, '');
    tab.apagadoNoDisco = false;
    if (tab.content !== tab.savedContent) {
      // O rascunho mora pela chave do caminho: muda junto.
      bridge.call('dropBackup', { path: chaveVelha }).catch(function () {});
      scheduleBackup(tab);
    }
    bridge.call('watchFile', { path: destino }).catch(function () {});
    if (typeof arvoreMudou === 'function') arvoreMudou();
    renderAll();
    persist();
    toast(t('{antigo} foi renomeado fora do MarkPad para {novo}. A aba acompanhou.', { antigo: antigo, novo: tab.name }), 'ok', 4000);
  }

  /** Menu do selo "apagado do disco". */
  function menuApagado(tab, ev) {
    var r = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
    showMenu([
      { label: t('Salvar de novo no mesmo lugar'), icon: 'save', action: function () { saveTab(tab, false, { ignoraTrava: true }); } },
      { label: t('Salvar como...'), icon: 'save', action: function () { saveTab(tab, true); } },
      { label: t('Fechar a aba'), icon: 'x', action: function () { closeTab(tab.id); } }
    ], r ? r.left : 200, r ? r.bottom + 4 : 80);
  }

  /*
   * Recebe o aviso do vigia (ou da conferencia por data) e decide. `kind`:
   * 'changed', 'deleted' ou 'renamed' (com o novo caminho).
   */
  function processaMudanca(tab, kind, novoCaminho) {
    if (tab.monitorar) {
      if (kind === 'changed') { recarregaMonitorado(tab); return Promise.resolve(); }
      tab.monitorar = false;   // apagado ou renomeado encerra o monitoramento
      ajustaRelogioMonitor();
    }
    if (kind === 'renamed') { seguiuRenomeio(tab, novoCaminho); return Promise.resolve(); }
    if (kind === 'deleted') { marcaApagado(tab); return Promise.resolve(); }
    if (tab.conferindo) return tab.conferindo;

    tab.conferindo = leDisco(tab.path).then(function (disco) {
      tab.conferindo = null;
      if (app.tabs.indexOf(tab) === -1) return;
      var voltou = tab.apagadoNoDisco;
      tab.apagadoNoDisco = false;
      if (!disco.erro) tab.discoVisto = disco.mtime;

      // So a data mudou (sincronizacao, "tocar" o arquivo) ou o arquivo voltou
      // igual: nada a trocar.
      if (!disco.erro && disco.content === tab.savedContent) {
        tab.mtime = disco.mtime;
        tab.staleOnDisk = false;
        tab.suspeita = null;
        if (voltou) scheduleBackup(tab);
        renderHeader();
        renderTabs();
        return;
      }

      var sujo = tab.content !== tab.savedContent;
      var motivo = suspeitaDoDisco(tab, disco);
      if (!sujo && !motivo) {
        aplicaDoDisco(tab, disco);
        toast(t('{arquivo} foi atualizado no disco.', { arquivo: tab.name }), 'ok', 2200);
        return;
      }

      tab.staleOnDisk = true;
      tab.suspeita = motivo;
      renderHeader();
      renderTabs();
      // Suspeita de corte: a escolha abre na hora, para nao passar batido.
      if (motivo && !app.dialogoDisco && $('overlay').hidden) {
        if (tab !== activeTab()) selectTab(tab.id);
        resolveDisco(tab, 'suspeito', disco);
      }
    });
    return tab.conferindo;
  }

  /*
   * Monitorar (o tail -f do Notepad++): a aba fica travada, recarrega a cada
   * mudanca e rola ate o fim, com um olho no lugar do icone de estado. Alem
   * do vigia, confere a data a cada segundo (log em pasta de rede nao avisa).
   * Log que gira (apagado e recriado, encolhido) nao e suspeita aqui: so
   * recarrega. Apagar ou renomear encerra, como no Notepad++.
   */
  var relogioMonitor = null;

  function alternaMonitorar(tab, ligar) {
    if (!tab || !tab.path) return;
    ligar = ligar === undefined ? !tab.monitorar : ligar;
    if (ligar && tab.content !== tab.savedContent) {
      toast(t('Salve ou descarte as alterações antes de monitorar.'), 'warn', 3000);
      return;
    }
    tab.monitorar = ligar;
    if (ligar) {
      if (!tab.locked) setLocked(tab, true, true);
      recarregaMonitorado(tab);
      toast(t('Monitorando {nome}: recarrega e vai para o fim a cada mudança.', { nome: tab.name }), 'ok', 3000);
    } else {
      toast(t('Parou de monitorar {nome}.', { nome: tab.name }), '', 1800);
    }
    ajustaRelogioMonitor();
    renderTabs();
    renderHeader();
  }

  function ajustaRelogioMonitor() {
    var algum = app.tabs.some(function (aba) { return aba.monitorar; });
    if (algum && !relogioMonitor) {
      relogioMonitor = setInterval(function () {
        confereDisco(app.tabs.filter(function (aba) { return aba.monitorar; }));
      }, 1000);
    } else if (!algum && relogioMonitor) {
      clearInterval(relogioMonitor);
      relogioMonitor = null;
    }
  }

  function recarregaMonitorado(tab) {
    if (tab.recarregando) return;
    tab.recarregando = true;
    leDisco(tab.path).then(function (disco) {
      tab.recarregando = false;
      if (disco.erro || app.tabs.indexOf(tab) === -1) return;   // no meio da rotacao: espera o proximo aviso
      if (disco.content !== tab.content) aplicaDoDisco(tab, disco);
      else { tab.mtime = disco.mtime; tab.discoVisto = disco.mtime; }
      if (tab === activeTab()) rolaAoFim();
    });
  }

  function rolaAoFim() {
    setTimeout(function () {
      if ($('readingView').hidden) { if (ed) ed.fimDoDocumento(); return; }
      var alvo = $('readingScroll');
      alvo.scrollTop = alvo.scrollHeight;
    }, 0);
  }

  /*
   * A rede de seguranca do Notepad++: ao voltar o foco e ao trocar de aba,
   * confere a data de cada arquivo aberto contra a ultima vista.
   */
  function confereDisco(abas) {
    abas = (abas || app.tabs).filter(function (tab) { return tab && tab.path; });
    if (!abas.length) return;
    bridge.call('statFiles', { paths: abas.map(function (tab) { return tab.path; }) }).then(function (res) {
      var porCaminho = {};
      ((res && res.files) || []).forEach(function (f) { porCaminho[f.path.toLowerCase()] = f; });
      abas.forEach(function (tab) {
        if (app.tabs.indexOf(tab) === -1 || !tab.path) return;
        var f = porCaminho[tab.path.toLowerCase()];
        if (!f) return;
        if (!f.exists) { if (!tab.apagadoNoDisco) processaMudanca(tab, 'deleted'); return; }
        var visto = tab.discoVisto || tab.mtime;
        if (tab.apagadoNoDisco || (visto && f.mtime !== visto)) processaMudanca(tab, 'changed');
      });
    }).catch(function () {});
  }

  // ============================================================== A TRAVA

  function setLocked(tab, locked, silent) {
    tab = tab || activeTab();
    if (!tab) return;
    if (tab.locked === locked) return;
    if (!locked && tab.monitorar) {
      toast(t('Pare de monitorar para editar.'), 'warn', 2400);
      return;
    }

    // Fecha o editor de bloco aberto antes de trocar de estado.

    if (locked && tab.content !== tab.savedContent) {
      // Travar com mudanca pendente e legitimo: so avisa que continua pendente.
      toast(t('Travado. As alteracoes continuam por salvar (Ctrl+S).'), 'warn', 3200);
    }

    // A mesma linha no topo dos dois lados: travar e destravar nao perde o lugar.
    var linhaTopo = locked ? (ed && ed.aba === tab ? ed.linhaNoTopo() : -1) : linhaNoTopoDaLeitura();
    if (!locked) stashReadingScroll(tab);
    else stashScroll(tab);

    tab.locked = locked;
    renderAll();

    if (locked && linhaTopo >= 0) rolaLeituraParaLinha(linhaTopo);
    if (!locked && ed) {
      ed.foco();
      if (linhaTopo >= 0) ed.vaiParaLinha(linhaTopo);
      else restoreScroll(tab);
      if (tab.readOnlyOnDisk) {
        toast(t('Atencao: o arquivo esta marcado como somente leitura no disco.'), 'warn', 5000);
      }
    }

    if (!silent) {
      var btn = $('btnLock');
      btn.classList.remove('pulse');
      void btn.offsetWidth;
      btn.classList.add('pulse');
    }
  }

  function stashReadingScroll(tab) {
    tab.readingScrollTop = $('readingScroll').scrollTop;
  }

  function toggleLock() {
    var tab = activeTab();
    if (!tab) return;

    if (tab.locked && settings.confirmUnlock) {
      dialog(t('Liberar edicao?'),
        t('O documento <strong>{nome}</strong> passara a aceitar digitacao.',
          { nome: escapeText(tab.name) }),
        [{ label: t('Cancelar'), value: false }, { label: t('Liberar'), value: true, cls: 'primary' }]
      ).then(function (yes) { if (yes) setLocked(tab, false); });
      return;
    }

    setLocked(tab, !tab.locked);
  }

  // =========================================================== renderizacao

  function renderAll() {
    renderGrupos();
    renderTabs();
    renderQuickBar();
    renderHeader();
    renderViews();
    renderStatus();
    renderOutline();
    markTreeActive();
    renderGrafo();
  }

  function renderTabs() {
    // Dividido, cada metade tem a sua fileira de abas (como no Notepad++ e
    // no Obsidian); inteiro, a fileira de sempre, no alto.
    var fileiras = dividido()
      ? [[$('grupo1').querySelector('.grupo-abas'), 1], [$('grupo2').querySelector('.grupo-abas'), 2]]
      : [[$('tabList'), 0]];
    if (dividido()) $('tabList').textContent = '';
    else { $('grupo1').querySelector('.grupo-abas').textContent = ''; $('grupo2').querySelector('.grupo-abas').textContent = ''; }
    fileiras.forEach(function (par) { desenhaFileira(par[0], par[1]); });
  }

  function desenhaFileira(list, gid) {
    list.textContent = '';
    var g = gid ? grupoPorId(gid) : null;

    app.tabs.forEach(function (tab) {
      if (gid && grupoDe(tab) !== gid) return;
      var ativaAqui = gid ? (g && g.ativa === tab.id) : tab.id === app.activeId;
      var el = document.createElement('div');
      el.className = 'tab' +
        (ativaAqui ? ' is-active' : '') +
        (tab.espelhoDe ? ' is-espelho' : '') +
        (!tab.locked ? ' is-unlocked' : '') +
        (tab.fixada ? ' is-pinned' : '');
      el.title = tab.path || tab.name;
      if (tab.cor) el.setAttribute('data-cor', String(tab.cor));

      // Icone de estado (Notepad++): so o que foge do normal. Travada e o
      // normal do MarkPad, entao nao ganha icone; mudou no disco vence
      // somente leitura, que vence liberada.
      var estado = tab.apagadoNoDisco ? ['warning', 'is-apagado', t('apagado do disco')]
        : tab.monitorar ? ['eye', 'is-monitor', t('monitorando (tail -f)')]
        : tab.suspeita ? ['warning', 'is-suspeito', t('cortado no disco?')]
        : tab.staleOnDisk ? ['warning', 'is-mudou', t('mudou no disco')]
        : tab.readOnlyOnDisk ? ['lock', 'is-leitura', t('somente leitura no disco')]
        : !tab.locked ? ['pencil', 'is-liberada', t('Edição liberada')]
        : null;
      if (estado) {
        var ic = document.createElement('span');
        ic.className = 'tab-estado ' + estado[1];
        ic.title = estado[2];
        var svgEstado = window.MarkPadIcons.build(estado[0], 12);
        if (svgEstado) ic.appendChild(svgEstado);
        el.appendChild(ic);
      }

      if (tab.espelhoDe) {
        var elo = document.createElement('span');
        elo.className = 'tab-estado is-espelho';
        elo.title = t('A mesma nota da outra metade (clique para editar aqui)');
        var svgElo = window.MarkPadIcons.build('link', 12);
        if (svgElo) elo.appendChild(svgElo);
        el.appendChild(elo);
      }

      var name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.espelhoDe ? ((tabById(tab.espelhoDe) || tab).name) : tab.name;
      el.appendChild(name);

      if (tab.content !== tab.savedContent) {
        var dot = document.createElement('span');
        dot.className = 'tab-dot';
        el.appendChild(dot);
      }

      var close = document.createElement('button');
      if (tab.fixada) {
        // Fixada: alfinete no lugar do X, e clicar nele desafixa.
        close.className = 'tab-pin';
        close.title = t('Aba fixada: clique para desafixar');
        var pino = window.MarkPadIcons.build('pin', 12);
        if (pino) close.appendChild(pino);
        close.onclick = function (e) { e.stopPropagation(); alternaFixacao(tab); };
      } else {
        close.className = 'tab-close';
        var x = window.MarkPadIcons.build('x', 12);
        if (x) close.appendChild(x);
        close.onclick = function (e) { e.stopPropagation(); closeTab(tab.id); };
      }
      el.appendChild(close);

      el.onclick = function () { selectTab(tab.id); };
      // Botao do meio fecha, menos a fixada (fechar fixada e so de proposito).
      el.onmousedown = function (e) { if (e.button === 1) { e.preventDefault(); if (!tab.fixada) closeTab(tab.id); } };
      el.oncontextmenu = function (e) {
        e.preventDefault();
        showMenu(tabContextMenu(tab), e.clientX, e.clientY);
      };

      // Arrastar para reordenar. A marca mostra de que lado a aba vai cair.
      el.draggable = true;
      el.ondragstart = function (e) {
        arrastoAba = tab;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', tab.name); } catch (err) {}
        el.classList.add('is-dragging');
      };
      el.ondragend = function (e) {
        var aba = arrastoAba;
        arrastoAba = null;
        limpaMarcasDeArrasto();
        // Soltou fora da janela (a janela destacada do Obsidian): a aba vai
        // para uma janela nova, nascida onde foi solta.
        var fora = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
        if (fora && aba && e.dataTransfer && e.dataTransfer.dropEffect === 'none') destacaAba(aba, e.screenX, e.screenY);
      };
      el.ondragover = function (e) {
        if (!arrastoAba || arrastoAba === tab) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var r = el.getBoundingClientRect();
        var depois = e.clientX > r.left + r.width / 2;
        el.classList.toggle('drop-depois', depois);
        el.classList.toggle('drop-antes', !depois);
      };
      el.ondragleave = function () { el.classList.remove('drop-antes', 'drop-depois'); };
      el.ondrop = function (e) {
        if (!arrastoAba || arrastoAba === tab) return;
        e.preventDefault();
        var r = el.getBoundingClientRect();
        var alvo = app.tabs.indexOf(tab) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
        var movida = arrastoAba;
        if (app.tabs.indexOf(movida) < alvo) alvo--; // tirar a aba desloca o alvo
        arrastoAba = null;
        // Soltou na fileira da outra metade: a aba muda de grupo.
        if (grupoDe(movida) !== grupoDe(tab)) { mudaDeGrupo(movida, grupoDe(tab)); alvo = app.tabs.indexOf(tab) + (e.clientX > r.left + r.width / 2 ? 1 : 0); if (app.tabs.indexOf(movida) < alvo) alvo--; }
        moveAba(movida, alvo);
      };

      list.appendChild(el);
    });

    var active = list.querySelector('.tab.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  var lastWindowTitle = '';
  function renderHeader() {
    var tab = activeTab();
    var dirty = tab && tab.content !== tab.savedContent;

    $('viewTitle').textContent = tab ? tab.name : 'MarkPad';
    $('viewTitle').title = tab && tab.path ? tab.path : '';
    renderMigalhas(tab);
    renderBotaoMarcador(tab);
    $('dirtyDot').hidden = !dirty;
    renderNavegacao();

    var windowTitle = tab
      ? (dirty ? '• ' : '') + tab.name + (tab.locked ? '' : '  [edicao liberada]') + ' — MarkPad'
      : 'MarkPad';
    if (windowTitle !== lastWindowTitle) {
      lastWindowTitle = windowTitle;
      bridge.call('setTitle', { title: windowTitle }).catch(function () {});
    }

    var badge = $('diskBadge');
    if (tab && tab.staleOnDisk) {
      badge.hidden = false;
      badge.style.cursor = 'pointer';
      if (tab.apagadoNoDisco) {
        badge.className = 'disk-badge danger';
        badge.textContent = t('apagado do disco');
        badge.title = t('O arquivo não existe mais no disco. Clique para salvar de novo ou em outro lugar.');
        badge.onclick = function (e) { menuApagado(tab, e); };
      } else {
        badge.className = 'disk-badge ' + (tab.suspeita ? 'danger' : 'warn');
        badge.textContent = tab.suspeita ? t('cortado no disco?') : t('mudou no disco');
        badge.title = t('Clique para comparar com o disco e escolher qual texto fica.');
        badge.onclick = function () { resolveDisco(tab); };
      }
    } else if (tab && tab.readOnlyOnDisk) {
      badge.hidden = false;
      badge.className = 'disk-badge';
      badge.textContent = t('somente leitura no disco');
      badge.title = '';
      badge.onclick = null;
    } else {
      badge.hidden = true;
      badge.onclick = null;
    }

    var lock = $('btnLock');
    var unlocked = tab && !tab.locked;

    lock.classList.toggle('is-locked', !unlocked);
    lock.classList.toggle('is-unlocked', !!unlocked);
    lock.disabled = !tab;
    lock.title = unlocked
      ? t('Edicao liberada — clique ou Ctrl+E para travar')
      : t('Edicao travada — clique ou Ctrl+E para liberar');
    $('lockText').textContent = unlocked ? 'Editando' : 'Travado';

    document.body.classList.toggle('is-editing', !!unlocked);

    renderModo(tab);
  }

  // ================================================================== modos
  //
  // Um documento, um painel. O que antes eram dois alternadores independentes
  // (codigo on/off, leitura ao lado on/off) virou um estado so, com tres
  // valores exclusivos. O par (locked, showSource) continua sendo a verdade —
  // 'modo' e a leitura dele em voz alta, sem estado duplicado para dessincronizar.

  var MODOS = [
    { id: 'leitura', label: t('Leitura'), icon: 'book-open', key: 'Ctrl+E',
      dica: t('o giz esta travado, a tecla nao escreve') },
    { id: 'vivo', label: t('Edicao ao vivo'), icon: 'pencil', key: '',
      dica: t('edita no proprio leitor, sem ver o codigo') },
    { id: 'fonte', label: t('Codigo-fonte'), icon: 'code', key: 'Ctrl+Shift+C',
      dica: t('markdown cru, com numeros de linha') }
  ];

  function modoDe(tab) {
    if (!tab || tab.locked) return 'leitura';
    return tab.showSource ? 'fonte' : 'vivo';
  }

  function modoInfo(id) {
    for (var i = 0; i < MODOS.length; i++) if (MODOS[i].id === id) return MODOS[i];
    return MODOS[0];
  }

  function renderModo(tab) {
    var modo = modoDe(tab);
    var info = modoInfo(modo);

    var flag = $('btnModeFlag');
    if (flag) {
      flag.disabled = !tab;
      flag.title = tab
        ? t('Modo: ') + info.label + ' — ' + info.dica
        : t('Modo de exibicao');
      flag.classList.toggle('is-live', !!(tab && !tab.locked));
      var fi = flag.querySelector('.mode-flag-icon');
      fi.setAttribute('data-icon', info.icon);
      fi.textContent = '';
      var fsvg = window.MarkPadIcons.build(info.icon, 15);
      if (fsvg) fi.appendChild(fsvg);
    }

    var seg = $('modeSeg');
    if (seg) {
      seg.classList.toggle('is-off', !tab);
      var botoes = seg.querySelectorAll('.mode-seg-btn');
      for (var i = 0; i < botoes.length; i++) {
        botoes[i].classList.toggle('is-active',
          !!tab && botoes[i].getAttribute('data-mode') === modo);
        botoes[i].disabled = !tab;
      }
    }

    var lado = $('statusSplit');
    if (lado) {
      lado.disabled = !(tab && modo === 'fonte');
      lado.classList.toggle('is-active', !!(tab && modo === 'fonte' && tab.showPreview));
    }
  }

  /** Troca de modo. Passar do travado para qualquer outro pede o giz. */
  function setModo(id, tab) {
    tab = tab || activeTab();
    if (!tab) return;
    if (id === modoDe(tab)) return;

    if (id === 'leitura') { setLocked(tab, true); return; }

    var querFonte = id === 'fonte';

    if (tab.locked) {
      var libera = function () {
        tab.showSource = querFonte;
        settings.showSource = querFonte;
        setLocked(tab, false);
        persist();
      };
      if (settings.confirmUnlock) {
        dialog(t('Liberar edicao?'),
          t('O documento <strong>{nome}</strong> passara a aceitar digitacao.',
            { nome: escapeText(tab.name) }),
          [{ label: t('Cancelar'), value: false }, { label: t('Liberar'), value: true, cls: 'primary' }]
        ).then(function (yes) { if (yes) libera(); });
        return;
      }
      libera();
      return;
    }

    var topoModo = ed && ed.aba === tab ? ed.linhaNoTopo() : -1;
    tab.showSource = querFonte;
    settings.showSource = querFonte;
    renderHeader();
    renderViews();
    persist();

    if (ed) {
      ed.foco();
      if (topoModo >= 0) ed.rolaParaLinha(topoModo);
    }
  }

  function modeMenu(x, y) {
    var tab = activeTab();
    var modo = modoDe(tab);

    var itens = MODOS.map(function (m) {
      return {
        label: m.label, icon: m.icon, key: m.key,
        checked: m.id === modo,
        disabled: !tab,
        action: function () { setModo(m.id); }
      };
    });

    itens.push('-');
    itens.push({
      label: t('Leitura ao lado do codigo'), icon: 'columns', key: 'Ctrl+Shift+L',
      checked: !!(tab && modo === 'fonte' && tab.showPreview),
      disabled: !(tab && modo === 'fonte'),
      action: togglePreviewPane
    });

    showMenu(itens, x, y);
  }

  /**
   * Tres arranjos possiveis:
   *   travado                  -> leitor, sem edicao
   *   destravado sem codigo    -> leitor editavel (o bloco sob o cursor vira
   *                               markdown cru; e o modelo do Obsidian)
   *   destravado com codigo    -> painel de codigo, com o leitor ao lado se
   *                               o segundo alternador estiver ligado
   */
  function renderViews() {
    var tab = activeTab();

    $('emptyState').hidden = !!tab;

    if (!tab) {
      $('readingView').hidden = true;
      $('editingView').hidden = true;
      return;
    }

    // Travado: o leitor. Destravado: o editor (ao vivo ou fonte), com o
    // leitor ao lado so no modo fonte, se pedido.
    var editando = !tab.locked && !!ed;

    $('readingView').hidden = editando;
    $('editingView').hidden = !editando;

    if (!editando) {
      renderPreview($('preview'), tab);
      $('preview').classList.toggle('is-editable', !tab.locked);
      $('readingScroll').scrollTop = tab.readingScrollTop || 0;
      return;
    }

    var comLeitura = !!tab.showSource && !!tab.showPreview;
    $('splitDivider').hidden = !comLeitura;
    $('previewPane').hidden = !comLeitura;
    // Sem o leitor ao lado o editor ocupa a largura toda.
    $('editorPane').style.flex = comLeitura ? '0 0 ' + (settings.splitRatio * 100) + '%' : '';

    carregaNoEditor(tab);
    if (comLeitura) renderPreview($('splitPreview'), tab);
  }

  /** Poe a aba no editor (estado guardado: desfazer, cursor) e acerta modo e opcoes. */
  function carregaNoEditor(tab) {
    if (ed.aba !== tab) {
      if (ed.aba && tabById(ed.aba.id) && !ed.aba.locked) {
        ed.aba.cmEstado = ed.estado();
        ed.aba.scrollTop = ed.rolagem();
      }
      ed.aba = tab;
      ed.carrega(tab.content, tab.cmEstado, { anchor: tab.selStart || 0, head: tab.selEnd == null ? tab.selStart || 0 : tab.selEnd });
      restoreScroll(tab);
    } else if (ed.texto() !== tab.content) {
      ed.defineTexto(tab.content);
    }
    ed.modo(tab.showSource ? 'fonte' : 'vivo');
    ed.opcoes(opcoesDoEditor(tab));
    document.body.classList.toggle('wrap-on', !!settings.wordWrap);
    ed.defineStatusLinhas(lineStatus(tab));
  }

  /** Texto da aba mudou por fora do editor (tarefa, mencao, disco): o editor acompanha. */
  function sincronizaEditor(tab) {
    if (ed && tab && ed.aba === tab && ed.texto() !== tab.content) ed.defineTexto(tab.content);
  }

  // ------------------------------------------------------------ preview

  function renderPreview(container, tab) {
    container.classList.remove('is-canvas');
    if (/\.canvas$/i.test(tab.path || tab.name || '')) { renderCanvas(container, tab); return; }
    var result;
    try {
      result = window.MarkPadMarkdown.render(tab.content, {
        loadRemoteImages: settings.loadRemoteImages,
        lineMap: true
      });
    } catch (err) {
      container.textContent = t('Falha ao renderizar: ') + err.message;
      return;
    }

    container.innerHTML = result.html;
    window.MarkPadMarkdown.sanitizeDom(container);
    container.__toc = result.toc;

    montaIconesCallout(container);
    renderMatematica(container);

    if (settings.showProperties !== false) renderProperties(container, result.frontmatter);
    liberaTarefas(container, tab);

    applyFolding(container, tab);
    marcaBlocosAlterados(container, tab);
    resolveLocalImages(container, tab);
    resolveMidia(container, tab);
    resolveNoteEmbeds(container, tab, [String(tab.path || '').toLowerCase()]);
    wirePreviewClicks(container, tab);
    marcaLinksQuebrados(container, tab);
    if (container.id === 'preview') renderBacklinks(container, tab);

    if (container.id === 'preview' && app.find.open && app.find.query) applyFindHighlights();
  }

  /*
   * Matematica com o KaTeX embutido: o parser marca $...$ e $$...$$ como
   * code.math (o TeX como texto, ja escapado); aqui ele vira formula. O
   * KaTeX desenha a partir do texto, com \href e afins desligados (trust
   * falso), entao a peneira do leitor continua valendo para o resto.
   */
  function renderMatematica(container) {
    if (!window.katex) return;
    var nos = container.querySelectorAll('code.math');
    for (var i = 0; i < nos.length; i++) {
      var c = nos[i];
      var bloco = c.classList.contains('math-block');
      var el = document.createElement(bloco ? 'div' : 'span');
      el.className = bloco ? 'math-render math-render-bloco' : 'math-render';
      try {
        window.katex.render(c.textContent, el, { displayMode: bloco, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' });
      } catch (err) { continue; }
      el.setAttribute('data-tex', c.textContent);
      var pai = c.parentNode;
      // Bloco sozinho num paragrafo: o paragrafo sai (div dentro de p nao vale).
      if (bloco && pai && pai.tagName === 'P' && pai.childNodes.length === 1) pai.parentNode.replaceChild(el, pai);
      else pai.replaceChild(el, c);
    }
  }

  // ------------------------------------------------------ quadro (.canvas)
  //
  // Leitor do JSON Canvas do Obsidian: cartoes de texto (Markdown), notas e
  // imagens incorporadas, links, grupos e as setas entre eles. So leitura:
  // destravado, o arquivo aparece como texto no editor. Arrastar o fundo
  // move, a roda aproxima e afasta em torno do ponteiro.

  var CORES_CANVAS = { '1': '--color-red', '2': '--color-orange', '3': '--color-yellow', '4': '--color-green', '5': '--color-cyan', '6': '--color-purple' };

  function corDoCanvas(c) {
    if (!c) return '';
    if (CORES_CANVAS[c]) return 'var(' + CORES_CANVAS[c] + ')';
    return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '';
  }

  function renderCanvas(container, tab) {
    container.classList.add('is-canvas');
    container.textContent = '';
    container.__toc = [];
    var dados;
    try { dados = JSON.parse(tab.content || '{}'); }
    catch (err) {
      var falha = document.createElement('div');
      falha.className = 'canvas-falha';
      falha.textContent = t('Este quadro (.canvas) nao e um JSON valido: ') + err.message;
      container.appendChild(falha);
      return;
    }
    var nos = Array.isArray(dados.nodes) ? dados.nodes.filter(function (n) { return n && isFinite(n.x) && isFinite(n.y); }) : [];
    var arestas = Array.isArray(dados.edges) ? dados.edges : [];

    var quadro = document.createElement('div');
    quadro.className = 'canvas-quadro';
    var plano = document.createElement('div');
    plano.className = 'canvas-plano';
    quadro.appendChild(plano);
    container.appendChild(quadro);
    if (!nos.length) {
      var vazio = document.createElement('p');
      vazio.className = 'pane-empty';
      vazio.textContent = t('Quadro vazio.');
      quadro.appendChild(vazio);
      return;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var porId = {};
    nos.forEach(function (n) {
      n.width = Math.max(40, Number(n.width) || 250); n.height = Math.max(30, Number(n.height) || 60);
      porId[n.id] = n;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    });

    // Grupos atras, depois o resto, na ordem do arquivo.
    nos.slice().sort(function (p, q) { return (p.type === 'group' ? 0 : 1) - (q.type === 'group' ? 0 : 1); }).forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'canvas-no canvas-no-' + (n.type || 'text');
      el.style.left = (n.x - minX) + 'px';
      el.style.top = (n.y - minY) + 'px';
      el.style.width = n.width + 'px';
      el.style.height = n.height + 'px';
      var cor = corDoCanvas(n.color);
      if (cor) el.style.setProperty('--canvas-cor', cor);
      var corpo = document.createElement('div');
      corpo.className = 'canvas-corpo markdown-preview';
      if (n.type === 'group') {
        if (n.label) {
          var rot = document.createElement('div');
          rot.className = 'canvas-grupo-rotulo';
          rot.textContent = n.label;
          el.appendChild(rot);
        }
      } else if (n.type === 'file' && n.file) {
        var alvo = String(n.file) + (n.subpath ? String(n.subpath) : '');
        var cab = document.createElement('div');
        cab.className = 'canvas-arquivo';
        var lnk = document.createElement('a');
        lnk.className = 'internal-link';
        lnk.setAttribute('data-wikilink', alvo.replace(/\.md(#|$)/i, '$1'));
        lnk.href = '#';
        lnk.textContent = String(n.file).split('/').pop();
        cab.appendChild(lnk);
        el.appendChild(cab);
        wirePreviewClicks(cab, tab);
        renderTrecho(corpo, '![[' + alvo + ']]', 'embed', tab);
        el.appendChild(corpo);
      } else if (n.type === 'link' && n.url) {
        var ext = document.createElement('a');
        ext.className = 'canvas-link';
        ext.setAttribute('data-external', String(n.url));
        ext.href = '#';
        ext.textContent = String(n.url);
        corpo.appendChild(ext);
        el.appendChild(corpo);
        wirePreviewClicks(corpo, tab);
      } else {
        renderTrecho(corpo, String(n.text || ''), 'texto', tab);
        el.appendChild(corpo);
      }
      plano.appendChild(el);
    });

    // Setas: curvas entre os lados (os do arquivo, ou os mais proximos).
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'canvas-arestas');
    svg.setAttribute('width', String(maxX - minX + 400));
    svg.setAttribute('height', String(maxY - minY + 400));
    svg.style.left = '-200px'; svg.style.top = '-200px';
    var defs = document.createElementNS(svgNS, 'defs');
    var marca = document.createElementNS(svgNS, 'marker');
    marca.setAttribute('id', 'canvas-seta'); marca.setAttribute('viewBox', '0 0 10 10');
    marca.setAttribute('refX', '9'); marca.setAttribute('refY', '5');
    marca.setAttribute('markerWidth', '7'); marca.setAttribute('markerHeight', '7');
    marca.setAttribute('orient', 'auto-start-reverse');
    var ponta = document.createElementNS(svgNS, 'path');
    ponta.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    ponta.setAttribute('fill', 'context-stroke');
    marca.appendChild(ponta); defs.appendChild(marca); svg.appendChild(defs);

    function lado(n, l) {
      var x = n.x - minX + 200, y = n.y - minY + 200;
      if (l === 'top') return { x: x + n.width / 2, y: y, dx: 0, dy: -1 };
      if (l === 'bottom') return { x: x + n.width / 2, y: y + n.height, dx: 0, dy: 1 };
      if (l === 'left') return { x: x, y: y + n.height / 2, dx: -1, dy: 0 };
      return { x: x + n.width, y: y + n.height / 2, dx: 1, dy: 0 };
    }
    function ladoPerto(de, para) {
      var cx = de.x + de.width / 2, cy = de.y + de.height / 2, ox = para.x + para.width / 2, oy = para.y + para.height / 2;
      return Math.abs(ox - cx) > Math.abs(oy - cy) ? (ox > cx ? 'right' : 'left') : (oy > cy ? 'bottom' : 'top');
    }
    arestas.forEach(function (e) {
      var a1 = porId[e.fromNode], b1 = porId[e.toNode];
      if (!a1 || !b1) return;
      var p = lado(a1, e.fromSide || ladoPerto(a1, b1)), q = lado(b1, e.toSide || ladoPerto(b1, a1));
      var dist = Math.hypot(q.x - p.x, q.y - p.y);
      var k = Math.max(40, Math.min(160, dist / 3));
      var d = 'M' + p.x + ',' + p.y + ' C' + (p.x + p.dx * k) + ',' + (p.y + p.dy * k) + ' ' + (q.x + q.dx * k) + ',' + (q.y + q.dy * k) + ' ' + q.x + ',' + q.y;
      var caminho = document.createElementNS(svgNS, 'path');
      caminho.setAttribute('d', d);
      caminho.setAttribute('class', 'canvas-aresta');
      var cor = corDoCanvas(e.color);
      if (cor) caminho.style.stroke = cor;
      if ((e.toEnd || 'arrow') === 'arrow') caminho.setAttribute('marker-end', 'url(#canvas-seta)');
      if (e.fromEnd === 'arrow') caminho.setAttribute('marker-start', 'url(#canvas-seta)');
      svg.appendChild(caminho);
      if (e.label) {
        var r = document.createElement('div');
        r.className = 'canvas-aresta-rotulo';
        r.textContent = String(e.label);
        r.style.left = ((p.x + q.x) / 2 - 200) + 'px';
        r.style.top = ((p.y + q.y) / 2 - 200) + 'px';
        plano.appendChild(r);
      }
    });
    plano.insertBefore(svg, plano.firstChild);

    // Camera: cabe tudo na tela, e arrastar/rodar mexe.
    var cam = { x: 0, y: 0, z: 1 };
    function aplica() { plano.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.z + ')'; }
    function encaixa() {
      var w = quadro.clientWidth || 800, h = quadro.clientHeight || 600;
      var bw = maxX - minX, bh = maxY - minY;
      cam.z = Math.max(0.1, Math.min(1, (w - 60) / bw, (h - 60) / bh));
      cam.x = (w - bw * cam.z) / 2; cam.y = (h - bh * cam.z) / 2;
      aplica();
    }
    requestAnimationFrame(encaixa);
    quadro.addEventListener('dblclick', function (ev) { if (!ev.target.closest('.canvas-no')) encaixa(); });
    quadro.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = quadro.getBoundingClientRect();
      var px = ev.clientX - r.left, py = ev.clientY - r.top;
      var z0 = cam.z, z = Math.max(0.1, Math.min(3, z0 * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      cam.x = px - (px - cam.x) * (z / z0); cam.y = py - (py - cam.y) * (z / z0); cam.z = z;
      aplica();
    }, { passive: false });
    quadro.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0 || ev.target.closest('a,button,input,.canvas-corpo')) return;
      ev.preventDefault();
      var ini = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y };
      quadro.classList.add('is-arrastando');
      function move(m) { cam.x = ini.cx + m.clientX - ini.x; cam.y = ini.cy + m.clientY - ini.y; aplica(); }
      function solta() { quadro.classList.remove('is-arrastando'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', solta); }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', solta);
    });
  }

  // Icones dos callouts: criados por nos, depois da peneira. O botao Copiar
  // dos blocos de codigo ganha aqui o rotulo no idioma da interface (o parser
  // nao conhece o t()).
  function montaIconesCallout(container) {
    var icons = container.querySelectorAll('.callout-icon[data-icon]');
    for (var i = 0; i < icons.length; i++) {
      var svg = window.MarkPadIcons.build(icons[i].getAttribute('data-icon'), 16);
      icons[i].textContent = '';
      if (svg) icons[i].appendChild(svg);
    }
    var copiar = container.querySelectorAll('.code-copy');
    for (var c = 0; c < copiar.length; c++) {
      copiar[c].textContent = t('Copiar');
      copiar[c].title = t('Copiar');
    }
  }

  // --------------------------------------------------------- recolhimento

  function headingLevel(el) {
    var m = /^H([1-6])$/.exec(el.tagName);
    return m ? Number(m[1]) : 0;
  }

  /**
   * Envolve tudo que vem depois de um titulo (ate o proximo titulo de nivel
   * igual ou maior) num bloco recolhivel, e pendura a setinha no titulo.
   * O estado fica por documento, entao nao se perde ao trocar de aba.
   */
  function applyFolding(container, tab) {
    if (!tab.folds) tab.folds = Object.create(null);
    foldHeadings(container, tab);
    foldLists(container, tab);
  }

  function foldHeadings(parent, tab) {
    var nodes = Array.prototype.slice.call(parent.children);
    var i = 0;

    while (i < nodes.length) {
      var el = nodes[i];
      var level = headingLevel(el);
      if (!level) { i++; continue; }

      var j = i + 1;
      var group = [];
      while (j < nodes.length) {
        var other = headingLevel(nodes[j]);
        if (other && other <= level) break;
        group.push(nodes[j]);
        j++;
      }

      if (group.length) {
        var section = document.createElement('div');
        section.className = 'heading-section';
        el.parentNode.insertBefore(section, el.nextSibling);
        group.forEach(function (n) { section.appendChild(n); });

        addFoldToggle(el, section, tab, el.id || ('h' + i));
        foldHeadings(section, tab);
      }

      i = j;
    }
  }

  function addFoldToggle(heading, section, tab, key) {
    var chevron = document.createElement('span');
    chevron.className = 'fold-chevron';
    chevron.title = t('Recolher / expandir secao');
    var svg = window.MarkPadIcons.build('chevron-down', 15);
    if (svg) chevron.appendChild(svg);
    heading.insertBefore(chevron, heading.firstChild);

    heading.classList.add('is-foldable');
    heading.setAttribute('data-fold-key', key);

    function paint() {
      var collapsed = !!tab.folds[key];
      heading.classList.toggle('is-collapsed', collapsed);
      section.hidden = collapsed;
    }

    chevron.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      tab.folds[key] = !tab.folds[key];
      paint();
    };

    // Duplo clique no titulo tambem recolhe, como no Obsidian.
    heading.addEventListener('dblclick', function (e) {
      if (window.getSelection && String(window.getSelection())) return;
      e.preventDefault();
      tab.folds[key] = !tab.folds[key];
      paint();
    });

    paint();
  }

  /*
   * A chave do recolhimento vinha da posicao do item na lista ('li:7:...'):
   * bastava inserir uma linha acima para tudo escorregar e o item recolhido
   * passar a ser o vizinho. O texto do proprio item identifica ele mesmo
   * depois de andar — sem o texto das sublistas, que some quando a sublista
   * recolhe. Homonimos ganham sufixo pela ordem em que aparecem.
   */
  function chaveDeItem(li, usadas) {
    var partes = [];
    for (var n = li.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) continue;
      partes.push(n.textContent || '');
    }
    var base = partes.join(' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    var vez = (usadas[base] = (usadas[base] || 0) + 1);
    return 'li:' + base + (vez > 1 ? '#' + vez : '');
  }

  function foldLists(container, tab) {
    var items = container.querySelectorAll('li');
    var usadas = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var child = li.querySelector(':scope > ul, :scope > ol');
      if (!child) continue;

      var key = chaveDeItem(li, usadas);
      var chevron = document.createElement('span');
      chevron.className = 'fold-chevron list-fold';
      var svg = window.MarkPadIcons.build('chevron-down', 13);
      if (svg) chevron.appendChild(svg);
      li.insertBefore(chevron, li.firstChild);
      li.classList.add('is-foldable');

      (function (li, child, chevron, key) {
        function paint() {
          var collapsed = !!tab.folds[key];
          li.classList.toggle('is-collapsed', collapsed);
          child.hidden = collapsed;
        }
        chevron.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          tab.folds[key] = !tab.folds[key];
          paint();
        };
        paint();
      })(li, child, chevron, key);
    }
  }

  function setAllFolds(collapsed) {
    var tab = activeTab();
    if (!tab) return;

    // Destravado: quem dobra e o editor (secoes, listas e blocos de codigo).
    if (!tab.locked && ed && ed.aba === tab) {
      if (collapsed) ed.dobraTudo(); else ed.desdobraTudo();
      return;
    }

    if (!collapsed) {
      tab.folds = Object.create(null);
    } else {
      tab.folds = Object.create(null);
      // Mesmo criterio do renderViews (noLeitor): no modo vivo o que esta na
      // tela e #preview, e #splitPreview esta vazio.
      var container = (tab.locked || !tab.showSource) ? $('preview') : $('splitPreview');
      var heads = container.querySelectorAll('[data-fold-key]');
      for (var i = 0; i < heads.length; i++) tab.folds[heads[i].getAttribute('data-fold-key')] = true;
    }

    renderViews();
  }

  /**
   * Leva o histórico de linha para o modo leitura: um bloco fica marcado se
   * qualquer linha dele mudou. Sem isso o histórico só existiria no painel de
   * código, que é justamente o modo que o usuário não usa por padrão.
   */
  function marcaBlocosAlterados(container, tab) {
    if (tab.content === tab.originContent) return;

    var estado = lineStatus(tab);
    var blocos = container.children;

    for (var i = 0; i < blocos.length; i++) {
      var b = blocos[i];
      if (!b.getAttribute) continue;

      var ini = parseInt(b.getAttribute('data-line'), 10);
      var fim = parseInt(b.getAttribute('data-line-end'), 10);
      if (isNaN(ini) || isNaN(fim)) continue;

      var marca = '';
      for (var l = ini; l <= fim && l < estado.length; l++) {
        if (estado[l] === 'mod') { marca = 'mod'; break; }
        if (estado[l] === 'saved') marca = 'saved';
      }
      if (marca) b.classList.add('ch-' + marca);
    }
  }

  function resolveLocalImages(container, tab) {
    var imgs = container.querySelectorAll('img.local-image[data-src]');
    var base = tab.dir || app.folder;
    if (!base) return;

    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        var src = img.getAttribute('data-src');
        // Nao achou ao lado da nota: procura pelo nome na pasta aberta, como
        // o Obsidian faz com anexo (![[capa.png]] com a imagem em midia/).
        // So vale o que o indice achou DENTRO da pasta, e so pelo nome.
        var peloIndice = function () {
          if (!app.folder || !alvoAutoSeguro(src)) return Promise.resolve(null);
          return indiceLinks().then(function (idx) {
            if (!idx) return null;
            var achado = window.MarkPadLinkIndex.resolve(idx, { tipo: 'wiki', alvo: src }, relNaPasta(tab.path || ''));
            if (!achado) return null;
            return bridge.call('resolveAsset', {
              basePath: achado.path.replace(/[\\/][^\\/]*$/, ''), src: baseName(achado.path)
            });
          });
        };
        bridge.call('resolveAsset', { basePath: base, src: src })
          .then(function (res) { return res && res.url ? res : peloIndice(); })
          .catch(peloIndice)
          .then(function (res) {
            if (res && res.url) img.src = res.url;
            else showBrokenImage(img);
          })
          .catch(function () { showBrokenImage(img); });
      })(imgs[i]);
    }
  }

  /*
   * O casulo de audio/video/PDF do parser vira o player: o arquivo e achado
   * pelo indice (pelo nome, em qualquer pasta, como o anexo do Obsidian; ou
   * pelo caminho relativo, no ![](...)) e servido pelo endereco que o C#
   * mapeia para a pasta aberta. Arquivo fora da pasta fica com o nome e um
   * aviso — sem mapeamento nao ha URL.
   */
  function pastaMapeada() {
    if (!app.folder) return Promise.resolve(null);
    if (app.mapa && app.mapa.pasta === app.folder) return app.mapa.promessa;
    var pasta = app.folder;
    app.mapa = {
      pasta: pasta,
      promessa: bridge.call('mapFolder', { path: pasta })
        .then(function (r) { return (r && r.host) || null; })
        .catch(function () { return null; })
    };
    return app.mapa.promessa;
  }

  function resolveMidia(container, tab) {
    var casulos = container.querySelectorAll('.media-embed');
    if (!casulos.length) return;

    Promise.all([pastaMapeada(), indiceLinks()]).then(function (r) {
      var host = r[0], idx = r[1];
      var LI = window.MarkPadLinkIndex;
      Array.prototype.forEach.call(casulos, function (c) {
        if (!c.isConnected || c.getAttribute('data-pronto')) return;
        var wiki = c.hasAttribute('data-embed');
        var bruto = c.getAttribute(wiki ? 'data-embed' : 'data-file') || '';
        var hash = bruto.indexOf('#');
        var alvo = hash < 0 ? bruto : bruto.slice(0, hash);
        var arq = host && idx ? LI.resolve(idx, { tipo: wiki ? 'wiki' : 'md', alvo: alvo }, relNaPasta(tab.path || '')) : null;
        if (!arq) {
          c.classList.add('is-missing');
          c.title = t('Arquivo nao encontrado na pasta aberta.');
          return;
        }

        var url = host + arq.rel.split('/').map(encodeURIComponent).join('/');
        var tipo = c.getAttribute('data-media');
        var el;
        if (tipo === 'audio' || tipo === 'video') {
          el = document.createElement(tipo);
          el.controls = true;
          el.preload = 'metadata';
          // Formato que o WebView2 nao toca (ou arquivo que sumiu): diz, em
          // vez de deixar um player mudo em 0:00.
          el.addEventListener('error', function () {
            c.classList.add('is-missing');
            c.textContent = t('Nao consegui tocar {arquivo} aqui.', { arquivo: arq.rel });
          });
          el.addEventListener('loadedmetadata', function () { c.setAttribute('data-duracao', String(el.duration)); });
          el.src = url;
        } else {
          // O leitor de PDF do proprio WebView2; #page=3 funciona nele.
          el = document.createElement('iframe');
          el.src = url + (hash < 0 ? '' : bruto.slice(hash));
          el.title = arq.rel;
          el.className = 'pdf-embed';
        }
        // Com o player no lugar, o casulo deixa de ser link: o clique e do player.
        c.removeAttribute('data-file');
        c.setAttribute('data-pronto', '1');
        c.textContent = '';
        c.appendChild(el);
      });
    });
  }

  /* Imagem da leitura em tela cheia: clique amplia ao tamanho real, Esc fecha. */
  function abreImagem(img) {
    var fundo = document.createElement('div');
    fundo.className = 'visor-imagem';
    fundo.setAttribute('role', 'dialog');
    fundo.setAttribute('aria-label', img.alt || t('Imagem'));
    var foto = document.createElement('img');
    foto.src = img.src;
    foto.alt = img.alt || '';
    fundo.appendChild(foto);
    var legenda = document.createElement('div');
    legenda.className = 'visor-legenda';
    legenda.textContent = (img.getAttribute('data-src') || img.alt || '') + '  ·  ' +
      t('clique na imagem para ver no tamanho real; Esc fecha');
    fundo.appendChild(legenda);

    function fecha() {
      fundo.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); }
    }
    foto.onclick = function (e) { e.stopPropagation(); fundo.classList.toggle('is-real'); };
    fundo.onclick = fecha;
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(fundo);
  }

  function showBrokenImage(img) {
    var span = document.createElement('span');
    span.className = 'remote-image';
    span.textContent = t('imagem nao encontrada: ') + (img.getAttribute('data-src') || '');
    if (img.parentNode) img.parentNode.replaceChild(span, img);
  }

  // -------------------------------------------------------- transclusao

  /*
   * ![[Nota]] no Obsidian nao e um link: e a nota inteira, incrustada no
   * documento. O parser nao le disco, entao deixa um casulo (span.note-embed)
   * com um link dentro — aqui o casulo vira conteudo de verdade: o arquivo se
   * resolve como qualquer wikilink, renderiza com a mesma peneira do leitor e
   * perde o que nao faz sentido dentro de outro documento (ids repetidos,
   * tarefas clicaveis). A cadeia de caminhos e o que impede ![[A]] dentro de
   * A de descer para sempre; um embed que falha degrada para o link que ja
   * estava la, com o motivo no title.
   */
  var EMBED_PROFUNDIDADE_MAX = 4;
  var EMBED_BYTES_MAX = 1024 * 1024;

  /*
   * Embed e previa disparam SOZINHOS, sem clique — um arquivo hostil nao pode
   * usar isso para fazer o app ler caminho arbitrario: alvo absoluto (C:\...),
   * UNC (\\host — que ainda vazaria credencial NTLM ao tocar SMB) e '..' ficam
   * de fora. O clique explicito num wikilink continua podendo o que ja podia.
   */
  function alvoAutoSeguro(alvo) {
    if (isAbsolutePath(alvo) || /^[\\/]/.test(alvo)) return false;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(alvo)) return false;
    return true;
  }

  /*
   * Na edicao ao vivo, cada commit de bloco redesenha a leitura inteira e
   * re-resolveria cada embed com um readFile na ponte. Cinco segundos de
   * cache seguram a rajada; quem edita o arquivo EMBUTIDO espera no maximo
   * isso para ver a mudanca refletida no hospedeiro.
   */
  var LEITURA_EMBED_TTL_MS = 5000;
  var leituraEmbedCache = Object.create(null);

  function leNotaComCache(path) {
    var k = path.toLowerCase();
    var c = leituraEmbedCache[k];
    if (c && Date.now() - c.em < LEITURA_EMBED_TTL_MS) return c.promessa;
    var promessa = bridge.call('readFile', { path: path });
    leituraEmbedCache[k] = { em: Date.now(), promessa: promessa };
    return promessa;
  }

  function resolveNoteEmbeds(container, tab, cadeia) {
    var casulos = container.querySelectorAll('span.note-embed[data-embed]');
    for (var i = 0; i < casulos.length; i++) montaEmbed(casulos[i], tab, cadeia);
  }

  function embedFalhou(casulo, motivo) {
    casulo.classList.add('embed-broken');
    casulo.title = motivo;
  }

  function montaEmbed(casulo, tab, cadeia) {
    var bruto = casulo.getAttribute('data-embed') || '';
    casulo.removeAttribute('data-embed');

    var partes = bruto.split('#');
    var arquivo = partes[0].trim();
    var secao = partes.slice(1).filter(Boolean).pop() || '';
    if (!arquivo) return; // ![[#Secao]]: o link de ancora que ja esta la resolve

    if (cadeia.length >= EMBED_PROFUNDIDADE_MAX) {
      return embedFalhou(casulo, t('Embeds fundos demais; este ficou como link.'));
    }

    var nomeArq = /\.\w+$/.test(arquivo) ? arquivo : arquivo + '.md';
    if (!alvoAutoSeguro(nomeArq)) {
      return embedFalhou(casulo, t('Caminho absoluto nao se embute sozinho — clique no link para abrir.'));
    }
    if (!/\.(md|markdown|txt)$/i.test(nomeArq)) {
      return embedFalhou(casulo, t('So notas de texto se embutem: ') + nomeArq);
    }

    resolveNota(nomeArq, tab).then(function (path) {
      if (!path) return embedFalhou(casulo, t('Arquivo nao encontrado: ') + nomeArq);
      if (cadeia.indexOf(path.toLowerCase()) !== -1) {
        return embedFalhou(casulo, t('Embed circular: ') + nomeArq + ' ja esta na corrente.');
      }
      return leNotaComCache(path).then(function (data) {
        if ((data.content || '').length > EMBED_BYTES_MAX) {
          return embedFalhou(casulo, t('Arquivo grande demais para embutir.'));
        }

        var conteudo = renderConteudoDeNota(data.content, { dir: data.dir, path: path },
          cadeia.concat([path.toLowerCase()]));
        if (secao) {
          var fatia = extraiSecao(conteudo, secao);
          if (!fatia) return embedFalhou(casulo, t('Secao nao encontrada: ') + secao);
          conteudo = fatia;
        }
        podaParaEmbed(conteudo);
        // Cliques dentro do embed resolvem na pasta da NOTA EMBUTIDA (via
        // tabDeClique) — 'detalhe.md' citado por ela e o vizinho DELA.
        conteudo.__dir = data.dir;

        var bloco = document.createElement('span');
        bloco.className = 'markdown-embed';

        var titulo = document.createElement('span');
        titulo.className = 'embed-title';
        titulo.textContent = casulo.getAttribute('data-alias') ||
          (arquivo.split(/[\\/]/).pop().replace(/\.md$/i, '') + (secao ? ' > ' + secao : ''));
        bloco.appendChild(titulo);

        var abrir = document.createElement('a');
        abrir.className = 'embed-open';
        abrir.href = '#';
        abrir.setAttribute('data-wikilink', bruto);
        abrir.title = t('Abrir a nota');
        var svg = window.MarkPadIcons.build('link', 14);
        if (svg) abrir.appendChild(svg);
        bloco.appendChild(abrir);

        conteudo.className = 'embed-content';
        bloco.appendChild(conteudo);

        casulo.textContent = '';
        casulo.appendChild(bloco);
        casulo.classList.add('is-resolved');
      });
    }).catch(function () { embedFalhou(casulo, t('Nao consegui ler: ') + nomeArq); });
  }

  /*
   * Renderiza o markdown de OUTRA nota num <div> solto, com a mesma peneira
   * do leitor: imagens resolvidas a partir da pasta dela, embeds de dentro
   * dela tambem resolvidos (a cadeia segue junto). Serve a transclusao e a
   * previa ao pairar.
   */
  function renderConteudoDeNota(src, fonte, cadeia) {
    var caixa = document.createElement('div');
    var result;
    try {
      result = window.MarkPadMarkdown.render(src, { loadRemoteImages: settings.loadRemoteImages });
    } catch (err) {
      caixa.textContent = t('Falha ao renderizar: ') + err.message;
      return caixa;
    }
    caixa.innerHTML = result.html;
    window.MarkPadMarkdown.sanitizeDom(caixa);
    montaIconesCallout(caixa);
    resolveLocalImages(caixa, { dir: fonte.dir });
    resolveNoteEmbeds(caixa, { dir: fonte.dir, path: fonte.path }, cadeia);
    return caixa;
  }

  /*
   * ![[Nota#Secao]] e o pedaco, nao o todo: o titulo com aquele slug e tudo
   * ate o proximo titulo de nivel igual ou mais raso. ![[Nota#^bloco]] e um
   * bloco so. Trabalha no DOM ja renderizado para reusar as regras de id
   * (slug, unicidade) do leitor; a fatia e movida, nao copiada, porque a
   * arvore de origem e descartavel.
   */
  function extraiSecao(root, secao) {
    var caixa = document.createElement('div');

    if (secao.charAt(0) === '^') {
      var alvo = root.querySelector('#' + CSS.escape(secao.slice(1)));
      if (!alvo) return null;
      if (alvo.tagName === 'LI') {
        // Um <li> nu no meio do texto e HTML invalido; ganha a lista de volta.
        var lista = document.createElement(
          alvo.parentElement && alvo.parentElement.tagName === 'OL' ? 'ol' : 'ul');
        lista.appendChild(alvo);
        caixa.appendChild(lista);
      } else {
        caixa.appendChild(alvo);
      }
      return caixa;
    }

    var el = root.querySelector('#' + CSS.escape(window.MarkPadMarkdown.slugify(secao)));
    if (!el) return null;
    var nivel = headingLevel(el);
    if (!nivel) { caixa.appendChild(el); return caixa; }

    var n = el;
    while (n) {
      var prox = n.nextSibling;
      caixa.appendChild(n);
      n = prox;
      if (n && n.nodeType === 1) {
        var outro = headingLevel(n);
        if (outro && outro <= nivel) break;
      }
    }
    return caixa;
  }

  /*
   * Clique dentro de conteudo transcluido resolve na pasta da nota embutida,
   * nao na do documento hospedeiro: quando ha homonimo, 'detalhe.md' do
   * embed e o que mora ao lado DELE. O closest acha o embed mais fundo, que
   * e exatamente o dono do trecho clicado.
   */
  function tabDeClique(el, tab) {
    var cont = el.closest && el.closest('.embed-content');
    return cont && cont.__dir ? { dir: cont.__dir } : tab;
  }

  function podaParaEmbed(caixa) {
    // Ids repetidos entre o documento e o embed confundiriam os saltos de
    // ancora: o querySelector acharia o do embed primeiro.
    var comId = caixa.querySelectorAll('[id]');
    for (var i = 0; i < comId.length; i++) comId[i].removeAttribute('id');
    // Tarefa de embed nao tem linha no documento aberto; marcar aqui gravaria
    // no arquivo errado. Fica visivel, mas quieta.
    var comLinha = caixa.querySelectorAll('[data-task-line]');
    for (var j = 0; j < comLinha.length; j++) comLinha[j].removeAttribute('data-task-line');
  }

  // ---------------------------------------------------- mencoes ligadas

  /*
   * O pe da leitura, como os paineis de links do Obsidian: quem aponta para
   * este documento (mencoes ligadas), quem cita o nome dele sem link
   * (mencoes nao ligadas) e para onde ele aponta (links de saida). Tudo sai
   * do indice da pasta (indiceLinks, web/linkindex.js) — menos as mencoes
   * soltas, que precisam do texto inteiro das outras notas e por isso so
   * rodam o grep quando alguem abre a secao.
   */
  function renderBacklinks(container, tab) {
    if (settings.showBacklinks === false || !app.folder || !tab.path) return;

    var bloco = document.createElement('div');
    bloco.className = 'backlinks-block';
    container.appendChild(bloco);

    var ligadas = secaoDeLinks(bloco, 'ligadas', t('Mencoes ligadas'));
    var soltas = secaoDeLinks(bloco, 'soltas', t('Mencoes nao ligadas'));
    var saida = secaoDeLinks(bloco, 'saidas', t('Links de saida'));

    indiceLinks().then(function (idx) {
      if (!bloco.isConnected) return;   // a leitura ja foi redesenhada
      if (!idx) { ligadas.conta(null); saida.conta(null); soltas.conta(null); return; }
      var LI = window.MarkPadLinkIndex;

      var itens = LI.backlinks(idx, tab.path);
      var total = itens.reduce(function (n, f) { return n + f.hits.length; }, 0);
      ligadas.conta(total, idx.truncado, ocorrencias(total, itens.length));
      ligadas.preenche(function (corpo) {
        if (!itens.length) return vazio(corpo, t('Nenhum arquivo da pasta aponta para este.'));
        itens.forEach(function (f) { corpo.appendChild(grupoDeOcorrencias(f.path, f.rel, f.hits)); });
      });

      var lista = LI.saidas(idx, tab.content, relNaPasta(tab.path));
      var quebrados = lista.filter(function (s) { return !s.para; }).length;
      saida.conta(lista.length, false, (lista.length === 1 ? t('1 link') : t('{n} links', { n: lista.length })) +
        (quebrados ? t(', {q} sem destino na pasta', { q: quebrados }) : ''));
      saida.preenche(function (corpo) {
        if (!lista.length) return vazio(corpo, t('Este documento nao tem links internos.'));
        lista.forEach(function (s) { corpo.appendChild(linhaDeSaida(s, tab)); });
      });

      var eu = idx && LI.arquivoDe(idx, tab.path);
      var nomes = [semExtensao(baseName(tab.path))]
        .concat(eu && eu.analise ? eu.analise.apelidos : [])
        .filter(function (n, i, todos) { return n && todos.indexOf(n) === i; })
        .slice(0, 5);
      soltas.aoAbrir(function (corpo) {
        vazio(corpo, t('buscando...'));
        return buscaMencoesSoltas(tab, nomes).then(function (achados) {
          if (!bloco.isConnected) return;
          var n = achados.reduce(function (s, f) { return s + f.hits.length; }, 0);
          soltas.conta(n, achados.truncado, ocorrencias(n, achados.length));
          corpo.textContent = '';
          if (!achados.length) return vazio(corpo, t('Nenhuma outra nota cita este nome sem link.'));
          // Como o link vai escrito: o nome, ou o caminho se ha homonimo.
          var nomeNota = semExtensao(baseName(tab.path));
          var alvo = eu && (idx.porNomeNota[nomeNota.toLowerCase()] || []).length > 1
            ? LI.semExtNota(eu.rel) : nomeNota;
          achados.forEach(function (f) {
            corpo.appendChild(grupoDeOcorrencias(f.path, f.relative, f.hits, function (hit, row) {
              ligaMencaoNoArquivo(f.path, f.relative, hit, alvo, row);
            }));
          });
        });
      });
    }).catch(function () { ligadas.conta(null); saida.conta(null); });
  }

  /*
   * Uma secao recolhivel do pe da leitura. Aberta ou fechada e preferencia,
   * nao estado da aba: quem abriu os links de saida quer ve-los no proximo
   * documento tambem, como os paineis do Obsidian.
   */
  function secaoDeLinks(bloco, qual, titulo) {
    var estado = settings.peLinks || (settings.peLinks = {});
    var cab = document.createElement('button');
    cab.className = 'backlinks-head';
    var chev = window.MarkPadIcons.build('chevron-down', 13);
    if (chev) cab.appendChild(chev);
    cab.appendChild(document.createTextNode(titulo));
    var pilula = document.createElement('span');
    pilula.className = 'backlinks-count';
    pilula.textContent = '…';
    cab.appendChild(pilula);
    bloco.appendChild(cab);

    var corpo = document.createElement('div');
    corpo.className = 'backlinks-body';
    bloco.appendChild(corpo);

    var preenchedor = null, carregou = false;
    function mostra() {
      var aberta = !!estado[qual];
      corpo.hidden = !aberta;
      cab.classList.toggle('is-collapsed', !aberta);
      cab.setAttribute('aria-expanded', aberta ? 'true' : 'false');
      if (aberta && preenchedor && !carregou) { carregou = true; preenchedor(corpo); }
    }
    cab.onclick = function () { estado[qual] = !estado[qual]; mostra(); persist(); };
    mostra();

    return {
      conta: function (n, mais, dica) {
        pilula.hidden = n === null;
        pilula.textContent = n === null ? '' : n + (mais ? '+' : '');
        if (dica) cab.title = dica;
      },
      preenche: function (fn) { corpo.textContent = ''; fn(corpo); },
      aoAbrir: function (fn) { preenchedor = fn; pilula.hidden = true; mostra(); }
    };
  }

  function ocorrencias(n, arquivos) {
    if (!n) return t('Nenhuma ocorrencia');
    return (n === 1 ? t('1 ocorrencia') : t('{n} ocorrencias', { n: n })) + ' ' +
      (arquivos === 1 ? t('em 1 arquivo') : t('em {a} arquivos', { a: arquivos }));
  }

  function vazio(corpo, texto) {
    var p = document.createElement('p');
    p.className = 'pane-empty';
    p.textContent = texto;
    corpo.textContent = '';
    corpo.appendChild(p);
  }

  /*
   * O mesmo desenho dos resultados da busca na pasta. `acao` (opcional)
   * poe o botao "Ligar" em cada linha — so as mencoes nao ligadas usam.
   */
  function grupoDeOcorrencias(caminho, rel, hits, acao) {
    var grupo = document.createElement('div');
    grupo.className = 'search-file';

    var h = document.createElement('div');
    h.className = 'search-file-head';
    h.title = caminho;
    h.setAttribute('data-previa-caminho', caminho);
    var nm = document.createElement('span');
    nm.textContent = rel;
    var ct = document.createElement('span');
    ct.className = 'search-file-count';
    ct.textContent = hits.length;
    h.appendChild(nm); h.appendChild(ct);
    h.onclick = function () { openPath(caminho); };
    grupo.appendChild(h);

    hits.forEach(function (hit) {
      var row = document.createElement('div');
      row.className = 'search-hit';
      row.title = hit.text;
      row.setAttribute('data-previa-caminho', caminho);
      var ln = document.createElement('span');
      ln.className = 'hit-line';
      ln.textContent = hit.line;
      row.appendChild(ln);
      row.appendChild(document.createTextNode(String(hit.text).trim()));
      row.onclick = function () { openPath(caminho, { line: hit.line }); };
      if (acao) {
        var botao = document.createElement('button');
        botao.className = 'hit-acao';
        botao.textContent = t('Ligar');
        botao.title = t('Trocar esta mencao por um link para a nota');
        botao.onclick = function (ev) { ev.stopPropagation(); acao(hit, row); };
        row.classList.add('tem-acao');
        row.appendChild(botao);
      }
      grupo.appendChild(row);
    });
    return grupo;
  }

  /*
   * Grava o link no lugar da mencao, na linha que o grep achou. A linha e
   * relida na hora: se ja nao tem a mencao solta (alguem editou), nada muda.
   * Aba com alteracao nao salva recebe a troca so na memoria, como no
   * renomear.
   */
  function ligaMencaoNoArquivo(caminho, rel, hit, alvo, row) {
    var LI = window.MarkPadLinkIndex;
    var tab = tabByPath(caminho);
    var suja = !!(tab && tab.content !== tab.savedContent);
    var leitura = suja ? Promise.resolve({ content: tab.content }) : bridge.call('readFile', { path: caminho });

    function pronto() {
      row.classList.add('is-ligada');
      var b = row.querySelector('.hit-acao');
      if (b) { b.disabled = true; b.textContent = t('Ligada'); }
      invalidaLinks();
      toast(t('Link criado em {arquivo}.', { arquivo: rel }), 'ok', 2200);
    }

    return leitura.then(function (data) {
      var linhas = data.content.split('\n');
      var nova = LI.ligaMencao(linhas[hit.line - 1], hit.termo, alvo);
      if (nova === null) { toast(t('A mencao nao esta mais nessa linha.'), 'warn', 3600); return null; }
      linhas[hit.line - 1] = nova;
      var texto = linhas.join('\n');
      if (suja) {
        tab.content = texto;
        invalidateLineStatus(tab);
        renderTabs();
        pronto();
        return null;
      }
      return bridge.call('writeFile', { path: caminho, content: texto, encoding: data.encoding, eol: data.eol })
        .then(function (res) {
          if (tab) {
            tab.content = texto;
            tab.savedContent = texto;
            tab.mtime = res.mtime;
            invalidateLineStatus(tab);
          }
          pronto();
        });
    }).catch(function (err) { toast(t('Nao consegui ligar: ') + err.message, 'error', 6000); });
  }

  /*
   * Um destino dos links de saida. Com arquivo na pasta, o clique navega
   * como um link do texto (na mesma aba, Ctrl abre outra); sem destino, o
   * clique leva a linha do link, que e onde se conserta.
   */
  function linhaDeSaida(s, tab) {
    var row = document.createElement('div');
    row.className = 'search-hit link-saida' + (s.para ? '' : ' is-unresolved');

    var ic = window.MarkPadIcons.build(s.para ? (s.embed ? 'eye' : 'link') : 'warning', 13);
    if (ic) row.appendChild(ic);

    var nome = document.createElement('span');
    nome.className = 'link-saida-nome';
    nome.textContent = s.para ? s.para.rel : s.alvo;
    row.appendChild(nome);

    var linhas = document.createElement('span');
    linhas.className = 'hit-line';
    linhas.textContent = s.linhas.length > 1 ? t('{n} vezes', { n: s.linhas.length }) : t('linha {n}', { n: s.linhas[0] });
    row.appendChild(linhas);

    row.title = s.para
      ? s.para.path
      : t('Nao existe na pasta. Clique para ir a linha {n}.', { n: s.linhas[0] });

    row.onclick = function (ev) {
      if (s.para) {
        abreDestino(s.para.path, { origem: tab, novaAba: ev.ctrlKey || ev.metaKey });
      } else {
        goToLine(s.linhas[0]);
      }
    };
    return row;
  }

  /*
   * Mencao nao ligada: o grep acha o nome em qualquer canto, e quem decide e
   * mencionaSemLink, que tira da linha os links e o codigo e exige palavra
   * inteira. Cada nome (o do arquivo e os apelidos do frontmatter) e um grep.
   */
  function buscaMencoesSoltas(tab, nomes) {
    var meu = String(tab.path).toLowerCase();
    var LI = window.MarkPadLinkIndex;
    var porArquivo = {};
    var ordem = [];
    var truncado = false;

    return Promise.all(nomes.map(function (nome) {
      return bridge.call('grepFolder', {
        root: app.folder, query: nome, caseSensitive: false, regex: false, maxResults: 300
      }).then(function (res) {
        if (res && res.truncated) truncado = true;
        ((res && res.results) || []).forEach(function (f) {
          if (String(f.path).toLowerCase() === meu) return;
          f.hits.forEach(function (h) {
            if (!LI.mencionaSemLink(h.text, nome)) return;
            var k = String(f.path).toLowerCase();
            var g = porArquivo[k];
            if (!g) { g = porArquivo[k] = { path: f.path, relative: f.relative, hits: [], linhas: {} }; ordem.push(g); }
            if (g.linhas[h.line]) return;
            g.linhas[h.line] = 1;
            g.hits.push({ line: h.line, text: h.text, termo: nome });
          });
        });
      }).catch(function () { truncado = true; });
    })).then(function () {
      ordem.sort(function (a, b) { return a.relative.toLowerCase() < b.relative.toLowerCase() ? -1 : 1; });
      ordem.forEach(function (g) { g.hits.sort(function (a, b) { return a.line - b.line; }); });
      ordem.truncado = truncado;
      return ordem;
    });
  }

  /*
   * Wikilink e link interno sem destino na pasta ficam apagados na leitura,
   * como no Obsidian: da para ver o buraco antes de clicar nele.
   */
  function marcaLinksQuebrados(container, tab) {
    if (!app.folder || !window.MarkPadLinkIndex) return;
    var links = container.querySelectorAll('a.internal-link[data-wikilink], a.internal-link[data-file]');
    if (!links.length) return;

    indiceLinks().then(function (idx) {
      if (!idx || !container.isConnected) return;
      var LI = window.MarkPadLinkIndex;
      var origem = relNaPasta(tab.path || joinPath(app.folder, 'sem titulo.md'));
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var wiki = a.getAttribute('data-wikilink');
        var bruto = wiki !== null ? wiki : a.getAttribute('data-file');
        var alvo = String(bruto || '').split('#')[0].trim();
        if (!alvo) continue;   // [[#Secao]]
        var para = LI.resolve(idx, { tipo: wiki !== null ? 'wiki' : 'md', alvo: alvo }, origem);
        a.classList.toggle('is-unresolved', !para);
        if (!para) a.title = t('Nao existe na pasta aberta.');
      }
    });
  }

  function semExtensao(nome) {
    return String(nome || '').replace(/\.[^.]+$/, '');
  }

  /* Caminho relativo a pasta aberta, com '/'; fora dela, o caminho inteiro. */
  function relNaPasta(caminho) {
    var p = String(caminho || '').replace(/\\/g, '/');
    var raiz = String(app.folder || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (raiz && p.toLowerCase().indexOf(raiz.toLowerCase() + '/') === 0) return p.slice(raiz.length + 1);
    return p;
  }

  // --------------------------------------------------- previa ao pairar

  /*
   * A previa de pagina do Obsidian: pare o mouse num link interno e a nota
   * aparece num cartao, sem abrir aba. So leitura — o cartao nasce, rola e
   * morre sem tocar no documento em foco. A ancora que o gerou e quem manda:
   * sair dela sem entrar no cartao desmancha tudo; entrar no cartao segura.
   */
  var previa = { timerAbre: null, timerFecha: null, el: null, ancora: null };

  function fechaPrevia() {
    clearTimeout(previa.timerAbre);
    clearTimeout(previa.timerFecha);
    if (previa.el && previa.el.parentNode) previa.el.parentNode.removeChild(previa.el);
    previa.el = null;
    previa.ancora = null;
  }

  function agendaFechaPrevia() {
    clearTimeout(previa.timerFecha);
    previa.timerFecha = setTimeout(fechaPrevia, 300);
  }

  document.addEventListener('mouseover', function (e) {
    if (settings.hoverPreview === false) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (previa.el && previa.el.contains(t)) { clearTimeout(previa.timerFecha); return; }

    var a = t.closest('[data-wikilink],[data-file]');
    var serve = a && a.closest('.markdown-preview') && !a.closest('.hover-popup') &&
      // O botao do embed abriria a previa do que ja esta na tela.
      !a.classList.contains('embed-open');
    // No editor, so com Ctrl (passar o mouse escrevendo nao pode abrir cartao).
    if (!serve && a && a.closest('.cm-content') && (e.ctrlKey || e.metaKey)) serve = true;

    // Listas (arvore, busca, mencoes, recentes, marcadores): a previa da nota
    // com Ctrl seguro, como no Obsidian (sem Ctrl, passar o mouse por uma
    // lista abriria cartao a cada linha).
    var item = !serve && t.closest('[data-previa-caminho], .tree-item[data-path]');
    previa.sobre = item || null;
    if (item && !item.closest('.hover-popup') && (e.ctrlKey || e.metaKey)) {
      if (item === previa.ancora && previa.el) { clearTimeout(previa.timerFecha); return; }
      clearTimeout(previa.timerAbre);
      previa.timerAbre = setTimeout(function () { abrePreviaDeLista(item); }, 200);
      return;
    }

    if (!serve) {
      clearTimeout(previa.timerAbre);
      if (previa.el) agendaFechaPrevia();
      return;
    }
    if (a === previa.ancora && previa.el) { clearTimeout(previa.timerFecha); return; }

    clearTimeout(previa.timerAbre);
    previa.timerAbre = setTimeout(function () { abrePrevia(a); }, 450);
  });

  document.addEventListener('mousedown', function (e) {
    if (previa.el && !previa.el.contains(e.target)) fechaPrevia();
  }, true);

  // Apertar Ctrl com o mouse ja parado numa linha de lista abre a previa.
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Control' || e.key === 'Meta') && settings.hoverPreview !== false &&
        previa.sobre && previa.sobre.isConnected && previa.sobre.matches(':hover') && previa.sobre !== previa.ancora) {
      abrePreviaDeLista(previa.sobre);
    }
  }, true);

  /** Caminho absoluto e secao de uma linha de lista. */
  function abrePreviaDeLista(item) {
    var path = item.getAttribute('data-previa-caminho') || item.getAttribute('data-path') || '';
    if (!/\.(md|markdown|txt)$/i.test(path)) return;   // pasta, imagem e afins: nada
    leNotaComCache(path).then(function (data) {
      if (data) mostraPrevia(item, data, item.getAttribute('data-previa-secao') || '', true);
    }).catch(function () {});
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && previa.el) {
      // Consome o Esc: era para fechar o cartao, nao para chegar ao editor
      // ao vivo la embaixo e cancelar (revertendo) o bloco que se digitava.
      e.preventDefault();
      e.stopPropagation();
      fechaPrevia();
    }
  }, true);

  function abrePrevia(ancora) {
    var tab = activeTab();
    if (!tab || !ancora.isConnected) return;

    var bruto = ancora.getAttribute('data-wikilink') || ancora.getAttribute('data-file') || '';
    var partes = bruto.split('#');
    var arquivo = partes[0].trim();
    var secao = partes.slice(1).filter(Boolean).pop() || '';

    var pronto;
    if (!arquivo) {
      // [[#Secao]]: a previa e do proprio documento.
      pronto = Promise.resolve({ content: tab.content, dir: tab.dir, path: tab.path });
    } else {
      var nomeArq = /\.\w+$/.test(arquivo) ? arquivo : arquivo + '.md';
      if (!/\.(md|markdown|txt)$/i.test(nomeArq)) return; // imagem e afins ja se mostram
      if (!alvoAutoSeguro(nomeArq)) return; // pairar nao e clicar
      pronto = resolveNota(nomeArq, tabDeClique(ancora, tab)).then(function (path) {
        return path ? leNotaComCache(path) : null;
      });
    }

    pronto.then(function (data) {
      mostraPrevia(ancora, data, secao, false);
    }).catch(function () { /* leitura falhou: sem cartao, sem drama */ });
  }

  /*
   * O cartao em si. `deLista`: veio da arvore, busca, marcadores; abre ao
   * lado da lista (a direita), nao embaixo da linha.
   */
  function mostraPrevia(ancora, data, secao, deLista) {
    (function () {
      if (!data || (data.content || '').length > EMBED_BYTES_MAX) return;
      // A leitura mudou, ou o mouse ja foi embora: cartao orfao nao nasce.
      if (!ancora.isConnected || !ancora.matches(':hover')) return;

      var pop = document.createElement('div');
      pop.className = 'hover-popup';
      var conteudo = renderConteudoDeNota(data.content, { dir: data.dir, path: data.path },
        [String(data.path || '').toLowerCase()]);
      conteudo.className += ' markdown-preview hover-popup-content';
      // Tarefa de previa e vitrine, nao formulario.
      var comLinha = conteudo.querySelectorAll('[data-task-line]');
      for (var i = 0; i < comLinha.length; i++) comLinha[i].removeAttribute('data-task-line');
      pop.appendChild(conteudo);

      fechaPrevia();
      previa.ancora = ancora;
      previa.el = pop;
      document.body.appendChild(pop);
      posicionaPrevia(pop, ancora, deLista);
      // Sair da linha da lista sem entrar no cartao desmancha, como no texto.
      if (deLista) ancora.addEventListener('mouseleave', agendaFechaPrevia, { once: true });

      if (secao) {
        var id = secao.charAt(0) === '^' ? secao.slice(1) : window.MarkPadMarkdown.slugify(secao);
        var alvoSec = id && conteudo.querySelector('#' + CSS.escape(id));
        if (alvoSec) pop.scrollTop = Math.max(0, alvoSec.offsetTop - 8);
      }

      pop.addEventListener('mouseleave', agendaFechaPrevia);
      pop.addEventListener('click', function (ev) {
        var el = ev.target.closest && ev.target.closest('[data-wikilink],[data-file],[data-external],[data-anchor]');
        if (!el) return;
        ev.preventDefault();
        if (el.hasAttribute('data-external')) {
          bridge.call('openExternal', { url: el.getAttribute('data-external') });
          return;
        }
        if (el.hasAttribute('data-anchor')) {
          var d = pop.querySelector('#' + CSS.escape(el.getAttribute('data-anchor')));
          if (d) d.scrollIntoView({ block: 'start' });
          return;
        }
        var raw = el.getAttribute('data-wikilink') || el.getAttribute('data-file') || '';
        var arq = raw.split('#')[0].trim();
        if (!arq) {
          // [[#Secao]] clicado no cartao rola o proprio cartao ate la.
          var secClique = raw.split('#').filter(Boolean).pop() || '';
          var idClique = secClique.charAt(0) === '^'
            ? secClique.slice(1)
            : window.MarkPadMarkdown.slugify(secClique);
          var dSec = idClique && conteudo.querySelector('#' + CSS.escape(idClique));
          if (dSec) dSec.scrollIntoView({ block: 'start' });
          return;
        }
        fechaPrevia();
        // Link do cartao mora na pasta da nota MOSTRADA, nao na da aba ativa.
        resolveAndOpen(/\.\w+$/.test(arq) ? arq : arq + '.md', { dir: data.dir });
      });
    })();
  }

  function posicionaPrevia(pop, ancora, deLista) {
    var r = ancora.getBoundingClientRect();
    var margem = 8;
    if (deLista) {
      var lx = r.right + 10;
      if (lx + pop.offsetWidth > window.innerWidth - margem) lx = Math.max(margem, r.left - pop.offsetWidth - 10);
      var ly = Math.min(Math.max(margem, r.top - 20), window.innerHeight - pop.offsetHeight - margem);
      pop.style.left = lx + 'px';
      pop.style.top = Math.max(margem, ly) + 'px';
      return;
    }
    var x = Math.min(Math.max(margem, r.left), window.innerWidth - pop.offsetWidth - margem);
    var y = r.bottom + 6;
    if (y + pop.offsetHeight > window.innerHeight - margem) {
      y = Math.max(margem, r.top - pop.offsetHeight - 6);
    }
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }

  /*
   * Propriedades: o bloco --- do topo virando ficha, como no Obsidian. O
   * texto vai por textContent, nunca por innerHTML — e conteudo de arquivo.
   */
  function renderProperties(container, campos) {
    if (!campos || !campos.length) return;

    var caixa = document.createElement('div');
    caixa.className = 'properties';

    var head = document.createElement('button');
    head.className = 'properties-head';
    head.type = 'button';

    var chev = window.MarkPadIcons.build('chevron-down', 14);
    if (chev) head.appendChild(chev);

    var rotulo = document.createElement('span');
    rotulo.textContent = t('Propriedades');
    head.appendChild(rotulo);

    var conta = document.createElement('span');
    conta.className = 'properties-count';
    conta.textContent = String(campos.length);
    head.appendChild(conta);

    caixa.appendChild(head);

    var corpo = document.createElement('div');
    corpo.className = 'properties-body';

    campos.forEach(function (campo) {
      var linha = document.createElement('div');
      linha.className = 'property';

      var chave = document.createElement('span');
      chave.className = 'property-key';
      chave.textContent = campo.key;
      linha.appendChild(chave);

      var valor = document.createElement('span');
      valor.className = 'property-value';

      if (campo.list && campo.list.length) {
        campo.list.forEach(function (v) { valor.appendChild(fichaValor(campo.key, v)); });
      } else if (campo.value) {
        // "tags: a, b" e lista escrita na horizontal — vale o mesmo tratamento.
        var solto = campo.value.replace(/^\[|\]$/g, '');
        var partes = /^(tags?|aliases?)$/i.test(campo.key)
          ? solto.split(',').map(function (v) { return v.trim(); }).filter(Boolean)
          : [campo.value];
        partes.forEach(function (v) { valor.appendChild(fichaValor(campo.key, v)); });
      } else {
        var vazio = document.createElement('span');
        vazio.className = 'property-empty';
        vazio.textContent = t('vazio');
        valor.appendChild(vazio);
      }

      linha.appendChild(valor);
      corpo.appendChild(linha);
    });

    caixa.appendChild(corpo);

    head.onclick = function () {
      var fechado = caixa.classList.toggle('is-collapsed');
      head.setAttribute('aria-expanded', String(!fechado));
    };

    container.insertBefore(caixa, container.firstChild);
  }

  /* Tag e alias viram ficha clicavel; o resto e so texto. */
  function fichaValor(chave, texto) {
    var limpo = String(texto).replace(/^["']|["']$/g, '');

    if (/^tags?$/i.test(chave)) {
      var tag = document.createElement('a');
      tag.className = 'property-tag';
      tag.href = '#';
      tag.textContent = '#' + limpo.replace(/^#/, '');
      tag.onclick = function (e) {
        e.preventDefault();
        openFolderSearch('#' + limpo.replace(/^#/, ''));
      };
      return tag;
    }

    var item = document.createElement('span');
    item.className = 'property-item';
    item.textContent = limpo;
    return item;
  }

  /*
   * A trava vale tambem para a caixinha de tarefa: destravado ela clica e
   * reescreve a linha; travado fica desabilitada, como o resto do leitor.
   */
  function liberaTarefas(container, tab) {
    var podeEditar = !!(tab && !tab.locked);
    var caixas = container.querySelectorAll('.task-item > input[type="checkbox"]');

    for (var i = 0; i < caixas.length; i++) {
      caixas[i].disabled = !podeEditar;
      caixas[i].title = podeEditar
        ? t('Marcar ou desmarcar')
        : t('Destrave a edicao (Ctrl+E) para marcar');
    }
    container.classList.toggle('tasks-live', podeEditar);
  }

  /* Troca [ ] por [x] (e volta) na linha de origem, sem redesenhar a pagina. */
  function toggleTask(tab, linha, caixa) {
    if (!tab || tab.locked) return;

    var linhas = tab.content.split('\n');
    if (linha < 0 || linha >= linhas.length) return;

    var m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\][\s\S]*)$/.exec(linhas[linha]);
    if (!m) return;

    // Regra do Obsidian: caixa vazia vira [x]; qualquer outro estado ([x],
    // [?], [/], [>]...) volta a ficar vazio. O estado custom nao sobrevive ao
    // clique, la nem aqui, mas [?] clicado fica [ ], nao vira feita.
    var marcado = m[2] === ' ';
    linhas[linha] = m[1] + (marcado ? 'x' : ' ') + m[3];
    tab.content = linhas.join('\n');

    if (caixa) {
      caixa.checked = marcado;
      caixa.removeAttribute('data-task');
      var li = caixa.parentElement;
      if (li) {
        li.classList.toggle('is-checked', marcado);
        li.setAttribute('data-task', marcado ? 'x' : ' ');
      }
    }

    sincronizaEditor(tab);

    invalidateLineStatus(tab);
    renderTabs();
    renderHeader();
    renderStatus();
    scheduleBackup(tab);

    if (settings.autoSave && tab.path) {
      clearTimeout(onEditorInput.saveTimer);
      onEditorInput.saveTimer = setTimeout(function () { saveTab(tab); }, 1200);
    }
  }

  function wirePreviewClicks(container, tab) {
    container.onclick = function (e) {
      var caixa = e.target;
      if (caixa && caixa.tagName === 'INPUT' && caixa.type === 'checkbox') {
        var li = caixa.parentElement;
        var linha = li && li.getAttribute('data-task-line');
        if (linha == null) { e.preventDefault(); return; }
        if (tab.locked) { e.preventDefault(); toast(t('Edicao travada. Ctrl+E para liberar.'), '', 1600); return; }


        toggleTask(tab, parseInt(linha, 10), caixa);
        return;
      }

      // Imagem na leitura abre em tela cheia — so travada: na edicao ao vivo o
      // clique e do editor de bloco, e imagem dentro de link segue o link.
      if (caixa && caixa.tagName === 'IMG' && caixa.src && tab.locked &&
          !caixa.closest('a,[data-file],[data-wikilink],[data-external]')) {
        e.preventDefault();
        abreImagem(caixa);
        return;
      }

      var el = e.target.closest ? e.target.closest('[data-external],[data-file],[data-wikilink],[data-anchor],[data-copy],[data-remote],[data-tag]') : null;
      if (!el) return;
      e.preventDefault();
      trataLink(el, e, container, tab);
    };

    // Botao do meio nao gera 'click': chega como auxclick. E o mousedown dele
    // sobre um link nao deve ligar a rolagem automatica do navegador.
    container.onauxclick = function (e) {
      if (e.button === 1 && e.target.closest && e.target.closest('[data-file],[data-wikilink]')) {
        e.preventDefault();
        container.onclick(e);
      }
    };
    container.onmousedown = function (e) {
      if (e.button === 1 && e.target.closest && e.target.closest('[data-file],[data-wikilink]')) e.preventDefault();
    };
  }

  /*
   * O que fazer com um link clicado: no leitor (container e a pagina) ou no
   * editor (container null: as ancoras viram linhas do texto).
   */
  function trataLink(el, e, container, tab) {
      if (el.hasAttribute('data-copy')) {
        var code = el.parentElement.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(function () {
            el.textContent = t('Copiado');
            setTimeout(function () { el.textContent = t('Copiar'); }, 1200);
          });
        }
        return;
      }

      if (el.hasAttribute('data-remote')) {
        var url = el.getAttribute('data-remote');
        var img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        el.parentNode.replaceChild(img, el);
        return;
      }

      if (el.hasAttribute('data-external')) {
        bridge.call('openExternal', { url: el.getAttribute('data-external') });
        return;
      }

      if (el.hasAttribute('data-anchor')) {
        if (!container) {
          var lnA = linhaDaSecao(tab, el.getAttribute('data-anchor'));
          if (lnA >= 0 && ed) { registraPosicao(tab); ed.vaiParaLinha(lnA); }
          else toast(t('Secao nao encontrada: ') + el.getAttribute('data-anchor'), 'warn');
          return;
        }
        // Ancora clicada dentro de um embed procura dentro DELE (os ids de la
        // foram podados, entao nao acha nada — melhor que saltar para a nota
        // de rodape homonima do documento hospedeiro).
        var escopoAncora = (el.closest && el.closest('.embed-content')) || container;
        var target = escopoAncora.querySelector('#' + CSS.escape(el.getAttribute('data-anchor')));
        if (target) {
          if (escopoAncora === container) registraPosicao(tab);
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          piscaAlvo(target);
        }
        return;
      }

      // Ctrl+clique ou botao do meio: aba nova. Clique simples: navega na aba.
      var navLink = { origem: tab, novaAba: !!(e.ctrlKey || e.metaKey || e.button === 1),
        outroGrupo: !!((e.ctrlKey || e.metaKey) && e.altKey) };

      if (el.hasAttribute('data-tag')) {
        openFolderSearch('#' + el.getAttribute('data-tag'));
        return;
      }

      if (el.hasAttribute('data-file')) {
        var partesArq = el.getAttribute('data-file').split('#');
        navLink.secao = partesArq.slice(1).join('#');
        resolveAndOpen(partesArq[0], tabDeClique(el, tab), navLink);
        return;
      }

      if (el.hasAttribute('data-wikilink')) {
        var partesWl = el.getAttribute('data-wikilink').split('#');
        var wl = partesWl[0];
        var secaoWl = partesWl.slice(1).filter(Boolean).pop() || '';

        // [[#Secao]] e [[#^bloco]] apontam para dentro do proprio documento:
        // sem arquivo antes do '#' nao ha o que abrir, ha aonde rolar.
        if (!wl && !container) {
          var lnW = linhaDaSecao(tab, secaoWl);
          if (lnW >= 0 && ed) { registraPosicao(tab); ed.vaiParaLinha(lnW); }
          else toast(t('Secao nao encontrada: ') + secaoWl, 'warn');
          return;
        }
        if (!wl) {
          var idWl = secaoWl.charAt(0) === '^'
            ? secaoWl.slice(1)
            : window.MarkPadMarkdown.slugify(secaoWl);
          var destinoWl = idWl && container.querySelector('#' + CSS.escape(idWl));
          if (destinoWl) {
            registraPosicao(tab);
            destinoWl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            piscaAlvo(destinoWl);
          }
          else toast(t('Secao nao encontrada: ') + secaoWl, 'warn');
          return;
        }

        // [[Nota#Secao]] abre a nota JA na secao (antes a secao era descartada).
        navLink.secao = secaoWl;
        resolveAndOpen(/\.\w+$/.test(wl) ? wl : wl + '.md', tabDeClique(el, tab), navLink);
      }
  }

  /*
   * O link vem escrito como o autor quis — '/' de markdown, '\' de Explorer,
   * as vezes absoluto — e o destino e sempre um caminho do Windows. Emendar
   * com '\' cru dava barra dobrada quando a base ja terminava em barra, que
   * e o caso de qualquer pasta aberta na raiz de um disco ('C:\').
   */
  function isAbsolutePath(p) {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '\\';
  }

  function joinPath(base, rel) {
    return base.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\').replace(/^\\+/, '');
  }

  // `nav` (opcional) diz de qual aba veio o clique e se e para abrir em aba
  // nova: com ele o link navega na propria aba (abreDestino).
  function resolveAndOpen(relative, tab, nav) {
    var base = tab.dir || app.folder;
    if (!base) { toast(t('Sem pasta de referencia para resolver o link.'), 'warn'); return; }

    var candidate = isAbsolutePath(relative) ? relative : joinPath(base, relative);

    bridge.call('pathInfo', { path: candidate }).then(function (info) {
      if (info.exists && info.kind === 'file') return abreDestino(info.path, nav);
      if (app.folder) {
        // Nao achou ao lado: procura pelo nome na pasta aberta, como o Obsidian faz.
        return findByName(relative, nav);
      }
      toast(t('Arquivo nao encontrado: ') + relative, 'warn');
      return null;
    }).catch(function () { toast(t('Arquivo nao encontrado: ') + relative, 'warn'); });
  }

  /*
   * O ultimo recurso de [[Nota]] e de link relativo quebrado: varrer o indice
   * da pasta aberta, como o Obsidian faz. A ordem de preferencia importa —
   * caminho relativo inteiro, depois nome com extensao, depois nome sem ela —
   * porque "notas/api.md" e "arquivo/api.md" sao arquivos diferentes e o
   * caminho e a unica coisa no link que sabe distinguir os dois.
   */
  function buscaPorNome(name) {
    if (!app.folder) return Promise.resolve([]);

    var rel = String(name || '').replace(/\\/g, '/').toLowerCase();
    var base = rel.split('/').pop();
    var semExt = base.replace(/\.[^.]+$/, '');

    return fileIndex().then(function (arquivos) {
      var porCaminho = [], porNome = [], porBase = [];

      arquivos.forEach(function (a) {
        var r = String(a.rel || '').replace(/\\/g, '/').toLowerCase();
        var n = String(a.name || '').toLowerCase();
        if (r === rel) porCaminho.push(a);
        else if (n === base) porNome.push(a);
        else if (n.replace(/\.[^.]+$/, '') === semExt) porBase.push(a);
      });

      var achados = porCaminho.length ? porCaminho : (porNome.length ? porNome : porBase);

      // Homonimos em subpastas diferentes: o mais raso ganha, e o usuario fica
      // sabendo que houve escolha — abrir o errado calado seria pior.
      achados.sort(function (a, b) {
        return String(a.rel || '').split('/').length - String(b.rel || '').split('/').length;
      });
      return achados;
    });
  }

  function findByName(name, nav) {
    return buscaPorNome(name).then(function (achados) {
      if (!achados.length) { toast(t('Arquivo nao encontrado: ') + name, 'warn'); return null; }
      if (achados.length > 1) toast(t('{n} arquivos com esse nome; abri o mais raso.', { n: achados.length }), 'warn');
      return abreDestino(achados[0].path, nav);
    });
  }

  /*
   * O mesmo funil de resolveAndOpen — caminho relativo, depois o indice da
   * pasta — mas devolvendo o caminho em vez de abrir aba: e o que a
   * transclusao e a previa precisam para ler a nota sem trazer ela para
   * frente.
   */
  function resolveNota(relative, tab) {
    var base = (tab && tab.dir) || app.folder;
    var noIndice = function () {
      return buscaPorNome(relative).then(function (a) { return a.length ? a[0].path : null; });
    };
    if (!base) return noIndice();

    var candidate = isAbsolutePath(relative) ? relative : joinPath(base, relative);
    return bridge.call('pathInfo', { path: candidate }).then(function (info) {
      if (info.exists && info.kind === 'file') return info.path;
      return noIndice();
    }).catch(noIndice);
  }

  // ------------------------------------------------------------- editor

  function opcoesDoEditor(tab) {
    return {
      quebra: !!settings.wordWrap,
      numeros: settings.lineNumbers !== false,
      editavel: !!tab && !tab.locked,
      corretor: !!settings.corretor,
      autoPar: settings.autoPar !== false
    };
  }

  /** Margem de alteracoes do editor (laranja nao salvo, verde salvo) e as opcoes dele. */
  function renderEditorHighlight() {
    var tab = activeTab();
    if (!tab || tab.locked || !ed || ed.aba !== tab) return;
    ed.opcoes(opcoesDoEditor(tab));
    ed.defineStatusLinhas(lineStatus(tab));
  }

  /** Estado de cada linha, com cache: recalcular a cada tecla sairia caro. */
  function lineStatus(tab) {
    if (!window.MarkPadChanges) return [];

    // Compara as strings em si. Chave por comprimento colidiria sempre que a
    // edição mantivesse o tamanho — trocar uma letra, por exemplo.
    if (tab._statusCache &&
        tab._statusDe === tab.content &&
        tab._statusSalvo === tab.savedContent &&
        tab._statusOrigem === tab.originContent) {
      return tab._statusCache;
    }

    tab._statusCache = window.MarkPadChanges.statusPorLinha(
      tab.originContent, tab.savedContent, tab.content);
    tab._statusDe = tab.content;
    tab._statusSalvo = tab.savedContent;
    tab._statusOrigem = tab.originContent;
    return tab._statusCache;
  }

  function invalidateLineStatus(tab) {
    if (tab) tab._statusCache = null;
  }

  function applyWrap() {
    document.body.classList.toggle('wrap-on', !!settings.wordWrap);
    if (ed) ed.opcoes({ quebra: !!settings.wordWrap });
  }

  /** Edicao como se digitada: entra no Ctrl+Z do editor. */
  function replaceRange(start, end, text) {
    if (ed) ed.troca(start, end, text);
  }

  var highlightTimer = null;
  function onEditorInput() {
    var tab = ed && ed.aba;
    if (!tab || tab !== activeTab() || tab.locked) return;
    var texto = ed.texto();
    if (texto === tab.content) return;

    tab.content = texto;

    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      renderEditorHighlight();
      if (tab.showSource && tab.showPreview) renderPreview($('splitPreview'), tab);
      renderOutline();
    }, 90);

    renderTabs();
    renderHeader();
    renderStatus();
    scheduleBackup(tab);

    if (settings.autoSave && tab.path) {
      clearTimeout(onEditorInput.saveTimer);
      onEditorInput.saveTimer = setTimeout(function () { saveTab(tab); }, 1200);
    }
  }

  /**
   * Pisca o alvo de um salto. Sem um sinal, rolar ate o lugar certo no meio
   * de um documento longo nao se distingue de nao ter saido do lugar.
   */
  function piscaAlvo(el) {
    if (!el) return;
    el.classList.remove('is-flashing');
    void el.offsetWidth; // reinicia a animacao quando o alvo e o mesmo de novo
    el.classList.add('is-flashing');
    setTimeout(function () { el.classList.remove('is-flashing'); }, 1300);
  }

  function goToLine(line) {
    var tab = activeTab();
    if (!tab) return;

    // Leitura E edicao ao vivo desenham em #preview; so o modo codigo tem
    // textarea. Olhar so para tab.locked mandava o modo vivo mexer num
    // textarea escondido, com valor velho — nada acontecia na tela.
    if (tab.locked || !ed) {
      var target = $('preview').querySelector('[data-line="' + (line - 1) + '"]') ||
                   $('preview').querySelector('[data-line="' + line + '"]');
      if (target) { target.scrollIntoView({ block: 'center' }); piscaAlvo(target); }
      return;
    }

    if (!ed) return;
    ed.foco();
    ed.vaiParaLinha(line - 1, { selecionar: true, y: 'center' });
  }

  // ------------------------- selecao contada, Ctrl+F3 e pular entre alteracoes

  function contaTexto(texto) {
    var palavras = texto.match(/[\wÀ-ÿ'-]+/g);
    return {
      linhas: texto.length ? texto.split('\n').length : 0,
      palavras: palavras ? palavras.length : 0,
      caracteres: texto.length
    };
  }

  /** O que esta selecionado agora, no editor ou na leitura ('' se nada). */
  function textoSelecionado() {
    if (!$('editingView').hidden && ed) return ed.textoSelecionado();
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    return sel.anchorNode && $('preview').contains(sel.anchorNode) ? sel.toString() : '';
  }

  /**
   * Ctrl+F3 (Notepad++): busca a selecao, ou a palavra sob o cursor, e vai para
   * a proxima ocorrencia; com Shift, a anterior. Funciona travado tambem.
   */
  function buscaPalavraAtual(passo) {
    var tab = activeTab();
    if (!tab) return;
    var noEditor = !$('editingView').hidden && !!ed;
    var texto = textoSelecionado().trim();
    if (!texto && noEditor) {
      var v = ed.texto(), a = ed.selecao().inicio, b = a;
      while (a > 0 && /[\wÀ-ÿ]/.test(v[a - 1])) a--;
      while (b < v.length && /[\wÀ-ÿ]/.test(v[b])) b++;
      texto = v.slice(a, b);
    }
    if (!texto || texto.indexOf('\n') !== -1) {
      toast(t('Selecione uma palavra para buscar.'), 'warn', 1800);
      return;
    }
    openFind();
    // Com a expressao regular ligada, a palavra vale ao pe da letra.
    $('findInput').value = app.find.regex ? texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : texto;
    runFind(passo);
    if (noEditor) ed.foco();
  }

  /**
   * Alt+F5 / Alt+Shift+F5: proxima e anterior alteracao da margem (as faixas
   * laranja e verde). No codigo-fonte anda pelas linhas; na leitura, pelos
   * blocos marcados.
   */
  function pulaAlteracao(passo) {
    var tab = activeTab();
    if (!tab) return;

    if ($('editingView').hidden) {
      var blocos = Array.prototype.slice.call($('preview').querySelectorAll('.ch-mod, .ch-saved'));
      if (!blocos.length) { toast(t('Nenhuma alteração neste documento.'), '', 1800); return; }
      var topo = $('readingScroll').getBoundingClientRect().top + 8;
      var alvoBloco = null;
      if (passo > 0) {
        for (var i = 0; i < blocos.length; i++) {
          if (blocos[i].getBoundingClientRect().top > topo + 4) { alvoBloco = blocos[i]; break; }
        }
        alvoBloco = alvoBloco || blocos[0];
      } else {
        for (var j = blocos.length - 1; j >= 0; j--) {
          if (blocos[j].getBoundingClientRect().top < topo - 4) { alvoBloco = blocos[j]; break; }
        }
        alvoBloco = alvoBloco || blocos[blocos.length - 1];
      }
      alvoBloco.scrollIntoView({ block: 'start' });
      piscaAlvo(alvoBloco);
      return;
    }

    var estado = lineStatus(tab);
    var inicios = [];
    for (var k = 0; k < estado.length; k++) if (estado[k] && (k === 0 || !estado[k - 1])) inicios.push(k);
    if (!inicios.length) { toast(t('Nenhuma alteração neste documento.'), '', 1800); return; }

    var atual = ed ? ed.linhaDoCursor() : 0;
    var alvo = null;
    if (passo > 0) {
      for (var m = 0; m < inicios.length; m++) if (inicios[m] > atual) { alvo = inicios[m]; break; }
      if (alvo === null) alvo = inicios[0];
    } else {
      for (var n = inicios.length - 1; n >= 0; n--) if (inicios[n] < atual) { alvo = inicios[n]; break; }
      if (alvo === null) alvo = inicios[inicios.length - 1];
    }
    goToLine(alvo + 1);
  }

  // ------------------------------------------------------ status e sumario

  function renderStatus() {
    var tab = activeTab();

    $('statusPath').textContent = tab ? (tab.path || t('nao salvo')) : '';
    $('statusPath').title = tab ? (tab.path || '') : '';

    if (!tab) {
      $('statusStats').textContent = '';
      $('statusCursor').textContent = '';
      $('statusEol').textContent = '';
      $('statusEncoding').textContent = '';
    } else {
      var text = tab.content;
      // A contagem do documento inteiro so muda quando o texto muda: guarda.
      if (tab._contagemDe !== text) { tab._contagem = contaTexto(text); tab._contagemDe = text; }
      var c = tab._contagem;
      var selecao = textoSelecionado();
      if (selecao) {
        var cs = contaTexto(selecao);
        $('statusStats').textContent = cs.palavras === 1
          ? t('Seleção: 1 palavra · {c} caracteres', { c: cs.caracteres })
          : t('Seleção: {p} palavras · {c} caracteres', { p: cs.palavras, c: cs.caracteres });
      } else {
        $('statusStats').textContent = t('{l} linhas · {p} palavras · {c} caracteres',
          { l: c.linhas, p: c.palavras, c: c.caracteres });
      }

      if (!tab.locked && ed && ed.aba === tab) {
        var sl = ed.selecao();
        var ln = ed.linhaDoCursor() + 1;
        var col = ed.colunaDoCursor() + 1;
        var sel = sl.fim - sl.inicio;
        $('statusCursor').textContent = t('Ln ') + ln + ', Col ' + col + (sel ? ' (' + sel + ' sel)' : '');
      } else {
        $('statusCursor').textContent = '';
      }

      $('statusEol').textContent = tab.eol === '\r\n' ? 'CRLF' : 'LF';
      $('statusEncoding').textContent = tab.encoding.toUpperCase();
    }

    $('statusWrap').textContent = settings.wordWrap ? t('Quebra: sim') : t('Quebra: nao');
    $('statusZoom').textContent = Math.round(settings.fontSize / 16 * 100) + '%';
    $('statusTheme').textContent = settings.theme === 'dark' ? t('Escuro')
      : settings.theme === 'light' ? t('Claro') : t('Sistema');
  }

  function renderOutline() {
    var tab = activeTab();
    var box = $('outline');
    box.textContent = '';

    if (!tab) {
      box.innerHTML = '<p class="pane-empty">Nenhum documento aberto.</p>';
      return;
    }

    var result;
    try { result = window.MarkPadMarkdown.render(tab.content, { lineMap: true }); }
    catch (e) { return; }

    sumario.toc = result.toc;
    sumario.tabId = tab.id;

    if (!result.toc.length) {
      box.innerHTML = '<p class="pane-empty">Este documento nao tem titulos.</p>';
      desenhaRodapes(tab, box);
      return;
    }

    // Achata a lista de títulos numa árvore pelo nível, para poder recolher
    // uma seção inteira junto com as subseções.
    var raiz = { level: 0, filhos: [] };
    var pilha = [raiz];

    result.toc.forEach(function (h, i) {
      var no = { level: h.level, text: h.text, line: h.line, slug: h.slug, indice: i, filhos: [] };
      while (pilha.length > 1 && pilha[pilha.length - 1].level >= h.level) pilha.pop();
      pilha[pilha.length - 1].filhos.push(no);
      pilha.push(no);
    });

    // Filtro (como o do sumario do Obsidian): fica o titulo que casa e os
    // pais dele, para o caminho continuar legivel.
    var q = semAcento(sumario.filtro || '').toLowerCase().trim();
    function casa(no) { return semAcento(no.text).toLowerCase().indexOf(q) !== -1; }
    function poda(nos) {
      return nos.map(function (no) {
        var filhos = poda(no.filhos);
        if (!casa(no) && !filhos.length) return null;
        var copia = {};
        for (var k in no) copia[k] = no[k];
        copia.filhos = filhos;
        copia.casou = casa(no);
        return copia;
      }).filter(Boolean);
    }
    var nos = q ? poda(raiz.filhos) : raiz.filhos;
    if (!nos.length) {
      var nada = document.createElement('p');
      nada.className = 'pane-empty';
      nada.textContent = t('Nenhum título com esse texto.');
      box.appendChild(nada);
    } else {
      box.appendChild(desenhaNos(nos, 0));
    }
    if (sumario.recolhido && !q) recolheSumario(true);
    desenhaRodapes(tab, box);
    marcaSecaoAtual();
  }

  // Estado do painel do sumario: filtro, "recolher tudo" e o toc desenhado
  // (o arrastar precisa das linhas de cada titulo).
  var sumario = { filtro: '', recolhido: false, toc: [], tabId: null, arrasto: null, desfazer: null };

  function recolheSumario(recolher) {
    var nos = $('outline').querySelectorAll('.outline-node');
    for (var i = 0; i < nos.length; i++) {
      if (nos[i].querySelector('.outline-children')) nos[i].classList.toggle('is-collapsed', recolher);
    }
  }

  function alternaRecolherSumario() {
    sumario.recolhido = !sumario.recolhido;
    recolheSumario(sumario.recolhido);
    var b = $('btnOutlineCollapse');
    if (b) {
      b.title = sumario.recolhido ? t('Expandir tudo') : t('Recolher tudo');
      b.classList.toggle('is-on', sumario.recolhido);
    }
  }

  function alternaFiltroSumario(forca) {
    var linha = $('outlineFilterRow');
    var abrir = forca === undefined ? linha.hidden : forca;
    linha.hidden = !abrir;
    $('btnOutlineFilter').classList.toggle('is-on', abrir);
    if (abrir) { $('outlineFilterInput').focus(); $('outlineFilterInput').select(); }
    else if (sumario.filtro) { sumario.filtro = ''; $('outlineFilterInput').value = ''; renderOutline(); }
  }

  /*
   * Arrastar um titulo do sumario move a secao inteira (o titulo e tudo ate o
   * proximo titulo de nivel igual ou maior), como no Obsidian. So com a nota
   * destravada: mover secao e editar. O nivel dos titulos nao muda.
   */
  function fimDaSecao(toc, i, total) {
    for (var k = i + 1; k < toc.length; k++) if (toc[k].level <= toc[i].level) return toc[k].line;
    return total;
  }

  function moveSecao(tab, de, para, depois) {
    var toc = sumario.toc;
    var linhas = tab.content.split('\n');
    var a = toc[de].line, b = fimDaSecao(toc, de, linhas.length);
    var alvo = depois ? fimDaSecao(toc, para, linhas.length) : toc[para].line;
    if (alvo >= a && alvo <= b) return false;   // dentro dela mesma

    var bloco = linhas.slice(a, b);
    // A secao que era a ultima pode nao ter linha em branco no fim: sem ela o
    // titulo seguinte grudaria no texto.
    if (bloco.length && bloco[bloco.length - 1].trim() !== '') bloco.push('');
    linhas.splice(a, b - a);
    if (alvo > a) alvo -= (b - a);
    if (alvo > 0 && alvo === linhas.length && linhas[alvo - 1].trim() !== '') linhas.push(''), alvo++;
    Array.prototype.splice.apply(linhas, [alvo, 0].concat(bloco));
    // Nao deixa linhas em branco sobrando no fim por causa do bloco movido.
    while (linhas.length > 1 && linhas[linhas.length - 1] === '' && linhas[linhas.length - 2] === '') linhas.pop();

    var novo = linhas.join('\n');
    if (novo === tab.content) return false;
    var antes = tab.content;
    if (!tab.locked && ed && ed.aba === tab) {
      ed.trocaTexto(novo);   // o Ctrl+Z do editor desfaz
    } else {
      tab.content = novo;
      scheduleBackup(tab);
      renderAll();
      sumario.desfazer = { tabId: tab.id, antes: antes, depois: novo };
    }
    toast(t('Seção movida. Ctrl+Z desfaz.'), 'ok', 2200);
    return true;
  }

  /** Ctrl+Z fora de campo de texto logo depois de mover uma secao. */
  function desfazMoverSecao() {
    var d = sumario.desfazer;
    var tab = activeTab();
    if (!d || !tab || tab.id !== d.tabId || tab.content !== d.depois || tab.locked) return false;
    tab.content = d.antes;
    sumario.desfazer = null;
    scheduleBackup(tab);
    renderAll();
    toast(t('Desfeito.'), '', 1600);
    return true;
  }

  // ------------------------------------------------- operacoes com linhas
  //
  // Ordenar, remover duplicadas, unir, aparar, recuo, maiusculas: as funcoes
  // puras moram em textops.js (testadas no node). Aqui so se aplica: no
  // editor que tem o foco (codigo-fonte ou o bloco aberto no modo ao vivo),
  // pelo insertText, para o Ctrl+Z do proprio editor desfazer; sem editor
  // aberto, no documento inteiro, com o Ctrl+Z de fora desfazendo.

  function editorEmUso() {
    var tab = activeTab();
    return tab && !tab.locked && ed && ed.aba === tab ? ed : null;
  }

  /*
   * `fn(texto, ini, fim)` devolve { ini, fim, texto, selIni, selFim } ou null.
   * `soNoEditor`: precisa de cursor (duplicar, mover, unir, caixa) e nao faz
   * sentido no documento inteiro.
   */
  function aplicaOperacao(nome, fn, soNoEditor) {
    var tab = activeTab();
    if (!tab) return;
    if (tab.locked) { toast(t('Edicao travada. Ctrl+E para liberar.'), 'warn', 2000); return; }
    var edUso = editorEmUso();
    if (edUso) {
      var texto = edUso.texto(), sl = edUso.selecao();
      var r = fn(texto, sl.inicio, sl.fim);
      if (!r || r.texto === texto.slice(r.ini, r.fim)) { toast(t('Nada a mudar.'), '', 1400); return; }
      edUso.troca(r.ini, r.fim, r.texto, r.selIni, r.selFim);
      edUso.foco();
      return;
    }
    if (soNoEditor) { toast(t('Abra um bloco para editar (ou use o modo fonte) e tente de novo.'), 'warn', 2600); return; }
    var antes = tab.content;
    var r2 = fn(antes, 0, antes.length);
    var depois = r2 ? antes.slice(0, r2.ini) + r2.texto + antes.slice(r2.fim) : antes;
    if (depois === antes) { toast(t('Nada a mudar.'), '', 1400); return; }
    tab.content = depois;
    scheduleBackup(tab);
    renderAll();
    sumario.desfazer = { tabId: tab.id, antes: antes, depois: depois };
    toast(t('{op}: feito. Ctrl+Z desfaz.', { op: nome }), 'ok', 2200);
  }

  function opLinhas(nome) {
    var T = window.MarkPadTextOps;
    var tabela = {
      az: [t('Ordenar linhas (A a Z)'), function (x, a, b) { return T.ordenaLinhas(x, a, b, 'az'); }],
      za: [t('Ordenar linhas (Z a A)'), function (x, a, b) { return T.ordenaLinhas(x, a, b, 'za'); }],
      tamanho: [t('Ordenar linhas por tamanho'), function (x, a, b) { return T.ordenaLinhas(x, a, b, 'tamanho'); }],
      inverter: [t('Inverter a ordem das linhas'), function (x, a, b) { return T.ordenaLinhas(x, a, b, 'inverter'); }],
      lista: [t('Ordenar itens da lista (com os subitens)'), function (x, a, b) { return T.ordenaLista(x, a, b, 'az'); }],
      duplicadas: [t('Remover linhas duplicadas'), function (x, a, b) { return T.removeDuplicadas(x, a, b, false); }],
      seguidas: [t('Remover duplicadas seguidas'), function (x, a, b) { return T.removeDuplicadas(x, a, b, true); }],
      reduzVazias: [t('Reduzir linhas vazias seguidas a uma'), T.reduzVazias],
      vazias: [t('Remover linhas vazias'), T.removeVazias],
      aparar: [t('Aparar espaços no fim das linhas'), T.aparaDireita],
      tabEspaco: [t('Recuo: TAB para espaços'), function (x, a, b) { return T.trocaRecuo(x, a, b, true, 4); }],
      espacoTab: [t('Recuo: espaços para TAB'), function (x, a, b) { return T.trocaRecuo(x, a, b, false, 4); }]
    };
    var op = tabela[nome];
    if (op) aplicaOperacao(op[0], op[1], false);
  }

  /** Os atalhos do Notepad++ nas linhas. true se tratou a tecla. */
  function atalhoDeLinha(e) {
    var T = window.MarkPadTextOps;
    var ctrl = e.ctrlKey || e.metaKey;
    var k = (e.key || '').toLowerCase();
    var feito = null;
    if (ctrl && !e.shiftKey && !e.altKey && k === 'd') feito = function () { aplicaOperacao(t('Duplicar'), T.duplica, true); };
    else if (ctrl && !e.shiftKey && !e.altKey && k === 'j') feito = function () { aplicaOperacao(t('Unir linhas'), T.unirLinhas, true); };
    else if (ctrl && !e.shiftKey && !e.altKey && k === 'u') feito = function () { aplicaOperacao(t('minúsculas'), function (x, a, b) { return T.trocaCaixa(x, a, b, 'minusculas'); }, true); };
    else if (ctrl && e.shiftKey && !e.altKey && k === 'u') feito = function () { aplicaOperacao(t('MAIÚSCULAS'), function (x, a, b) { return T.trocaCaixa(x, a, b, 'maiusculas'); }, true); };
    else if (ctrl && e.shiftKey && !e.altKey && k === 'k') feito = function () { aplicaOperacao(t('Apagar linha'), T.apagaLinhas, true); };
    else if ((e.altKey && !ctrl && !e.shiftKey || ctrl && e.shiftKey && !e.altKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      var dir = e.key === 'ArrowUp' ? -1 : 1;
      feito = function () { aplicaOperacao(t('Mover linhas'), function (x, a, b) { return T.moveLinhas(x, a, b, dir); }, true); };
    }
    if (!feito) return false;
    e.preventDefault();
    e.stopPropagation();
    feito();
    return true;
  }

  /*
   * Notas de rodape do documento (o painel Footnotes do Obsidian), embaixo do
   * sumario: a definicao [^x]: e quantas vezes e citada. Clique leva a ela.
   */
  function desenhaRodapes(tab, box) {
    var linhas = tab.content.split('\n');
    var notas = [], cerca = null;
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      var f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!cerca) cerca = f[1].charAt(0); else if (f[1].charAt(0) === cerca) cerca = null; continue; }
      if (cerca) continue;
      var m = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(l);
      if (m) notas.push({ id: m[1].toLowerCase(), rotulo: m[1], texto: m[2], line: i });
    }
    if (!notas.length) return;
    var corpo = tab.content;
    var sec = document.createElement('div');
    sec.className = 'rodapes-sumario';
    var cab = document.createElement('div');
    cab.className = 'rodapes-cab';
    cab.textContent = t('Notas de rodapé') + ' · ' + notas.length;
    sec.appendChild(cab);
    notas.forEach(function (n) {
      var vezes = 0, re = new RegExp('\\[\\^' + n.rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\](?!:)', 'gi');
      while (re.exec(corpo)) vezes++;
      var row = document.createElement('div');
      row.className = 'rodape-item';
      var rot = document.createElement('span');
      rot.className = 'rodape-rotulo';
      rot.textContent = n.rotulo;
      var txt = document.createElement('span');
      txt.className = 'rodape-texto';
      txt.textContent = n.texto || '…';
      row.appendChild(rot);
      row.appendChild(txt);
      if (!vezes) {
        var sem = document.createElement('span');
        sem.className = 'rodape-sem';
        sem.textContent = t('sem citação');
        row.appendChild(sem);
      }
      row.title = n.texto;
      row.onclick = function () {
        var el = modoDe(tab) !== 'fonte' ? $('preview').querySelector('#fn-' + CSS.escape(n.id)) : null;
        if (el) { el.scrollIntoView({ block: 'center' }); piscaAlvo(el); }
        else goToLine(n.line + 1);
      };
      sec.appendChild(row);
    });
    box.appendChild(sec);
  }

  function desenhaNos(nos, profundidade) {
    var frag = document.createDocumentFragment();

    nos.forEach(function (no) {
      var wrapper = document.createElement('div');
      wrapper.className = 'outline-node';

      var linha = document.createElement('div');
      linha.className = 'outline-row lv' + no.level;
      linha.style.setProperty('--depth', profundidade);
      linha.setAttribute('data-line', String(no.line));
      linha.title = no.text;

      var twist = document.createElement('span');
      twist.className = 'outline-twist';
      if (no.filhos.length) {
        var chev = window.MarkPadIcons.build('chevron-down', 12);
        if (chev) twist.appendChild(chev);
        twist.onclick = function (e) {
          e.stopPropagation();
          wrapper.classList.toggle('is-collapsed');
        };
      }
      linha.appendChild(twist);

      var texto = document.createElement('span');
      texto.className = 'outline-text';
      if (sumario.filtro && no.casou) texto.appendChild(marcaFuzzy(no.text, sumario.filtro));
      else texto.textContent = no.text;
      linha.appendChild(texto);

      // Arrastar move a secao (so destravada).
      var abaDoSumario = activeTab();
      if (abaDoSumario && !abaDoSumario.locked && !sumario.filtro) {
        linha.draggable = true;
        linha.ondragstart = function (e) {
          sumario.arrasto = no.indice;
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', no.text); } catch (x) {}
          linha.classList.add('is-arrastando');
        };
        linha.ondragend = function () {
          sumario.arrasto = null;
          linha.classList.remove('is-arrastando');
          var alvos = $('outline').querySelectorAll('.alvo-antes, .alvo-depois');
          for (var i = 0; i < alvos.length; i++) alvos[i].classList.remove('alvo-antes', 'alvo-depois');
        };
        linha.ondragover = function (e) {
          if (sumario.arrasto === null || sumario.arrasto === no.indice) return;
          e.preventDefault();
          var r = linha.getBoundingClientRect();
          var depois = e.clientY > r.top + r.height / 2;
          linha.classList.toggle('alvo-antes', !depois);
          linha.classList.toggle('alvo-depois', depois);
        };
        linha.ondragleave = function () { linha.classList.remove('alvo-antes', 'alvo-depois'); };
        linha.ondrop = function (e) {
          e.preventDefault();
          var de = sumario.arrasto;
          var depois = linha.classList.contains('alvo-depois');
          linha.classList.remove('alvo-antes', 'alvo-depois');
          sumario.arrasto = null;
          var aba = activeTab();
          if (de === null || !aba || aba.id !== sumario.tabId || aba.locked) return;
          if (!moveSecao(aba, de, no.indice, depois)) toast(t('Uma seção não cabe dentro dela mesma.'), 'warn', 2000);
        };
      }

      linha.onclick = function () { goToLine(no.line + 1); };
      linha.oncontextmenu = function (e) {
        e.preventDefault();
        var tab = activeTab();
        showMenu([
          { label: t('Marcar este título'), icon: 'bookmark', disabled: !(tab && tab.path), action: function () { marcaTitulo(tab.path, no.text); } },
          { label: t('Copiar link para o título'), icon: 'link', disabled: !(tab && tab.path), action: function () {
              navigator.clipboard.writeText('[[' + semExtensao(tab.name) + '#' + no.text + ']]');
              toast(t('Link copiado.'), 'ok', 1200);
            } }
        ], e.clientX, e.clientY);
      };
      wrapper.appendChild(linha);

      if (no.filhos.length) {
        var filhos = document.createElement('div');
        filhos.className = 'outline-children';
        filhos.appendChild(desenhaNos(no.filhos, profundidade + 1));
        wrapper.appendChild(filhos);
      }

      frag.appendChild(wrapper);
    });

    return frag;
  }

  /** Destaca no sumário o título da seção que está no topo da leitura. */
  function marcaSecaoAtual() {
    var tab = activeTab();
    if (!tab) return;

    if (!tab.locked && ed && ed.aba === tab) {
      var topoEd = ed.linhaNoTopo();
      var linhaSec = null;
      (sumario.toc || []).forEach(function (h) { if (h.line <= topoEd + 1) linhaSec = h.line; });
      var todas = $('outline').querySelectorAll('.outline-row');
      for (var q = 0; q < todas.length; q++) todas[q].classList.remove('is-current');
      if (linhaSec === null) return;
      var alvoEd = $('outline').querySelector('.outline-row[data-line="' + linhaSec + '"]');
      if (alvoEd) alvoEd.classList.add('is-current');
      return;
    }
    var container = tab.locked ? $('preview') : null;
    if (!container) return;

    var scroller = $('readingScroll');
    var topo = scroller.getBoundingClientRect().top;
    var atual = null;

    var titulos = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
    for (var i = 0; i < titulos.length; i++) {
      // Titulo vindo de embed nao tem data-line e nao existe no sumario.
      if (!titulos[i].hasAttribute('data-line')) continue;
      if (titulos[i].getBoundingClientRect().top - topo <= 40) atual = titulos[i];
      else break;
    }

    var linhas = $('outline').querySelectorAll('.outline-row');
    for (var j = 0; j < linhas.length; j++) linhas[j].classList.remove('is-current');
    if (!atual) return;

    var alvo = $('outline').querySelector('.outline-row[data-line="' + atual.getAttribute('data-line') + '"]');
    if (alvo) alvo.classList.add('is-current');
  }

  // ======================================================== painel lateral

  function setFolder(path, quiet) {
    app.folder = path;
    invalidateFileIndex();
    $('folderName').textContent = path ? path.split(/[\\/]/).pop() : t('nenhuma pasta aberta');
    $('folderName').title = path || '';
    refreshTree();
    if (settings.sidebarPane === 'tags') renderTags();
    if (!quiet) persist();
  }

  function renderTreeFilter() {
    var b = $('btnTreeFilter');
    b.textContent = settings.treeOnlyMarkdown ? '.md' : 'tudo';
    b.classList.toggle('is-on', !!settings.treeOnlyMarkdown);
    b.title = settings.treeOnlyMarkdown
      ? t('Mostrando só markdown — clique para ver todos os arquivos')
      : t('Mostrando todos os arquivos — clique para ver só markdown');
  }

  var ORDENS = [
    { id: 'nome-asc',    rotulo: t('Nome (A a Z)') },
    { id: 'nome-desc',   rotulo: t('Nome (Z a A)') },
    { id: 'mod-desc',    rotulo: t('Modificado (recente primeiro)') },
    { id: 'mod-asc',     rotulo: t('Modificado (antigo primeiro)') },
    { id: 'criado-desc', rotulo: t('Criado (recente primeiro)') },
    { id: 'criado-asc',  rotulo: t('Criado (antigo primeiro)') }
  ];

  /*
   * Ordem natural: "cap 2" vem antes de "cap 10". O localeCompare com
   * numeric faz isso sozinho; sem ele a lista sai em ordem de tabela ASCII,
   * que e o tipo de detalhe que so incomoda depois do decimo arquivo.
   */
  function comparaNome(a, b) {
    return a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
  }

  function ordenaEntradas(lista) {
    var ordem = settings.treeSort || 'nome-asc';
    var copia = lista.slice();

    copia.sort(function (a, b) {
      if (settings.treeFoldersFirst !== false && !!a.dir !== !!b.dir) return a.dir ? -1 : 1;

      switch (ordem) {
        case 'nome-desc':   return -comparaNome(a, b);
        case 'mod-desc':    return (b.mtime || 0) - (a.mtime || 0) || comparaNome(a, b);
        case 'mod-asc':     return (a.mtime || 0) - (b.mtime || 0) || comparaNome(a, b);
        case 'criado-desc': return (b.ctime || 0) - (a.ctime || 0) || comparaNome(a, b);
        case 'criado-asc':  return (a.ctime || 0) - (b.ctime || 0) || comparaNome(a, b);
        default:            return comparaNome(a, b);
      }
    });
    return copia;
  }

  function rotuloOrdem() {
    var achado = ORDENS.filter(function (o) { return o.id === (settings.treeSort || 'nome-asc'); })[0];
    return achado ? achado.rotulo : ORDENS[0].rotulo;
  }

  function treeSortMenu(x, y) {
    var itens = ORDENS.map(function (o) {
      return {
        label: o.rotulo,
        icon: 'sort',
        checked: (settings.treeSort || 'nome-asc') === o.id,
        action: function () { settings.treeSort = o.id; refreshTree(); persist(); }
      };
    });
    itens.push('-');
    itens.push({
      label: t('Pastas antes dos arquivos'),
      icon: 'folder',
      checked: settings.treeFoldersFirst !== false,
      action: function () {
        settings.treeFoldersFirst = settings.treeFoldersFirst === false;
        refreshTree();
        persist();
      }
    });
    showMenu(itens, x, y);
  }

  /* Recolher tudo sem reler o disco: o aberto/fechado vive em app.treeOpen. */
  function collapseTree() {
    app.treeOpen = Object.create(null);
    refreshTree();
    persist();
  }

  // ---------------------------------------------------- indice de arquivos

  /*
   * O filtro do painel e o seletor rapido precisam enxergar a pasta inteira,
   * nao so os galhos que o usuario ja expandiu. Este indice e um passeio
   * unico pela pasta guardando caminho, nome e datas — nunca conteudo.
   */
  /*
   * O indice guarda a pasta inteira, mas o watchFile segue um arquivo por
   * vez: arquivo criado, renomeado ou apagado por fora do MarkPad nunca
   * chegava aqui, e o Ctrl+P seguia oferecendo o nome antigo ate reabrir a
   * pasta. Um minuto e o meio-termo — barato para quem so digita, curto
   * para quem salvou algo no Explorer e ja volta a procurar por nome.
   */
  var INDICE_VALIDADE_MS = 60000;

  function fileIndex() {
    if (!app.folder) return Promise.resolve([]);
    var fresco = (Date.now() - (app.indiceEm || 0)) < INDICE_VALIDADE_MS;
    if (app.indiceDe === app.folder && app.indice && fresco) return app.indice;
    app.indiceDe = app.folder;
    app.indiceEm = Date.now();
    app.indice = bridge.call('listFiles', { root: app.folder })
      .then(function (d) { return (d && d.files) || []; })
      .catch(function () { return []; });
    return app.indice;
  }

  /*
   * O indice de links (web/linkindex.js): quem aponta para quem na pasta.
   * O C# devolve a lista da pasta com o texto so das notas que mudaram desde
   * a ultima vez (`known` = caminho -> mtime do que ja foi analisado aqui),
   * em lotes: nota que nao coube volta `pending` e a volta seguinte pede de
   * novo, com a janela livre entre um lote e outro. A analise de cada nota
   * fica guardada entre varreduras. Vale o mesmo minuto do indice de
   * arquivos; salvar, renomear, mover ou o disco mudar por fora derrubam antes.
   */
  var LINKS_VALIDADE_MS = 60000;

  function indiceLinks() {
    if (!app.folder || !window.MarkPadLinkIndex) return Promise.resolve(null);
    var fresco = (Date.now() - (app.linksEm || 0)) < LINKS_VALIDADE_MS;
    if (app.linksDe === app.folder && app.links && fresco) return app.links;

    var LI = window.MarkPadLinkIndex;
    var pasta = app.folder;
    var antigo = app.linkCache && app.linkCache.raiz === pasta ? app.linkCache.notas : {};
    var notas = {};

    function caminhoDe(raiz, rel) {
      return String(raiz).replace(/[\\/]+$/, '') + '\\' + String(rel).replace(/\//g, '\\');
    }

    function volta(n) {
      var known = {};
      Object.keys(antigo).forEach(function (k) { if (!notas[k]) known[antigo[k].path] = antigo[k].mtime; });
      Object.keys(notas).forEach(function (k) { known[notas[k].path] = notas[k].mtime; });

      return bridge.call('indexFolder', { root: pasta, known: known }).then(function (res) {
        var arquivos = ((res && res.files) || []).map(function (f) {
          var caminho = caminhoDe(res.root, f.rel);
          var k = caminho.toLowerCase();
          var analise = null;
          if (f.md) {
            if (typeof f.text === 'string') analise = LI.analisa(f.text);
            else if (notas[k] && notas[k].mtime === f.mtime) analise = notas[k].analise;
            else if (antigo[k] && antigo[k].mtime === f.mtime) analise = antigo[k].analise;
            if (analise) notas[k] = { path: caminho, mtime: f.mtime, analise: analise };
          }
          return { path: caminho, rel: f.rel, md: !!f.md, analise: analise };
        });

        // Ainda tem nota esperando lote: solta a janela um instante e pede de
        // novo. O teto de voltas so existe para nao girar para sempre se o
        // disco mudar mais depressa do que se le.
        if (res && res.pending > 0 && n < 40) {
          return new Promise(function (ok) { setTimeout(ok, 0); }).then(function () { return volta(n + 1); });
        }

        app.linkCache = { raiz: pasta, notas: notas };
        var idx = LI.cria(arquivos);
        idx.truncado = !!(res && (res.truncated || res.pending > 0));
        return idx;
      });
    }

    app.linksDe = pasta;
    app.linksEm = Date.now();
    app.links = volta(0).catch(function () {
      app.links = null;   // a proxima pergunta tenta de novo
      return null;
    });
    return app.links;
  }

  function invalidaLinks() {
    app.links = null;
    app.linksEm = 0;
  }

  function invalidateFileIndex() {
    invalidaLinks();
    app.indice = null;
    app.indiceDe = null;
    app.indiceEm = 0;
    app.tags = null;
    app.tagsDe = null;
  }

  /*
   * Criou, renomeou, moveu, duplicou ou apagou: a arvore muda e o indice
   * tambem. Redesenhar so a arvore deixava o Ctrl+P, o filtro por nome e o
   * painel de tags oferecendo o nome velho — e abrir esse item dava erro.
   */
  function arvoreMudou() {
    invalidateFileIndex();
    refreshTree();
  }

  /*
   * Nota fuzzy: as letras da consulta precisam aparecer na ordem, mas nao
   * coladas. Letra emendada na anterior vale mais, letra que abre palavra
   * vale mais ainda — e assim "cmd" acha "casa/meu-doc.md" acima de um
   * arquivo que so tem c, m e d espalhados.
   */
  /* "árvore" e "arvore" sao a mesma busca: tira os acentos (NFD + marcas). */
  function semAcento(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function fuzzyScore(consulta, texto) {
    var q = semAcento(consulta).toLowerCase();
    var t = semAcento(texto).toLowerCase();
    if (!q) return 0;

    var pontos = 0, cursor = 0, ultimo = -2, seguidos = 0;

    for (var j = 0; j < q.length; j++) {
      var c = q.charAt(j);
      if (c === ' ') continue;
      var achou = t.indexOf(c, cursor);
      if (achou === -1) return -Infinity;  // sentinela: nota valida pode ser negativa

      if (achou === ultimo + 1) { seguidos++; pontos += 6 + seguidos * 2; }
      else { seguidos = 0; pontos += 1; }

      if (achou === 0 || SEPARADOR.test(t.charAt(achou - 1))) pontos += 8;

      ultimo = achou;
      cursor = achou + 1;
    }
    return pontos - Math.max(0, t.length - q.length) * 0.05;
  }

  /* Devolve o texto com as letras casadas em <b>, sem passar por innerHTML. */
  function marcaFuzzy(texto, consulta) {
    var frag = document.createDocumentFragment();
    var q = semAcento(consulta).toLowerCase().replace(/\s+/g, '');
    var t = String(texto || '');
    if (!q) { frag.appendChild(document.createTextNode(t)); return frag; }

    // Sem acento para comparar, mas com o mesmo comprimento do original (se a
    // normalizacao mudar o tamanho, compara o original mesmo).
    var baixo = semAcento(t).toLowerCase();
    if (baixo.length !== t.length) baixo = t.toLowerCase();
    var j = 0, buffer = '';

    for (var i = 0; i < t.length; i++) {
      if (j < q.length && baixo.charAt(i) === q.charAt(j)) {
        if (buffer) { frag.appendChild(document.createTextNode(buffer)); buffer = ''; }
        var b = document.createElement('b');
        b.textContent = t.charAt(i);
        frag.appendChild(b);
        j++;
      } else {
        buffer += t.charAt(i);
      }
    }
    if (buffer) frag.appendChild(document.createTextNode(buffer));
    return frag;
  }

  /* Pontua nome e caminho, com o caminho valendo menos que o nome do arquivo. */
  function pontuaArquivo(consulta, f) {
    var nota = fuzzyScore(consulta, f.name);
    if (nota !== -Infinity) return nota;
    nota = fuzzyScore(consulta, f.rel || f.path);
    // A penalidade so precisa manter o casamento por caminho ABAIXO de
    // qualquer casamento por nome; nao e um corte, e um desempate.
    return nota === -Infinity ? -Infinity : nota - 1000;
  }

  function filtraArquivos(consulta, arquivos) {
    var achados = [];
    arquivos.forEach(function (f) {
      var nota = pontuaArquivo(consulta, f);
      if (nota === -Infinity) return;
      achados.push({ f: f, nota: nota });
    });
    achados.sort(function (a, b) { return b.nota - a.nota || comparaNome(a.f, b.f); });
    return achados;
  }

  function pastaDe(f) {
    return String(f.rel || f.path || '').split(BARRA).slice(0, -1).join('/');
  }

  // ------------------------------------------------------ filtro do painel

  var treeFilterTimer = null;

  function toggleTreeFilter(force) {
    var linha = $('treeFilterRow');
    var campo = $('treeFilterInput');
    var abrir = force === undefined ? linha.hidden : force;

    linha.hidden = !abrir;
    $('btnTreeSearch').classList.toggle('is-on', abrir);

    if (abrir) {
      campo.focus();
      campo.select();
      return;
    }

    // Fechar cancela o debounce pendente: sem isso, Esc antes dos 160ms deixa
    // o timer acordar depois e filtrar a arvore com a caixa ja escondida.
    clearTimeout(treeFilterTimer);
    campo.value = '';
    if (app.treeFilter) {
      app.treeFilter = '';
      refreshTree();
    }
  }

  /*
   * Com filtro ligado a arvore vira lista rasa: hierarquia atrapalha quando
   * o que se quer e "onde esta esse nome". A pasta de origem vai junto, em
   * letra menor, para nao perder a referencia.
   */
  function renderTreeFlat(box) {
    box.textContent = '';

    var carregando = document.createElement('p');
    carregando.className = 'pane-empty';
    carregando.textContent = t('Procurando...');
    box.appendChild(carregando);

    var consulta = app.treeFilter;

    fileIndex().then(function (arquivos) {
      if (app.treeFilter !== consulta) return;
      box.textContent = '';

      var visiveis = arquivos.filter(function (f) {
        return !settings.treeOnlyMarkdown || f.markdown;
      });
      var achados = filtraArquivos(consulta, visiveis);

      if (!achados.length) {
        var vazio = document.createElement('p');
        vazio.className = 'pane-empty';
        vazio.textContent = t('Nenhum arquivo com esse nome.');
        box.appendChild(vazio);
        return;
      }

      var limite = Math.min(achados.length, 300);
      for (var i = 0; i < limite; i++) {
        box.appendChild(linhaRasa(achados[i].f, consulta));
      }

      if (achados.length > limite) {
        var mais = document.createElement('p');
        mais.className = 'pane-empty';
        mais.textContent = t('e mais ') + (achados.length - limite) + ' — refine o filtro.';
        box.appendChild(mais);
      }
      markTreeActive();
    });
  }

  function linhaRasa(f, consulta) {
    var row = document.createElement('div');
    row.className = 'tree-item is-flat';
    row.style.setProperty('--indent', '6px');
    row.setAttribute('data-path', f.path);
    row.title = f.path;

    var icon = document.createElement('span');
    icon.className = 'twist';
    var ic = window.MarkPadIcons.build('file-text', 13);
    if (ic) icon.appendChild(ic);
    row.appendChild(icon);

    var name = document.createElement('span');
    name.className = 'tree-name';
    name.appendChild(marcaFuzzy(f.name, consulta));
    row.appendChild(name);

    var pasta = pastaDe(f);
    if (pasta) {
      var sub = document.createElement('span');
      sub.className = 'tree-sub';
      sub.textContent = pasta;
      row.appendChild(sub);
    }

    row.onclick = function () { openPath(f.path); };
    row.oncontextmenu = function (e) {
      e.preventDefault();
      showMenu(fileContextMenu(f.path), e.clientX, e.clientY);
    };
    return row;
  }

  // ------------------------------------------------------- seletor rapido

  /*
   * Ctrl+P: abre um arquivo da pasta so pelo nome. Sem pasta aberta ele cai
   * na lista de recentes, que e a unica coisa que ele tem para oferecer.
   */
  function openSwitcher(opcoes) {
    opcoes = opcoes || {};
    var box = $('switcher');
    var input = $('switcherInput');
    var listEl = $('switcherList');
    var escolha = opcoes.escolhe || function (f) { openPath(f.path); };
    if (!openSwitcher.dicaPadrao) openSwitcher.dicaPadrao = input.placeholder;
    input.placeholder = opcoes.dica || openSwitcher.dicaPadrao;
    var fonte = [];
    var filtrados = [];
    var active = 0;

    function linhas(consulta) {
      if (!consulta) return fonte.slice(0, 60);
      return filtraArquivos(consulta, fonte).slice(0, 60).map(function (x) { return x.f; });
    }

    function draw() {
      listEl.textContent = '';

      if (!filtrados.length) {
        var vazio = document.createElement('div');
        vazio.className = 'palette-item is-empty';
        vazio.textContent = opcoes.vazio && !input.value.trim() ? opcoes.vazio
          : app.folder ? t('Nenhum arquivo com esse nome.')
          : t('Abra uma pasta para procurar por nome.');
        listEl.appendChild(vazio);
        return;
      }

      filtrados.forEach(function (f, i) {
        var el = document.createElement('div');
        el.className = 'palette-item' + (i === active ? ' is-active' : '');

        var ic = document.createElement('span');
        ic.className = 'pal-icon';
        var svg = window.MarkPadIcons.build(f.icone || opcoes.icone || 'file-text', 15);
        if (svg) ic.appendChild(svg);
        el.appendChild(ic);

        var nome = document.createElement('span');
        nome.appendChild(marcaFuzzy(f.name, input.value.trim()));
        el.appendChild(nome);

        var pasta = f.sub != null ? f.sub : f.apelidoDe ? '→ ' + f.apelidoDe : pastaDe(f);
        if (pasta) {
          var sub = document.createElement('span');
          sub.className = 'pal-sub';
          sub.textContent = pasta;
          el.appendChild(sub);
        }

        el.onclick = function () { fechar(); escolha(f); };
        el.onmousemove = function () { if (active !== i) { active = i; draw(); } };
        listEl.appendChild(el);
      });

      var cur = listEl.children[active];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function fechar() {
      box.hidden = true;
      $('overlay').hidden = true;
      document.removeEventListener('keydown', onKey, true);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtrados.length - 1); draw(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        var f = filtrados[active];
        fechar();
        if (f) escolha(f);
      }
    }

    input.value = '';
    input.oninput = function () {
      filtrados = linhas(input.value.trim());
      active = 0;
      draw();
    };

    box.hidden = false;
    $('overlay').hidden = false;
    $('overlay').onclick = fechar;
    document.addEventListener('keydown', onKey, true);
    input.focus();
    draw();

    var pronto = app.folder
      ? fileIndex().then(function (arquivos) {
          // "Painel: so arquivos markdown" vem ligado de fabrica e manda na
          // arvore — nao na busca. Filtrando aqui tambem, o Ctrl+P respondia
          // "Nenhum arquivo com esse nome" para arquivo que existe, esta na
          // pasta e abre normalmente pela arvore com o filtro desligado.
          // Markdown na frente, o resto atras: a preferencia continua dita,
          // o alcance deixa de ser recortado.
          var md = [], resto = [];
          arquivos.forEach(function (f) { (f.markdown ? md : resto).push(f); });
          return md.concat(resto);
        })
      : Promise.resolve((settings.recent || []).map(function (caminho) {
          return { name: caminho.split(BARRA).pop(), path: caminho, rel: caminho, markdown: true };
        }));

    if (opcoes.lista) pronto = Promise.resolve(opcoes.lista);

    pronto.then(function (arquivos) {
      if (box.hidden) return;
      fonte = opcoes.filtro ? arquivos.filter(opcoes.filtro) : arquivos;
      filtrados = linhas(input.value.trim());
      draw();
      return app.folder && !opcoes.lista ? indiceLinks() : null;
    }).then(function (idx) {
      // Os apelidos do frontmatter (aliases:) tambem acham a nota, como no
      // Obsidian. Vao no fim da fonte: so aparecem quando se digita.
      if (!idx || box.hidden) return;
      var apelidos = [];
      idx.arquivos.forEach(function (a) {
        if (!a.analise) return;
        a.analise.apelidos.forEach(function (ap) {
          apelidos.push({ name: ap, rel: ap, path: a.path, markdown: true, apelidoDe: baseName(a.path) });
        });
      });
      if (!apelidos.length) return;
      fonte = fonte.concat(apelidos);
      if (input.value.trim()) { filtrados = linhas(input.value.trim()); draw(); }
    });
  }

  function refreshTree() {
    var box = $('fileTree');
    if (!app.folder) {
      box.innerHTML = '<p class="pane-empty">Abra uma pasta para navegar pelos arquivos.<br>Nao precisa de cofre.</p>';
      return;
    }
    if (app.treeFilter) { renderTreeFlat(box); return; }
    box.textContent = '';
    buildTree(app.folder, box, 0);
  }

  function buildTree(dirPath, container, depth) {
    return bridge.call('listDir', { path: dirPath }).then(function (data) {
      var visiveis = ordenaEntradas(data.entries.filter(function (e) {
        return e.dir || !settings.treeOnlyMarkdown || e.markdown;
      }));

      if (!visiveis.length && depth === 0) {
        var aviso = document.createElement('p');
        aviso.className = 'pane-empty';
        aviso.textContent = settings.treeOnlyMarkdown
          ? t('Nenhum arquivo .md aqui. Toque no filtro acima para ver todos.')
          : t('Pasta vazia.');
        container.appendChild(aviso);
        return;
      }

      visiveis.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'tree-item';
        row.style.setProperty('--indent', (6 + depth * 13) + 'px');
        row.setAttribute('data-path', entry.path);
        row.title = entry.path;

        var twist = document.createElement('span');
        twist.className = 'twist';
        if (entry.dir) {
          var chev = window.MarkPadIcons.build('chevron-right', 13);
          if (chev) twist.appendChild(chev);
        }
        row.appendChild(twist);

        var icon = document.createElement('span');
        icon.className = 'twist';
        // Pasta aberta merece icone de pasta aberta: o triangulo da esquerda
        // ja diz o estado, mas o icone dizia o contrario dele.
        var glifo = entry.dir
          ? (app.treeOpen[entry.path] ? 'folder-open' : 'folder')
          : 'file-text';
        var ic = window.MarkPadIcons.build(glifo, 13);
        if (ic) icon.appendChild(ic);
        row.appendChild(icon);

        var name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = entry.name;
        row.appendChild(name);

        container.appendChild(row);
        ligaArrastoNaArvore(row, entry);

        if (entry.dir) {
          var children = document.createElement('div');
          children.className = 'tree-children';
          children.hidden = true;
          container.appendChild(children);

          row.onclick = function () {
            var open = !children.hidden;
            if (open) {
              children.hidden = true;
              twist.firstChild && twist.firstChild.classList && twist.firstChild.classList.remove('is-open');
              twist.classList.remove('is-open');
              delete app.treeOpen[entry.path];
              trocaGlifo(icon, 'folder');
            } else {
              children.hidden = false;
              twist.classList.add('is-open');
              app.treeOpen[entry.path] = true;
              trocaGlifo(icon, 'folder-open');
              if (!children.__loaded) { children.__loaded = true; buildTree(entry.path, children, depth + 1); }
            }
          };

          if (app.treeOpen[entry.path]) row.onclick();
          row.oncontextmenu = function (e) {
            e.preventDefault();
            showMenu(menuDaPasta(entry.path), e.clientX, e.clientY);
          };
        } else {
          row.onclick = function () { openPath(entry.path); };
          row.oncontextmenu = function (e) {
            e.preventDefault();
            showMenu(fileContextMenu(entry.path), e.clientX, e.clientY);
          };
        }
      });
      markTreeActive();
    }).catch(function (err) {
      var p = document.createElement('p');
      p.className = 'pane-empty';
      p.textContent = t('Nao consegui ler a pasta: ') + err.message;
      container.appendChild(p);
    });
  }

  /* O icone e um <svg> montado por createElementNS, nao um caractere: para
     troca-lo e preciso jogar fora o no e construir o outro. */
  function trocaGlifo(span, nome) {
    var novo = window.MarkPadIcons.build(nome, 13);
    if (!novo) return;
    span.textContent = '';
    span.appendChild(novo);
  }

  /*
   * Revelar na arvore (o "Reveal current file in navigation" do Obsidian):
   * abre as pastas do caminho, rola ate a linha e pisca. Serve para o arquivo
   * da aba e para as pastas do caminho no cabecalho.
   */
  function revelaNaArvore(caminho) {
    if (!caminho) return;
    var raiz = String(app.folder || '').replace(/[\\/]+$/, '');
    var dentro = !!raiz && caminho.toLowerCase().indexOf(raiz.toLowerCase()) === 0 &&
      /[\\/]/.test(caminho.charAt(raiz.length));
    if (!dentro) {
      toast(t('Fica fora da pasta aberta.'), '', 2200);
      return;
    }
    setPane('files');
    if (app.treeFilter) toggleTreeFilter(false);

    var sep = raiz.indexOf('\\') !== -1 ? '\\' : '/';
    var partes = caminho.slice(raiz.length).replace(/^[\\/]+/, '').split(/[\\/]/);
    var pasta = raiz;
    for (var i = 0; i < partes.length - 1; i++) {
      pasta += sep + partes[i];
      app.treeOpen[pasta] = true;
    }
    refreshTree();

    var alvo = caminho.toLowerCase();
    var tentativas = 0;
    (function procura() {
      var rows = $('fileTree').querySelectorAll('.tree-item');
      for (var k = 0; k < rows.length; k++) {
        if ((rows[k].getAttribute('data-path') || '').toLowerCase() === alvo) {
          rows[k].scrollIntoView({ block: 'center' });
          piscaAlvo(rows[k]);
          return;
        }
      }
      // A arvore carrega pasta por pasta: espera a descida terminar.
      if (++tentativas < 60) setTimeout(procura, 50);
    })();
  }

  /*
   * O caminho da nota no cabecalho, como as migalhas do Obsidian: as pastas
   * entre a pasta aberta e o arquivo, cada uma clicavel (revela na arvore).
   * Fora da pasta aberta, nada: o caminho inteiro esta na dica do nome.
   */
  function renderMigalhas(tab) {
    var box = $('viewCrumbs');
    if (!box) return;
    box.textContent = '';
    var raiz = String(app.folder || '').replace(/[\\/]+$/, '');
    if (!tab || !tab.path || !raiz) return;
    var rel = relNaPasta(tab.path);
    if (rel === tab.path.replace(/\\/g, '/')) return;   // fora da pasta
    var pastas = rel.split('/').slice(0, -1);
    if (!pastas.length) return;

    var sep = raiz.indexOf('\\') !== -1 ? '\\' : '/';
    var inicio = Math.max(0, pastas.length - 3);
    if (inicio > 0) {
      var corte = document.createElement('span');
      corte.className = 'view-crumb is-corte';
      corte.textContent = '…';
      corte.title = pastas.slice(0, inicio).join('/');
      box.appendChild(corte);
      box.appendChild(separadorMigalha());
    }
    pastas.forEach(function (nome, i) {
      if (i < inicio) return;
      var caminho = raiz + sep + pastas.slice(0, i + 1).join(sep);
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'view-crumb';
      el.textContent = nome;
      el.title = t('Mostrar {pasta} na árvore', { pasta: nome });
      el.onclick = function () { revelaNaArvore(caminho); };
      box.appendChild(el);
      box.appendChild(separadorMigalha());
    });
  }

  function separadorMigalha() {
    var s = document.createElement('span');
    s.className = 'view-crumb-sep';
    s.textContent = '/';
    return s;
  }

  function markTreeActive() {
    var tab = activeTab();
    var rows = $('fileTree').querySelectorAll('.tree-item');
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].getAttribute('data-path');
      rows[i].classList.toggle('is-active',
        !!(tab && tab.path && p && p.toLowerCase() === tab.path.toLowerCase()));
    }
  }

  function renderRecent() {
    var box = $('recentList');
    box.textContent = '';

    var list = settings.recent || [];
    if (!list.length) {
      box.innerHTML = '<p class="pane-empty">Nada por aqui ainda.</p>';
      return;
    }

    list.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'recent-item';
      el.title = p;
      el.setAttribute('data-previa-caminho', p);

      var n = document.createElement('div');
      n.className = 'recent-name';
      n.textContent = p.split(/[\\/]/).pop();
      var d = document.createElement('div');
      d.className = 'recent-path';
      d.textContent = p;

      el.appendChild(n);
      el.appendChild(d);
      el.onclick = function () { openPath(p); };
      box.appendChild(el);
    });
  }

  /*
   * Duas barras laterais, como no Obsidian: a da esquerda (navegar: arquivos,
   * busca, marcadores, recentes) e a da direita (sobre a nota aberta:
   * sumario, tags, grafo local). Cada painel mora num lado e muda de lado pelo
   * clique direito no icone; cada lado tem o seu painel ativo.
   */
  var ORDEM_PAINEIS = ['files', 'search', 'bookmarks', 'recent', 'outline', 'tags', 'graph'];
  var PADRAO_DIREITA = ['outline', 'tags', 'graph'];

  function paineisDireita() {
    return Array.isArray(settings.paineisDireita) ? settings.paineisDireita : PADRAO_DIREITA;
  }

  function ladoDe(id) { return paineisDireita().indexOf(id) !== -1 ? 'direita' : 'esquerda'; }

  function paineisDoLado(lado) {
    return ORDEM_PAINEIS.filter(function (id) {
      return ladoDe(id) === lado && document.querySelector('section.pane[data-pane="' + id + '"]');
    });
  }

  function distribuiPaineis() {
    ORDEM_PAINEIS.forEach(function (id) {
      var bt = document.querySelector('.sidebar-tab[data-pane="' + id + '"]');
      var sec = document.querySelector('section.pane[data-pane="' + id + '"]');
      if (!bt || !sec) return;
      var direita = ladoDe(id) === 'direita';
      $(direita ? 'sidebarTabsDireita' : 'sidebarTabsEsquerda').appendChild(bt);
      $(direita ? 'sidebarBodyDireita' : 'sidebarBodyEsquerda').appendChild(sec);
    });
    var esq = paineisDoLado('esquerda'), dir = paineisDoLado('direita');
    document.body.classList.toggle('sem-esquerda', !esq.length);
    document.body.classList.toggle('sem-direita', !dir.length);
    if (esq.indexOf(settings.sidebarPane) === -1) settings.sidebarPane = esq[0] || null;
    if (dir.indexOf(settings.sidebarPaneDireita) === -1) settings.sidebarPaneDireita = dir[0] || null;
    ativaNoLado('esquerda', settings.sidebarPane);
    ativaNoLado('direita', settings.sidebarPaneDireita);
  }

  function ativaNoLado(lado, name) {
    var aside = $(lado === 'direita' ? 'sidebarDireita' : 'sidebar');
    if (!aside) return;
    var tabs = aside.querySelectorAll('.sidebar-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-pane') === name);
    var panes = aside.querySelectorAll('section.pane');
    for (var j = 0; j < panes.length; j++) panes[j].hidden = panes[j].getAttribute('data-pane') !== name;
  }

  /** Mostra o painel no lado dele (abrindo a barra, se estava fechada). */
  function setPane(name, semMostrar) {
    var lado = ladoDe(name);
    if (lado === 'direita') {
      settings.sidebarPaneDireita = name;
      if (!semMostrar && settings.sidebarDireitaVisivel === false) toggleSidebarDireita(true);
    } else {
      settings.sidebarPane = name;
      if (!semMostrar && !settings.sidebarVisible) toggleSidebar(true);
    }
    ativaNoLado(lado, name);
    if (name === 'tags') renderTags();
    if (name === 'bookmarks') renderMarcadores();
    if (name === 'graph') renderGrafo(true);
    persist();
  }

  function moveDeLado(id) {
    var dir = paineisDireita().slice();
    var i = dir.indexOf(id);
    if (i === -1) dir.push(id); else dir.splice(i, 1);
    settings.paineisDireita = dir;
    distribuiPaineis();
    setPane(id);
  }

  function toggleSidebarDireita(force) {
    var visivel = settings.sidebarDireitaVisivel !== false;
    settings.sidebarDireitaVisivel = force === undefined ? !visivel : force;
    document.body.classList.toggle('sidebar-direita-hidden', !settings.sidebarDireitaVisivel);
    if (settings.sidebarDireitaVisivel && settings.sidebarPaneDireita === 'graph') renderGrafo(true);
    persist();
  }

  // ============================================================ grafo local
  //
  // O grafo local do Obsidian, em Canvas 2D proprio (sem biblioteca): a nota
  // aberta no centro, quem ela cita e quem cita ela (profundidade 1 ou 2), e
  // os links quebrados como pontos apagados. Arrastar move um no, arrastar o
  // fundo move a vista, a roda aproxima, clique abre a nota como um link.

  var grafo = { de: null, nos: [], arestas: [], cam: { x: 0, y: 0, z: 1 }, quente: 0, raf: null,
    sobre: null, arrasto: null, profundidade: 1, quebrados: true, modo: 'local', destaque: null };
  var GRAFO_MAX_NOS = 1500;

  function grafoVisivel() {
    var sec = document.querySelector('section.pane[data-pane="graph"]');
    if (!sec || sec.hidden) return false;
    var lado = ladoDe('graph');
    if (lado === 'direita') return settings.sidebarDireitaVisivel !== false && !document.body.classList.contains('sem-direita');
    return !!settings.sidebarVisible;
  }

  /*
   * Grafo da pasta inteira (o "Graph view" do Obsidian): toda nota e um no,
   * todo link resolvido uma aresta; a nota aberta fica destacada. Trocar de
   * aba so muda o destaque, sem refazer o desenho. Pasta muito grande fica
   * com as notas mais ligadas (GRAFO_MAX_NOS).
   */
  function renderGrafoDaPasta(forcar, tab) {
    var chave = 'pasta|' + String(app.folder || '').toLowerCase() + '|' + grafo.quebrados;
    grafo.destaque = tab && tab.path ? tab.path.toLowerCase() : null;
    if (!forcar && chave === grafo.de) { desenhaGrafo(); return; }
    grafo.de = chave;
    var aviso = $('graphEmpty');
    if (!app.folder) {
      montaGrafo([], []);
      aviso.hidden = false;
      aviso.textContent = t('Abra uma pasta para ver o grafo dela.');
      return;
    }
    indiceLinks().then(function (idx) {
      if (!idx || grafo.modo !== 'pasta') return;
      var nos = {}, arestas = [], vistas = {};
      idx.arquivos.forEach(function (a) {
        if (!a.md) return;
        nos[a.rel.toLowerCase()] = { id: a.rel.toLowerCase(), nome: semExtensao(a.name), path: a.path, existe: true, nivel: 1, grau: 0 };
      });
      function liga(x, y) {
        if (!x || !y || x === y) return;
        var k = x.id < y.id ? x.id + '>' + y.id : y.id + '>' + x.id;
        if (vistas[k]) return;
        vistas[k] = 1;
        arestas.push({ a: x, b: y });
        x.grau++; y.grau++;
      }
      idx.arquivos.forEach(function (a) {
        if (!a.md) return;
        var de = nos[a.rel.toLowerCase()];
        (a.saidas || []).forEach(function (s) {
          if (s.para && s.para.md) liga(de, nos[s.para.rel.toLowerCase()]);
          else if (!s.para && grafo.quebrados && s.link && s.link.alvo) {
            var k = 'q:' + String(s.link.alvo).toLowerCase();
            if (!nos[k]) nos[k] = { id: k, nome: String(s.link.alvo).split('/').pop(), path: null, existe: false, nivel: 1, grau: 0 };
            liga(de, nos[k]);
          }
        });
      });
      var lista = Object.keys(nos).map(function (k) { return nos[k]; });
      if (lista.length > GRAFO_MAX_NOS) {
        lista.sort(function (x, y) { return y.grau - x.grau; });
        var fica = {};
        lista = lista.slice(0, GRAFO_MAX_NOS);
        lista.forEach(function (n) { fica[n.id] = 1; });
        arestas = arestas.filter(function (e) { return fica[e.a.id] && fica[e.b.id]; });
      }
      aviso.hidden = lista.length > 0;
      aviso.textContent = t('Nenhuma nota na pasta.');
      montaGrafo(lista, arestas, null);
    });
  }

  function alternaModoGrafo() {
    grafo.modo = grafo.modo === 'pasta' ? 'local' : 'pasta';
    settings.grafoModo = grafo.modo;
    var b = $('btnGrafoModo');
    if (b) { b.textContent = grafo.modo === 'pasta' ? t('Pasta') : t('Local'); b.classList.toggle('is-on', grafo.modo === 'pasta'); }
    $('btnGrafoProfundidade').hidden = grafo.modo === 'pasta';
    var titulo = document.querySelector('section.pane[data-pane="graph"] .pane-title');
    if (titulo) titulo.textContent = grafo.modo === 'pasta' ? t('Grafo da pasta') : t('Grafo local');
    persist();
    renderGrafo(true);
  }

  function renderGrafo(forcar) {
    if (!grafoVisivel()) return;
    var tab = activeTab();
    if (grafo.modo === 'pasta') { renderGrafoDaPasta(forcar, tab); return; }
    var chaveAtual = (tab && tab.path ? tab.path.toLowerCase() : '') + '|' + grafo.profundidade + '|' + grafo.quebrados;
    if (!forcar && chaveAtual === grafo.de) return;
    grafo.de = chaveAtual;
    var aviso = $('graphEmpty');
    if (!tab || !tab.path || !app.folder) {
      montaGrafo([], []);
      aviso.hidden = false;
      aviso.textContent = t('Abra uma nota de uma pasta para ver as ligações dela.');
      return;
    }
    indiceLinks().then(function (idx) {
      if (activeTab() !== tab) return;
      var LI = window.MarkPadLinkIndex;
      var arq = idx && LI.arquivoDe(idx, tab.path);
      if (!idx || !arq) {
        montaGrafo([], []);
        aviso.hidden = false;
        aviso.textContent = t('Esta nota está fora da pasta aberta.');
        return;
      }
      var nos = {}, arestas = [], vistas = {};
      function no(a, nivel) {
        var k = a.rel.toLowerCase();
        if (!nos[k]) nos[k] = { id: k, nome: semExtensao(a.name), path: a.path, existe: true, nivel: nivel, grau: 0 };
        else nos[k].nivel = Math.min(nos[k].nivel, nivel);
        return nos[k];
      }
      function quebrado(alvo, nivel) {
        var k = 'q:' + String(alvo).toLowerCase();
        if (!nos[k]) nos[k] = { id: k, nome: String(alvo).split('/').pop(), path: null, existe: false, nivel: nivel, grau: 0 };
        return nos[k];
      }
      function liga(a, b) {
        if (a === b) return;
        var k = a.id < b.id ? a.id + '>' + b.id : b.id + '>' + a.id;
        if (vistas[k]) return;
        vistas[k] = 1;
        arestas.push({ a: a, b: b });
        a.grau++; b.grau++;
      }
      // As saidas da nota aberta vem do texto da aba (salvo ou nao).
      function saidasDe(a) {
        if (a === arq) return LI.saidas(idx, tab.content, arq.rel);
        return (a.saidas || []).map(function (x) { return { alvo: x.link.alvo, para: x.para }; });
      }
      var fila = [[arq, 0]], feitos = {};
      no(arq, 0);
      while (fila.length) {
        var par = fila.shift(), a = par[0], nivel = par[1];
        if (feitos[a.rel.toLowerCase()]) continue;
        feitos[a.rel.toLowerCase()] = 1;
        if (nivel >= grafo.profundidade) continue;
        var origem = no(a, nivel);
        saidasDe(a).forEach(function (x) {
          if (!x.alvo) return;
          if (x.para) { liga(origem, no(x.para, nivel + 1)); fila.push([x.para, nivel + 1]); }
          else if (grafo.quebrados) liga(origem, quebrado(x.alvo, nivel + 1));
        });
        (idx.entradas[a.rel.toLowerCase()] || []).forEach(function (e) {
          liga(no(e.de, nivel + 1), origem);
          fila.push([e.de, nivel + 1]);
        });
      }
      var lista = Object.keys(nos).map(function (k) { return nos[k]; });
      aviso.hidden = lista.length > 1;
      aviso.textContent = t('Nenhuma ligação: esta nota não cita nem é citada por outra.');
      montaGrafo(lista, arestas, nos[arq.rel.toLowerCase()]);
    });
  }

  function montaGrafo(nos, arestas, centro) {
    var cv = $('graphCanvas');
    var w = cv.clientWidth || 260, h = cv.clientHeight || 260;
    // Posicao inicial em circulos por nivel, com o centro fixo no meio.
    var espalha = Math.sqrt(nos.length) * 40;
    nos.forEach(function (n, i) {
      var ang = (i / Math.max(1, nos.length)) * Math.PI * 2;
      var raio = centro ? (n === centro ? 0 : 60 + n.nivel * 55) : espalha * Math.sqrt((i + 1) / Math.max(1, nos.length));
      n.x = Math.cos(ang * (centro ? 1 : 7.3)) * raio; n.y = Math.sin(ang * (centro ? 1 : 7.3)) * raio;
      n.vx = 0; n.vy = 0;
      n.fixo = n === centro;
    });
    grafo.nos = nos;
    grafo.arestas = arestas;
    grafo.centro = centro || null;
    // Muitos nos: comeca afastado, para caber no painel.
    var z = centro || nos.length < 30 ? 1 : Math.max(0.3, Math.min(1, Math.min(w, h) / (2.4 * espalha)));
    grafo.cam = { x: w / 2, y: h / 2, z: z };
    grafo.quente = 1;
    animaGrafo();
  }

  function passoGrafo() {
    var nos = grafo.nos, k = grafo.quente;
    for (var i = 0; i < nos.length; i++) {
      var a = nos[i];
      for (var j = i + 1; j < nos.length; j++) {
        var b = nos[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy || 0.01;
        var f = 1600 / d2;   // repulsao
        var d = Math.sqrt(d2);
        var fx = f * dx / d, fy = f * dy / d;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
      a.vx -= a.x * 0.004; a.vy -= a.y * 0.004;   // gravidade para o centro
    }
    grafo.arestas.forEach(function (e) {
      var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var f = (d - 70) * 0.03;   // mola
      var fx = f * dx / d, fy = f * dy / d;
      e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
    });
    nos.forEach(function (n) {
      if (n.fixo || n === (grafo.arrasto && grafo.arrasto.no)) { n.vx = 0; n.vy = 0; return; }
      n.vx *= 0.55; n.vy *= 0.55;
      n.x += Math.max(-12, Math.min(12, n.vx * k));
      n.y += Math.max(-12, Math.min(12, n.vy * k));
    });
    grafo.quente = Math.max(0, k - 0.012);
  }

  function animaGrafo() {
    if (grafo.raf) return;
    (function quadro() {
      grafo.raf = null;
      if (!grafoVisivel()) return;
      if (grafo.quente > 0) passoGrafo();
      desenhaGrafo();
      if (grafo.quente > 0 || grafo.arrasto) grafo.raf = requestAnimationFrame(quadro);
    })();
  }

  function corCss(nome, reserva) {
    var v = getComputedStyle(document.body).getPropertyValue(nome).trim();
    return v || reserva;
  }

  function desenhaGrafo() {
    var cv = $('graphCanvas');
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    var cam = grafo.cam;
    var linha = corCss('--background-modifier-border', '#444');
    var texto = corCss('--text-muted', '#999');
    var normal = corCss('--text-faint', '#777');
    var acento = corCss('--color-accent', '#8a5cf5');
    var sobre = grafo.sobre;
    var vizinhos = {};
    if (sobre) grafo.arestas.forEach(function (e) {
      if (e.a === sobre) vizinhos[e.b.id] = 1;
      if (e.b === sobre) vizinhos[e.a.id] = 1;
    });

    c.lineWidth = 1;
    grafo.arestas.forEach(function (e) {
      var liga = sobre && (e.a === sobre || e.b === sobre);
      c.strokeStyle = liga ? acento : linha;
      c.globalAlpha = sobre && !liga ? 0.35 : 1;
      c.beginPath();
      c.moveTo(cam.x + e.a.x * cam.z, cam.y + e.a.y * cam.z);
      c.lineTo(cam.x + e.b.x * cam.z, cam.y + e.b.y * cam.z);
      c.stroke();
    });
    c.globalAlpha = 1;
    c.font = '11px ' + (corCss('--font-interface', '') || 'system-ui, sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'top';
    grafo.nos.forEach(function (n) {
      var x = cam.x + n.x * cam.z, y = cam.y + n.y * cam.z;
      var atual = n === grafo.centro || (grafo.modo === 'pasta' && n.path && grafo.destaque === n.path.toLowerCase());
      var r = (atual ? 7 : 4 + Math.min(4, n.grau * 0.6)) * Math.max(0.6, Math.min(1.6, cam.z));
      var apagado = sobre && n !== sobre && !vizinhos[n.id];
      c.globalAlpha = apagado ? 0.3 : (n.existe ? 1 : 0.5);
      c.fillStyle = atual || n === sobre ? acento : normal;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      if (!n.existe) { c.strokeStyle = normal; c.stroke(); }
      if (cam.z > 0.55 || n === sobre || atual) {
        c.fillStyle = n === sobre ? corCss('--text-normal', '#ddd') : texto;
        c.fillText(n.nome.length > 28 ? n.nome.slice(0, 27) + '…' : n.nome, x, y + r + 3);
      }
    });
    c.globalAlpha = 1;
  }

  function noNoPonto(px, py) {
    var cam = grafo.cam, achado = null, melhor = 14 * 14;
    grafo.nos.forEach(function (n) {
      var dx = cam.x + n.x * cam.z - px, dy = cam.y + n.y * cam.z - py;
      var d = dx * dx + dy * dy;
      if (d < melhor) { melhor = d; achado = n; }
    });
    return achado;
  }

  function ligaGrafo() {
    var cv = $('graphCanvas');
    function ponto(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener('mousemove', function (e) {
      var p = ponto(e);
      if (grafo.arrasto) {
        var a = grafo.arrasto;
        a.moveu = a.moveu || Math.abs(p.x - a.px) + Math.abs(p.y - a.py) > 3;
        if (a.no) { a.no.x = (p.x - grafo.cam.x) / grafo.cam.z; a.no.y = (p.y - grafo.cam.y) / grafo.cam.z; grafo.quente = Math.max(grafo.quente, 0.3); }
        else { grafo.cam.x = a.cx + p.x - a.px; grafo.cam.y = a.cy + p.y - a.py; }
        animaGrafo();
        return;
      }
      var n = noNoPonto(p.x, p.y);
      if (n !== grafo.sobre) {
        grafo.sobre = n;
        cv.style.cursor = n ? 'pointer' : 'grab';
        cv.title = n ? (n.existe ? n.path : t('Nota que ainda não existe: {nome}', { nome: n.nome })) : '';
        desenhaGrafo();
      }
    });
    cv.addEventListener('mouseleave', function () { if (!grafo.arrasto) { grafo.sobre = null; desenhaGrafo(); } });
    cv.addEventListener('mousedown', function (e) {
      var p = ponto(e);
      var n = noNoPonto(p.x, p.y);
      grafo.arrasto = { no: n, px: p.x, py: p.y, cx: grafo.cam.x, cy: grafo.cam.y, moveu: false };
      function solta(ev) {
        document.removeEventListener('mouseup', solta);
        var a = grafo.arrasto;
        grafo.arrasto = null;
        var naAtual = a && a.no && a.no.path && grafo.modo === 'pasta' && grafo.destaque === a.no.path.toLowerCase();
        if (a && !a.moveu && a.no && a.no.existe && a.no !== grafo.centro && !naAtual) {
          abreDestino(a.no.path, { origem: activeTab(), novaAba: ev.ctrlKey || ev.metaKey || ev.button === 1 });
        }
      }
      document.addEventListener('mouseup', solta);
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = ponto(e);
      var z0 = grafo.cam.z;
      var z = Math.max(0.08, Math.min(3, z0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      // Aproxima em torno do ponteiro.
      grafo.cam.x = p.x - (p.x - grafo.cam.x) * (z / z0);
      grafo.cam.y = p.y - (p.y - grafo.cam.y) * (z / z0);
      grafo.cam.z = z;
      desenhaGrafo();
    }, { passive: false });
    if ($('btnGrafoModo')) $('btnGrafoModo').onclick = alternaModoGrafo;
    if (settings.grafoModo === 'pasta') { grafo.modo = 'local'; alternaModoGrafo(); }
    $('btnGrafoProfundidade').onclick = function () {
      grafo.profundidade = grafo.profundidade === 1 ? 2 : 1;
      $('btnGrafoProfundidade').textContent = String(grafo.profundidade);
      renderGrafo(true);
    };
    $('btnGrafoQuebrados').onclick = function () {
      grafo.quebrados = !grafo.quebrados;
      $('btnGrafoQuebrados').classList.toggle('is-on', grafo.quebrados);
      renderGrafo(true);
    };
    $('btnGrafoCentro').onclick = function () {
      var cvw = $('graphCanvas');
      grafo.cam = { x: cvw.clientWidth / 2, y: cvw.clientHeight / 2, z: 1 };
      desenhaGrafo();
    };
    if (window.ResizeObserver) new ResizeObserver(function () { desenhaGrafo(); }).observe(cv);
  }

  // ================================================================= tags

  /*
   * Painel de tags. No Obsidian ele e uma das visoes do cofre; aqui sai da
   * pasta aberta (o C# varre e conta) ou, se nao houver pasta, dos proprios
   * documentos abertos. Lista de tags nao e motivo para inventar cofre.
   */

  // Regra do Obsidian, a mesma do leitor (markdown.js, passo 14): '#' no
  // comeco ou depois de espaco, sem pontuacao no nome, e so digitos nao vale.
  var RE_TAG_TEXTO = /(?:^|\s)#(?!\d+(?:[\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]|$))([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]+)/g;
  var RE_TAG_NOME = /^(?!\d+$)[^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]+$/;

  /** As tags de um texto, com repeticao. Cerca fechada e crase ficam de fora. */
  function tagsDoTexto(texto) {
    var achadas = [];
    var linhas = String(texto || '').split('\n');
    var cerca = false;
    var frontmatter = linhas.length > 0 && linhas[0].replace(/\s+$/, '') === '---';
    var chaveDeLista = false;

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];

      if (frontmatter && i > 0) {
        var corte = linha.replace(/\s+$/, '');
        if (corte === '---' || corte === '...') { frontmatter = false; continue; }

        var item = /^\s+-\s*(.+)$/.exec(linha);
        if (chaveDeLista && item) { empurraTag(achadas, item[1]); continue; }

        var campo = /^tags?:(.*)$/i.exec(linha);
        if (campo) {
          var valor = campo[1].trim();
          chaveDeLista = valor === '';
          empurraTag(achadas, valor);
          continue;
        }

        if (/^[A-Za-z_][\wÀ-ɏ -]*:/.test(linha)) chaveDeLista = false;
        continue;
      }

      if (/^\s{0,3}(?:```|~~~)/.test(linha)) { cerca = !cerca; continue; }
      if (cerca) continue;

      var limpa = linha.replace(/`[^`]*`/g, ' ');
      var m;
      RE_TAG_TEXTO.lastIndex = 0;
      while ((m = RE_TAG_TEXTO.exec(limpa))) achadas.push(m[1].replace(/\/+$/, ''));
    }

    return achadas;
  }

  /** "a, b" / "[a, b]" / "a" — o jeito solto de escrever tags no frontmatter. */
  function empurraTag(lista, valor) {
    valor = String(valor || '').trim().replace(/^\[|\]$/g, '').trim();
    if (!valor) return;

    valor.split(/[,\s]+/).forEach(function (parte) {
      var t = parte.replace(/^["']|["']$/g, '').replace(/^#/, '').replace(/\/+$/, '');
      if (t && RE_TAG_NOME.test(t)) lista.push(t);
    });
  }

  function tagIndex() {
    if (!app.folder) return Promise.resolve(tagsDosAbertos());
    if (app.tagsDe === app.folder && app.tags) return app.tags;

    app.tagsDe = app.folder;
    app.tags = bridge.call('listTags', { root: app.folder })
      .then(function (d) { return (d && d.tags) || []; })
      .catch(function () { return tagsDosAbertos(); });
    return app.tags;
  }

  function tagsDosAbertos() {
    var conta = Object.create(null);
    var arqs = Object.create(null);

    app.tabs.forEach(function (tab) {
      var vistas = Object.create(null);
      tagsDoTexto(tab.content).forEach(function (t) {
        conta[t] = (conta[t] || 0) + 1;
        vistas[t] = true;
      });
      Object.keys(vistas).forEach(function (t) { arqs[t] = (arqs[t] || 0) + 1; });
    });

    return Object.keys(conta).map(function (t) {
      return { tag: t, count: conta[t], files: arqs[t] };
    });
  }

  function renderTags() {
    var box = $('tagList');
    if (!box) return;

    var pedido = ++renderTags.seq;
    box.textContent = '';

    Promise.resolve(tagIndex()).then(function (tags) {
      if (pedido !== renderTags.seq) return;   // chegou tarde: ja tem outra lista
      desenhaPainelTags(box, tags || []);
    });
  }
  renderTags.seq = 0;

  function desenhaPainelTags(box, tags) {
    box.textContent = '';

    var filtro = (app.tagFilter || '').toLowerCase();
    var lista = tags.filter(function (t) {
      return !filtro || String(t.tag).toLowerCase().indexOf(filtro) >= 0;
    });

    if (!lista.length) {
      var p = document.createElement('p');
      p.className = 'pane-empty';
      p.textContent = tags.length
        ? t('Nenhuma tag com esse nome.')
        : (app.folder
          ? t('Nenhuma tag nos arquivos desta pasta.')
          : t('Nenhuma tag nos documentos abertos. Abra uma pasta para varrer o disco.'));
      box.appendChild(p);
      renderTagResumo(0, 0);
      return;
    }

    // #projeto/api entra debaixo de #projeto, como no Obsidian. O pai soma o
    // que os filhos tem, mesmo que ninguem escreva "#projeto" sozinho.
    var raiz = { filhos: [], indice: Object.create(null) };
    var total = 0;

    lista.forEach(function (t) {
      var partes = String(t.tag).split('/');
      var no = raiz;
      var caminho = '';
      total += t.count;

      partes.forEach(function (parte, i) {
        caminho = caminho ? caminho + '/' + parte : parte;
        if (!no.indice[parte]) {
          var novo = {
            nome: parte, caminho: caminho, count: 0, proprio: 0,
            filhos: [], indice: Object.create(null)
          };
          no.indice[parte] = novo;
          no.filhos.push(novo);
        }
        no = no.indice[parte];
        no.count += t.count;
        if (i === partes.length - 1) no.proprio = t.count;
      });
    });

    ordenaTags(raiz);
    box.appendChild(desenhaNosTag(raiz.filhos, 0));
    renderTagResumo(lista.length, total);
  }

  function ordenaTags(no) {
    var ordem = settings.tagSort || 'contagem';

    no.filhos.sort(function (a, b) {
      if (ordem === 'nome-desc') return b.nome.localeCompare(a.nome, 'pt', { numeric: true });
      if (ordem === 'nome-asc') return a.nome.localeCompare(b.nome, 'pt', { numeric: true });
      if (b.count !== a.count) return b.count - a.count;
      return a.nome.localeCompare(b.nome, 'pt', { numeric: true });
    });

    no.filhos.forEach(ordenaTags);
  }

  function desenhaNosTag(nos, profundidade) {
    var frag = document.createDocumentFragment();

    nos.forEach(function (no) {
      var wrapper = document.createElement('div');
      wrapper.className = 'tag-node';
      if (app.tagOpen[no.caminho] === false) wrapper.classList.add('is-collapsed');

      var linha = document.createElement('div');
      linha.className = 'tag-row';
      linha.title = '#' + no.caminho + ' — ' + no.count
        + (no.count === 1 ? ' ocorrencia' : ' ocorrencias');

      var twist = document.createElement('span');
      twist.className = 'tag-twist';
      if (no.filhos.length) {
        var chev = window.MarkPadIcons.build('chevron-down', 12);
        if (chev) twist.appendChild(chev);
        twist.onclick = function (e) {
          e.stopPropagation();
          app.tagOpen[no.caminho] = !wrapper.classList.toggle('is-collapsed');
        };
      }
      linha.appendChild(twist);

      var nome = document.createElement('span');
      nome.className = 'tag-name';
      // so a raiz leva "#": nos filhos ele so repetiria o caminho do pai
      nome.textContent = (profundidade ? '' : '#') + no.nome;
      linha.appendChild(nome);

      var conta = document.createElement('span');
      conta.className = 'tag-count';
      conta.textContent = String(no.count);
      linha.appendChild(conta);

      linha.onclick = function () { buscaTag(no.caminho); };
      linha.oncontextmenu = function (e) {
        e.preventDefault();
        tagContextMenu(no, e.clientX, e.clientY);
      };

      wrapper.appendChild(linha);

      if (no.filhos.length) {
        var filhos = document.createElement('div');
        filhos.className = 'tag-children';
        filhos.appendChild(desenhaNosTag(no.filhos, profundidade + 1));
        wrapper.appendChild(filhos);
      }

      frag.appendChild(wrapper);
    });

    return frag;
  }

  function renderTagResumo(quantas, total) {
    var pe = $('tagSummary');
    if (!pe) return;

    pe.hidden = !quantas;
    if (!quantas) return;

    pe.textContent = quantas + (quantas === 1 ? ' tag' : ' tags')
      + ' · ' + total + (total === 1 ? ' uso' : ' usos')
      + (app.folder ? '' : ' (nos documentos abertos)');
  }

  /** Clicar numa tag procura por ela: na pasta se houver, senao no documento. */
  function buscaTag(caminho) {
    if (app.folder) { openFolderSearch('#' + caminho); return; }

    openFind();
    var campo = $('findInput');
    if (campo) {
      campo.value = '#' + caminho;
      runFind(0);
    }
  }

  function tagContextMenu(no, x, y) {
    var tab = activeTab();

    showMenu([
      { label: '#' + no.caminho, header: true },
      {
        label: app.folder ? t('Buscar na pasta') : t('Buscar no documento'),
        icon: 'search',
        action: function () { buscaTag(no.caminho); }
      },
      {
        label: t('Copiar #') + no.caminho,
        icon: 'copy',
        action: function () {
          navigator.clipboard.writeText('#' + no.caminho);
          toast(t('Tag copiada.'), 'ok', 1200);
        }
      },
      '-',
      {
        label: t('Inserir no documento'),
        icon: 'plus',
        disabled: !tab || tab.locked,
        action: function () { insereTag(no.caminho); }
      }
    ], x, y);
  }

  function insereTag(caminho) {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    if (ed && ed.aba === tab) { ed.insere('#' + caminho + ' '); return; }

    // Sem editor: a tag vai para o fim do documento, numa linha so dela.
    tab.content = tab.content.replace(/\s*$/, '') + '\n\n#' + caminho + '\n';
    invalidateLineStatus(tab);
    renderViews();
    renderTabs();
    renderHeader();
    renderStatus();
    scheduleBackup(tab);
    toast('#' + caminho + ' inserida no fim do documento.', 'ok', 1600);
  }

  function toggleTagFilter(forcar) {
    var linha = $('tagFilterRow');
    var campo = $('tagFilterInput');
    var mostrar = forcar === undefined ? linha.hidden : forcar;

    linha.hidden = !mostrar;
    if (mostrar) { campo.focus(); campo.select(); return; }

    clearTimeout(tagFilterTimer);   // mesmo motivo do filtro da arvore
    campo.value = '';
    app.tagFilter = '';
    renderTags();
  }

  var ORDENS_TAG = [
    { id: 'contagem', label: t('Mais usadas primeiro') },
    { id: 'nome-asc', label: t('Nome (A → Z)') },
    { id: 'nome-desc', label: t('Nome (Z → A)') }
  ];

  function tagSortMenu(x, y) {
    showMenu(ORDENS_TAG.map(function (o) {
      return {
        label: o.label,
        checked: (settings.tagSort || 'contagem') === o.id,
        action: function () { settings.tagSort = o.id; renderTags(); persist(); }
      };
    }), x, y);
  }

  // --------------------------------------------------- busca na pasta

  var tagFilterTimer = null;
  var folderSearchTimer = null;
  /*
   * Busca na pasta com os operadores do Obsidian: file:, path: e tag: (com
   * '-' para excluir) escolhem os arquivos pelo indice de links, e o texto
   * que sobra vai para o grep so dentro deles. Sem texto, a resposta e a
   * propria lista de arquivos — "tag:projeto" sozinho e uma pergunta valida.
   */
  function runFolderSearch() {
    var query = $('folderSearchInput').value;
    var box = $('searchResults');
    var pedido = (app.buscaPedido = (app.buscaPedido || 0) + 1);
    var aviso = function (texto) {
      box.textContent = '';
      var p = document.createElement('p');
      p.className = 'pane-empty';
      p.textContent = texto;
      box.appendChild(p);
      return p;
    };

    if (!app.folder) { aviso(t('Abra uma pasta primeiro.')); return; }
    if (!query) { dicaDaBusca(box); return; }

    aviso(t('buscando...'));

    var consulta = window.MarkPadLinkIndex
      ? window.MarkPadLinkIndex.analisaConsulta(query)
      : { texto: query, filtros: [] };

    var escolhidos = consulta.filtros.length
      ? indiceLinks().then(function (idx) {
          if (!idx) throw new Error(t('o indice da pasta nao carregou.'));
          return window.MarkPadLinkIndex.filtra(idx, consulta.filtros);
        })
      : Promise.resolve(null);

    escolhidos.then(function (arquivos) {
      if (pedido !== app.buscaPedido) return null;   // ja digitaram outra coisa

      if (arquivos && !consulta.texto) {
        desenhaSoArquivos(box, arquivos);
        return null;
      }
      if (arquivos && !arquivos.length) { aviso(t('Nenhum resultado.')); return null; }

      return bridge.call('grepFolder', {
        root: app.folder,
        query: consulta.texto,
        caseSensitive: app.folderSearch.caseSensitive,
        regex: app.folderSearch.regex,
        maxResults: 300,
        paths: arquivos ? arquivos.map(function (a) { return a.path; }) : undefined
      }).then(function (res) {
        if (pedido !== app.buscaPedido) return;
        desenhaOcorrencias(box, res);
      });
    }).catch(function (err) {
      if (pedido !== app.buscaPedido) return;
      aviso(t('Busca falhou: ') + err.message);
    });
  }

  function dicaDaBusca(box) {
    box.textContent = '';
    [t('Digite para buscar em todos os arquivos da pasta.'),
     t('file:nome e path:pasta escolhem os arquivos; tag:#projeto, os que tem a tag. Um - na frente exclui.')
    ].forEach(function (texto) {
      var p = document.createElement('p');
      p.className = 'pane-empty';
      p.textContent = texto;
      box.appendChild(p);
    });
  }

  function desenhaSoArquivos(box, arquivos) {
    box.textContent = '';
    var head = document.createElement('p');
    head.className = 'pane-empty';
    head.textContent = arquivos.length === 1 ? t('1 arquivo') : t('{n} arquivos', { n: arquivos.length });
    box.appendChild(head);

    arquivos.slice().sort(function (a, b) {
      return a.rel.toLowerCase() < b.rel.toLowerCase() ? -1 : 1;
    }).slice(0, 500).forEach(function (a) {
      var h = document.createElement('div');
      h.className = 'search-file-head';
      h.title = a.path;
      var nm = document.createElement('span');
      nm.textContent = a.rel;
      h.appendChild(nm);
      h.onclick = function () { openPath(a.path); };
      box.appendChild(h);
    });
  }

  function desenhaOcorrencias(box, res) {
    box.textContent = '';
    if (!res.results.length) {
      var nada = document.createElement('p');
      nada.className = 'pane-empty';
      nada.textContent = t('Nenhum resultado.');
      box.appendChild(nada);
      return;
    }

    var total = res.results.reduce(function (n, f) { return n + f.hits.length; }, 0);
    var head = document.createElement('p');
    head.className = 'pane-empty';
    head.textContent = ocorrencias(total, res.results.length) + (res.truncated ? t(' (lista truncada)') : '');
    box.appendChild(head);

    res.results.forEach(function (file) {
      box.appendChild(grupoDeOcorrencias(file.path, file.relative, file.hits));
    });
  }

  function openFolderSearch(prefill) {
    setPane('search');
    if (prefill !== undefined) $('folderSearchInput').value = prefill;
    $('folderSearchInput').focus();
    $('folderSearchInput').select();
    if (prefill) runFolderSearch();
  }

  // ==================================================== localizar no arquivo

  function openFind() {
    var tab = activeTab();
    if (!tab) return;
    app.find.open = true;
    $('findBar').hidden = false;
    updateReplaceAvailability();
    $('findInput').focus();
    $('findInput').select();
    if ($('findInput').value) runFind(0);
  }

  function closeFind() {
    app.find.open = false;
    $('findBar').hidden = true;
    clearFindHighlights();
    var tab = activeTab();
    if (tab && !tab.locked && ed) ed.foco();
  }

  /** Ctrl+H: a mesma barra, mas com o cursor ja no campo de substituir. */
  function openReplace() {
    var tab = activeTab();
    if (!tab) return;

    openFind();
    if (tab.locked) { toast(t('Destrave a edicao para substituir.'), 'warn'); return; }
    $('replaceInput').focus();
    $('replaceInput').select();
  }

  function updateReplaceAvailability() {
    var tab = activeTab();
    var canEdit = tab && !tab.locked;
    $('replaceInput').disabled = !canEdit;
    $('btnReplace').disabled = !canEdit;
    $('btnReplaceAll').disabled = !canEdit;
    $('replaceInput').placeholder = canEdit ? 'Substituir' : t('Substituir (destrave para usar)');
  }

  function buildFindRegex() {
    var q = app.find.query;
    if (!q) return null;
    var flags = 'g' + (app.find.caseSensitive ? '' : 'i');
    try {
      return app.find.regex ? new RegExp(q, flags)
        : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      return null;
    }
  }

  function findMatches() {
    var tab = activeTab();
    var re = buildFindRegex();
    if (!tab || !re) return [];

    var out = [];
    var m;
    while ((m = re.exec(tab.content)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
      if (out.length > 5000) break;
    }
    return out;
  }

  function runFind(step) {
    var tab = activeTab();
    app.find.query = $('findInput').value;

    if (!tab || !app.find.query) {
      app.find.total = 0;
      $('findCount').textContent = '0/0';
      clearFindHighlights();
      return;
    }

    var matches = findMatches();
    app.find.total = matches.length;

    if (!matches.length) {
      app.find.index = 0;
      $('findCount').textContent = '0/0';
      clearFindHighlights();
      return;
    }

    if (step === 0) {
      // Do cursor pra frente, como qualquer editor decente.
      var from = tab.locked || !ed ? 0 : ed.selecao().inicio;
      app.find.index = 0;
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].start >= from) { app.find.index = i; break; }
      }
    } else {
      app.find.index = (app.find.index + step + matches.length) % matches.length;
    }

    $('findCount').textContent = (app.find.index + 1) + '/' + matches.length;

    if (tab.locked || !ed) {
      applyFindHighlights();
    } else {
      var hit = matches[app.find.index];
      // Seleciona e rola SEM tirar o foco de onde ele esta. Antes o foco
      // pulava para o editor na primeira letra achada: a tecla seguinte caia
      // dentro do documento, e um segundo Enter trocava a ocorrencia
      // selecionada por uma quebra de linha. A linha achada fica marcada, e Esc
      // fecha a busca devolvendo o foco ao editor com a ocorrencia selecionada.
      ed.seleciona(hit.start, hit.end, { centro: true });
      ed.marcaAchados(matches.map(function (m) { return { inicio: m.start, fim: m.end }; }), app.find.index);
    }
  }


  function clearFindHighlights() {
    if (ed) ed.marcaAchados([]);
    var marks = $('preview').querySelectorAll('span.find-hit');
    for (var i = marks.length - 1; i >= 0; i--) {
      var m = marks[i];
      var parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
  }

  function applyFindHighlights() {
    clearFindHighlights();

    var re = buildFindRegex();
    if (!re) return;

    var root = $('preview');
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        while (p && p !== root) {
          if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          // Texto de embed e das mencoes ligadas nao e texto DESTE documento:
          // pintar la desalinharia a contagem, que vem do tab.content.
          if (p.classList && (p.classList.contains('note-embed') || p.classList.contains('backlinks-block'))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    var counter = 0;
    var current = null;

    nodes.forEach(function (node) {
      re.lastIndex = 0;
      var text = node.nodeValue;
      if (!re.test(text)) return;
      re.lastIndex = 0;

      var frag = document.createDocumentFragment();
      var last = 0;
      var m;

      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement('span');
        span.className = 'find-hit';
        span.textContent = m[0];
        if (counter === app.find.index) { span.classList.add('current'); current = span; }
        counter++;
        frag.appendChild(span);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }

      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });

    if (current) current.scrollIntoView({ block: 'center' });
  }

  function replaceCurrent() {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    var matches = findMatches();
    if (!matches.length) return;

    var hit = matches[Math.min(app.find.index, matches.length - 1)];
    // No modo regex o texto de substituicao entende $1, $&, $<nome> e \n;
    // casando de novo na posicao, com o documento inteiro como contexto.
    var troca = window.MarkPadTextOps.replacementAt(tab.content, buildFindRegex(), hit.start,
      $('replaceInput').value, app.find.regex);
    if (!troca) return;
    replaceRange(troca.start, troca.end, troca.text);
    setTimeout(function () { runFind(0); }, 0);
  }

  function replaceAll() {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    var re = buildFindRegex();
    if (!re) return;

    var feito = window.MarkPadTextOps.replaceAll(tab.content, re, $('replaceInput').value, app.find.regex);
    if (!feito.count) { toast(t('Nada para substituir.'), 'warn'); return; }

    if (ed && ed.aba === tab) ed.trocaTexto(feito.text);
    else replaceRange(0, tab.content.length, feito.text);
    toast(feito.count === 1 ? t('1 substituição.') : t('{n} substituições.', { n: feito.count }), 'ok');
    setTimeout(function () { runFind(0); }, 0);
  }

  // ======================================================== aparencia

  function applyTheme() {
    var dark = settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    window.MarkPadThemes.aplicar({
      paletaId: settings.palette,
      escuro: dark,
      acento: settings.accent,
      importado: settings.vscodeTheme
    });
    bridge.call('setTitleBarTheme', { dark: dark }).catch(function () {});
  }

  /** O tema importado esta valendo agora? (so vale no modo em que foi feito) */
  function temaImportadoAtivo() {
    if (!settings.vscodeTheme) return false;
    return settings.vscodeTheme.escuro === document.body.classList.contains('theme-dark');
  }

  /**
   * Le um arquivo de tema do VS Code e adota.
   *
   * O arquivo vem de fora, entao nada dele chega ao CSS sem passar pelo filtro
   * de themes.js — e se o filtro derrubar tudo, o que sobra e a paleta de
   * casa, nao uma janela em branco.
   */
  function importarTemaVSCode() {
    return bridge.call('openFileDialog', { multi: false, filter: 'json' }).then(function (paths) {
      if (!paths || !paths.length) return null;
      var caminho = paths[0];
      return bridge.call('readFile', { path: caminho }).then(function (res) {
        var nome = caminho.split(/[\\/]/).pop().replace(/\.(json|jsonc)$/i, '');
        var tema = window.MarkPadThemes.doVSCode(res.content, nome);
        settings.vscodeTheme = tema;
        // Um tema escuro so aparece com a janela escura. Em vez de importar e
        // nao mostrar nada, a janela vai junto — foi o que o usuario pediu.
        var querEscuro = tema.escuro;
        var estaEscuro = document.body.classList.contains('theme-dark');
        if (querEscuro !== estaEscuro) settings.theme = querEscuro ? 'dark' : 'light';
        applyTheme();
        renderStatus();
        persist();
        toast(t('Tema "{nome}" importado.', { nome: tema.nome }), 'ok');
      });
    }).catch(function (err) {
      toast(t('Nao deu para importar: ') + (err && err.message ? err.message : err), 'error');
    });
  }

  function removerTemaVSCode() {
    settings.vscodeTheme = null;
    applyTheme();
    persist();
    toast(t('Tema importado removido.'), 'ok');
  }

  function applyFontSizes() {
    document.documentElement.style.setProperty('--font-text-size', settings.fontSize + 'px');
    document.documentElement.style.setProperty('--editor-font-size', settings.editorFontSize + 'px');
    document.body.classList.toggle('wide-lines', settings.wideLines);
    if (ed) ed.view.requestMeasure();
  }

  function zoom(delta) {
    settings.fontSize = Math.max(10, Math.min(30, settings.fontSize + delta));
    settings.editorFontSize = Math.max(9, Math.min(28, settings.editorFontSize + delta));
    applyFontSizes();
    renderStatus();
    persist();
  }

  function toggleSidebar(force) {
    settings.sidebarVisible = force === undefined ? !settings.sidebarVisible : force;
    document.body.classList.toggle('sidebar-hidden', !settings.sidebarVisible);
    persist();
  }

  // ======================================================= tela dividida
  //
  // Duas metades lado a lado (ou uma em cima da outra), cada uma com a sua
  // fileira de abas, como as duas vistas do Notepad++ e a divisao do
  // Obsidian. So uma visao e viva por vez (o editor de hoje, com tudo o que
  // ele sabe): a metade com o foco. A outra mostra a aba dela desenhada pelo
  // mesmo leitor, sempre atualizada; clicar nela passa o foco e o editor muda
  // de lado. A mesma nota nas duas metades e um espelho: so uma edita por vez
  // (a do foco) e a outra acompanha o texto enquanto se digita.

  function dividido() { return app.grupos.length > 1; }
  function grupoDe(tab) { return (tab && tab.grupo) || 1; }
  function grupoPorId(id) {
    for (var i = 0; i < app.grupos.length; i++) if (app.grupos[i].id === id) return app.grupos[i];
    return null;
  }
  function abasDoGrupo(gid) { return app.tabs.filter(function (t) { return grupoDe(t) === gid; }); }
  function outroGrupoDe(gid) { return gid === 1 ? 2 : 1; }
  function espelhosDe(tab) { return app.tabs.filter(function (t) { return t.espelhoDe === tab.id; }); }

  function garanteDivisao() {
    if (!dividido()) app.grupos.push({ id: 2, ativa: null, empilhado: false });
  }

  function criaEspelho(tab, gid) {
    var esp = makeTab({ name: tab.name, content: '' });
    esp.espelhoDe = tab.id;
    esp.grupo = gid;
    esp.locked = true;
    esp.readingScrollTop = tab.readingScrollTop || 0;
    // Entra logo depois da ultima aba daquela metade.
    var abas = abasDoGrupo(gid);
    var depois = abas.length ? app.tabs.indexOf(abas[abas.length - 1]) + 1 : app.tabs.length;
    app.tabs.splice(depois, 0, esp);
    var g = grupoPorId(gid);
    if (g) g.ativa = esp.id;
    return esp;
  }

  /** O espelho e o original trocam de metade (e de rolagem). */
  function trocaEspelho(esp, orig) {
    var i = app.tabs.indexOf(esp), j = app.tabs.indexOf(orig);
    app.tabs[i] = orig;
    app.tabs[j] = esp;
    var g1 = esp.grupo; esp.grupo = orig.grupo; orig.grupo = g1;
    var r = esp.readingScrollTop; esp.readingScrollTop = orig.readingScrollTop; orig.readingScrollTop = r;
    // Na metade para onde o espelho foi, ele so vira a aba da vez se o
    // original era a aba da vez de la.
    var ge = grupoPorId(esp.grupo), go = grupoPorId(orig.grupo);
    if (ge && ge.ativa === orig.id) ge.ativa = esp.id;
    if (go) go.ativa = orig.id;
  }

  /*
   * A aba original vai sair da nota (navegou ou fechou): o primeiro espelho
   * vira a propria nota, com texto, estado de salvo e historico; os outros
   * passam a espelhar ele.
   */
  function promoveEspelhos(tab) {
    var esps = espelhosDe(tab);
    if (!esps.length) return null;
    var novo = esps[0];
    ['path', 'name', 'dir', 'content', 'savedContent', 'originContent', 'encoding', 'eol', 'mtime', 'discoVisto',
      'readOnlyOnDisk', 'staleOnDisk', 'suspeita', 'apagadoNoDisco', 'rascunhoId', 'cor'].forEach(function (k) {
      if (tab[k] !== undefined) novo[k] = tab[k];
    });
    novo.locked = tab.locked;
    novo.showSource = tab.showSource;
    novo.espelhoDe = null;
    esps.slice(1).forEach(function (e) { e.espelhoDe = novo.id; });
    return novo;
  }

  function mudaDeGrupo(tab, gid) {
    if (grupoDe(tab) === gid) return;
    garanteDivisao();
    var origem = grupoDe(tab);
    tab.grupo = gid;
    // Espelho que caiu na mesma metade do original nao serve para nada.
    app.tabs.slice().forEach(function (t) {
      var par = t.espelhoDe ? tabById(t.espelhoDe) : null;
      if (par && grupoDe(par) === grupoDe(t)) app.tabs.splice(app.tabs.indexOf(t), 1);
    });
    var go = grupoPorId(origem);
    if (go && go.ativa === tab.id) {
      var resto = abasDoGrupo(origem);
      go.ativa = resto.length ? resto[0].id : null;
    }
    var gd = grupoPorId(gid);
    if (gd) gd.ativa = tab.id;
    recolheGrupoVazio();
    selectTab(tab.id);
  }

  /** Metade sem aba nenhuma some; se era a 1, a 2 vira a 1. */
  function recolheGrupoVazio() {
    if (!dividido()) return;
    var vazio1 = !abasDoGrupo(1).length, vazio2 = !abasDoGrupo(2).length;
    if (!vazio1 && !vazio2) return;
    if (vazio1) app.tabs.forEach(function (t) { t.grupo = 1; });
    var fica = vazio1 ? grupoPorId(2) : grupoPorId(1);
    app.grupos = [{ id: 1, ativa: fica.ativa, empilhado: !!fica.empilhado }];
    app.grupoAtivo = 1;
  }

  function depoisDeFechar(tab, idx) {
    var gid = grupoDe(tab);
    var g = grupoPorId(gid);
    var resto = abasDoGrupo(gid);
    if (g && g.ativa === tab.id) g.ativa = resto.length ? resto[Math.min(Math.max(0, idx - app.tabs.indexOf(resto[0])), resto.length - 1)].id : null;
    recolheGrupoVazio();
    if (app.activeId === tab.id) {
      var gf = grupoPorId(app.grupoAtivo) || app.grupos[0];
      var prox = gf && gf.ativa ? tabById(gf.ativa) : null;
      if (!prox) { var lista = abasDoGrupo(app.grupoAtivo); prox = lista[0] || app.tabs[0] || null; }
      if (prox && prox.espelhoDe) { var o = tabById(prox.espelhoDe); if (o) { trocaEspelho(prox, o); prox = o; } }
      app.activeId = prox ? prox.id : null;
      if (prox) app.grupoAtivo = grupoDe(prox);
    }
    renderAll();
    persist();
  }

  /** Dividir a direita ou abaixo: a mesma nota na nova metade, com o foco nela. */
  function dividir(direcao, tab) {
    tab = tab || activeTab();
    if (!tab) return;
    if (tab.espelhoDe) tab = tabById(tab.espelhoDe) || tab;
    settings.layoutDirecao = direcao;
    if (dividido()) {
      // Ja dividido: so muda a direcao, e a nota vai para a outra metade.
      mudaDeGrupo(tab, outroGrupoDe(grupoDe(tab)));
      persist();
      return;
    }
    garanteDivisao();
    var esp = criaEspelho(tab, 2);
    renderAll();
    selectTab(esp.id);   // a troca deixa o original (vivo) na metade nova
    persist();
  }

  function juntaMetades() {
    if (!dividido()) return;
    app.tabs.slice().forEach(function (t) {
      if (t.espelhoDe) app.tabs.splice(app.tabs.indexOf(t), 1);
      else t.grupo = 1;
    });
    var ativa = activeTab();
    var g1 = grupoPorId(1);
    app.grupos = [{ id: 1, ativa: ativa ? ativa.id : null, empilhado: !!(g1 && g1.empilhado) }];
    app.grupoAtivo = 1;
    renderAll();
    persist();
  }

  function focaOutraMetade() {
    if (!dividido()) return;
    var g = grupoPorId(outroGrupoDe(app.grupoAtivo));
    var tab = g && (tabById(g.ativa) || abasDoGrupo(g.id)[0]);
    if (tab) selectTab(tab.id);
  }

  function abreNoOutroGrupo(path, secao) {
    var ja = tabByPath(path);
    if (ja && !ja.espelhoDe && grupoDe(ja) !== app.grupoAtivo && dividido()) {
      selectTab(ja.id);
      saltaParaSecao(secao);
      return Promise.resolve(ja);
    }
    garanteDivisao();
    var destino = outroGrupoDe(app.grupoAtivo);
    if (ja) { mudaDeGrupo(ja, destino); saltaParaSecao(secao); return Promise.resolve(ja); }
    app.grupoAtivo = destino;
    return openPath(path).then(function (aba) {
      recolheGrupoVazio();
      renderAll();
      saltaParaSecao(secao);
      persist();
      return aba;
    });
  }

  function restauraGrupos() {
    var emp = settings.gruposEmpilhados || [];
    if (emp.indexOf(1) !== -1) { grupoPorId(1).empilhado = true; renderAll(); }
    var dois = (settings.sessaoGrupo2 || []).map(function (p) { return p.toLowerCase(); });
    if (!dois.length) return;
    var algum = false;
    app.tabs.forEach(function (t) {
      if (t.path && dois.indexOf(t.path.toLowerCase()) !== -1) { t.grupo = 2; algum = true; }
    });
    if (!algum || !abasDoGrupo(1).length) { app.tabs.forEach(function (t) { t.grupo = 1; }); return; }
    app.grupos = [{ id: 1, ativa: abasDoGrupo(1)[0].id, empilhado: emp.indexOf(1) !== -1 },
      { id: 2, ativa: abasDoGrupo(2)[0].id, empilhado: emp.indexOf(2) !== -1 }];
    var ativa = activeTab();
    app.grupoAtivo = grupoDe(ativa);
    grupoPorId(app.grupoAtivo).ativa = ativa ? ativa.id : null;
    renderAll();
  }

  // A visao viva e um no so; desmontar a pilha que a continha a tiraria do
  // documento, e ai o $('main') nao a acharia mais.
  var mainViva = null;
  function mainEl() { return mainViva || (mainViva = $('main')); }

  /** Posiciona a visao viva na metade do foco e desenha a(s) outra(s). */
  function renderGrupos() {
    var div = dividido();
    document.body.classList.toggle('dividido', div);
    var caixa = $('grupos');
    if (!caixa) return;
    caixa.classList.toggle('is-vertical', div && settings.layoutDirecao === 'v');
    $('grupo2').hidden = !div;
    $('grupoDivisor').hidden = !div;
    var foco = div ? app.grupoAtivo : 1;
    var prop = Math.max(0.15, Math.min(0.85, settings.layoutProporcao || 0.5));
    $('grupo1').style.flex = div ? prop + ' 1 0' : '';
    $('grupo2').style.flex = div ? (1 - prop) + ' 1 0' : '';
    var g1 = grupoPorId(1);
    document.body.classList.toggle('pilha-unica', !div && !!(g1 && g1.empilhado));
    // O grupo sem foco primeiro: se a visao viva estava na pilha dele, ela
    // sai antes de a pilha ser refeita, e o grupo com foco a recebe.
    var ordem = div ? [outroGrupoDe(foco), foco] : [1];
    ordem.forEach(function (gid) {
      $('grupo' + gid).classList.toggle('is-foco', div && gid === foco);
      desenhaGrupo(gid, gid === foco);
    });
  }

  function desenhaGrupo(gid, temFoco) {
    var g = grupoPorId(gid);
    var corpo = $('grupo' + gid).querySelector('.grupo-corpo');
    var main = mainEl();
    $('grupo' + gid).classList.toggle('is-empilhado', !!(g && g.empilhado));
    if (g && g.empilhado) {
      var solta = corpo.querySelector(':scope > .main-copia');
      if (solta) solta.hidden = true;
      desenhaPilha(gid, temFoco);
      return;
    }
    var pilha = corpo.querySelector('.pilha');
    if (pilha) {
      if (pilha.contains(main)) corpo.appendChild(main);
      pilha.remove();
    }
    if (temFoco) {
      if (main.parentNode !== corpo) corpo.appendChild(main);
      var copia = corpo.querySelector(':scope > .main-copia');
      if (copia) copia.hidden = true;
    } else {
      renderCopia(gid);
    }
  }

  // ------------------------------------------------------- abas empilhadas
  //
  // As abas empilhadas do Obsidian: cada aba do grupo e um painel com a
  // largura de leitura, lado a lado, com a lombada (o titulo na vertical) a
  // esquerda; rolando de lado, os paineis que saem encostam na borda como
  // lombadas. A aba da vez e a visao viva; as outras mostram a leitura.

  function alternaEmpilhar(gid) {
    gid = gid || app.grupoAtivo || 1;
    var g = grupoPorId(gid);
    if (!g) return;
    g.empilhado = !g.empilhado;
    settings.gruposEmpilhados = app.grupos.filter(function (x) { return x.empilhado; }).map(function (x) { return x.id; });
    renderAll();
    persist();
  }

  function desenhaPilha(gid, temFoco) {
    var corpo = $('grupo' + gid).querySelector('.grupo-corpo');
    var g = grupoPorId(gid);
    var main = mainEl();
    var pilha = corpo.querySelector('.pilha');
    if (!pilha) {
      pilha = document.createElement('div');
      pilha.className = 'pilha';
      corpo.appendChild(pilha);
    }
    if (main.parentNode === corpo) {
      // A visao viva estava solta no grupo: entra na pilha mais abaixo.
      if (!temFoco) pilha.appendChild(main);
    }
    var abas = abasDoGrupo(gid);
    if (g && !tabById(g.ativa)) g.ativa = abas[0] ? abas[0].id : null;
    var existentes = {};
    Array.prototype.forEach.call(pilha.children, function (item) { existentes[item.getAttribute('data-tab')] = item; });
    var vivas = {};
    abas.forEach(function (tab, i) {
      var item = existentes[tab.id] || criaItemPilha(tab);
      vivas[tab.id] = true;
      item.style.setProperty('--i', i);
      item.style.setProperty('--j', abas.length - 1 - i);
      var doc = tab.espelhoDe ? (tabById(tab.espelhoDe) || tab) : tab;
      var lomb = item.querySelector('.pilha-titulo');
      lomb.textContent = doc.name + (doc.content !== doc.savedContent ? ' •' : '');
      item.classList.toggle('is-espelho', !!tab.espelhoDe);
      var ativa = g && g.ativa === tab.id;
      item.classList.toggle('is-ativa', ativa);
      var conteudo = item.querySelector('.pilha-conteudo');
      var leitura = conteudo.querySelector('.pilha-leitura');
      if (temFoco && ativa) {
        if (leitura) leitura.hidden = true;
        if (main.parentNode !== conteudo) conteudo.appendChild(main);
      } else {
        if (!leitura) {
          leitura = document.createElement('div');
          leitura.className = 'reading-scroll pilha-leitura';
          var alvo = document.createElement('div');
          alvo.className = 'copia-conteudo markdown-preview';
          leitura.appendChild(alvo);
          conteudo.appendChild(leitura);
        }
        leitura.hidden = false;
        // So redesenha se o texto mudou: pilha com muitas abas seria lenta.
        var alvoL = leitura.firstChild;
        if (alvoL.__fonte !== doc.content || alvoL.__modo !== (doc.locked ? 'l' : 'e')) {
          alvoL.__fonte = doc.content;
          alvoL.__modo = doc.locked ? 'l' : 'e';
          renderPreview(alvoL, doc);
          var tarefas = alvoL.querySelectorAll('[data-task-line]');
          for (var k = 0; k < tarefas.length; k++) tarefas[k].removeAttribute('data-task-line');
          alvoL.onclick = function (e) {
            if (e.target.closest && e.target.closest('[data-wikilink],[data-file]')) e.preventDefault();
          };
        }
      }
      pilha.appendChild(item);
    });
    Object.keys(existentes).forEach(function (id) {
      if (vivas[id]) return;
      var item = existentes[id];
      if (item.contains(main)) corpo.appendChild(main);
      item.remove();
    });
    // Leva a aba da vez para a vista (so quando ela mudou).
    var ativaEl = pilha.querySelector('.pilha-item.is-ativa');
    if (ativaEl && pilha.__ativa !== (g && g.ativa)) {
      pilha.__ativa = g && g.ativa;
      // O painel i fica logo depois das i lombadas da esquerda: a posicao
      // natural dele (i larguras) menos as i lombadas. offsetLeft de item
      // grudado ja vem com o deslocamento do grude, entao nao serve.
      var idx = Array.prototype.indexOf.call(pilha.children, ativaEl);
      var largura = ativaEl.getBoundingClientRect().width;
      var lombada = ativaEl.querySelector('.pilha-lombada').getBoundingClientRect().width;
      pilha.scrollLeft = Math.max(0, idx * (largura - lombada));
    }
  }

  function criaItemPilha(tab) {
    var item = document.createElement('div');
    item.className = 'pilha-item';
    item.setAttribute('data-tab', String(tab.id));
    var lomb = document.createElement('div');
    lomb.className = 'pilha-lombada';
    var titulo = document.createElement('span');
    titulo.className = 'pilha-titulo';
    var fecha = document.createElement('button');
    fecha.type = 'button';
    fecha.className = 'pilha-fecha';
    fecha.title = t('Fechar');
    var x = window.MarkPadIcons.build('x', 12);
    if (x) fecha.appendChild(x);
    fecha.onclick = function (e) { e.stopPropagation(); closeTab(tab.id); };
    lomb.appendChild(fecha);
    lomb.appendChild(titulo);
    lomb.onclick = function () { selectTab(tab.id); };
    lomb.oncontextmenu = function (e) {
      e.preventDefault();
      var aba = tabById(tab.id);
      if (aba) showMenu(tabContextMenu(aba), e.clientX, e.clientY);
    };
    var conteudo = document.createElement('div');
    conteudo.className = 'pilha-conteudo';
    conteudo.addEventListener('click', function () {
      if (conteudo.contains(mainEl())) return;
      setTimeout(function () { if (tabById(tab.id)) selectTab(tab.id); }, 0);
    });
    item.appendChild(lomb);
    item.appendChild(conteudo);
    return item;
  }

  function criaCopia(gid) {
    var copia = document.createElement('div');
    copia.className = 'main main-copia';
    copia.setAttribute('data-grupo', String(gid));
    var cab = document.createElement('header');
    cab.className = 'view-header copia-cab';
    var ic = document.createElement('span');
    ic.className = 'view-icon';
    var svg = window.MarkPadIcons.build('file-text', 15);
    if (svg) ic.appendChild(svg);
    var nome = document.createElement('span');
    nome.className = 'view-name copia-nome';
    var dica = document.createElement('span');
    dica.className = 'copia-dica';
    cab.appendChild(ic);
    cab.appendChild(nome);
    cab.appendChild(dica);
    var rol = document.createElement('div');
    rol.className = 'reading-scroll copia-scroll';
    var alvo = document.createElement('div');
    alvo.className = 'copia-conteudo markdown-preview';
    rol.appendChild(alvo);
    copia.appendChild(cab);
    copia.appendChild(rol);
    rol.addEventListener('scroll', function () {
      var tab = tabById(copia.__tabId);
      if (tab) tab.readingScrollTop = rol.scrollTop;
    }, { passive: true });
    // Clicar na metade sem foco passa o foco para ela (depois do clique: um
    // link clicado aqui navega esta metade, como no Obsidian). Com o editor de
    // exibicao, o cursor cai no ponto clicado: a mesma nota, no mesmo lugar.
    copia.addEventListener('mousedown', function (e) {
      copia.__ponto = copia.__ed && copia.querySelector('.copia-editor').contains(e.target) ? { x: e.clientX, y: e.clientY } : null;
    }, true);
    copia.addEventListener('click', function () {
      var ponto = copia.__ponto;
      copia.__ponto = null;
      setTimeout(function () {
        var g = grupoPorId(gid);
        var tab = g && tabById(g.ativa);
        if (!tab || !dividido() || app.grupoAtivo === gid) return;
        selectTab(tab.id);
        var viva = activeTab();
        if (ponto && ed && viva && !viva.locked && ed.aba === viva) {
          requestAnimationFrame(function () { if (ed.cursorNoPonto(ponto.x, ponto.y)) ed.foco(); });
        }
      }, 0);
    });
    return copia;
  }

  /*
   * A metade sem foco, com nota destravada, mostra o mesmo editor (ao vivo ou
   * fonte) em modo de exibicao: sem digitar, mas com o mesmo desenho, para que
   * passar o foco nao mude a pagina. Um editor por copia, criado na primeira vez.
   */
  function editorDaCopia(copia) {
    if (copia.__ed || !window.MarkPadEditor) return copia.__ed || null;
    var caixa = document.createElement('div');
    caixa.className = 'copia-editor';
    copia.appendChild(caixa);
    var doc = function () { var tb = tabById(copia.__tabId); return tb && tb.espelhoDe ? tabById(tb.espelhoDe) : tb; };
    var e2 = window.MarkPadEditor.create(caixa, {
      t: t,
      renderTrecho: function (el, src, tipo) { renderTrecho(el, src, tipo, doc()); },
      wikiExiste: wikiExisteNoIndice,
      abreLink: function (el, e) {
        // O primeiro clique passa o foco; o link e seguido nesta metade.
        var tb = tabById(copia.__tabId);
        if (!tb || tb.espelhoDe) return;
        selectTab(tb.id);
        trataLink(el, e, null, tb);
      },
      travado: function () {}
    });
    e2.opcoes({ editavel: false });
    e2.view.scrollDOM.addEventListener('scroll', function () {
      var tb = tabById(copia.__tabId);
      if (tb && !tb.espelhoDe) tb.scrollTop = e2.rolagem();
    }, { passive: true });
    copia.__ed = e2;
    return e2;
  }

  function renderCopia(gid) {
    var corpo = $('grupo' + gid).querySelector('.grupo-corpo');
    var copia = corpo.querySelector(':scope > .main-copia');
    if (!copia) { copia = criaCopia(gid); corpo.appendChild(copia); }
    copia.hidden = false;
    var g = grupoPorId(gid);
    var tab = (g && tabById(g.ativa)) || abasDoGrupo(gid)[0] || null;
    if (g) g.ativa = tab ? tab.id : null;
    var doc = tab && tab.espelhoDe ? tabById(tab.espelhoDe) : tab;
    copia.querySelector('.copia-nome').textContent = doc ? doc.name : '';
    copia.querySelector('.copia-dica').textContent = tab && tab.espelhoDe ? t('mesma nota da outra metade') : '';
    copia.title = t('Clique para trabalhar nesta metade');
    var rol = copia.querySelector('.copia-scroll');
    var alvo = copia.querySelector('.copia-conteudo');
    var mesma = copia.__tabId === (tab && tab.id);
    var rolagem = mesma ? rol.scrollTop : (tab ? (tab.readingScrollTop || 0) : 0);
    copia.__tabId = tab ? tab.id : null;
    var caixaEd = copia.querySelector('.copia-editor');
    if (!doc) {
      alvo.className = 'copia-conteudo'; alvo.textContent = '';
      rol.hidden = false;
      if (caixaEd) caixaEd.hidden = true;
      return;
    }
    var e2 = !doc.locked ? editorDaCopia(copia) : null;
    rol.hidden = !!e2;
    caixaEd = copia.querySelector('.copia-editor');
    if (caixaEd) caixaEd.hidden = !e2;
    if (e2) {
      if (e2.docDe !== doc) {
        e2.carrega(doc.content, null, { anchor: 0 });
        e2.docDe = doc;
        e2.opcoes({ editavel: false, quebra: !!settings.wordWrap, numeros: settings.lineNumbers !== false });
        var px = (tab.espelhoDe ? null : tab.scrollTop) || 0;
        requestAnimationFrame(function () { e2.rolagem(px); });
      } else if (e2.texto() !== doc.content) {
        e2.defineTexto(doc.content);
      }
      e2.modo(doc.showSource ? 'fonte' : 'vivo');
      e2.defineStatusLinhas(lineStatus(doc));
      return;
    }
    if (doc.showSource && !doc.locked && !tab.espelhoDe) {
      alvo.className = 'copia-conteudo copia-fonte';
      alvo.textContent = doc.content;
    } else {
      alvo.className = 'copia-conteudo markdown-preview';
      renderPreview(alvo, doc);
      // Tarefa marcada aqui iria para a aba errada: na metade sem foco, vitrine.
      var tarefas = alvo.querySelectorAll('[data-task-line]');
      for (var i = 0; i < tarefas.length; i++) tarefas[i].removeAttribute('data-task-line');
      if (tab.espelhoDe) {
        // Link clicado no espelho navegaria o original na outra metade.
        alvo.onclick = function (e) { if (e.target.closest && e.target.closest('[data-wikilink],[data-file]')) e.preventDefault(); };
      }
    }
    rol.scrollTop = rolagem;
  }

  var espelhoTimer = null;
  /** Digitou na metade viva: o espelho da outra metade acompanha (com espera). */
  function atualizaEspelhos(tab) {
    if (!dividido() || !espelhosDe(tab).length) return;
    clearTimeout(espelhoTimer);
    espelhoTimer = setTimeout(function () {
      var outro = outroGrupoDe(app.grupoAtivo);
      var g = grupoPorId(outro);
      var mostrada = g && tabById(g.ativa);
      if (mostrada && mostrada.espelhoDe === tab.id) renderCopia(outro);
    }, 300);
  }

  function ligaDivisor() {
    var div = $('grupoDivisor');
    div.addEventListener('mousedown', function (e) {
      e.preventDefault();
      div.classList.add('is-dragging');
      var caixa = $('grupos').getBoundingClientRect();
      var vertical = settings.layoutDirecao === 'v';
      function move(ev) {
        var p = vertical ? (ev.clientY - caixa.top) / caixa.height : (ev.clientX - caixa.left) / caixa.width;
        settings.layoutProporcao = Math.max(0.15, Math.min(0.85, p));
        $('grupo1').style.flex = settings.layoutProporcao + ' 1 0';
        $('grupo2').style.flex = (1 - settings.layoutProporcao) + ' 1 0';
      }
      function up() {
        div.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    div.addEventListener('dblclick', function () {
      settings.layoutProporcao = 0.5;
      renderGrupos();
      persist();
    });
    // Soltar aba na fileira (fora de outra aba) ou no corpo da outra metade:
    // a aba vai para aquela metade. No corpo, sem divisao: divide.
    [1, 2].forEach(function (gid) {
      var fileira = $('grupo' + gid).querySelector('.grupo-abas');
      var corpo = $('grupo' + gid).querySelector('.grupo-corpo');
      [fileira, corpo].forEach(function (zona) {
        zona.addEventListener('dragover', function (e) {
          if (!arrastoAba) return;
          if (zona === corpo && dividido() && grupoDe(arrastoAba) === gid) return;
          e.preventDefault();
          zona.classList.add('is-alvo-aba');
        });
        zona.addEventListener('dragleave', function () { zona.classList.remove('is-alvo-aba'); });
        zona.addEventListener('drop', function (e) {
          zona.classList.remove('is-alvo-aba');
          if (!arrastoAba || e.defaultPrevented) return;
          e.preventDefault();
          var aba = arrastoAba;
          arrastoAba = null;
          if (!dividido()) { dividir('h', aba); return; }
          mudaDeGrupo(aba, gid);
          persist();
        });
      });
    });
    // Sem divisao: arrastar a aba para a borda direita do documento divide.
    var vb = $('viewBody');
    vb.addEventListener('dragover', function (e) {
      if (!arrastoAba || dividido()) return;
      var r = vb.getBoundingClientRect();
      if (e.clientX < r.left + r.width * 0.6) { vb.classList.remove('is-alvo-divisao'); return; }
      e.preventDefault();
      vb.classList.add('is-alvo-divisao');
    });
    vb.addEventListener('dragleave', function () { vb.classList.remove('is-alvo-divisao'); });
    vb.addEventListener('drop', function (e) {
      if (!vb.classList.contains('is-alvo-divisao')) return;
      vb.classList.remove('is-alvo-divisao');
      e.preventDefault();
      var aba = arrastoAba;
      arrastoAba = null;
      if (!aba) return;
      if (abasDoGrupo(1).length > 1) { garanteDivisao(); settings.layoutDirecao = 'h'; mudaDeGrupo(aba, 2); }
      else dividir('h', aba);
      persist();
    });
  }

  // ============================================================ marcadores
  //
  // Os favoritos do Obsidian (plugin Bookmarks): arquivo, titulo, busca e
  // pasta, soltos ou em grupos, num painel proprio. Sem cofre, a lista e uma
  // so para o MarkPad inteiro (settings.marcadores), com caminho absoluto.
  // Clique abre como um link (na propria aba, se ela puder trocar); Ctrl+clique
  // ou botao do meio, em aba nova. Arrastar reordena e poe dentro de grupo.

  function marcadores() {
    if (!Array.isArray(settings.marcadores)) settings.marcadores = [];
    return settings.marcadores;
  }

  /** Percorre a lista inteira, grupos inclusive: fn(item, lista, indice). */
  function cadaMarcador(fn, lista) {
    (lista || marcadores()).slice().forEach(function (m) {
      var arr = lista || marcadores();
      fn(m, arr, arr.indexOf(m));
      if (m.tipo === 'grupo') cadaMarcador(fn, m.itens || (m.itens = []));
    });
  }

  function achaMarcador(pred) {
    var achado = null;
    cadaMarcador(function (m, arr, i) { if (!achado && pred(m)) achado = { m: m, arr: arr, i: i }; });
    return achado;
  }

  function marcadorDoArquivo(path) {
    return path ? achaMarcador(function (m) { return m.tipo === 'arquivo' && mesmoArquivo(m.caminho, path); }) : null;
  }

  function salvaMarcadores() {
    persist();
    renderMarcadores();
    renderHeader();
  }

  function alternaMarcadorArquivo(path) {
    if (!path) return;
    var achado = marcadorDoArquivo(path);
    if (achado) {
      achado.arr.splice(achado.i, 1);
      toast(t('Marcador removido.'), '', 1600);
    } else {
      marcadores().push({ tipo: 'arquivo', caminho: path });
      toast(t('Marcado: {nome}', { nome: baseName(path) }), 'ok', 1600);
    }
    salvaMarcadores();
  }

  function adicionaMarcador(novo, igual) {
    if (achaMarcador(igual)) { toast(t('Já está nos marcadores.'), '', 1800); return; }
    marcadores().push(novo);
    toast(t('Marcado: {nome}', { nome: rotuloDoMarcador(novo) }), 'ok', 1600);
    salvaMarcadores();
  }

  function marcaTitulo(path, titulo) {
    if (!path || !titulo) return;
    adicionaMarcador({ tipo: 'titulo', caminho: path, titulo: titulo }, function (m) {
      return m.tipo === 'titulo' && mesmoArquivo(m.caminho, path) && m.titulo === titulo;
    });
  }

  function marcaBusca(consulta) {
    consulta = String(consulta || '').trim();
    if (!consulta) { toast(t('Digite uma busca antes de marcar.'), 'warn', 2000); return; }
    adicionaMarcador({ tipo: 'busca', consulta: consulta }, function (m) { return m.tipo === 'busca' && m.consulta === consulta; });
  }

  function marcaPasta(path) {
    if (!path) return;
    adicionaMarcador({ tipo: 'pasta', caminho: path }, function (m) { return m.tipo === 'pasta' && mesmoArquivo(m.caminho, path); });
  }

  /** O titulo da secao em que o leitor esta (o realcado no sumario). */
  function tituloAtual() {
    var row = $('outline').querySelector('.outline-row.is-current .outline-text');
    return row ? row.textContent : '';
  }

  function rotuloDoMarcador(m) {
    if (m.nome) return m.nome;
    if (m.tipo === 'arquivo') return semExtensao(baseName(m.caminho));
    if (m.tipo === 'titulo') return m.titulo;
    if (m.tipo === 'busca') return m.consulta;
    if (m.tipo === 'pasta') return baseName(m.caminho);
    return t('Grupo');
  }

  function iconeDoMarcador(m) {
    return { arquivo: 'file-text', titulo: 'heading', busca: 'search', pasta: 'folder', grupo: 'folder' }[m.tipo] || 'file-text';
  }

  /** Renomear ou mover dentro do app (ou por fora): os marcadores seguem. */
  function marcadoresSeguem(antigo, novo) {
    var mudou = false;
    cadaMarcador(function (m) {
      if (!m.caminho) return;
      if (mesmoArquivo(m.caminho, antigo)) { m.caminho = novo; mudou = true; return; }
      // Pasta renomeada: o que estava dentro dela tambem muda de caminho.
      var pre = antigo.replace(/[\\/]+$/, '');
      if (m.caminho.toLowerCase().indexOf(pre.toLowerCase()) === 0 && /[\\/]/.test(m.caminho.charAt(pre.length))) {
        m.caminho = novo + m.caminho.slice(pre.length);
        mudou = true;
      }
    });
    if (mudou) salvaMarcadores();
  }

  function abreMarcador(m, ev) {
    var novaAba = !!(ev && (ev.ctrlKey || ev.metaKey || ev.button === 1));
    if (m.tipo === 'grupo') { m.fechado = !m.fechado; salvaMarcadores(); return; }
    if (m.tipo === 'busca') { openFolderSearch(m.consulta); return; }
    if (m.tipo === 'pasta') {
      var raiz = String(app.folder || '').replace(/[\\/]+$/, '');
      if (raiz && m.caminho.toLowerCase().indexOf(raiz.toLowerCase()) === 0 && /[\\/]/.test(m.caminho.charAt(raiz.length))) revelaNaArvore(m.caminho);
      else setFolder(m.caminho);
      return;
    }
    abreDestino(m.caminho, { origem: activeTab(), novaAba: novaAba, secao: m.tipo === 'titulo' ? m.titulo : null });
  }

  function renderMarcadores() {
    var box = $('bookmarkList');
    if (!box) return;
    box.textContent = '';
    var lista = marcadores();
    if (!lista.length) {
      var vazio = document.createElement('p');
      vazio.className = 'pane-empty';
      vazio.textContent = t('Nada marcado ainda. Use a estrela no cabeçalho da nota, o menu da aba, da árvore ou do sumário, ou o botão da busca.');
      box.appendChild(vazio);
      return;
    }
    box.appendChild(desenhaMarcadores(lista, 0));
  }

  var arrastoMarcador = null;   // { m, arr }

  function desenhaMarcadores(lista, nivel) {
    var frag = document.createDocumentFragment();
    lista.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'marcador-item' + (m.tipo === 'grupo' ? ' is-grupo' : '');
      row.style.setProperty('--indent', (6 + nivel * 14) + 'px');
      row.draggable = true;
      row.setAttribute('role', 'treeitem');
      if (m.tipo === 'grupo') row.setAttribute('aria-expanded', m.fechado ? 'false' : 'true');

      var twist = document.createElement('span');
      twist.className = 'twist' + (m.tipo === 'grupo' && !m.fechado ? ' is-open' : '');
      if (m.tipo === 'grupo') {
        var chev = window.MarkPadIcons.build('chevron-right', 13);
        if (chev) twist.appendChild(chev);
      }
      row.appendChild(twist);

      var ic = document.createElement('span');
      ic.className = 'twist';
      var svg = window.MarkPadIcons.build(m.tipo === 'grupo' && !m.fechado ? 'folder-open' : iconeDoMarcador(m), 13);
      if (svg) ic.appendChild(svg);
      row.appendChild(ic);

      var nome = document.createElement('span');
      nome.className = 'marcador-nome';
      nome.textContent = rotuloDoMarcador(m);
      row.appendChild(nome);

      var sub = null;
      if (m.tipo === 'titulo') sub = semExtensao(baseName(m.caminho));
      else if (m.tipo === 'arquivo' || m.tipo === 'pasta') {
        // Na raiz da pasta aberta, nada; dentro dela, o caminho relativo;
        // fora, so o nome da pasta de origem (o caminho inteiro esta na dica).
        var dirDoItem = m.caminho.replace(/[\\/][^\\/]*$/, '');
        var rel = relNaPasta(dirDoItem);
        if (app.folder && mesmoArquivo(dirDoItem.replace(/[\\/]+$/, ''), String(app.folder).replace(/[\\/]+$/, ''))) sub = null;
        else sub = rel === dirDoItem.replace(/\\/g, '/') ? baseName(dirDoItem) : rel;
      } else if (m.tipo === 'grupo') sub = String((m.itens || []).length);
      if (sub) {
        var s2 = document.createElement('span');
        s2.className = 'marcador-sub';
        s2.textContent = sub;
        row.appendChild(s2);
      }
      row.title = m.caminho ? m.caminho + (m.titulo ? ' › ' + m.titulo : '') : (m.tipo === 'busca' ? t('Busca: {q}', { q: m.consulta }) : '');
      if (m.tipo === 'arquivo' || m.tipo === 'titulo') {
        row.setAttribute('data-previa-caminho', m.caminho);
        if (m.titulo) row.setAttribute('data-previa-secao', m.titulo);
      }

      row.onclick = function (e) { abreMarcador(m, e); };
      row.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); abreMarcador(m, e); } };
      row.oncontextmenu = function (e) {
        e.preventDefault();
        showMenu(menuDoMarcador(m, lista), e.clientX, e.clientY);
      };

      row.ondragstart = function (e) {
        arrastoMarcador = { m: m, arr: lista };
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', rotuloDoMarcador(m)); } catch (x) {}
        row.classList.add('is-arrastando');
      };
      row.ondragend = function () {
        arrastoMarcador = null;
        row.classList.remove('is-arrastando');
        limpaAlvosMarcador();
      };
      row.ondragover = function (e) {
        if (!arrastoMarcador || arrastoMarcador.m === m) return;
        e.preventDefault();
        var r = row.getBoundingClientRect();
        var y = (e.clientY - r.top) / r.height;
        var lugar = m.tipo === 'grupo' && y > 0.3 && y < 0.7 ? 'dentro' : (y < 0.5 ? 'antes' : 'depois');
        limpaAlvosMarcador();
        row.classList.add('alvo-' + lugar);
        row.__lugar = lugar;
      };
      row.ondragleave = function () { row.classList.remove('alvo-antes', 'alvo-depois', 'alvo-dentro'); };
      row.ondrop = function (e) {
        e.preventDefault();
        var arr = arrastoMarcador;
        limpaAlvosMarcador();
        if (!arr || arr.m === m) return;
        // Grupo nao entra nele mesmo nem num filho dele.
        if (arr.m.tipo === 'grupo' && contemMarcador(arr.m, m)) return;
        arr.arr.splice(arr.arr.indexOf(arr.m), 1);
        if (row.__lugar === 'dentro') {
          (m.itens || (m.itens = [])).push(arr.m);
          m.fechado = false;
        } else {
          var i = lista.indexOf(m);
          lista.splice(row.__lugar === 'depois' ? i + 1 : i, 0, arr.m);
        }
        arrastoMarcador = null;
        salvaMarcadores();
      };

      frag.appendChild(row);
      if (m.tipo === 'grupo' && !m.fechado) {
        var filhos = document.createElement('div');
        filhos.className = 'marcador-filhos';
        filhos.setAttribute('role', 'group');
        filhos.appendChild(desenhaMarcadores(m.itens || (m.itens = []), nivel + 1));
        frag.appendChild(filhos);
      }
    });
    return frag;
  }

  function contemMarcador(grupo, alvo) {
    return (grupo.itens || []).some(function (f) { return f === alvo || (f.tipo === 'grupo' && contemMarcador(f, alvo)); });
  }

  function limpaAlvosMarcador() {
    var rows = document.querySelectorAll('.marcador-item');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('alvo-antes', 'alvo-depois', 'alvo-dentro');
  }

  function grupos(lista, saida) {
    saida = saida || [];
    (lista || marcadores()).forEach(function (m) {
      if (m.tipo === 'grupo') { saida.push(m); grupos(m.itens || [], saida); }
    });
    return saida;
  }

  function menuDoMarcador(m, lista) {
    var itens = [];
    if (m.tipo === 'arquivo' || m.tipo === 'titulo') {
      itens.push({ label: t('Abrir em nova aba'), icon: 'file-text', action: function () { abreMarcador(m, { ctrlKey: true }); } });
    }
    if (m.tipo === 'arquivo' || m.tipo === 'pasta') {
      itens.push({ label: t('Revelar na árvore'), icon: 'folder-open', action: function () { revelaNaArvore(m.caminho); } });
    }
    if (itens.length) itens.push('-');
    itens.push({ label: m.tipo === 'grupo' ? t('Renomear grupo...') : t('Renomear marcador...'), icon: 'text', action: function () {
      promptDialog(t('Nome do marcador'), m.tipo === 'grupo' ? '' : t('Em branco volta ao nome original.'), { value: m.nome || (m.tipo === 'grupo' ? '' : rotuloDoMarcador(m)),
          validate: function (v) { return m.tipo === 'grupo' && !v ? t('Digite alguma coisa.') : null; } })
        .then(function (v) {
          if (v === null || v === undefined) return;
          v = String(v).trim();
          if (m.tipo === 'grupo') { if (v) m.nome = v; }
          else if (!v || v === rotuloDoMarcador({ tipo: m.tipo, caminho: m.caminho, titulo: m.titulo, consulta: m.consulta })) delete m.nome;
          else m.nome = v;
          salvaMarcadores();
        });
    } });
    var destinos = grupos().filter(function (g) { return g !== m && !(m.tipo === 'grupo' && contemMarcador(m, g)); });
    if (destinos.length || lista !== marcadores()) {
      itens.push({ label: t('Mover para'), header: true });
      if (lista !== marcadores()) {
        itens.push({ label: t('Fora de grupo'), action: function () { lista.splice(lista.indexOf(m), 1); marcadores().push(m); salvaMarcadores(); } });
      }
      destinos.forEach(function (g) {
        if ((g.itens || []).indexOf(m) !== -1) return;
        itens.push({ label: rotuloDoMarcador(g), icon: 'folder', action: function () {
          lista.splice(lista.indexOf(m), 1);
          (g.itens || (g.itens = [])).push(m);
          salvaMarcadores();
        } });
      });
    }
    itens.push('-');
    itens.push({ label: m.tipo === 'grupo' ? t('Remover grupo (os itens ficam)') : t('Remover marcador'), icon: 'trash', action: function () {
      var i = lista.indexOf(m);
      lista.splice(i, 1);
      if (m.tipo === 'grupo') Array.prototype.splice.apply(lista, [i, 0].concat(m.itens || []));
      salvaMarcadores();
    } });
    return itens;
  }

  function novoGrupoDeMarcadores() {
    promptDialog(t('Novo grupo'), t('Nome do grupo de marcadores'), { value: '' }).then(function (v) {
      v = String(v || '').trim();
      if (!v) return;
      marcadores().push({ tipo: 'grupo', nome: v, itens: [] });
      salvaMarcadores();
    });
  }

  /** O botao de marcador do cabecalho: cheio quando a nota ja esta marcada. */
  function renderBotaoMarcador(tab) {
    var b = $('btnMarcar');
    if (!b) return;
    var marcada = !!(tab && tab.path && marcadorDoArquivo(tab.path));
    b.disabled = !(tab && tab.path);
    b.classList.toggle('is-on', marcada);
    b.title = marcada ? t('Desmarcar esta nota') : t('Marcar esta nota');
  }

  // ================================================================ dicas
  //
  // A dica do Obsidian no lugar da do Windows: a do sistema demora, sai com a
  // cara do Windows (ignora o tema) e some quando quer. Esta segue o tema,
  // espera 700 ms na primeira vez e aparece na hora ao passar de um botao para
  // o vizinho (ate 300 ms depois de a anterior sumir). O texto continua vindo
  // do `title` que o codigo ja poe: ao pairar ele vira `data-dica`, e tambem
  // `aria-label` quando o elemento nao tem texto proprio (leitor de tela e UI
  // Automation continuam achando o botao pelo nome). Dentro do documento fica
  // a do sistema: la quem fala e o autor da nota, e a previa de link ja ocupa
  // o pairar.
  var dica = { el: null, alvo: null, timer: null, sumiuEm: 0, clicado: null };
  var DICA_ESPERA = 700, DICA_EMENDA = 300;
  var SEM_DICA = '#preview, .markdown-preview, .previa-pagina, textarea, input, select';

  function textoDaDica(el) {
    if (el.hasAttribute('title')) {
      var txt = el.getAttribute('title');
      el.removeAttribute('title');
      if (txt) {
        el.setAttribute('data-dica', txt);
        if (el.hasAttribute('data-dica-nome') || (!el.hasAttribute('aria-label') && !el.textContent.trim())) {
          el.setAttribute('aria-label', txt);
          el.setAttribute('data-dica-nome', '');
        }
      } else {
        el.removeAttribute('data-dica');
      }
    }
    return el.getAttribute('data-dica') || '';
  }

  function escondeDica() {
    clearTimeout(dica.timer);
    dica.timer = null;
    dica.alvo = null;
    if (dica.el) {
      dica.el.remove();
      dica.el = null;
      dica.sumiuEm = Date.now();
    }
  }

  function mostraDica(el, texto) {
    if (!el.isConnected) return;
    if (dica.el) dica.el.remove();
    var d = document.createElement('div');
    d.className = 'dica';
    d.setAttribute('role', 'tooltip');
    d.textContent = texto;
    document.body.appendChild(d);
    dica.el = d;

    var r = el.getBoundingClientRect();
    var w = d.offsetWidth, h = d.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var M = 6, GAP = 7;
    var top, left;
    if (el.closest('.sidebar-tabs')) {
      // Faixa vertical de icones: a dica sai do lado, como na do Obsidian.
      top = r.top + r.height / 2 - h / 2;
      left = r.right + GAP;
      d.classList.add('is-lado');
    } else {
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - w / 2;
      if (top + h > vh - M) top = r.top - h - GAP;   // sem espaco embaixo: em cima
    }
    d.style.top = Math.max(M, Math.min(top, vh - h - M)) + 'px';
    d.style.left = Math.max(M, Math.min(left, vw - w - M)) + 'px';
  }

  function instalaDicas() {
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var el = e.target && e.target.closest ? e.target.closest('[title], [data-dica]') : null;
      if (!el || el.closest(SEM_DICA)) return;
      if (el === dica.alvo) return;
      // Clicou: a dica desse elemento so volta depois que o mouse sair dele
      // (como a do sistema), mesmo que o clique tenha trocado o texto.
      if (el === dica.clicado) return;
      var texto = textoDaDica(el);
      clearTimeout(dica.timer);
      if (!texto) { escondeDica(); return; }
      var emenda = !!dica.el || Date.now() - dica.sumiuEm < DICA_EMENDA;
      if (dica.el) { dica.el.remove(); dica.el = null; dica.sumiuEm = Date.now(); }
      dica.alvo = el;
      if (emenda) mostraDica(el, texto);
      else dica.timer = setTimeout(function () { if (dica.alvo === el) mostraDica(el, texto); }, DICA_ESPERA);
    }, true);
    document.addEventListener('pointerout', function (e) {
      var para = e.relatedTarget;
      if (dica.clicado && !(para && dica.clicado.contains(para))) dica.clicado = null;
      if (!dica.alvo) return;
      if (para && dica.alvo.contains(para)) return;
      escondeDica();
    }, true);
    document.addEventListener('pointerdown', function (e) {
      dica.clicado = e.target && e.target.closest ? e.target.closest('[title], [data-dica]') : null;
      escondeDica();
    }, true);
    ['keydown', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, escondeDica, true);
    });
    window.addEventListener('blur', escondeDica);
  }

  // ======================================================= paleta / menu

  function commands() {
    var tab = activeTab();
    var unlocked = tab && !tab.locked;

    var modo = modoDe(tab);

    return [
      { id: 'open', label: t('Abrir arquivo...'), key: 'Ctrl+O', icon: 'file-text', action: doOpen },
      { id: 'openFolder', label: t('Abrir pasta...'), key: 'Ctrl+Shift+O', icon: 'folder-open', action: doOpenFolder },
      { id: 'new', label: t('Nova nota'), key: 'Ctrl+N', icon: 'plus', action: newTab },
      { id: 'notaDiaria', label: t('Abrir a nota de hoje'), icon: 'clock', action: abreNotaDeHoje },
      { id: 'espacoSalva', label: t('Salvar espaco de trabalho...'), icon: 'columns', enabled: !!tab, action: salvaEspaco },
      { id: 'espacoAbre', label: t('Abrir espaco de trabalho...'), icon: 'columns', action: abreEspaco },
      { id: 'espacoApaga', label: t('Apagar espaco de trabalho...'), icon: 'columns', action: apagaEspaco },
      { id: 'notaUnica', label: t('Nova nota única (nome com data e hora)'), icon: 'plus', action: novaNotaUnica },
      { id: 'modelo', label: t('Inserir modelo...'), icon: 'file-text', enabled: !!unlocked, action: insereModelo },
      { id: 'aleatoria', label: t('Abrir uma nota aleatória'), icon: 'file-text', action: abreNotaAleatoria },
      { id: 'extrair', label: t('Extrair a seleção para uma nota nova'), icon: 'file-text', enabled: !!unlocked, action: extraiSelecao },
      { id: 'save', label: t('Salvar'), key: 'Ctrl+S', icon: 'save', enabled: !!unlocked, action: function () { saveTab(); } },
      { id: 'saveAs', label: t('Salvar como...'), key: 'Ctrl+Shift+S', icon: 'save', enabled: !!tab, action: function () { saveTab(activeTab(), true); } },
      { id: 'close', label: t('Fechar aba'), key: 'Ctrl+W', icon: 'x', enabled: !!tab, action: function () { closeTab(app.activeId); } },
      { id: 'reopen', label: t('Reabrir aba fechada'), key: 'Ctrl+Shift+T', icon: 'refresh', enabled: !!app.fechadas.length, action: reabrirAba },
      { id: 'pin', label: tab && tab.fixada ? t('Desafixar aba') : t('Fixar aba'), icon: 'pin', enabled: !!tab, action: function () { alternaFixacao(activeTab()); } },
      { id: 'back', label: t('Voltar'), key: 'Alt+←', icon: 'arrow-left', enabled: !!(tab && tab.historico && tab.historico.voltar.length), action: function () { navega(-1); } },
      { id: 'forward', label: t('Avançar'), key: 'Alt+→', icon: 'arrow-right', enabled: !!(tab && tab.historico && tab.historico.avancar.length), action: function () { navega(1); } },
      { id: 'lock', label: unlocked ? t('Travar edicao') : t('Liberar edicao'), key: 'Ctrl+E', icon: unlocked ? 'lock' : 'unlock', enabled: !!tab, action: toggleLock },
      { id: 'modeRead', label: t('Modo: leitura'), icon: 'book-open', enabled: !!tab, checked: modo === 'leitura', action: function () { setModo('leitura'); } },
      { id: 'modeLive', label: t('Modo: edicao ao vivo'), icon: 'pencil', enabled: !!tab, checked: modo === 'vivo', action: function () { setModo('vivo'); } },
      { id: 'modeSource', label: t('Modo: codigo-fonte'), key: 'Ctrl+Shift+C', icon: 'code', enabled: !!tab, checked: modo === 'fonte', action: function () { setModo('fonte'); } },
      { id: 'modeSplit', label: t('Leitura ao lado do codigo'), key: 'Ctrl+Shift+L', icon: 'columns', enabled: modo === 'fonte', checked: !!(tab && tab.showSource && tab.showPreview), action: togglePreviewPane },
      { id: 'find', label: t('Localizar no documento'), key: 'Ctrl+F', icon: 'search', enabled: !!tab, action: openFind },
      { id: 'replace', label: t('Substituir no documento'), key: 'Ctrl+H', icon: 'text', enabled: !!unlocked, action: openReplace },
      { id: 'findFolder', label: t('Buscar na pasta'), key: 'Ctrl+Shift+F', icon: 'search', action: function () { openFolderSearch(); } },
      { id: 'goto', label: t('Ir para a linha...'), key: 'Ctrl+G', icon: 'list', enabled: !!tab, action: promptGoToLine },
      { id: 'foldAll', label: t('Recolher todas as secoes'), key: 'Ctrl+Shift+-', icon: 'chevron-up', enabled: !!tab, action: function () { setAllFolds(true); } },
      { id: 'unfoldAll', label: t('Expandir todas as secoes'), key: 'Ctrl+Shift++', icon: 'chevron-down', enabled: !!tab, action: function () { setAllFolds(false); } },
      { id: 'reload', label: t('Recarregar do disco'), icon: 'refresh', enabled: !!(tab && tab.path), action: function () { reloadFromDisk(); } },
      { id: 'wrap', label: t('Quebra automatica de linha'), key: 'Alt+Z', icon: 'wrap', checked: settings.wordWrap, action: function () { settings.wordWrap = !settings.wordWrap; applyWrap(); renderEditorHighlight(); renderStatus(); persist(); } },
      { id: 'properties', label: t('Mostrar propriedades'), icon: 'list', checked: settings.showProperties !== false, action: function () { settings.showProperties = settings.showProperties === false; renderViews(); persist(); } },
      { id: 'gutter', label: t('Numeros de linha'), icon: 'list', checked: settings.lineNumbers, action: function () { settings.lineNumbers = !settings.lineNumbers; renderEditorHighlight(); persist(); } },
      { id: 'corretor', label: t('Verificar ortografia'), icon: 'text', checked: !!settings.corretor, action: function () { settings.corretor = !settings.corretor; renderEditorHighlight(); persist(); } },
      { id: 'wide', label: t('Largura total da linha'), icon: 'columns', checked: settings.wideLines, action: function () { settings.wideLines = !settings.wideLines; applyFontSizes(); persist(); } },
      { id: 'lockOnOpen', label: t('Abrir sempre travado'), icon: 'lock', checked: settings.lockOnOpen, action: function () { settings.lockOnOpen = !settings.lockOnOpen; persist(); toast(settings.lockOnOpen ? t('Novos arquivos abrirao travados.') : t('Novos arquivos abrirao destravados.'), 'ok'); } },
      { id: 'confirmUnlock', label: t('Pedir confirmacao ao destravar'), icon: 'unlock', checked: settings.confirmUnlock, action: function () { settings.confirmUnlock = !settings.confirmUnlock; persist(); } },
      { id: 'autoSave', label: t('Salvar automaticamente'), icon: 'save', checked: settings.autoSave, action: function () { settings.autoSave = !settings.autoSave; persist(); toast(settings.autoSave ? t('Salvamento automatico ligado.') : t('Salvamento automatico desligado.'), 'ok'); } },
      { id: 'remote', label: t('Carregar imagens da internet'), icon: 'eye', checked: settings.loadRemoteImages, action: function () { settings.loadRemoteImages = !settings.loadRemoteImages; renderViews(); persist(); } },
      { id: 'treeFilter', label: t('Painel: só arquivos markdown'), icon: 'folder', checked: settings.treeOnlyMarkdown, action: function () { settings.treeOnlyMarkdown = !settings.treeOnlyMarkdown; renderTreeFilter(); refreshTree(); persist(); } },
      { id: 'warnNonMd', label: t('Avisar ao abrir arquivo não-markdown'), icon: 'warning', checked: settings.warnNonMarkdown, action: function () { settings.warnNonMarkdown = !settings.warnNonMarkdown; persist(); toast(settings.warnNonMarkdown ? t('O aviso volta a aparecer.') : t('Aviso desligado.'), 'ok'); } },
      { id: 'theme', label: t('Alternar tema'), icon: settings.theme === 'light' ? 'moon' : 'sun', action: cycleTheme },
      { id: 'palette', label: t('Paleta de cores...'), icon: 'sun', action: function () { openSettings('aparencia'); } },
      { id: 'zoomIn', label: t('Aumentar fonte'), key: 'Ctrl++', icon: 'plus', action: function () { zoom(1); } },
      { id: 'zoomOut', label: t('Diminuir fonte'), key: 'Ctrl+-', icon: 'x', action: function () { zoom(-1); } },
      { id: 'zoomReset', label: t('Fonte padrao'), key: 'Ctrl+0', icon: 'refresh', action: function () { settings.fontSize = 16; settings.editorFontSize = 14; applyFontSizes(); renderStatus(); persist(); } },
      { id: 'sidebar', label: t('Painel lateral'), key: 'Ctrl+\\', icon: 'panel-left', checked: settings.sidebarVisible, action: function () { toggleSidebar(); } },
      { id: 'sidebarRight', label: t('Painel da direita'), key: 'Ctrl+Shift+\\', icon: 'panel-right', checked: settings.sidebarDireitaVisivel !== false, action: function () { toggleSidebarDireita(); } },
      { id: 'graph', label: t('Grafo local'), icon: 'graph', action: function () { setPane('graph'); } },
      { id: 'rename', label: t('Renomear...'), key: 'F2', icon: 'text', enabled: !!(tab && tab.path), action: function () { renameDoc(activeTab().path); } },
      { id: 'move', label: t('Mover para...'), icon: 'folder', enabled: !!(tab && tab.path), action: function () { moveDoc(activeTab().path); } },
      { id: 'duplicate', label: t('Duplicar'), icon: 'copy', enabled: !!(tab && tab.path), action: function () { duplicateDoc(activeTab().path); } },
      { id: 'versions', label: t('Historico de versoes...'), icon: 'clock', enabled: !!(tab && tab.path), action: function () { abreVersoes(activeTab().path); } },
      { id: 'drafts', label: t('Rascunhos não salvos...'), icon: 'clock', action: function () { offerBackups(true); } },
      { id: 'bookmarkFile', label: tab && tab.path && marcadorDoArquivo(tab.path) ? t('Desmarcar esta nota') : t('Marcar esta nota'), icon: 'bookmark', enabled: !!(tab && tab.path), action: function () { alternaMarcadorArquivo(activeTab().path); } },
      { id: 'bookmarkHeading', label: t('Marcar o título atual'), icon: 'bookmark', enabled: !!(tab && tab.path), action: function () {
          var titulo = tituloAtual();
          if (!titulo) { toast(t('Role até uma seção com título primeiro.'), 'warn', 2200); return; }
          marcaTitulo(activeTab().path, titulo);
        } },
      { id: 'bookmarksPane', label: t('Mostrar marcadores'), icon: 'bookmark', action: function () {
          setPane('bookmarks');
        } },
      { id: 'splitRight', label: t('Dividir à direita'), icon: 'columns', enabled: !!tab, action: function () { dividir('h'); } },
      { id: 'splitDown', label: t('Dividir abaixo'), icon: 'columns', enabled: !!tab, action: function () { dividir('v'); } },
      { id: 'otherHalf', label: t('Ir para a outra metade'), key: 'F8', icon: 'columns', enabled: dividido(), action: focaOutraMetade },
      { id: 'moveHalf', label: t('Mover aba para a outra metade'), icon: 'columns', enabled: !!tab && dividido(), action: function () { var a = activeTab(); mudaDeGrupo(a, outroGrupoDe(grupoDe(a))); persist(); } },
      { id: 'sortAz', label: t('Ordenar linhas (A a Z)'), icon: 'sort', enabled: !!tab && !tab.locked, action: function () { opLinhas('az'); } },
      { id: 'sortZa', label: t('Ordenar linhas (Z a A)'), icon: 'sort', enabled: !!tab && !tab.locked, action: function () { opLinhas('za'); } },
      { id: 'sortLen', label: t('Ordenar linhas por tamanho'), icon: 'sort', enabled: !!tab && !tab.locked, action: function () { opLinhas('tamanho'); } },
      { id: 'sortRev', label: t('Inverter a ordem das linhas'), icon: 'sort', enabled: !!tab && !tab.locked, action: function () { opLinhas('inverter'); } },
      { id: 'sortList', label: t('Ordenar itens da lista (com os subitens)'), icon: 'sort', enabled: !!tab && !tab.locked, action: function () { opLinhas('lista'); } },
      { id: 'dedupe', label: t('Remover linhas duplicadas'), icon: 'minus', enabled: !!tab && !tab.locked, action: function () { opLinhas('duplicadas'); } },
      { id: 'dedupeNext', label: t('Remover duplicadas seguidas'), icon: 'minus', enabled: !!tab && !tab.locked, action: function () { opLinhas('seguidas'); } },
      { id: 'squeezeBlank', label: t('Reduzir linhas vazias seguidas a uma'), icon: 'minus', enabled: !!tab && !tab.locked, action: function () { opLinhas('reduzVazias'); } },
      { id: 'dropBlank', label: t('Remover linhas vazias'), icon: 'minus', enabled: !!tab && !tab.locked, action: function () { opLinhas('vazias'); } },
      { id: 'trimRight', label: t('Aparar espaços no fim das linhas'), icon: 'text', enabled: !!tab && !tab.locked, action: function () { opLinhas('aparar'); } },
      { id: 'tabsSpaces', label: t('Recuo: TAB para espaços'), icon: 'text', enabled: !!tab && !tab.locked, action: function () { opLinhas('tabEspaco'); } },
      { id: 'spacesTabs', label: t('Recuo: espaços para TAB'), icon: 'text', enabled: !!tab && !tab.locked, action: function () { opLinhas('espacoTab'); } },
      { id: 'joinLines', label: t('Unir linhas'), key: 'Ctrl+J', icon: 'text', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('Unir linhas'), window.MarkPadTextOps.unirLinhas, true); } },
      { id: 'upper', label: t('MAIÚSCULAS'), key: 'Ctrl+Shift+U', icon: 'text', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('MAIÚSCULAS'), function (x, a, b) { return window.MarkPadTextOps.trocaCaixa(x, a, b, 'maiusculas'); }, true); } },
      { id: 'lower', label: t('minúsculas'), key: 'Ctrl+U', icon: 'text', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('minúsculas'), function (x, a, b) { return window.MarkPadTextOps.trocaCaixa(x, a, b, 'minusculas'); }, true); } },
      { id: 'titleCase', label: t('Iniciais Maiúsculas (título)'), icon: 'text', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('Iniciais Maiúsculas (título)'), function (x, a, b) { return window.MarkPadTextOps.trocaCaixa(x, a, b, 'titulo'); }, true); } },
      { id: 'sentenceCase', label: t('Primeira letra da frase maiúscula'), icon: 'text', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('Primeira letra da frase maiúscula'), function (x, a, b) { return window.MarkPadTextOps.trocaCaixa(x, a, b, 'frase'); }, true); } },
      { id: 'deleteLine', label: t('Apagar linha'), key: 'Ctrl+Shift+K', icon: 'trash', enabled: !!tab && !tab.locked, action: function () { aplicaOperacao(t('Apagar linha'), window.MarkPadTextOps.apagaLinhas, true); } },
      { id: 'popout', label: t('Mover aba para nova janela'), icon: 'external', enabled: !!(tab && tab.path), action: function () { destacaAba(activeTab()); } },
      { id: 'stackTabs', label: t('Empilhar abas'), icon: 'columns', checked: !!(grupoPorId(app.grupoAtivo) || {}).empilhado, action: function () { alternaEmpilhar(); } },
      { id: 'joinHalves', label: t('Juntar as metades'), icon: 'columns', enabled: dividido(), action: juntaMetades },
      { id: 'flipHalves', label: t('Alternar divisão lado a lado / em cima e embaixo'), icon: 'columns', enabled: dividido(), action: function () { settings.layoutDirecao = settings.layoutDirecao === 'v' ? 'h' : 'v'; renderGrupos(); persist(); } },
      { id: 'monitor', label: t('Monitorar (tail -f)'), icon: 'eye', checked: !!(tab && tab.monitorar), enabled: !!(tab && tab.path), action: function () { alternaMonitorar(activeTab()); } },
      { id: 'revealTree', label: t('Revelar na árvore'), icon: 'folder-open', enabled: !!(tab && tab.path && app.folder), action: function () { revelaNaArvore(activeTab().path); } },
      { id: 'openWith', label: t('Abrir no app padrao do Windows'), icon: 'external', enabled: !!(tab && tab.path), action: function () { openWithDefaultApp(activeTab().path); } },
      { id: 'delete', label: t('Excluir arquivo...'), icon: 'trash', enabled: !!(tab && tab.path), action: function () { deleteDoc(activeTab().path); } },
      { id: 'export', label: t('Exportar como HTML...'), icon: 'external', enabled: !!tab, action: exportHtml },
      { id: 'exportPdf', label: t('Exportar PDF...'), icon: 'printer', enabled: !!tab, action: exportPdf },
      { id: 'print', label: t('Imprimir'), key: 'Ctrl+Alt+P', icon: 'printer', enabled: !!tab, action: doPrint },
      { id: 'slides', label: t('Iniciar apresentacao (slides separados por ---)'), icon: 'columns', enabled: !!tab, action: iniciaApresentacao },
      { id: 'fullscreen', label: t('Tela inteira'), key: 'F11', icon: 'external', checked: !!app.telaInteira, action: alternaTelaInteira },
      { id: 'newWindow', label: t('Nova janela'), key: 'Ctrl+Shift+N', icon: 'columns', action: function () { novaJanela(app.folder ? [app.folder] : []); } },
      { id: 'topmost', label: t('Sempre no topo'), icon: 'pin', checked: !!app.sempreNoTopo, action: alternaSempreNoTopo },
      { id: 'copyPath', label: t('Copiar caminho do arquivo'), icon: 'copy', enabled: !!(tab && tab.path), action: function () { navigator.clipboard.writeText(activeTab().path); toast(t('Caminho copiado.'), 'ok', 1200); } },
      { id: 'reveal', label: t('Mostrar no Explorer'), icon: 'reveal', enabled: !!(tab && tab.path), action: function () { bridge.call('revealInExplorer', { path: activeTab().path }); } },
      { id: 'assoc', label: app.isDefault ? t('Remover o MarkPad como padrao de .md')
          : app.associated ? t('Definir o MarkPad como padrao de .md')
          : t('Abrir arquivos .md com o MarkPad'),
        icon: 'link', checked: app.isDefault, action: toggleAssociation },
      { id: 'switcher', label: t('Abrir arquivo pelo nome...'), key: 'Ctrl+P', icon: 'search', action: function () { openSwitcher(); } },
      { id: 'treeSearch', label: t('Filtrar arquivos por nome'), icon: 'filter', action: function () { setPane('files'); toggleTreeFilter(true); } },
      { id: 'tags', label: t('Painel: tags'), icon: 'hash', action: function () { setPane('tags'); } },
      { id: 'tagSort', label: t('Ordenar tags por...'), icon: 'sort', action: function () { setPane('tags'); var r = $('btnTagSort').getBoundingClientRect(); tagSortMenu(r.right - 250, r.bottom + 4); } },
      { id: 'treeSort', label: t('Ordenar arquivos por...'), icon: 'sort', action: function () { setPane('files'); var r = $('btnTreeSort').getBoundingClientRect(); treeSortMenu(r.right - 250, r.bottom + 4); } },
      { id: 'treeCollapse', label: t('Recolher todas as pastas'), icon: 'chevrons-up', enabled: !!app.folder, action: collapseTree },
      { id: 'quickBar', label: t('Barra de acesso rapido'), icon: 'command', checked: settings.quickBarVisible, action: function () { settings.quickBarVisible = !settings.quickBarVisible; renderQuickBar(); persist(); } },
      { id: 'settings', label: t('Configuracoes...'), key: 'Ctrl+,', icon: 'settings', action: function () { openSettings(); } },
      { id: 'devtools', label: t('Ferramentas do desenvolvedor'), icon: 'settings', action: function () { bridge.call('devTools', {}); } }
    ];
  }

  // ================================================ barra de acesso rapido

  /*
   * A barra nao tem lista propria de acoes: ela desenha comandos de
   * commands(). Assim um comando novo ja nasce disponivel aqui, e o estado
   * (habilitado/marcado) segue a aba ativa sem codigo extra.
   */
  var QUICK_DISPONIVEIS = [
    'open', 'openFolder', 'new', 'save', 'saveAs', 'close', 'reopen', 'reload',
    'lock', 'modeRead', 'modeLive', 'modeSource', 'modeSplit',
    'find', 'replace', 'findFolder', 'switcher', 'goto', 'foldAll', 'unfoldAll',
    'treeSearch', 'treeSort', 'treeCollapse', 'tags',
    'wrap', 'gutter', 'properties', 'wide', 'theme', 'sidebar',
    'export', 'exportPdf', 'print', 'copyPath', 'reveal',
    'rename', 'duplicate', 'openWith'
  ];

  function renderQuickBar() {
    var bar = $('quickBar');
    if (!bar) return;

    bar.hidden = !settings.quickBarVisible;
    if (!settings.quickBarVisible) return;

    var byId = {};
    commands().forEach(function (c) { byId[c.id] = c; });

    bar.textContent = '';
    bar.classList.toggle('has-labels', !!settings.quickBarLabels);

    (settings.quickBar || []).forEach(function (id) {
      var c = byId[id];
      if (!c) return;

      var b = document.createElement('button');
      b.className = 'quick-btn' + (c.checked ? ' is-active' : '');
      b.title = c.label + (c.key ? '   ' + c.key : '');
      b.disabled = c.enabled === false;

      var svg = window.MarkPadIcons.build(c.icon || 'command', 16);
      if (svg) b.appendChild(svg);

      if (settings.quickBarLabels) {
        var t = document.createElement('span');
        t.className = 'quick-label';
        t.textContent = c.label.replace(/\.\.\.$/, '');
        b.appendChild(t);
      }

      b.onclick = function () { if (c.enabled !== false) c.action(); };
      bar.appendChild(b);
    });

    var spacer = document.createElement('div');
    spacer.className = 'quick-spacer';
    bar.appendChild(spacer);

    var cfg = document.createElement('button');
    cfg.className = 'quick-btn';
    cfg.title = t('Configuracoes   Ctrl+,');
    var gear = window.MarkPadIcons.build('settings', 16);
    if (gear) cfg.appendChild(gear);
    cfg.onclick = function () { openSettings(); };
    bar.appendChild(cfg);

    bar.oncontextmenu = function (e) {
      e.preventDefault();
      showMenu([
        { label: t('Configurar a barra...'), icon: 'settings', action: function () { openSettings('barra'); } },
        { label: t('Mostrar rotulos'), icon: 'text', checked: settings.quickBarLabels,
          action: function () { settings.quickBarLabels = !settings.quickBarLabels; renderQuickBar(); persist(); } },
        '-',
        { label: t('Ocultar a barra'), icon: 'x',
          action: function () { settings.quickBarVisible = false; renderQuickBar(); persist(); } }
      ], e.clientX, e.clientY);
    };
  }

  // ========================================================= configuracoes

  /*
   * dialog() so sabe titulo + texto + botoes. A tela de configuracoes tem
   * desenho proprio, mas reusa o mesmo overlay e o mesmo ciclo de vida:
   * Esc fecha, clique fora fecha, nada fica pendurado no DOM depois.
   */

  function setSecao(pai, nome) {
    var h = document.createElement('h3');
    h.className = 'set-section';
    h.textContent = nome;
    pai.appendChild(h);
  }

  function setLinha(pai, titulo, descricao) {
    var row = document.createElement('div');
    row.className = 'set-row';

    var info = document.createElement('div');
    info.className = 'set-info';

    var t = document.createElement('div');
    t.className = 'set-title';
    t.textContent = titulo;
    info.appendChild(t);

    if (descricao) {
      var d = document.createElement('div');
      d.className = 'set-desc';
      d.textContent = descricao;
      info.appendChild(d);
    }

    var ctl = document.createElement('div');
    ctl.className = 'set-control';

    row.appendChild(info);
    row.appendChild(ctl);
    pai.appendChild(row);
    return ctl;
  }

  function setToggle(ctl, get, set) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'switch' + (get() ? ' is-on' : '');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', get() ? 'true' : 'false');

    var knob = document.createElement('span');
    knob.className = 'switch-knob';
    b.appendChild(knob);

    b.onclick = function () {
      set(!get());
      b.classList.toggle('is-on', !!get());
      b.setAttribute('aria-checked', get() ? 'true' : 'false');
    };

    ctl.appendChild(b);
    return b;
  }

  function setSelect(ctl, opcoes, get, set) {
    var s = document.createElement('select');
    s.className = 'set-select';
    opcoes.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      s.appendChild(op);
    });
    s.value = String(get());
    s.onchange = function () { set(s.value); };
    ctl.appendChild(s);
    return s;
  }

  function setTexto(ctl, get, set, exemplo) {
    var i = document.createElement('input');
    i.type = 'text';
    i.className = 'set-texto';
    i.spellcheck = false;
    i.value = String(get() || '');
    if (exemplo) i.placeholder = exemplo;
    i.onchange = function () { set(i.value.trim()); };
    ctl.appendChild(i);
    return i;
  }

  function setRange(ctl, min, max, step, sufixo, get, set) {
    var r = document.createElement('input');
    r.type = 'range';
    r.min = String(min); r.max = String(max); r.step = String(step);
    r.value = String(get());
    r.className = 'set-range';

    var v = document.createElement('span');
    v.className = 'set-value';
    v.textContent = get() + sufixo;

    r.oninput = function () { set(Number(r.value)); v.textContent = r.value + sufixo; };

    ctl.appendChild(r);
    ctl.appendChild(v);
    return r;
  }

  // As amostras de cor do painel de aparencia dependem do modo da janela: a
  // mesma paleta tem duas caras. Trocar o modo no proprio painel tem que
  // repintar as amostras, senao o cartao continua mostrando o tema de ontem.
  var atualizarAmostras = function () {};
  var atualizarBotoesTema = function () {};

  /**
   * A grade de paletas. Cartao em vez de <select> porque cor se escolhe
   * olhando: cada cartao pinta o proprio fundo e o proprio acento, ja no modo
   * (claro/escuro) em que a janela esta.
   */
  function montarPaletas(pai) {
    var grade = document.createElement('div');
    grade.className = 'theme-grid';
    pai.appendChild(grade);

    var aviso = document.createElement('div');
    aviso.className = 'set-desc theme-grid-note';
    pai.appendChild(aviso);

    function pintar() {
      var escuro = document.body.classList.contains('theme-dark');
      var importado = temaImportadoAtivo();
      grade.textContent = '';

      window.MarkPadThemes.PALETAS.forEach(function (p) {
        var am = window.MarkPadThemes.amostra(p.id, escuro);
        var cartao = document.createElement('button');
        cartao.type = 'button';
        cartao.className = 'theme-card' + (!importado && settings.palette === p.id ? ' is-active' : '');
        cartao.title = p.descricao;

        var tela = document.createElement('span');
        tela.className = 'theme-card-swatch';
        tela.style.background = am.fundo;
        ['--color-base-30', '--color-base-70'].forEach(function (chave) {
          var m = escuro ? p.dark : p.light;
          var ponto = document.createElement('span');
          ponto.className = 'theme-card-dot';
          ponto.style.background = (m && m[chave]) || (escuro ? '#3a3a3a' : '#dcdcdc');
          tela.appendChild(ponto);
        });
        var acento = document.createElement('span');
        acento.className = 'theme-card-dot is-accent';
        acento.style.background = am.acento;
        tela.appendChild(acento);
        cartao.appendChild(tela);

        var nome = document.createElement('span');
        nome.className = 'theme-card-name';
        nome.textContent = p.nome;
        cartao.appendChild(nome);

        cartao.onclick = function () {
          settings.palette = p.id;
          // Escolher uma paleta de casa e dizer que o tema importado saiu de
          // cena; mante-lo guardado e invisivel so confundiria a proxima vez.
          if (settings.vscodeTheme) settings.vscodeTheme = null;
          applyTheme();
          persist();
          pintar();
        };
        grade.appendChild(cartao);
      });

      var tema = settings.vscodeTheme;
      if (!tema) {
        aviso.textContent = '';
      } else if (importado) {
        aviso.textContent = t('Valendo agora: tema importado "{nome}".', { nome: tema.nome });
      } else {
        aviso.textContent = t('O tema importado "{nome}" e {modo} e esta fora do ar no modo atual.',
          { nome: tema.nome, modo: tema.escuro ? t('escuro') : t('claro') });
      }

      atualizarBotoesTema();
    }

    pintar();
    atualizarAmostras = pintar;

    // Os botoes vivem dentro do pintar() porque "Remover" so existe quando ha
    // tema importado — e isso muda no meio do painel, quando o import termina.
    // Montados uma vez so, o botao nunca aparecia sem fechar e reabrir tudo.
    var linha = setLinha(pai, t('Tema do VS Code'),
      t('Um arquivo .json de tema do VS Code vira paleta aqui. So as cores entram — o resto do arquivo e ignorado.'));

    function botoes() {
      linha.textContent = '';
      // O dialogo de arquivo e assincrono: sem esperar a promessa, o repintar
      // acontecia antes de o usuario sequer escolher o arquivo.
      setBotao(linha, t('Importar...'), function () {
        importarTemaVSCode().then(pintar);
      });
      if (settings.vscodeTheme) {
        setBotao(linha, t('Remover'), function () { removerTemaVSCode(); pintar(); }, 'danger');
      }
    }

    atualizarBotoesTema = botoes;
    botoes();
  }

  /** Cor de destaque: seis presets, um seletor livre e a volta para a paleta. */
  function montarAcento(pai) {
    var PRESETS = [
      { nome: t('Roxo'), cor: '#8a5cf6' }, { nome: t('Azul'), cor: '#2f7ff7' },
      { nome: t('Verde'), cor: '#1eab5a' }, { nome: t('Laranja'), cor: '#e07b1f' },
      { nome: t('Vermelho'), cor: '#e0455a' }, { nome: t('Rosa'), cor: '#e055a8' },
      { nome: t('Ciano'), cor: '#12a8a8' }, { nome: t('Grafite'), cor: '#6b7280' }
    ];

    var ctl = setLinha(pai, t('Cor de destaque'),
      t('Vale sobre a cor da paleta. Muda o link, o foco e o realce da selecao.'));
    var faixa = document.createElement('div');
    faixa.className = 'accent-row';
    ctl.appendChild(faixa);

    function repintar() {
      faixa.querySelectorAll('.accent-dot').forEach(function (d) {
        d.classList.toggle('is-active', (settings.accent || '').toLowerCase() === d.dataset.cor);
      });
      livre.value = settings.accent || '#8a5cf6';
      padrao.hidden = !settings.accent;
    }

    function escolher(cor) {
      settings.accent = cor || '';
      applyTheme();
      persist();
      repintar();
    }

    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'accent-dot';
      b.title = p.nome;
      b.dataset.cor = p.cor;
      b.style.background = p.cor;
      b.onclick = function () { escolher(p.cor); };
      faixa.appendChild(b);
    });

    var livre = document.createElement('input');
    livre.type = 'color';
    livre.className = 'accent-free';
    livre.title = t('Outra cor');
    livre.oninput = function () { escolher(livre.value); };
    faixa.appendChild(livre);

    var padrao = setBotao(ctl, t('Usar a da paleta'), function () { escolher(''); });
    repintar();
  }

  function setBotao(ctl, rotulo, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn tiny' + (cls ? ' ' + cls : '');
    b.textContent = rotulo;
    b.onclick = fn;
    ctl.appendChild(b);
    return b;
  }

  // Fecha o painel de configuracoes de fora — hoje so quem troca o idioma
  // precisa, para reabrir o painel ja no idioma novo.
  var fecharSettings = function () {};

  function openSettings(abaInicial) {
    if ($('settingsBox')) return;

    var ABAS = [
      { id: 'aparencia',   nome: t('Aparencia'),      icon: 'sun',       render: abaAparencia },
      { id: 'editor',      nome: t('Editor e trava'), icon: 'lock',      render: abaEditor },
      { id: 'arquivos',    nome: t('Arquivos'),       icon: 'folder',    render: abaArquivos },
      { id: 'barra',       nome: t('Barra rapida'),   icon: 'command',   render: abaBarra },
      { id: 'atalhos',     nome: t('Atalhos'),        icon: 'list',      render: abaAtalhos },
      { id: 'atualizacao', nome: t('Atualizacoes'),   icon: 'refresh',   render: abaAtualizacao },
      { id: 'sobre',       nome: t('Sobre'),          icon: 'info',      render: abaSobre }
    ];

    var atual = abaInicial || 'aparencia';
    var overlay = $('overlay');

    var box = document.createElement('div');
    box.id = 'settingsBox';
    box.className = 'settings-dialog';

    var nav = document.createElement('div');
    nav.className = 'settings-nav';

    var navTitle = document.createElement('div');
    navTitle.className = 'settings-nav-title';
    navTitle.textContent = t('Configuracoes');
    nav.appendChild(navTitle);

    var body = document.createElement('div');
    body.className = 'settings-body';

    var head = document.createElement('div');
    head.className = 'settings-head';

    var h = document.createElement('h2');
    head.appendChild(h);

    var btnFechar = document.createElement('button');
    btnFechar.className = 'icon-btn';
    btnFechar.title = t('Fechar (Esc)');
    var xi = window.MarkPadIcons.build('x', 16);
    if (xi) btnFechar.appendChild(xi);
    btnFechar.onclick = function () { fechar(); };
    head.appendChild(btnFechar);

    var scroll = document.createElement('div');
    scroll.className = 'settings-scroll';

    body.appendChild(head);
    body.appendChild(scroll);
    box.appendChild(nav);
    box.appendChild(body);

    var botoesNav = {};
    ABAS.forEach(function (aba) {
      var b = document.createElement('button');
      b.className = 'settings-nav-item';
      var ic = window.MarkPadIcons.build(aba.icon, 15);
      if (ic) b.appendChild(ic);
      var t = document.createElement('span');
      t.textContent = aba.nome;
      b.appendChild(t);
      b.onclick = function () { ir(aba.id); };
      nav.appendChild(b);
      botoesNav[aba.id] = b;
    });

    function ir(id) {
      atual = id;
      var aba = null;
      ABAS.forEach(function (a) {
        botoesNav[a.id].classList.toggle('is-active', a.id === id);
        if (a.id === id) aba = a;
      });
      if (!aba) return;
      h.textContent = aba.nome;
      scroll.textContent = '';
      scroll.scrollTop = 0;
      aba.render(scroll, ir);
    }

    function fechar() {
      overlay.hidden = true;
      overlay.onclick = null;
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      fecharSettings = function () {};
      persist();
    }
    fecharSettings = fechar;

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
    }

    document.body.appendChild(box);
    overlay.hidden = false;
    overlay.onclick = fechar;
    document.addEventListener('keydown', onKey, true);
    ir(atual);
  }

  function abaAparencia(pai) {
    setSecao(pai, t('Tema'));
    setSelect(setLinha(pai, t('Tema da janela'), t('O tema "sistema" segue a configuracao do Windows.')),
      [{ value: 'dark', label: t('Escuro') }, { value: 'light', label: t('Claro') }, { value: 'system', label: t('Sistema') }],
      function () { return settings.theme; },
      function (v) { settings.theme = v; applyTheme(); renderStatus(); atualizarAmostras(); persist(); });

    montarPaletas(pai);
    montarAcento(pai);

    setSecao(pai, t('Idioma'));
    var idiomas = [{ value: 'auto', label: t('Seguir o Windows') }].concat(
      window.MarkPadI18n.IDIOMAS.map(function (i) { return { value: i.code, label: i.nome }; }));
    setSelect(setLinha(pai, t('Idioma da interface'),
        t('O idioma do documento nao muda — so os menus, avisos e configuracoes.')),
      idiomas,
      function () { return settings.language || 'auto'; },
      function (v) {
        settings.language = v;
        persist();
        // A janela inteira fala o idioma antigo: barra de status, abas, menus,
        // a arvore e este proprio painel. Redesenhar tudo e mais barato (e mais
        // honesto) do que caçar cada texto ja escrito na tela.
        applySettings();
        renderAll();
        fecharSettings();
        openSettings('aparencia');
      });

    setSecao(pai, t('Texto'));
    setRange(setLinha(pai, t('Tamanho da fonte de leitura'), t('Vale para o modo leitura e para o painel de leitura.')),
      12, 26, 1, 'px',
      function () { return settings.fontSize; },
      function (v) { settings.fontSize = v; applyFontSizes(); renderStatus(); persist(); });

    setRange(setLinha(pai, t('Tamanho da fonte do editor'), t('Vale para o painel de codigo-fonte.')),
      10, 22, 1, 'px',
      function () { return settings.editorFontSize; },
      function (v) { settings.editorFontSize = v; applyFontSizes(); renderStatus(); persist(); });

    setToggle(setLinha(pai, t('Largura total da linha'), t('Desligado, o texto fica numa coluna estreita, mais confortavel de ler.')),
      function () { return settings.wideLines; },
      function (v) { settings.wideLines = v; applyFontSizes(); persist(); });

    setSecao(pai, t('Janela'));
    setToggle(setLinha(pai, t('Painel lateral visivel'), t('Ctrl+\\ tambem alterna.')),
      function () { return settings.sidebarVisible; },
      function (v) { toggleSidebar(v); });

    setToggle(setLinha(pai, t('Mostrar propriedades'), t('A ficha com o bloco --- do topo do documento, no modo leitura.')),
      function () { return settings.showProperties !== false; },
      function (v) { settings.showProperties = v; renderViews(); persist(); });

    setToggle(setLinha(pai, t('Mencoes ligadas'), t('No fim da leitura: quem, na pasta aberta, aponta para este documento.')),
      function () { return settings.showBacklinks !== false; },
      function (v) { settings.showBacklinks = v; renderViews(); persist(); });

    setToggle(setLinha(pai, t('Previa ao pairar o mouse'), t('Pare o mouse sobre um link interno e a nota aparece num cartao.')),
      function () { return settings.hoverPreview !== false; },
      function (v) { settings.hoverPreview = v; if (!v) fechaPrevia(); persist(); });

    setToggle(setLinha(pai, t('Animacoes'), t('Desligue para uma interface instantanea, sem transicoes.')),
      function () { return settings.animations !== false; },
      function (v) { settings.animations = v; applyAnimations(); persist(); });
  }

  function abaEditor(pai) {
    setSecao(pai, t('A trava'));
    setToggle(setLinha(pai, t('Abrir sempre travado'), t('O jeito seguro: nenhum arquivo abre em modo de edicao.')),
      function () { return settings.lockOnOpen; },
      function (v) { settings.lockOnOpen = v; persist(); });

    setToggle(setLinha(pai, t('Pedir confirmacao ao destravar'), t('Uma pergunta a mais antes de liberar a edicao.')),
      function () { return settings.confirmUnlock; },
      function (v) { settings.confirmUnlock = v; persist(); });

    setSecao(pai, t('Edicao'));
    setToggle(setLinha(pai, t('Salvar automaticamente'), t('Grava sozinho pouco depois de voce parar de digitar.')),
      function () { return settings.autoSave; },
      function (v) { settings.autoSave = v; persist(); });

    setToggle(setLinha(pai, t('Quebra automatica de linha'), t('Alt+Z tambem alterna.')),
      function () { return settings.wordWrap; },
      function (v) { settings.wordWrap = v; applyWrap(); renderEditorHighlight(); renderStatus(); persist(); });

    setToggle(setLinha(pai, t('Numeros de linha'), t('Na margem do painel de codigo-fonte.')),
      function () { return settings.lineNumbers; },
      function (v) { settings.lineNumbers = v; renderEditorHighlight(); persist(); });

    setToggle(setLinha(pai, t('Verificar ortografia'), t('Sublinha as palavras com erro enquanto se edita, com o dicionario do Windows.')),
      function () { return !!settings.corretor; },
      function (v) { settings.corretor = v; renderEditorHighlight(); persist(); });

    setToggle(setLinha(pai, t('Fechar pares automaticamente'), t('Parenteses, colchetes, chaves, aspas e crase. Com texto selecionado, digitar * _ = ~ envolve a selecao.')),
      function () { return settings.autoPar !== false; },
      function (v) { settings.autoPar = v; renderEditorHighlight(); persist(); });
  }

  function abaArquivos(pai) {
    setSecao(pai, t('Painel de arquivos'));
    setToggle(setLinha(pai, t('Mostrar so arquivos markdown'), t('Desligado, a arvore lista todos os arquivos da pasta.')),
      function () { return settings.treeOnlyMarkdown; },
      function (v) { settings.treeOnlyMarkdown = v; renderTreeFilter(); refreshTree(); persist(); });

    setSelect(setLinha(pai, t('Ordenar por'), t('Vale para a arvore inteira. Tambem esta no botao de ordenar do painel.')),
      ORDENS.map(function (o) { return { value: o.id, label: o.rotulo }; }),
      function () { return settings.treeSort || 'nome-asc'; },
      function (v) { settings.treeSort = v; refreshTree(); persist(); });

    setToggle(setLinha(pai, t('Pastas antes dos arquivos'), t('Desligado, pastas e arquivos entram na mesma ordenacao.')),
      function () { return settings.treeFoldersFirst !== false; },
      function (v) { settings.treeFoldersFirst = v; refreshTree(); persist(); });

    setSecao(pai, t('Ao abrir'));
    setToggle(setLinha(pai, t('Avisar ao abrir arquivo nao-markdown'), t('A confirmacao antes de abrir algo que nao parece markdown.')),
      function () { return settings.warnNonMarkdown; },
      function (v) { settings.warnNonMarkdown = v; persist(); });

    setToggle(setLinha(pai, t('Restaurar a sessao anterior'), t('Reabre as abas e a pasta que estavam abertas.')),
      function () { return settings.restoreSession; },
      function (v) { settings.restoreSession = v; persist(); });

    setToggle(setLinha(pai, t('Fechar sem perguntar, guardando o que não foi salvo'),
      t('Como o snapshot do Notepad++: sair não pergunta, o texto não salvo vira rascunho e volta sozinho na próxima abertura. O arquivo só muda quando você salvar.')),
      function () { return !!settings.fecharGuardando; },
      function (v) { settings.fecharGuardando = v; persist(); });

    setToggle(setLinha(pai, t('Carregar imagens da internet'), t('Desligado, so imagens do proprio disco aparecem. Mais privado.')),
      function () { return settings.loadRemoteImages; },
      function (v) { settings.loadRemoteImages = v; renderViews(); persist(); });

    setSecao(pai, t('Notas novas'));
    setTexto(setLinha(pai, t('Pasta da nota diaria'), t('Dentro da pasta aberta; vazio e a propria pasta.')),
      function () { return settings.notaDiariaPasta || ''; },
      function (v) { settings.notaDiariaPasta = v; persist(); }, 'Diario');
    setTexto(setLinha(pai, t('Nome da nota diaria'), t('YYYY ano, MM mes, DD dia, dddd dia da semana; texto entre colchetes fica como esta.')),
      function () { return settings.notaDiariaFormato || 'YYYY-MM-DD'; },
      function (v) { settings.notaDiariaFormato = v || 'YYYY-MM-DD'; persist(); }, 'YYYY-MM-DD');
    setTexto(setLinha(pai, t('Modelo da nota diaria'), t('Arquivo dentro da pasta aberta, por exemplo Modelos/Diaria.md. Vazio, a nota nasce em branco.')),
      function () { return settings.notaDiariaModelo || ''; },
      function (v) { settings.notaDiariaModelo = v; persist(); }, 'Modelos/Diaria.md');
    setTexto(setLinha(pai, t('Pasta dos modelos'), t('De onde o "Inserir modelo" lista os arquivos. Aceita {{title}}, {{date}} e {{time}}.')),
      function () { return settings.modelosPasta || 'Modelos'; },
      function (v) { settings.modelosPasta = v || 'Modelos'; persist(); }, 'Modelos');
    setTexto(setLinha(pai, t('Pasta da nota unica'), t('Onde nasce a nota com nome de data e hora (YYYYMMDDHHmm).')),
      function () { return settings.notaUnicaPasta || ''; },
      function (v) { settings.notaUnicaPasta = v; persist(); }, '');

    setSecao(pai, t('Windows'));
    var assoc = setLinha(pai, t('Arquivos .md'),
      app.isDefault ? t('O MarkPad e o aplicativo padrao para .md.')
        : app.associated ? t('O MarkPad aparece em "Abrir com". Ainda nao e o padrao.')
        : t('O MarkPad ainda nao esta registrado para .md.'));
    setBotao(assoc, app.isDefault ? t('Remover') : app.associated ? t('Tornar padrao') : 'Registrar',
      function () { toggleAssociation(); });

    var dados = setLinha(pai, t('Pasta de dados'),
      (app.portable ? t('Modo portatil. ') : '') + (app.dataRoot || ''));
    setBotao(dados, t('Abrir'), function () {
      if (app.dataRoot) bridge.call('revealInExplorer', { path: app.dataRoot });
    });
  }

  function abaBarra(pai, ir) {
    setSecao(pai, t('A barra'));
    setToggle(setLinha(pai, t('Mostrar a barra de acesso rapido'), t('A fileira de botoes abaixo das abas.')),
      function () { return settings.quickBarVisible; },
      function (v) { settings.quickBarVisible = v; renderQuickBar(); persist(); });

    setToggle(setLinha(pai, t('Mostrar os rotulos'), t('Com o nome ao lado do icone, a barra fica mais larga.')),
      function () { return settings.quickBarLabels; },
      function (v) { settings.quickBarLabels = v; renderQuickBar(); persist(); });

    setSecao(pai, t('Botoes'));

    var byId = {};
    commands().forEach(function (c) { byId[c.id] = c; });

    var lista = document.createElement('div');
    lista.className = 'quick-editor';
    pai.appendChild(lista);

    function redesenhar() {
      renderQuickBar();
      persist();
      ir('barra');
    }

    (settings.quickBar || []).forEach(function (id, i) {
      var c = byId[id];
      if (!c) return;

      var item = document.createElement('div');
      item.className = 'quick-editor-item';

      var ic = window.MarkPadIcons.build(c.icon || 'command', 15);
      if (ic) item.appendChild(ic);

      var nome = document.createElement('span');
      nome.className = 'quick-editor-name';
      nome.textContent = c.label.replace(/\.\.\.$/, '');
      item.appendChild(nome);

      if (c.key) {
        var k = document.createElement('span');
        k.className = 'quick-editor-key';
        k.textContent = c.key;
        item.appendChild(k);
      }

      function acao(icone, titulo, fn, desativado) {
        var b = document.createElement('button');
        b.className = 'icon-btn small';
        b.title = titulo;
        b.disabled = !!desativado;
        var s = window.MarkPadIcons.build(icone, 14);
        if (s) b.appendChild(s);
        b.onclick = fn;
        item.appendChild(b);
      }

      acao('chevron-up', 'Subir', function () {
        var arr = settings.quickBar;
        var tmp = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = tmp;
        redesenhar();
      }, i === 0);

      acao('chevron-down', 'Descer', function () {
        var arr = settings.quickBar;
        var tmp = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = tmp;
        redesenhar();
      }, i === settings.quickBar.length - 1);

      acao('x', t('Tirar da barra'), function () {
        settings.quickBar.splice(i, 1);
        redesenhar();
      });

      lista.appendChild(item);
    });

    if (!settings.quickBar || !settings.quickBar.length) {
      var vazio = document.createElement('p');
      vazio.className = 'set-desc';
      vazio.textContent = t('A barra esta vazia. Escolha um comando abaixo para comecar.');
      lista.appendChild(vazio);
    }

    var faltando = QUICK_DISPONIVEIS.filter(function (id) {
      return byId[id] && (settings.quickBar || []).indexOf(id) < 0;
    });

    var addCtl = setLinha(pai, t('Adicionar um botao'), faltando.length ? '' : 'Todos os comandos ja estao na barra.');
    if (faltando.length) {
      var sel = document.createElement('select');
      sel.className = 'set-select';
      var vazioOpt = document.createElement('option');
      vazioOpt.value = '';
      vazioOpt.textContent = t('escolha um comando');
      sel.appendChild(vazioOpt);
      faltando.forEach(function (id) {
        var o = document.createElement('option');
        o.value = id;
        o.textContent = byId[id].label.replace(/\.\.\.$/, '');
        sel.appendChild(o);
      });
      sel.onchange = function () {
        if (!sel.value) return;
        settings.quickBar.push(sel.value);
        redesenhar();
      };
      addCtl.appendChild(sel);
    }

    var padraoCtl = setLinha(pai, t('Restaurar o padrao'), t('Volta a barra para os sete botoes originais.'));
    setBotao(padraoCtl, t('Restaurar'), function () {
      settings.quickBar = DEFAULTS.quickBar.slice();
      settings.quickBarLabels = DEFAULTS.quickBarLabels;
      settings.quickBarVisible = DEFAULTS.quickBarVisible;
      redesenhar();
    });
  }

  function abaAtalhos(pai) {
    var busca = document.createElement('input');
    busca.type = 'text';
    busca.className = 'text-input settings-filter';
    busca.placeholder = t('Filtrar comandos');
    busca.spellcheck = false;
    pai.appendChild(busca);

    var lista = document.createElement('div');
    lista.className = 'hotkey-list';
    pai.appendChild(lista);

    var todos = commands();

    function desenhar() {
      var q = busca.value.trim().toLowerCase();
      lista.textContent = '';

      var n = 0;
      todos.forEach(function (c) {
        if (q && c.label.toLowerCase().indexOf(q) < 0 && (!c.key || c.key.toLowerCase().indexOf(q) < 0)) return;
        n++;

        var row = document.createElement('div');
        row.className = 'hotkey-row';

        var ic = window.MarkPadIcons.build(c.icon || 'command', 15);
        if (ic) row.appendChild(ic);

        var nome = document.createElement('span');
        nome.className = 'hotkey-name';
        nome.textContent = c.label;
        row.appendChild(nome);

        var key = document.createElement('span');
        key.className = 'hotkey-key' + (c.key ? '' : ' is-empty');
        key.textContent = c.key || t('sem atalho');
        row.appendChild(key);

        lista.appendChild(row);
      });

      if (!n) {
        var vazio = document.createElement('p');
        vazio.className = 'set-desc';
        vazio.textContent = t('Nenhum comando com esse nome.');
        lista.appendChild(vazio);
      }
    }

    busca.oninput = desenhar;
    desenhar();
    setTimeout(function () { busca.focus(); }, 0);
  }

  function abaAtualizacao(pai) {
    function redesenha() { pai.textContent = ''; abaAtualizacao(pai); }

    setSecao(pai, t('Versao'));
    var v = setLinha(pai, t('Versao instalada'),
      'MarkPad ' + (app.version || '?') + (app.portable ? ' (portatil)' : ''));
    setBotao(v, t('Ver as versoes'), abrePaginaReleases);

    setSecao(pai, t('Atualizacao automatica'));
    setToggle(setLinha(pai, t('Procurar atualizacoes ao abrir'),
      t('Consulta as versoes publicadas no GitHub uma vez por dia, quando o MarkPad inicia. ')
      + t('Nada e baixado sem voce mandar.')),
      function () { return settings.checkUpdates !== false; },
      function (val) { settings.checkUpdates = val; persist(); });

    var linha = setLinha(pai, t('Procurar agora'), descreveEstadoAtualizacao());
    var botao = setBotao(linha, t('Procurar'), function () {
      botao.disabled = true;
      botao.textContent = t('Procurando...');
      verificaAtualizacao(true).then(function (r) {
        if (r && r.ok && !r.available) toast(t('O MarkPad ja esta na versao mais nova.'), 'ok');
        else if (!r || !r.ok) toast(t('Nao deu para consultar as versoes agora.'), 'warn');
        redesenha();
      });
    });

    if (atualizacao.pendente) {
      setSecao(pai, t('Download pronto'));
      var d = setLinha(pai, 'MarkPad ' + atualizacao.pendente.version,
        t('Ja baixado e conferido. Entra sozinho na proxima vez que o MarkPad abrir, ')
        + t('ou agora, se voce mandar.'));
      setBotao(d, t('Instalar agora'), aplicaAtualizacao, 'primary');
      setBotao(d, t('Descartar'), function () { descartaAtualizacao().then(redesenha); }, 'danger');
    }
  }

  /** Estado da aba de atualizacoes, em uma frase. */
  function descreveEstadoAtualizacao() {
    if (atualizacao.estado === 'baixando') return t('Baixando agora...');
    if (atualizacao.pendente) {
      return t('MarkPad {versao} ja esta baixada.', { versao: atualizacao.pendente.version });
    }
    if (atualizacao.info) {
      return t('MarkPad {versao} esta disponivel.', { versao: atualizacao.info.latest });
    }
    if (!settings.lastUpdateCheck) return t('Ainda nao foi consultado nesta instalacao.');
    return t('Ultima consulta: ') + new Date(Number(settings.lastUpdateCheck)).toLocaleString();
  }

  function abaSobre(pai) {
    setSecao(pai, 'MarkPad');

    var p = document.createElement('p');
    p.className = 'set-desc';
    p.textContent = t('Leitor e editor de Markdown para Windows. Sem cofre, sem projeto, sem cerimonia: ')
      + t('abre um arquivo e pronto. Todo arquivo abre travado — no estado travado nao existe campo de ')
      + t('texto na tela, entao nao ha tecla que edite, apague ou digite nada.');
    pai.appendChild(p);

    setLinha(pai, t('Versao'), 'MarkPad ' + (app.version || '?'));
    setLinha(pai, t('Instalacao'), app.portable ? 'Portatil' : 'Instalado');
    setLinha(pai, t('Licenca'), 'MIT');

    setSecao(pai, t('Links'));
    var repo = setLinha(pai, t('Codigo-fonte'), 'github.com/NBN-PATRIC/markpad');
    setBotao(repo, t('Abrir'), function () {
      bridge.call('openExternal', { url: 'https://github.com/NBN-PATRIC/markpad' });
    });

    var bug = setLinha(pai, t('Relatar um problema'), t('Abre a pagina de issues do repositorio.'));
    setBotao(bug, t('Abrir'), function () {
      bridge.call('openExternal', { url: 'https://github.com/NBN-PATRIC/markpad/issues' });
    });

    setSecao(pai, t('Diagnostico'));
    var dev = setLinha(pai, t('Ferramentas do desenvolvedor'), t('Console do WebView2, para investigar um erro.'));
    setBotao(dev, t('Abrir'), function () { bridge.call('devTools', {}); });
  }

  function applyAnimations() {
    document.body.classList.toggle('no-anim', settings.animations === false);
  }

  /** Ctrl+Shift+C: entra e sai do codigo-fonte, venha de onde vier. */
  function toggleSource() {
    var tab = activeTab();
    if (!tab) return;
    setModo(modoDe(tab) === 'fonte' ? 'vivo' : 'fonte', tab);
  }

  /** O leitor ao lado e um extra do modo fonte, nao um quarto modo. */
  function togglePreviewPane() {
    var tab = activeTab();
    if (!tab || tab.locked || !tab.showSource) return;
    tab.showPreview = !tab.showPreview;
    settings.sideReader = tab.showPreview;
    renderHeader();
    renderViews();
    persist();
  }

  function cycleTheme() {
    settings.theme = settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark';
    applyTheme();
    renderStatus();
    persist();
  }

  /*
   * Paleta de comandos com fixados e recentes, como a do Obsidian: sem
   * consulta, os fixados vem primeiro (com o alfinete) e depois os usados por
   * ultimo; com consulta, busca aproximada (sem acento) com um empurrao para
   * fixados e recentes. O alfinete de cada linha (ou o clique direito) fixa e
   * desafixa.
   */
  var MAX_RECENTES_PALETA = 8;

  function registraComandoRecente(id) {
    if (!id) return;
    settings.paletaRecentes = [id].concat((settings.paletaRecentes || []).filter(function (x) { return x !== id; }))
      .slice(0, 20);
    persist();
  }

  function alternaFixado(id) {
    var fix = settings.paletaFixados || [];
    settings.paletaFixados = fix.indexOf(id) === -1 ? fix.concat([id]) : fix.filter(function (x) { return x !== id; });
    persist();
  }

  function openPalette() {
    var list = commands().filter(function (c) { return c.enabled === undefined || c.enabled; });
    var porId = {};
    list.forEach(function (c) { porId[c.id] = c; });
    var filtered = [];
    var active = 0;
    var consulta = '';

    var box = $('palette');
    var input = $('paletteInput');
    var listEl = $('paletteList');

    function fixados() { return (settings.paletaFixados || []).filter(function (id) { return porId[id]; }); }

    function monta() {
      var fix = fixados();
      var rec = (settings.paletaRecentes || []).filter(function (id) { return porId[id] && fix.indexOf(id) === -1; });
      if (!consulta) {
        var primeiros = fix.concat(rec.slice(0, MAX_RECENTES_PALETA));
        filtered = primeiros.map(function (id) { return porId[id]; })
          .concat(list.filter(function (c) { return primeiros.indexOf(c.id) === -1; }));
        return;
      }
      filtered = list.map(function (c) {
        var nota = fuzzyScore(consulta, c.label);
        if (nota === -Infinity) return null;
        if (fix.indexOf(c.id) !== -1) nota += 6;
        var r = rec.indexOf(c.id);
        if (r !== -1) nota += Math.max(1, 5 - r);
        return { c: c, nota: nota };
      }).filter(Boolean).sort(function (a, b) { return b.nota - a.nota; }).map(function (x) { return x.c; });
    }

    function executa(c) {
      close();
      registraComandoRecente(c.id);
      c.action();
    }

    function draw() {
      listEl.textContent = '';
      var fix = fixados();
      if (!filtered.length) {
        var vazio = document.createElement('div');
        vazio.className = 'palette-item is-empty';
        vazio.textContent = t('Nenhum comando com esse nome.');
        listEl.appendChild(vazio);
        return;
      }
      filtered.forEach(function (c, i) {
        var el = document.createElement('div');
        el.className = 'palette-item' + (i === active ? ' is-active' : '');
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', i === active ? 'true' : 'false');

        var ic = document.createElement('span');
        ic.className = 'pal-icon';
        var svg = window.MarkPadIcons.build(c.icon || 'command', 15);
        if (svg) ic.appendChild(svg);
        el.appendChild(ic);

        var label = document.createElement('span');
        label.className = 'pal-label';
        label.appendChild(marcaFuzzy(c.label, consulta));
        el.appendChild(label);

        if (c.checked) {
          var ck = document.createElement('span');
          ck.className = 'pal-sub';
          ck.textContent = t('ativo');
          el.appendChild(ck);
        }
        if (c.key) {
          var k = document.createElement('span');
          k.className = 'pal-key';
          k.textContent = c.key;
          el.appendChild(k);
        }

        var fixo = fix.indexOf(c.id) !== -1;
        var pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pal-pin' + (fixo ? ' is-fixo' : '');
        pin.title = fixo ? t('Desafixar da paleta') : t('Fixar no topo da paleta');
        var svgPin = window.MarkPadIcons.build('pin', 13);
        if (svgPin) pin.appendChild(svgPin);
        pin.onclick = function (e) {
          e.stopPropagation();
          alternaFixado(c.id);
          monta();
          draw();
          input.focus();
        };
        el.appendChild(pin);

        el.onclick = function () { executa(c); };
        el.oncontextmenu = function (e) {
          e.preventDefault();
          alternaFixado(c.id);
          monta();
          draw();
          input.focus();
        };
        el.onmousemove = function () { if (active !== i) { active = i; draw(); } };
        listEl.appendChild(el);
      });

      var cur = listEl.children[active];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function close() {
      box.hidden = true;
      $('overlay').hidden = true;
      document.removeEventListener('keydown', onKey, true);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); draw(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        var c = filtered[active];
        if (c) executa(c); else close();
      }
    }

    input.value = '';
    input.oninput = function () {
      consulta = input.value.trim();
      active = 0;
      monta();
      draw();
    };

    monta();
    box.hidden = false;
    $('overlay').hidden = false;
    $('overlay').onclick = close;
    document.addEventListener('keydown', onKey, true);
    draw();
    input.focus();
  }

  function moreMenu(x, y) {
    var list = commands();
    var byId = {};
    list.forEach(function (c) { byId[c.id] = c; });

    function entry(id) {
      var c = byId[id];
      return { label: c.label, icon: c.icon, key: c.key, checked: c.checked, action: c.action, disabled: c.enabled === false };
    }

    // A ordem espelha a do Obsidian: o que se faz COM o documento primeiro,
    // preferencia depois. Quem abre este menu quase sempre quer a primeira parte.
    showMenu([
      entry('save'), entry('saveAs'), entry('reload'), entry('monitor'), '-',
      { label: t('Documento'), header: true },
      entry('rename'), entry('move'), entry('duplicate'), '-',
      entry('export'), entry('exportPdf'), entry('print'), '-',
      entry('openWith'), entry('reveal'), entry('copyPath'), '-',
      entry('delete'), '-',
      { label: t('Navegar'), header: true },
      entry('find'), entry('findFolder'), entry('goto'),
      entry('foldAll'), entry('unfoldAll'), '-',
      { label: t('Visual'), header: true },
      entry('wrap'), entry('gutter'), entry('properties'), entry('wide'), entry('theme'), '-',
      { label: t('Janela'), header: true },
      entry('newWindow'), entry('fullscreen'), entry('topmost'), '-',
      { label: t('Trava'), header: true },
      entry('lockOnOpen'), entry('confirmUnlock'), entry('autoSave'), '-',
      { label: t('Arquivos'), header: true },
      entry('treeFilter'), entry('warnNonMd'), '-',
      entry('remote'), entry('assoc'), '-',
      entry('quickBar'), entry('settings')
    ], x, y);
  }

  /* O mesmo cardapio para qualquer arquivo do painel, arvore ou lista rasa. */
  function fileContextMenu(path) {
    return [
      { label: t('Abrir'), icon: 'file-text', action: function () { openPath(path); } },
      '-',
      { label: t('Renomear...'), icon: 'text', action: function () { renameDoc(path); } },
      { label: t('Mover para...'), icon: 'folder', action: function () { moveDoc(path); } },
      { label: t('Duplicar'), icon: 'copy', action: function () { duplicateDoc(path); } },
      { label: t('Historico de versoes...'), icon: 'clock', action: function () { abreVersoes(path); } },
      { label: marcadorDoArquivo(path) ? t('Desmarcar') : t('Marcar'), icon: 'bookmark', action: function () { alternaMarcadorArquivo(path); } },
      '-',
      { label: t('Abrir à direita'), icon: 'columns', action: function () { abreNoOutroGrupo(path); } },
      { label: t('Abrir em nova janela'), icon: 'columns', action: function () { novaJanela([path]); } },
      { label: t('Abrir no app padrao'), icon: 'external', action: function () { openWithDefaultApp(path); } },
      { label: t('Mostrar no Explorer'), icon: 'reveal', action: function () { bridge.call('revealInExplorer', { path: path }); } },
      { label: t('Copiar caminho'), icon: 'copy', action: function () { navigator.clipboard.writeText(path); toast(t('Caminho copiado.'), 'ok', 1200); } },
      '-',
      { label: t('Excluir arquivo...'), icon: 'trash', action: function () { deleteDoc(path); } }
    ];
  }

  function menuDaPasta(path) {
    return [
      { label: t('Marcar pasta'), icon: 'bookmark', action: function () { marcaPasta(path); } },
      { label: t('Abrir como pasta principal'), icon: 'folder-open', action: function () { setFolder(path); } },
      '-',
      { label: t('Mostrar no Explorer'), icon: 'reveal', action: function () { bridge.call('revealInExplorer', { path: path }); } },
      { label: t('Copiar caminho'), icon: 'copy', action: function () { navigator.clipboard.writeText(path); toast(t('Caminho copiado.'), 'ok', 1200); } }
    ];
  }

  function tabContextMenu(tab) {
    return [
      { label: t('Salvar'), icon: 'save', disabled: tab.locked, action: function () { saveTab(tab); } },
      { label: tab.fixada ? t('Desafixar aba') : t('Fixar aba'), icon: 'pin', action: function () { alternaFixacao(tab); } },
      '-',
      { label: t('Fechar'), icon: 'x', action: function () { closeTab(tab.id); } },
      // As tres abaixo passam por cima das fixadas, como no Obsidian.
      { label: t('Fechar as outras'), action: function () {
          fechaAbas(app.tabs.filter(function (o) { return o !== tab && !o.fixada; }));
        } },
      { label: t('Fechar à esquerda'), disabled: app.tabs.indexOf(tab) === 0, action: function () {
          fechaAbas(app.tabs.slice(0, app.tabs.indexOf(tab)).filter(function (o) { return !o.fixada; }));
        } },
      { label: t('Fechar à direita'), disabled: app.tabs.indexOf(tab) === app.tabs.length - 1, action: function () {
          fechaAbas(app.tabs.slice(app.tabs.indexOf(tab) + 1).filter(function (o) { return !o.fixada; }));
        } },
      { label: t('Fechar as não modificadas'), action: function () {
          fechaAbas(app.tabs.filter(function (o) { return !o.fixada && o.content === o.savedContent; }));
        } },
      { label: t('Fechar todas, exceto as fixadas'), action: function () {
          fechaAbas(app.tabs.filter(function (o) { return !o.fixada; }));
        } },
      '-',
      { cores: [0, 1, 2, 3, 4, 5].map(function (n) { return { valor: n, label: nomeDaCor(n), atual: (tab.cor || 0) === n }; }),
        label: t('Cor da aba'), escolhe: function (n) { pintaAba(tab, n); } },
      '-',
      { label: t('Renomear...'), icon: 'text', key: 'F2', disabled: !tab.path, action: function () { renameDoc(tab.path); } },
      { label: t('Mover para...'), icon: 'folder', disabled: !tab.path, action: function () { moveDoc(tab.path); } },
      { label: t('Duplicar'), icon: 'copy', disabled: !tab.path, action: function () { duplicateDoc(tab.path); } },
      { label: t('Historico de versoes...'), icon: 'clock', disabled: !tab.path, action: function () { abreVersoes(tab.path); } },
      { label: tab.path && marcadorDoArquivo(tab.path) ? t('Desmarcar') : t('Marcar'), icon: 'bookmark', disabled: !tab.path, action: function () { alternaMarcadorArquivo(tab.path); } },
      { label: t('Revelar na árvore'), icon: 'folder-open', disabled: !tab.path || !app.folder, action: function () { revelaNaArvore(tab.path); } },
      { label: t('Monitorar (tail -f)'), icon: 'eye', checked: !!tab.monitorar, disabled: !tab.path, action: function () { alternaMonitorar(tab); } },
      '-',
      { label: t('Dividir à direita'), icon: 'columns', action: function () { dividir('h', tab); } },
      { label: t('Dividir abaixo'), icon: 'columns', action: function () { dividir('v', tab); } },
      { label: t('Mover para a outra metade'), icon: 'columns', disabled: !dividido(), action: function () { mudaDeGrupo(tab, outroGrupoDe(grupoDe(tab))); persist(); } },
      { label: t('Empilhar abas'), icon: 'columns', checked: !!(grupoPorId(grupoDe(tab)) || {}).empilhado, action: function () { alternaEmpilhar(grupoDe(tab)); } },
      '-',
      { label: t('Abrir em nova janela'), icon: 'columns', disabled: !tab.path, action: function () { novaJanela([tab.path]); } },
      // Mover leva o arquivo do disco: com alteracao pendente, a outra janela
      // abriria sem ela. Salva primeiro (ou fica aqui).
      { label: t('Mover para nova janela'), disabled: !tab.path || tab.content !== tab.savedContent, action: function () {
          novaJanela([tab.path]).then(function (ok) { if (ok) closeTab(tab.id); });
        } },
      { label: t('Abrir no app padrao'), icon: 'external', disabled: !tab.path, action: function () { openWithDefaultApp(tab.path); } },
      { label: t('Mostrar no Explorer'), icon: 'reveal', disabled: !tab.path, action: function () { bridge.call('revealInExplorer', { path: tab.path }); } },
      { label: t('Copiar caminho'), icon: 'copy', disabled: !tab.path, action: function () { navigator.clipboard.writeText(tab.path); toast(t('Caminho copiado.'), 'ok', 1200); } },
      { label: t('Copiar nome'), disabled: !tab.path, action: function () { navigator.clipboard.writeText(tab.name); toast(t('Nome copiado.'), 'ok', 1200); } },
      { label: t('Copiar pasta'), disabled: !tab.path, action: function () { navigator.clipboard.writeText(tab.path.replace(/[\\/][^\\/]*$/, '')); toast(t('Pasta copiada.'), 'ok', 1200); } },
      '-',
      { label: t('Excluir arquivo...'), icon: 'trash', disabled: !tab.path, action: function () { deleteDoc(tab.path); } }
    ];
  }

  // ================================================= operacoes de documento

  function baseName(path) {
    return String(path || '').split(/[\\/]/).pop();
  }

  function dropRecent(path) {
    if (!path) return;
    var lower = path.toLowerCase();
    settings.recent = (settings.recent || []).filter(function (p) { return p.toLowerCase() !== lower; });
    renderRecent();
  }

  /*
   * Renomeou ou moveu: o voltar/avancar de todas as abas (e das fechadas, que
   * o Ctrl+Shift+T traz de volta) segue o arquivo. Sem isso, "avancar" levava
   * ao nome velho, que nao existe mais.
   */
  function historicoSegue(antigo, info) {
    marcadoresSeguem(antigo, info.path);
    app.tabs.concat(app.fechadas || []).forEach(function (a) {
      var h = a.historico;
      if (!h) return;
      h.voltar.concat(h.avancar).forEach(function (f) {
        if (mesmoArquivo(f.path, antigo)) { f.path = info.path; f.name = info.name; }
      });
      if (!a.id && mesmoArquivo(a.path, antigo)) { a.path = info.path; a.name = info.name; }
    });
    renderNavegacao();
  }

  /* Depois de renomear ou mover, a aba, a arvore e os recentes seguem o arquivo. */
  function adotarCaminho(tab, info, antigo) {
    if (antigo) bridge.call('unwatchFile', { path: antigo }).catch(function () {});

    tab.path = info.path;
    tab.name = info.name;
    tab.dir = info.dir;
    tab.mtime = info.mtime;
    tab.staleOnDisk = false;

    bridge.call('watchFile', { path: info.path }).catch(function () {});
    dropRecent(antigo);
    addRecent(info.path);
    arvoreMudou();
    renderAll();
    persist();
  }

  function falhaDoc(verbo) {
    return function (err) {
      if (err) toast(t('Nao consegui ') + verbo + ': ' + err.message, 'error', 6000);
    };
  }

  /*
   * Depois de renomear ou mover: os links das outras notas que apontavam
   * para o arquivo — e os links relativos da propria nota, quando ela mudou
   * de pasta — passam a apontar para o lugar novo, como no Obsidian. `idx` e
   * o indice de ANTES da troca: e ele que sabe para onde cada link apontava.
   *
   * Pergunta antes, com a conta na mao: e gravar em arquivo que o usuario
   * nao abriu. Aba com alteracao nao salva recebe a troca so na memoria (o
   * disco dela fica para quando ela salvar); o resto vai para o disco com a
   * mesma codificacao e a mesma quebra de linha.
   */
  function atualizaLinksDepoisDeMover(idx, antigo, novo) {
    var LI = window.MarkPadLinkIndex;
    var arq = idx && LI ? LI.arquivoDe(idx, antigo) : null;
    if (!arq) return Promise.resolve();

    var relNovo = relNaPasta(novo);
    var foraDaPasta = /^[a-zA-Z]:\//.test(relNovo);
    var mudouDePasta = arq.rel.replace(/[^\/]*$/, '').toLowerCase() !== relNovo.replace(/[^\/]*$/, '').toLowerCase();

    var origens = [];
    (idx.entradas[arq.rel.toLowerCase()] || []).forEach(function (e) {
      if (origens.indexOf(e.de) < 0) origens.push(e.de);
    });
    if (foraDaPasta) {
      if (origens.length) toast(t('O arquivo saiu da pasta aberta; os links para ele nao foram atualizados.'), 'warn', 5000);
      return Promise.resolve();
    }
    // A propria nota: links relativos dela quebram quando ela troca de pasta.
    if (arq.md && mudouDePasta && origens.indexOf(arq) < 0) origens.push(arq);
    if (!origens.length) return Promise.resolve();

    // Le cada origem (a aba suja vale mais que o disco) e calcula a troca.
    return Promise.all(origens.map(function (o) {
      var caminho = o === arq ? novo : o.path;
      var opts = o === arq
        ? { origem: arq.rel, origemNova: relNovo, de: arq.rel, para: relNovo }
        : { origem: o.rel, de: arq.rel, para: relNovo };
      var tab = tabByPath(caminho);
      var suja = !!(tab && tab.content !== tab.savedContent);
      var leitura = suja
        ? Promise.resolve({ content: tab.content })
        : bridge.call('readFile', { path: caminho });
      return leitura.then(function (data) {
        var r = LI.reescreve(idx, data.content, opts);
        return r.trocas ? { caminho: caminho, rel: o === arq ? relNovo : o.rel, data: data, tab: tab, suja: suja, texto: r.texto, trocas: r.trocas } : null;
      }).catch(function () { return null; });
    })).then(function (planos) {
      planos = planos.filter(Boolean);
      if (!planos.length) return null;
      var total = planos.reduce(function (n, p) { return n + p.trocas; }, 0);
      var lista = planos.slice(0, 8).map(function (p) { return '<li>' + escapeText(p.rel) + '</li>'; }).join('') +
        (planos.length > 8 ? '<li>…</li>' : '');

      var partes = {
        n: total === 1 ? t('1 link') : t('{n} links', { n: total }),
        a: planos.length === 1 ? t('1 arquivo') : t('{n} arquivos', { n: planos.length }),
        nome: escapeText(baseName(antigo))
      };
      return dialog(t('Atualizar os links?'),
        (total === 1
          ? t('{n} em {a} aponta para <strong>{nome}</strong>. Atualizar para o caminho novo?', partes)
          : t('{n} em {a} apontam para <strong>{nome}</strong>. Atualizar para o caminho novo?', partes)) +
        '<ul class="dialog-lista">' + lista + '</ul>',
        [{ label: t('Agora nao'), value: false },
         { label: t('Atualizar'), value: true, cls: 'primary' }]
      ).then(function (sim) {
        if (!sim) return null;
        return aplicaPlanos(planos, total);
      });
    });
  }

  function aplicaPlanos(planos, total) {
    var falhas = [];
    return Promise.all(planos.map(function (p) {
      if (p.suja) {
        p.tab.content = p.texto;
        invalidateLineStatus(p.tab);
        return null;
      }
      return bridge.call('writeFile', {
        path: p.caminho, content: p.texto, encoding: p.data.encoding, eol: p.data.eol
      }).then(function (res) {
        if (!p.tab) return;
        p.tab.content = p.texto;
        p.tab.savedContent = p.texto;
        p.tab.mtime = res.mtime;
        invalidateLineStatus(p.tab);
      }).catch(function (err) { falhas.push(p.rel + ': ' + err.message); });
    })).then(function () {
      invalidaLinks();
      renderAll();
      if (falhas.length) {
        toast(t('Nao consegui atualizar: ') + falhas.join('; '), 'error', 8000);
      } else {
        toast(total === 1 ? t('1 link atualizado.') : t('{n} links atualizados.', { n: total }), 'ok', 2600);
      }
    });
  }

  function renameDoc(path) {
    if (!path) return Promise.resolve();

    var nome = baseName(path);
    var ponto = nome.lastIndexOf('.');

    return promptDialog(t('Renomear arquivo'), t('Ele continua na mesma pasta.'), {
      value: nome,
      okLabel: t('Renomear'),
      selectTo: ponto > 0 ? ponto : nome.length,
      validate: function (nomeNovo) {
        if (!nomeNovo) return t('Digite um nome.');
        if (/[\\/]/.test(nomeNovo)) return t('Sem barras — para trocar de pasta, use "Mover para...".');
        if (/[<>:"|?*]/.test(nomeNovo)) return t('O Windows nao aceita estes: < > : " | ? *');
        return null;
      }
    }).then(function (novo) {
      if (!novo || novo === nome) return null;
      // O indice de ANTES da troca: e ele que sabe quem apontava para o nome velho.
      return indiceLinks().then(function (idx) {
        return bridge.call('renameFile', { path: path, name: novo }).then(function (info) {
          var tab = tabByPath(path);
          if (tab) adotarCaminho(tab, info, path);
          else { dropRecent(path); arvoreMudou(); }
          historicoSegue(path, info);
          toast(t('Agora se chama ') + info.name, 'ok');
          return atualizaLinksDepoisDeMover(idx, path, info.path);
        });
      });
    }).catch(falhaDoc('renomear'));
  }

  function moveDoc(path) {
    if (!path) return Promise.resolve();

    return bridge.call('openFolderDialog', {}).then(function (dir) {
      if (!dir) return null;
      return moveDocPara(path, dir);
    }).catch(falhaDoc('mover'));
  }

  /** Move para a pasta `dir`: aba, historico, marcadores e links seguem. */
  function moveDocPara(path, dir) {
    return indiceLinks().then(function (idx) {
      return bridge.call('moveFile', { path: path, dir: dir }).then(function (info) {
        var tab = tabByPath(path);
        if (tab) adotarCaminho(tab, info, path);
        else { dropRecent(path); arvoreMudou(); }
        historicoSegue(path, info);
        toast(t('Movido para ') + info.dir, 'ok', 3200);
        return atualizaLinksDepoisDeMover(idx, path, info.path);
      });
    }).catch(falhaDoc('mover'));
  }

  /*
   * Arrastar na arvore, como no explorador do Obsidian: arquivo solto numa
   * pasta (ou no vazio da arvore, que e a raiz) muda de pasta, com os links
   * atualizados; solto no editor, vira [[link]] no ponto em que caiu.
   */
  var arrastoArquivo = null;

  function ligaArrastoNaArvore(row, entry) {
    if (!entry.dir) {
      row.draggable = true;
      row.addEventListener('dragstart', function (e) {
        arrastoArquivo = entry.path;
        e.dataTransfer.effectAllowed = 'copyMove';
        var nome = /\.(md|markdown)$/i.test(entry.name) ? semExtensao(entry.name) : entry.name;
        try { e.dataTransfer.setData('text/plain', '[[' + nome + ']]'); } catch (x) {}
        row.classList.add('is-arrastando');
      });
      row.addEventListener('dragend', function () {
        arrastoArquivo = null;
        row.classList.remove('is-arrastando');
        limpaAlvosDaArvore();
      });
      return;
    }
    row.addEventListener('dragover', function (e) {
      if (!arrastoArquivo || !podeMoverPara(arrastoArquivo, entry.path)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      limpaAlvosDaArvore();
      row.classList.add('is-alvo-mover');
    });
    row.addEventListener('dragleave', function () { row.classList.remove('is-alvo-mover'); });
    row.addEventListener('drop', function (e) {
      if (!arrastoArquivo) return;
      e.preventDefault();
      e.stopPropagation();
      var de = arrastoArquivo;
      arrastoArquivo = null;
      limpaAlvosDaArvore();
      if (podeMoverPara(de, entry.path)) moveDocPara(de, entry.path);
    });
  }

  function podeMoverPara(path, dir) {
    var atual = String(path).replace(/[\\/][^\\/]*$/, '');
    return !mesmoArquivo(atual, dir);
  }

  function limpaAlvosDaArvore() {
    var alvos = $('fileTree').querySelectorAll('.is-alvo-mover');
    for (var i = 0; i < alvos.length; i++) alvos[i].classList.remove('is-alvo-mover');
    $('fileTree').classList.remove('is-alvo-mover');
  }

  function duplicateDoc(path) {
    if (!path) return Promise.resolve();

    return bridge.call('duplicateFile', { path: path }).then(function (info) {
      arvoreMudou();
      toast(t('Copia criada: ') + info.name, 'ok');
      return doOpenPath(info.path, {});
    }).catch(falhaDoc('duplicar'));
  }

  function deleteDoc(path) {
    if (!path) return Promise.resolve();

    var nome = baseName(path);
    var tab = tabByPath(path);
    var sujo = !!(tab && tab.content !== tab.savedContent);

    // Excluir vem primeiro e Cancelar por ultimo de proposito: o Enter aciona
    // o ultimo botao, e o padrao do teclado nao pode ser apagar arquivo.
    return dialog(t('Excluir arquivo?'),
      (sujo
        ? t('O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows, e as alteracoes que ainda nao foram salvas se perdem junto.',
            { nome: escapeText(nome) })
        : t('O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows.',
            { nome: escapeText(nome) })),
      [{ label: t('Excluir'), value: true, cls: 'danger' },
       { label: t('Cancelar'), value: false }]
    ).then(function (sim) {
      if (!sim) return null;
      return bridge.call('deleteFile', { path: path }).then(function () {
        if (tab) closeTab(tab.id, true);
        dropRecent(path);
        arvoreMudou();
        persist();
        toast(t('Foi para a Lixeira: ') + nome, 'ok', 3600);
      });
    }).catch(falhaDoc('excluir'));
  }

  // ------------------------------------------------ historico de versoes

  /*
   * O historico local (o "recuperar arquivo" do Obsidian): o C# guarda o que
   * estava no disco antes de cada gravacao, uma copia a cada cinco minutos,
   * por 30 dias. Aqui se escolhe uma, ve a diferenca para o texto da aba e
   * restaura — restaurar so troca o texto da aba; quem grava e o Ctrl+S, e
   * "Recarregar do disco" desfaz.
   */
  function abreVersoes(path) {
    var tab = tabByPath(path);
    if (!path) return Promise.resolve();

    return bridge.call('listVersions', { path: path }).then(function (res) {
      var versoes = (res && res.versions) || [];
      var overlay = $('overlay');
      var box = document.createElement('div');
      box.className = 'dialog versoes';
      box.setAttribute('role', 'dialog');

      var h = document.createElement('h2');
      h.textContent = t('Versoes de {nome}', { nome: baseName(path) });
      box.appendChild(h);

      var p = document.createElement('p');
      p.textContent = versoes.length
        ? t('Copias guardadas antes de cada gravacao: uma a cada 5 minutos, por 30 dias. Restaurar so troca o texto da aba; o Ctrl+S e que grava.')
        : t('Nenhuma versao guardada ainda. Elas aparecem depois que o MarkPad grava por cima deste arquivo.');
      box.appendChild(p);

      var corpo = document.createElement('div');
      corpo.className = 'versoes-corpo';
      var lista = document.createElement('div');
      lista.className = 'versoes-lista';
      lista.setAttribute('role', 'listbox');
      var vista = document.createElement('div');
      vista.className = 'versoes-diff';
      corpo.appendChild(lista);
      corpo.appendChild(vista);
      if (versoes.length) box.appendChild(corpo);

      var acoes = document.createElement('div');
      acoes.className = 'dialog-actions';
      var btCopiar = botao(t('Copiar texto'), '');
      var btFechar = botao(t('Fechar'), '');
      var btRestaurar = botao(t('Restaurar esta versao'), 'primary');
      if (versoes.length) { acoes.appendChild(btCopiar); }
      acoes.appendChild(btFechar);
      if (versoes.length) acoes.appendChild(btRestaurar);
      box.appendChild(acoes);

      var escolhida = null;   // { id, when, content }

      function botao(rotulo, cls) {
        var b = document.createElement('button');
        b.className = 'btn' + (cls ? ' ' + cls : '');
        b.textContent = rotulo;
        return b;
      }

      function fecha() {
        overlay.hidden = true;
        box.remove();
        document.removeEventListener('keydown', onKey, true);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var i = versoes.findIndex(function (v) { return escolhida && v.id === escolhida.id; });
          i = Math.max(0, Math.min(versoes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
          escolhe(versoes[i]);
        }
      }

      function textoAtual() {
        var aba = tabByPath(path);
        return aba ? Promise.resolve(aba.content) : bridge.call('readFile', { path: path }).then(function (d) { return d.content; });
      }

      function escolhe(v) {
        Array.prototype.forEach.call(lista.children, function (el) {
          el.classList.toggle('is-active', el.getAttribute('data-id') === v.id);
          if (el.getAttribute('data-id') === v.id) el.scrollIntoView({ block: 'nearest' });
        });
        vista.textContent = '';
        escolhida = null;
        Promise.all([bridge.call('readVersion', { path: path, id: v.id }), textoAtual()]).then(function (r) {
          escolhida = { id: v.id, when: v.when, content: r[0].content };
          desenhaDiff(vista, r[1], r[0].content);
        }).catch(function (err) { vista.textContent = t('Nao consegui ler a versao: ') + err.message; });
      }

      versoes.forEach(function (v) {
        var item = document.createElement('div');
        item.className = 'versoes-item';
        item.setAttribute('data-id', v.id);
        item.setAttribute('role', 'option');
        var quando = document.createElement('span');
        quando.textContent = dataCurta(v.when);
        var sub = document.createElement('span');
        sub.className = 'pal-sub';
        sub.textContent = haQuanto(v.when) + ' · ' + tamanhoLegivel(v.size);
        item.appendChild(quando);
        item.appendChild(sub);
        item.onclick = function () { escolhe(v); };
        lista.appendChild(item);
      });

      btFechar.onclick = fecha;
      btCopiar.onclick = function () {
        if (!escolhida) return;
        navigator.clipboard.writeText(escolhida.content);
        toast(t('Texto da versao copiado.'), 'ok', 1600);
      };
      btRestaurar.onclick = function () {
        if (!escolhida) return;
        var v = escolhida;
        fecha();
        restauraVersao(path, v);
      };

      document.body.appendChild(box);
      overlay.hidden = false;
      overlay.onclick = fecha;
      document.addEventListener('keydown', onKey, true);
      if (versoes.length) escolhe(versoes[0]);
      (versoes.length ? btRestaurar : btFechar).focus();
    }).catch(function (err) { toast(t('Nao consegui ler o historico: ') + err.message, 'error', 5000); });
  }

  /*
   * A diferenca do texto da aba para a versao, como um diff unificado: '-'
   * e o que so existe no atual (sai se restaurar), '+' o que so existe na
   * versao (volta). Trechos iguais encolhem para tres linhas de contexto.
   */
  function desenhaDiff(vista, atual, versao) {
    vista.textContent = '';
    var ops = window.MarkPadChanges.diff(atual, versao);
    var mudou = ops.some(function (o) { return o.op !== '='; });
    if (!mudou) {
      var igual = document.createElement('p');
      igual.className = 'pane-empty';
      igual.textContent = t('Igual ao texto atual.');
      vista.appendChild(igual);
      return;
    }

    var legenda = document.createElement('div');
    legenda.className = 'versoes-legenda';
    var tira = ops.filter(function (o) { return o.op === '-'; }).length;
    var poe = ops.filter(function (o) { return o.op === '+'; }).length;
    var linhas = function (n) { return n === 1 ? t('1 linha') : t('{n} linhas', { n: n }); };
    legenda.textContent = t('Em relacao ao texto atual: {a} e {r}', { a: '+' + linhas(poe), r: '−' + linhas(tira) });
    vista.appendChild(legenda);

    var CONTEXTO = 3;
    var perto = ops.map(function () { return false; });
    ops.forEach(function (o, i) {
      if (o.op === '=') return;
      for (var k = Math.max(0, i - CONTEXTO); k <= Math.min(ops.length - 1, i + CONTEXTO); k++) perto[k] = true;
    });

    var pre = document.createElement('div');
    pre.className = 'versoes-linhas';
    var pulou = false;
    ops.forEach(function (o, i) {
      if (!perto[i]) {
        if (!pulou) {
          var corte = document.createElement('div');
          corte.className = 'diff-corte';
          corte.textContent = '…';
          pre.appendChild(corte);
        }
        pulou = true;
        return;
      }
      pulou = false;
      var linha = document.createElement('div');
      linha.className = 'diff-linha' + (o.op === '+' ? ' diff-mais' : o.op === '-' ? ' diff-menos' : '');
      var sinal = document.createElement('span');
      sinal.className = 'diff-sinal';
      sinal.textContent = o.op === '=' ? ' ' : o.op === '-' ? '−' : '+';
      linha.appendChild(sinal);
      linha.appendChild(document.createTextNode(o.texto || ' '));
      pre.appendChild(linha);
    });
    vista.appendChild(pre);
  }

  function restauraVersao(path, v) {
    var aplica = function (tab) {
      tab.content = v.content;
      invalidateLineStatus(tab);
      if (tab.id !== app.activeId) selectTab(tab.id);
      if (tab.locked) setLocked(tab, false, true);
      renderAll();
      toast(t('Versao de {quando} restaurada na aba, ainda nao gravada. Para desistir, use “Recarregar do disco”.',
        { quando: dataCurta(v.when) }), 'ok', 6000);
    };
    var tab = tabByPath(path);
    if (tab) { aplica(tab); return Promise.resolve(); }
    return doOpenPath(path, {}).then(aplica);
  }

  function dataCurta(ms) {
    var d = new Date(ms);
    var hoje = new Date();
    var ontem = new Date(Date.now() - 86400000);
    var hora = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString()) return t('hoje, {hora}', { hora: hora });
    if (d.toDateString() === ontem.toDateString()) return t('ontem, {hora}', { hora: hora });
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ', ' + hora;
  }

  function haQuanto(ms) {
    var min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return t('agora ha pouco');
    if (min < 60) return t('ha {n} min', { n: min });
    var h = Math.round(min / 60);
    if (h < 48) return t('ha {n} h', { n: h });
    return t('ha {n} dias', { n: Math.round(h / 24) });
  }

  function openWithDefaultApp(path) {
    if (!path) return Promise.resolve();
    return bridge.call('openWithDefault', { path: path })
      .catch(falhaDoc(t('abrir no app padrao')));
  }

  // ============================================================== acoes

  function doOpen() {
    bridge.call('openFileDialog', { multi: true }).then(function (paths) {
      if (paths && paths.length) openPaths(paths);
    });
  }

  function doOpenFolder() {
    bridge.call('openFolderDialog', {}).then(function (path) {
      if (path) { setFolder(path); setPane('files'); }
    });
  }

  /** Impressao e PDF saem sempre do modo leitura, mesmo se estiver editando. */
  function comLeituraParaImprimir(tab, fazer) {
    if (!tab.locked) renderPreview($('preview'), tab);
    $('readingView').hidden = false;
    var editing = $('editingView').hidden;
    $('editingView').hidden = true;

    return Promise.resolve().then(fazer).finally(function () {
      $('editingView').hidden = editing;
      renderViews();
    });
  }

  function doPrint() {
    var tab = activeTab();
    if (!tab) return;
    comLeituraParaImprimir(tab, function () { return bridge.call('print', {}); });
  }

  /*
   * PDF com opcoes: papel, orientacao, margem, escala, fundos, cabecalho e
   * rodape (titulo, caminho e numero da pagina). Antes so havia o "Imprimir"
   * do navegador, que esquece tudo a cada vez. As escolhas ficam para a
   * proxima.
   */
  function exportPdf() {
    var tab = activeTab();
    if (!tab) return;
    var op = {};
    var base = DEFAULTS.pdf;
    var salvo = settings.pdf || {};
    Object.keys(base).forEach(function (k) { op[k] = salvo[k] !== undefined ? salvo[k] : base[k]; });

    var overlay = $('overlay');
    var box = document.createElement('div');
    box.className = 'dialog pdf-opcoes';
    box.setAttribute('role', 'dialog');
    var h = document.createElement('h2');
    h.textContent = t('Exportar PDF');
    box.appendChild(h);

    var campos = document.createElement('div');
    campos.className = 'pdf-campos';
    box.appendChild(campos);

    function campo(rotulo, opcoes, chave) {
      var l = document.createElement('label');
      l.className = 'pdf-campo';
      var s = document.createElement('span');
      s.textContent = rotulo;
      l.appendChild(s);
      setSelect(l, opcoes, function () { return op[chave]; }, function (v) {
        op[chave] = typeof base[chave] === 'number' ? Number(v) : v;
      });
      campos.appendChild(l);
    }
    campo(t('Papel'), [
      { value: 'a4', label: 'A4' }, { value: 'carta', label: t('Carta') },
      { value: 'oficio', label: t('Ofício') }, { value: 'a5', label: 'A5' }
    ], 'papel');
    campo(t('Orientação'), [
      { value: 'retrato', label: t('Retrato') }, { value: 'paisagem', label: t('Paisagem') }
    ], 'orientacao');
    campo(t('Margens'), [
      { value: 0, label: t('Nenhuma') }, { value: 10, label: t('Estreitas (1 cm)') },
      { value: 20, label: t('Normais (2 cm)') }, { value: 30, label: t('Largas (3 cm)') }
    ], 'margem');
    campo(t('Escala'), [80, 90, 100, 110, 125].map(function (n) { return { value: n, label: n + '%' }; }), 'escala');

    function marca(rotulo, chave) {
      var l = document.createElement('label');
      l.className = 'dialog-check pdf-check';
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!op[chave];
      c.onchange = function () { op[chave] = c.checked; };
      l.appendChild(c);
      l.appendChild(document.createTextNode(rotulo));
      box.appendChild(l);
    }
    marca(t('Cores e fundos (código, callouts, destaques)'), 'fundos');
    marca(t('Cabeçalho e rodapé (título, caminho e número da página)'), 'cabecalho');

    var acoes = document.createElement('div');
    acoes.className = 'dialog-actions';
    var btCancelar = document.createElement('button');
    btCancelar.className = 'btn';
    btCancelar.textContent = t('Cancelar');
    var btExportar = document.createElement('button');
    btExportar.className = 'btn primary';
    btExportar.textContent = t('Exportar...');
    acoes.appendChild(btCancelar);
    acoes.appendChild(btExportar);
    box.appendChild(acoes);

    function fecha() {
      overlay.hidden = true;
      box.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); e.stopPropagation(); exporta(); }
    }
    btCancelar.onclick = fecha;
    btExportar.onclick = exporta;

    function exporta() {
      fecha();
      settings.pdf = op;
      persist();
      bridge.call('exportDialog', {
        suggestedName: tab.name.replace(/\.\w+$/, '') + '.pdf',
        initialDir: tab.dir || app.folder || '',
        kind: 'pdf'
      }).then(function (path) {
        if (!path) return;
        return comLeituraParaImprimir(tab, function () {
          return bridge.call('exportPdf', {
            path: path, paper: op.papel, orientation: op.orientacao, marginMm: op.margem,
            scale: op.escala, backgrounds: !!op.fundos, headerFooter: !!op.cabecalho,
            title: tab.name.replace(/\.\w+$/, ''), footer: tab.path || ''
          });
        }).then(function () {
          toast(t('PDF salvo: {arquivo}', { arquivo: baseName(path) }), 'ok', 3000);
        });
      }).catch(function (err) {
        toast(t('Não deu para gerar o PDF: ') + (err && err.message || err), 'error', 5000);
      });
    }

    document.body.appendChild(box);
    overlay.hidden = false;
    overlay.onclick = fecha;
    document.addEventListener('keydown', onKey, true);
    btExportar.focus();
  }

  function exportHtml() {
    var tab = activeTab();
    if (!tab) return;

    bridge.call('exportDialog', {
      suggestedName: tab.name.replace(/\.\w+$/, '') + '.html',
      initialDir: tab.dir || app.folder || ''
    }).then(function (path) {
      if (!path) return;

      var result = window.MarkPadMarkdown.render(tab.content, { loadRemoteImages: true });
      var holder = document.createElement('div');
      holder.innerHTML = result.html;
      window.MarkPadMarkdown.sanitizeDom(holder);

      var css = Array.prototype.map.call(document.styleSheets, function (sheet) {
        try {
          return Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n');
        } catch (e) { return ''; }
      }).join('\n');

      var dark = document.body.classList.contains('theme-dark');
      var html = '<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8">' +
        '<title>' + escapeText(tab.name) + '</title><style>' + css +
        '\nbody{padding:40px 20px;overflow:auto;height:auto}' +
        '\n.markdown-preview{padding:0}</style></head>' +
        // A paleta vive no `style` do <body>, nao numa folha — sem carregar o
        // atributo junto, o HTML exportado sairia sempre com as cores de casa.
        '<body class="' + (dark ? 'theme-dark' : 'theme-light') + '"' +
        (document.body.getAttribute('style')
          ? ' style="' + escapeText(document.body.getAttribute('style')).replace(/"/g, '&quot;') + '"'
          : '') + '>' +
        '<div class="markdown-preview">' + holder.innerHTML + '</div></body></html>';

      return bridge.call('writeHtml', { path: path, content: html }).then(function () {
        toast(t('Exportado para ') + path.split(/[\\/]/).pop(), 'ok');
      });
    }).catch(function (err) {
      toast(t('Falha ao exportar: ') + err.message, 'error');
    });
  }

  function promptGoToLine() {
    var tab = activeTab();
    if (!tab) return;
    var total = tab.content.split('\n').length;
    var answer = window.prompt(t('Ir para a linha (1-{total}):', { total: total }), '');
    var n = parseInt(answer, 10);
    if (n > 0) goToLine(Math.min(n, total));
  }

  function toggleAssociation() {
    // Registrado mas nao padrao ainda cai no fluxo de baixo, para poder
    // oferecer a promocao a padrao em vez de so remover.
    if (app.isDefault) {
      dialog(t('Remover associacao?'),
        t('O MarkPad sairá da lista de aplicativos para arquivos <strong>.md</strong>.'),
        [{ label: t('Cancelar'), value: false }, { label: t('Remover'), value: true, cls: 'danger' }]
      ).then(function (yes) {
        if (!yes) return;
        bridge.call('fileAssociation', { enable: false }).then(function () {
          app.associated = false;
          app.isDefault = false;
          toast(t('Associacao removida.'), 'ok', 3000);
        }).catch(function (err) { toast(t('Nao consegui alterar: ') + err.message, 'error', 5000); });
      });
      return;
    }

    // Vale ser franco aqui: desde o Windows 10 o aplicativo padrao de verdade
    // vive numa chave protegida por hash, que so o proprio shell escreve.
    // Podemos registrar o MarkPad e chamar a caixa do Windows — o clique final
    // e do usuario, e nao ha como contornar isso sem gambiarra.
    var extra = app.currentHandler && app.currentHandler !== 'MarkPad.Document.1'
      ? '<br><br>Hoje o Windows abre <strong>.md</strong> com <strong>' +
        escapeText(String(app.currentHandler).replace(/^Applications\\/, '').replace(/\.exe$/i, '')) +
        '</strong>.'
      : '';

    dialog(t('Abrir arquivos .md com o MarkPad'),
      t('O MarkPad entrará na lista de aplicativos para <strong>.md</strong>, ') +
      '<strong>.markdown</strong>, <strong>.mdown</strong>, <strong>.mkd</strong> e ' +
      '<strong>.mdx</strong>, e aparecerá em Configurações &rsaquo; Aplicativos padrão.' + extra +
      '<br><br>Para virar o padrão de fato, o Windows exige que <em>você</em> confirme: ' +
      t('ele mostra uma caixa de escolha. Nenhum programa pode fazer isso sozinho.') +
      '<br><br>Tudo é gravado apenas no seu usuário (HKCU) e some ao remover.',
      [{ label: t('Cancelar'), value: null },
       { label: t('Só registrar'), value: 'register' },
       { label: t('Registrar e definir padrão'), value: 'default', cls: 'primary' }]
    ).then(function (choice) {
      if (!choice) return;

      var op = choice === 'default' ? 'setDefaultAssociation' : 'fileAssociation';
      bridge.call(op, { enable: true }).then(function (res) {
        app.associated = !!res.associated;
        app.isDefault = !!res.isDefault;
        app.currentHandler = res.handler || app.currentHandler;

        if (choice === 'register') {
          toast(t('Registrado. O MarkPad já aparece em "Abrir com".'), 'ok', 4000);
        } else if (res.isDefault) {
          toast(t('Pronto. Arquivos .md agora abrem no MarkPad.'), 'ok', 4000);
        } else {
          toast(t('Registrado, mas o padrão não mudou — a escolha foi cancelada.'), 'warn', 5000);
        }
      }).catch(function (err) {
        toast(t('Nao consegui alterar: ') + err.message, 'error', 5000);
      });
    });
  }

  // ================================================== atalhos de teclado

  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  /* --------------------------------------------------------- colar um link
   *
   * Com texto selecionado, colar uma URL troca a selecao por [texto](url),
   * como no Obsidian. Vale nos dois lugares onde se digita: o textarea do
   * codigo-fonte e o bloco aberto na edicao ao vivo (tambem um textarea).
   * Fica no capture para chegar antes do colar normal do navegador.
   */
  var SO_URL = /^(?:https?|ftp|mailto):\S+$/i;

  /*
   * Devolve o que deve entrar no lugar da selecao, ou o texto cru se nao ha
   * link a montar. Mora aqui fora porque o "Colar" do menu de contexto le a
   * area de transferencia por conta propria e nunca dispara 'paste': a regra
   * valia so para o Ctrl+V, e o mesmo gesto dava resultado diferente
   * conforme o caminho escolhido para pedi-lo.
   */
  function textoColado(sel, bruto) {
    var url = String(bruto == null ? '' : bruto).trim();
    if (!sel || !SO_URL.test(url)) return bruto;
    // Selecao com quebra de linha, ou que ja e um link, fica de fora:
    // [http://a](http://b) nunca e o que se queria.
    if (/[\n\r]/.test(sel) || SO_URL.test(sel.trim())) return bruto;
    return '[' + sel + '](' + url + ')';
  }

  // ------------------------------------------- autocompletar [[ ]]

  /*
   * Digitar [[ no editor (codigo-fonte ou bloco da edicao ao vivo) abre a
   * lista de notas da pasta, filtrada pelo que vem depois; [[Nota# lista os
   * titulos dela, e [[# os do proprio documento. Setas escolhem, Enter ou Tab
   * aceitam, Esc fecha. O nome entra sem extensao — com o caminho quando ha
   * outra nota com o mesmo nome — e o ]] so e posto se ainda nao estiver la.
   * Apelido do frontmatter tambem e sugestao: entra como [[Nota|Apelido]].
   */
  var SUGESTOES_MAX = 30;

  /*
   * Fonte de sugestoes do editor (CodeMirror): [[ lista notas e anexos, [[Nota#
   * os titulos dela, [[# os do proprio documento. A ordem e a do fuzzy daqui
   * (filter: false), nao a do CodeMirror.
   */
  function fonteSugestoes(contexto) {
    if (!app.folder) return null;
    var antes = contexto.matchBefore(/!?\[\[[^\[\]|\n]*$/);
    if (!antes) return null;
    var m = /^(!?)\[\[(.*)$/.exec(antes.text);
    if (!m) return null;
    var embed = m[1] === '!';
    var consulta = m[2];
    var inicio = antes.to - consulta.length;
    return indiceLinks().then(function (idx) {
      if (!idx) return null;
      var hash = consulta.indexOf('#');
      var itens = hash >= 0
        ? sugereTitulos(idx, consulta.slice(0, hash), consulta.slice(hash + 1), inicio + hash + 1)
        : sugereNotas(idx, consulta, embed, inicio);
      if (!itens.length) return null;
      var depois = contexto.state.doc.sliceString(contexto.pos, contexto.pos + 2);
      var fecha = depois === ']]' ? '' : ']]';
      return {
        from: itens[0].inicio,
        filter: false,
        options: itens.map(function (c, i) {
          return {
            label: c.rotulo,
            detail: c.sub ? (c.apelido ? '\u2192 ' + c.sub : c.sub) : undefined,
            boost: -i,
            apply: function (view, completion, de, ate) {
              var txt = c.texto + fecha;
              var fim = de + txt.length + (fecha ? 0 : 2);
              view.dispatch({ changes: { from: de, to: ate, insert: txt }, selection: { anchor: fim }, userEvent: 'input.complete' });
            }
          };
        })
      };
    });
  }

  function sugereNotas(idx, consulta, embed, inicio) {
    var LI = window.MarkPadLinkIndex;
    var q = consulta.trim();
    var querArquivo = embed || /\.[a-z0-9]{1,5}$/i.test(q);
    var candidatos = [];

    idx.arquivos.forEach(function (a) {
      if (!a.md && !querArquivo) return;
      var nome = a.md ? LI.semExtNota(baseName(a.path)) : baseName(a.path);
      var homonimos = a.md ? (idx.porNomeNota[nome.toLowerCase()] || []) : (idx.porNome[nome.toLowerCase()] || []);
      var escrito = homonimos.length > 1 ? (a.md ? LI.semExtNota(a.rel) : a.rel) : nome;
      var pasta = a.rel.indexOf('/') >= 0 ? a.rel.slice(0, a.rel.lastIndexOf('/')) : '';

      var nota = q ? Math.max(fuzzyScore(q, nome), fuzzyScore(q, a.rel) - 4) : 0;
      if (nota > -Infinity) candidatos.push({ nota: nota, rotulo: nome, sub: pasta, texto: escrito, consulta: q, arq: a });

      if (a.analise && q) {
        a.analise.apelidos.forEach(function (ap) {
          var n2 = fuzzyScore(q, ap);
          if (n2 > -Infinity) candidatos.push({ nota: n2, rotulo: ap, sub: nome, texto: escrito + '|' + ap, consulta: q, arq: a, apelido: true });
        });
      }
    });

    if (!q) {
      // Sem nada digitado: as recentes na frente, depois por nome.
      var recentes = (settings.recent || []).map(function (p) { return String(p).toLowerCase(); });
      candidatos.forEach(function (c) {
        var i = recentes.indexOf(String(c.arq.path).toLowerCase());
        c.nota = i >= 0 ? 1000 - i : 0;
      });
    }
    candidatos.sort(function (a, b) {
      return b.nota - a.nota || (a.rotulo.toLowerCase() < b.rotulo.toLowerCase() ? -1 : 1);
    });
    return candidatos.slice(0, SUGESTOES_MAX).map(function (c) {
      c.inicio = inicio;
      return c;
    });
  }

  function sugereTitulos(idx, alvo, consulta, inicio) {
    var LI = window.MarkPadLinkIndex;
    var tab = activeTab();
    var titulos;
    if (!alvo.trim()) {
      titulos = tab ? LI.analisa(tab.content).titulos : [];
    } else {
      var arq = LI.resolve(idx, { tipo: 'wiki', alvo: alvo.trim() }, relNaPasta((tab && tab.path) || ''));
      titulos = arq && arq.analise ? arq.analise.titulos : [];
    }
    var q = consulta.trim();
    return titulos.map(function (h) {
      return { nota: q ? fuzzyScore(q, h.texto) : -h.linha, rotulo: h.texto, sub: 'H' + h.nivel, texto: h.texto, consulta: q, inicio: inicio };
    }).filter(function (c) { return c.nota > -Infinity; })
      .sort(function (a, b) { return b.nota - a.nota; })
      .slice(0, SUGESTOES_MAX);
  }


  // Soltar o Ctrl conclui o Ctrl+Tab; a janela perder o foco tambem (o
  // keyup do Ctrl nunca chegaria).
  document.addEventListener('keyup', function (e) {
    if (app.trocaUso && (e.key === 'Control' || e.key === 'Meta')) concluiTrocaUso();
  }, true);
  window.addEventListener('blur', function () { if (app.trocaUso) concluiTrocaUso(); });

  document.addEventListener('keydown', function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var tab = activeTab();
    var inEditor = !!(ed && e.target && ed.view.contentDOM.contains(e.target));

    // ---- Ctrl+Tab: abas pela ordem de uso (antes de tudo: no editor o Tab
    // sozinho recua a linha, e o Ctrl+Tab caia ali).
    if (ctrl && !e.altKey && e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      trocaPorUso(e.shiftKey ? -1 : 1);
      return;
    }
    if (app.trocaUso && e.key === 'Escape') {
      e.preventDefault();
      concluiTrocaUso(true);
      return;
    }

    // ---- voltar/avancar: Ctrl+Alt+setas em qualquer lugar; Alt+setas so fora
    // de campo de texto (no editor elas ficam com o editor).
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      var foco = document.activeElement;
      var digitando = !!foco && (foco.tagName === 'TEXTAREA' || foco.tagName === 'INPUT' || foco.isContentEditable);
      if (ctrl || !digitando) {
        e.preventDefault();
        navega(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
    }

    // ---- F3 / Shift+F3: proxima e anterior da busca; Ctrl+F3: busca a palavra
    // atual (Notepad++). Vale tambem de dentro da caixa de busca.
    if (e.key === 'F3' && !e.altKey) {
      e.preventDefault();
      if (ctrl) buscaPalavraAtual(e.shiftKey ? -1 : 1);
      else if ($('findInput').value) { if (!app.find.open) openFind(); runFind(e.shiftKey ? -1 : 1); }
      else openFind();
      return;
    }

    // ---- Alt+F5 / Alt+Shift+F5: proxima e anterior alteracao da margem.
    if (e.key === 'F5' && e.altKey && !ctrl) {
      e.preventDefault();
      pulaAlteracao(e.shiftKey ? -1 : 1);
      return;
    }

    // ---- comandos globais
    if (ctrl && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'o': e.preventDefault(); e.shiftKey ? doOpenFolder() : doOpen(); return;
        case 'n': e.preventDefault(); if (e.shiftKey) novaJanela(app.folder ? [app.folder] : []); else newTab(); return;
        case 's': e.preventDefault(); saveTab(activeTab(), e.shiftKey); return;
        case 'w': e.preventDefault(); if (tab) closeTab(app.activeId); return;
        case 'e': e.preventDefault(); toggleLock(); return;
        case 'f':
          e.preventDefault();
          e.shiftKey ? openFolderSearch() : openFind();
          return;
        case 'g': e.preventDefault(); promptGoToLine(); return;
        case 'pageup':
        case 'pagedown': {
          // Ctrl+PgUp/PgDn troca de aba; com Shift, move a aba (Notepad++).
          e.preventDefault();
          if (!tab) return;
          var passoAba = e.key.toLowerCase() === 'pageup' ? -1 : 1;
          var iAba = app.tabs.indexOf(tab);
          if (e.shiftKey) moveAba(tab, iAba + passoAba);
          else if (app.tabs.length > 1) selectTab(app.tabs[(iAba + passoAba + app.tabs.length) % app.tabs.length].id);
          return;
        }
        case 'h': e.preventDefault(); openReplace(); return;
        case 'p':
          // Ctrl+P abre arquivo pelo nome, como em qualquer editor. Imprimir
          // saiu para Ctrl+Alt+P e continua no menu, na paleta e na barra.
          e.preventDefault();
          e.shiftKey ? openPalette() : openSwitcher();
          return;
        case '\\': e.preventDefault(); toggleSidebar(); return;
        case '|': e.preventDefault(); toggleSidebarDireita(); return;
        case 'tab':
          e.preventDefault();
          if (app.tabs.length > 1) {
            var i = app.tabs.findIndex(function (t) { return t.id === app.activeId; });
            var next = (i + (e.shiftKey ? -1 : 1) + app.tabs.length) % app.tabs.length;
            selectTab(app.tabs[next].id);
          }
          return;
      }

      if (e.key === ',') { e.preventDefault(); openSettings(); return; }
      if (e.shiftKey && (e.key === '_' || e.key === '-')) { e.preventDefault(); setAllFolds(true); return; }
      if (e.shiftKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); setAllFolds(false); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1); return; }
      if (e.key === '-') { e.preventDefault(); zoom(-1); return; }
      if (e.key === '0') { e.preventDefault(); settings.fontSize = 16; settings.editorFontSize = 14; applyFontSizes(); renderStatus(); persist(); return; }

      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        var target = app.tabs[parseInt(e.key, 10) - 1];
        if (target) selectTab(target.id);
        return;
      }
    }

    if (ctrl && e.shiftKey && !e.altKey) {
      var sk = e.key.toLowerCase();
      if (sk === 'c') { e.preventDefault(); toggleSource(); return; }
      if (sk === 'l') { e.preventDefault(); togglePreviewPane(); return; }
      if (sk === 't') { e.preventDefault(); reabrirAba(); return; }
    }

    if (ctrl && e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); doPrint(); return; }

    // F8: a outra metade da tela dividida (como no Notepad++).
    if (e.key === 'F8' && !ctrl && !e.altKey && !e.shiftKey && dividido()) {
      e.preventDefault();
      focaOutraMetade();
      return;
    }

    // F11: tela inteira (o lado nativo tira a moldura e cobre a barra de tarefas).
    if (e.key === 'F11' && !ctrl && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      alternaTelaInteira();
      return;
    }

    if (e.key === 'F2' && !ctrl && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (tab && tab.path) renameDoc(tab.path);
      else toast(t('Salve o documento antes de renomear.'), 'warn');
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      settings.wordWrap = !settings.wordWrap;
      applyWrap();
      renderEditorHighlight();
      renderStatus();
      persist();
      return;
    }

    if (e.key === 'Escape') {
      if (!$('palette').hidden || !$('switcher').hidden) return;
      if (!$('menu').hidden) { hideMenu(); return; }
      if (app.find.open) { e.preventDefault(); closeFind(); return; }
    }

    // ---- barra de localizar
    if (e.target === $('findInput')) {
      if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); return; }
      return;
    }
    if (e.target === $('replaceInput')) {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); return; }
      return;
    }
    if (e.target === $('treeFilterInput')) {
      if (e.key === 'Escape') { e.preventDefault(); toggleTreeFilter(false); }
      return;
    }
    if (e.target === $('folderSearchInput')) {
      if (e.key === 'Enter') { e.preventDefault(); runFolderSearch(); }
      return;
    }

    if (!inEditor) return;

    // ---- teclas do editor: Tab, Enter, Ctrl+B/I/K e Ctrl+/ moram no proprio
    // editor (editor.js); aqui ficam so as operacoes de linha do Notepad++.
    if (atalhoDeLinha(e)) return;
  }, true);


  // -------------------------------------------------- ajudantes do editor

  function lineBounds(text, pos) {
    var start = text.lastIndexOf('\n', pos - 1) + 1;
    var end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    return { start: start, end: end };
  }

  /*
   * '<!--' e '-->' nao aninham, e a regra antiga — do primeiro abre ao ultimo
   * fecha — nao sabia disso: com '<!-- a -->' e '<!-- b -->' selecionados ela
   * via UM comentario so e devolvia 'a -->' seguido de '<!-- b'. Texto do
   * usuario destruido, sem aviso e sem jeito de perceber ate reler o arquivo.
   *
   * So ha dois jeitos de um trecho estar comentado, entao so estes dois
   * voltam: o bloco inteiro numa marcacao so, ou cada linha na sua.
   */
  var SO_COMENTARIO = /^(\s*)<!--\s?([\s\S]*?)\s?-->(\s*)$/;

  function descomenta(txt) {
    var m = SO_COMENTARIO.exec(txt);
    // Sobrou um '-->' no miolo: o que casou nao era um comentario, eram dois.
    return m && m[2].indexOf('-->') === -1 ? m[1] + m[2] + m[3] : null;
  }

  function comentaBloco(block) {
    var inteiro = descomenta(block);
    if (inteiro !== null) return inteiro;

    // Linha a linha e o que sai de comentar duas linhas soltas com o cursor
    // em cada uma, entao tem de ser tambem o que volta.
    var linhas = block.split('\n').map(function (l) {
      return l.trim() ? descomenta(l) : l;
    });
    var todas = block.trim() && linhas.every(function (l) { return l !== null; });
    return todas ? linhas.join('\n') : '<!-- ' + block + ' -->';
  }

  function toggleComment() {
    if (!ed) return;
    var text = ed.texto();
    var sl = ed.selecao();
    var first = lineBounds(text, sl.inicio).start;
    var last = lineBounds(text, sl.fim).end;
    replaceRange(first, last, comentaBloco(text.slice(first, last)));
  }

  // ========================================================== atualizacao
  //
  // O trabalho pesado esta no Updater.cs; aqui so mora a conversa com o
  // usuario. Duas regras que valem para tudo nesta secao:
  //
  //   1. Nada baixa sem um clique. A consulta e automatica, o download nao.
  //   2. Nada instala sem o SHA-256 publicado na release conferir — o C#
  //      recusa sozinho, mas e por isso que existe o estado "so a pagina":
  //      sem soma publicada, o aviso vira um link e nao um botao.
  //
  // O aviso nunca e modal. Quem abriu o MarkPad queria ler um arquivo.

  var UM_DIA = 24 * 60 * 60 * 1000;
  var RELEASES_URL = 'https://github.com/NBN-PATRIC/markpad/releases';

  var atualizacao = {
    estado: 'nada',   // nada | disponivel | baixando | pronta
    info: null,       // resposta do updateCheck, quando ha novidade
    pendente: null,   // { version, file } ja baixado e conferido
    escondida: false, // o X foi clicado nesta sessao
    baixado: 0,
    total: 0
  };

  /** "55,3 MB" — so para o usuario ter ideia do tamanho do download. */
  function tamanhoLegivel(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  }

  /**
   * Consulta as versoes publicadas.
   *
   * `manual` pula a preferencia e o intervalo: quem clicou em "Procurar
   * agora" quer a resposta agora, mesmo tendo desligado a consulta
   * automatica. Nunca rejeita — rede fora nao e assunto do usuario.
   */
  function verificaAtualizacao(manual) {
    if (!manual) {
      if (settings.checkUpdates === false) return Promise.resolve(null);
      var desde = Date.now() - Number(settings.lastUpdateCheck || 0);
      if (desde >= 0 && desde < UM_DIA) return Promise.resolve(null);
    }

    settings.lastUpdateCheck = Date.now();
    persist();

    return bridge.call('updateCheck', {}).then(function (r) {
      if (!r || !r.ok || !r.available) return r || null;

      atualizacao.info = r;
      atualizacao.estado = 'disponivel';
      atualizacao.escondida = false;
      desenhaBarraAtualizacao();
      return r;
    }).catch(function () { return null; });
  }

  /** Ha download conferido esperando? Sobra quando o app nao pode se trocar. */
  function conferePendente() {
    return bridge.call('updatePending', {}).then(function (p) {
      if (!p || !p.version) return null;
      atualizacao.pendente = p;
      atualizacao.estado = 'pronta';
      desenhaBarraAtualizacao();
      return p;
    }).catch(function () { return null; });
  }

  function baixaAtualizacao() {
    var info = atualizacao.info;
    if (!info || !info.canInstall) return;

    atualizacao.estado = 'baixando';
    atualizacao.baixado = 0;
    atualizacao.total = Number(info.size) || 0;
    desenhaBarraAtualizacao();

    bridge.call('updateDownload', {
      url: info.url, asset: info.asset, sha256: info.sha256, version: info.latest
    }).then(function (p) {
      atualizacao.pendente = p;
      atualizacao.estado = 'pronta';
      desenhaBarraAtualizacao();
    }).catch(function (err) {
      atualizacao.estado = 'disponivel';
      desenhaBarraAtualizacao();
      toast(t('Nao deu para baixar a atualizacao: ') + mensagemDeErro(err), 'warn', 6000);
    });
  }

  /**
   * Fecha o MarkPad e deixa o instalador rodar. O que estiver por salvar
   * passa antes pelo caminho de sempre — o host pergunta ao fechar.
   */
  function aplicaAtualizacao() {
    bridge.call('updateApply', {}).catch(function (err) {
      toast(t('Nao deu para iniciar a instalacao: ') + mensagemDeErro(err), 'warn', 6000);
    });
  }

  function descartaAtualizacao() {
    return bridge.call('updateDiscard', {}).then(function () {
      atualizacao.pendente = null;
      atualizacao.estado = atualizacao.info ? 'disponivel' : 'nada';
      desenhaBarraAtualizacao();
    }).catch(function () {});
  }

  function mensagemDeErro(err) {
    return (err && err.message) ? err.message : String(err);
  }

  function abrePaginaReleases() {
    bridge.call('openExternal', {
      url: (atualizacao.info && atualizacao.info.page) || RELEASES_URL
    }).catch(function () {});
  }

  /** Redesenha o aviso do canto conforme o estado. */
  function desenhaBarraAtualizacao() {
    var bar = $('updateBar');
    if (!bar) return;

    var estado = atualizacao.estado;
    if (estado === 'nada' || (atualizacao.escondida && estado !== 'baixando')) {
      bar.hidden = true;
      alturaDoAviso(0);
      return;
    }

    var info = atualizacao.info || {};
    var titulo = $('updateTitle');
    var desc = $('updateDesc');
    var acoes = $('updateActions');
    var prog = $('updateProgress');

    acoes.textContent = '';
    prog.hidden = true;
    bar.classList.toggle('is-working', estado === 'baixando');

    function botao(rotulo, fn, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn tiny' + (cls ? ' ' + cls : '');
      b.textContent = rotulo;
      b.onclick = fn;
      acoes.appendChild(b);
    }

    if (estado === 'disponivel') {
      titulo.textContent = t('MarkPad {versao} disponivel', { versao: info.latest });

      if (info.canInstall) {
        desc.textContent = t('Voce esta na ') + info.current + '.'
          + (info.size ? ' O download tem ' + tamanhoLegivel(info.size) + '.' : '');
        botao('Baixar', baixaAtualizacao, 'primary');
        botao(t('Ver as notas'), abrePaginaReleases);
      } else if (info.portable) {
        // Portatil pode estar num pendrive so de leitura, ou existir em tres
        // copias na maquina. Trocar sozinho seria trocar a copia errada.
        desc.textContent = t('Esta e a versao portatil: baixe o novo .zip e substitua a pasta.');
        botao(t('Abrir a pagina'), abrePaginaReleases, 'primary');
      } else {
        desc.textContent = t('Esta versao nao publicou a soma de conferencia do instalador, ')
          + t('entao o download automatico fica de fora. Baixe pela pagina.');
        botao(t('Abrir a pagina'), abrePaginaReleases, 'primary');
      }
    } else if (estado === 'baixando') {
      titulo.textContent = t('Baixando MarkPad ') + (info.latest || '');
      desc.textContent = atualizacao.total
        ? tamanhoLegivel(atualizacao.baixado) + ' de ' + tamanhoLegivel(atualizacao.total)
        : tamanhoLegivel(atualizacao.baixado) + ' ate agora';

      prog.hidden = false;
      var pct = atualizacao.total
        ? Math.min(100, Math.round(atualizacao.baixado * 100 / atualizacao.total))
        : 0;
      $('updateProgressFill').style.width = pct + '%';
    } else if (estado === 'pronta') {
      var v = (atualizacao.pendente && atualizacao.pendente.version) || info.latest || '';
      titulo.textContent = t('MarkPad {versao} pronta para instalar', { versao: v });
      desc.textContent = t('O MarkPad fecha, instala e abre de novo — leva alguns segundos. ')
        + t('Se preferir, a troca acontece sozinha na proxima vez que voce abrir.');
      botao(t('Reiniciar agora'), aplicaAtualizacao, 'primary');
      botao(t('Na proxima vez'), function () {
        atualizacao.escondida = true;
        desenhaBarraAtualizacao();
        toast(t('A atualizacao entra na proxima vez que o MarkPad abrir.'), '', 4000);
      });
    }

    bar.hidden = false;
    window.MarkPadIcons.apply(bar);
    alturaDoAviso(bar.offsetHeight);
  }

  /**
   * O aviso e os toasts moram no mesmo canto. Em vez de escolher um z-index e
   * deixar um cobrir o outro, os toasts sobem exatamente a altura do aviso —
   * que muda conforme o texto, entao a medida vai para o CSS como variavel.
   */
  function alturaDoAviso(px) {
    document.body.style.setProperty('--update-bar-h', px ? (px + 8) + 'px' : '0px');
  }

  // ============================================================== eventos

  function wireUi() {
    window.MarkPadIcons.apply(document);

    $('btnToggleSidebar').onclick = function () { toggleSidebar(); };
    $('btnToggleSidebarDireita').onclick = function () { toggleSidebarDireita(); };
    ligaDivisor();
    ligaGrafo();
    $('btnNewTab').onclick = newTab;
    $('btnCommandPalette').onclick = openPalette;
    $('btnOpenFolder').onclick = doOpenFolder;
    $('btnRefreshTree').onclick = function () {
      // Sem zerar treeOpen: quem clica em Atualizar quer ver o arquivo novo,
      // nao perder quatro niveis de pasta abertos. Recolher tem botao proprio.
      invalidateFileIndex();
      refreshTree();
    };
    $('btnTreeSearch').onclick = function () { toggleTreeFilter(); };

    $('btnTagFilter').onclick = function () { toggleTagFilter(); };
    $('btnTagSort').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      tagSortMenu(r.right - 250, r.bottom + 4);
    };
    $('btnTagRefresh').onclick = function () {
      app.tags = null;
      app.tagsDe = null;
      renderTags();
    };
    $('tagFilterInput').addEventListener('input', function () {
      app.tagFilter = this.value;
      clearTimeout(tagFilterTimer);
      tagFilterTimer = setTimeout(renderTags, 120);
    });
    $('tagFilterInput').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); toggleTagFilter(false); }
    });
    $('btnTreeSort').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      treeSortMenu(r.right - 250, r.bottom + 4);
    };
    $('btnTreeCollapse').onclick = collapseTree;

    // O filtro do painel espera o usuario parar de digitar: cada tecla
    // reordenaria a lista inteira, e a lista pisca mais do que ajuda.
    $('treeFilterInput').addEventListener('input', function (ev) {
      var valor = ev.target.value.trim();
      clearTimeout(treeFilterTimer);
      treeFilterTimer = setTimeout(function () {
        if (app.treeFilter === valor) return;
        app.treeFilter = valor;
        refreshTree();
      }, 160);
    });
    $('btnTreeFilter').onclick = function () {
      settings.treeOnlyMarkdown = !settings.treeOnlyMarkdown;
      renderTreeFilter();
      refreshTree();
      persist();
    };
    $('btnClearRecent').onclick = function () { settings.recent = []; renderRecent(); persist(); };

    $('btnLock').onclick = toggleLock;
    $('btnFind').onclick = openFind;
    $('btnVoltar').onclick = function () { navega(-1); };
    $('btnAvancar').onclick = function () { navega(1); };
    $('btnOutlineFilter').onclick = function () { alternaFiltroSumario(); };
    $('btnOutlineCollapse').onclick = alternaRecolherSumario;
    $('outlineFilterInput').addEventListener('input', function () {
      sumario.filtro = $('outlineFilterInput').value;
      renderOutline();
    });
    $('outlineFilterInput').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); alternaFiltroSumario(false); }
    });
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key !== 'z' && e.key !== 'Z')) return;
      var alvo = e.target;
      if (alvo && (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'INPUT' || alvo.isContentEditable)) return;
      if (desfazMoverSecao()) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    // Arquivo da arvore solto no editor vira [[link]] no ponto da queda: quem
    // insere e o proprio editor (CodeMirror), como qualquer texto arrastado.

    var arvore = $('fileTree');
    arvore.addEventListener('dragover', function (e) {
      if (!arrastoArquivo || !app.folder || e.target.closest('.tree-item') || !podeMoverPara(arrastoArquivo, app.folder)) return;
      e.preventDefault();
      arvore.classList.add('is-alvo-mover');
    });
    arvore.addEventListener('dragleave', function (e) { if (e.target === arvore) arvore.classList.remove('is-alvo-mover'); });
    arvore.addEventListener('drop', function (e) {
      if (!arrastoArquivo || e.target.closest('.tree-item')) return;
      e.preventDefault();
      var de = arrastoArquivo;
      arrastoArquivo = null;
      limpaAlvosDaArvore();
      if (app.folder && podeMoverPara(de, app.folder)) moveDocPara(de, app.folder);
    });
    $('btnMarcar').onclick = function () { var tab = activeTab(); if (tab) alternaMarcadorArquivo(tab.path); };
    $('btnNovoGrupo').onclick = novoGrupoDeMarcadores;
    $('btnMarcarAtual').onclick = function () { var tab = activeTab(); if (tab && tab.path && !marcadorDoArquivo(tab.path)) alternaMarcadorArquivo(tab.path); };
    $('btnMarcarBusca').onclick = function () { marcaBusca($('folderSearchInput').value); };
    $('btnVoltar').oncontextmenu = function (e) { menuHistorico(-1, e); };
    $('btnAvancar').oncontextmenu = function (e) { menuHistorico(1, e); };
    // Botoes laterais do mouse (4 e 5): voltar e avancar, como no navegador.
    // O mousedown deles e engolido para o WebView2 nao tentar navegar a pagina.
    document.addEventListener('mousedown', function (e) {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    document.addEventListener('mouseup', function (e) {
      if (e.button === 3) { e.preventDefault(); navega(-1); }
      else if (e.button === 4) { e.preventDefault(); navega(1); }
    });
    // A barra de status conta a selecao enquanto ela muda (um quadro por vez).
    var statusPendente = false;
    document.addEventListener('selectionchange', function () {
      if (statusPendente) return;
      statusPendente = true;
      requestAnimationFrame(function () { statusPendente = false; renderStatus(); });
    });
    $('btnMore').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      moreMenu(r.right - 220, r.bottom + 4);
    };

    $('btnEmptyOpen').onclick = doOpen;
    $('btnEmptyFolder').onclick = doOpenFolder;
    $('btnEmptyNew').onclick = newTab;

    $('btnModeFlag').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      modeMenu(r.right - 230, r.bottom + 4);
    };
    $('statusSplit').onclick = togglePreviewPane;

    var segBtns = document.querySelectorAll('.mode-seg-btn');
    for (var m = 0; m < segBtns.length; m++) {
      (function (btn) {
        btn.onclick = function () { setModo(btn.getAttribute('data-mode')); };
      })(segBtns[m]);
    }

    var sideTabs = document.querySelectorAll('.sidebar-tab');
    for (var j = 0; j < sideTabs.length; j++) {
      (function (btn) {
        btn.onclick = function () { setPane(btn.getAttribute('data-pane')); };
        btn.oncontextmenu = function (e) {
          e.preventDefault();
          var id = btn.getAttribute('data-pane');
          showMenu([{ label: ladoDe(id) === 'direita' ? t('Mover para a barra da esquerda') : t('Mover para a barra da direita'),
            icon: ladoDe(id) === 'direita' ? 'panel-left' : 'panel-right', action: function () { moveDeLado(id); } }], e.clientX, e.clientY);
        };
      })(sideTabs[j]);
    }

    // acompanha a leitura para destacar a seção atual no sumário
    var spyTimer = null;
    $('readingScroll').addEventListener('scroll', function () {
      clearTimeout(spyTimer);
      spyTimer = setTimeout(marcaSecaoAtual, 80);
    });

    // editor (CodeMirror 6)
    criaEditor();

    // leitura
    $('readingView').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var tab = activeTab();

      var sel = String(window.getSelection());
      showMenu([
        { label: t('Copiar'), icon: 'copy', disabled: !sel, action: function () { navigator.clipboard.writeText(sel); } },
        { label: t('Selecionar tudo'), action: function () {
            var r = document.createRange();
            r.selectNodeContents($('preview'));
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } },
        '-',
        // Este menu tambem abre no modo vivo, onde a edicao ja esta liberada:
        // rotulo fixo mentiria sobre o que o clique faz com a trava.
        { label: tab && tab.locked ? t('Liberar edicao') : t('Travar edicao'),
          icon: tab && tab.locked ? 'unlock' : 'lock', key: 'Ctrl+E', action: toggleLock },
        { label: t('Localizar'), icon: 'search', key: 'Ctrl+F', action: openFind }
      ], e.clientX, e.clientY);
    });

    // localizar
    $('findInput').addEventListener('input', function () { runFind(0); });
    $('btnFindNext').onclick = function () { runFind(1); };
    $('btnFindPrev').onclick = function () { runFind(-1); };
    $('btnFindClose').onclick = closeFind;
    $('btnFindCase').onclick = function (e) {
      app.find.caseSensitive = !app.find.caseSensitive;
      e.currentTarget.classList.toggle('is-on', app.find.caseSensitive);
      runFind(0);
    };
    $('btnFindRegex').onclick = function (e) {
      app.find.regex = !app.find.regex;
      e.currentTarget.classList.toggle('is-on', app.find.regex);
      runFind(0);
    };
    $('btnReplace').onclick = replaceCurrent;
    $('btnReplaceAll').onclick = replaceAll;

    // busca na pasta
    $('folderSearchInput').addEventListener('input', function () {
      clearTimeout(folderSearchTimer);
      folderSearchTimer = setTimeout(runFolderSearch, 320);
    });
    $('btnSearchCase').onclick = function (e) {
      app.folderSearch.caseSensitive = !app.folderSearch.caseSensitive;
      e.currentTarget.classList.toggle('is-on', app.folderSearch.caseSensitive);
      runFolderSearch();
    };
    $('btnSearchRegex').onclick = function (e) {
      app.folderSearch.regex = !app.folderSearch.regex;
      e.currentTarget.classList.toggle('is-on', app.folderSearch.regex);
      runFolderSearch();
    };

    // status
    $('statusWrap').onclick = function () {
      settings.wordWrap = !settings.wordWrap;
      applyWrap(); renderEditorHighlight(); renderStatus(); persist();
    };
    $('statusTheme').onclick = cycleTheme;
    $('statusZoom').onclick = function () {
      settings.fontSize = 16; settings.editorFontSize = 14;
      applyFontSizes(); renderStatus(); persist();
    };
    $('statusEol').onclick = function () {
      var tab = activeTab();
      if (!tab) return;
      showMenu([
        { label: t('Windows (CRLF)'), checked: tab.eol === '\r\n', action: function () { tab.eol = '\r\n'; renderStatus(); } },
        { label: t('Unix (LF)'), checked: tab.eol === '\n', action: function () { tab.eol = '\n'; renderStatus(); } }
      ], window.innerWidth - 240, window.innerHeight - 120);
    };
    $('statusEncoding').onclick = function () {
      var tab = activeTab();
      if (!tab) return;
      // windows-1252 e o "ANSI" do Windows em portugues; latin1 fica para
      // quem precisa de ISO-8859-1 de verdade.
      var options = ['utf-8', 'utf-8-bom', 'utf-16le', 'windows-1252', 'latin1'];
      showMenu(options.map(function (enc) {
        return {
          label: enc.toUpperCase(),
          checked: tab.encoding === enc,
          action: function () { tab.encoding = enc; renderStatus(); toast(t('Sera gravado em ') + enc.toUpperCase() + '.', 'ok'); }
        };
      }), window.innerWidth - 240, window.innerHeight - 160);
    };

    wireResizers();
  }

  // =================================================== o editor (CodeMirror 6)

  var ed = null;
  var spyEditor = null;
  var statusQuadro = 0;

  function criaEditor() {
    if (window.MarkPadEditor && window.MarkPadEditor.realcaCodigo && window.MarkPadHighlight && !window.MarkPadHighlight._doEditor) {
      var realceAntigo = window.MarkPadHighlight.highlight;
      window.MarkPadHighlight.highlight = function (codigo, lang) {
        var h = null;
        try { h = window.MarkPadEditor.realcaCodigo(codigo, lang); } catch (err) { h = null; }
        return h != null ? h : realceAntigo(codigo, lang);
      };
      window.MarkPadHighlight._doEditor = true;
    }
    if (!window.MarkPadEditor) {
      console.error('MarkPad: o editor (codemirror.js) nao carregou');
      return;
    }
    ed = window.MarkPadEditor.create($('editorPane'), {
      t: t,
      renderTrecho: renderTrecho,
      wikiExiste: wikiExisteNoIndice,
      abreLink: function (el, e) { trataLink(el, e, null, activeTab()); },
      aoMudar: function () { onEditorInput(); },
      aoMudarSelecao: function () {
        if (statusQuadro) return;
        statusQuadro = requestAnimationFrame(function () { statusQuadro = 0; renderStatus(); });
      },
      travado: function () { toast(t('Edicao travada. Ctrl+E para liberar.'), '', 1600); },
      textoColado: textoColado,
      alternaComentario: function () { toggleComment(); return true; },
      colaImagens: colaImagens,
      rodape: function (el) {
        var tab = ed && ed.aba;
        if (tab && settings.showBacklinks !== false) renderBacklinks(el, tab);
      },
      sugestoes: [fonteSugestoes, fonteTags, fonteComandosBarra]
    });
    ed.aba = null;
    ed.view.scrollDOM.addEventListener('scroll', function () {
      clearTimeout(spyEditor);
      spyEditor = setTimeout(marcaSecaoAtual, 80);
    });
    ed.view.dom.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      menuDoEditor(e.clientX, e.clientY);
    });
  }

  // ===================================================== espacos de trabalho
  //
  // O "Workspaces" do Obsidian: guarda com um nome o arranjo de agora (pasta,
  // abas, quais moram na metade 2, a divisao, as fixadas, a aba ativa) e
  // volta a ele depois. Abrir um espaco fecha as abas limpas que nao fazem
  // parte dele; aba com alteracao por salvar fica, para nada se perder.

  function fotoDoEspaco(nome) {
    var ativa = activeTab();
    return {
      nome: nome,
      pasta: app.folder || '',
      abas: app.tabs.filter(function (t) { return t.path && !t.espelhoDe; }).map(function (t) { return t.path; }),
      grupo2: dividido() ? app.tabs.filter(function (t) { return t.path && !t.espelhoDe && grupoDe(t) === 2; }).map(function (t) { return t.path; }) : [],
      fixadas: app.tabs.filter(function (t) { return t.path && t.fixada; }).map(function (t) { return t.path; }),
      ativa: ativa && ativa.path ? (ativa.espelhoDe ? (tabById(ativa.espelhoDe) || {}).path : ativa.path) : '',
      direcao: settings.layoutDirecao || 'h',
      proporcao: settings.layoutProporcao || 0.5,
      empilhados: app.grupos.filter(function (g) { return g.empilhado; }).map(function (g) { return g.id; }),
      quando: Date.now()
    };
  }

  function salvaEspaco() {
    var lista = settings.espacos || [];
    var sugestao = app.espacoAtual || (app.folder ? baseName(app.folder) : t('Meu espaco'));
    promptDialog(t('Salvar espaco de trabalho'), t('Nome do espaco (o mesmo nome substitui o anterior):'), { value: sugestao }).then(function (nome) {
      if (!nome) return;
      nome = nome.trim();
      var foto = fotoDoEspaco(nome);
      if (!foto.abas.length) { toast(t('Nenhuma aba com arquivo para guardar.'), 'warn', 2400); return; }
      settings.espacos = lista.filter(function (e) { return e.nome.toLowerCase() !== nome.toLowerCase(); }).concat([foto]);
      app.espacoAtual = nome;
      persist();
      toast(t('Espaco "{nome}" salvo com {n} abas.', { nome: nome, n: foto.abas.length }), 'ok', 2400);
    });
  }

  function listaDeEspacos() {
    return (settings.espacos || []).slice().sort(function (a, b) { return (b.quando || 0) - (a.quando || 0); }).map(function (e) {
      return { name: e.nome, path: e.nome, rel: e.nome, markdown: true, icone: 'columns',
        sub: (e.pasta ? baseName(e.pasta) + ' \u00b7 ' : '') + t('{n} abas', { n: e.abas.length }), espaco: e };
    });
  }

  function abreEspaco() {
    if (!(settings.espacos || []).length) { toast(t('Nenhum espaco salvo ainda. Use "Salvar espaco de trabalho".'), '', 2600); return; }
    openSwitcher({ dica: t('Abrir espaco de trabalho'), lista: listaDeEspacos(), escolhe: function (f) { aplicaEspaco(f.espaco); } });
  }

  function apagaEspaco() {
    if (!(settings.espacos || []).length) { toast(t('Nenhum espaco salvo.'), '', 1800); return; }
    openSwitcher({ dica: t('Apagar espaco de trabalho'), lista: listaDeEspacos(), escolhe: function (f) {
      settings.espacos = (settings.espacos || []).filter(function (e) { return e !== f.espaco; });
      if (app.espacoAtual === f.espaco.nome) app.espacoAtual = null;
      persist();
      toast(t('Espaco "{nome}" apagado.', { nome: f.espaco.nome }), '', 2000);
    } });
  }

  function aplicaEspaco(esp) {
    if (!esp) return;
    var querem = esp.abas.map(function (c) { return c.toLowerCase(); });
    // Fecha o que nao faz parte, menos o que tem alteracao por salvar.
    var ficaram = 0;
    var fechar = [];
    app.tabs.slice().forEach(function (tb) {
      var dentro = tb.path && querem.indexOf(tb.path.toLowerCase()) !== -1;
      if (dentro && !tb.espelhoDe) return;
      if (tb.content !== tb.savedContent) { ficaram++; return; }
      fechar.push(tb.id);
    });
    var fechou = fechar.reduce(function (pr, id) { return pr.then(function () { return closeTab(id, true); }); }, Promise.resolve());
    fechou.then(function () {
      if (esp.pasta && esp.pasta !== app.folder) setFolder(esp.pasta, true);
      settings.layoutDirecao = esp.direcao || 'h';
      settings.layoutProporcao = esp.proporcao || 0.5;
      return openPaths(esp.abas.filter(function (c) { return !tabByPath(c); }));
    }).then(function () {
      // Ordem das abas como foi guardada; fixadas de volta.
      var ordem = esp.abas.map(function (c) { return c.toLowerCase(); });
      app.tabs.sort(function (a, b) {
        var ia = a.path ? ordem.indexOf(a.path.toLowerCase()) : -1, ib = b.path ? ordem.indexOf(b.path.toLowerCase()) : -1;
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      var fix = (esp.fixadas || []).map(function (c) { return c.toLowerCase(); });
      app.tabs.forEach(function (tb) { if (tb.path) tb.fixada = fix.indexOf(tb.path.toLowerCase()) !== -1; tb.grupo = 1; });
      var dois = (esp.grupo2 || []).map(function (c) { return c.toLowerCase(); });
      app.tabs.forEach(function (tb) { if (tb.path && dois.indexOf(tb.path.toLowerCase()) !== -1) tb.grupo = 2; });
      var emp = esp.empilhados || [];
      if (abasDoGrupo(2).length && abasDoGrupo(1).length) {
        app.grupos = [{ id: 1, ativa: abasDoGrupo(1)[0].id, empilhado: emp.indexOf(1) !== -1 },
          { id: 2, ativa: abasDoGrupo(2)[0].id, empilhado: emp.indexOf(2) !== -1 }];
      } else {
        app.tabs.forEach(function (tb) { tb.grupo = 1; });
        app.grupos = [{ id: 1, ativa: app.tabs.length ? app.tabs[0].id : null, empilhado: emp.indexOf(1) !== -1 }];
      }
      var alvo = esp.ativa && tabByPath(esp.ativa);
      if (alvo) {
        var g = grupoPorId(grupoDe(alvo));
        if (g) g.ativa = alvo.id;
        app.grupoAtivo = grupoDe(alvo);
        selectTab(alvo.id);
      } else renderAll();
      app.espacoAtual = esp.nome;
      persist();
      toast(ficaram ? t('Espaco "{nome}" aberto. {n} aba(s) com alteracao por salvar continuaram abertas.', { nome: esp.nome, n: ficaram })
        : t('Espaco "{nome}" aberto.', { nome: esp.nome }), ficaram ? 'warn' : 'ok', ficaram ? 3600 : 1800);
    });
  }

  // ======================================= nota do dia, nota unica, modelos
  //
  // Os plugins centrais do Obsidian que fazem sentido sem cofre, relativos a
  // pasta aberta: nota diaria, nota unica (nome com data e hora), modelos com
  // {{title}}, {{date}} e {{time}} (com formato: {{date:DD/MM/YYYY}}), nota
  // aleatoria e extrair a selecao para uma nota nova (o trecho vira [[link]]).

  function formataData(fmt, d) {
    d = d || new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var idioma = (window.MarkPadI18n && window.MarkPadI18n.atual && window.MarkPadI18n.atual()) || 'pt-BR';
    var nomeDe = function (o) { try { return new Intl.DateTimeFormat(idioma, o).format(d); } catch (e) { return ''; } };
    var mapa = {
      YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(2),
      MMMM: nomeDe({ month: 'long' }), MMM: nomeDe({ month: 'short' }).replace(/\.$/, ''),
      MM: p2(d.getMonth() + 1), M: d.getMonth() + 1, DD: p2(d.getDate()), D: d.getDate(),
      dddd: nomeDe({ weekday: 'long' }), ddd: nomeDe({ weekday: 'short' }).replace(/\.$/, ''),
      HH: p2(d.getHours()), H: d.getHours(), mm: p2(d.getMinutes()), ss: p2(d.getSeconds())
    };
    return String(fmt).replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g, function (m, literal) {
      return literal !== undefined ? literal : String(mapa[m]);
    });
  }

  function aplicaModelo(texto, titulo) {
    var agora = new Date();
    return String(texto)
      .replace(/\{\{\s*title\s*\}\}/gi, titulo)
      .replace(/\{\{\s*date(?::([^}]*))?\s*\}\}/gi, function (_, f) { return formataData(f ? f.trim() : 'YYYY-MM-DD', agora); })
      .replace(/\{\{\s*time(?::([^}]*))?\s*\}\}/gi, function (_, f) { return formataData(f ? f.trim() : 'HH:mm', agora); });
  }

  function caminhoNaPasta(rel) {
    var raiz = String(app.folder || '').replace(/[\\/]+$/, '');
    var r = String(rel || '').replace(/^[\\/]+|[\\/]+$/g, '').replace(/\//g, '\\');
    return r ? raiz + '\\' + r : raiz;
  }

  function precisaDePasta() {
    if (app.folder) return true;
    toast(t('Abra uma pasta antes (Ctrl+Shift+O): a nota nova fica nela.'), 'warn', 3200);
    return false;
  }

  function conteudoDoModelo(rel, titulo) {
    if (!rel) return Promise.resolve('');
    var caminho = caminhoNaPasta(rel);
    if (!/\.(md|markdown|txt)$/i.test(caminho)) caminho += '.md';
    return bridge.call('readFile', { path: caminho })
      .then(function (d) { return aplicaModelo(d.content || '', titulo); })
      .catch(function () { toast(t('Modelo nao encontrado: ') + rel, 'warn', 3000); return ''; });
  }

  /** Cria (ou so abre, se ja existe) e deixa a nota nova destravada. */
  function criaEAbre(dir, nome, conteudo) {
    return bridge.call('createNote', { dir: dir, name: nome, content: conteudo || '' }).then(function (r) {
      return openPath(r.path).then(function (tab) {
        if (tab && !r.exists) {
          setLocked(tab, false, true);
          app.linksEm = 0;
          refreshTree();
        }
        return tab;
      });
    }).catch(function (err) {
      toast(t('Nao consegui criar a nota: ') + ((err && err.message) || err), 'error', 4000);
    });
  }

  function abreNotaDeHoje() {
    if (!precisaDePasta()) return;
    var nome = formataData(settings.notaDiariaFormato || 'YYYY-MM-DD');
    var dir = caminhoNaPasta(settings.notaDiariaPasta);
    var caminho = dir + '\\' + nome + '.md';
    var aberta = tabByPath(caminho);
    if (aberta) { selectTab(aberta.id); return; }
    bridge.call('pathInfo', { path: caminho }).then(function (info) {
      if (info && info.exists) return openPath(caminho);
      return conteudoDoModelo(settings.notaDiariaModelo, nome).then(function (txt) {
        return criaEAbre(dir, nome + '.md', txt);
      });
    }).catch(function (err) { toast(t('Nao consegui criar a nota: ') + ((err && err.message) || err), 'error', 4000); });
  }

  function novaNotaUnica() {
    if (!precisaDePasta()) return;
    var nome = formataData(settings.notaUnicaFormato || 'YYYYMMDDHHmm');
    criaEAbre(caminhoNaPasta(settings.notaUnicaPasta), nome + '.md', '');
  }

  function editorDaAba(msg) {
    var tab = activeTab();
    if (tab && !tab.locked && ed && ed.aba === tab) return tab;
    toast(msg || t('Destrave a nota (Ctrl+E) para editar.'), 'warn', 2400);
    return null;
  }

  function insereModelo() {
    var tab = editorDaAba(t('Destrave a nota (Ctrl+E) para inserir um modelo.'));
    if (!tab || !precisaDePasta()) return;
    var pasta = caminhoNaPasta(settings.modelosPasta || 'Modelos').toLowerCase() + '\\';
    openSwitcher({
      dica: t('Escolha o modelo'),
      vazio: t('Nenhum modelo na pasta {pasta}.', { pasta: settings.modelosPasta || 'Modelos' }),
      filtro: function (f) { return f.markdown && String(f.path).toLowerCase().indexOf(pasta) === 0; },
      escolhe: function (f) {
        bridge.call('readFile', { path: f.path }).then(function (d) {
          if (ed.aba !== tab) return;
          ed.trocaSelecao(aplicaModelo(d.content || '', semExtensao(tab.name)));
          ed.foco();
        }).catch(function (err) { toast(t('Nao consegui ler o modelo: ') + ((err && err.message) || err), 'error', 4000); });
      }
    });
  }

  function abreNotaAleatoria() {
    if (!precisaDePasta()) return;
    fileIndex().then(function (arquivos) {
      var atual = activeTab() && activeTab().path;
      var notas = arquivos.filter(function (f) { return f.markdown && !mesmoArquivo(f.path, atual); });
      if (!notas.length) { toast(t('Nenhuma outra nota na pasta.'), '', 1800); return; }
      openPath(notas[Math.floor(Math.random() * notas.length)].path);
    });
  }

  function extraiSelecao() {
    var tab = editorDaAba();
    if (!tab) return;
    var sel = ed.textoSelecionado();
    if (!sel.trim()) { toast(t('Selecione o trecho que vai virar nota.'), 'warn', 2000); return; }
    var dir = tab.path ? tab.path.replace(/[\\/][^\\/]*$/, '') : app.folder;
    if (!dir) { precisaDePasta(); return; }
    var sugestao = sel.trim().split('\n')[0].replace(/^#+\s*/, '').replace(/[\\/:*?"<>|#^\[\]]/g, '').slice(0, 60).trim();
    promptDialog(t('Extrair para uma nota nova'), t('Nome da nota nova (fica na mesma pasta desta):'), { value: sugestao }).then(function (nome) {
      if (!nome) return;
      nome = nome.trim().replace(/\.md$/i, '');
      bridge.call('createNote', { dir: dir, name: nome + '.md', content: sel }).then(function (r) {
        if (r.exists) { toast(t('Ja existe uma nota com esse nome nesta pasta.'), 'warn', 2600); return; }
        if (ed.aba === tab) ed.trocaSelecao('[[' + nome + ']]');
        app.linksEm = 0;
        refreshTree();
        toast(t('Trecho extraido para {nome}.', { nome: nome }), 'ok', 2200);
      }).catch(function (err) { toast(t('Nao consegui criar a nota: ') + ((err && err.message) || err), 'error', 4000); });
    });
  }

  // ------------------------------------------------------------- anexos
  //
  // Imagem colada vira "Pasted image AAAAMMDDHHmmss.png" na pasta da nota e
  // entra como ![[...]] no cursor; imagem, audio, video ou PDF solto do
  // Explorer em cima do editor e copiado para a pasta da nota (se ja nao
  // estiver na pasta aberta) e entra no ponto da queda. Como o Obsidian.

  var RE_ANEXO = /\.(png|jpe?g|gif|webp|bmp|avif|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|pdf)$/i;

  function carimboAgora() {
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  function lerBase64(arquivo) {
    return new Promise(function (ok, falha) {
      var leitor = new FileReader();
      leitor.onload = function () { ok(String(leitor.result).replace(/^data:[^,]*,/, '')); };
      leitor.onerror = function () { falha(leitor.error || new Error('leitura')); };
      leitor.readAsDataURL(arquivo);
    });
  }

  function abaParaAnexo() {
    var tab = ed && ed.aba;
    if (!tab || tab.locked || tab !== activeTab()) return null;
    if (!tab.path) {
      toast(t('Salve a nota antes: o anexo vai para a pasta dela.'), 'warn', 3200);
      return null;
    }
    return tab;
  }

  function insereAnexos(tab, nomes) {
    if (!nomes.length || !ed || ed.aba !== tab) return;
    ed.trocaSelecao(nomes.map(function (n) { return '![[' + n + ']]'; }).join('\n'));
    ed.foco();
    app.linksEm = 0;   // o indice precisa ver o arquivo novo
    toast(nomes.length === 1 ? t('Anexo gravado: {nome}', { nome: nomes[0] }) : t('{n} anexos gravados.', { n: nomes.length }), 'ok', 2200);
  }

  function colaImagens(arquivos) {
    var tab = abaParaAnexo();
    if (!tab) return;
    var tipos = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' };
    var carimbo = carimboAgora();
    Promise.all(arquivos.map(function (f, i) {
      return lerBase64(f).then(function (b64) {
        var nome = f.name && f.name !== 'image.png' && RE_ANEXO.test(f.name)
          ? f.name
          : 'Pasted image ' + carimbo + (arquivos.length > 1 ? '-' + (i + 1) : '') + '.' + (tipos[f.type] || 'png');
        return bridge.call('saveAttachment', { notePath: tab.path, name: nome, data: b64 });
      });
    })).then(function (res) {
      insereAnexos(tab, res.map(function (r) { return r.name; }));
    }).catch(function (err) {
      toast(t('Nao consegui gravar o anexo: ') + ((err && err.message) || err), 'error', 4000);
    });
  }

  function dentroDaPastaAberta(caminho) {
    var raiz = String(app.folder || '').replace(/[\\/]+$/, '').toLowerCase();
    return !!raiz && String(caminho).toLowerCase().indexOf(raiz + '\\') === 0;
  }

  /** Arquivos soltos do Explorer (o WPF manda o ponto da queda). */
  function arquivosSoltos(d) {
    var caminhos = (d && d.paths) || [];
    var tab = activeTab();
    var alvo = document.elementFromPoint(d.x || 0, d.y || 0);
    var noEditor = !!(ed && tab && !tab.locked && ed.aba === tab && alvo && ed.view.dom.contains(alvo));
    var anexos = noEditor ? caminhos.filter(function (c) { return RE_ANEXO.test(c); }) : [];
    var resto = caminhos.filter(function (c) { return anexos.indexOf(c) < 0; });
    if (resto.length) openPaths(resto);
    if (!anexos.length) return;
    var aba = abaParaAnexo();
    if (!aba) return;
    ed.cursorNoPonto(d.x, d.y);
    Promise.all(anexos.map(function (c) {
      // Ja esta na pasta aberta: so o link, pelo nome (o indice acha).
      if (dentroDaPastaAberta(c)) return { name: baseName(c) };
      return bridge.call('copyAttachment', { notePath: aba.path, source: c });
    })).then(function (res) {
      insereAnexos(aba, res.map(function (r) { return r.name; }));
    }).catch(function (err) {
      toast(t('Nao consegui gravar o anexo: ') + ((err && err.message) || err), 'error', 4000);
    });
  }

  /** Desenha um trecho do documento como o leitor desenharia (blocos do ao vivo). */
  function renderTrecho(el, src, tipo, abaDona, trocar) {
    var tab = abaDona || (ed && ed.aba) || activeTab();
    if (tipo === 'propriedades' && settings.showProperties === false) {
      el.classList.add('cm-trecho-cru');
      el.textContent = src;
      return;
    }
    if (tipo === 'propriedades' && trocar && formularioDePropriedades(el, src, trocar)) return;
    var r = window.MarkPadMarkdown.render(src, { loadRemoteImages: settings.loadRemoteImages });
    el.innerHTML = r.html;
    window.MarkPadMarkdown.sanitizeDom(el);
    if (tipo === 'imagem' || tipo === 'embed-inline') {
      // A imagem no meio da linha nao leva o <p> de fora.
      var p = el.firstElementChild;
      if (p && p.tagName === 'P' && el.children.length === 1) {
        while (p.firstChild) el.insertBefore(p.firstChild, p);
        el.removeChild(p);
      }
    }
    montaIconesCallout(el);
    renderMatematica(el);
    if (tipo === 'propriedades') renderProperties(el, r.frontmatter);
    var caixas = el.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < caixas.length; i++) caixas[i].disabled = true;
    if (!tab) return;
    resolveLocalImages(el, tab);
    resolveMidia(el, tab);
    resolveNoteEmbeds(el, tab, [String(tab.path || '').toLowerCase()]);
    wirePreviewClicks(el, tab);
    marcaLinksQuebrados(el, tab);
  }

  // ------------------------------------------------- propriedades editaveis
  //
  // O formulario de propriedades do Obsidian no modo ao vivo: uma linha por
  // propriedade, lista (tags, aliases) em pilulas, caixa para true/false e
  // calendario para data. So o YAML simples (chave: valor e listas) vira
  // formulario; o resto (objeto aninhado, texto em bloco, comentario) fica no
  // texto, como antes. O bloco so e reescrito quando algo muda de verdade, e
  // so quando o foco sai do formulario (ou com Enter), para a digitacao nao
  // perder o campo no meio.

  function tiraAspas(v) {
    v = String(v).trim();
    if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }

  function comAspasSePreciso(v) {
    v = String(v);
    if (v === '' || /^[\[\]{}#&*!|>'"%@`,?:-]/.test(v) || /:\s|\s#/.test(v) || /^\s|\s$/.test(v)) {
      return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return v;
  }

  function lePropriedades(src) {
    var linhas = String(src).replace(/\r\n?/g, '\n').split('\n');
    if (linhas.length < 2 || !/^---\s*$/.test(linhas[0])) return null;
    var fim = linhas.length - 1;
    while (fim > 0 && !/^(---|\.\.\.)\s*$/.test(linhas[fim])) fim--;
    if (fim <= 0) return null;
    var props = [], atual = null;
    for (var i = 1; i < fim; i++) {
      var l = linhas[i];
      if (!l.trim()) continue;
      var item = /^\s*-\s+(.*)$/.exec(l) || /^\s*-$/.exec(l);
      if (item && atual && (atual.tipo === 'lista' || atual.valor === '')) {
        atual.tipo = 'lista';
        if (item[1] != null && item[1].trim()) atual.itens.push(tiraAspas(item[1]));
        continue;
      }
      var kv = /^([^\s#:\-][^:]*?)\s*:(?:\s+(.*))?$/.exec(l);
      if (!kv || /^\s/.test(l)) return null;
      var v = (kv[2] || '').trim();
      if (/^[|>]/.test(v) || /^\{/.test(v) || /\s#/.test(v)) return null;
      atual = { chave: kv[1].trim(), valor: tiraAspas(v), tipo: 'texto', itens: [] };
      if (/^\[.*\]$/.test(v)) {
        atual.tipo = 'lista';
        atual.itens = v.slice(1, -1).split(',').map(function (x) { return tiraAspas(x); }).filter(Boolean);
      } else if (/^(true|false)$/i.test(v)) atual.tipo = 'caixa';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) atual.tipo = 'data';
      else if (/^-?\d+(?:\.\d+)?$/.test(v)) atual.tipo = 'numero';
      else if (/^(tags?|aliases?|cssclasses)$/i.test(atual.chave) && v === '') atual.tipo = 'lista';
      props.push(atual);
    }
    return props;
  }

  function escrevePropriedades(props) {
    var out = ['---'];
    props.forEach(function (p) {
      var chave = String(p.chave || '').trim();
      if (!chave) return;
      if (p.tipo === 'lista') {
        out.push(chave + ':');
        p.itens.forEach(function (it) { out.push('  - ' + comAspasSePreciso(it)); });
      } else if (p.tipo === 'caixa') out.push(chave + ': ' + (p.valor === true || p.valor === 'true' ? 'true' : 'false'));
      else if (p.tipo === 'numero' || p.tipo === 'data') out.push(chave + ': ' + String(p.valor).trim());
      else out.push(chave + ': ' + (p.valor === '' ? '' : comAspasSePreciso(p.valor)).replace(/: $/, ':'));
    });
    out.push('---');
    return out.join('\n').replace(/: \n/g, ':\n');
  }

  function formularioDePropriedades(el, src, trocar) {
    var props = lePropriedades(src);
    if (!props) return false;
    var mudou = false;

    function aplica() {
      if (!mudou) return;
      mudou = false;
      var novo = escrevePropriedades(props);
      if (novo !== src) trocar(novo);
    }

    var caixa = document.createElement('div');
    caixa.className = 'properties prop-form';
    var cab = document.createElement('div');
    cab.className = 'properties-head prop-form-cab';
    var rot = document.createElement('span');
    rot.textContent = t('Propriedades');
    cab.appendChild(rot);
    var conta = document.createElement('span');
    conta.className = 'properties-count';
    conta.textContent = String(props.length);
    cab.appendChild(conta);
    caixa.appendChild(cab);

    var corpo = document.createElement('div');
    corpo.className = 'properties-body';

    function campoTexto(cls, valor, aoMudar, tipo) {
      var i = document.createElement('input');
      i.type = tipo || 'text';
      i.className = cls;
      i.value = valor == null ? '' : String(valor);
      i.spellcheck = false;
      i.addEventListener('input', function () { aoMudar(i.value); mudou = true; });
      i.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); aplica(); }
        if (ev.key === 'Escape') { ev.preventDefault(); i.blur(); }
        ev.stopPropagation();
      });
      return i;
    }

    props.forEach(function (p, idx) {
      var linha = document.createElement('div');
      linha.className = 'property prop-linha';
      var chave = campoTexto('prop-chave', p.chave, function (v) { p.chave = v; });
      chave.setAttribute('aria-label', t('Nome da propriedade'));
      linha.appendChild(chave);

      var valor = document.createElement('div');
      valor.className = 'property-value prop-valor';
      if (p.tipo === 'lista') {
        p.itens.forEach(function (it, j) {
          var pil = document.createElement('span');
          pil.className = 'prop-pilula';
          pil.textContent = it;
          var x = document.createElement('button');
          x.type = 'button';
          x.className = 'prop-tira';
          x.textContent = '\u00d7';
          x.setAttribute('aria-label', t('Remover {item}', { item: it }));
          x.onclick = function () { p.itens.splice(j, 1); mudou = true; aplica(); };
          pil.appendChild(x);
          valor.appendChild(pil);
        });
        var novo = campoTexto('prop-novo-item', '', function () {});
        novo.placeholder = t('acrescentar');
        novo.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter' && ev.key !== ',') return;
          ev.preventDefault();
          var v = novo.value.trim().replace(/^#/, '');
          if (!v) { aplica(); return; }
          p.itens.push(v);
          mudou = true;
          aplica();
        });
        valor.appendChild(novo);
      } else if (p.tipo === 'caixa') {
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'prop-caixa';
        cb.checked = /^true$/i.test(String(p.valor));
        cb.onchange = function () { p.valor = cb.checked ? 'true' : 'false'; mudou = true; aplica(); };
        valor.appendChild(cb);
      } else {
        valor.appendChild(campoTexto('prop-texto', p.valor, function (v) { p.valor = v; }, p.tipo === 'data' ? 'date' : 'text'));
      }
      linha.appendChild(valor);

      var tira = document.createElement('button');
      tira.type = 'button';
      tira.className = 'prop-apaga';
      tira.title = t('Remover propriedade');
      tira.textContent = '\u00d7';
      tira.onclick = function () { props.splice(idx, 1); mudou = true; aplica(); };
      linha.appendChild(tira);
      corpo.appendChild(linha);
    });
    caixa.appendChild(corpo);

    var mais = document.createElement('button');
    mais.type = 'button';
    mais.className = 'prop-acrescenta';
    mais.textContent = '+ ' + t('Adicionar propriedade');
    mais.onclick = function () {
      var n = 1, nome = t('propriedade');
      while (props.some(function (p) { return p.chave === (n === 1 ? nome : nome + n); })) n++;
      props.push({ chave: n === 1 ? nome : nome + n, valor: '', tipo: 'texto', itens: [] });
      mudou = true;
      aplica();
    };
    caixa.appendChild(mais);

    // Sair do formulario grava o que foi digitado.
    caixa.addEventListener('focusout', function (ev) {
      if (ev.relatedTarget && caixa.contains(ev.relatedTarget)) return;
      setTimeout(aplica, 0);
    });
    el.appendChild(caixa);
    return true;
  }

  /*
   * O editor pergunta, a cada desenho, se o [[alvo]] existe. Sem indice pronto
   * a resposta e "nao sei" (null, desenha como existente) e o indice e pedido;
   * quando chega, o editor redesenha.
   */
  function wikiExisteNoIndice(alvoBruto) {
    if (!app.folder || !window.MarkPadLinkIndex) return null;
    var velho = !app.idxPronto || app.idxProntoDe !== app.folder || (Date.now() - (app.idxProntoEm || 0)) > 30000;
    if (velho && !app.idxPedindo) {
      app.idxPedindo = true;
      Promise.resolve(indiceLinks()).then(function (idx) {
        app.idxPedindo = false;
        if (!idx) return;
        var mudou = app.idxPronto !== idx;
        app.idxPronto = idx;
        app.idxProntoDe = app.folder;
        app.idxProntoEm = Date.now();
        if (mudou && ed) ed.atualiza();
      }, function () { app.idxPedindo = false; });
    }
    var idx = app.idxPronto;
    if (!idx || app.idxProntoDe !== app.folder) return null;
    var alvo = String(alvoBruto || '').split('#')[0].trim();
    if (!alvo) return true;
    var tab = ed && ed.aba;
    var origem = relNaPasta((tab && tab.path) || joinPath(app.folder, 'sem titulo.md'));
    return !!window.MarkPadLinkIndex.resolve(idx, { tipo: 'wiki', alvo: alvo }, origem);
  }

  function hojeIso(comHora) {
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var dia = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    return comHora ? dia + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : dia;
  }

  /*
   * Os comandos de formatacao do editor: o mesmo conjunto no clique direito e
   * na barra (digitar / no comeco da linha ou depois de um espaco, como os
   * "slash commands" do Obsidian).
   */
  function comandosDoEditor() {
    function c(grupo, label, icon, acao, atalho) { return { grupo: grupo, label: label, icon: icon, acao: acao, atalho: atalho }; }
    return [
      c('fmt', t('Negrito'), 'bold', function () { ed.envolve('**', '**'); }, 'Ctrl+B'),
      c('fmt', t('Itálico'), 'italic', function () { ed.envolve('*', '*'); }, 'Ctrl+I'),
      c('fmt', t('Riscado'), 'strike', function () { ed.envolve('~~', '~~'); }),
      c('fmt', t('Destaque'), 'highlight', function () { ed.envolve('==', '=='); }, 'Ctrl+Shift+H'),
      c('fmt', t('Código'), 'code', function () { ed.envolve('`', '`'); }),
      c('par', t('Título 1'), 'heading', function () { ed.prefixoLinha('# '); }),
      c('par', t('Título 2'), 'heading', function () { ed.prefixoLinha('## '); }),
      c('par', t('Título 3'), 'heading', function () { ed.prefixoLinha('### '); }),
      c('par', t('Texto normal'), 'text', function () { ed.prefixoLinha(''); }),
      c('par', t('Citação'), 'quote', function () { ed.prefixoLinha('> '); }),
      c('par', t('Lista'), 'list', function () { ed.prefixoLinha('- '); }),
      c('par', t('Lista numerada'), 'list', function () { ed.prefixoLinha('', { ordenada: true }); }),
      c('par', t('Tarefa'), 'todo', function () { ed.prefixoLinha('- [ ] '); }),
      c('ins', t('Link'), 'link', function () { ed.insere('[%s](%c)'); }, 'Ctrl+K'),
      c('ins', t('Link interno'), 'link', function () { ed.insere('[[%c]]'); }),
      c('ins', t('Tabela'), 'table', function () { ed.insere('\n| %c | Coluna |\n|:--|:--|\n| | |\n'); }),
      c('ins', t('Bloco de código'), 'code', function () { ed.insere('\n```%c\n\n```\n'); }),
      c('ins', t('Bloco matemático'), 'sigma', function () { ed.insere('\n$$\n%c\n$$\n'); }),
      c('ins', t('Destaque (callout)'), 'info', function () { ed.insere('\n> [!note] %c\n> \n'); }),
      c('ins', t('Tag'), 'hash', function () { ed.insere('#%c'); }),
      c('ins', t('Régua horizontal'), 'minus', function () { ed.insere('\n---\n%c'); }),
      c('ins', t('Nota de rodapé'), 'note', function () { ed.insere('[^%c]'); }),
      c('ins', t('Data de hoje'), 'clock', function () { ed.insere(hojeIso(false) + '%c'); }),
      c('ins', t('Data e hora'), 'clock', function () { ed.insere(hojeIso(true) + '%c'); })
    ];
  }

  /** Clique direito no editor: area de transferencia e a formatacao do Obsidian. */
  function menuDoEditor(x, y) {
    var tab = activeTab();
    if (!ed || !tab || tab.locked) return;
    var sel = ed.textoSelecionado();
    var itens = [
      { label: t('Recortar'), icon: 'copy', disabled: !sel, action: function () {
          navigator.clipboard.writeText(sel).then(function () { ed.trocaSelecao(''); ed.foco(); });
        } },
      { label: t('Copiar'), icon: 'copy', disabled: !sel, action: function () { navigator.clipboard.writeText(sel); } },
      { label: t('Colar'), icon: 'copy', action: function () {
          navigator.clipboard.readText().then(function (txt) {
            ed.trocaSelecao(textoColado(ed.textoSelecionado(), txt));
            ed.foco();
          });
        } },
      { label: t('Selecionar tudo'), action: function () { ed.seleciona(0, ed.texto().length, { rolar: false }); ed.foco(); } }
    ];
    var titulos = { fmt: t('Formatar'), par: t('Parágrafo'), ins: t('Inserir') };
    var grupo = null;
    comandosDoEditor().forEach(function (cmd) {
      if (cmd.grupo !== grupo) { itens.push('-', { label: titulos[cmd.grupo], header: true }); grupo = cmd.grupo; }
      itens.push({ label: cmd.label, icon: cmd.icon, key: cmd.atalho, action: cmd.acao });
    });
    itens.push('-', { label: t('Travar edicao'), icon: 'lock', key: 'Ctrl+E', action: toggleLock });
    showMenu(itens, x, y);
  }

  // Dentro de codigo, propriedades e HTML nao se sugere nada.
  function emCodigo(state, pos) {
    var no = window.CM.language.syntaxTree(state).resolveInner(pos, -1);
    for (; no; no = no.parent) {
      if (/^(FencedCode|CodeBlock|InlineCode|CodeText|Frontmatter|HTMLBlock|CommentBlock|MathInline|MathBloco)$/.test(no.name)) return true;
    }
    return false;
  }

  /** Digitar / depois de espaco (ou no comeco da linha) abre os comandos de formatacao. */
  function fonteComandosBarra(contexto) {
    var m = contexto.matchBefore(/(?:^|\s)\/[^\s\/]*$/);
    if (!m || emCodigo(contexto.state, contexto.pos)) return null;
    var de = m.from + m.text.lastIndexOf('/') + 1;
    return {
      from: de,
      validFor: /^[^\s\/]*$/,
      options: comandosDoEditor().map(function (cmd) {
        return {
          label: cmd.label,
          detail: cmd.atalho,
          apply: function (view, completion, a, b) {
            view.dispatch({ changes: { from: a - 1, to: b, insert: '' }, userEvent: 'input.complete' });
            cmd.acao();
          }
        };
      })
    };
  }

  /** Digitar #algo lista as tags da pasta (ou das abas abertas), as mais usadas primeiro. */
  function fonteTags(contexto) {
    var m = contexto.matchBefore(/(?:^|[\s(])#[^\s#!"$%&'()*+,.:;<=>?@^`{|}~\[\]\\]*$/);
    if (!m || emCodigo(contexto.state, contexto.pos)) return null;
    var de = m.from + m.text.lastIndexOf('#') + 1;
    if (de === contexto.pos && !contexto.explicit && /^\s*#$/.test(contexto.state.doc.lineAt(contexto.pos).text.slice(0, contexto.pos - contexto.state.doc.lineAt(contexto.pos).from))) return null;
    return Promise.resolve(tagIndex()).then(function (tags) {
      if (!tags || !tags.length) return null;
      var lista = tags.slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
      return {
        from: de,
        validFor: /^[^\s#]*$/,
        options: lista.map(function (tg, i) {
          return { label: tg.tag, detail: String(tg.count || ''), boost: Math.max(-99, -i), apply: tg.tag + ' ' };
        })
      };
    });
  }

  var outlineTimer = null;
  function renderOutlineSoon() {
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(renderOutline, 400);
  }

  function wireResizers() {
    var sideResizer = $('sidebarResizer');
    sideResizer.addEventListener('mousedown', function (e) {
      e.preventDefault();
      sideResizer.classList.add('is-dragging');
      var startX = e.clientX;
      var startW = $('sidebar').offsetWidth;

      function move(ev) {
        var w = Math.max(150, Math.min(520, startW + ev.clientX - startX));
        document.documentElement.style.setProperty('--sidebar-width', w + 'px');
        settings.sidebarWidth = w;
      }
      function up() {
        sideResizer.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    var resizerDireita = $('sidebarResizerDireita');
    resizerDireita.addEventListener('mousedown', function (e) {
      e.preventDefault();
      resizerDireita.classList.add('is-dragging');
      var startX = e.clientX;
      var startW = $('sidebarDireita').offsetWidth;
      function move(ev) {
        var w = Math.max(180, Math.min(560, startW - (ev.clientX - startX)));
        document.documentElement.style.setProperty('--sidebar-direita-width', w + 'px');
        settings.sidebarDireitaWidth = w;
      }
      function up() {
        resizerDireita.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist();
        if (settings.sidebarPaneDireita === 'graph') desenhaGrafo();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    var splitter = $('splitDivider');
    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      splitter.classList.add('is-dragging');
      var view = $('editingView');

      function move(ev) {
        var rect = view.getBoundingClientRect();
        var ratio = Math.max(0.15, Math.min(0.85, (ev.clientX - rect.left) / rect.width));
        settings.splitRatio = ratio;
        $('editorPane').style.flex = '0 0 ' + (ratio * 100) + '%';
        $('previewPane').style.flex = '1';
      }
      function up() {
        splitter.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // =============================================================== inicio

  /**
   * Traduz o que veio escrito no index.html.
   *
   * Roda antes de qualquer render, quando a pagina ainda e so a marcacao
   * estatica — por isso da para varrer tudo sem distinguir o que e texto de
   * tela do que e conteudo: conteudo ainda nao existe. Uma frase sem traducao
   * atravessa intacta, entao varrer demais nao estraga nada.
   *
   * O original fica guardado em `data-pt`: trocar de idioma no meio da sessao
   * chama isto de novo, e sem o original a segunda passada traduziria o texto
   * ja traduzido (que nao e chave de nada) e a tela travaria no primeiro
   * idioma escolhido.
   */
  var estaticoMapeado = false;

  function traduzirEstatico() {
    var raiz = $('app');
    if (!raiz) return;

    ['title', 'placeholder', 'aria-label'].forEach(function (attr) {
      var guardado = 'data-pt-' + attr;
      // Depois da primeira passada so os atributos ja marcados continuam
      // elegiveis — pelo mesmo motivo dos nos de texto, e com um alvo pior:
      // `title` dinamico carrega caminho de arquivo e linha de resultado de
      // busca, ou seja conteudo do usuario. Uma nota cuja linha fosse
      // exatamente "Abrir" teria a dica traduzida para "Open".
      var seletor = estaticoMapeado ? '[' + guardado + ']' : '[' + attr + '], [' + guardado + ']';
      Array.prototype.forEach.call(raiz.querySelectorAll(seletor), function (el) {
        if (!el.hasAttribute(guardado)) el.setAttribute(guardado, el.getAttribute(attr) || '');
        el.setAttribute(attr, t(el.getAttribute(guardado)));
      });
    });

    var passeio = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null);
    var no;
    while ((no = passeio.nextNode())) {
      // Depois da primeira passada a pagina ja tem conteudo de documento
      // dentro de #app, e conteudo nao se traduz — uma nota que diga so
      // "Abrir" viraria "Open" no meio do texto do usuario. Entao a partir
      // dai so os nos marcados na primeira passada (a marcacao estatica)
      // continuam elegiveis.
      if (estaticoMapeado && no.__pt === undefined) continue;
      var bruto = no.__pt !== undefined ? no.__pt : no.nodeValue;
      if (!bruto || !bruto.trim()) continue;
      no.__pt = bruto;
      // O espaco em volta e da diagramacao, nao da frase: traduzir o miolo e
      // devolver as bordas mantem o espacamento do HTML como estava.
      var antes = bruto.match(/^\s*/)[0];
      var depois = bruto.match(/\s*$/)[0];
      no.nodeValue = antes + t(bruto.trim()) + depois;
    }
    estaticoMapeado = true;
  }

  function applySettings() {
    window.MarkPadI18n.definir(settings.language);
    traduzirEstatico();
    applyTheme();
    applyFontSizes();
    applyAnimations();
    renderQuickBar();
    renderTreeFilter();
    document.documentElement.style.setProperty('--sidebar-width', settings.sidebarWidth + 'px');
    document.body.classList.toggle('sidebar-hidden', !settings.sidebarVisible);
    document.body.classList.toggle('wrap-on', settings.wordWrap);
    $('editorPane').style.flex = $('previewPane').hidden ? '' : '0 0 ' + (settings.splitRatio * 100) + '%';
    distribuiPaineis();
    document.body.classList.toggle('sidebar-direita-hidden', settings.sidebarDireitaVisivel === false);
    document.documentElement.style.setProperty('--sidebar-direita-width', (settings.sidebarDireitaWidth || 260) + 'px');
  }

  function boot() {
    wireUi();
    instalaDicas();

    $('updateClose').onclick = function () {
      atualizacao.escondida = true;
      desenhaBarraAtualizacao();
    };

    bridge.on('updateProgress', function (d) {
      atualizacao.baixado = (d && d.done) || 0;
      if (d && d.total) atualizacao.total = d.total;
      if (atualizacao.estado === 'baixando') desenhaBarraAtualizacao();
    });

    bridge.on('openPaths', function (paths) { openPaths(paths); });
    bridge.on('filesDropped', arquivosSoltos);
    // Segunda instancia com --monitorar: o C# manda os caminhos depois de abrir.
    bridge.on('monitorPaths', function (paths) {
      var alvos = (paths || []).map(function (p) { return p.toLowerCase(); });
      setTimeout(function () {
        app.tabs.forEach(function (aba) {
          if (aba.path && alvos.indexOf(aba.path.toLowerCase()) !== -1 && !aba.monitorar) alternaMonitorar(aba, true);
        });
      }, 800);
    });

    bridge.on('fileChanged', function (data) {
      invalidaLinks();
      var tab = tabByPath(data.path);
      if (!tab) return;
      processaMudanca(tab, data.kind, data.newPath);
    });

    // Voltar a janela: confere a data dos abertos (no maximo uma vez por segundo).
    var ultimaConferencia = 0;
    bridge.on('appActivated', function () {
      var agora = Date.now();
      if (agora - ultimaConferencia < 1000) return;
      ultimaConferencia = agora;
      confereDisco();
    });

    bridge.on('requestClose', function () {
      var dirty = app.tabs.filter(function (aba) {
        return aba.content !== aba.savedContent || (aba.apagadoNoDisco && !!aba.content);
      });

      if (!dirty.length) { bridge.call('confirmClose', {}); return; }

      // Opcao do Notepad++ (desligada por padrao): sair sem perguntar, com o
      // texto guardado como rascunho, que volta sozinho na proxima abertura.
      if (settings.fecharGuardando) {
        Promise.all(dirty.map(function (aba) {
          clearTimeout(backupTimers[aba.id]);
          return bridge.call('writeBackup', {
            path: chaveDeRascunho(aba), name: aba.name, content: aba.content,
            baseMtime: aba.path ? (aba.mtime || 0) : 0
          }).catch(function () {});
        })).then(function () { bridge.call('confirmClose', {}); });
        return;
      }

      var names = dirty.map(function (t) { return escapeText(t.name); }).join(', ');
      dialog(t('Fechar o MarkPad?'),
        t('Ha alteracoes nao salvas em: <strong>{nomes}</strong>.', { nomes: names }),
        [{ label: t('Sair sem salvar'), value: 'discard', cls: 'danger' },
         { label: t('Cancelar'), value: null },
         { label: t('Salvar e sair'), value: 'save', cls: 'primary' }]
      ).then(function (choice) {
        if (choice === null) return;
        if (choice === 'discard') {
          // Sair sem salvar e descartar: os rascunhos dessas abas vao junto,
          // senao a proxima abertura oferecia restaurar o que se mandou jogar fora.
          Promise.all(dirty.map(dropBackup)).then(function () { bridge.call('confirmClose', {}); });
          return;
        }

        var chain = Promise.resolve(true);
        dirty.forEach(function (aba) { chain = chain.then(function () { return saveTab(aba, false, { ignoraTrava: true }); }); });
        chain.then(function () { bridge.call('confirmClose', {}); });
      });
    });

    bridge.call('loadSettings', {}).then(function (json) {
      if (json) {
        try { Object.assign(settings, JSON.parse(json)); } catch (e) {}
      }
      applySettings();
      renderRecent();
      return bridge.call('ready', {});
    }).then(function (info) {
      app.version = info.version;
      app.dataRoot = info.dataRoot;
      app.exePath = info.exePath;
      app.associated = info.associated;
      app.isDefault = info.isDefault;
      app.currentHandler = info.handler;
      app.portable = info.portable;
      // Janela extra ("Nova janela") ou com outra aberta: a sessao e as copias
      // de seguranca sao da outra. Restaurar duplicaria as abas dela, e
      // "Descartar" no aviso das copias apagaria o rascunho vivo de la.
      app.janelaExtra = !!info.janelaExtra;
      app.outrasJanelas = !!info.outrasJanelas;

      var toOpen = (info.openPaths || []).slice();
      if (!toOpen.length && !app.janelaExtra && settings.restoreSession && settings.session) {
        toOpen = settings.session.slice(0, 12);
      }

      if (settings.lastFolder) setFolder(settings.lastFolder, true);

      renderAll();
      var monitorar = (info.monitorar || []).map(function (p) { return p.toLowerCase(); });
      return openPaths(toOpen).then(app.janelaExtra ? null : restauraFixadas).then(function () {
        if (!app.janelaExtra && !(info.openPaths || []).length) restauraGrupos();
        else if ((settings.gruposEmpilhados || []).indexOf(1) !== -1) { grupoPorId(1).empilhado = true; renderAll(); }
        app.tabs.forEach(function (aba) {
          if (aba.path && monitorar.indexOf(aba.path.toLowerCase()) !== -1) alternaMonitorar(aba, true);
        });
      });
    }).then(function () {
      // Depois de restaurar a sessão, para o diálogo não competir com a
      // abertura dos arquivos.
      if (app.janelaExtra || app.outrasJanelas) return;
      return offerBackups();
    }).then(function () {
      // Por ultimo, e sem segurar nada: se a rede estiver fora, o MarkPad ja
      // abriu e o usuario nem fica sabendo que houve uma tentativa. Download
      // pendente tem prioridade — nao adianta anunciar o que ja esta no disco.
      return conferePendente().then(function (p) {
        if (!p) return verificaAtualizacao(false);
      });
    }).catch(function (err) {
      applySettings();
      renderAll();
      console.error(err);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (settings.theme === 'system') applyTheme();
    });

    // Sem navegacao por arrastar dentro da pagina: quem trata drop e o host.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      // Texto solto num campo de texto ou no editor (o [[link]] arrastado da
      // arvore) e o proprio campo que insere; arquivo de fora continua com o host.
      var campo = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' ||
        (e.target.closest && e.target.closest('.cm-content')));
      if (campo && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
      e.preventDefault();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
