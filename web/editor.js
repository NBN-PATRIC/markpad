/*
 * MarkPad: editor de edicao (modo ao vivo e modo fonte) sobre CodeMirror 6.
 *
 * O documento e sempre o texto: o "ao vivo" e decoracao por cima dele, como
 * no Live Preview do Obsidian. Marcadores (**, #, [[, >) somem quando o
 * cursor nao encosta no trecho e voltam quando encosta; tabela, callout,
 * propriedades e HTML viram o mesmo desenho do modo leitura ate o cursor
 * entrar neles. O modo fonte e o mesmo editor sem as decoracoes que escondem.
 *
 * Nada aqui fala com o lado nativo: tudo que depende do app (abrir link,
 * desenhar um trecho como o leitor desenha, saber se a nota existe) chega
 * pelas opcoes de create(). O CodeMirror vem embutido em codemirror.js
 * (global CM); sem ele, MarkPadEditor fica null e o app avisa.
 */
(function (global) {
  'use strict';

  var CM = global.CM;
  if (!CM) { global.MarkPadEditor = null; return; }

  var S = CM.state, V = CM.view, L = CM.language, H = CM.highlight;
  var C = CM.commands, MD = CM.markdown, LM = CM.lezerMarkdown, AC = CM.autocomplete;
  var tags = H.tags;
  var EditorState = S.EditorState, EditorView = V.EditorView, Decoration = V.Decoration;
  var WidgetType = V.WidgetType;

  // =================================================================
  // 1. Dialeto: o que o Obsidian entende alem do CommonMark + GFM.
  //    As regras seguem as do leitor (web/markdown.js) para os dois lados
  //    concordarem sobre o que e tag, destaque, wikilink.
  // =================================================================

  var T = {
    wikilink: H.Tag.define(tags.link),
    embed: H.Tag.define(tags.link),
    destaque: H.Tag.define(),
    comentario: H.Tag.define(tags.comment),
    hashtag: H.Tag.define(),
    blockId: H.Tag.define(),
    rodape: H.Tag.define(),
    math: H.Tag.define(),
    frontmatter: H.Tag.define(tags.meta)
  };

  function eEspaco(c) { return c === 32 || c === 9 || c === 10 || c === 13 || c === -1 || isNaN(c); }

  var WikiLinks = {
    defineNodes: [
      { name: 'WikiLink', style: { 'WikiLink/...': T.wikilink } },
      { name: 'Embed', style: { 'Embed/...': T.embed } },
      { name: 'WikiMark', style: tags.processingInstruction },
      { name: 'WikiAlvo' },
      { name: 'WikiBarra', style: tags.processingInstruction },
      { name: 'WikiApelido' }
    ],
    parseInline: [{
      name: 'WikiLink',
      before: 'Link',
      parse: function (cx, next, pos) {
        var inicio = pos, embed = false;
        if (next === 33) {
          if (cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1;
          embed = true; pos += 1;
        } else if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        var resto = cx.slice(pos + 2, cx.end);
        var fecha = resto.indexOf(']]');
        if (fecha <= 0) return -1;
        var miolo = resto.slice(0, fecha);
        if (/[\n\[\]]/.test(miolo)) return -1;
        var a = pos + 2, b = a + fecha, fim = b + 2;
        var filhos = [cx.elt('WikiMark', inicio, a)];
        var barra = miolo.indexOf('|');
        if (barra >= 0) {
          var pb = a + barra, tamBarra = 1;
          if (barra > 0 && miolo.charAt(barra - 1) === '\\') { pb -= 1; tamBarra = 2; }
          if (pb > a) filhos.push(cx.elt('WikiAlvo', a, pb));
          filhos.push(cx.elt('WikiBarra', pb, pb + tamBarra));
          if (pb + tamBarra < b) filhos.push(cx.elt('WikiApelido', pb + tamBarra, b));
        } else {
          filhos.push(cx.elt('WikiAlvo', a, b));
        }
        filhos.push(cx.elt('WikiMark', b, fim));
        return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', inicio, fim, filhos));
      }
    }]
  };

  var DelimDestaque = { resolve: 'Destaque', mark: 'DestaqueMark' };
  var Destaque = {
    defineNodes: [
      { name: 'Destaque', style: { 'Destaque/...': T.destaque } },
      { name: 'DestaqueMark', style: tags.processingInstruction }
    ],
    parseInline: [{
      name: 'Destaque',
      after: 'Emphasis',
      parse: function (cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        var antes = cx.slice(pos - 1, pos), depois = cx.slice(pos + 2, pos + 3);
        var espAntes = /\s|^$/.test(antes), espDepois = /\s|^$/.test(depois);
        return cx.addDelimiter(DelimDestaque, pos, pos + 2, !espDepois, !espAntes);
      }
    }]
  };

  var Comentarios = {
    defineNodes: [
      { name: 'Comentario', style: { 'Comentario/...': T.comentario } },
      { name: 'ComentarioMark', style: tags.processingInstruction },
      { name: 'ComentarioBloco', block: true, style: T.comentario }
    ],
    parseInline: [{
      name: 'Comentario',
      before: 'Emphasis',
      parse: function (cx, next, pos) {
        if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
        if (pos > cx.offset && cx.char(pos - 1) === 92) return -1;
        var resto = cx.slice(pos + 2, cx.end);
        var c = resto.indexOf('%%');
        if (c < 0) return -1;
        var fim = pos + 2 + c + 2;
        return cx.addElement(cx.elt('Comentario', pos, fim,
          [cx.elt('ComentarioMark', pos, pos + 2), cx.elt('ComentarioMark', fim - 2, fim)]));
      }
    }],
    parseBlock: [{
      name: 'ComentarioBloco',
      before: 'FencedCode',
      parse: function (cx, line) {
        var txt = line.text.slice(line.pos);
        if (txt.slice(0, 2) !== '%%' || txt.indexOf('%%', 2) >= 0) return false;
        var de = cx.lineStart + line.pos, ate = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          ate = cx.lineStart + line.text.length;
          if (line.text.indexOf('%%') >= 0) { cx.nextLine(); break; }
        }
        cx.addElement(cx.elt('ComentarioBloco', de, ate));
        return true;
      }
    }]
  };

  // A mesma classe de caracteres do leitor (RE_TAG_LEITURA em markdown.js).
  var RE_TAG = /^#(?!\d+(?:[\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]|$))([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]+)/;

  var Hashtags = {
    defineNodes: [{ name: 'Hashtag', style: T.hashtag }],
    parseInline: [{
      name: 'Hashtag',
      parse: function (cx, next, pos) {
        if (next !== 35) return -1;
        if (pos > cx.offset && !eEspaco(cx.char(pos - 1))) return -1;
        var m = RE_TAG.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
        if (!m) return -1;
        return cx.addElement(cx.elt('Hashtag', pos, pos + m[0].length));
      }
    }]
  };

  var Rodapes = {
    defineNodes: [
      { name: 'RodapeRef', style: T.rodape },
      { name: 'RodapeInline', style: T.rodape },
      { name: 'BlockId', style: T.blockId }
    ],
    parseInline: [{
      name: 'RodapeRef',
      before: 'Link',
      parse: function (cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        var m = /^\[\^([^\]\s]+)\]/.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
        if (!m) return -1;
        return cx.addElement(cx.elt('RodapeRef', pos, pos + m[0].length));
      }
    }, {
      name: 'Circunflexo',
      parse: function (cx, next, pos) {
        if (next !== 94) return -1;
        if (cx.char(pos + 1) === 91) {
          // ^[nota inline]
          var prof = 0, i = pos + 1;
          for (; i < cx.end; i++) {
            var c = cx.char(i);
            if (c === 92) { i++; continue; }
            if (c === 91) prof++;
            else if (c === 93 && --prof === 0) break;
          }
          if (prof !== 0 || i >= cx.end) return -1;
          return cx.addElement(cx.elt('RodapeInline', pos, i + 1));
        }
        if (pos > cx.offset && !eEspaco(cx.char(pos - 1))) return -1;
        var m = /^\^([A-Za-z0-9-]+)(?=[ \t]*(?:\n|$))/.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
        if (!m) return -1;
        return cx.addElement(cx.elt('BlockId', pos, pos + m[0].length));
      }
    }]
  };

  var Matematica = {
    defineNodes: [
      { name: 'MathInline', style: { 'MathInline/...': T.math } },
      { name: 'MathMark', style: tags.processingInstruction },
      { name: 'MathBloco', block: true, style: T.math }
    ],
    parseInline: [{
      name: 'MathInline',
      before: 'Emphasis',
      parse: function (cx, next, pos) {
        if (next !== 36) return -1;
        if (pos > cx.offset && cx.char(pos - 1) === 92) return -1;
        var duplo = cx.char(pos + 1) === 36;
        var abre = duplo ? 2 : 1;
        var depois = cx.char(pos + abre);
        if (!duplo && eEspaco(depois)) return -1;
        for (var i = pos + abre; i < cx.end; i++) {
          var c = cx.char(i);
          if (c === 92) { i++; continue; }
          if (c !== 36) continue;
          if (duplo) {
            if (cx.char(i + 1) !== 36) continue;
            if (i === pos + 2) return -1;
            return cx.addElement(cx.elt('MathInline', pos, i + 2,
              [cx.elt('MathMark', pos, pos + 2), cx.elt('MathMark', i, i + 2)]));
          }
          if (eEspaco(cx.char(i - 1))) continue;
          var seg = cx.char(i + 1);
          if (seg >= 48 && seg <= 57) continue;
          if (i === pos + 1) return -1;
          return cx.addElement(cx.elt('MathInline', pos, i + 1,
            [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', i, i + 1)]));
        }
        return -1;
      }
    }],
    parseBlock: [{
      name: 'MathBloco',
      before: 'FencedCode',
      parse: function (cx, line) {
        var txt = line.text.slice(line.pos);
        if (txt.slice(0, 2) !== '$$') return false;
        var de = cx.lineStart + line.pos;
        var ate = cx.lineStart + line.text.length;
        if (txt.slice(2).indexOf('$$') >= 0) { cx.nextLine(); }
        else {
          while (cx.nextLine()) {
            ate = cx.lineStart + line.text.length;
            if (line.text.indexOf('$$') >= 0) { cx.nextLine(); break; }
          }
        }
        cx.addElement(cx.elt('MathBloco', de, ate));
        return true;
      }
    }]
  };

  // Propriedades: so com o '---' de fechamento, como o leitor. Sem ele, o
  // '---' da primeira linha e uma regua comum (digitar o primeiro '---' nao
  // pode transformar o documento inteiro em YAML).
  var Propriedades = {
    defineNodes: [
      { name: 'Frontmatter', block: true, style: { 'Frontmatter/...': T.frontmatter } },
      { name: 'FrontmatterMark', style: tags.processingInstruction }
    ],
    parseBlock: [{
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse: function (cx, line) {
        if (cx.lineStart !== 0 || !/^---[ \t]*$/.test(line.text)) return false;
        var input = cx.input;
        if (!input) return false;
        var ini = input.read(0, Math.min(input.length, 100000));
        if (!/\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(ini)) return false;
        var filhos = [cx.elt('FrontmatterMark', 0, line.text.length)];
        var ate = line.text.length;
        while (cx.nextLine()) {
          ate = cx.lineStart + line.text.length;
          if (/^(?:---|\.\.\.)[ \t]*$/.test(line.text)) {
            filhos.push(cx.elt('FrontmatterMark', cx.lineStart, ate));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('Frontmatter', 0, ate, filhos));
        return true;
      }
    }]
  };

  // Dobra como a do Obsidian: titulo (secao inteira), item de lista com
  // filhos, bloco de codigo e propriedades. Paragrafo, citacao e tabela nao
  // ganham seta (o CodeMirror dobraria qualquer bloco de varias linhas).
  function semDobra() { return null; }
  var DobraDoObsidian = {
    props: [L.foldNodeProp.add({
      Paragraph: semDobra, Blockquote: semDobra, Table: semDobra, HTMLBlock: semDobra,
      CommentBlock: semDobra, MathBloco: semDobra, ComentarioBloco: semDobra, LinkReference: semDobra
    })]
  };

  // PowerShell e shell com gramatica propria: os modos antigos do CodeMirror
  // nao separam cmdlet, variavel e parametro, e sao as linguagens do NOC.
  var modoPowerShell = {
    name: 'powershell',
    startState: function () { return { bloco: false }; },
    token: function (st, e) {
      if (e.bloco) {
        if (st.skipTo('#>')) { st.next(); st.next(); e.bloco = false; } else st.skipToEnd();
        return 'comment';
      }
      if (st.eatSpace()) return null;
      if (st.match('<#')) { e.bloco = true; return 'comment'; }
      if (st.peek() === '#') { st.skipToEnd(); return 'comment'; }
      if (st.match(/^\$(?:true|false|null)\b/i)) return 'atom';
      if (st.match(/^\$\{[^}]*\}/) || st.match(/^\$[\w:?]+/) || st.match(/^\$_/)) return 'variable-2';
      if (st.match(/^"(?:[^"`]|`.)*"?/) || st.match(/^'(?:[^']|'')*'?/)) return 'string';
      if (st.match(/^-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|and|or|not|xor|band|bor|replace|split|join|is|isnot|as|f)\b/i)) return 'operator';
      if (st.match(/^-[A-Za-z][\w]*/)) return 'attribute';
      if (st.match(/^0x[\da-f]+\b/i) || st.match(/^\d+(?:\.\d+)?(?:[kmgtp]b)?\b/i)) return 'number';
      if (st.match(/^\[[\w.\[\]]+\]/)) return 'type';
      if (st.match(/^[A-Za-z]+-[A-Za-z][\w]*/)) return 'builtin';
      if (st.match(/^(?:function|param|begin|process|end|if|elseif|else|switch|foreach|for|while|do|until|break|continue|return|try|catch|finally|throw|trap|filter|class|enum|using|exit)\b/i)) return 'keyword';
      if (st.match(/^[|=+*\/%<>!&,;.]/)) return 'operator';
      if (st.match(/^[{}()\[\]]/)) return 'bracket';
      st.next();
      return null;
    }
  };

  var modoShell = {
    name: 'shell',
    startState: function () { return { comando: true }; },
    token: function (st, e) {
      if (st.sol()) e.comando = true;
      if (st.eatSpace()) return null;
      if (st.peek() === '#') { st.skipToEnd(); return 'comment'; }
      if (st.match(/^"(?:[^"\\]|\\.)*"?/) || st.match(/^'[^']*'?/)) { e.comando = false; return 'string'; }
      if (st.match(/^\$\{[^}]*\}/) || st.match(/^\$[\w@#?$!*]+/) || st.match(/^\$\(/)) { e.comando = false; return 'variable-2'; }
      if (st.match(/^(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|exit|export|local|readonly|unset|sudo|time)\b/)) { e.comando = true; return 'keyword'; }
      if (st.match(/^(?:&&|\|\||[|;&]|\$\(|\))/)) { e.comando = true; return 'operator'; }
      if (st.match(/^[<>]+/)) return 'operator';
      if (st.match(/^-{1,2}[\w-]+=?/)) return 'attribute';
      if (st.match(/^\d+\b/)) return 'number';
      if (st.match(/^[\w.\/~:@%+=,-]+/)) { var era = e.comando; e.comando = false; return era ? 'builtin' : null; }
      st.next();
      return null;
    }
  };

  var linguagensDeCodigo = CM.codeLanguages.filter(function (d) { return d.name !== 'powershell' && d.name !== 'shell'; }).concat([
    L.LanguageDescription.of({ name: 'powershell', alias: ['ps1', 'pwsh', 'posh'], support: new L.LanguageSupport(L.StreamLanguage.define(modoPowerShell)) }),
    L.LanguageDescription.of({ name: 'shell', alias: ['sh', 'bash', 'zsh', 'console', 'fish'], support: new L.LanguageSupport(L.StreamLanguage.define(modoShell)) })
  ]);

  function linguagemMarkdown() {
    return MD.markdown({
      base: MD.commonmarkLanguage,
      codeLanguages: linguagensDeCodigo,
      extensions: [LM.GFM, WikiLinks, Destaque, Comentarios, Hashtags, Rodapes, Matematica, Propriedades, DobraDoObsidian],
      addKeymap: false
    });
  }

  // =================================================================
  // 2. Cores: so classes; a folha (style.css) pinta com as variaveis das
  //    paletas, entao as oito paletas e o tema do VS Code chegam aqui.
  // =================================================================

  var estiloRealce = L.HighlightStyle.define([
    { tag: tags.heading1, class: 'cmt-h cmt-h1' },
    { tag: tags.heading2, class: 'cmt-h cmt-h2' },
    { tag: tags.heading3, class: 'cmt-h cmt-h3' },
    { tag: tags.heading4, class: 'cmt-h cmt-h4' },
    { tag: tags.heading5, class: 'cmt-h cmt-h5' },
    { tag: tags.heading6, class: 'cmt-h cmt-h6' },
    { tag: tags.strong, class: 'cmt-strong' },
    { tag: tags.emphasis, class: 'cmt-em' },
    { tag: tags.strikethrough, class: 'cmt-strike' },
    { tag: tags.monospace, class: 'cmt-code' },
    { tag: tags.link, class: 'cmt-link' },
    { tag: tags.url, class: 'cmt-url' },
    { tag: tags.processingInstruction, class: 'cmt-marca' },
    { tag: tags.quote, class: 'cmt-quote' },
    { tag: tags.contentSeparator, class: 'cmt-hr' },
    { tag: tags.labelName, class: 'cmt-label' },
    { tag: tags.escape, class: 'cmt-marca' },
    { tag: T.destaque, class: 'cmt-destaque' },
    { tag: T.wikilink, class: 'cmt-wikilink' },
    { tag: T.embed, class: 'cmt-embed' },
    { tag: T.comentario, class: 'cmt-comentario' },
    { tag: T.hashtag, class: 'cmt-tag' },
    { tag: T.blockId, class: 'cmt-blockid' },
    { tag: T.rodape, class: 'cmt-rodape' },
    { tag: T.math, class: 'cmt-math' },
    { tag: T.frontmatter, class: 'cmt-frontmatter' },
    // Codigo dos blocos cercados: as mesmas classes do realce do leitor.
    { tag: tags.comment, class: 'tok-com' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'tok-str' },
    { tag: [tags.number, tags.integer, tags.float], class: 'tok-num' },
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], class: 'tok-kw' },
    { tag: [tags.bool, tags.null, tags.atom, tags.self], class: 'tok-bi' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-fn' },
    { tag: [tags.typeName, tags.className, tags.namespace], class: 'tok-type' },
    { tag: [tags.definition(tags.variableName), tags.special(tags.variableName)], class: 'tok-var' },
    { tag: [tags.standard(tags.variableName)], class: 'tok-fn' },
    { tag: [tags.propertyName], class: 'tok-prop' },
    { tag: [tags.operator], class: 'tok-op' },
    { tag: [tags.punctuation, tags.bracket, tags.separator], class: 'tok-punc' },
    { tag: [tags.meta, tags.annotation], class: 'tok-meta' },
    { tag: [tags.tagName], class: 'tok-tag' },
    { tag: [tags.attributeName], class: 'tok-attr' },
    { tag: [tags.inserted], class: 'tok-add' },
    { tag: [tags.deleted], class: 'tok-del' }
  ]);

  // =================================================================
  // 3. Estado compartilhado: foco, ponteiro, achados da busca, margem.
  // =================================================================

  var efFoco = S.StateEffect.define();
  var efPonteiro = S.StateEffect.define();
  var efAtualiza = S.StateEffect.define();
  var efAchados = S.StateEffect.define();
  var efStatus = S.StateEffect.define();
  var anotExterna = S.Annotation.define();

  var campoFoco = S.StateField.define({
    create: function () { return false; },
    update: function (v, tr) {
      for (var i = 0; i < tr.effects.length; i++) if (tr.effects[i].is(efFoco)) v = tr.effects[i].value;
      return v;
    }
  });

  var campoPonteiro = S.StateField.define({
    create: function () { return false; },
    update: function (v, tr) {
      for (var i = 0; i < tr.effects.length; i++) if (tr.effects[i].is(efPonteiro)) v = tr.effects[i].value;
      return v;
    }
  });

  // Achados da busca: [{inicio, fim}] e o indice do atual. Mapeados pelas
  // edicoes, para nao pintarem o lugar errado ate a proxima busca.
  var campoAchados = S.StateField.define({
    create: function () { return { lista: [], atual: -1 }; },
    update: function (v, tr) {
      for (var i = 0; i < tr.effects.length; i++) if (tr.effects[i].is(efAchados)) return tr.effects[i].value;
      if (tr.docChanged && v.lista.length) {
        return {
          lista: v.lista.map(function (a) {
            return { inicio: tr.changes.mapPos(a.inicio, 1), fim: tr.changes.mapPos(a.fim, -1) };
          }).filter(function (a) { return a.fim > a.inicio; }),
          atual: v.atual
        };
      }
      return v;
    },
    provide: function (f) {
      return EditorView.decorations.from(f, function (v) {
        if (!v.lista.length) return Decoration.none;
        return Decoration.set(v.lista.map(function (a, i) {
          return Decoration.mark({ class: i === v.atual ? 'cm-achado cm-achado-atual' : 'cm-achado' }).range(a.inicio, a.fim);
        }), true);
      });
    }
  });

  // Margem de alteracoes (Notepad++): um status por linha, vindo do app.
  var campoStatus = S.StateField.define({
    create: function () { return []; },
    update: function (v, tr) {
      for (var i = 0; i < tr.effects.length; i++) if (tr.effects[i].is(efStatus)) return tr.effects[i].value || [];
      return v;
    }
  });

  class MarcaStatus extends V.GutterMarker {
    constructor(tipo) { super(); this.tipo = tipo; }
    toDOM() {
      var el = document.createElement('div');
      el.className = 'cm-status-' + this.tipo;
      return el;
    }
    eq(o) { return o.tipo === this.tipo; }
  }
  var MARCAS_STATUS = { mod: new MarcaStatus('mod'), saved: new MarcaStatus('saved') };

  var margemStatus = V.gutter({
    class: 'cm-gutter-status',
    lineMarker: function (view, linha) {
      var arr = view.state.field(campoStatus);
      if (!arr.length) return null;
      var n = view.state.doc.lineAt(linha.from).number;
      return MARCAS_STATUS[arr[n - 1]] || null;
    },
    lineMarkerChange: function (u) {
      return u.startState.field(campoStatus) !== u.state.field(campoStatus);
    },
    initialSpacer: function () { return MARCAS_STATUS.mod; }
  });

  // No ao vivo a margem fica colada no texto, como as barras do modo leitura.
  var linhasStatus = V.ViewPlugin.fromClass(function (view) {
    this.decorations = montaLinhasStatus(view);
    this.update = function (u) {
      if (u.docChanged || u.viewportChanged || u.startState.field(campoStatus) !== u.state.field(campoStatus)) {
        this.decorations = montaLinhasStatus(u.view);
      }
    };
  }, { decorations: function (v) { return v.decorations; } });

  function montaLinhasStatus(view) {
    var arr = view.state.field(campoStatus);
    if (!arr.length) return Decoration.none;
    var b = new S.RangeSetBuilder();
    var doc = view.state.doc;
    view.visibleRanges.forEach(function (r) {
      for (var pos = r.from; pos <= r.to;) {
        var linha = doc.lineAt(pos);
        var st = arr[linha.number - 1];
        if (st === 'mod' || st === 'saved') b.add(linha.from, linha.from, Decoration.line({ class: 'cm-ch-' + st }));
        pos = linha.to + 1;
      }
    });
    return b.finish();
  }

  // =================================================================
  // 4. A regra de revelacao.
  // =================================================================

  function revela(state, de, ate) {
    // Ocorrencia da busca revela sempre (o realce nunca fica sobre texto
    // escondido); a selecao, so com o editor em foco.
    var ach = state.field(campoAchados, false);
    if (ach) for (var j = 0; j < ach.lista.length; j++) if (ach.lista[j].inicio < ate && ach.lista[j].fim > de) return true;
    if (!state.field(campoFoco, false)) return false;
    var sel = state.selection.ranges;
    for (var i = 0; i < sel.length; i++) if (sel[i].from <= ate && sel[i].to >= de) return true;
    return false;
  }

  function revelaLinha(state, pos) {
    var l = state.doc.lineAt(pos);
    return revela(state, l.from, l.to);
  }

  // =================================================================
  // 5. Widgets.
  // =================================================================

  class Bala extends WidgetType {
    constructor(nivel) { super(); this.nivel = nivel; }
    eq(o) { return o.nivel === this.nivel; }
    toDOM() {
      var s = document.createElement('span');
      s.className = 'cm-bala cm-bala-' + (this.nivel % 3);
      s.setAttribute('aria-hidden', 'true');
      return s;
    }
  }

  // A posicao vem da DOM na hora do clique: o widget nao guarda posicao,
  // senao qualquer tecla acima dele o faria ser redesenhado.
  class Caixa extends WidgetType {
    constructor(ctx, marcada, char) { super(); this.ctx = ctx; this.marcada = marcada; this.char = char; }
    eq(o) { return o.marcada === this.marcada && o.char === this.char; }
    toDOM(view) {
      var ctx = this.ctx;
      var w = document.createElement('span');
      w.className = 'cm-tarefa-caixa';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.marcada;
      if (this.char && this.char !== ' ' && this.char.toLowerCase() !== 'x') { w.setAttribute('data-task', this.char); cb.setAttribute('data-task', this.char); }
      cb.tabIndex = -1;
      cb.addEventListener('mousedown', function (e) { e.preventDefault(); });
      cb.addEventListener('click', function (e) {
        e.preventDefault();
        if (!ctx.podeEditar()) { if (ctx.travado) ctx.travado(); return; }
        var p = view.posAtDOM(w);
        var linha = view.state.doc.lineAt(p);
        var i = linha.text.indexOf('[', p - linha.from);
        if (i < 0) return;
        var pos = linha.from + i + 1;
        var atual = view.state.doc.sliceString(pos, pos + 1);
        view.dispatch({ changes: { from: pos, to: pos + 1, insert: atual === ' ' ? 'x' : ' ' }, userEvent: 'input.tarefa' });
      });
      w.appendChild(cb);
      return w;
    }
    ignoreEvent() { return true; }
  }

  class Regua extends WidgetType {
    eq() { return true; }
    toDOM() {
      var s = document.createElement('span');
      s.className = 'cm-regua';
      return s;
    }
  }

  class Rotulo extends WidgetType {
    constructor(ctx, lang) { super(); this.ctx = ctx; this.lang = lang; }
    eq(o) { return o.lang === this.lang; }
    toDOM(view) {
      var ctx = this.ctx;
      var s = document.createElement('span');
      s.className = 'cm-codigo-rotulo';
      if (this.lang) {
        var l = document.createElement('span');
        l.className = 'cm-codigo-lang';
        l.textContent = this.lang;
        s.appendChild(l);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cm-codigo-copiar';
      b.textContent = ctx.t('Copiar');
      b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var no = L.syntaxTree(view.state).resolveInner(view.posAtDOM(s), 1);
        while (no && no.name !== 'FencedCode') no = no.parent;
        var corpo = no && no.getChild('CodeText');
        var texto = corpo ? view.state.doc.sliceString(corpo.from, corpo.to) : '';
        if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () {
          b.textContent = ctx.t('Copiado');
          setTimeout(function () { b.textContent = ctx.t('Copiar'); }, 1200);
        });
      });
      s.appendChild(b);
      return s;
    }
    ignoreEvent() { return true; }
  }

  // Trecho desenhado pelo leitor (imagem, embed, tabela, callout, HTML,
  // propriedades). O desenho e do app (mesma peneira e mesmos ajustes do
  // modo leitura); aqui so se decide quando e onde.
  class Trecho extends WidgetType {
    constructor(ctx, src, tipo, linhas) {
      super();
      this.ctx = ctx; this.src = src; this.tipo = tipo; this.linhas = linhas || 1;
    }
    eq(o) { return o.src === this.src && o.tipo === this.tipo; }
    get estimatedHeight() { return this.tipo === 'imagem' || this.tipo === 'embed-inline' || this.tipo === 'math-inline' ? -1 : this.linhas * 26; }
    toDOM(view) {
      var self = this;
      var bloco = this.tipo !== 'imagem' && this.tipo !== 'embed-inline' && this.tipo !== 'math-inline';
      var el = document.createElement(bloco ? 'div' : 'span');
      el.className = 'cm-trecho cm-trecho-' + this.tipo + ' markdown-preview';
      // Propriedades editaveis: o app reescreve o bloco inteiro por aqui.
      var trocar = this.tipo === 'propriedades' && !view.state.readOnly ? function (novo) {
        var de = view.posAtDOM(el);
        if (view.state.doc.sliceString(de, de + self.src.length) !== self.src) return false;
        view.dispatch({ changes: { from: de, to: de + self.src.length, insert: novo }, userEvent: 'input.propriedades' });
        return true;
      } : null;
      try { this.ctx.renderTrecho(el, this.src, this.tipo, null, trocar); }
      catch (err) { el.textContent = this.src; }
      el.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('a,[data-wikilink],[data-file],[data-external],[data-tag],[data-anchor],[data-copy],[data-remote],input,button,select,summary,video,audio,iframe,.callout-fold,.fold-chevron,.prop-form')) return;
        e.preventDefault();
        var pos = self.posDoClique(view, e, el);
        view.dispatch({ selection: { anchor: pos }, effects: efAtualiza.of(null) });
        view.focus();
      });
      // Imagem e embed mudam de altura quando carregam: o editor remede.
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () { view.requestMeasure(); });
        ro.observe(el);
        el._ro = ro;
      }
      return el;
    }
    destroy(el) { if (el && el._ro) el._ro.disconnect(); }
    // Clique numa celula da tabela leva o cursor para a mesma celula do texto.
    posDoClique(view, e, el) {
      var de = view.posAtDOM(el);
      if (this.tipo !== 'tabela') return de;
      var celula = e.target.closest && e.target.closest('td,th');
      var linhaEl = celula && celula.parentElement;
      if (!celula || !linhaEl) return de;
      var corpo = linhaEl.parentElement && linhaEl.parentElement.tagName === 'TBODY';
      var idxLinha = Array.prototype.indexOf.call(linhaEl.parentElement.children, linhaEl);
      var idxCol = Array.prototype.indexOf.call(linhaEl.children, celula);
      var linhasTxt = this.src.split('\n');
      var alvo = corpo ? idxLinha + 2 : 0;
      if (alvo >= linhasTxt.length) return de;
      var off = 0;
      for (var i = 0; i < alvo; i++) off += linhasTxt[i].length + 1;
      return Math.min(de + off + posDaCelula(linhasTxt[alvo], idxCol), view.state.doc.length);
    }
    ignoreEvent() { return true; }
  }

  // Rodape do ao vivo: as mencoes (backlinks) no fim da nota, como no leitor.
  // O app desenha; versao nova (efAtualizaRodape) troca o widget.
  var efAtualizaRodape = S.StateEffect.define();
  class Rodape extends WidgetType {
    constructor(ctx, versao) { super(); this.ctx = ctx; this.versao = versao; }
    eq(o) { return o.versao === this.versao; }
    get estimatedHeight() { return 80; }
    toDOM() {
      var el = document.createElement('div');
      el.className = 'cm-rodape markdown-preview';
      try { if (this.ctx.rodape) this.ctx.rodape(el); } catch (err) { el.textContent = ''; }
      return el;
    }
    ignoreEvent() { return true; }
  }
  function campoRodape(ctx) {
    var versao = 0;
    function monta(state) {
      return Decoration.set([Decoration.widget({ widget: new Rodape(ctx, versao), block: true, side: 1 }).range(state.doc.length)]);
    }
    return S.StateField.define({
      create: function (state) { return monta(state); },
      update: function (v, tr) {
        if (tr.effects.some(function (ef) { return ef.is(efAtualizaRodape); })) { versao++; return monta(tr.state); }
        return tr.docChanged ? monta(tr.state) : v;
      },
      provide: function (f) { return EditorView.decorations.from(f); }
    });
  }

  // Deslocamento do inicio do texto da celula n (0-based) numa linha de tabela.
  function posDaCelula(txt, n) {
    var p = 0;
    var comBarra = /^\s*\|/.test(txt);
    if (comBarra) p = txt.indexOf('|') + 1;
    var col = 0;
    for (; p < txt.length && col < n; p++) {
      var c = txt.charAt(p);
      if (c === '\\') { p++; continue; }
      if (c === '|') col++;
    }
    while (txt.charAt(p) === ' ') p++;
    return Math.min(p, txt.length);
  }

  // =================================================================
  // 6. Decoracoes de linha que valem nos dois modos (titulo, codigo,
  //    citacao, lista, tarefa feita) e as do ao vivo.
  // =================================================================

  var marcaOculta = Decoration.replace({});
  var TAGS_EM_LINHA = { kbd: 1, mark: 1, u: 1, ins: 1, sub: 1, sup: 1, s: 1, del: 1, small: 1, b: 1, strong: 1, i: 1, em: 1, code: 1, abbr: 1, q: 1, samp: 1, var: 1, cite: 1, dfn: 1 };

  function classeTitulo(nome) {
    var m = /^(ATX|Setext)Heading(\d)$/.exec(nome);
    return m ? Number(m[2]) : 0;
  }

  function colunas(txt) {
    var c = 0;
    for (var i = 0; i < txt.length; i++) c += txt.charAt(i) === '\t' ? 4 - (c % 4) : 1;
    return c;
  }

  // Mede texto com a fonte do conteudo do editor (cache por fonte).
  var medidorCache = { fonte: null, fn: null };
  function medidor(view) {
    var cs = getComputedStyle(view.contentDOM);
    var fonte = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if (medidorCache.fonte === fonte && medidorCache.fn) return medidorCache.fn;
    var cv = document.createElement('canvas').getContext('2d');
    cv.font = fonte;
    var tab = cv.measureText('    ').width;
    var fn = function (txt) { return txt ? cv.measureText(String(txt).replace(/\t/g, '    ')).width : 0; };
    fn.em = parseFloat(cs.fontSize) || 16;
    void tab;
    medidorCache = { fonte: fonte, fn: fn };
    return fn;
  }

  // Constroi as decoracoes da area visivel. vivo=false: so as de linha.
  function montaDecoracoes(view, ctx, vivo) {
    var state = view.state;
    var doc = state.doc;
    var deco = [];
    var tree = L.syntaxTree(state);
    var linhaVista = Object.create(null);

    function linhaClasse(pos, cls, attrs) {
      var l = doc.lineAt(pos);
      var chave = l.from + ':' + cls;
      if (linhaVista[chave]) return;
      linhaVista[chave] = true;
      var spec = { class: cls };
      if (attrs) spec.attributes = attrs;
      deco.push(Decoration.line(spec).range(l.from));
    }
    var ocultas = [];
    var feitos = Object.create(null);
    function esconde(de, ate) {
      if (ate <= de || feitos['o' + de + ':' + ate]) return;
      feitos['o' + de + ':' + ate] = true;
      var r = marcaOculta.range(de, ate);
      deco.push(r); ocultas.push(r);
    }
    function troca(de, ate, widget) {
      if (ate <= de || feitos['w' + de + ':' + ate]) return;
      feitos['w' + de + ':' + ate] = true;
      var r = Decoration.replace({ widget: widget }).range(de, ate);
      deco.push(r); ocultas.push(r);
    }
    function marca(de, ate, spec) {
      if (ate <= de || feitos['m' + de + ':' + ate]) return;
      feitos['m' + de + ':' + ate] = true;
      deco.push(Decoration.mark(spec).range(de, ate));
    }

    // HTML em linha (<kbd>, <mark>, <sub>...): como no Obsidian, as tags somem
    // fora do cursor e o texto entre elas ganha o efeito. So tags simples,
    // abertas e fechadas no mesmo bloco.
    function htmlEmLinha(pai) {
      if (!vivo) return;
      var pilha = [];
      for (var c = pai.firstChild; c; c = c.nextSibling) {
        if (c.name !== 'HTMLTag') continue;
        var txt = doc.sliceString(c.from, c.to);
        var m = /^<(\/?)([a-z]+)\s*>$/i.exec(txt);
        if (!m || !TAGS_EM_LINHA[m[2].toLowerCase()]) continue;
        var tag = m[2].toLowerCase();
        if (!m[1]) { pilha.push({ tag: tag, no: c }); continue; }
        for (var k = pilha.length - 1; k >= 0; k--) {
          if (pilha[k].tag !== tag) continue;
          var abre = pilha[k].no;
          pilha.length = k;
          if (revela(state, abre.from, c.to)) break;
          esconde(abre.from, abre.to);
          esconde(c.from, c.to);
          marca(abre.to, c.from, { class: 'cm-html-' + tag });
          break;
        }
      }
    }

    view.visibleRanges.forEach(function (faixa) {
      tree.iterate({
        from: faixa.from,
        to: faixa.to,
        enter: function (no) {
          var nome = no.name;
          var nivel = classeTitulo(nome);
          if (nivel) {
            htmlEmLinha(no.node);
            linhaClasse(no.from, 'cm-linha-h cm-linha-h' + nivel);
            if (vivo && !revelaLinha(state, no.from)) {
              var hm = no.node.getChild('HeaderMark');
              if (hm && nome.charAt(0) === 'A') {
                var depois = doc.sliceString(hm.to, hm.to + 1) === ' ' ? hm.to + 1 : hm.to;
                esconde(hm.from, depois);
                // '## Titulo ##': o fechamento opcional tambem some.
                var marcas = no.node.getChildren('HeaderMark');
                if (marcas.length > 1) {
                  var ult = marcas[marcas.length - 1];
                  var ini = ult.from;
                  while (ini > hm.to && doc.sliceString(ini - 1, ini) === ' ') ini--;
                  esconde(ini, ult.to);
                }
              } else if (hm) {
                esconde(hm.from, hm.to);
              }
            }
            return;
          }

          switch (nome) {
            case 'FencedCode':
            case 'CodeBlock': {
              var primeira = doc.lineAt(no.from), ultima = doc.lineAt(no.to);
              for (var n = primeira.number; n <= ultima.number; n++) {
                var ln = doc.line(n);
                var cls = 'cm-linha-codigo';
                if (n === primeira.number) cls += ' cm-codigo-inicio';
                if (n === ultima.number) cls += ' cm-codigo-fim';
                linhaClasse(ln.from, cls);
              }
              if (vivo && nome === 'FencedCode' && !revela(state, no.from, no.to)) {
                var info = no.node.getChild('CodeInfo');
                var lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : '';
                var marcasC = no.node.getChildren('CodeMark');
                var fechada = marcasC.length > 1 && ultima.number > primeira.number;
                if (primeira.to > primeira.from) troca(primeira.from, primeira.to, new Rotulo(ctx, lang));
                if (fechada && ultima.to > ultima.from) esconde(ultima.from, ultima.to);
              }
              return false;
            }
            case 'Blockquote': {
              var lq1 = doc.lineAt(no.from), lq2 = doc.lineAt(no.to);
              for (var q = lq1.number; q <= lq2.number; q++) {
                var lq = doc.line(q);
                var mq = /^(\s*>\s?)+/.exec(lq.text);
                var prof = mq ? (mq[0].match(/>/g) || []).length : 1;
                linhaClasse(lq.from, 'cm-linha-citacao', { style: '--prof:' + prof });
                if (vivo && mq && !revela(state, lq.from, lq.to)) esconde(lq.from, lq.from + mq[0].length);
              }
              return;
            }
            case 'ListItem': {
              var mk = no.node.getChild('ListMark');
              if (!mk) return;
              var lLi = doc.lineAt(mk.from);
              var recuo = colunas(doc.sliceString(lLi.from, mk.from));
              var tamMarca = mk.to - mk.from + 1;
              var task = no.node.getChild('Task');
              var tm = task && task.getChild('TaskMarker');
              // O GFM so conhece [ ] e [x]; os estados do Obsidian ([?], [/],
              // [-], [>]...) viram tarefa aqui, como no leitor.
              if (!tm) {
                var outro = /^ \[([^\]\s\\])\](?= |$)/.exec(doc.sliceString(mk.to, Math.min(lLi.to, mk.to + 6)));
                if (outro) tm = { from: mk.to + 1, to: mk.to + 4 };
              }
              var estadoTarefa = tm ? doc.sliceString(tm.from + 1, tm.from + 2) : '';
              if (/^[xX]$/.test(estadoTarefa)) linhaClasse(lLi.from, 'cm-tarefa-feita');
              else if (/^[-~]$/.test(estadoTarefa)) linhaClasse(lLi.from, 'cm-tarefa-cancelada');
              // Recuo pendurado: a linha que quebra comeca onde comeca o texto
              // do item. Medido com a fonte do editor (o recuo em espacos e o
              // numero sao texto; a bala e a caixa tem largura fixa).
              var w = 0;
              if (vivo) {
                var mede = medidor(view);
                var marcaTxt = doc.sliceString(mk.from, mk.to);
                w = mede(doc.sliceString(lLi.from, mk.from)) +
                  (tm && /^\d/.test(marcaTxt) ? mede(marcaTxt + ' ') + mede.em * 1.6
                    : tm ? mede.em * 1.6
                    : /^\d/.test(marcaTxt) ? mede(marcaTxt + ' ')
                    : mede.em * 1.2);
              }
              linhaClasse(lLi.from, 'cm-linha-lista', vivo ? { style: 'padding-left:' + w.toFixed(1) + 'px;text-indent:-' + w.toFixed(1) + 'px' } : null);
              if (!vivo) return;
              var ordenada = /^\d/.test(doc.sliceString(mk.from, mk.to));
              if (tm && tm.from === mk.to + 1) {
                var fimTarefa = doc.sliceString(tm.to, tm.to + 1) === ' ' ? tm.to + 1 : tm.to;
                if (!revela(state, mk.from, tm.to)) {
                  var ch = doc.sliceString(tm.from + 1, tm.from + 2);
                  var marcada = ch !== ' ';
                  if (ordenada) {
                    marca(mk.from, mk.to, { class: 'cm-lista-num' });
                    troca(tm.from, fimTarefa, new Caixa(ctx, marcada, ch));
                  } else {
                    troca(mk.from, fimTarefa, new Caixa(ctx, marcada, ch));
                  }
                }
                return;
              }
              if (ordenada) { marca(mk.from, mk.to, { class: 'cm-lista-num' }); return; }
              if (!revela(state, mk.from, mk.to)) {
                var fimMarca = doc.sliceString(mk.to, mk.to + 1) === ' ' ? mk.to + 1 : mk.to;
                troca(mk.from, fimMarca, new Bala(Math.floor(recuo / 2)));
              }
              return;
            }
            case 'HorizontalRule': {
              linhaClasse(no.from, 'cm-linha-hr');
              if (vivo && !revela(state, no.from, no.to)) troca(no.from, no.to, new Regua());
              return;
            }
            case 'MathBloco': {
              var m1 = doc.lineAt(no.from), m2 = doc.lineAt(no.to);
              for (var mm = m1.number; mm <= m2.number; mm++) linhaClasse(doc.line(mm).from, 'cm-linha-math');
              return false;
            }
            case 'Frontmatter': {
              var f1 = doc.lineAt(no.from), f2 = doc.lineAt(no.to);
              for (var ff = f1.number; ff <= f2.number; ff++) linhaClasse(doc.line(ff).from, 'cm-linha-propriedades');
              return false;
            }
            case 'Table': {
              var t1 = doc.lineAt(no.from), t2 = doc.lineAt(no.to);
              for (var tt = t1.number; tt <= t2.number; tt++) linhaClasse(doc.line(tt).from, 'cm-linha-tabela');
              return;
            }
          }

          if (!vivo) return;

          switch (nome) {
            case 'Paragraph':
              htmlEmLinha(no.node);
              return;
            case 'Emphasis':
            case 'StrongEmphasis':
            case 'Strikethrough':
            case 'Destaque':
            case 'InlineCode': {
              if (revela(state, no.from, no.to)) return;
              var c = no.node.firstChild;
              for (; c; c = c.nextSibling) {
                if (/Mark$/.test(c.name) && c.name !== 'ListMark') esconde(c.from, c.to);
              }
              return;
            }
            case 'Escape': {
              if (!revelaLinha(state, no.from)) esconde(no.from, no.from + 1);
              return;
            }
            case 'Link': {
              var marcasL = no.node.getChildren('LinkMark');
              var url = no.node.getChild('URL');
              var rotulo = no.node.getChild('LinkLabel');
              if (marcasL.length < 2 || (!url && !rotulo)) return;
              var abre = marcasL[0], fechaTxt = marcasL[1];
              var alvo = url ? doc.sliceString(url.from, url.to) : '';
              if (revela(state, no.from, no.to)) return false;
              esconde(no.from, abre.to);
              esconde(fechaTxt.from, no.to);
              var attrs = atributosDoLink(alvo);
              marca(abre.to, fechaTxt.from, { class: 'cm-lp-link' + (attrs['data-external'] ? ' is-externo' : ''), attributes: attrs });
              return false;
            }
            case 'Autolink': {
              if (revela(state, no.from, no.to)) return false;
              var u = no.node.getChild('URL');
              if (!u) return false;
              esconde(no.from, u.from);
              esconde(u.to, no.to);
              marca(u.from, u.to, { class: 'cm-lp-link is-externo', attributes: atributosDoLink(doc.sliceString(u.from, u.to)) });
              return false;
            }
            case 'URL': {
              var pai = no.node.parent;
              if (pai && (pai.name === 'Link' || pai.name === 'Image' || pai.name === 'Autolink' || pai.name === 'LinkReference')) return;
              marca(no.from, no.to, { class: 'cm-lp-link is-externo', attributes: atributosDoLink(doc.sliceString(no.from, no.to)) });
              return;
            }
            case 'WikiLink': {
              if (revela(state, no.from, no.to)) return false;
              var alvoN = no.node.getChild('WikiAlvo');
              var apelido = no.node.getChild('WikiApelido');
              var barra = no.node.getChild('WikiBarra');
              var alvoTxt = alvoN ? doc.sliceString(alvoN.from, alvoN.to) : '';
              esconde(no.from, no.from + 2);
              esconde(no.to - 2, no.to);
              var txtDe, txtAte;
              if (apelido) {
                esconde(no.from + 2, apelido.from);
                txtDe = apelido.from; txtAte = apelido.to;
              } else if (barra) {
                esconde(barra.from, barra.to);
                txtDe = alvoN ? alvoN.from : no.from + 2; txtAte = alvoN ? alvoN.to : barra.from;
              } else {
                txtDe = no.from + 2; txtAte = no.to - 2;
                if (alvoTxt.charAt(0) === '#') { esconde(txtDe, txtDe + 1); txtDe += 1; }
              }
              var existe = ctx.wikiExiste ? ctx.wikiExiste(alvoTxt) : true;
              marca(txtDe, txtAte, {
                class: 'cm-lp-wikilink' + (existe === false ? ' is-unresolved' : ''),
                attributes: { 'data-wikilink': alvoTxt.replace(/\\$/, '') }
              });
              return false;
            }
            case 'Image':
            case 'Embed': {
              if (revela(state, no.from, no.to)) return false;
              // Paragrafo de uma linha so com ele: quem desenha e a camada
              // de blocos. Qualquer outro caso fica em linha (com o texto, ou
              // sozinho numa linha de um paragrafo maior).
              if (paragrafoSoDeMidia(no.node, doc)) return false;
              troca(no.from, no.to, new Trecho(ctx, doc.sliceString(no.from, no.to), nome === 'Image' ? 'imagem' : 'embed-inline', 1));
              return false;
            }
            case 'Hashtag': {
              marca(no.from, no.to, { class: 'cm-lp-tag', attributes: { 'data-tag': doc.sliceString(no.from + 1, no.to) } });
              return;
            }
            case 'MathInline': {
              // Formula desenhada (KaTeX) fora do cursor; dentro, o TeX.
              if (revela(state, no.from, no.to)) return false;
              troca(no.from, no.to, new Trecho(ctx, doc.sliceString(no.from, no.to), 'math-inline', 1));
              return false;
            }
          }
        }
      });
    });

    return { todas: Decoration.set(deco, true), ocultas: Decoration.set(ocultas, true) };
  }

  // Imagem ou embed que e o paragrafo inteiro, numa linha so, no primeiro
  // nivel do documento: vira bloco. A mesma regra decide nas duas camadas.
  function paragrafoSoDeMidia(no, doc) {
    if (!no || (no.name !== 'Image' && no.name !== 'Embed')) return false;
    var par = no.parent;
    if (!par || par.name !== 'Paragraph' || !par.parent || par.parent.name !== 'Document') return false;
    if (par.firstChild.from !== no.from || no.nextSibling) return false;
    var lin = doc.lineAt(par.from);
    if (doc.lineAt(par.to).number !== lin.number) return false;
    return lin.text.trim() === doc.sliceString(no.from, no.to);
  }

  function atributosDoLink(alvo) {
    var a = String(alvo || '').trim();
    if (a.charAt(0) === '<' && a.charAt(a.length - 1) === '>') a = a.slice(1, -1);
    if (/^(https?:|mailto:|ftp:)/i.test(a)) return { 'data-external': a };
    if (/^www\./i.test(a)) return { 'data-external': 'https://' + a };
    if (a.charAt(0) === '#') return { 'data-anchor': a.slice(1) };
    return { 'data-file': a };
  }

  function pluginDecoracoes(ctx, vivo) {
    return V.ViewPlugin.fromClass(function (view) {
      var r0 = montaDecoracoes(view, ctx, vivo);
      this.decorations = r0.todas;
      this.ocultas = r0.ocultas;
      this.pendente = false;
      this.update = function (u) {
        var arvore = L.syntaxTree(u.startState) !== L.syntaxTree(u.state);
        var forcado = u.transactions.some(function (tr) { return tr.effects.some(function (e) { return e.is(efAtualiza) || e.is(efFoco) || e.is(efAchados) || e.is(efPonteiro); }); });
        if (!(u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || arvore || forcado)) return;
        if (vivo && (u.state.field(campoPonteiro) || u.view.composing)) {
          this.decorations = this.decorations.map(u.changes);
          this.ocultas = this.ocultas.map(u.changes);
          this.pendente = true;
          return;
        }
        this.pendente = false;
        var r = montaDecoracoes(u.view, ctx, vivo);
        this.decorations = r.todas;
        this.ocultas = r.ocultas;
      };
    }, { decorations: function (v) { return v.decorations; } });
  }

  // Tabela, callout, HTML, propriedades e embed sozinho na linha: blocos
  // inteiros trocados pelo desenho do leitor. Decoracao de bloco so pode
  // vir de StateField (regra do CodeMirror).
  function campoBlocos(ctx) {
    function bloco(deco, state, no, tipo) {
      var doc = state.doc;
      var l1 = doc.lineAt(no.from), l2 = doc.lineAt(no.to);
      // Linha final em branco nao faz parte do bloco desenhado.
      var ate = l2.text.trim() === '' && l2.number > l1.number ? doc.line(l2.number - 1).to : l2.to;
      if (revela(state, l1.from, ate)) return;
      deco.push(Decoration.replace({
        widget: new Trecho(ctx, doc.sliceString(l1.from, ate), tipo, l2.number - l1.number + 1),
        block: true
      }).range(l1.from, ate));
    }
    // So os blocos de topo: tabela, callout, HTML, propriedades e imagem ou
    // embed sozinhos na linha. Andar so no primeiro nivel da arvore deixa a
    // conta barata mesmo em documento grande.
    function monta(state) {
      var doc = state.doc;
      var deco = [];
      var no = L.syntaxTree(state).topNode.firstChild;
      for (; no; no = no.nextSibling) {
        var nome = no.name;
        if (nome === 'Table') bloco(deco, state, no, 'tabela');
        else if (nome === 'Frontmatter') bloco(deco, state, no, 'propriedades');
        else if (nome === 'MathBloco') bloco(deco, state, no, 'math');
        else if (nome === 'FencedCode') {
          // ```query: a busca incorporada vira a lista de resultados.
          var info = no.node ? no.node.getChild('CodeInfo') : no.getChild('CodeInfo');
          if (info && doc.sliceString(info.from, info.to).trim().toLowerCase() === 'query') bloco(deco, state, no, 'query');
        }
        else if (nome === 'HTMLBlock') {
          if (doc.sliceString(no.from, Math.min(no.to, no.from + 4)) !== '<!--') bloco(deco, state, no, 'html');
        } else if (nome === 'Blockquote') {
          if (/^\s*>\s*\[![^\]]+\]/.test(doc.lineAt(no.from).text)) bloco(deco, state, no, 'callout');
        } else if (nome === 'Paragraph') {
          var filho = no.firstChild;
          if (!filho || !paragrafoSoDeMidia(filho, doc)) continue;
          var lin = doc.lineAt(no.from);
          if (revela(state, lin.from, lin.to)) continue;
          deco.push(Decoration.replace({
            widget: new Trecho(ctx, doc.sliceString(filho.from, filho.to), filho.name === 'Image' ? 'imagem-bloco' : 'embed', 3),
            block: true
          }).range(lin.from, lin.to));
        }
      }
      return Decoration.set(deco, true);
    }
    return S.StateField.define({
      create: function (state) { return monta(state); },
      update: function (v, tr) {
        if (tr.state.field(campoPonteiro)) return v.map(tr.changes);
        var arvore = L.syntaxTree(tr.startState) !== L.syntaxTree(tr.state);
        var forcado = tr.effects.some(function (e) { return e.is(efAtualiza) || e.is(efFoco) || e.is(efAchados) || e.is(efPonteiro); });
        if (tr.docChanged || tr.selection || arvore || forcado) return monta(tr.state);
        return v;
      },
      provide: function (f) { return EditorView.decorations.from(f); }
    });
  }

  // O cursor nunca para dentro de um marcador escondido: as partes trocadas
  // por nada contam como atomicas (as setas pulam por cima). Ao encostar,
  // a revelacao devolve os marcadores.
  function intervalosAtomicos(plugin) {
    return EditorView.atomicRanges.of(function (view) {
      var p = view.plugin(plugin);
      return p ? p.ocultas : Decoration.none;
    });
  }

  // =================================================================
  // 7. Teclas e comandos de Markdown.
  // =================================================================

  // Ctrl+B/I/Shift+H: liga e desliga a marca. Sem selecao pega a palavra;
  // ja marcada (por dentro ou por fora), tira; espacos ficam de fora.
  function alternaMarca(marca) {
    return function (view) {
      if (view.state.readOnly) return false;
      var state = view.state, doc = state.doc;
      var tam = marca.length;
      var tr = state.changeByRange(function (r) {
        var de = r.from, ate = r.to;
        if (de === ate) {
          var palavra = state.wordAt(de);
          if (palavra) { de = palavra.from; ate = palavra.to; }
        }
        // espacos nas pontas ficam fora da marca
        while (de < ate && /\s/.test(doc.sliceString(de, de + 1))) de++;
        while (ate > de && /\s/.test(doc.sliceString(ate - 1, ate))) ate--;
        var antes = doc.sliceString(Math.max(0, de - tam), de);
        var depois = doc.sliceString(ate, ate + tam);
        if (antes === marca && depois === marca && !(marca === '*' && doc.sliceString(Math.max(0, de - 2), de) === '**' && doc.sliceString(ate, ate + 2) === '**' && doc.sliceString(Math.max(0, de - 3), de) !== '***')) {
          return {
            changes: [{ from: de - tam, to: de, insert: '' }, { from: ate, to: ate + tam, insert: '' }],
            range: S.EditorSelection.range(r.anchor === r.from ? de - tam : ate - tam, r.anchor === r.from ? ate - tam : de - tam)
          };
        }
        var miolo = doc.sliceString(de, ate);
        if (miolo.length >= 2 * tam && miolo.slice(0, tam) === marca && miolo.slice(-tam) === marca) {
          return {
            changes: [{ from: de, to: de + tam, insert: '' }, { from: ate - tam, to: ate, insert: '' }],
            range: S.EditorSelection.range(de, ate - 2 * tam)
          };
        }
        if (de === ate) {
          return { changes: { from: de, insert: marca + marca }, range: S.EditorSelection.cursor(de + tam) };
        }
        return {
          changes: [{ from: de, insert: marca }, { from: ate, insert: marca }],
          range: S.EditorSelection.range(de + tam, ate + tam)
        };
      });
      view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.formatar' }));
      return true;
    };
  }

  var RE_URL_SO = /^\s*(https?:\/\/|www\.)\S+\s*$/i;

  function insereLink(view) {
    if (view.state.readOnly) return false;
    var state = view.state;
    var tr = state.changeByRange(function (r) {
      var sel = state.doc.sliceString(r.from, r.to);
      if (sel && RE_URL_SO.test(sel)) {
        return { changes: { from: r.from, to: r.to, insert: '[](' + sel.trim() + ')' }, range: S.EditorSelection.cursor(r.from + 1) };
      }
      var txt = '[' + sel + '](url)';
      return {
        changes: { from: r.from, to: r.to, insert: txt },
        range: sel ? S.EditorSelection.range(r.from + sel.length + 3, r.from + sel.length + 6) : S.EditorSelection.cursor(r.from + 1)
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.formatar' }));
    return true;
  }

  // Tab: no meio do texto insere 4 espacos (como sempre foi no MarkPad);
  // em item de lista, ou com selecao de varias linhas, recua as linhas.
  function tecladoTab(view) {
    if (view.state.readOnly) return false;
    var state = view.state;
    var r = state.selection.main;
    var linha = state.doc.lineAt(r.from);
    var varias = state.doc.lineAt(r.to).number !== linha.number;
    var lista = /^\s*([-*+]|\d{1,9}[.)])\s/.test(linha.text);
    if (varias || (lista && r.empty && r.from <= linha.from + linha.text.search(/\S|$/) + 6) || state.selection.ranges.length > 1 && lista) {
      return C.indentMore(view);
    }
    if (lista && r.empty) return C.indentMore(view);
    view.dispatch(state.replaceSelection('    '), { scrollIntoView: true, userEvent: 'input' });
    return true;
  }

  function tecladoShiftTab(view) {
    if (view.state.readOnly) return false;
    return C.indentLess(view);
  }

  // Enter que continua lista, tarefa e citacao (regras do CodeMirror para
  // Markdown, que sao as do Obsidian: numero + 1, tarefa sempre desmarcada,
  // item vazio aninhado volta um nivel, item vazio no nivel zero sai da lista).
  function tecladoEnter(view) {
    if (view.state.readOnly) return false;
    var st = view.state;
    if (st.selection.ranges.length === 1 && st.selection.main.empty) {
      var pos = st.selection.main.head;
      var linha = st.doc.lineAt(pos);
      if (pos === linha.to) {
        var vazio = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[.\]\s*)?$/.exec(linha.text) || /^(\s*)(>[\s>]*)$/.exec(linha.text);
        if (vazio) {
          // Item vazio aninhado volta um nivel; no nivel zero, sai da lista
          // (ou da citacao) e a linha fica limpa.
          if (vazio[1] && vazio[2].charAt(0) !== '>') return C.indentLess(view);
          view.dispatch({ changes: { from: linha.from, to: linha.to, insert: '' }, userEvent: 'delete' });
          return true;
        }
      }
    }
    if (MD.insertNewlineContinueMarkup(view)) return true;
    return C.insertNewlineAndIndent(view);
  }

  // Lista numerada se renumera sozinha depois de qualquer edicao (apagar,
  // mover ou colar item), como no Obsidian. Desfazer volta as duas coisas.
  var anotRenumera = S.Annotation.define();
  var renumeraListas = EditorState.transactionFilter.of(function (tr) {
    if (!tr.docChanged || tr.annotation(anotRenumera) || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.annotation(anotExterna)) return tr;
    var st = tr.state;
    var tree = L.syntaxTree(st);
    var mudancas = [];
    var vistas = Object.create(null);
    tr.changes.iterChangedRanges(function (fa, ta, fb, tb) {
      tree.iterate({
        from: Math.max(0, fb - 1),
        to: Math.min(st.doc.length, tb + 1),
        enter: function (no) {
          if (no.name !== 'OrderedList' || vistas[no.from]) return;
          vistas[no.from] = true;
          var n = null;
          for (var item = no.node.firstChild; item; item = item.nextSibling) {
            if (item.name !== 'ListItem') continue;
            var mk = item.getChild('ListMark');
            if (!mk) continue;
            var txt = st.doc.sliceString(mk.from, mk.to);
            var m = /^(\d{1,9})([.)])$/.exec(txt);
            if (!m) continue;
            if (n === null) { n = parseInt(m[1], 10); continue; }
            n++;
            if (String(n) + m[2] !== txt) mudancas.push({ from: mk.from, to: mk.to, insert: String(n) + m[2] });
          }
        }
      });
    });
    if (!mudancas.length) return tr;
    return [tr, { changes: mudancas, sequential: true, annotations: anotRenumera.of(true) }];
  });

  // Tabela aberta em texto: Tab e Shift+Tab andam de celula em celula, Enter
  // desce para a linha de baixo (criando uma nova no fim), e a tabela se
  // realinha a cada passo, como no editor de tabelas do Obsidian.
  function tabelaNoCursor(state) {
    var pos = state.selection.main.head;
    var no = L.syntaxTree(state).resolveInner(pos, -1);
    for (; no; no = no.parent) if (no.name === 'Table') return no;
    no = L.syntaxTree(state).resolveInner(pos, 1);
    for (; no; no = no.parent) if (no.name === 'Table') return no;
    return null;
  }

  function navegaTabela(passo, desce) {
    return function (view) {
      var st = view.state;
      var Tx = global.MarkPadTextOps;
      if (st.readOnly || st.selection.ranges.length > 1 || !Tx || !Tx.formataTabela) return false;
      var tabela = tabelaNoCursor(st);
      if (!tabela) return false;
      var doc = st.doc;
      var l1 = doc.lineAt(tabela.from), l2 = doc.lineAt(tabela.to);
      var ultima = l2.text.trim() === '' && l2.number > l1.number ? l2.number - 1 : l2.number;
      var head = st.selection.main.head;
      var lc = doc.lineAt(head);
      if (lc.number > ultima) return false;
      var linha = lc.number - l1.number;
      var col = Tx.colunaNaLinha(lc.text, head - lc.from);
      var de = l1.from, ate = doc.line(ultima).to;
      var original = doc.sliceString(de, ate);
      var novo = Tx.formataTabela(original);
      var linhas = novo.split('\n');
      var ncol = Tx.celulasDaLinha(linhas[0]).length;
      var alvoL = linha, alvoC = Math.min(col, ncol - 1);
      if (desce) alvoL = linha + 1;
      else {
        alvoC = col + passo;
        if (alvoC >= ncol) { alvoC = 0; alvoL = linha + 1; }
        else if (alvoC < 0) { alvoC = ncol - 1; alvoL = linha - 1; }
      }
      if (alvoL === 1) alvoL = passo < 0 && !desce ? 0 : 2;
      if (alvoL < 0) { alvoL = 0; alvoC = 0; }
      if (alvoL >= linhas.length) {
        novo = Tx.formataTabela(novo + '\n|' + new Array(ncol + 1).join('  |'));
        linhas = novo.split('\n');
        alvoL = linhas.length - 1;
        if (!desce) alvoC = 0;
      }
      var off = 0;
      for (var i = 0; i < alvoL; i++) off += linhas[i].length + 1;
      var faixa = Tx.faixaDaCelula(linhas[alvoL], alvoC);
      view.dispatch({
        changes: novo !== original ? { from: de, to: ate, insert: novo } : [],
        selection: { anchor: de + off + faixa.ini, head: de + off + faixa.fim },
        scrollIntoView: true,
        userEvent: 'input'
      });
      return true;
    };
  }

  // Com texto selecionado, digitar uma marca de Markdown envolve a selecao
  // (como o "pares de Markdown" do Obsidian). Sem selecao, nada muda.
  var MARCAS_ENVOLVE = { '*': '*', '_': '_', '=': '=', '~': '~', '$': '$', '%': '%' };
  var envolveAoDigitar = EditorView.inputHandler.of(function (view, de, ate, texto) {
    if (view.state.readOnly || !MARCAS_ENVOLVE[texto] || view.composing) return false;
    var sel = view.state.selection;
    if (sel.ranges.every(function (r) { return r.empty; })) return false;
    var fecha = MARCAS_ENVOLVE[texto];
    var tr = view.state.changeByRange(function (r) {
      if (r.empty) return { changes: { from: r.from, insert: texto }, range: S.EditorSelection.cursor(r.from + texto.length) };
      return {
        changes: [{ from: r.from, insert: texto }, { from: r.to, insert: fecha }],
        range: S.EditorSelection.range(r.anchor + texto.length, r.head + texto.length)
      };
    });
    view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: 'input.type' }));
    return true;
  });

  // HTML colado vira Markdown (navegador, Teams, Outlook, Word, Google Docs).
  // So quando o HTML tem estrutura de verdade: codigo copiado do VS Code vem
  // como <div><span> coloridos e deve entrar como texto puro.
  var RE_HTML_ESTRUTURA = /<(p|h[1-6]|ul|ol|li|table|tr|td|th|a|strong|b|em|i|u|s|del|strike|code|pre|img|blockquote|hr|br)[\s>\/]/i;

  var conversor = null;
  function obtemConversor() {
    if (conversor || !CM.TurndownService) return conversor;
    var td = new CM.TurndownService({
      headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced',
      emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined'
    });
    if (CM.turndownGfm) td.use(CM.turndownGfm);
    td.remove(['style', 'script', 'meta', 'title', 'head']);
    // Item de lista com um espaco depois do marcador, como o Obsidian escreve.
    td.addRule('itemDeLista', {
      filter: 'li',
      replacement: function (conteudo, no, opcoes) {
        conteudo = conteudo.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
        var prefixo = opcoes.bulletListMarker + ' ';
        var pai = no.parentNode;
        var caixa = no.querySelector && no.querySelector('input[type=checkbox]');
        if (pai && pai.nodeName === 'OL') {
          var ini = pai.getAttribute('start');
          var idx = Array.prototype.indexOf.call(pai.children, no);
          prefixo = (ini ? Number(ini) + idx : idx + 1) + '. ';
        }
        if (caixa && !/^\[[ xX]\]/.test(conteudo.trim())) prefixo += (caixa.checked ? '[x] ' : '[ ] ');
        return prefixo + conteudo + (no.nextSibling && !/\n$/.test(conteudo) ? '\n' : '');
      }
    });
    // Negrito e italico feitos com estilo (Google Docs, Word online).
    td.addRule('estiloForte', {
      filter: function (no) {
        if (no.nodeName !== 'SPAN' || !no.style) return false;
        var w = no.style.fontWeight;
        return w === 'bold' || parseInt(w, 10) >= 600;
      },
      replacement: function (c) { return c.trim() ? '**' + c + '**' : c; }
    });
    td.addRule('estiloItalico', {
      filter: function (no) { return no.nodeName === 'SPAN' && no.style && no.style.fontStyle === 'italic'; },
      replacement: function (c) { return c.trim() ? '*' + c + '*' : c; }
    });
    // Imagem embutida no HTML (data:) nao vira um paredao de base64.
    td.addRule('imagemDados', {
      filter: function (no) { return no.nodeName === 'IMG' && /^data:/i.test(no.getAttribute('src') || ''); },
      replacement: function (c, no) { return no.getAttribute('alt') || ''; }
    });
    conversor = td;
    return td;
  }

  function htmlParaMarkdown(html) {
    var td = obtemConversor();
    if (!td) return null;
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    // Google Docs embrulha tudo num <b style="font-weight:normal">.
    Array.prototype.slice.call(doc.querySelectorAll('b')).forEach(function (b) {
      var w = b.style && b.style.fontWeight;
      if (w === 'normal' || w === '400') {
        while (b.firstChild) b.parentNode.insertBefore(b.firstChild, b);
        b.parentNode.removeChild(b);
      }
    });
    var md = td.turndown(doc.body || doc.documentElement);
    return md.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function emCodigoNoCursor(state) {
    var no = L.syntaxTree(state).resolveInner(state.selection.main.head, -1);
    for (; no; no = no.parent) if (/^(FencedCode|CodeBlock|InlineCode|CodeText|Frontmatter)$/.test(no.name)) return true;
    return false;
  }

  // =================================================================
  // 8. O editor.
  // =================================================================

  function create(pai, opcoes) {
    var op = opcoes || {};
    var ctx = {
      t: op.t || function (s) { return s; },
      renderTrecho: op.renderTrecho || function (el, src) { el.textContent = src; },
      wikiExiste: op.wikiExiste || null,
      rodape: op.rodape || null,
      podeEditar: function () { return !view || !view.state.readOnly; },
      travado: op.travado || null
    };

    var compModo = new S.Compartment();
    var compEditavel = new S.Compartment();
    var compQuebra = new S.Compartment();
    var compNumeros = new S.Compartment();
    var compCorretor = new S.Compartment();
    var compAutoPar = new S.Compartment();

    var conf = { modo: 'vivo', editavel: true, quebra: false, numeros: true, corretor: false, autoPar: true };

    var pluginVivo = pluginDecoracoes(ctx, true);
    var pluginFonte = pluginDecoracoes(ctx, false);
    var blocos = campoBlocos(ctx);
    var rodape = op.rodape ? campoRodape(ctx) : [];

    function extModo() {
      if (conf.modo === 'vivo') {
        return [
          pluginVivo, blocos, rodape, intervalosAtomicos(pluginVivo), linhasStatus,
          EditorView.lineWrapping,
          EditorView.editorAttributes.of({ class: 'cm-modo-vivo' })
        ];
      }
      return [
        pluginFonte, margemStatus,
        V.highlightActiveLine(),
        EditorView.editorAttributes.of({ class: 'cm-modo-fonte' })
      ];
    }
    function extEditavel() {
      return [EditorView.editable.of(conf.editavel), EditorState.readOnly.of(!conf.editavel)];
    }
    function extQuebra() { return conf.modo === 'fonte' && conf.quebra ? EditorView.lineWrapping : []; }
    function extNumeros() { return conf.modo === 'fonte' && conf.numeros ? [V.lineNumbers(), V.highlightActiveLineGutter()] : []; }
    function extCorretor() {
      return EditorView.contentAttributes.of({
        spellcheck: conf.corretor ? 'true' : 'false',
        autocorrect: 'off', autocapitalize: 'off', translate: 'no'
      });
    }
    function extAutoPar() {
      if (!conf.autoPar) return [];
      return [
        AC.closeBrackets(),
        S.Prec.high(V.keymap.of(AC.closeBracketsKeymap)),
        EditorState.languageData.of(function () { return [{ closeBrackets: { brackets: ['(', '[', '{', '"', '`'] } }]; }),
        envolveAoDigitar
      ];
    }

    var teclasMarkdown = S.Prec.high(V.keymap.of([
      { key: 'Enter', run: navegaTabela(0, true) },
      { key: 'Enter', run: tecladoEnter },
      { key: 'Backspace', run: function (v) { return !v.state.readOnly && MD.deleteMarkupBackward(v); } },
      { key: 'Tab', run: function (v) { return AC.completionStatus(v.state) === 'active' && AC.acceptCompletion(v); } },
      { key: 'Tab', run: navegaTabela(1, false), shift: navegaTabela(-1, false) },
      { key: 'Tab', run: tecladoTab, shift: tecladoShiftTab },
      { key: 'Mod-b', run: alternaMarca('**'), preventDefault: true },
      { key: 'Mod-i', run: alternaMarca('*'), preventDefault: true },
      { key: 'Mod-Shift-h', run: alternaMarca('=='), preventDefault: true },
      { key: 'Mod-k', run: insereLink, preventDefault: true },
      { key: 'Mod-/', run: function (v) { return op.alternaComentario ? op.alternaComentario() : false; }, preventDefault: true },
      { key: 'Mod-Alt-ArrowUp', run: C.addCursorAbove },
      { key: 'Mod-Alt-ArrowDown', run: C.addCursorBelow },
      { key: 'Escape', run: C.simplifySelection },
      { key: 'Mod-Enter', run: C.insertBlankLine },
      { key: 'Mod-[', run: C.indentLess },
      { key: 'Mod-]', run: C.indentMore }
    ]));

    // Clique em link: no ao vivo, clique simples na parte desenhada segue;
    // no fonte (ou com o trecho revelado), so com Ctrl.
    function linkNoEvento(e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-external],[data-file],[data-wikilink],[data-anchor],[data-tag]') : null;
      if (el && el.closest('.cm-content') && !el.closest('.cm-trecho')) return el;
      return null;
    }

    function linkNoTexto(state, pos) {
      var no = L.syntaxTree(state).resolveInner(pos, 1);
      for (; no; no = no.parent) {
        var nome = no.name, doc = state.doc;
        if (nome === 'WikiLink' || nome === 'Embed') {
          var alvo = no.getChild('WikiAlvo');
          return { 'data-wikilink': alvo ? doc.sliceString(alvo.from, alvo.to).replace(/\\$/, '') : '' };
        }
        if (nome === 'Link' || nome === 'Image') {
          var url = no.getChild('URL');
          if (url) return atributosDoLink(doc.sliceString(url.from, url.to));
          return null;
        }
        if (nome === 'URL' || nome === 'Autolink') {
          var u = nome === 'URL' ? no : no.getChild('URL');
          if (u) return atributosDoLink(doc.sliceString(u.from, u.to));
        }
        if (nome === 'Hashtag') return { 'data-tag': doc.sliceString(no.from + 1, no.to) };
        if (nome === 'Paragraph' || nome === 'Document') return null;
      }
      return null;
    }

    function elementoFalso(attrs) {
      var el = document.createElement('a');
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }

    var semFormato = false;
    var eventos = EditorView.domEventHandlers({
      mousedown: function (e, v) {
        if (e.button !== 0 && e.button !== 1) return false;
        var ctrl = e.ctrlKey || e.metaKey;
        var el = conf.modo === 'vivo' ? linkNoEvento(e) : null;
        if (el && op.abreLink) {
          e.preventDefault();
          op.abreLink(el, e);
          return true;
        }
        if (ctrl && op.abreLink) {
          var pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          var attrs = pos != null ? linkNoTexto(v.state, pos) : null;
          if (attrs) {
            e.preventDefault();
            op.abreLink(elementoFalso(attrs), e);
            return true;
          }
        }
        if (e.button === 0) {
          v.dispatch({ effects: efPonteiro.of(true) });
          var solta = function () {
            document.removeEventListener('mouseup', solta, true);
            setTimeout(function () { if (v.state.field(campoPonteiro)) v.dispatch({ effects: efPonteiro.of(false) }); }, 0);
          };
          document.addEventListener('mouseup', solta, true);
        }
        return false;
      },
      auxclick: function (e) {
        if (e.button === 1 && linkNoEvento(e)) { e.preventDefault(); return true; }
        return false;
      },
      keydown: function (e) {
        // Ctrl+Shift+V cola so o texto, sem converter HTML (como no Obsidian).
        semFormato = !!((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v'));
        return false;
      },
      paste: function (e, v) {
        var puro = semFormato;
        semFormato = false;
        if (v.state.readOnly) return false;
        var dt = e.clipboardData;
        if (!dt) return false;
        // Imagem na area de transferencia (print de tela, imagem copiada): anexo.
        var imagens = Array.prototype.filter.call(dt.files || [], function (f) { return /^image\//.test(f.type); });
        if (imagens.length && op.colaImagens) {
          e.preventDefault();
          op.colaImagens(imagens);
          return true;
        }
        var bruto = dt.getData('text/plain') || '';
        var r = v.state.selection.main;
        if (!r.empty && v.state.selection.ranges.length === 1 && op.textoColado) {
          var sel = v.state.doc.sliceString(r.from, r.to);
          var comLink = op.textoColado(sel, bruto);
          if (comLink !== bruto) {
            e.preventDefault();
            v.dispatch(v.state.replaceSelection(comLink), { userEvent: 'input.paste', scrollIntoView: true });
            return true;
          }
        }
        var html = puro ? '' : dt.getData('text/html');
        if (html && RE_HTML_ESTRUTURA.test(html) && !emCodigoNoCursor(v.state)) {
          var md = null;
          try { md = htmlParaMarkdown(html); } catch (err) { md = null; }
          if (md) {
            e.preventDefault();
            v.dispatch(v.state.replaceSelection(md), { userEvent: 'input.paste', scrollIntoView: true });
            return true;
          }
        }
        return false;
      },
      // Arquivo solto de fora (Explorer) e do app: abre como aba, nao vira
      // texto dentro da nota (o CodeMirror leria o arquivo e colaria).
      drop: function (e) {
        return !!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length);
      },
      compositionend: function (e, v) {
        setTimeout(function () { v.dispatch({ effects: efAtualiza.of(null) }); }, 60);
        return false;
      }
    });

    var ouvinte = EditorView.updateListener.of(function (u) {
      if (u.docChanged && op.aoMudar) {
        var externa = u.transactions.some(function (tr) { return tr.annotation(anotExterna); });
        op.aoMudar(u, externa);
      }
      if ((u.selectionSet || u.docChanged) && op.aoMudarSelecao) op.aoMudarSelecao(u);
      if (u.focusChanged && op.aoFoco) op.aoFoco(u.view.hasFocus);
    });

    var sugestoes = op.sugestoes ? AC.autocompletion({
      override: [].concat(op.sugestoes),
      icons: false,
      defaultKeymap: true,
      closeOnBlur: true,
      activateOnTyping: true,
      maxRenderedOptions: 60,
      optionClass: function () { return 'cm-sugestao'; }
    }) : [];

    function extensoes() {
      return [
        linguagemMarkdown(),
        L.syntaxHighlighting(estiloRealce),
        C.history(),
        V.drawSelection(),
        V.dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        V.rectangularSelection({ eventFilter: function (e) { return e.altKey && !e.ctrlKey; } }),
        V.crosshairCursor({ key: 'Alt' }),
        EditorView.clickAddsSelectionRange.of(function (e) { return (e.ctrlKey || e.metaKey) && !e.altKey; }),
        L.indentUnit.of('    '),
        EditorState.tabSize.of(4),
        EditorView.focusChangeEffect.of(function (state, focando) { return efFoco.of(focando); }),
        campoFoco, campoPonteiro, campoAchados, campoStatus,
        sugestoes,
        teclasMarkdown,
        renumeraListas,
        L.codeFolding({ placeholderDOM: function (v, aoClicar) { var s = document.createElement('span'); s.className = 'cm-dobrado'; s.textContent = '…'; s.onclick = aoClicar; return s; } }),
        L.foldGutter({ markerDOM: function (aberto) { var s = document.createElement('span'); s.className = 'cm-seta-dobra' + (aberto ? '' : ' is-fechada'); return s; } }),
        V.keymap.of(L.foldKeymap),
        V.keymap.of([].concat(C.historyKeymap, C.standardKeymap)),
        eventos,
        ouvinte,
        compModo.of(extModo()),
        compEditavel.of(extEditavel()),
        compQuebra.of(extQuebra()),
        compNumeros.of(extNumeros()),
        compCorretor.of(extCorretor()),
        compAutoPar.of(extAutoPar()),
        EditorState.phrases.of(op.frases || {})
      ];
    }

    function novoEstado(texto, sel) {
      var s = EditorState.create({ doc: texto || '', extensions: extensoes() });
      if (sel) {
        var n = s.doc.length;
        s = s.update({ selection: { anchor: Math.min(sel.anchor || 0, n), head: Math.min(sel.head == null ? sel.anchor || 0 : sel.head, n) } }).state;
      }
      return s;
    }

    var view = new EditorView({ state: novoEstado(''), parent: pai });

    function reconfigura() {
      view.dispatch({
        effects: [
          compModo.reconfigure(extModo()),
          compEditavel.reconfigure(extEditavel()),
          compQuebra.reconfigure(extQuebra()),
          compNumeros.reconfigure(extNumeros()),
          compCorretor.reconfigure(extCorretor()),
          compAutoPar.reconfigure(extAutoPar())
        ]
      });
    }

    // Troca do documento inteiro pelo texto novo com a menor mudanca possivel:
    // o cursor e o desfazer sobrevivem (recarga do disco, tarefa marcada no
    // leitor, mencao ligada por fora).
    function diferenca(antigo, novo) {
      if (antigo === novo) return null;
      var ini = 0, max = Math.min(antigo.length, novo.length);
      while (ini < max && antigo.charCodeAt(ini) === novo.charCodeAt(ini)) ini++;
      var fa = antigo.length, fn = novo.length;
      while (fa > ini && fn > ini && antigo.charCodeAt(fa - 1) === novo.charCodeAt(fn - 1)) { fa--; fn--; }
      return { from: ini, to: fa, insert: novo.slice(ini, fn) };
    }

    var api = {
      view: view,

      /** Estado atual (para guardar por aba: desfazer, cursor e rolagem). */
      estado: function () { return view.state; },

      /** Mostra um estado guardado, ou cria um novo com o texto. */
      carrega: function (texto, guardado, sel) {
        var st = guardado && guardado.doc && guardado.doc.toString() === texto ? guardado : null;
        if (st) view.setState(st);
        else if (guardado && guardado.doc) {
          view.setState(guardado);
          api.defineTexto(texto);
        } else view.setState(novoEstado(texto, sel));
        reconfigura();
      },

      texto: function () { return view.state.doc.toString(); },

      defineTexto: function (texto) {
        var d = diferenca(view.state.doc.toString(), String(texto == null ? '' : texto));
        if (!d) return;
        view.dispatch({ changes: d, annotations: [anotExterna.of(true), S.Transaction.addToHistory.of(true)] });
      },

      selecao: function () {
        var m = view.state.selection.main;
        return { inicio: m.from, fim: m.to, ancora: m.anchor, cabeca: m.head, varias: view.state.selection.ranges.length > 1 };
      },

      seleciona: function (inicio, fim, opcoes) {
        var n = view.state.doc.length;
        var a = Math.max(0, Math.min(inicio, n));
        var b = Math.max(0, Math.min(fim == null ? inicio : fim, n));
        var o = opcoes || {};
        view.dispatch({
          selection: { anchor: a, head: b },
          effects: o.rolar === false ? [] : [EditorView.scrollIntoView(b, { y: o.centro ? 'center' : 'nearest', yMargin: 60 })]
        });
      },

      /** Edicao como se fosse digitada: entra no desfazer e avisa aoMudar. */
      troca: function (inicio, fim, texto, selIni, selFim) {
        var spec = { changes: { from: inicio, to: fim, insert: texto }, userEvent: 'input', scrollIntoView: true };
        if (selIni != null) {
          var n = view.state.doc.length - (fim - inicio) + texto.length;
          spec.selection = { anchor: Math.min(selIni, n), head: Math.min(selFim == null ? selIni : selFim, n) };
        }
        view.dispatch(spec);
      },

      trocaSelecao: function (texto) {
        view.dispatch(view.state.replaceSelection(texto), { userEvent: 'input', scrollIntoView: true });
      },

      foco: function () { view.focus(); },
      temFoco: function () { return view.hasFocus; },

      modo: function (m) {
        if (m && m !== conf.modo) { conf.modo = m; reconfigura(); }
        return conf.modo;
      },

      opcoes: function (o) {
        var mudou = false;
        Object.keys(o || {}).forEach(function (k) {
          if (k in conf && conf[k] !== o[k]) { conf[k] = o[k]; mudou = true; }
        });
        if (mudou) reconfigura();
      },

      linhaDoCursor: function () { return view.state.doc.lineAt(view.state.selection.main.head).number - 1; },
      colunaDoCursor: function () {
        var h = view.state.selection.main.head;
        return h - view.state.doc.lineAt(h).from;
      },
      totalLinhas: function () { return view.state.doc.lines; },

      inicioDaLinha: function (n) {
        var doc = view.state.doc;
        var i = Math.max(1, Math.min(doc.lines, n + 1));
        return doc.line(i).from;
      },

      /** Leva o cursor para a linha n (0-based) e a mostra perto do topo. */
      vaiParaLinha: function (n, opcoes) {
        var doc = view.state.doc;
        var l = doc.line(Math.max(1, Math.min(doc.lines, n + 1)));
        var o = opcoes || {};
        view.dispatch({
          selection: o.selecionar ? { anchor: l.from, head: l.to } : { anchor: l.from },
          effects: EditorView.scrollIntoView(l.from, { y: o.y || 'start', yMargin: 40 })
        });
      },

      /** Linha (0-based) que esta no topo da area visivel. */
      linhaNoTopo: function () {
        var bloco = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top + 4));
        return view.state.doc.lineAt(bloco.from).number - 1;
      },

      rolaParaLinha: function (n) {
        var doc = view.state.doc;
        var l = doc.line(Math.max(1, Math.min(doc.lines, n + 1)));
        view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 0 }) });
      },

      rolagem: function (px) {
        if (px != null) view.scrollDOM.scrollTop = px;
        return view.scrollDOM.scrollTop;
      },

      fimDoDocumento: function () {
        var n = view.state.doc.length;
        view.dispatch({ selection: { anchor: n }, effects: EditorView.scrollIntoView(n, { y: 'end' }) });
      },

      marcaAchados: function (lista, atual) {
        view.dispatch({ effects: efAchados.of({ lista: lista || [], atual: atual == null ? -1 : atual }) });
      },

      defineStatusLinhas: function (arr) {
        if (view.state.field(campoStatus) === arr) return;
        view.dispatch({ effects: efStatus.of(arr || []) });
      },

      /** Redesenha as decoracoes (o indice da pasta mudou, por exemplo) e o rodape. */
      atualiza: function () { view.dispatch({ effects: [efAtualiza.of(null), efAtualizaRodape.of(null)] }); },

      coordsDoCursor: function () { return view.coordsAtPos(view.state.selection.main.head); },

      textoSelecionado: function () {
        var st = view.state;
        return st.selection.ranges.map(function (r) { return st.doc.sliceString(r.from, r.to); }).join('\n');
      },

      /** Envolve a selecao (ou a palavra) com antes/depois; ja envolvida, tira. */
      envolve: function (antes, depois) {
        if (antes === depois) return alternaMarca(antes)(view);
        var st = view.state, doc = st.doc;
        var tr = st.changeByRange(function (r) {
          var de = r.from, ate = r.to;
          if (de === ate) { var w = st.wordAt(de); if (w) { de = w.from; ate = w.to; } }
          var sel = doc.sliceString(de, ate);
          if (doc.sliceString(Math.max(0, de - antes.length), de) === antes && doc.sliceString(ate, ate + depois.length) === depois) {
            return { changes: [{ from: de - antes.length, to: de }, { from: ate, to: ate + depois.length }], range: S.EditorSelection.range(de - antes.length, ate - antes.length) };
          }
          if (sel.length >= antes.length + depois.length && sel.indexOf(antes) === 0 && sel.slice(-depois.length) === depois) {
            var miolo = sel.slice(antes.length, sel.length - depois.length);
            return { changes: { from: de, to: ate, insert: miolo }, range: S.EditorSelection.range(de, de + miolo.length) };
          }
          return { changes: [{ from: de, insert: antes }, { from: ate, insert: depois }], range: S.EditorSelection.range(de + antes.length, ate + antes.length) };
        });
        view.dispatch(st.update(tr, { scrollIntoView: true, userEvent: 'input.formatar' }));
        view.focus();
      },

      /** Troca o marcador de bloco (titulo, lista, citacao) das linhas selecionadas. */
      prefixoLinha: function (prefixo, opcoes) {
        var st = view.state, doc = st.doc;
        var r = st.selection.main;
        var l1 = doc.lineAt(r.from), l2 = doc.lineAt(r.to);
        var numerada = opcoes && opcoes.ordenada;
        var cont = 1;
        var linhas = [];
        for (var n = l1.number; n <= l2.number; n++) {
          var limpa = doc.line(n).text.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)/, '');
          linhas.push(prefixo === '' && !numerada ? limpa : (numerada ? (cont++) + '. ' : prefixo) + limpa);
        }
        var txt = linhas.join('\n');
        view.dispatch({ changes: { from: l1.from, to: l2.to, insert: txt }, selection: { anchor: l1.from + txt.length }, userEvent: 'input.formatar', scrollIntoView: true });
        view.focus();
      },

      /** Insere um modelo no cursor: %s e a selecao, %c onde o cursor para. */
      insere: function (modelo) {
        var st = view.state, r = st.selection.main;
        var sel = st.doc.sliceString(r.from, r.to);
        var txt = modelo.replace('%s', sel);
        var c = txt.indexOf('%c');
        txt = txt.replace('%c', '');
        view.dispatch({ changes: { from: r.from, to: r.to, insert: txt }, selection: { anchor: r.from + (c >= 0 ? c : txt.length) }, userEvent: 'input', scrollIntoView: true });
        view.focus();
      },

      /** Documento inteiro trocado como edicao do usuario (desfaz com Ctrl+Z), com a menor diferenca. */
      trocaTexto: function (texto) {
        var d = diferenca(view.state.doc.toString(), String(texto == null ? '' : texto));
        if (!d) return false;
        view.dispatch({ changes: d, userEvent: 'input', scrollIntoView: true });
        return true;
      },

      dobraTudo: function () { return L.foldAll(view); },
      desdobraTudo: function () { return L.unfoldAll(view); },

      /** O cursor esta dentro de uma tabela (aberta em texto)? */
      naTabela: function () { return !!tabelaNoCursor(view.state); },

      /** Operacao de tabela (textops.operaTabela) na celula do cursor. */
      operaTabela: function (opNome) {
        var st = view.state, Tx = global.MarkPadTextOps;
        var tabela = tabelaNoCursor(st);
        if (!tabela || !Tx || !Tx.operaTabela) return false;
        var doc = st.doc;
        var l1 = doc.lineAt(tabela.from), l2 = doc.lineAt(tabela.to);
        var ultima = l2.text.trim() === '' && l2.number > l1.number ? l2.number - 1 : l2.number;
        var head = st.selection.main.head;
        var lc = doc.lineAt(head);
        var de = l1.from, ate = doc.line(ultima).to;
        var r = Tx.operaTabela(doc.sliceString(de, ate), lc.number - l1.number, Tx.colunaNaLinha(lc.text, head - lc.from), opNome);
        if (!r) return false;
        var linhas = r.texto.split('\n');
        var off = 0;
        for (var i = 0; i < r.linha && i < linhas.length; i++) off += linhas[i].length + 1;
        var faixa = Tx.faixaDaCelula(linhas[Math.min(r.linha, linhas.length - 1)], r.col);
        view.dispatch({ changes: { from: de, to: ate, insert: r.texto }, selection: { anchor: de + off + faixa.ini }, userEvent: 'input', scrollIntoView: true });
        view.focus();
        return true;
      },

      /** Poe o cursor no ponto da tela (x, y); false se o ponto nao cai no texto. */
      cursorNoPonto: function (x, y) {
        var pos = view.posAtCoords({ x: x, y: y });
        if (pos == null) return false;
        view.dispatch({ selection: { anchor: pos } });
        return true;
      },

      desfazer: function () { return C.undo(view); },
      refazer: function () { return C.redo(view); },

      destroi: function () { view.destroy(); }
    };

    return api;
  }

  /*
   * Realce de um bloco de codigo com a gramatica da linguagem (as mesmas 27
   * do editor), em HTML com as classes tok-*. null se a linguagem nao e
   * conhecida aqui: o leitor cai no realce antigo (highlight.js).
   */
  function realcaCodigo(codigo, lang) {
    if (!lang || !H.highlightCode) return null;
    var desc = L.LanguageDescription.matchLanguageName(linguagensDeCodigo, String(lang).trim().toLowerCase(), true);
    if (!desc || !desc.support) return null;
    var tree;
    try { tree = desc.support.language.parser.parse(codigo); } catch (err) { return null; }
    var out = '';
    var esc = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    H.highlightCode(codigo, tree, estiloRealce, function (texto, classes) {
      out += classes ? '<span class="' + classes + '">' + esc(texto) + '</span>' : esc(texto);
    }, function () { out += '\n'; });
    return out;
  }

  global.MarkPadEditor = {
    create: create,
    realcaCodigo: realcaCodigo,
    // Para os testes de Node: o dialeto e os comandos sem DOM.
    _interno: {
      linguagemMarkdown: linguagemMarkdown,
      alternaMarca: alternaMarca,
      tecladoEnter: tecladoEnter,
      tecladoTab: tecladoTab,
      navegaTabela: navegaTabela,
      renumeraListas: renumeraListas,
      insereLink: insereLink,
      atributosDoLink: atributosDoLink,
      htmlParaMarkdown: htmlParaMarkdown
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
