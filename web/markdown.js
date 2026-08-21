/*
 * markdown.js — parser Markdown do MarkPad.
 *
 * Sem dependencias: o app precisa funcionar offline e sem CDN.
 * Cobre CommonMark na pratica + as extensoes do Obsidian que importam
 * (callouts, wikilinks, ==destaque==, tags, tarefas, tabelas, notas de rodape).
 *
 * Seguranca: o HTML gerado passa por duas peneiras — uma na string e outra
 * no DOM (sanitizeDom). O conteudo do arquivo e dado, nunca codigo.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------- utilitarios

  var PH_A = '';
  var PH_B = '';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'secao';
  }

  // -------------------------------------------------------------- frontmatter

  function extractFrontmatter(src) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
    if (!m) return { frontmatter: null, body: src, offset: 0 };

    var fields = [];
    var lines = m[1].split(/\r?\n/);
    var currentKey = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;

      var item = /^\s*-\s+(.*)$/.exec(line);
      if (item && currentKey) {
        currentKey.list.push(item[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }

      var kv = /^([A-Za-z0-9_$-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) {
        currentKey = { key: kv[1], value: kv[2].trim(), list: [] };
        fields.push(currentKey);
      }
    }

    return {
      frontmatter: fields,
      body: src.slice(m[0].length),
      offset: m[0].split('\n').length - 1
    };
  }

  // ------------------------------------------------------------- HTML seguro

  var ALLOWED_INLINE_TAGS = /^(?:b|i|em|strong|u|s|del|ins|mark|small|sub|sup|kbd|code|br|abbr|q|samp|span|cite|dfn|var|wbr)$/i;

  /** Peneira de HTML cru embutido no markdown: so um punhado de tags inline. */
  function sanitizeInlineHtml(tag) {
    var m = /^<\s*(\/?)\s*([a-zA-Z][\w-]*)\s*([^>]*?)(\/?)>$/.exec(tag);
    if (!m) return escapeHtml(tag);

    var closing = m[1];
    var name = m[2].toLowerCase();
    var selfClose = m[4];

    if (!ALLOWED_INLINE_TAGS.test(name)) return escapeHtml(tag);
    if (closing) return '</' + name + '>';

    // Descarta atributos por completo: nao ha caso legitimo em markdown de nota.
    return '<' + name + (selfClose ? ' /' : '') + '>';
  }

  // ------------------------------------------------------------------ inline

  function Inline(ctx) {
    this.ctx = ctx;
    this.slots = [];
  }

  Inline.prototype.stash = function (html) {
    this.slots.push(html);
    return PH_A + (this.slots.length - 1) + PH_B;
  };

  Inline.prototype.restore = function (text) {
    var self = this;
    var out = text;
    // Placeholders podem aninhar (link contendo codigo), entao repete ate estabilizar.
    for (var pass = 0; pass < 6 && out.indexOf(PH_A) !== -1; pass++) {
      out = out.replace(new RegExp(PH_A + '(\\d+)' + PH_B, 'g'), function (_, i) {
        return self.slots[Number(i)] !== undefined ? self.slots[Number(i)] : '';
      });
    }
    return out;
  };

  Inline.prototype.render = function (src) {
    var self = this;
    var text = String(src == null ? '' : src);

    // 0. nota de rodape inline do Obsidian: ^[o texto da nota vem aqui].
    // Precisa vir antes do codigo inline porque o corpo e guardado cru — quem
    // renderiza e o renderFootnotes, com outra instancia, que nao enxerga os
    // slots desta. Vira uma referencia [^id] comum e segue o caminho normal.
    text = text.replace(/\^\[([^\]\n]+)\]/g, function (_, corpo) {
      var id = 'mp-inline-' + (++self.ctx.inlineFootnoteSeq);
      self.ctx.footnotes[id] = corpo;
      return '[^' + id + ']';
    });

    // 1. codigo inline: `x`, ``x com ` dentro``
    text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (all, ticks, code) {
      var body = code.replace(/^ (.*) $/, '$1');
      return self.stash('<code>' + escapeHtml(body) + '</code>');
    });

    // 1b. comentarios do Obsidian: %%isto some%%. Depois do codigo inline de
    // proposito — `%%assim%%` dentro de crase continua aparecendo.
    text = text.replace(/%%[\s\S]*?%%/g, '');

    // 2. matematica: $$bloco$$ e $inline$ (sem TeX real, mas preserva e destaca)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (_, m) {
      return self.stash('<code class="math math-block">' + escapeHtml(m.trim()) + '</code>');
    });
    text = text.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, function (_, pre, m) {
      return pre + self.stash('<code class="math">' + escapeHtml(m) + '</code>');
    });

    // 3. HTML cru permitido
    text = text.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, function (tag) {
      return self.stash(sanitizeInlineHtml(tag));
    });

    // 4. escapes de barra invertida
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!>~|=$])/g, function (_, ch) {
      return self.stash(escapeHtml(ch));
    });

    // 5. o resto do texto vira literal
    text = escapeHtml(text);

    // 6. imagens embutidas do Obsidian: ![[arquivo.png|300]]
    text = text.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, function (_, target, size) {
      return self.stash(self.embed(target.trim(), (size || '').trim()));
    });

    // 7. imagens markdown: ![alt](src "titulo")
    text = text.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)/g, function (_, alt, src, title) {
      return self.stash(self.image(src, alt, title));
    });

    // 8. wikilinks: [[Nota]] / [[Nota|texto]] / [[Nota#secao]]
    text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, function (_, target, label) {
      var t = target.trim();
      // O Obsidian mostra o caminho inteiro do alvo, nao so o arquivo:
      // [[Nota#Secao]] vira 'Nota > Secao' e [[#Secao]] perde o '#' solto.
      var shown = (label || t.split('#').filter(Boolean).join(' > ') || t).trim();
      return self.stash(
        '<a class="internal-link" data-wikilink="' + escapeAttr(t) + '" href="#">' +
        escapeHtml(shown) + '</a>'
      );
    });

    // 9. notas de rodape: [^1]
    text = text.replace(/\[\^([^\]\s]+)\]/g, function (all, id) {
      if (!self.ctx.footnotes[id]) return all;
      var order = self.ctx.footnoteOrder.indexOf(id);
      if (order === -1) { self.ctx.footnoteOrder.push(id); order = self.ctx.footnoteOrder.length - 1; }
      return self.stash(
        '<sup class="footnote-ref"><a href="#fn-' + escapeAttr(id) + '" ' +
        'id="fnref-' + escapeAttr(id) + '" data-anchor="fn-' + escapeAttr(id) + '">' +
        (order + 1) + '</a></sup>'
      );
    });

    // 10. links: [texto](url "titulo")
    text = text.replace(/\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g, function (all, label, href, title) {
      return self.stash(self.link(href, self.render(label), title));
    });

    // 11. autolinks explicitos: <https://...>
    text = text.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, function (_, url) {
      return self.stash(self.link(url, escapeHtml(url), ''));
    });

    // 12. URLs soltas
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g, function (_, pre, url) {
      return pre + self.stash(self.link(url, escapeHtml(url), ''));
    });

    // 13. enfase — negrito antes de italico
    text = text.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(?!\s)([\s\S]+?)(?<!\s)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^\w\\])__(?!\s)([\s\S]+?)(?<!\s)__(?!\w)/g, '$1<strong>$2</strong>');
    text = text.replace(/(^|[^*\w\\])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w\\])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>');
    text = text.replace(/~~(?!\s)([\s\S]+?)(?<!\s)~~/g, '<del>$1</del>');
    text = text.replace(/==(?!\s)([\s\S]+?)(?<!\s)==/g, '<mark>$1</mark>');

    // 14. tags do Obsidian: #assunto/sub
    // Mesmo '#' que RE_TAG_TEXTO (app.js) e RE_TAG (MainWindow.xaml.cs)
    // aceitam: espaco, '(' ou '['. Sao tres copias da mesma regra, e uma
    // divergencia faz o painel contar uma tag que o documento nao pinta.
    text = text.replace(/(^|[\s(\[])#([A-Za-zÀ-ɏ][\wÀ-ɏ/-]*)/g, function (_, pre, tag) {
      return pre + '<a class="tag" data-tag="' + escapeAttr(tag) + '" href="#">#' + escapeHtml(tag) + '</a>';
    });

    // 15. quebra de linha forcada
    text = text.replace(/(?: {2,}|\\)\n/g, '<br>\n');

    return this.restore(text);
  };

  Inline.prototype.link = function (href, innerHtml, title) {
    var raw = String(href || '').trim();
    var t = title ? ' title="' + escapeAttr(title) + '"' : '';

    if (/^#/.test(raw)) {
      return '<a class="internal-link" data-anchor="' + escapeAttr(raw.slice(1)) + '" href="#"' + t + '>' + innerHtml + '</a>';
    }
    if (/^(https?:|mailto:)/i.test(raw)) {
      return '<a class="external-link" data-external="' + escapeAttr(raw) + '" href="#"' + t +
        ' rel="noopener noreferrer">' + innerHtml + '</a>';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      // Qualquer outro esquema (javascript:, file:, data:) vira texto morto.
      return '<span class="blocked-link" title="link bloqueado">' + innerHtml + '</span>';
    }
    // Caminho relativo ou absoluto no disco: abre dentro do proprio MarkPad.
    return '<a class="internal-link" data-file="' + escapeAttr(decodeURIComponent(raw)) + '" href="#"' + t + '>' + innerHtml + '</a>';
  };

  /** ' style="width:300px"' a partir de '300' ou '300x200'. Vazio se nao for. */
  function estiloDeTamanho(size) {
    if (/^\d+$/.test(size)) return ' style="width:' + Number(size) + 'px"';
    if (/^\d+x\d+$/.test(size)) {
      var wh = size.split('x');
      return ' style="width:' + Number(wh[0]) + 'px;height:' + Number(wh[1]) + 'px"';
    }
    return '';
  }

  Inline.prototype.image = function (src, alt, title) {
    var raw = String(src || '').trim();

    // ![alt|300](foto.png) — o Obsidian aceita o tamanho no alt tambem na
    // sintaxe padrao, nao so no embed ![[...]]. Se o que vem depois da barra
    // nao for medida, era mesmo parte do alt e fica onde estava.
    var style = '';
    var corte = String(alt == null ? '' : alt).lastIndexOf('|');
    if (corte !== -1) {
      style = estiloDeTamanho(alt.slice(corte + 1).trim());
      if (style) alt = alt.slice(0, corte).trim();
    }

    var a = ' alt="' + escapeAttr(alt || '') + '"';
    var t = title ? ' title="' + escapeAttr(title) + '"' : '';

    if (/^data:image\//i.test(raw)) return '<img src="' + escapeAttr(raw) + '"' + a + t + style + '>';

    if (/^https?:/i.test(raw)) {
      if (this.ctx.opts.loadRemoteImages) return '<img src="' + escapeAttr(raw) + '"' + a + t + style + ' loading="lazy">';
      return '<span class="remote-image" data-remote="' + escapeAttr(raw) + '">' +
        'imagem externa bloqueada — clique para carregar</span>';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '<span class="blocked-link">imagem bloqueada</span>';

    return '<img class="local-image" data-src="' + escapeAttr(decodeURIComponent(raw)) + '"' + a + t + style + '>';
  };

  Inline.prototype.embed = function (target, size) {
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(target)) {
      var style = estiloDeTamanho(size);
      return '<img class="local-image" data-src="' + escapeAttr(target) + '" alt="' + escapeAttr(target) + '"' + style + '>';
    }
    return '<a class="internal-link embed-link" data-wikilink="' + escapeAttr(target) + '" href="#">' +
      escapeHtml(target) + '</a>';
  };

  // ------------------------------------------------------------------ blocos

  var RE_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^`]*)$/;
  var RE_HEADING = /^(\s{0,3})(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  var RE_HR = /^(\s{0,3})([-*_])[ \t]*(?:\2[ \t]*){2,}$/;
  var RE_QUOTE = /^(\s{0,3})>[ \t]?(.*)$/;
  var RE_UL = /^(\s*)([-*+])[ \t]+(.*)$/;
  var RE_OL = /^(\s*)(\d{1,9})([.)])[ \t]+(.*)$/;
  var RE_FOOTNOTE = /^(\s{0,3})\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
  var RE_TABLE_SEP = /^\s{0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  var RE_HTML_BLOCK = /^\s{0,3}<(\/?)([a-zA-Z][\w-]*)/;

  var CALLOUT_ALIASES = {
    note: 'note', abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
    info: 'info', todo: 'todo', tip: 'tip', hint: 'tip', important: 'tip',
    success: 'success', check: 'success', done: 'success',
    question: 'question', help: 'question', faq: 'question',
    warning: 'warning', caution: 'warning', attention: 'warning',
    failure: 'failure', fail: 'failure', missing: 'failure',
    danger: 'danger', error: 'danger', bug: 'bug',
    example: 'example', quote: 'quote', cite: 'quote'
  };

  function isBlockStart(line) {
    return RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line) ||
      RE_QUOTE.test(line) || RE_UL.test(line) || RE_OL.test(line) ||
      RE_HTML_BLOCK.test(line);
  }

  function indentOf(line) {
    var m = /^[ \t]*/.exec(line)[0];
    var n = 0;
    for (var i = 0; i < m.length; i++) n += m[i] === '\t' ? 4 : 1;
    return n;
  }

  function parseBlocks(lines, ctx, startLine) {
    var out = [];
    var i = 0;
    var base = startLine || 0;

    // Intervalo de linhas de origem do bloco, inclusivo nas duas pontas.
    // E o que permite ao editor trocar um bloco renderizado pelo markdown cru
    // correspondente e devolve-lo ao documento no lugar certo.
    function lineAttr(from, to) {
      if (!ctx.opts.lineMap) return '';
      var a = base + from;
      var b = base + (to === undefined ? from : to);
      return ' data-line="' + a + '" data-line-end="' + b + '"';
    }

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // --- comentario de bloco do Obsidian: %% sozinho abre, %% sozinho fecha.
      // O caso sem linha em branco no meio ja morre no inline; este aqui e o
      // que atravessa paragrafos.
      if (line.trim() === '%%') {
        i++;
        while (i < lines.length && lines[i].trim() !== '%%') i++;
        i++;
        continue;
      }

      // --- bloco de codigo cercado
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var marker = fence[2];
        var info = (fence[3] || '').trim();
        var lang = info.split(/\s+/)[0].toLowerCase();
        var body = [];
        var start = i;
        i++;
        while (i < lines.length) {
          var close = new RegExp('^\\s{0,3}' + marker[0] + '{' + marker.length + ',}\\s*$');
          if (close.test(lines[i])) { i++; break; }
          body.push(lines[i]);
          i++;
        }
        var code = body.join('\n');
        var highlighted = global.MarkPadHighlight
          ? global.MarkPadHighlight.highlight(code, lang)
          : escapeHtml(code);
        out.push(
          '<div class="code-block"' + lineAttr(start, i - 1) + '>' +
          (lang ? '<div class="code-lang">' + escapeHtml(lang) + '</div>' : '') +
          '<button class="code-copy" data-copy type="button" title="Copiar">Copiar</button>' +
          '<pre><code class="language-' + escapeAttr(lang || 'text') + '">' + highlighted + '</code></pre>' +
          '</div>'
        );
        continue;
      }

      // --- titulo ATX
      var heading = RE_HEADING.exec(line);
      if (heading) {
        var level = heading[2].length;
        var inline = new Inline(ctx);
        var html = inline.render(heading[3]);
        var slug = uniqueSlug(ctx, slugify(heading[3]));
        ctx.toc.push({ level: level, text: heading[3].replace(/[*_`~=]/g, ''), slug: slug, line: base + i });
        out.push('<h' + level + ' id="' + escapeAttr(slug) + '"' + lineAttr(i, i) + '>' + html + '</h' + level + '>');
        i++;
        continue;
      }

      // --- linha horizontal
      if (RE_HR.test(line)) { out.push('<hr' + lineAttr(i, i) + '>'); i++; continue; }

      // --- definicao de nota de rodape (ja coletada, so consome as linhas)
      var fn = RE_FOOTNOTE.exec(line);
      if (fn) {
        i++;
        while (i < lines.length && (lines[i].trim() === '' ? false : indentOf(lines[i]) >= 4 || !isBlockStart(lines[i]))) {
          if (RE_FOOTNOTE.test(lines[i])) break;
          if (!lines[i].trim()) break;
          i++;
        }
        continue;
      }

      // --- citacao / callout
      if (RE_QUOTE.test(line)) {
        var quoted = [];
        var qStart = i;
        while (i < lines.length) {
          var qm = RE_QUOTE.exec(lines[i]);
          if (qm) { quoted.push(qm[2]); i++; continue; }
          // continuacao preguicosa: linha de texto solta dentro da citacao
          if (lines[i].trim() && !isBlockStart(lines[i])) { quoted.push(lines[i]); i++; continue; }
          break;
        }
        out.push(renderQuote(quoted, ctx, base + qStart, lineAttr(qStart, i - 1)));
        continue;
      }

      // --- tabela
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
        var tStart = i;
        var head = lines[i];
        var sep = lines[i + 1];
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) { rows.push(lines[i]); i++; }
        out.push(renderTable(head, sep, rows, ctx, lineAttr(tStart, i - 1)));
        continue;
      }

      // --- listas
      if (RE_UL.test(line) || RE_OL.test(line)) {
        var listResult = collectList(lines, i);
        out.push(renderList(listResult.items, listResult.ordered, listResult.start, listResult.loose, ctx, base + i, lineAttr(i, listResult.next - 1)));
        i = listResult.next;
        continue;
      }

      // --- bloco HTML cru: cai como texto escapado (nao executamos HTML de arquivo)
      if (RE_HTML_BLOCK.test(line) && !/^\s{0,3}<(?:b|i|em|strong|u|s|del|ins|mark|small|sub|sup|kbd|code|br|abbr|q|samp|span|cite|dfn|var)\b/i.test(line)) {
        var rawStart = i;
        var raw = [];
        while (i < lines.length && lines[i].trim()) { raw.push(lines[i]); i++; }
        out.push('<pre class="raw-html"' + lineAttr(rawStart, i - 1) + '><code>' + escapeHtml(raw.join('\n')) + '</code></pre>');
        continue;
      }

      // --- paragrafo (com titulo setext)
      var para = [];
      var pStart = i;
      // A primeira linha entra sempre: chegamos aqui justamente porque nenhum
      // outro tipo de bloco a reivindicou (ex.: paragrafo comecando com <b>).
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) {
        if (i + 1 < lines.length && /^\s{0,3}(=+|-{2,})\s*$/.test(lines[i + 1]) && para.length === 0) {
          var isH1 = lines[i + 1].trim()[0] === '=';
          var inl = new Inline(ctx);
          var sTxt = lines[i];
          var sSlug = uniqueSlug(ctx, slugify(sTxt));
          ctx.toc.push({ level: isH1 ? 1 : 2, text: sTxt.replace(/[*_`~=]/g, ''), slug: sSlug, line: base + i });
          out.push('<h' + (isH1 ? 1 : 2) + ' id="' + escapeAttr(sSlug) + '"' + lineAttr(i, i + 1) + '>' +
            inl.render(sTxt) + '</h' + (isH1 ? 1 : 2) + '>');
          i += 2;
          para = null;
          break;
        }
        if (para.length && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i].indexOf('|') !== -1) break;
        para.push(lines[i]);
        i++;
      }
      if (para && para.length) {
        var pInline = new Inline(ctx);
        var pHtml = pInline.render(para.join('\n'));
        // Paragrafo que era so comentario %% sai vazio; um <p></p> so serviria
        // para abrir um vao no texto.
        if (pHtml.trim()) out.push('<p' + lineAttr(pStart, i - 1) + '>' + pHtml + '</p>');
      }
      if (para === null) continue;
      if (!para || !para.length) i++;
    }

    return out.join('\n');
  }

  function uniqueSlug(ctx, slug) {
    if (!ctx.slugs[slug]) { ctx.slugs[slug] = 1; return slug; }
    ctx.slugs[slug]++;
    return slug + '-' + ctx.slugs[slug];
  }

  // --- citacoes e callouts

  function renderQuote(quoted, ctx, startLine, attr) {
    var first = quoted[0] || '';
    var co = /^\s*\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/.exec(first);

    if (co) {
      var kind = CALLOUT_ALIASES[co[1].toLowerCase()] || 'note';
      var fold = co[2];
      var title = co[3].trim();
      var bodyLines = quoted.slice(1);

      var titleInline = new Inline(ctx);
      var titleHtml = title ? titleInline.render(title) : defaultCalloutTitle(kind);
      var bodyHtml = bodyLines.length ? parseBlocks(bodyLines, ctx, startLine + 1) : '';

      if (fold) {
        return '<details class="callout callout-' + kind + '" data-callout="' + kind + '"' +
          (fold === '+' ? ' open' : '') + attr + '>' +
          '<summary class="callout-title"><span class="callout-icon" data-icon="' + kind + '"></span>' +
          '<span class="callout-title-inner">' + titleHtml + '</span></summary>' +
          '<div class="callout-content">' + bodyHtml + '</div></details>';
      }

      return '<div class="callout callout-' + kind + '" data-callout="' + kind + '"' + attr + '>' +
        '<div class="callout-title"><span class="callout-icon" data-icon="' + kind + '"></span>' +
        '<span class="callout-title-inner">' + titleHtml + '</span></div>' +
        (bodyHtml ? '<div class="callout-content">' + bodyHtml + '</div>' : '') + '</div>';
    }

    return '<blockquote' + attr + '>' + parseBlocks(quoted, ctx, startLine) + '</blockquote>';
  }

  function defaultCalloutTitle(kind) {
    var titles = {
      note: 'Nota', abstract: 'Resumo', info: 'Info', todo: 'A fazer', tip: 'Dica',
      success: 'Sucesso', question: 'Pergunta', warning: 'Atencao', failure: 'Falha',
      danger: 'Perigo', bug: 'Bug', example: 'Exemplo', quote: 'Citacao'
    };
    return titles[kind] || 'Nota';
  }

  // --- tabelas

  function splitRow(row) {
    var line = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var current = '';
    var escaped = false;

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === '\\') { escaped = true; current += ch; continue; }
      if (ch === '|') { cells.push(current); current = ''; continue; }
      current += ch;
    }
    cells.push(current);
    return cells.map(function (c) { return c.trim(); });
  }

  function renderTable(head, sep, rows, ctx, attr) {
    var headers = splitRow(head);
    var aligns = splitRow(sep).map(function (s) {
      var left = s.charAt(0) === ':';
      var right = s.charAt(s.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });

    function cell(tag, text, idx) {
      var inline = new Inline(ctx);
      var a = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
      return '<' + tag + a + '>' + inline.render(text) + '</' + tag + '>';
    }

    var html = '<div class="table-wrap"' + attr + '><table><thead><tr>';
    headers.forEach(function (h, idx) { html += cell('th', h, idx); });
    html += '</tr></thead><tbody>';

    rows.forEach(function (r) {
      var cells = splitRow(r);
      html += '<tr>';
      for (var i = 0; i < headers.length; i++) html += cell('td', cells[i] !== undefined ? cells[i] : '', i);
      html += '</tr>';
    });

    return html + '</tbody></table></div>';
  }

  // --- listas

  function collectList(lines, start) {
    var firstUl = RE_UL.exec(lines[start]);
    var firstOl = RE_OL.exec(lines[start]);
    var ordered = !!firstOl;
    var baseIndent = indentOf(lines[start]);
    var startNumber = ordered ? parseInt(firstOl[2], 10) : 1;

    var items = [];
    var current = null;
    var loose = false;
    var pendingBlank = false;
    var i = start;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) {
        // Uma linha em branco pode encerrar a lista ou apenas soltar os itens.
        var next = lines[i + 1];
        if (next === undefined || !next.trim()) break;
        if (indentOf(next) <= baseIndent && !RE_UL.test(next) && !RE_OL.test(next)) break;
        pendingBlank = true;
        i++;
        continue;
      }

      var ul = RE_UL.exec(line);
      var ol = RE_OL.exec(line);
      var indent = indentOf(line);

      if ((ul || ol) && indent <= baseIndent + 1) {
        if (pendingBlank && items.length) loose = true;
        pendingBlank = false;
        current = { lines: [(ul ? ul[3] : ol[4])], line: i, indent: indent };
        items.push(current);
        i++;
        continue;
      }

      if (!current) break;

      if (indent > baseIndent || (ul || ol)) {
        if (pendingBlank) { current.lines.push(''); loose = true; pendingBlank = false; }
        // Remove a indentacao do marcador para o conteudo aninhado voltar a coluna 0.
        var strip = Math.min(indent, current.indent + 2);
        current.lines.push(line.slice(strip));
        i++;
        continue;
      }

      // continuacao preguicosa do paragrafo do item
      if (!isBlockStart(line)) {
        if (pendingBlank) { current.lines.push(''); loose = true; pendingBlank = false; }
        current.lines.push(line.trim());
        i++;
        continue;
      }

      break;
    }

    return { items: items, ordered: ordered, start: startNumber, loose: loose, next: i };
  }

  function renderList(items, ordered, startNumber, loose, ctx, baseLine, attr) {
    // item.line e indice dentro do bloco que o parseBlocks recebeu, enquanto
    // baseLine ja e absoluto. Descontar o primeiro item poe os dois na mesma
    // regua — sem isso, tudo dentro de lista aponta uma linha inventada.
    var origem = items.length ? items[0].line : 0;
    function linhaDe(item) { return baseLine + (item.line - origem); }
    var tag = ordered ? 'ol' : 'ul';
    var startAttr = ordered && startNumber !== 1 ? ' start="' + startNumber + '"' : '';
    var hasTasks = false;

    var body = items.map(function (item) {
      var text = item.lines.join('\n');
      // Qualquer caractere entre colchetes e uma tarefa, como no Obsidian:
      // [x] feita, [ ] aberta, e [>] [?] [!] [/] [-] ... estados que o tema
      // pinta pelo data-task. So x/X contam como concluida.
      var task = /^\[(.)\]\s+([\s\S]*)$/.exec(item.lines[0] || '');
      var cls = '';
      var prefix = '';

      if (task) {
        hasTasks = true;
        var estado = task[1];
        var checked = estado.toLowerCase() === 'x';
        cls = ' class="task-item' + (checked ? ' is-checked' : '') + '"';
        if (estado !== ' ') cls += ' data-task="' + escapeAttr(estado) + '"';
        if (ctx.opts.lineMap) cls += ' data-task-line="' + linhaDe(item) + '"';
        // O estado tambem vai no input: e dele que o CSS tira o desenho da
        // caixinha, com content: attr(data-task).
        prefix = '<input type="checkbox" disabled' + (checked ? ' checked' : '') +
          (estado !== ' ' && !checked ? ' data-task="' + escapeAttr(estado) + '"' : '') + '>';
        item = { lines: [task[2]].concat(item.lines.slice(1)), line: item.line };
        text = item.lines.join('\n');
      }

      var inner;
      var multiline = item.lines.length > 1 && item.lines.some(function (l, idx) { return idx > 0 && l.trim(); });

      if (multiline || loose) {
        inner = parseBlocks(item.lines, ctx, linhaDe(item));
        // Lista apertada nao embrulha o primeiro paragrafo em <p>. Antes so a
        // abertura era removida e o </p> ficava orfao sempre que vinha uma
        // sublista depois; o navegador, ao ver </p> sem par, inventa um
        // <p></p> vazio e abre um vao no meio do item. Tirar o par inteiro.
        if (!loose) inner = inner.replace(/^<p[^>]*>([\s\S]*?)<\/p>/, function (_, dentro) { return dentro; });
      } else {
        var inline = new Inline(ctx);
        inner = inline.render(text);
      }

      return '<li' + cls + '>' + prefix + inner + '</li>';
    }).join('\n');

    var listCls = hasTasks ? ' class="contains-task-list"' : '';
    return '<' + tag + listCls + startAttr + attr + '>\n' + body + '\n</' + tag + '>';
  }

  // --- notas de rodape

  function collectFootnotes(src, ctx) {
    var lines = src.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = RE_FOOTNOTE.exec(lines[i]);
      if (!m) continue;

      var id = m[2];
      var body = [m[3]];
      var j = i + 1;
      while (j < lines.length && lines[j].trim() && !RE_FOOTNOTE.test(lines[j])) { body.push(lines[j].trim()); j++; }
      ctx.footnotes[id] = body.join('\n');
    }
  }

  function renderFootnotes(ctx) {
    if (!ctx.footnoteOrder.length) return '';

    var items = ctx.footnoteOrder.map(function (id) {
      var inline = new Inline(ctx);
      return '<li id="fn-' + escapeAttr(id) + '">' + inline.render(ctx.footnotes[id] || '') +
        ' <a class="footnote-backref" href="#fnref-' + escapeAttr(id) + '" ' +
        'data-anchor="fnref-' + escapeAttr(id) + '">&#8617;</a></li>';
    }).join('\n');

    return '<hr class="footnotes-sep"><section class="footnotes"><ol>' + items + '</ol></section>';
  }

  // --------------------------------------------------------- API principal

  function render(src, opts) {
    var ctx = {
      toc: [],
      slugs: {},
      footnotes: {},
      footnoteOrder: [],
      inlineFootnoteSeq: 0,
      opts: opts || {}
    };

    var fm = extractFrontmatter(String(src || ''));
    collectFootnotes(fm.body, ctx);

    var lines = fm.body.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    var html = parseBlocks(lines, ctx, fm.offset);

    return {
      html: html + renderFootnotes(ctx),
      toc: ctx.toc,
      frontmatter: fm.frontmatter
    };
  }

  // ------------------------------------------------------- peneira final DOM

  var ALLOWED_TAGS = {};
  ('a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em ' +
   'figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s samp ' +
   'section small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr'
  ).split(' ').forEach(function (t) { ALLOWED_TAGS[t] = true; });

  var ALLOWED_ATTRS = {};
  ('class id href src alt title colspan rowspan start type checked disabled style ' +
   'data-line data-line-end data-task data-task-line data-icon data-callout data-wikilink data-file data-anchor data-external ' +
   'data-tag data-src data-remote data-copy data-lang open rel loading'
  ).split(' ').forEach(function (a) { ALLOWED_ATTRS[a] = true; });

  /**
   * Segunda peneira, agora sobre o DOM ja construido.
   * Se algo escapou da montagem da string, morre aqui.
   */
  function sanitizeDom(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    var doomed = [];
    var node;

    while ((node = walker.nextNode())) {
      var tag = node.tagName.toLowerCase();

      if (!ALLOWED_TAGS[tag]) { doomed.push(node); continue; }

      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var attr = node.attributes[i];
        var name = attr.name.toLowerCase();

        if (!ALLOWED_ATTRS[name] || name.indexOf('on') === 0) {
          node.removeAttribute(attr.name);
          continue;
        }

        if (name === 'href') {
          if (attr.value !== '#' && !/^#[\w-]*$/.test(attr.value)) node.setAttribute('href', '#');
        }

        if (name === 'src') {
          if (!/^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif|x-icon);base64,|https?:\/\/)/i.test(attr.value)) {
            node.removeAttribute('src');
          }
        }

        if (name === 'style') {
          // So dimensoes e alinhamento; nada de url(), expression() ou position.
          var safe = attr.value.split(';').filter(function (rule) {
            return /^\s*(width|height|max-width|max-height|text-align)\s*:\s*[\w.%-]+\s*$/i.test(rule);
          }).join(';');
          if (safe) node.setAttribute('style', safe); else node.removeAttribute('style');
        }

        if (name === 'type' && tag === 'input' && attr.value !== 'checkbox') doomed.push(node);
      }

      if (tag === 'input') {
        node.setAttribute('disabled', '');
        node.setAttribute('type', 'checkbox');
      }
    }

    doomed.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    return root;
  }

  global.MarkPadMarkdown = {
    render: render,
    sanitizeDom: sanitizeDom,
    escapeHtml: escapeHtml,
    slugify: slugify,
    extractFrontmatter: extractFrontmatter
  };
})(window);
