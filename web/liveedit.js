/*
 * liveedit.js — edição direta no texto renderizado.
 *
 * Modelo (o mesmo do Live Preview do Obsidian): o bloco onde está o cursor
 * mostra o markdown cru; todos os outros continuam renderizados. Ao sair do
 * bloco, ele volta a ser renderizado e o texto editado é devolvido ao
 * documento exatamente nas linhas de onde veio.
 *
 * Isso depende de o parser marcar cada bloco com data-line/data-line-end.
 * A vantagem sobre um contenteditable sobre o HTML é que o markdown nunca
 * precisa ser reconstruído a partir do DOM: só as linhas tocadas mudam, o
 * resto do arquivo fica byte a byte como estava.
 */
(function (global) {
  'use strict';

  function LiveEdit(root, api) {
    this.root = root;
    this.api = api;          // { getContent, setContent, isEditable, onChange, onExit }
    this.active = null;      // { block, textarea, start, end, before }
    this._bind();
  }

  // ------------------------------------------------------------ utilidades

  /** Sobe do alvo do clique até o filho direto do container. */
  LiveEdit.prototype.topBlock = function (el) {
    while (el && el.parentNode !== this.root) el = el.parentNode;
    return el && el.nodeType === 1 && el.hasAttribute('data-line') ? el : null;
  };

  /**
   * Quantos caracteres visíveis existem antes do ponto clicado, dentro do bloco.
   * Serve para posicionar o cursor no lugar aproximado do markdown cru.
   */
  function visibleOffsetAt(block, x, y) {
    var range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    }
    if (!range || !block.contains(range.startContainer)) return null;

    var probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  }

  /**
   * Converte "n-ésimo caractere visível" em posição dentro do markdown cru.
   * Aproximação deliberada: pula marcadores de bloco no início da linha,
   * runs de ênfase e o alvo dos links, que é o que o leitor não vê.
   */
  function sourceOffsetForVisible(source, n) {
    if (n == null) return source.length;

    var vis = 0;
    var i = 0;
    var atLineStart = true;

    while (i < source.length && vis < n) {
      var ch = source[i];

      if (atLineStart) {
        // marcadores que não aparecem no texto renderizado
        var m = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)/.exec(source.slice(i));
        if (m) { i += m[0].length; atLineStart = false; continue; }
        atLineStart = false;
      }

      if (ch === '\n') { i++; vis++; atLineStart = true; continue; }

      // runs de ênfase: invisíveis
      if (ch === '*' || ch === '_' || ch === '~' || ch === '=' || ch === '`') {
        var run = /^([*_~=`])\1*/.exec(source.slice(i));
        if (run) { i += run[0].length; continue; }
      }

      // link/imagem: o rótulo conta, o destino não
      if (ch === '[' || (ch === '!' && source[i + 1] === '[')) {
        var link = /^!?\[([^\]]*)\]\([^)]*\)/.exec(source.slice(i));
        if (link) {
          if (vis + link[1].length >= n) return i + link[0].indexOf('[') + 1 + (n - vis);
          vis += link[1].length;
          i += link[0].length;
          continue;
        }
      }

      i++;
      vis++;
    }

    return i;
  }

  // ------------------------------------------------------------ ciclo de vida

  LiveEdit.prototype.enter = function (block, clickX, clickY) {
    if (!this.api.isEditable()) return false;
    if (this.active && this.active.block === block) return true;
    if (this.active) this.commit();

    var start = parseInt(block.getAttribute('data-line'), 10);
    var end = parseInt(block.getAttribute('data-line-end'), 10);
    if (isNaN(start) || isNaN(end)) return false;

    var lines = this.api.getContent().split('\n');
    var source = lines.slice(start, end + 1).join('\n');

    var ta = document.createElement('textarea');
    ta.className = 'block-source';
    ta.spellcheck = false;
    ta.value = source;
    ta.setAttribute('data-line', String(start));
    ta.setAttribute('data-line-end', String(end));

    block.style.display = 'none';
    block.parentNode.insertBefore(ta, block);

    // `before` acompanha o que já foi para o documento; `origin` guarda o
    // texto de entrada, que é para onde o Esc volta.
    this.active = {
      block: block, textarea: ta, start: start, end: end,
      before: source, origin: source, dirty: false
    };

    this._autoSize(ta);
    ta.focus();

    var caret = source.length;
    if (clickX != null) {
      var vis = visibleOffsetAt(block, clickX, clickY);
      caret = sourceOffsetForVisible(source, vis);
    }
    try { ta.setSelectionRange(caret, caret); } catch (e) {}

    return true;
  };

  LiveEdit.prototype._autoSize = function (ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  };

  /**
   * Joga o conteúdo do editor de volta no documento, sem re-renderizar.
   *
   * Roda a cada digitação, para que contagem de palavras, indicador de
   * alterado e a cópia de segurança reflitam o que está na tela — e para que
   * nada se perca se o app fechar no meio da edição.
   *
   * `before` é atualizado junto porque o bloco pode ganhar ou perder linhas:
   * o intervalo original deixaria de valer a partir da segunda sincronização.
   */
  LiveEdit.prototype._syncToDocument = function () {
    var a = this.active;
    if (!a) return false;

    var next = a.textarea.value;
    if (next === a.before) return false;

    var lines = this.api.getContent().split('\n');
    var ocupadas = a.before.split('\n').length;
    var head = lines.slice(0, a.start);
    var tail = lines.slice(a.start + ocupadas);

    this.api.setContent(head.concat(next.split('\n'), tail).join('\n'), { fromLine: a.start });
    a.before = next;
    a.dirty = true;
    return true;
  };

  /** Fecha o editor do bloco e devolve o texto. Retorna true se algo mudou. */
  LiveEdit.prototype.commit = function (options) {
    var a = this.active;
    if (!a) return false;

    this._syncToDocument();
    var changed = !!a.dirty;

    // Desmonta antes de avisar quem chamou: o re-render destrói este DOM.
    a.textarea.remove();
    if (a.block.parentNode) a.block.style.display = '';
    this.active = null;

    if (this.api.onExit) this.api.onExit(changed, options || {});
    return changed;
  };

  /** Esc: desfaz tudo o que foi digitado neste bloco e sai. */
  LiveEdit.prototype.cancel = function () {
    var a = this.active;
    if (!a) return;
    a.textarea.value = a.origin;
    this._syncToDocument();
    // O documento voltou ao que era e o bloco escondido nunca chegou a ser
    // re-renderizado: nao ha nada para redesenhar na saida.
    a.dirty = false;
    this.commit();
  };

  LiveEdit.prototype.isActive = function () { return !!this.active; };

  LiveEdit.prototype.activeTextarea = function () {
    return this.active ? this.active.textarea : null;
  };

  // ------------------------------------------------------------- navegação

  LiveEdit.prototype._siblingBlock = function (direction) {
    var a = this.active;
    if (!a) return null;

    var blocks = [];
    for (var i = 0; i < this.root.children.length; i++) {
      var c = this.root.children[i];
      if (c.hasAttribute && c.hasAttribute('data-line')) blocks.push(c);
    }

    var idx = blocks.indexOf(a.block);
    if (idx === -1) return null;
    return blocks[idx + direction] || null;
  };

  LiveEdit.prototype.moveTo = function (direction) {
    var target = this._siblingBlock(direction);
    if (!target) return false;
    this.commit();
    // O commit pode ter disparado re-render; procura o bloco pela linha.
    var line = target.getAttribute && target.getAttribute('data-line');
    var fresh = line != null ? this.root.querySelector('[data-line="' + line + '"]') : null;
    var block = this.topBlock(fresh || target);
    if (!block) return false;
    this.enter(block);
    if (this.active && direction < 0) {
      var ta = this.active.textarea;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    return true;
  };

  // ------------------------------------------------------------ formatação

  /** Envolve a seleção (ou a palavra sob o cursor) com marcadores. */
  LiveEdit.prototype.wrap = function (before, after) {
    var ta = this.activeTextarea();
    if (!ta) return;

    var s = ta.selectionStart, e = ta.selectionEnd;
    var v = ta.value;

    if (s === e) {
      // sem seleção: pega a palavra inteira sob o cursor
      var ini = s, fim = s;
      while (ini > 0 && /[^\s]/.test(v[ini - 1])) ini--;
      while (fim < v.length && /[^\s]/.test(v[fim])) fim++;
      if (ini !== fim) { s = ini; e = fim; }
    }

    var sel = v.slice(s, e);

    // Já estava formatado? Então a ação é remover.
    var fora = v.slice(Math.max(0, s - before.length), s) === before &&
               v.slice(e, e + after.length) === after;
    if (fora) {
      ta.value = v.slice(0, s - before.length) + sel + v.slice(e + after.length);
      ta.setSelectionRange(s - before.length, e - before.length);
    } else if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      var dentro = sel.slice(before.length, sel.length - after.length);
      ta.value = v.slice(0, s) + dentro + v.slice(e);
      ta.setSelectionRange(s, s + dentro.length);
    } else {
      ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    }

    this._autoSize(ta);
    ta.focus();
    this._syncToDocument();
    if (this.api.onChange) this.api.onChange();
  };

  /** Troca o marcador no início de cada linha selecionada. */
  LiveEdit.prototype.setLinePrefix = function (prefix, options) {
    var ta = this.activeTextarea();
    if (!ta) return;

    var v = ta.value;
    var s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    var e = v.indexOf('\n', ta.selectionEnd);
    if (e === -1) e = v.length;

    var numerada = options && options.ordered;
    var contador = 1;

    var trecho = v.slice(s, e).split('\n').map(function (linha) {
      // tira qualquer marcador de bloco anterior antes de aplicar o novo
      var limpa = linha.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)/, '');
      if (prefix === '') return limpa;
      return (numerada ? (contador++) + '. ' : prefix) + limpa;
    }).join('\n');

    ta.value = v.slice(0, s) + trecho + v.slice(e);
    ta.setSelectionRange(s, s + trecho.length);

    this._autoSize(ta);
    ta.focus();
    this._syncToDocument();
    if (this.api.onChange) this.api.onChange();
  };

  /** Insere texto no cursor. `%s` marca onde o cursor deve parar. */
  LiveEdit.prototype.insert = function (snippet) {
    var ta = this.activeTextarea();
    if (!ta) return;

    var v = ta.value;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = v.slice(s, e);
    var texto = snippet.replace('%s', sel);
    var pos = texto.indexOf('%c');
    texto = texto.replace('%c', '');

    ta.value = v.slice(0, s) + texto + v.slice(e);
    var caret = pos >= 0 ? s + pos : s + texto.length;
    ta.setSelectionRange(caret, caret);

    this._autoSize(ta);
    ta.focus();
    this._syncToDocument();
    if (this.api.onChange) this.api.onChange();
  };

  // ---------------------------------------------------------------- eventos

  LiveEdit.prototype._bind = function () {
    var self = this;

    this.root.addEventListener('mousedown', function (e) {
      if (!self.api.isEditable()) return;
      if (e.button !== 0) return;
      if (e.target.closest('.block-source')) return;

      // Links, caixas de tarefa e botões continuam clicáveis.
      if (e.target.closest('a, input, button, .callout-title, summary')) return;

      var block = self.topBlock(e.target);
      if (!block) { if (self.active) self.commit(); return; }
      if (self.active && self.active.block === block) return;

      e.preventDefault();
      self.enter(block, e.clientX, e.clientY);
    });

    this.root.addEventListener('input', function (e) {
      if (!e.target.classList.contains('block-source')) return;
      self._autoSize(e.target);
      self._syncToDocument();
      if (self.api.onChange) self.api.onChange();
    });

    this.root.addEventListener('focusout', function (e) {
      if (!e.target.classList.contains('block-source')) return;
      // Deixa o clique seguinte acontecer antes de desmontar o editor.
      setTimeout(function () {
        if (self.active && document.activeElement !== self.active.textarea) self.commit();
      }, 0);
    });

    this.root.addEventListener('keydown', function (e) {
      var ta = self.activeTextarea();
      if (!ta || e.target !== ta) return;

      if (e.key === 'Escape') { e.preventDefault(); self.cancel(); return; }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); self.commit(); return; }

      if (e.key === 'ArrowUp' && ta.selectionStart === 0) {
        e.preventDefault(); self.moveTo(-1); return;
      }
      if (e.key === 'ArrowDown' && ta.selectionEnd === ta.value.length) {
        e.preventDefault(); self.moveTo(1); return;
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        var k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); self.wrap('**', '**'); return; }
        if (k === 'i') { e.preventDefault(); self.wrap('*', '*'); return; }
        if (k === 'k') { e.preventDefault(); self.insert('[%s](%c)'); return; }
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault(); self.wrap('==', '=='); return;
      }
    });
  };

  global.MarkPadLiveEdit = {
    create: function (root, api) { return new LiveEdit(root, api); }
  };
})(window);
