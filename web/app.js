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
  var MAX_HIGHLIGHT_LINES = 20000;

  // ============================================================== ponte

  var bridge = (function () {
    var seq = 1;
    var pending = new Map();
    var listeners = Object.create(null);

    if (!window.chrome || !window.chrome.webview) {
      return {
        call: function () { return Promise.reject(new Error('ponte indisponivel')); },
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
      else slot.reject(new Error(msg.error || 'falha desconhecida'));
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
    lockOnOpen: true,
    confirmUnlock: false,
    showSource: false,
    showPreview: true,
    wordWrap: true,
    lineNumbers: true,
    fontSize: 16,
    editorFontSize: 14,
    wideLines: false,
    autoSave: false,
    loadRemoteImages: false,
    sidebarVisible: true,
    sidebarWidth: 260,
    sidebarPane: 'files',
    splitRatio: 0.5,
    restoreSession: true,
    treeOnlyMarkdown: true,
    treeSort: 'nome-asc',
    treeFoldersFirst: true,
    warnNonMarkdown: true,
    animations: true,
    showProperties: true,
    quickBarVisible: true,
    quickBarLabels: false,
    quickBar: ['open', 'openFolder', 'new', 'save', 'close', 'lock', 'find'],
    checkUpdates: true,
    recent: [],
    lastFolder: null,
    session: []
  };

  var settings = Object.assign({}, DEFAULTS);
  var app = {
    tabs: [],
    activeId: null,
    nextId: 1,
    folder: null,
    treeOpen: Object.create(null),
    treeFilter: '',
    indice: null,
    indiceDe: null,
    exePath: '',
    associated: false,
    find: { open: false, query: '', caseSensitive: false, regex: false, index: 0, total: 0 },
    folderSearch: { caseSensitive: false, regex: false },
    closing: false
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

  function scheduleBackup(tab) {
    if (!tab || !tab.path) return;

    clearTimeout(backupTimers[tab.id]);
    backupTimers[tab.id] = setTimeout(function () {
      if (tab.content === tab.savedContent) {
        bridge.call('dropBackup', { path: tab.path }).catch(function () {});
        return;
      }
      bridge.call('writeBackup', {
        path: tab.path, name: tab.name, content: tab.content
      }).catch(function () {});
    }, 2000);
  }

  function dropBackup(tab) {
    if (!tab || !tab.path) return;
    clearTimeout(backupTimers[tab.id]);
    bridge.call('dropBackup', { path: tab.path }).catch(function () {});
  }

  /** Ao iniciar, oferece de volta o que ficou pendente da sessão anterior. */
  function offerBackups() {
    return bridge.call('listBackups', {}).then(function (res) {
      var lista = (res && res.backups) || [];
      if (!lista.length) return;

      var nomes = lista.slice(0, 6).map(function (b) { return escapeText(b.name); }).join(', ');
      var extra = lista.length > 6 ? ' e mais ' + (lista.length - 6) : '';

      return dialog(
        'Alterações não salvas da sessão anterior',
        'O MarkPad guardou o texto de <strong>' + nomes + extra + '</strong> ' +
        'que não chegou a ser gravado.<br><br>' +
        'O arquivo em disco continua intacto. Se restaurar, o texto volta como estava ' +
        'e você decide se salva por cima.',
        [{ label: 'Descartar', value: false, cls: 'danger' },
         { label: 'Restaurar', value: true, cls: 'primary' }]
      ).then(function (sim) {
        if (!sim) {
          lista.forEach(function (b) { bridge.call('dropBackup', { path: b.path }).catch(function () {}); });
          return;
        }
        return restoreBackups(lista);
      });
    }).catch(function () {});
  }

  function restoreBackups(lista) {
    var cadeia = Promise.resolve();

    lista.forEach(function (b) {
      cadeia = cadeia.then(function () {
        if (!b.fileExists) {
          // Arquivo sumiu do disco: vira aba sem caminho, para não gravar
          // por engano num lugar que o usuário já removeu.
          var solto = makeTab({ name: b.name, content: b.content });
          solto.locked = false;
          app.tabs.push(solto);
          return;
        }
        return doOpenPath(b.path, {}).then(function (tab) {
          if (!tab) return;
          tab.content = b.content;
          tab.locked = false;
          invalidateLineStatus(tab);
        }).catch(function () {});
      });
    });

    return cadeia.then(function () {
      renderAll();
      toast('Texto restaurado. Salve com Ctrl+S para gravar no arquivo.', 'warn', 6000);
    });
  }

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      settings.session = app.tabs.filter(function (t) { return t.path; }).map(function (t) { return t.path; });
      settings.lastFolder = app.folder;
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
        var problema = opts.validate ? opts.validate(texto) : (texto ? null : 'Digite alguma coisa.');
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
      cancelar.textContent = 'Cancelar';
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
      name: data.name || 'sem titulo',
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
      showPreview: settings.showPreview !== false,
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
    if (MARKDOWN_EXT.test(path)) return Promise.resolve(true);

    var nome = path.split(/[\\/]/).pop();
    var ext = (/\.([^.\\/]+)$/.exec(nome) || [])[1];

    return dialog(
      'Arquivo não identificado como markdown',
      '<strong>' + escapeText(nome) + '</strong>' +
      (ext ? ' tem extensão <code>.' + escapeText(ext) + '</code>, que não é markdown.'
           : ' não tem extensão.') +
      '<br><br>Ele será aberto como texto puro. Deseja mesmo abrir?',
      [{ label: 'Não', value: false }, { label: 'Sim', value: true, cls: 'primary' }],
      'Não exibir esta mensagem novamente'
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
      app.tabs.push(tab);
      selectTab(tab.id);
      bridge.call('watchFile', { path: data.path }).catch(function () {});
      addRecent(data.path);
      if (!app.folder && data.dir) setFolder(data.dir, true);
      if (opts.line) goToLine(opts.line);
      return tab;
    }).catch(function (err) {
      toast('Nao consegui abrir: ' + err.message, 'error', 5000);
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
    var tab = makeTab({ name: 'sem titulo.md', content: '' });
    tab.locked = false; // nota nova ja nasce editavel: e o unico caso obvio
    app.tabs.push(tab);
    selectTab(tab.id);
    setTimeout(function () { $('editorInput').focus(); }, 30);
  }

  function saveTab(tab, saveAs) {
    // Garante que o bloco em edicao ja esteja no documento antes de gravar.
    if (live) live.commit();
    tab = tab || activeTab();
    if (!tab) return Promise.resolve(false);

    if (tab.locked && !saveAs) {
      toast('Documento travado — nada foi alterado.', 'warn');
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
      return bridge.call('writeFile', {
        path: path,
        content: tab.content,
        encoding: tab.encoding,
        eol: tab.eol
      }).then(function (res) {
        var renamed = tab.path !== res.path;
        tab.path = res.path;
        tab.name = res.path.split(/[\\/]/).pop();
        tab.dir = res.path.replace(/[\\/][^\\/]*$/, '');
        tab.savedContent = tab.content;
        tab.mtime = res.mtime;
        tab.staleOnDisk = false;
        invalidateLineStatus(tab);   // o que era laranja vira verde
        dropBackup(tab);
        bridge.call('watchFile', { path: res.path }).catch(function () {});
        addRecent(res.path);
        if (renamed) refreshTree();
        renderTabs();
        renderHeader();
        renderViews();   // redesenha para as marcas laranjas virarem verdes
        renderStatus();
        toast('Salvo: ' + tab.name, 'ok', 1600);
        return true;
      });
    }).catch(function (err) {
      toast('Nao consegui salvar: ' + err.message, 'error', 6000);
      return false;
    });
  }

  function closeTab(id, force) {
    var idx = -1;
    for (var i = 0; i < app.tabs.length; i++) if (app.tabs[i].id === id) { idx = i; break; }
    if (idx === -1) return Promise.resolve(true);

    var tab = app.tabs[idx];
    var dirty = tab.content !== tab.savedContent;

    var decide = (dirty && !force)
      ? dialog('Alteracoes nao salvas',
          'O arquivo <strong>' + escapeText(tab.name) + '</strong> tem mudancas que ainda nao foram gravadas.',
          [{ label: 'Descartar', value: 'discard', cls: 'danger' },
           { label: 'Cancelar', value: null },
           { label: 'Salvar', value: 'save', cls: 'primary' }])
      : Promise.resolve('discard');

    return decide.then(function (choice) {
      if (choice === null) return false;
      var pre = choice === 'save' ? saveTab(tab) : Promise.resolve(true);
      return pre.then(function (ok) {
        if (!ok && choice === 'save') return false;

        if (tab.path) bridge.call('unwatchFile', { path: tab.path }).catch(function () {});
        dropBackup(tab);
        app.tabs.splice(idx, 1);

        if (app.activeId === id) {
          var next = app.tabs[Math.min(idx, app.tabs.length - 1)];
          app.activeId = next ? next.id : null;
        }
        renderAll();
        persist();
        return true;
      });
    });
  }

  function selectTab(id) {
    if (live) live.commit();
    var current = activeTab();
    if (current && current.id !== id) stashScroll(current);

    app.activeId = id;
    app.find.index = 0;
    renderAll();

    var tab = activeTab();
    if (tab && !tab.locked) restoreScroll(tab);
    persist();
  }

  function stashScroll(tab) {
    if (tab.locked) {
      tab.scrollTop = $('readingScroll').scrollTop;
    } else {
      var ta = $('editorInput');
      tab.scrollTop = ta.scrollTop;
      tab.selStart = ta.selectionStart;
      tab.selEnd = ta.selectionEnd;
    }
  }

  function restoreScroll(tab) {
    var ta = $('editorInput');
    ta.scrollTop = tab.scrollTop || 0;
    try { ta.setSelectionRange(tab.selStart || 0, tab.selEnd || 0); } catch (e) {}
    syncScroll();
  }

  function reloadFromDisk(tab) {
    tab = tab || activeTab();
    if (!tab || !tab.path) return;

    bridge.call('readFile', { path: tab.path }).then(function (data) {
      tab.content = data.content;
      tab.savedContent = data.content;
      tab.originContent = data.content;   // recarregar zera o histórico da sessão
      tab.encoding = data.encoding;
      tab.eol = data.eol;
      tab.mtime = data.mtime;
      tab.staleOnDisk = false;
      renderAll();
      toast('Recarregado do disco.', 'ok', 1500);
    }).catch(function (err) {
      toast('Falha ao recarregar: ' + err.message, 'error');
    });
  }

  // ============================================================== A TRAVA

  function setLocked(tab, locked, silent) {
    tab = tab || activeTab();
    if (!tab) return;
    if (tab.locked === locked) return;

    // Fecha o editor de bloco aberto antes de trocar de estado.
    if (live) live.commit();

    if (locked && tab.content !== tab.savedContent) {
      // Travar com mudanca pendente e legitimo: so avisa que continua pendente.
      toast('Travado. As alteracoes continuam por salvar (Ctrl+S).', 'warn', 3200);
    }

    if (!locked) stashReadingScroll(tab);
    else stashScroll(tab);

    tab.locked = locked;
    renderAll();

    if (!locked) {
      var ta = $('editorInput');
      ta.focus();
      restoreScroll(tab);
      if (tab.readOnlyOnDisk) {
        toast('Atencao: o arquivo esta marcado como somente leitura no disco.', 'warn', 5000);
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
      dialog('Liberar edicao?',
        'O documento <strong>' + escapeText(tab.name) + '</strong> passara a aceitar digitacao.',
        [{ label: 'Cancelar', value: false }, { label: 'Liberar', value: true, cls: 'primary' }]
      ).then(function (yes) { if (yes) setLocked(tab, false); });
      return;
    }

    setLocked(tab, !tab.locked);
  }

  // =========================================================== renderizacao

  function renderAll() {
    renderTabs();
    renderQuickBar();
    renderHeader();
    renderViews();
    renderStatus();
    renderOutline();
    markTreeActive();
  }

  function renderTabs() {
    var list = $('tabList');
    list.textContent = '';

    app.tabs.forEach(function (tab) {
      var el = document.createElement('div');
      el.className = 'tab' +
        (tab.id === app.activeId ? ' is-active' : '') +
        (!tab.locked ? ' is-unlocked' : '');
      el.title = tab.path || tab.name;

      var name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;
      el.appendChild(name);

      if (tab.content !== tab.savedContent) {
        var dot = document.createElement('span');
        dot.className = 'tab-dot';
        el.appendChild(dot);
      }

      var close = document.createElement('button');
      close.className = 'tab-close';
      var x = window.MarkPadIcons.build('x', 12);
      if (x) close.appendChild(x);
      close.onclick = function (e) { e.stopPropagation(); closeTab(tab.id); };
      el.appendChild(close);

      el.onclick = function () { selectTab(tab.id); };
      el.onmousedown = function (e) { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } };
      el.oncontextmenu = function (e) {
        e.preventDefault();
        showMenu(tabContextMenu(tab), e.clientX, e.clientY);
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
    $('dirtyDot').hidden = !dirty;

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
      badge.className = 'disk-badge warn';
      badge.textContent = 'mudou no disco';
      badge.style.cursor = 'pointer';
      badge.onclick = function () { reloadFromDisk(tab); };
    } else if (tab && tab.readOnlyOnDisk) {
      badge.hidden = false;
      badge.className = 'disk-badge';
      badge.textContent = 'somente leitura no disco';
      badge.onclick = null;
    } else {
      badge.hidden = true;
      badge.onclick = null;
    }

    var lock = $('btnLock');
    var statusLock = $('statusLock');
    var unlocked = tab && !tab.locked;

    lock.classList.toggle('is-locked', !unlocked);
    lock.classList.toggle('is-unlocked', !!unlocked);
    lock.disabled = !tab;
    lock.title = unlocked
      ? 'Edicao liberada — clique ou Ctrl+E para travar'
      : 'Edicao travada — clique ou Ctrl+E para liberar';
    $('lockText').textContent = unlocked ? 'Editando' : 'Travado';

    statusLock.classList.toggle('is-locked', !unlocked);
    statusLock.classList.toggle('is-unlocked', !!unlocked);
    var icon = statusLock.querySelector('.status-lock-icon');
    icon.setAttribute('data-icon', unlocked ? 'unlock' : 'lock');
    icon.textContent = '';
    var svg = window.MarkPadIcons.build(unlocked ? 'unlock' : 'lock', 12);
    if (svg) icon.appendChild(svg);
    $('statusLockText').textContent = unlocked ? 'Edicao liberada' : 'Somente leitura';

    document.body.classList.toggle('is-editing', !!unlocked);

    $('modeSwitch').hidden = !unlocked;
    $('btnToggleSource').classList.toggle('is-active', !!(tab && tab.showSource));
    $('btnTogglePreview').classList.toggle('is-active', !!(tab && tab.showSource && tab.showPreview));
    $('btnTogglePreview').disabled = !(tab && tab.showSource);
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

    var noLeitor = tab.locked || !tab.showSource;

    $('readingView').hidden = !noLeitor;
    $('editingView').hidden = noLeitor;

    if (noLeitor) {
      renderPreview($('preview'), tab);
      $('preview').classList.toggle('is-editable', !tab.locked);
      $('readingScroll').scrollTop = tab.readingScrollTop || 0;
      return;
    }

    var comLeitura = !!tab.showPreview;
    $('splitDivider').hidden = !comLeitura;
    $('previewPane').hidden = !comLeitura;

    var ta = $('editorInput');
    if (ta.value !== tab.content) ta.value = tab.content;
    applyWrap();
    renderEditorHighlight();
    if (comLeitura) renderPreview($('splitPreview'), tab);
  }

  // ------------------------------------------------------------ preview

  function renderPreview(container, tab) {
    var result;
    try {
      result = window.MarkPadMarkdown.render(tab.content, {
        loadRemoteImages: settings.loadRemoteImages,
        lineMap: true
      });
    } catch (err) {
      container.textContent = 'Falha ao renderizar: ' + err.message;
      return;
    }

    container.innerHTML = result.html;
    window.MarkPadMarkdown.sanitizeDom(container);
    container.__toc = result.toc;

    // Icones dos callouts: criados por nos, depois da peneira.
    var icons = container.querySelectorAll('.callout-icon[data-icon]');
    for (var i = 0; i < icons.length; i++) {
      var svg = window.MarkPadIcons.build(icons[i].getAttribute('data-icon'), 16);
      icons[i].textContent = '';
      if (svg) icons[i].appendChild(svg);
    }

    if (settings.showProperties !== false) renderProperties(container, result.frontmatter);
    liberaTarefas(container, tab);

    applyFolding(container, tab);
    marcaBlocosAlterados(container, tab);
    resolveLocalImages(container, tab);
    wirePreviewClicks(container, tab);

    if (container.id === 'preview' && app.find.open && app.find.query) applyFindHighlights();
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
    chevron.title = 'Recolher / expandir secao';
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

  function foldLists(container, tab) {
    var items = container.querySelectorAll('li');

    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var child = li.querySelector(':scope > ul, :scope > ol');
      if (!child) continue;

      var key = 'li:' + i + ':' + (li.textContent || '').slice(0, 40);
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

    if (!collapsed) {
      tab.folds = Object.create(null);
    } else {
      tab.folds = Object.create(null);
      var container = tab.locked ? $('preview') : $('splitPreview');
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
        bridge.call('resolveAsset', { basePath: base, src: img.getAttribute('data-src') })
          .then(function (res) {
            if (res && res.url) img.src = res.url;
            else showBrokenImage(img);
          })
          .catch(function () { showBrokenImage(img); });
      })(imgs[i]);
    }
  }

  function showBrokenImage(img) {
    var span = document.createElement('span');
    span.className = 'remote-image';
    span.textContent = 'imagem nao encontrada: ' + (img.getAttribute('data-src') || '');
    if (img.parentNode) img.parentNode.replaceChild(span, img);
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
    rotulo.textContent = 'Propriedades';
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
        vazio.textContent = 'vazio';
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
        ? 'Marcar ou desmarcar'
        : 'Destrave a edicao (Ctrl+E) para marcar';
    }
    container.classList.toggle('tasks-live', podeEditar);
  }

  /* Troca [ ] por [x] (e volta) na linha de origem, sem redesenhar a pagina. */
  function toggleTask(tab, linha, caixa) {
    if (!tab || tab.locked) return;

    var linhas = tab.content.split('\n');
    if (linha < 0 || linha >= linhas.length) return;

    var m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX~/-])(\][\s\S]*)$/.exec(linhas[linha]);
    if (!m) return;

    var marcado = m[2].toLowerCase() !== 'x';
    linhas[linha] = m[1] + (marcado ? 'x' : ' ') + m[3];
    tab.content = linhas.join('\n');

    if (caixa) {
      caixa.checked = marcado;
      var li = caixa.parentElement;
      if (li) li.classList.toggle('is-checked', marcado);
    }

    if (tab === activeTab() && tab.showSource) {
      $('editorInput').value = tab.content;
      renderEditorHighlight();
    }

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
        if (tab.locked) { e.preventDefault(); toast('Edicao travada. Ctrl+E para liberar.', '', 1600); return; }
        toggleTask(tab, parseInt(linha, 10), caixa);
        return;
      }

      var el = e.target.closest ? e.target.closest('[data-external],[data-file],[data-wikilink],[data-anchor],[data-copy],[data-remote],[data-tag]') : null;
      if (!el) return;
      e.preventDefault();

      if (el.hasAttribute('data-copy')) {
        var code = el.parentElement.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(function () {
            el.textContent = 'Copiado';
            setTimeout(function () { el.textContent = 'Copiar'; }, 1200);
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
        var target = container.querySelector('#' + CSS.escape(el.getAttribute('data-anchor')));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (el.hasAttribute('data-tag')) {
        openFolderSearch('#' + el.getAttribute('data-tag'));
        return;
      }

      if (el.hasAttribute('data-file')) {
        resolveAndOpen(el.getAttribute('data-file'), tab);
        return;
      }

      if (el.hasAttribute('data-wikilink')) {
        var wl = el.getAttribute('data-wikilink').split('#')[0];
        if (!wl) return;
        resolveAndOpen(/\.\w+$/.test(wl) ? wl : wl + '.md', tab);
      }
    };
  }

  function resolveAndOpen(relative, tab) {
    var base = tab.dir || app.folder;
    if (!base) { toast('Sem pasta de referencia para resolver o link.', 'warn'); return; }

    var candidate = /^[a-zA-Z]:[\\/]/.test(relative) || relative.charAt(0) === '\\'
      ? relative
      : base + '\\' + relative.replace(/\//g, '\\');

    bridge.call('pathInfo', { path: candidate }).then(function (info) {
      if (info.exists && info.kind === 'file') return openPath(info.path);
      if (app.folder) {
        // Nao achou ao lado: procura pelo nome na pasta aberta, como o Obsidian faz.
        return findByName(relative.split(/[\\/]/).pop());
      }
      toast('Arquivo nao encontrado: ' + relative, 'warn');
      return null;
    }).catch(function () { toast('Arquivo nao encontrado: ' + relative, 'warn'); });
  }

  function findByName(name) {
    return bridge.call('grepFolder', { root: app.folder, query: '', maxResults: 1 })
      .then(function () { toast('Arquivo nao encontrado: ' + name, 'warn'); });
  }

  // ------------------------------------------------------------- editor

  function renderEditorHighlight() {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    var lines = tab.content.split('\n');
    var tooBig = lines.length > MAX_HIGHLIGHT_LINES;

    document.body.classList.toggle('no-highlight', tooBig);
    document.body.classList.toggle('no-gutter', !settings.lineNumbers || tooBig);

    if (tooBig) { $('editorHighlight').textContent = ''; return; }

    var highlighted = window.MarkPadHighlight.highlightMarkdownSource(tab.content).split('\n');
    var estado = lineStatus(tab);
    var parts = new Array(lines.length);

    for (var i = 0; i < lines.length; i++) {
      var marca = estado[i] ? ' ch-' + estado[i] : '';
      parts[i] = '<div class="ed-row' + marca + '"><span class="ln">' + (i + 1) + '</span>' +
        (highlighted[i] !== undefined ? highlighted[i] : '') + '</div>';
    }

    $('editorHighlight').innerHTML = parts.join('');
    updateCurrentLine();
    syncScroll();
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

  function syncScroll() {
    var ta = $('editorInput');
    var hl = $('editorHighlight');
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    $('editorPane').style.setProperty('--scroll-x', ta.scrollLeft + 'px');
  }

  function currentLineIndex() {
    var ta = $('editorInput');
    var upto = ta.value.slice(0, ta.selectionStart);
    var n = 0;
    for (var i = 0; i < upto.length; i++) if (upto.charCodeAt(i) === 10) n++;
    return n;
  }

  var lastCurrentRow = null;
  function updateCurrentLine() {
    var rows = $('editorHighlight').children;
    var idx = currentLineIndex();
    if (lastCurrentRow === idx) return;
    if (lastCurrentRow !== null && rows[lastCurrentRow]) rows[lastCurrentRow].classList.remove('is-current');
    if (rows[idx]) rows[idx].classList.add('is-current');
    lastCurrentRow = idx;
  }

  function applyWrap() {
    var ta = $('editorInput');
    var want = settings.wordWrap ? 'soft' : 'off';
    document.body.classList.toggle('wrap-on', settings.wordWrap);
    if (ta.getAttribute('wrap') !== want) {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, st = ta.scrollTop;
      ta.setAttribute('wrap', want);
      ta.value = v;
      try { ta.setSelectionRange(s, e); } catch (err) {}
      ta.scrollTop = st;
    }
  }

  /** Edita via execCommand para nao quebrar o Ctrl+Z nativo do textarea. */
  function replaceRange(start, end, text) {
    var ta = $('editorInput');
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
      var v = ta.value;
      ta.value = v.slice(0, start) + text + v.slice(end);
      ta.setSelectionRange(start + text.length, start + text.length);
    }
    onEditorInput();
  }

  var highlightTimer = null;
  function onEditorInput() {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    tab.content = $('editorInput').value;

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

  function goToLine(line) {
    var tab = activeTab();
    if (!tab) return;

    if (tab.locked) {
      var target = $('preview').querySelector('[data-line="' + (line - 1) + '"]') ||
                   $('preview').querySelector('[data-line="' + line + '"]');
      if (target) target.scrollIntoView({ block: 'center' });
      return;
    }

    var lines = tab.content.split('\n');
    var offset = 0;
    for (var i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i].length + 1;

    var ta = $('editorInput');
    ta.focus();
    ta.setSelectionRange(offset, offset + (lines[line - 1] || '').length);
    var rowH = ta.scrollHeight / Math.max(1, lines.length);
    ta.scrollTop = Math.max(0, (line - 1) * rowH - ta.clientHeight / 2);
    syncScroll();
    updateCurrentLine();
  }

  // ------------------------------------------------------ status e sumario

  function renderStatus() {
    var tab = activeTab();

    $('statusPath').textContent = tab ? (tab.path || 'nao salvo') : '';
    $('statusPath').title = tab ? (tab.path || '') : '';

    if (!tab) {
      $('statusStats').textContent = '';
      $('statusCursor').textContent = '';
      $('statusEol').textContent = '';
      $('statusEncoding').textContent = '';
    } else {
      var text = tab.content;
      var lines = text.length ? text.split('\n').length : 0;
      var wordMatch = text.match(/[\wÀ-ÿ'-]+/g);
      var words = wordMatch ? wordMatch.length : 0;
      $('statusStats').textContent = lines + ' linhas · ' + words + ' palavras · ' + text.length + ' caracteres';

      if (!tab.locked) {
        var ta = $('editorInput');
        var upto = ta.value.slice(0, ta.selectionStart);
        var nl = upto.lastIndexOf('\n');
        var ln = upto.split('\n').length;
        var col = ta.selectionStart - nl;
        var sel = ta.selectionEnd - ta.selectionStart;
        $('statusCursor').textContent = 'Ln ' + ln + ', Col ' + col + (sel ? ' (' + sel + ' sel)' : '');
      } else {
        $('statusCursor').textContent = '';
      }

      $('statusEol').textContent = tab.eol === '\r\n' ? 'CRLF' : 'LF';
      $('statusEncoding').textContent = tab.encoding.toUpperCase();
    }

    $('statusWrap').textContent = settings.wordWrap ? 'Quebra: sim' : 'Quebra: nao';
    $('statusZoom').textContent = Math.round(settings.fontSize / 16 * 100) + '%';
    $('statusTheme').textContent = settings.theme === 'dark' ? 'Escuro'
      : settings.theme === 'light' ? 'Claro' : 'Sistema';
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

    if (!result.toc.length) {
      box.innerHTML = '<p class="pane-empty">Este documento nao tem titulos.</p>';
      return;
    }

    // Achata a lista de títulos numa árvore pelo nível, para poder recolher
    // uma seção inteira junto com as subseções.
    var raiz = { level: 0, filhos: [] };
    var pilha = [raiz];

    result.toc.forEach(function (h) {
      var no = { level: h.level, text: h.text, line: h.line, slug: h.slug, filhos: [] };
      while (pilha.length > 1 && pilha[pilha.length - 1].level >= h.level) pilha.pop();
      pilha[pilha.length - 1].filhos.push(no);
      pilha.push(no);
    });

    box.appendChild(desenhaNos(raiz.filhos, 0));
    marcaSecaoAtual();
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
      texto.textContent = no.text;
      linha.appendChild(texto);

      linha.onclick = function () { goToLine(no.line + 1); };
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

    var container = tab.locked || !tab.showSource ? $('preview') : null;
    if (!container) return;

    var scroller = $('readingScroll');
    var topo = scroller.getBoundingClientRect().top;
    var atual = null;

    var titulos = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
    for (var i = 0; i < titulos.length; i++) {
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
    $('folderName').textContent = path ? path.split(/[\\/]/).pop() : 'nenhuma pasta aberta';
    $('folderName').title = path || '';
    refreshTree();
    if (!quiet) persist();
  }

  function renderTreeFilter() {
    var b = $('btnTreeFilter');
    b.textContent = settings.treeOnlyMarkdown ? '.md' : 'tudo';
    b.classList.toggle('is-on', !!settings.treeOnlyMarkdown);
    b.title = settings.treeOnlyMarkdown
      ? 'Mostrando só markdown — clique para ver todos os arquivos'
      : 'Mostrando todos os arquivos — clique para ver só markdown';
  }

  var ORDENS = [
    { id: 'nome-asc',    rotulo: 'Nome (A a Z)' },
    { id: 'nome-desc',   rotulo: 'Nome (Z a A)' },
    { id: 'mod-desc',    rotulo: 'Modificado (recente primeiro)' },
    { id: 'mod-asc',     rotulo: 'Modificado (antigo primeiro)' },
    { id: 'criado-desc', rotulo: 'Criado (recente primeiro)' },
    { id: 'criado-asc',  rotulo: 'Criado (antigo primeiro)' }
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
      label: 'Pastas antes dos arquivos',
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
  function fileIndex() {
    if (!app.folder) return Promise.resolve([]);
    if (app.indiceDe === app.folder && app.indice) return app.indice;
    app.indiceDe = app.folder;
    app.indice = bridge.call('listFiles', { root: app.folder })
      .then(function (d) { return (d && d.files) || []; })
      .catch(function () { return []; });
    return app.indice;
  }

  function invalidateFileIndex() {
    app.indice = null;
    app.indiceDe = null;
  }

  /*
   * Nota fuzzy: as letras da consulta precisam aparecer na ordem, mas nao
   * coladas. Letra emendada na anterior vale mais, letra que abre palavra
   * vale mais ainda — e assim "cmd" acha "casa/meu-doc.md" acima de um
   * arquivo que so tem c, m e d espalhados.
   */
  function fuzzyScore(consulta, texto) {
    var q = String(consulta || '').toLowerCase();
    var t = String(texto || '').toLowerCase();
    if (!q) return 0;

    var pontos = 0, cursor = 0, ultimo = -2, seguidos = 0;

    for (var j = 0; j < q.length; j++) {
      var c = q.charAt(j);
      if (c === ' ') continue;
      var achou = t.indexOf(c, cursor);
      if (achou === -1) return -1;

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
    var q = String(consulta || '').toLowerCase().replace(/\s+/g, '');
    var t = String(texto || '');
    if (!q) { frag.appendChild(document.createTextNode(t)); return frag; }

    var baixo = t.toLowerCase();
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
    if (nota >= 0) return nota;
    nota = fuzzyScore(consulta, f.rel || f.path);
    return nota < 0 ? -1 : nota - 20;
  }

  function filtraArquivos(consulta, arquivos) {
    var achados = [];
    arquivos.forEach(function (f) {
      var nota = pontuaArquivo(consulta, f);
      if (nota < 0) return;
      achados.push({ f: f, nota: nota });
    });
    achados.sort(function (a, b) { return b.nota - a.nota || comparaNome(a.f, b.f); });
    return achados;
  }

  function pastaDe(f) {
    return String(f.rel || f.path || '').split(BARRA).slice(0, -1).join('/');
  }

  // ------------------------------------------------------ filtro do painel

  function toggleTreeFilter(force) {
    var linha = $('treeFilterRow');
    var campo = $('treeFilterInput');
    var abrir = force === undefined ? linha.hidden : force;

    linha.hidden = !abrir;
    $('btnTreeSearch').classList.toggle('is-on', abrir);

    if (abrir) {
      campo.focus();
      campo.select();
    } else if (app.treeFilter) {
      app.treeFilter = '';
      campo.value = '';
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
    carregando.textContent = 'Procurando...';
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
        vazio.textContent = 'Nenhum arquivo com esse nome.';
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
        mais.textContent = 'e mais ' + (achados.length - limite) + ' — refine o filtro.';
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
  function openSwitcher() {
    var box = $('switcher');
    var input = $('switcherInput');
    var listEl = $('switcherList');
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
        vazio.textContent = app.folder
          ? 'Nenhum arquivo com esse nome.'
          : 'Abra uma pasta para procurar por nome.';
        listEl.appendChild(vazio);
        return;
      }

      filtrados.forEach(function (f, i) {
        var el = document.createElement('div');
        el.className = 'palette-item' + (i === active ? ' is-active' : '');

        var ic = document.createElement('span');
        ic.className = 'pal-icon';
        var svg = window.MarkPadIcons.build('file-text', 15);
        if (svg) ic.appendChild(svg);
        el.appendChild(ic);

        var nome = document.createElement('span');
        nome.appendChild(marcaFuzzy(f.name, input.value.trim()));
        el.appendChild(nome);

        var pasta = pastaDe(f);
        if (pasta) {
          var sub = document.createElement('span');
          sub.className = 'pal-sub';
          sub.textContent = pasta;
          el.appendChild(sub);
        }

        el.onclick = function () { fechar(); openPath(f.path); };
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
        if (f) openPath(f.path);
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
          return arquivos.filter(function (f) { return !settings.treeOnlyMarkdown || f.markdown; });
        })
      : Promise.resolve((settings.recent || []).map(function (caminho) {
          return { name: caminho.split(BARRA).pop(), path: caminho, rel: caminho, markdown: true };
        }));

    pronto.then(function (arquivos) {
      if (box.hidden) return;
      fonte = arquivos;
      filtrados = linhas(input.value.trim());
      draw();
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
          ? 'Nenhum arquivo .md aqui. Toque no filtro acima para ver todos.'
          : 'Pasta vazia.';
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
        var ic = window.MarkPadIcons.build(entry.dir ? 'folder' : 'file-text', 13);
        if (ic) icon.appendChild(ic);
        row.appendChild(icon);

        var name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = entry.name;
        row.appendChild(name);

        container.appendChild(row);

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
            } else {
              children.hidden = false;
              twist.classList.add('is-open');
              app.treeOpen[entry.path] = true;
              if (!children.__loaded) { children.__loaded = true; buildTree(entry.path, children, depth + 1); }
            }
          };

          if (app.treeOpen[entry.path]) row.onclick();
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
      p.textContent = 'Nao consegui ler a pasta: ' + err.message;
      container.appendChild(p);
    });
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

  function setPane(name) {
    settings.sidebarPane = name;
    var tabs = document.querySelectorAll('.sidebar-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-pane') === name);
    }
    var panes = document.querySelectorAll('.pane');
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].getAttribute('data-pane') !== name;
    }
    persist();
  }

  // --------------------------------------------------- busca na pasta

  var folderSearchTimer = null;
  function runFolderSearch() {
    var query = $('folderSearchInput').value;
    var box = $('searchResults');

    if (!app.folder) {
      box.innerHTML = '<p class="pane-empty">Abra uma pasta primeiro.</p>';
      return;
    }
    if (!query) {
      box.innerHTML = '<p class="pane-empty">Digite para buscar em todos os arquivos da pasta.</p>';
      return;
    }

    box.innerHTML = '<p class="pane-empty">buscando...</p>';

    bridge.call('grepFolder', {
      root: app.folder,
      query: query,
      caseSensitive: app.folderSearch.caseSensitive,
      regex: app.folderSearch.regex,
      maxResults: 300
    }).then(function (res) {
      box.textContent = '';

      if (!res.results.length) {
        box.innerHTML = '<p class="pane-empty">Nenhum resultado.</p>';
        return;
      }

      var total = res.results.reduce(function (n, f) { return n + f.hits.length; }, 0);
      var head = document.createElement('p');
      head.className = 'pane-empty';
      head.textContent = total + ' ocorrencias em ' + res.results.length + ' arquivos' +
        (res.truncated ? ' (lista truncada)' : '');
      box.appendChild(head);

      res.results.forEach(function (file) {
        var group = document.createElement('div');
        group.className = 'search-file';

        var h = document.createElement('div');
        h.className = 'search-file-head';
        h.title = file.path;
        var nm = document.createElement('span');
        nm.textContent = file.relative;
        var ct = document.createElement('span');
        ct.className = 'search-file-count';
        ct.textContent = file.hits.length;
        h.appendChild(nm); h.appendChild(ct);
        h.onclick = function () { openPath(file.path); };
        group.appendChild(h);

        file.hits.forEach(function (hit) {
          var row = document.createElement('div');
          row.className = 'search-hit';
          row.title = hit.text;

          var ln = document.createElement('span');
          ln.className = 'hit-line';
          ln.textContent = hit.line;
          row.appendChild(ln);
          row.appendChild(document.createTextNode(hit.text.trim()));

          row.onclick = function () { openPath(file.path, { line: hit.line }); };
          group.appendChild(row);
        });

        box.appendChild(group);
      });
    }).catch(function (err) {
      box.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'pane-empty';
      p.textContent = 'Busca falhou: ' + err.message;
      box.appendChild(p);
    });
  }

  function openFolderSearch(prefill) {
    if (!settings.sidebarVisible) toggleSidebar(true);
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
    if (tab && !tab.locked) $('editorInput').focus();
  }

  function updateReplaceAvailability() {
    var tab = activeTab();
    var canEdit = tab && !tab.locked;
    $('replaceInput').disabled = !canEdit;
    $('btnReplace').disabled = !canEdit;
    $('btnReplaceAll').disabled = !canEdit;
    $('replaceInput').placeholder = canEdit ? 'Substituir' : 'Substituir (destrave para usar)';
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
      var from = tab.locked ? 0 : $('editorInput').selectionStart;
      app.find.index = 0;
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].start >= from) { app.find.index = i; break; }
      }
    } else {
      app.find.index = (app.find.index + step + matches.length) % matches.length;
    }

    $('findCount').textContent = (app.find.index + 1) + '/' + matches.length;

    if (tab.locked) {
      applyFindHighlights();
    } else {
      var hit = matches[app.find.index];
      var ta = $('editorInput');
      ta.focus();
      ta.setSelectionRange(hit.start, hit.end);
      scrollSelectionIntoView();
      updateCurrentLine();
    }
  }

  function scrollSelectionIntoView() {
    var tab = activeTab();
    var ta = $('editorInput');
    var before = ta.value.slice(0, ta.selectionStart).split('\n').length;
    var totalLines = Math.max(1, tab.content.split('\n').length);
    var rowH = ta.scrollHeight / totalLines;
    var y = (before - 1) * rowH;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - rowH * 2) {
      ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
    }
    syncScroll();
  }

  function clearFindHighlights() {
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
    replaceRange(hit.start, hit.end, $('replaceInput').value);
    setTimeout(function () { runFind(0); }, 0);
  }

  function replaceAll() {
    var tab = activeTab();
    if (!tab || tab.locked) return;

    var re = buildFindRegex();
    if (!re) return;

    var replacement = $('replaceInput').value;
    var count = 0;
    var next = tab.content.replace(re, function () { count++; return replacement; });
    if (!count) { toast('Nada para substituir.', 'warn'); return; }

    replaceRange(0, tab.content.length, next);
    toast(count + ' substituicoes.', 'ok');
    setTimeout(function () { runFind(0); }, 0);
  }

  // ======================================================== aparencia

  function applyTheme() {
    var dark = settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    bridge.call('setTitleBarTheme', { dark: dark }).catch(function () {});
  }

  function applyFontSizes() {
    document.documentElement.style.setProperty('--font-text-size', settings.fontSize + 'px');
    document.documentElement.style.setProperty('--editor-font-size', settings.editorFontSize + 'px');
    document.body.classList.toggle('wide-lines', settings.wideLines);
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

  // ======================================================= paleta / menu

  function commands() {
    var tab = activeTab();
    var unlocked = tab && !tab.locked;

    return [
      { id: 'open', label: 'Abrir arquivo...', key: 'Ctrl+O', icon: 'file-text', action: doOpen },
      { id: 'openFolder', label: 'Abrir pasta...', key: 'Ctrl+Shift+O', icon: 'folder-open', action: doOpenFolder },
      { id: 'new', label: 'Nova nota', key: 'Ctrl+N', icon: 'plus', action: newTab },
      { id: 'save', label: 'Salvar', key: 'Ctrl+S', icon: 'save', enabled: !!unlocked, action: function () { saveTab(); } },
      { id: 'saveAs', label: 'Salvar como...', key: 'Ctrl+Shift+S', icon: 'save', enabled: !!tab, action: function () { saveTab(activeTab(), true); } },
      { id: 'close', label: 'Fechar aba', key: 'Ctrl+W', icon: 'x', enabled: !!tab, action: function () { closeTab(app.activeId); } },
      { id: 'lock', label: unlocked ? 'Travar edicao' : 'Liberar edicao', key: 'Ctrl+E', icon: unlocked ? 'lock' : 'unlock', enabled: !!tab, action: toggleLock },
      { id: 'modeSource', label: 'Painel de codigo-fonte', key: 'Ctrl+Shift+C', icon: 'code', enabled: !!unlocked, checked: !!(tab && tab.showSource), action: toggleSource },
      { id: 'modeSplit', label: 'Painel de leitura ao lado', key: 'Ctrl+Shift+L', icon: 'columns', enabled: !!(unlocked && tab.showSource), checked: !!(tab && tab.showSource && tab.showPreview), action: togglePreviewPane },
      { id: 'find', label: 'Localizar no documento', key: 'Ctrl+F', icon: 'search', enabled: !!tab, action: openFind },
      { id: 'findFolder', label: 'Buscar na pasta', key: 'Ctrl+Shift+F', icon: 'search', action: function () { openFolderSearch(); } },
      { id: 'goto', label: 'Ir para a linha...', key: 'Ctrl+G', icon: 'list', enabled: !!tab, action: promptGoToLine },
      { id: 'foldAll', label: 'Recolher todas as secoes', key: 'Ctrl+Shift+-', icon: 'chevron-up', enabled: !!tab, action: function () { setAllFolds(true); } },
      { id: 'unfoldAll', label: 'Expandir todas as secoes', key: 'Ctrl+Shift++', icon: 'chevron-down', enabled: !!tab, action: function () { setAllFolds(false); } },
      { id: 'reload', label: 'Recarregar do disco', icon: 'refresh', enabled: !!(tab && tab.path), action: function () { reloadFromDisk(); } },
      { id: 'wrap', label: 'Quebra automatica de linha', key: 'Alt+Z', icon: 'wrap', checked: settings.wordWrap, action: function () { settings.wordWrap = !settings.wordWrap; applyWrap(); renderEditorHighlight(); renderStatus(); persist(); } },
      { id: 'properties', label: 'Mostrar propriedades', icon: 'list', checked: settings.showProperties !== false, action: function () { settings.showProperties = settings.showProperties === false; renderViews(); persist(); } },
      { id: 'gutter', label: 'Numeros de linha', icon: 'list', checked: settings.lineNumbers, action: function () { settings.lineNumbers = !settings.lineNumbers; renderEditorHighlight(); persist(); } },
      { id: 'wide', label: 'Largura total da linha', icon: 'columns', checked: settings.wideLines, action: function () { settings.wideLines = !settings.wideLines; applyFontSizes(); persist(); } },
      { id: 'lockOnOpen', label: 'Abrir sempre travado', icon: 'lock', checked: settings.lockOnOpen, action: function () { settings.lockOnOpen = !settings.lockOnOpen; persist(); toast(settings.lockOnOpen ? 'Novos arquivos abrirao travados.' : 'Novos arquivos abrirao destravados.', 'ok'); } },
      { id: 'confirmUnlock', label: 'Pedir confirmacao ao destravar', icon: 'unlock', checked: settings.confirmUnlock, action: function () { settings.confirmUnlock = !settings.confirmUnlock; persist(); } },
      { id: 'autoSave', label: 'Salvar automaticamente', icon: 'save', checked: settings.autoSave, action: function () { settings.autoSave = !settings.autoSave; persist(); toast(settings.autoSave ? 'Salvamento automatico ligado.' : 'Salvamento automatico desligado.', 'ok'); } },
      { id: 'remote', label: 'Carregar imagens da internet', icon: 'eye', checked: settings.loadRemoteImages, action: function () { settings.loadRemoteImages = !settings.loadRemoteImages; renderViews(); persist(); } },
      { id: 'treeFilter', label: 'Painel: só arquivos markdown', icon: 'folder', checked: settings.treeOnlyMarkdown, action: function () { settings.treeOnlyMarkdown = !settings.treeOnlyMarkdown; renderTreeFilter(); refreshTree(); persist(); } },
      { id: 'warnNonMd', label: 'Avisar ao abrir arquivo não-markdown', icon: 'warning', checked: settings.warnNonMarkdown, action: function () { settings.warnNonMarkdown = !settings.warnNonMarkdown; persist(); toast(settings.warnNonMarkdown ? 'O aviso volta a aparecer.' : 'Aviso desligado.', 'ok'); } },
      { id: 'theme', label: 'Alternar tema', icon: settings.theme === 'light' ? 'moon' : 'sun', action: cycleTheme },
      { id: 'zoomIn', label: 'Aumentar fonte', key: 'Ctrl++', icon: 'plus', action: function () { zoom(1); } },
      { id: 'zoomOut', label: 'Diminuir fonte', key: 'Ctrl+-', icon: 'x', action: function () { zoom(-1); } },
      { id: 'zoomReset', label: 'Fonte padrao', key: 'Ctrl+0', icon: 'refresh', action: function () { settings.fontSize = 16; settings.editorFontSize = 14; applyFontSizes(); renderStatus(); persist(); } },
      { id: 'sidebar', label: 'Painel lateral', key: 'Ctrl+\\', icon: 'panel-left', checked: settings.sidebarVisible, action: function () { toggleSidebar(); } },
      { id: 'rename', label: 'Renomear...', key: 'F2', icon: 'text', enabled: !!(tab && tab.path), action: function () { renameDoc(activeTab().path); } },
      { id: 'move', label: 'Mover para...', icon: 'folder', enabled: !!(tab && tab.path), action: function () { moveDoc(activeTab().path); } },
      { id: 'duplicate', label: 'Duplicar', icon: 'copy', enabled: !!(tab && tab.path), action: function () { duplicateDoc(activeTab().path); } },
      { id: 'openWith', label: 'Abrir no app padrao do Windows', icon: 'external', enabled: !!(tab && tab.path), action: function () { openWithDefaultApp(activeTab().path); } },
      { id: 'delete', label: 'Excluir arquivo...', icon: 'trash', enabled: !!(tab && tab.path), action: function () { deleteDoc(activeTab().path); } },
      { id: 'export', label: 'Exportar como HTML...', icon: 'external', enabled: !!tab, action: exportHtml },
      { id: 'print', label: 'Imprimir', key: 'Ctrl+Alt+P', icon: 'printer', enabled: !!tab, action: doPrint },
      { id: 'copyPath', label: 'Copiar caminho do arquivo', icon: 'copy', enabled: !!(tab && tab.path), action: function () { navigator.clipboard.writeText(activeTab().path); toast('Caminho copiado.', 'ok', 1200); } },
      { id: 'reveal', label: 'Mostrar no Explorer', icon: 'reveal', enabled: !!(tab && tab.path), action: function () { bridge.call('revealInExplorer', { path: activeTab().path }); } },
      { id: 'assoc', label: app.isDefault ? 'Remover o MarkPad como padrao de .md'
          : app.associated ? 'Definir o MarkPad como padrao de .md'
          : 'Abrir arquivos .md com o MarkPad',
        icon: 'link', checked: app.isDefault, action: toggleAssociation },
      { id: 'switcher', label: 'Abrir arquivo pelo nome...', key: 'Ctrl+P', icon: 'search', action: function () { openSwitcher(); } },
      { id: 'treeSearch', label: 'Filtrar arquivos por nome', icon: 'filter', action: function () { setPane('files'); toggleTreeFilter(true); } },
      { id: 'treeSort', label: 'Ordenar arquivos por...', icon: 'sort', action: function () { setPane('files'); var r = $('btnTreeSort').getBoundingClientRect(); treeSortMenu(r.right - 250, r.bottom + 4); } },
      { id: 'treeCollapse', label: 'Recolher todas as pastas', icon: 'chevrons-up', enabled: !!app.folder, action: collapseTree },
      { id: 'quickBar', label: 'Barra de acesso rapido', icon: 'command', checked: settings.quickBarVisible, action: function () { settings.quickBarVisible = !settings.quickBarVisible; renderQuickBar(); persist(); } },
      { id: 'settings', label: 'Configuracoes...', key: 'Ctrl+,', icon: 'settings', action: function () { openSettings(); } },
      { id: 'devtools', label: 'Ferramentas do desenvolvedor', icon: 'settings', action: function () { bridge.call('devTools', {}); } }
    ];
  }

  // ================================================ barra de acesso rapido

  /*
   * A barra nao tem lista propria de acoes: ela desenha comandos de
   * commands(). Assim um comando novo ja nasce disponivel aqui, e o estado
   * (habilitado/marcado) segue a aba ativa sem codigo extra.
   */
  var QUICK_DISPONIVEIS = [
    'open', 'openFolder', 'new', 'save', 'saveAs', 'close', 'reload',
    'lock', 'modeSource', 'modeSplit',
    'find', 'findFolder', 'switcher', 'goto', 'foldAll', 'unfoldAll',
    'treeSearch', 'treeSort', 'treeCollapse',
    'wrap', 'gutter', 'properties', 'wide', 'theme', 'sidebar',
    'export', 'print', 'copyPath', 'reveal',
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
    cfg.title = 'Configuracoes   Ctrl+,';
    var gear = window.MarkPadIcons.build('settings', 16);
    if (gear) cfg.appendChild(gear);
    cfg.onclick = function () { openSettings(); };
    bar.appendChild(cfg);

    bar.oncontextmenu = function (e) {
      e.preventDefault();
      showMenu([
        { label: 'Configurar a barra...', icon: 'settings', action: function () { openSettings('barra'); } },
        { label: 'Mostrar rotulos', icon: 'text', checked: settings.quickBarLabels,
          action: function () { settings.quickBarLabels = !settings.quickBarLabels; renderQuickBar(); persist(); } },
        '-',
        { label: 'Ocultar a barra', icon: 'x',
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

  function setBotao(ctl, rotulo, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn tiny' + (cls ? ' ' + cls : '');
    b.textContent = rotulo;
    b.onclick = fn;
    ctl.appendChild(b);
    return b;
  }

  function openSettings(abaInicial) {
    if ($('settingsBox')) return;

    var ABAS = [
      { id: 'aparencia',   nome: 'Aparencia',      icon: 'sun',       render: abaAparencia },
      { id: 'editor',      nome: 'Editor e trava', icon: 'lock',      render: abaEditor },
      { id: 'arquivos',    nome: 'Arquivos',       icon: 'folder',    render: abaArquivos },
      { id: 'barra',       nome: 'Barra rapida',   icon: 'command',   render: abaBarra },
      { id: 'atalhos',     nome: 'Atalhos',        icon: 'list',      render: abaAtalhos },
      { id: 'atualizacao', nome: 'Atualizacoes',   icon: 'refresh',   render: abaAtualizacao },
      { id: 'sobre',       nome: 'Sobre',          icon: 'info',      render: abaSobre }
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
    navTitle.textContent = 'Configuracoes';
    nav.appendChild(navTitle);

    var body = document.createElement('div');
    body.className = 'settings-body';

    var head = document.createElement('div');
    head.className = 'settings-head';

    var h = document.createElement('h2');
    head.appendChild(h);

    var btnFechar = document.createElement('button');
    btnFechar.className = 'icon-btn';
    btnFechar.title = 'Fechar (Esc)';
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
      persist();
    }

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
    setSecao(pai, 'Tema');
    setSelect(setLinha(pai, 'Tema da janela', 'O tema "sistema" segue a configuracao do Windows.'),
      [{ value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }, { value: 'system', label: 'Sistema' }],
      function () { return settings.theme; },
      function (v) { settings.theme = v; applyTheme(); renderStatus(); persist(); });

    setSecao(pai, 'Texto');
    setRange(setLinha(pai, 'Tamanho da fonte de leitura', 'Vale para o modo leitura e para o painel de leitura.'),
      12, 26, 1, 'px',
      function () { return settings.fontSize; },
      function (v) { settings.fontSize = v; applyFontSizes(); renderStatus(); persist(); });

    setRange(setLinha(pai, 'Tamanho da fonte do editor', 'Vale para o painel de codigo-fonte.'),
      10, 22, 1, 'px',
      function () { return settings.editorFontSize; },
      function (v) { settings.editorFontSize = v; applyFontSizes(); renderStatus(); persist(); });

    setToggle(setLinha(pai, 'Largura total da linha', 'Desligado, o texto fica numa coluna estreita, mais confortavel de ler.'),
      function () { return settings.wideLines; },
      function (v) { settings.wideLines = v; applyFontSizes(); persist(); });

    setSecao(pai, 'Janela');
    setToggle(setLinha(pai, 'Painel lateral visivel', 'Ctrl+\\ tambem alterna.'),
      function () { return settings.sidebarVisible; },
      function (v) { toggleSidebar(v); });

    setToggle(setLinha(pai, 'Mostrar propriedades', 'A ficha com o bloco --- do topo do documento, no modo leitura.'),
      function () { return settings.showProperties !== false; },
      function (v) { settings.showProperties = v; renderViews(); persist(); });

    setToggle(setLinha(pai, 'Animacoes', 'Desligue para uma interface instantanea, sem transicoes.'),
      function () { return settings.animations !== false; },
      function (v) { settings.animations = v; applyAnimations(); persist(); });
  }

  function abaEditor(pai) {
    setSecao(pai, 'A trava');
    setToggle(setLinha(pai, 'Abrir sempre travado', 'O jeito seguro: nenhum arquivo abre em modo de edicao.'),
      function () { return settings.lockOnOpen; },
      function (v) { settings.lockOnOpen = v; persist(); });

    setToggle(setLinha(pai, 'Pedir confirmacao ao destravar', 'Uma pergunta a mais antes de liberar a edicao.'),
      function () { return settings.confirmUnlock; },
      function (v) { settings.confirmUnlock = v; persist(); });

    setSecao(pai, 'Edicao');
    setToggle(setLinha(pai, 'Salvar automaticamente', 'Grava sozinho pouco depois de voce parar de digitar.'),
      function () { return settings.autoSave; },
      function (v) { settings.autoSave = v; persist(); });

    setToggle(setLinha(pai, 'Quebra automatica de linha', 'Alt+Z tambem alterna.'),
      function () { return settings.wordWrap; },
      function (v) { settings.wordWrap = v; applyWrap(); renderEditorHighlight(); renderStatus(); persist(); });

    setToggle(setLinha(pai, 'Numeros de linha', 'Na margem do painel de codigo-fonte.'),
      function () { return settings.lineNumbers; },
      function (v) { settings.lineNumbers = v; renderEditorHighlight(); persist(); });
  }

  function abaArquivos(pai) {
    setSecao(pai, 'Painel de arquivos');
    setToggle(setLinha(pai, 'Mostrar so arquivos markdown', 'Desligado, a arvore lista todos os arquivos da pasta.'),
      function () { return settings.treeOnlyMarkdown; },
      function (v) { settings.treeOnlyMarkdown = v; renderTreeFilter(); refreshTree(); persist(); });

    setSelect(setLinha(pai, 'Ordenar por', 'Vale para a arvore inteira. Tambem esta no botao de ordenar do painel.'),
      ORDENS.map(function (o) { return { value: o.id, label: o.rotulo }; }),
      function () { return settings.treeSort || 'nome-asc'; },
      function (v) { settings.treeSort = v; refreshTree(); persist(); });

    setToggle(setLinha(pai, 'Pastas antes dos arquivos', 'Desligado, pastas e arquivos entram na mesma ordenacao.'),
      function () { return settings.treeFoldersFirst !== false; },
      function (v) { settings.treeFoldersFirst = v; refreshTree(); persist(); });

    setSecao(pai, 'Ao abrir');
    setToggle(setLinha(pai, 'Avisar ao abrir arquivo nao-markdown', 'A confirmacao antes de abrir algo que nao parece markdown.'),
      function () { return settings.warnNonMarkdown; },
      function (v) { settings.warnNonMarkdown = v; persist(); });

    setToggle(setLinha(pai, 'Restaurar a sessao anterior', 'Reabre as abas e a pasta que estavam abertas.'),
      function () { return settings.restoreSession; },
      function (v) { settings.restoreSession = v; persist(); });

    setToggle(setLinha(pai, 'Carregar imagens da internet', 'Desligado, so imagens do proprio disco aparecem. Mais privado.'),
      function () { return settings.loadRemoteImages; },
      function (v) { settings.loadRemoteImages = v; renderViews(); persist(); });

    setSecao(pai, 'Windows');
    var assoc = setLinha(pai, 'Arquivos .md',
      app.isDefault ? 'O MarkPad e o aplicativo padrao para .md.'
        : app.associated ? 'O MarkPad aparece em "Abrir com". Ainda nao e o padrao.'
        : 'O MarkPad ainda nao esta registrado para .md.');
    setBotao(assoc, app.isDefault ? 'Remover' : app.associated ? 'Tornar padrao' : 'Registrar',
      function () { toggleAssociation(); });

    var dados = setLinha(pai, 'Pasta de dados',
      (app.portable ? 'Modo portatil. ' : '') + (app.dataRoot || ''));
    setBotao(dados, 'Abrir', function () {
      if (app.dataRoot) bridge.call('revealInExplorer', { path: app.dataRoot });
    });
  }

  function abaBarra(pai, ir) {
    setSecao(pai, 'A barra');
    setToggle(setLinha(pai, 'Mostrar a barra de acesso rapido', 'A fileira de botoes abaixo das abas.'),
      function () { return settings.quickBarVisible; },
      function (v) { settings.quickBarVisible = v; renderQuickBar(); persist(); });

    setToggle(setLinha(pai, 'Mostrar os rotulos', 'Com o nome ao lado do icone, a barra fica mais larga.'),
      function () { return settings.quickBarLabels; },
      function (v) { settings.quickBarLabels = v; renderQuickBar(); persist(); });

    setSecao(pai, 'Botoes');

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

      acao('x', 'Tirar da barra', function () {
        settings.quickBar.splice(i, 1);
        redesenhar();
      });

      lista.appendChild(item);
    });

    if (!settings.quickBar || !settings.quickBar.length) {
      var vazio = document.createElement('p');
      vazio.className = 'set-desc';
      vazio.textContent = 'A barra esta vazia. Escolha um comando abaixo para comecar.';
      lista.appendChild(vazio);
    }

    var faltando = QUICK_DISPONIVEIS.filter(function (id) {
      return byId[id] && (settings.quickBar || []).indexOf(id) < 0;
    });

    var addCtl = setLinha(pai, 'Adicionar um botao', faltando.length ? '' : 'Todos os comandos ja estao na barra.');
    if (faltando.length) {
      var sel = document.createElement('select');
      sel.className = 'set-select';
      var vazioOpt = document.createElement('option');
      vazioOpt.value = '';
      vazioOpt.textContent = 'escolha um comando';
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

    var padraoCtl = setLinha(pai, 'Restaurar o padrao', 'Volta a barra para os sete botoes originais.');
    setBotao(padraoCtl, 'Restaurar', function () {
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
    busca.placeholder = 'Filtrar comandos';
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
        key.textContent = c.key || 'sem atalho';
        row.appendChild(key);

        lista.appendChild(row);
      });

      if (!n) {
        var vazio = document.createElement('p');
        vazio.className = 'set-desc';
        vazio.textContent = 'Nenhum comando com esse nome.';
        lista.appendChild(vazio);
      }
    }

    busca.oninput = desenhar;
    desenhar();
    setTimeout(function () { busca.focus(); }, 0);
  }

  function abaAtualizacao(pai) {
    setSecao(pai, 'Versao');
    var v = setLinha(pai, 'Versao instalada',
      'MarkPad ' + (app.version || '?') + (app.portable ? ' (portatil)' : ''));
    setBotao(v, 'Ver as versoes', function () {
      bridge.call('openExternal', { url: 'https://github.com/NBN-PATRIC/markpad/releases' });
    });

    setSecao(pai, 'Atualizacao automatica');
    setToggle(setLinha(pai, 'Procurar atualizacoes ao abrir',
      'Consulta as versoes publicadas no GitHub quando o MarkPad inicia. Nada e baixado sem voce mandar.'),
      function () { return settings.checkUpdates !== false; },
      function (val) { settings.checkUpdates = val; persist(); });

    var nota = document.createElement('p');
    nota.className = 'set-desc set-note';
    nota.textContent = 'A consulta ainda nao esta ligada nesta versao — a preferencia acima ja fica guardada '
      + 'e passa a valer assim que a verificacao entrar. Ate la, use o botao "Ver as versoes".';
    pai.appendChild(nota);
  }

  function abaSobre(pai) {
    setSecao(pai, 'MarkPad');

    var p = document.createElement('p');
    p.className = 'set-desc';
    p.textContent = 'Leitor e editor de Markdown para Windows. Sem cofre, sem projeto, sem cerimonia: '
      + 'abre um arquivo e pronto. Todo arquivo abre travado — no estado travado nao existe campo de '
      + 'texto na tela, entao nao ha tecla que edite, apague ou digite nada.';
    pai.appendChild(p);

    setLinha(pai, 'Versao', 'MarkPad ' + (app.version || '?'));
    setLinha(pai, 'Instalacao', app.portable ? 'Portatil' : 'Instalado');
    setLinha(pai, 'Licenca', 'MIT');

    setSecao(pai, 'Links');
    var repo = setLinha(pai, 'Codigo-fonte', 'github.com/NBN-PATRIC/markpad');
    setBotao(repo, 'Abrir', function () {
      bridge.call('openExternal', { url: 'https://github.com/NBN-PATRIC/markpad' });
    });

    var bug = setLinha(pai, 'Relatar um problema', 'Abre a pagina de issues do repositorio.');
    setBotao(bug, 'Abrir', function () {
      bridge.call('openExternal', { url: 'https://github.com/NBN-PATRIC/markpad/issues' });
    });

    setSecao(pai, 'Diagnostico');
    var dev = setLinha(pai, 'Ferramentas do desenvolvedor', 'Console do WebView2, para investigar um erro.');
    setBotao(dev, 'Abrir', function () { bridge.call('devTools', {}); });
  }

  function applyAnimations() {
    document.body.classList.toggle('no-anim', settings.animations === false);
  }

  function toggleSource() {
    var tab = activeTab();
    if (!tab || tab.locked) return;
    if (live) live.commit();
    tab.showSource = !tab.showSource;
    settings.showSource = tab.showSource;
    renderHeader();
    renderViews();
    persist();
  }

  function togglePreviewPane() {
    var tab = activeTab();
    if (!tab || tab.locked || !tab.showSource) return;
    tab.showPreview = !tab.showPreview;
    settings.showPreview = tab.showPreview;
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

  function openPalette() {
    var list = commands().filter(function (c) { return c.enabled === undefined || c.enabled; });
    var filtered = list.slice();
    var active = 0;

    var box = $('palette');
    var input = $('paletteInput');
    var listEl = $('paletteList');

    function draw() {
      listEl.textContent = '';
      filtered.forEach(function (c, i) {
        var el = document.createElement('div');
        el.className = 'palette-item' + (i === active ? ' is-active' : '');

        var ic = document.createElement('span');
        ic.className = 'pal-icon';
        var svg = window.MarkPadIcons.build(c.icon || 'command', 15);
        if (svg) ic.appendChild(svg);
        el.appendChild(ic);

        var label = document.createElement('span');
        label.textContent = c.label;
        el.appendChild(label);

        if (c.checked) {
          var ck = document.createElement('span');
          ck.className = 'pal-sub';
          ck.textContent = 'ativo';
          el.appendChild(ck);
        }
        if (c.key) {
          var k = document.createElement('span');
          k.className = 'pal-key';
          k.textContent = c.key;
          el.appendChild(k);
        }

        el.onclick = function () { close(); c.action(); };
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
        close();
        if (c) c.action();
      }
    }

    input.value = '';
    input.oninput = function () {
      var q = input.value.toLowerCase().trim();
      filtered = q ? list.filter(function (c) { return c.label.toLowerCase().indexOf(q) !== -1; }) : list.slice();
      active = 0;
      draw();
    };

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
      entry('save'), entry('saveAs'), entry('reload'), '-',
      { label: 'Documento', header: true },
      entry('rename'), entry('move'), entry('duplicate'), '-',
      entry('export'), entry('print'), '-',
      entry('openWith'), entry('reveal'), entry('copyPath'), '-',
      entry('delete'), '-',
      { label: 'Navegar', header: true },
      entry('find'), entry('findFolder'), entry('goto'),
      entry('foldAll'), entry('unfoldAll'), '-',
      { label: 'Visual', header: true },
      entry('wrap'), entry('gutter'), entry('properties'), entry('wide'), entry('theme'), '-',
      { label: 'Trava', header: true },
      entry('lockOnOpen'), entry('confirmUnlock'), entry('autoSave'), '-',
      { label: 'Arquivos', header: true },
      entry('treeFilter'), entry('warnNonMd'), '-',
      entry('remote'), entry('assoc'), '-',
      entry('quickBar'), entry('settings')
    ], x, y);
  }

  /* O mesmo cardapio para qualquer arquivo do painel, arvore ou lista rasa. */
  function fileContextMenu(path) {
    return [
      { label: 'Abrir', icon: 'file-text', action: function () { openPath(path); } },
      '-',
      { label: 'Renomear...', icon: 'text', action: function () { renameDoc(path); } },
      { label: 'Mover para...', icon: 'folder', action: function () { moveDoc(path); } },
      { label: 'Duplicar', icon: 'copy', action: function () { duplicateDoc(path); } },
      '-',
      { label: 'Abrir no app padrao', icon: 'external', action: function () { openWithDefaultApp(path); } },
      { label: 'Mostrar no Explorer', icon: 'reveal', action: function () { bridge.call('revealInExplorer', { path: path }); } },
      { label: 'Copiar caminho', icon: 'copy', action: function () { navigator.clipboard.writeText(path); toast('Caminho copiado.', 'ok', 1200); } },
      '-',
      { label: 'Excluir arquivo...', icon: 'trash', action: function () { deleteDoc(path); } }
    ];
  }

  function tabContextMenu(tab) {
    return [
      { label: 'Salvar', icon: 'save', disabled: tab.locked, action: function () { saveTab(tab); } },
      { label: 'Fechar', icon: 'x', action: function () { closeTab(tab.id); } },
      { label: 'Fechar as outras', action: function () {
          app.tabs.slice().forEach(function (t) { if (t.id !== tab.id) closeTab(t.id); });
        } },
      '-',
      { label: 'Renomear...', icon: 'text', key: 'F2', disabled: !tab.path, action: function () { renameDoc(tab.path); } },
      { label: 'Mover para...', icon: 'folder', disabled: !tab.path, action: function () { moveDoc(tab.path); } },
      { label: 'Duplicar', icon: 'copy', disabled: !tab.path, action: function () { duplicateDoc(tab.path); } },
      '-',
      { label: 'Abrir no app padrao', icon: 'external', disabled: !tab.path, action: function () { openWithDefaultApp(tab.path); } },
      { label: 'Mostrar no Explorer', icon: 'reveal', disabled: !tab.path, action: function () { bridge.call('revealInExplorer', { path: tab.path }); } },
      { label: 'Copiar caminho', icon: 'copy', disabled: !tab.path, action: function () { navigator.clipboard.writeText(tab.path); toast('Caminho copiado.', 'ok', 1200); } },
      '-',
      { label: 'Excluir arquivo...', icon: 'trash', disabled: !tab.path, action: function () { deleteDoc(tab.path); } }
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
    refreshTree();
    renderAll();
    persist();
  }

  function falhaDoc(verbo) {
    return function (err) {
      if (err) toast('Nao consegui ' + verbo + ': ' + err.message, 'error', 6000);
    };
  }

  function renameDoc(path) {
    if (!path) return Promise.resolve();

    var nome = baseName(path);
    var ponto = nome.lastIndexOf('.');

    return promptDialog('Renomear arquivo', 'Ele continua na mesma pasta.', {
      value: nome,
      okLabel: 'Renomear',
      selectTo: ponto > 0 ? ponto : nome.length,
      validate: function (t) {
        if (!t) return 'Digite um nome.';
        if (/[\\/]/.test(t)) return 'Sem barras — para trocar de pasta, use "Mover para...".';
        if (/[<>:"|?*]/.test(t)) return 'O Windows nao aceita estes: < > : " | ? *';
        return null;
      }
    }).then(function (novo) {
      if (!novo || novo === nome) return null;
      return bridge.call('renameFile', { path: path, name: novo }).then(function (info) {
        var tab = tabByPath(path);
        if (tab) adotarCaminho(tab, info, path);
        else { dropRecent(path); refreshTree(); }
        toast('Agora se chama ' + info.name, 'ok');
      });
    }).catch(falhaDoc('renomear'));
  }

  function moveDoc(path) {
    if (!path) return Promise.resolve();

    return bridge.call('openFolderDialog', {}).then(function (dir) {
      if (!dir) return null;
      return bridge.call('moveFile', { path: path, dir: dir }).then(function (info) {
        var tab = tabByPath(path);
        if (tab) adotarCaminho(tab, info, path);
        else { dropRecent(path); refreshTree(); }
        toast('Movido para ' + info.dir, 'ok', 3200);
      });
    }).catch(falhaDoc('mover'));
  }

  function duplicateDoc(path) {
    if (!path) return Promise.resolve();

    return bridge.call('duplicateFile', { path: path }).then(function (info) {
      refreshTree();
      toast('Copia criada: ' + info.name, 'ok');
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
    return dialog('Excluir arquivo?',
      'O arquivo <strong>' + escapeText(nome) + '</strong> vai para a Lixeira do Windows' +
      (sujo ? ', e as alteracoes que ainda nao foram salvas se perdem junto' : '') + '.',
      [{ label: 'Excluir', value: true, cls: 'danger' },
       { label: 'Cancelar', value: false }]
    ).then(function (sim) {
      if (!sim) return null;
      return bridge.call('deleteFile', { path: path }).then(function () {
        if (tab) closeTab(tab.id, true);
        dropRecent(path);
        refreshTree();
        persist();
        toast('Foi para a Lixeira: ' + nome, 'ok', 3600);
      });
    }).catch(falhaDoc('excluir'));
  }

  function openWithDefaultApp(path) {
    if (!path) return Promise.resolve();
    return bridge.call('openWithDefault', { path: path })
      .catch(falhaDoc('abrir no app padrao'));
  }

  // ============================================================== acoes

  function doOpen() {
    bridge.call('openFileDialog', { multi: true }).then(function (paths) {
      if (paths && paths.length) openPaths(paths);
    });
  }

  function doOpenFolder() {
    bridge.call('openFolderDialog', {}).then(function (path) {
      if (path) { setFolder(path); setPane('files'); if (!settings.sidebarVisible) toggleSidebar(true); }
    });
  }

  function doPrint() {
    var tab = activeTab();
    if (!tab) return;

    // Impressao sai sempre do modo leitura, mesmo se estiver editando.
    if (!tab.locked) renderPreview($('preview'), tab);
    $('readingView').hidden = false;
    var editing = $('editingView').hidden;
    $('editingView').hidden = true;

    bridge.call('print', {}).finally(function () {
      $('editingView').hidden = editing;
      renderViews();
    });
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
        '<body class="' + (dark ? 'theme-dark' : 'theme-light') + '">' +
        '<div class="markdown-preview">' + holder.innerHTML + '</div></body></html>';

      return bridge.call('writeBytes', { path: path, content: html }).then(function () {
        toast('Exportado para ' + path.split(/[\\/]/).pop(), 'ok');
      });
    }).catch(function (err) {
      toast('Falha ao exportar: ' + err.message, 'error');
    });
  }

  function promptGoToLine() {
    var tab = activeTab();
    if (!tab) return;
    var total = tab.content.split('\n').length;
    var answer = window.prompt('Ir para a linha (1-' + total + '):', '');
    var n = parseInt(answer, 10);
    if (n > 0) goToLine(Math.min(n, total));
  }

  function toggleAssociation() {
    // Registrado mas nao padrao ainda cai no fluxo de baixo, para poder
    // oferecer a promocao a padrao em vez de so remover.
    if (app.isDefault) {
      dialog('Remover associacao?',
        'O MarkPad sairá da lista de aplicativos para arquivos <strong>.md</strong>.',
        [{ label: 'Cancelar', value: false }, { label: 'Remover', value: true, cls: 'danger' }]
      ).then(function (yes) {
        if (!yes) return;
        bridge.call('fileAssociation', { enable: false }).then(function () {
          app.associated = false;
          app.isDefault = false;
          toast('Associacao removida.', 'ok', 3000);
        }).catch(function (err) { toast('Nao consegui alterar: ' + err.message, 'error', 5000); });
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

    dialog('Abrir arquivos .md com o MarkPad',
      'O MarkPad entrará na lista de aplicativos para <strong>.md</strong>, ' +
      '<strong>.markdown</strong>, <strong>.mdown</strong>, <strong>.mkd</strong> e ' +
      '<strong>.mdx</strong>, e aparecerá em Configurações &rsaquo; Aplicativos padrão.' + extra +
      '<br><br>Para virar o padrão de fato, o Windows exige que <em>você</em> confirme: ' +
      'ele mostra uma caixa de escolha. Nenhum programa pode fazer isso sozinho.' +
      '<br><br>Tudo é gravado apenas no seu usuário (HKCU) e some ao remover.',
      [{ label: 'Cancelar', value: null },
       { label: 'Só registrar', value: 'register' },
       { label: 'Registrar e definir padrão', value: 'default', cls: 'primary' }]
    ).then(function (choice) {
      if (!choice) return;

      var op = choice === 'default' ? 'setDefaultAssociation' : 'fileAssociation';
      bridge.call(op, { enable: true }).then(function (res) {
        app.associated = !!res.associated;
        app.isDefault = !!res.isDefault;
        app.currentHandler = res.handler || app.currentHandler;

        if (choice === 'register') {
          toast('Registrado. O MarkPad já aparece em "Abrir com".', 'ok', 4000);
        } else if (res.isDefault) {
          toast('Pronto. Arquivos .md agora abrem no MarkPad.', 'ok', 4000);
        } else {
          toast('Registrado, mas o padrão não mudou — a escolha foi cancelada.', 'warn', 5000);
        }
      }).catch(function (err) {
        toast('Nao consegui alterar: ' + err.message, 'error', 5000);
      });
    });
  }

  // ================================================== atalhos de teclado

  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  document.addEventListener('keydown', function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var tab = activeTab();
    var inEditor = e.target === $('editorInput');

    // ---- comandos globais
    if (ctrl && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'o': e.preventDefault(); e.shiftKey ? doOpenFolder() : doOpen(); return;
        case 'n': e.preventDefault(); newTab(); return;
        case 's': e.preventDefault(); saveTab(activeTab(), e.shiftKey); return;
        case 'w': e.preventDefault(); if (tab) closeTab(app.activeId); return;
        case 'e': e.preventDefault(); toggleLock(); return;
        case 'f':
          e.preventDefault();
          e.shiftKey ? openFolderSearch() : openFind();
          return;
        case 'g': e.preventDefault(); promptGoToLine(); return;
        case 'p':
          // Ctrl+P abre arquivo pelo nome, como em qualquer editor. Imprimir
          // saiu para Ctrl+Alt+P e continua no menu, na paleta e na barra.
          e.preventDefault();
          e.shiftKey ? openPalette() : openSwitcher();
          return;
        case '\\': e.preventDefault(); toggleSidebar(); return;
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
    }

    if (ctrl && e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); doPrint(); return; }

    if (e.key === 'F2' && !ctrl && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (tab && tab.path) renameDoc(tab.path);
      else toast('Salve o documento antes de renomear.', 'warn');
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

    // ---- teclas do editor (so quando destravado; se travado nao ha textarea)
    if (e.key === 'Tab') {
      e.preventDefault();
      handleTab(e.shiftKey);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !ctrl) {
      if (handleEnter()) e.preventDefault();
      return;
    }

    if (ctrl && !e.shiftKey && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrapSelection('**', '**'); return; }
      if (k === 'i') { e.preventDefault(); wrapSelection('*', '*'); return; }
      if (k === 'k') { e.preventDefault(); wrapSelection('[', '](url)'); return; }
      if (k === 'd') { e.preventDefault(); duplicateLine(); return; }
      if (k === '/') { e.preventDefault(); toggleComment(); return; }
    }

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveLine(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
  }, true);

  // -------------------------------------------------- ajudantes do editor

  function lineBounds(text, pos) {
    var start = text.lastIndexOf('\n', pos - 1) + 1;
    var end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    return { start: start, end: end };
  }

  function handleTab(shift) {
    var ta = $('editorInput');
    var text = ta.value;
    var s = ta.selectionStart, e = ta.selectionEnd;

    if (s === e && !shift) { replaceRange(s, e, '    '); return; }

    var first = lineBounds(text, s).start;
    var last = lineBounds(text, e).end;
    var block = text.slice(first, last);

    var next = shift
      ? block.replace(/^( {1,4}|\t)/gm, '')
      : block.replace(/^/gm, '    ');

    replaceRange(first, last, next);
    $('editorInput').setSelectionRange(first, first + next.length);
  }

  /** Enter que continua listas e citacoes, como no Obsidian. */
  function handleEnter() {
    var ta = $('editorInput');
    if (ta.selectionStart !== ta.selectionEnd) return false;

    var text = ta.value;
    var pos = ta.selectionStart;
    var bounds = lineBounds(text, pos);
    var line = text.slice(bounds.start, pos);

    var m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (m) {
      var isEmpty = !m[5].trim();
      if (isEmpty) { replaceRange(bounds.start, pos, m[1]); return true; }

      var marker = m[2];
      if (/^\d/.test(marker)) {
        var num = parseInt(marker, 10) + 1;
        marker = num + marker.replace(/^\d+/, '');
      }
      replaceRange(pos, pos, '\n' + m[1] + marker + m[3] + (m[4] ? '[ ] ' : ''));
      return true;
    }

    var q = /^(\s*>+\s?)(.*)$/.exec(line);
    if (q) {
      if (!q[2].trim()) { replaceRange(bounds.start, pos, ''); return true; }
      replaceRange(pos, pos, '\n' + q[1]);
      return true;
    }

    var indent = /^\s*/.exec(line)[0];
    if (indent) { replaceRange(pos, pos, '\n' + indent); return true; }

    return false;
  }

  function wrapSelection(before, after) {
    var ta = $('editorInput');
    var s = ta.selectionStart, e = ta.selectionEnd;
    var selected = ta.value.slice(s, e);

    replaceRange(s, e, before + selected + after);
    var ta2 = $('editorInput');
    if (selected) ta2.setSelectionRange(s + before.length, s + before.length + selected.length);
    else ta2.setSelectionRange(s + before.length, s + before.length);
  }

  function duplicateLine() {
    var ta = $('editorInput');
    var b = lineBounds(ta.value, ta.selectionStart);
    var line = ta.value.slice(b.start, b.end);
    replaceRange(b.end, b.end, '\n' + line);
  }

  function moveLine(direction) {
    var ta = $('editorInput');
    var text = ta.value;
    var b = lineBounds(text, ta.selectionStart);
    var offsetInLine = ta.selectionStart - b.start;

    if (direction < 0) {
      if (b.start === 0) return;
      var prev = lineBounds(text, b.start - 1);
      var block = text.slice(prev.start, b.end);
      var lines = block.split('\n');
      var moved = lines.slice(1).concat(lines.slice(0, 1)).join('\n');
      replaceRange(prev.start, b.end, moved);
      $('editorInput').setSelectionRange(prev.start + offsetInLine, prev.start + offsetInLine);
    } else {
      if (b.end >= text.length) return;
      var nxt = lineBounds(text, b.end + 1);
      var blk = text.slice(b.start, nxt.end);
      var ls = blk.split('\n');
      var mv = ls.slice(1).concat(ls.slice(0, 1)).join('\n');
      replaceRange(b.start, nxt.end, mv);
      var newStart = b.start + (nxt.end - nxt.start) + 1;
      $('editorInput').setSelectionRange(newStart + offsetInLine, newStart + offsetInLine);
    }
  }

  function toggleComment() {
    var ta = $('editorInput');
    var text = ta.value;
    var first = lineBounds(text, ta.selectionStart).start;
    var last = lineBounds(text, ta.selectionEnd).end;
    var block = text.slice(first, last);

    var commented = /^\s*<!--[\s\S]*-->\s*$/.test(block);
    var next = commented
      ? block.replace(/^(\s*)<!--\s?/, '$1').replace(/\s?-->(\s*)$/, '$1')
      : '<!-- ' + block + ' -->';

    replaceRange(first, last, next);
  }

  // ============================================================== eventos

  function wireUi() {
    window.MarkPadIcons.apply(document);
    setupLiveEdit();

    $('btnToggleSidebar').onclick = function () { toggleSidebar(); };
    $('btnNewTab').onclick = newTab;
    $('btnCommandPalette').onclick = openPalette;
    $('btnOpenFolder').onclick = doOpenFolder;
    $('btnRefreshTree').onclick = function () {
      invalidateFileIndex();
      app.treeOpen = Object.create(null);
      refreshTree();
    };
    $('btnTreeSearch').onclick = function () { toggleTreeFilter(); };
    $('btnTreeSort').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      treeSortMenu(r.right - 250, r.bottom + 4);
    };
    $('btnTreeCollapse').onclick = collapseTree;

    // O filtro do painel espera o usuario parar de digitar: cada tecla
    // reordenaria a lista inteira, e a lista pisca mais do que ajuda.
    var treeFilterTimer = null;
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
    $('statusLock').onclick = toggleLock;
    $('btnFind').onclick = openFind;
    $('btnMore').onclick = function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      moreMenu(r.right - 220, r.bottom + 4);
    };

    $('btnEmptyOpen').onclick = doOpen;
    $('btnEmptyFolder').onclick = doOpenFolder;
    $('btnEmptyNew').onclick = newTab;

    $('btnToggleSource').onclick = toggleSource;
    $('btnTogglePreview').onclick = togglePreviewPane;

    var sideTabs = document.querySelectorAll('.sidebar-tab');
    for (var j = 0; j < sideTabs.length; j++) {
      (function (btn) {
        btn.onclick = function () { setPane(btn.getAttribute('data-pane')); };
      })(sideTabs[j]);
    }

    // acompanha a leitura para destacar a seção atual no sumário
    var spyTimer = null;
    $('readingScroll').addEventListener('scroll', function () {
      clearTimeout(spyTimer);
      spyTimer = setTimeout(marcaSecaoAtual, 80);
    });

    // editor
    var ta = $('editorInput');
    ta.addEventListener('input', onEditorInput);
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('keyup', function () { updateCurrentLine(); renderStatus(); });
    ta.addEventListener('click', function () { updateCurrentLine(); renderStatus(); });
    ta.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      showMenu([
        { label: 'Recortar', icon: 'copy', disabled: !sel, action: function () { document.execCommand('cut'); } },
        { label: 'Copiar', icon: 'copy', disabled: !sel, action: function () { document.execCommand('copy'); } },
        { label: 'Colar', icon: 'copy', action: function () { navigator.clipboard.readText().then(function (t) { replaceRange(ta.selectionStart, ta.selectionEnd, t); }); } },
        '-',
        { label: 'Selecionar tudo', action: function () { ta.select(); } },
        { label: 'Travar edicao', icon: 'lock', action: toggleLock }
      ], e.clientX, e.clientY);
    });

    // leitura
    $('readingView').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var tab = activeTab();

      // Destravado: o clique direito serve para formatar, como no Obsidian.
      if (tab && !tab.locked && !tab.showSource) {
        var block = live && live.topBlock(e.target);
        if (live && (block || live.isActive()) && formattingMenu(e.clientX, e.clientY, block)) return;
      }

      var sel = String(window.getSelection());
      showMenu([
        { label: 'Copiar', icon: 'copy', disabled: !sel, action: function () { navigator.clipboard.writeText(sel); } },
        { label: 'Selecionar tudo', action: function () {
            var r = document.createRange();
            r.selectNodeContents($('preview'));
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } },
        '-',
        { label: 'Liberar edicao', icon: 'unlock', action: toggleLock },
        { label: 'Localizar', icon: 'search', key: 'Ctrl+F', action: openFind }
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
        { label: 'Windows (CRLF)', checked: tab.eol === '\r\n', action: function () { tab.eol = '\r\n'; renderStatus(); } },
        { label: 'Unix (LF)', checked: tab.eol === '\n', action: function () { tab.eol = '\n'; renderStatus(); } }
      ], window.innerWidth - 240, window.innerHeight - 120);
    };
    $('statusEncoding').onclick = function () {
      var tab = activeTab();
      if (!tab) return;
      var options = ['utf-8', 'utf-8-bom', 'utf-16le', 'latin1'];
      showMenu(options.map(function (enc) {
        return {
          label: enc.toUpperCase(),
          checked: tab.encoding === enc,
          action: function () { tab.encoding = enc; renderStatus(); toast('Sera gravado em ' + enc.toUpperCase() + '.', 'ok'); }
        };
      }), window.innerWidth - 240, window.innerHeight - 160);
    };

    wireResizers();
  }

  // ============================ edição direta no texto renderizado

  var live = null;

  function setupLiveEdit() {
    live = window.MarkPadLiveEdit.create($('preview'), {
      isEditable: function () {
        var tab = activeTab();
        return !!(tab && !tab.locked && !tab.showSource);
      },
      getContent: function () {
        var tab = activeTab();
        return tab ? tab.content : '';
      },
      setContent: function (text) {
        var tab = activeTab();
        if (!tab) return;
        tab.content = text;
      },
      onChange: function () {
        var tab = activeTab();
        renderTabs();
        renderHeader();
        renderStatus();
        renderOutlineSoon();
        scheduleBackup(tab);
      },
      onExit: function (changed) {
        if (!changed) return;
        // O documento mudou: redesenha o leitor preservando a rolagem.
        var scroll = $('readingScroll').scrollTop;
        renderViews();
        $('readingScroll').scrollTop = scroll;
        renderOutline();
        if (settings.autoSave && activeTab() && activeTab().path) {
          clearTimeout(onEditorInput.saveTimer);
          onEditorInput.saveTimer = setTimeout(function () { saveTab(); }, 1200);
        }
      }
    });
  }

  var outlineTimer = null;
  function renderOutlineSoon() {
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(renderOutline, 400);
  }

  /** Menu de formatação, igual em espírito ao do clique direito do Obsidian. */
  function formattingMenu(x, y, block) {
    var tab = activeTab();
    if (!tab || tab.locked) return false;

    // Clicou fora de um bloco em edição: entra nele antes de formatar.
    if (block && (!live.isActive() || live.activeTextarea() !== document.activeElement)) {
      live.enter(block);
    }
    if (!live.isActive()) return false;

    function fmt(label, icon, fn) {
      return { label: label, icon: icon, action: fn };
    }

    showMenu([
      { label: 'Formatar', header: true },
      fmt('Negrito', 'bold', function () { live.wrap('**', '**'); }),
      fmt('Itálico', 'italic', function () { live.wrap('*', '*'); }),
      fmt('Riscado', 'strike', function () { live.wrap('~~', '~~'); }),
      fmt('Destaque', 'highlight', function () { live.wrap('==', '=='); }),
      fmt('Código', 'code', function () { live.wrap('`', '`'); }),
      '-',
      { label: 'Parágrafo', header: true },
      fmt('Título 1', 'heading', function () { live.setLinePrefix('# '); }),
      fmt('Título 2', 'heading', function () { live.setLinePrefix('## '); }),
      fmt('Título 3', 'heading', function () { live.setLinePrefix('### '); }),
      fmt('Texto normal', 'text', function () { live.setLinePrefix(''); }),
      fmt('Citação', 'quote', function () { live.setLinePrefix('> '); }),
      fmt('Lista', 'list', function () { live.setLinePrefix('- '); }),
      fmt('Lista numerada', 'list', function () { live.setLinePrefix('', { ordered: true }); }),
      fmt('Tarefa', 'todo', function () { live.setLinePrefix('- [ ] '); }),
      '-',
      { label: 'Inserir', header: true },
      fmt('Link', 'link', function () { live.insert('[%s](%c)'); }),
      fmt('Tabela', 'table', function () {
        live.insert('\n| %c | Coluna |\n|:--|:--|\n| | |\n');
      }),
      fmt('Bloco de código', 'code', function () { live.insert('\n```%c\n\n```\n'); }),
      fmt('Destaque (callout)', 'info', function () { live.insert('\n> [!note] %c\n> \n'); }),
      fmt('Régua horizontal', 'minus', function () { live.insert('\n---\n%c'); }),
      fmt('Nota de rodapé', 'note', function () { live.insert('[^%c]'); })
    ], x, y);

    return true;
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

  function applySettings() {
    applyTheme();
    applyFontSizes();
    applyAnimations();
    renderQuickBar();
    renderTreeFilter();
    document.documentElement.style.setProperty('--sidebar-width', settings.sidebarWidth + 'px');
    document.body.classList.toggle('sidebar-hidden', !settings.sidebarVisible);
    document.body.classList.toggle('wrap-on', settings.wordWrap);
    $('editorPane').style.flex = '0 0 ' + (settings.splitRatio * 100) + '%';
    setPane(settings.sidebarPane || 'files');
  }

  function boot() {
    wireUi();

    bridge.on('openPaths', function (paths) { openPaths(paths); });

    bridge.on('fileChanged', function (data) {
      var tab = tabByPath(data.path);
      if (!tab) return;

      if (data.kind === 'deleted') {
        tab.staleOnDisk = true;
        renderHeader();
        return;
      }

      var dirty = tab.content !== tab.savedContent;
      if (!dirty) {
        bridge.call('readFile', { path: tab.path }).then(function (fresh) {
          if (fresh.content === tab.content) return;
          tab.content = fresh.content;
          tab.savedContent = fresh.content;
          tab.mtime = fresh.mtime;
          if (tab.id === app.activeId) renderAll();
          toast(tab.name + ' foi atualizado no disco.', 'ok', 2200);
        }).catch(function () {});
      } else {
        tab.staleOnDisk = true;
        renderHeader();
      }
    });

    bridge.on('requestClose', function () {
      var dirty = app.tabs.filter(function (t) { return t.content !== t.savedContent; });

      if (!dirty.length) { bridge.call('confirmClose', {}); return; }

      var names = dirty.map(function (t) { return escapeText(t.name); }).join(', ');
      dialog('Fechar o MarkPad?',
        'Ha alteracoes nao salvas em: <strong>' + names + '</strong>.',
        [{ label: 'Sair sem salvar', value: 'discard', cls: 'danger' },
         { label: 'Cancelar', value: null },
         { label: 'Salvar e sair', value: 'save', cls: 'primary' }]
      ).then(function (choice) {
        if (choice === null) return;
        if (choice === 'discard') { bridge.call('confirmClose', {}); return; }

        var chain = Promise.resolve(true);
        dirty.forEach(function (t) { chain = chain.then(function () { return saveTab(t); }); });
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

      var toOpen = (info.openPaths || []).slice();
      if (!toOpen.length && settings.restoreSession && settings.session) {
        toOpen = settings.session.slice(0, 12);
      }

      if (settings.lastFolder) setFolder(settings.lastFolder, true);

      renderAll();
      return openPaths(toOpen);
    }).then(function () {
      // Depois de restaurar a sessão, para o diálogo não competir com a
      // abertura dos arquivos.
      return offerBackups();
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
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
