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
    warnNonMarkdown: true,
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

  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================== menus

  function showMenu(items, x, y) {
    var menu = $('menu');
    menu.textContent = '';

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

  function wirePreviewClicks(container, tab) {
    container.onclick = function (e) {
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

  function refreshTree() {
    var box = $('fileTree');
    if (!app.folder) {
      box.innerHTML = '<p class="pane-empty">Abra uma pasta para navegar pelos arquivos.<br>Nao precisa de cofre.</p>';
      return;
    }
    box.textContent = '';
    buildTree(app.folder, box, 0);
  }

  function buildTree(dirPath, container, depth) {
    return bridge.call('listDir', { path: dirPath }).then(function (data) {
      var visiveis = data.entries.filter(function (e) {
        return e.dir || !settings.treeOnlyMarkdown || e.markdown;
      });

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
            showMenu([
              { label: 'Abrir', icon: 'file-text', action: function () { openPath(entry.path); } },
              { label: 'Mostrar no Explorer', icon: 'reveal', action: function () { bridge.call('revealInExplorer', { path: entry.path }); } },
              { label: 'Copiar caminho', icon: 'copy', action: function () { navigator.clipboard.writeText(entry.path); toast('Caminho copiado.', 'ok', 1200); } }
            ], e.clientX, e.clientY);
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
      { id: 'export', label: 'Exportar como HTML...', icon: 'external', enabled: !!tab, action: exportHtml },
      { id: 'print', label: 'Imprimir', key: 'Ctrl+P', icon: 'printer', enabled: !!tab, action: doPrint },
      { id: 'copyPath', label: 'Copiar caminho do arquivo', icon: 'copy', enabled: !!(tab && tab.path), action: function () { navigator.clipboard.writeText(activeTab().path); toast('Caminho copiado.', 'ok', 1200); } },
      { id: 'reveal', label: 'Mostrar no Explorer', icon: 'reveal', enabled: !!(tab && tab.path), action: function () { bridge.call('revealInExplorer', { path: activeTab().path }); } },
      { id: 'assoc', label: app.isDefault ? 'Remover o MarkPad como padrao de .md'
          : app.associated ? 'Definir o MarkPad como padrao de .md'
          : 'Abrir arquivos .md com o MarkPad',
        icon: 'link', checked: app.isDefault, action: toggleAssociation },
      { id: 'devtools', label: 'Ferramentas do desenvolvedor', icon: 'settings', action: function () { bridge.call('devTools', {}); } }
    ];
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

    showMenu([
      entry('save'), entry('saveAs'), entry('reload'), '-',
      entry('find'), entry('findFolder'), entry('goto'), '-',
      entry('foldAll'), entry('unfoldAll'), '-',
      { label: 'Visual', header: true },
      entry('wrap'), entry('gutter'), entry('wide'), entry('theme'), '-',
      { label: 'Trava', header: true },
      entry('lockOnOpen'), entry('confirmUnlock'), entry('autoSave'), '-',
      { label: 'Arquivos', header: true },
      entry('treeFilter'), entry('warnNonMd'), '-',
      entry('export'), entry('print'), entry('copyPath'), entry('reveal'), '-',
      entry('remote'), entry('assoc'), entry('devtools')
    ], x, y);
  }

  function tabContextMenu(tab) {
    return [
      { label: 'Salvar', icon: 'save', disabled: tab.locked, action: function () { saveTab(tab); } },
      { label: 'Fechar', icon: 'x', action: function () { closeTab(tab.id); } },
      { label: 'Fechar as outras', action: function () {
          app.tabs.slice().forEach(function (t) { if (t.id !== tab.id) closeTab(t.id); });
        } },
      '-',
      { label: 'Copiar caminho', icon: 'copy', disabled: !tab.path, action: function () { navigator.clipboard.writeText(tab.path); toast('Caminho copiado.', 'ok', 1200); } },
      { label: 'Mostrar no Explorer', icon: 'reveal', disabled: !tab.path, action: function () { bridge.call('revealInExplorer', { path: tab.path }); } }
    ];
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
          e.preventDefault();
          e.shiftKey ? openPalette() : doPrint();
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
      if (!$('palette').hidden) return;
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
    $('btnRefreshTree').onclick = function () { app.treeOpen = Object.create(null); refreshTree(); };
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
