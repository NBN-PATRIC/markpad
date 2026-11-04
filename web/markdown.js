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

  // Ver o passo 14 do Inline.render. \uE000 e \uE001 sao PH_A e PH_B.
  var RE_TAG_LEITURA = /(^|\s)#(?!\d+(?:[\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F\uE000\uE001]|$))([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F\uE000\uE001]+)/g;

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

  // Destino de link e imagem: <com espaco> ou sem espaco, aceitando um nivel de
  // parenteses (https://pt.wikipedia.org/wiki/Fulano_(cantor)). Titulo entre
  // aspas, apostrofos ou parenteses, como no CommonMark.
  var RE_INLINE_IMAGE = /!\[([^\]]*)\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
  var RE_INLINE_LINK = /\[([^\]]*)\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;

  function destinoDe(d) {
    d = String(d || '');
    return d.charAt(0) === '<' ? d.slice(1, -1) : d;
  }

  function tituloDe(t) { return t ? t.slice(1, -1) : ''; }

  // decodeURIComponent lanca erro com % solto ('100% certo.png') e derrubava o
  // documento inteiro em 'Falha ao renderizar'.
  function decodeSeguro(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  /*
   * ^[nota inline], com colchetes e codigo dentro: o fecho e o ']' que
   * equilibra a conta, e um ']' dentro de crase nao conta. Codigo fora da
   * nota e pulado inteiro (`^[x]` entre crases e texto, nao nota), e \^[ nao
   * abre nota.
   */
  function trocaNotasInline(text, cb) {
    var out = '';
    var i = 0;
    var n = text.length;
    while (i < n) {
      var c = text.charAt(i);
      if (c === '\\') { out += text.substr(i, 2); i += 2; continue; }
      if (c === '`') { var fimC = fimDaCrase(text, i); out += text.slice(i, fimC); i = fimC; continue; }
      if (c === '^' && text.charAt(i + 1) === '[') {
        var j = i + 2;
        var prof = 1;
        while (j < n) {
          var d = text.charAt(j);
          if (d === '\\') { j += 2; continue; }
          if (d === '`') { j = fimDaCrase(text, j); continue; }
          if (d === '[') prof++;
          else if (d === ']' && --prof === 0) break;
          j++;
        }
        if (prof === 0 && j > i + 2) { out += cb(text.slice(i + 2, j)); i = j + 1; continue; }
      }
      out += c;
      i++;
    }
    return out;
  }

  /** Onde acaba o codigo inline que abre em i: a mesma quantidade de crases fecha. Sem fecho, as crases sao texto. */
  function fimDaCrase(text, i) {
    var k = i;
    while (text.charAt(k) === '`') k++;
    var tam = k - i;
    var p = k;
    while (p < text.length) {
      if (text.charAt(p) !== '`') { p++; continue; }
      var q = p;
      while (text.charAt(q) === '`') q++;
      if (q - p === tam) return q;
      p = q;
    }
    return k;
  }

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
    // O fecho e o ']' que equilibra a conta: ^[veja [site](x)] e uma nota so.
    text = trocaNotasInline(text, function (corpo) {
      var id = 'mp-inline-' + (++self.ctx.inlineFootnoteSeq);
      self.ctx.footnotes[id] = corpo;
      return '[^' + id + ']';
    });

    // 1. codigo inline: `x`, ``x com ` dentro``
    text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (all, ticks, code) {
      var body = code.replace(/^ (.*) $/, '$1');
      return self.stash('<code>' + escapeHtml(body) + '</code>');
    });

    // 1a. wikilink com a barra escapada, que e como se escreve o apelido dentro
    // de uma celula de tabela: [[Nota\|apelido]]. Volta a ser o separador antes
    // que o escape abaixo transforme a barra em texto.
    text = text.replace(/\[\[([^\]\n]*?)\\\|([^\]\n]*)\]\]/g, '[[$1|$2]]');

    // 1b. escapes de barra invertida: qualquer pontuacao ASCII (CommonMark).
    // Antes dos comentarios (\%% nao abre um), da matematica (\$) e dos links.
    text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g, function (_, ch) {
      return self.stash(escapeHtml(ch));
    });

    // 1c. comentarios do Obsidian: %%isto some%%. Depois do codigo inline de
    // proposito — `%%assim%%` dentro de crase continua aparecendo.
    text = text.replace(/%%[\s\S]*?%%/g, '');

    // 2. matematica: $$bloco$$ e $inline$ (sem TeX real, mas preserva e destaca)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (_, m) {
      return self.stash('<code class="math math-block">' + escapeHtml(m.trim()) + '</code>');
    });
    text = text.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, function (_, pre, m) {
      return pre + self.stash('<code class="math">' + escapeHtml(m) + '</code>');
    });

    // Daqui ate o passo 10, links, imagens e wikilinks sao reconhecidos no
    // texto CRU, antes do escape geral (passo 12), e cada funcao (image, link,
    // embed) escapa o que recebe uma vez so. Na ordem antiga o escape vinha
    // primeiro: titulo entre aspas nao casava (as aspas ja eram &quot;), & em
    // URL e em nome de nota saia escapado duas vezes, e o destino <com espaco>
    // era tomado por tag HTML.

    // 3. imagens embutidas do Obsidian: ![[arquivo.png|300]]
    text = text.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, function (_, target, size) {
      return self.stash(self.embed(target.trim(), (size || '').trim()));
    });

    // 4. imagens markdown: ![alt](src "titulo"), ![alt](<com espaco.png>)
    text = text.replace(RE_INLINE_IMAGE, function (_, alt, dest, title) {
      return self.stash(self.image(destinoDe(dest), alt, tituloDe(title)));
    });

    // 5. wikilinks: [[Nota]] / [[Nota|texto]] / [[Nota#secao]]
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

    // 6. notas de rodape: [^1]. Rotulo sem distincao de maiusculas ([^B] acha
    // [^b]:), numero pela ordem da primeira citacao, entre colchetes como no
    // Obsidian, e um id por citacao (fnref-x, fnref-x-1...): o mesmo id duas
    // vezes no HTML mandava todas as setas de volta para a primeira.
    text = text.replace(/\[\^([^\]\s]+)\]/g, function (all, rotulo) {
      var id = rotulo.toLowerCase();
      if (self.ctx.footnotes[id] === undefined) return all;
      var order = self.ctx.footnoteOrder.indexOf(id);
      if (order === -1) { self.ctx.footnoteOrder.push(id); order = self.ctx.footnoteOrder.length - 1; }
      var vez = self.ctx.footnoteRefs[id] || 0;
      self.ctx.footnoteRefs[id] = vez + 1;
      var refId = 'fnref-' + id + (vez ? '-' + vez : '');
      return self.stash(
        '<sup class="footnote-ref"><a href="#fn-' + escapeAttr(id) + '" ' +
        'id="' + escapeAttr(refId) + '" data-anchor="fn-' + escapeAttr(id) + '">[' +
        (order + 1) + ']</a></sup>'
      );
    });

    // 7. links: [texto](url "titulo"), [texto](<com espaco.md>)
    text = text.replace(RE_INLINE_LINK, function (_, label, dest, title) {
      return self.stash(self.link(destinoDe(dest), self.render(label), tituloDe(title)));
    });

    // 8. autolinks explicitos: <https://...>
    text = text.replace(/<((?:https?|mailto):[^\s<>]+)>/g, function (_, url) {
      return self.stash(self.link(url, escapeHtml(url), ''));
    });

    // 8a. comentario HTML some, como no Obsidian. Depois do codigo inline:
    // `<!-- assim -->` entre crases continua aparecendo.
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // 9. HTML cru permitido (tags inofensivas; o resto vira texto)
    text = text.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, function (tag) {
      return self.stash(sanitizeInlineHtml(tag));
    });

    // 10. URLs soltas
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g, function (_, pre, url) {
      return pre + self.stash(self.link(url, escapeHtml(url), ''));
    });

    // 11. entidades HTML (&copy; &#169; &#xA9;) passam como estao: quem
    // decodifica e o navegador, e como texto, nunca como marcacao.
    text = text.replace(/&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, function (ent) {
      return self.stash(ent);
    });

    // 12. o resto do texto vira literal
    text = escapeHtml(text);

    // 13. enfase — negrito antes de italico
    text = text.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(?!\s)([\s\S]+?)(?<!\s)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^\w\\])__(?!\s)([\s\S]+?)(?<!\s)__(?!\w)/g, '$1<strong>$2</strong>');
    text = text.replace(/(^|[^*\w\\])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w\\])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>');
    text = text.replace(/~~(?!\s)([\s\S]+?)(?<!\s)~~/g, '<del>$1</del>');
    text = text.replace(/==(?!\s)([\s\S]+?)(?<!\s)==/g, '<mark>$1</mark>');

    // 14. tags do Obsidian: #assunto/sub, #2026-q4, #✅revisado
    // A regra do Obsidian: '#' no comeco do texto ou depois de espaco ((#x),
    // [#x] e a#x nao sao tag); depois, qualquer coisa que nao seja espaco nem
    // pontuacao (sobram letras de qualquer escrita, digitos, _ - / e emoji); e
    // so digitos nao vale (#1984 nao, #1984a sim). A mesma regra mora em
    // RE_TAG_TEXTO (app.js), RE_TAG (linkindex.js e MainWindow.xaml.cs) e no
    // realce do modo fonte (highlight.js): uma divergencia faz o painel contar
    // uma tag que o documento nao pinta. Aqui ainda ficam de fora os
    // marcadores internos PH_A/PH_B, que guardam link e codigo ja montados.
    text = text.replace(RE_TAG_LEITURA, function (_, pre, tag) {
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
    return '<a class="internal-link" data-file="' + escapeAttr(decodeSeguro(raw)) + '" href="#"' + t + '>' + innerHtml + '</a>';
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

    var midia = tipoDeMidia(raw);
    if (midia) return casuloDeMidia(midia, decodeSeguro(raw), 'data-file');

    return '<img class="local-image" data-src="' + escapeAttr(decodeSeguro(raw)) + '"' + a + t + style + '>';
  };

  /*
   * Audio, video e PDF embutidos (![[aula.mp4]], ![](som.mp3), ![[a.pdf#page=3]]).
   * O parser nao le disco nem sabe onde a pasta esta: deixa um casulo com o
   * nome do arquivo, que o app troca pelo player (resolveMidia) quando acha
   * o arquivo na pasta aberta. Fora do app o casulo fica como o nome.
   */
  var MIDIA = {
    mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', opus: 'audio',
    mp4: 'video', m4v: 'video', webm: 'video', mov: 'video', ogv: 'video',
    pdf: 'pdf'
  };

  function tipoDeMidia(alvo) {
    var m = /\.([a-z0-9]+)$/i.exec(String(alvo).split('#')[0]);
    return m ? MIDIA[m[1].toLowerCase()] || null : null;
  }

  function casuloDeMidia(tipo, alvo, attr, size) {
    return '<span class="media-embed" data-media="' + tipo + '" ' + attr + '="' + escapeAttr(alvo) + '"' +
      estiloDeTamanho(size) + '>' + escapeHtml(alvo) + '</span>';
  }

  Inline.prototype.embed = function (target, size) {
    var midia = tipoDeMidia(target);
    if (midia) return casuloDeMidia(midia, target, 'data-embed', size);
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(target)) {
      var style = estiloDeTamanho(size);
      return '<img class="local-image" data-src="' + escapeAttr(target) + '" alt="' + escapeAttr(target) + '"' + style + '>';
    }
    // Nota embutida (transclusao). O parser nao le disco, entao deixa um
    // casulo com um link dentro: no app, resolveNoteEmbeds troca o miolo pelo
    // conteudo da nota; fora dele (exportacao, teste) o embed degrada para um
    // link que abre a nota — que era o comportamento antigo. Em nota, o que
    // vem depois da barra e apelido (vira o titulo do cartao), nao medida.
    var alias = size && !/^\d+(?:x\d+)?$/.test(size) ? size : '';
    return '<span class="note-embed" data-embed="' + escapeAttr(target) + '"' +
      (alias ? ' data-alias="' + escapeAttr(alias) + '"' : '') + '>' +
      '<a class="internal-link embed-link" data-wikilink="' + escapeAttr(target) + '" href="#">' +
      escapeHtml(alias || target) + '</a></span>';
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
  // So e tag se o nome terminar em espaco, '>' ou '/>': <https://x.com> no
  // inicio da linha e autolink, nao bloco HTML.
  var RE_HTML_BLOCK = /^\s{0,3}<(\/?)([a-zA-Z][\w-]*)(?=[\s>]|\/>|$)/;

  // Primeira linha da citacao: [!tipo], dobra opcional (+/-) e, depois, espaco
  // ou fim da linha ([!note]Titulo colado nao e callout). O tipo e qualquer
  // texto sem ']'; um '|' separa metadados ([!note|largo]).
  var RE_CALLOUT = /^\s*\[!([^\]]+)\]([+-]?)(?:[ \t]+(.*))?$/;
  // Comentario HTML num bloco proprio: some, mesmo atravessando linhas.
  var RE_HTML_COMENTARIO = /^\s{0,3}<!--/;

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
      RE_HTML_BLOCK.test(line) || RE_HTML_COMENTARIO.test(line);
  }

  /*
   * Onde termina a definicao de nota de rodape que comeca na linha i (indice
   * da primeira linha DEPOIS dela). Segue nas linhas indentadas com 4 espacos,
   * tambem depois de linha em branco (segundo paragrafo, lista, codigo), e na
   * linha preguicosa colada ao texto que nao abra outro bloco.
   */
  function fimDaNota(lines, i) {
    var j = i + 1;
    var colada = true;
    while (j < lines.length) {
      var l = lines[j];
      if (!l.trim()) {
        var k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && indentOf(lines[k]) >= 4) { j = k; colada = false; continue; }
        break;
      }
      if (indentOf(l) >= 4) { j++; colada = true; continue; }
      if (colada && !RE_FOOTNOTE.test(l) && !isBlockStart(l)) { j++; continue; }
      break;
    }
    return j;
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
        // '# Titulo ^abc': o marcador e endereco, nao titulo — fora do texto
        // e fora do slug (senao [[Nota#Titulo]] deixava de casar).
        heading[3] = heading[3].replace(RE_ID_BLOCO, '');
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
      if (RE_FOOTNOTE.test(line)) {
        i = fimDaNota(lines, i);
        continue;
      }

      // --- comentario HTML: some, como no Obsidian. Sem fecho, vai ate o fim.
      if (RE_HTML_COMENTARIO.test(line)) {
        while (i < lines.length && lines[i].indexOf('-->') === -1) i++;
        i++;
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

      // --- bloco HTML cru: aparece renderizado, pela peneira de htmlDoBloco.
      // Como no CommonMark, vai ate a linha em branco e o markdown de dentro
      // nao e lido. Se o bloco deixou um container aberto (<details> com o
      // conteudo em markdown depois da linha em branco), o miolo ate o fecho
      // e markdown de novo, e tudo vira um bloco so para o editor ao vivo.
      if (RE_HTML_BLOCK.test(line) && !/^\s{0,3}<(?:b|i|em|strong|u|s|del|ins|mark|small|sub|sup|kbd|code|br|abbr|q|samp|span|cite|dfn|var)\b/i.test(line)) {
        var hIni = i;
        var cru = [];
        while (i < lines.length && lines[i].trim()) { cru.push(lines[i]); i++; }
        var abre = htmlDoBloco(cru.join('\n'), ctx);
        var miolo = '';
        var fecho = '';
        if (abre.abertas.length) {
          var hFim = fechoDoHtml(lines, i, abre.abertas[0]);
          if (hFim !== -1) {
            miolo = parseBlocks(lines.slice(i, hFim), ctx, base + i);
            var fcru = [];
            i = hFim;
            while (i < lines.length && lines[i].trim()) { fcru.push(lines[i]); i++; }
            fecho = htmlDoBloco(fcru.join('\n'), ctx).html;
          }
        }
        out.push('<div class="html-block"' + lineAttr(hIni, i - 1) + '>' + abre.html + miolo + fecho + '</div>');
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
        // Linha sozinha '^id' e o unico jeito, no Obsidian, de dar endereco
        // a tabela e bloco de codigo: o id vai para o BLOCO ANTERIOR (se ele
        // ainda nao tem id proprio) e a linha some da tela.
        var soId = para.length === 1 ? /^\^([A-Za-z0-9_-]+)$/.exec(para[0].trim()) : null;
        if (soId && out.length) {
          out[out.length - 1] = out[out.length - 1].replace(
            /^<([a-zA-Z][\w-]*)((?:(?!\sid=")[^>])*)>/,
            '<$1 id="' + escapeAttr(soId[1]) + '"$2>');
        } else {
          var pid = tiraIdDeBloco(para);
          var pInline = new Inline(ctx);
          var pHtml = pInline.render(para.join('\n'));
          // Paragrafo que era so comentario %% sai vazio; um <p></p> so serviria
          // para abrir um vao no texto.
          if (pHtml.trim()) {
            out.push('<p' + (pid ? ' id="' + escapeAttr(pid) + '"' : '') +
              lineAttr(pStart, i - 1) + '>' + pHtml + '</p>');
          }
        }
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

  /*
   * Marcador de bloco do Obsidian: 'um paragrafo ^abc' faz [[#^abc]] e
   * ![[Nota#^abc]] apontarem para ele. O marcador vive na ultima linha com
   * texto do bloco, sai da tela (e endereco, nao conteudo) e vira o id do
   * elemento. Muda a lista no lugar porque quem chama ainda vai juntar as
   * linhas para renderizar.
   */
  var RE_ID_BLOCO = /[ \t]+\^([A-Za-z0-9_-]+)[ \t]*$/;

  function tiraIdDeBloco(linhas) {
    for (var k = linhas.length - 1; k >= 0; k--) {
      if (!String(linhas[k]).trim()) continue;
      var m = RE_ID_BLOCO.exec(linhas[k]);
      if (m) { linhas[k] = linhas[k].slice(0, m.index); return m[1]; }
      break;
    }
    return '';
  }

  // --- citacoes e callouts

  function renderQuote(quoted, ctx, startLine, attr) {
    var first = quoted[0] || '';
    var co = RE_CALLOUT.exec(first);
    var corte = co ? co[1].indexOf('|') : -1;
    // Tipo como o Obsidian guarda: aparado, minusculo, hifen no lugar de
    // espaco ([!Meu Tipo] vira meu-tipo). data-callout leva o tipo assim (e
    // por ele que um trecho de CSS casa); cor e icone vem do tipo conhecido,
    // e tipo desconhecido se veste de note.
    var tipo = co ? (corte === -1 ? co[1] : co[1].slice(0, corte)).trim().toLowerCase().replace(/\s+/g, '-') : '';

    if (co && tipo) {
      var kind = Object.prototype.hasOwnProperty.call(CALLOUT_ALIASES, tipo) ? CALLOUT_ALIASES[tipo] : 'note';
      var meta = corte === -1 ? '' : co[1].slice(corte + 1).trim();
      var fold = co[2];
      var title = (co[3] || '').trim();
      var bodyLines = quoted.slice(1);
      var dados = ' data-callout="' + escapeAttr(tipo) + '"' +
        (meta ? ' data-callout-metadata="' + escapeAttr(meta) + '"' : '') +
        (fold ? ' data-callout-fold="' + fold + '"' : '');

      var titleInline = new Inline(ctx);
      var titleHtml = title ? titleInline.render(title) : escapeHtml(tituloDoCallout(tipo));
      var bodyHtml = bodyLines.length ? parseBlocks(bodyLines, ctx, startLine + 1) : '';

      if (fold) {
        return '<details class="callout callout-' + kind + '"' + dados +
          (fold === '+' ? ' open' : '') + attr + '>' +
          '<summary class="callout-title"><span class="callout-icon" data-icon="' + kind + '"></span>' +
          '<span class="callout-title-inner">' + titleHtml + '</span></summary>' +
          '<div class="callout-content">' + bodyHtml + '</div></details>';
      }

      return '<div class="callout callout-' + kind + '"' + dados + attr + '>' +
        '<div class="callout-title"><span class="callout-icon" data-icon="' + kind + '"></span>' +
        '<span class="callout-title-inner">' + titleHtml + '</span></div>' +
        (bodyHtml ? '<div class="callout-content">' + bodyHtml + '</div>' : '') + '</div>';
    }

    return '<blockquote' + attr + '>' + parseBlocks(quoted, ctx, startLine) + '</blockquote>';
  }

  /*
   * Titulo de callout sem titulo escrito: o proprio tipo, hifen vira espaco e
   * so a primeira letra maiuscula ([!FAQ] mostra "Faq", [!meu-tipo] mostra
   * "Meu tipo"). E o que o Obsidian faz, sem traduzir: a mesma nota tem o
   * mesmo titulo nos dois programas, em qualquer idioma da interface.
   */
  function tituloDoCallout(tipo) {
    var t = String(tipo).replace(/-/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ------------------------------------------------------------ bloco HTML

  /*
   * Bloco HTML cru (<details>, <div align="center">, <kbd>...) aparece
   * renderizado, como no Obsidian, mas passa por esta peneira antes da peneira
   * do DOM: so tags da lista, so atributos inofensivos; <a href> vira link do
   * app (externo pelo navegador, nota pelo MarkPad); <img>, <video> e <audio>
   * vao pelo mesmo caminho do ![](...), entao imagem remota continua barrada
   * ate o clique. Script, estilo, iframe e afins somem com o conteudo; tag
   * desconhecida (center, font) some e o texto dela fica. Comentario some.
   */
  var HTML_SOME_COM_CONTEUDO = /^(?:script|style|iframe|frame|frameset|object|embed|applet|template|noscript|textarea|title|svg|math|select|xmp|noembed|noframes|plaintext|head|canvas)$/;
  var HTML_VAZIAS = /^(?:br|hr|wbr|col|img|input|source|track|area|base|link|meta|param)$/;
  var RE_TAG_HTML = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'=<>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

  function htmlDoBloco(src, ctx) {
    var inline = new Inline(ctx);
    var out = '';
    var abertas = [];
    var pilhaA = [];
    var re = new RegExp(RE_TAG_HTML.source, 'g');
    var ultimo = 0;
    var m;

    while ((m = re.exec(src))) {
      out += textoDoHtml(src.slice(ultimo, m.index));
      ultimo = re.lastIndex;
      if (m[0].charAt(1) === '!') continue;

      var fecha = m[1];
      var nome = m[2].toLowerCase();
      var at = lerAtributos(m[3] || '');

      if (HTML_SOME_COM_CONTEUDO.test(nome)) {
        if (!fecha && !m[4]) {
          var fimRe = new RegExp('</' + nome + '\\s*>', 'ig');
          fimRe.lastIndex = ultimo;
          ultimo = fimRe.exec(src) ? fimRe.lastIndex : src.length;
          re.lastIndex = ultimo;
        }
        continue;
      }

      if (nome === 'img' || nome === 'video' || nome === 'audio') {
        if (fecha) continue;
        var origem = at.src || '';
        if (nome !== 'img' && !m[4]) {
          // O conteudo (<source>, texto para navegador velho) sai junto; o
          // endereco pode estar no <source>.
          var fimM = new RegExp('</' + nome + '\\s*>', 'ig');
          fimM.lastIndex = ultimo;
          var achouM = fimM.exec(src);
          var dentro = src.slice(ultimo, achouM ? achouM.index : src.length);
          ultimo = achouM ? fimM.lastIndex : src.length;
          re.lastIndex = ultimo;
          if (!origem) {
            var fonte = /<source\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(dentro);
            if (fonte) origem = decodificaAtributo(fonte[1] || fonte[2] || fonte[3] || '');
          }
        }
        if (!origem) continue;
        var w = /^\d+$/.test(at.width || '') ? at.width : '';
        var h = /^\d+$/.test(at.height || '') ? at.height : '';
        var medida = w ? '|' + w + (h ? 'x' + h : '') : '';
        out += inline.image(origem, (at.alt || '') + medida, at.title || '');
        continue;
      }

      if (nome === 'a') {
        if (fecha) { if (pilhaA.length) out += '</' + pilhaA.pop() + '>'; continue; }
        if (at.href == null) { out += '<span>'; pilhaA.push('span'); continue; }
        var link = inline.link(at.href, '\uE002', at.title || '');
        out += link.slice(0, link.lastIndexOf('\uE002'));
        pilhaA.push(/^<span/.test(link) ? 'span' : 'a');
        continue;
      }

      if (nome === 'input' || nome === 'button' || !Object.prototype.hasOwnProperty.call(ALLOWED_TAGS, nome)) continue;

      if (fecha) {
        out += '</' + nome + '>';
        var pos = abertas.lastIndexOf(nome);
        if (pos !== -1) abertas.splice(pos, 1);
        continue;
      }

      var extra = '';
      if (/^(?:left|right|center|justify)$/i.test(at.align || '')) extra += ' align="' + at.align.toLowerCase() + '"';
      if (at.title) extra += ' title="' + escapeAttr(at.title) + '"';
      // A peneira do DOM deixa do estilo so medida e alinhamento.
      if (at.style) extra += ' style="' + escapeAttr(at.style) + '"';
      if ((nome === 'td' || nome === 'th') && /^\d+$/.test(at.colspan || '')) extra += ' colspan="' + at.colspan + '"';
      if ((nome === 'td' || nome === 'th') && /^\d+$/.test(at.rowspan || '')) extra += ' rowspan="' + at.rowspan + '"';
      if (nome === 'ol' && /^\d+$/.test(at.start || '')) extra += ' start="' + at.start + '"';
      if (nome === 'details' && at.open !== undefined) extra += ' open';
      out += '<' + nome + extra + '>';
      if (!m[4] && !HTML_VAZIAS.test(nome)) abertas.push(nome);
    }

    out += textoDoHtml(src.slice(ultimo));
    return { html: out, abertas: abertas };
  }

  /** Texto entre tags: entidade passa (o navegador decodifica), o resto do '<' '>' '&' vira literal. */
  function textoDoHtml(t) {
    return t
      .replace(/&(?!(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function decodificaAtributo(v) {
    return String(v)
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function lerAtributos(s) {
    var at = Object.create(null);
    var re = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    var m;
    while ((m = re.exec(s))) {
      var v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
      at[m[1].toLowerCase()] = decodificaAtributo(v);
    }
    return at;
  }

  /*
   * A linha que fecha o container aberto num bloco HTML (</details> no comeco
   * da linha), contando os do mesmo nome abertos no meio e pulando cerca de
   * codigo. -1 se nao fecha: o bloco fica sozinho e o navegador fecha a tag.
   */
  function fechoDoHtml(lines, de, tag) {
    var abre = new RegExp('^\\s{0,3}<' + tag + '(?=[\\s>/]|$)', 'i');
    var fecha = new RegExp('^\\s{0,3}</' + tag + '\\s*>', 'i');
    var prof = 0;
    var cerca = null;
    for (var k = de; k < lines.length; k++) {
      var l = lines[k];
      if (cerca) { if (cerca.test(l)) cerca = null; continue; }
      var f = RE_FENCE.exec(l);
      if (f) { cerca = new RegExp('^\\s{0,3}' + f[2][0] + '{' + f[2].length + ',}\\s*$'); continue; }
      if (fecha.test(l)) { if (!prof) return k; prof--; continue; }
      if (abre.test(l)) prof++;
    }
    return -1;
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
      // O marcador ^id pertence ao paragrafo do PROPRIO item — nunca a
      // sublista ou bloco aninhado, que tem dono proprio e se resolve na
      // recursao. Olhar o item inteiro dava o id do filho ao pai (ou comia
      // o marcador sem dar id a ninguem, quando a ultima linha era sublista).
      var proprias = 1;
      while (proprias < item.lines.length) {
        var propria = item.lines[proprias];
        if (!propria.trim() || RE_UL.test(propria) || RE_OL.test(propria) || isBlockStart(propria)) break;
        proprias++;
      }
      var cabeca = item.lines.slice(0, proprias);
      var idBloco = tiraIdDeBloco(cabeca);
      if (idBloco) for (var pc = 0; pc < proprias; pc++) item.lines[pc] = cabeca[pc];
      var text = item.lines.join('\n');
      // Qualquer caractere entre colchetes e uma tarefa, como no Obsidian:
      // [x] feita, [ ] aberta, e [>] [?] [!] [/] [-] ... estados que o tema
      // pinta pelo data-task. Tambem como no Obsidian, todo estado que nao e
      // espaco marca a caixa e poe is-checked; so x/X riscam o texto (CSS).
      var task = /^\[(.)\]\s+([\s\S]*)$/.exec(item.lines[0] || '');
      var cls = '';
      var prefix = '';

      if (task) {
        hasTasks = true;
        var estado = task[1];
        var checked = estado !== ' ';
        cls = ' class="task-item' + (checked ? ' is-checked' : '') + '" data-task="' + escapeAttr(estado) + '"';
        if (ctx.opts.lineMap) cls += ' data-task-line="' + linhaDe(item) + '"';
        // O estado custom tambem vai no input: e dele que o CSS tira o
        // desenho da caixinha, com content: attr(data-task).
        prefix = '<input type="checkbox" disabled' + (checked ? ' checked' : '') +
          (checked && estado.toLowerCase() !== 'x' ? ' data-task="' + escapeAttr(estado) + '"' : '') + '>';
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

      return '<li' + (idBloco ? ' id="' + escapeAttr(idBloco) + '"' : '') + cls + '>' + prefix + inner + '</li>';
    }).join('\n');

    var listCls = hasTasks ? ' class="contains-task-list"' : '';
    return '<' + tag + listCls + startAttr + attr + '>\n' + body + '\n</' + tag + '>';
  }

  // --- notas de rodape

  /*
   * Definicoes [^rotulo]: do documento, com o corpo inteiro (varios
   * paragrafos pela indentacao, ver fimDaNota). Rotulo em minusculas: a
   * referencia acha a definicao sem olhar maiusculas. Vale a primeira
   * definicao de cada rotulo, e definicao dentro de cerca de codigo e codigo.
   */
  function collectFootnotes(lines, ctx) {
    var cerca = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (cerca) { if (cerca.test(l)) cerca = null; continue; }
      var f = RE_FENCE.exec(l);
      if (f) { cerca = new RegExp('^\\s{0,3}' + f[2][0] + '{' + f[2].length + ',}\\s*$'); continue; }

      var m = RE_FOOTNOTE.exec(l);
      if (!m) continue;

      var fim = fimDaNota(lines, i);
      var corpo = [m[3]];
      for (var k = i + 1; k < fim; k++) {
        corpo.push(indentOf(lines[k]) >= 4 ? lines[k].replace(/^ {4}/, '') : lines[k].trim());
      }
      var id = m[2].toLowerCase();
      if (ctx.footnotes[id] === undefined) ctx.footnotes[id] = corpo.join('\n');
      i = fim - 1;
    }
  }

  function renderFootnotes(ctx) {
    if (!ctx.footnoteOrder.length) return '';

    // O corpo e lido como blocos (paragrafos, lista, codigo), sem mapa de
    // linha: a nota mora no fim da tela, longe da linha de onde veio, e o
    // editor ao vivo nao teria como devolve-la ao lugar. Titulo dentro de
    // nota tambem nao entra no sumario.
    var opts = ctx.opts;
    var noSumario = ctx.toc.length;
    ctx.opts = {};
    for (var o in opts) if (Object.prototype.hasOwnProperty.call(opts, o)) ctx.opts[o] = opts[o];
    ctx.opts.lineMap = false;

    var items = [];
    // A lista cresce enquanto as notas sao montadas: nota que cita outra nota.
    for (var n = 0; n < ctx.footnoteOrder.length; n++) {
      var id = ctx.footnoteOrder[n];
      var corpo = parseBlocks(String(ctx.footnotes[id] || '').split('\n'), ctx, 0);
      var voltas = '';
      var vezes = ctx.footnoteRefs[id] || 1;
      for (var v = 0; v < vezes; v++) {
        var alvo = 'fnref-' + id + (v ? '-' + v : '');
        voltas += ' <a class="footnote-backref" href="#' + escapeAttr(alvo) + '" ' +
          'data-anchor="' + escapeAttr(alvo) + '">&#8617;&#xFE0E;</a>';
      }
      // A seta de volta fica no fim do ultimo paragrafo, nao numa linha sozinha.
      if (/<\/p>$/.test(corpo)) corpo = corpo.replace(/<\/p>$/, voltas + '</p>');
      else corpo += '<p>' + voltas.slice(1) + '</p>';
      items.push('<li id="fn-' + escapeAttr(id) + '" data-footnote-id="fn-' + escapeAttr(id) + '">' + corpo + '</li>');
    }

    ctx.opts = opts;
    ctx.toc.length = noSumario;
    return '<hr class="footnotes-sep"><section class="footnotes"><ol>' + items.join('\n') + '</ol></section>';
  }

  // --------------------------------------------------------- API principal

  function render(src, opts) {
    var ctx = {
      toc: [],
      slugs: {},
      // Sem prototipo: um rotulo [^constructor] nao pode achar o Object.
      footnotes: Object.create(null),
      footnoteRefs: Object.create(null),
      footnoteOrder: [],
      inlineFootnoteSeq: 0,
      opts: opts || {}
    };

    var fm = extractFrontmatter(String(src || ''));
    var lines = fm.body.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    collectFootnotes(lines, ctx);
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
   'data-tag data-src data-remote data-copy data-lang data-embed data-alias data-media open rel loading ' +
   'align data-callout-metadata data-callout-fold data-footnote-id'
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

      // O botao Copiar do bloco de codigo e o unico <button> que o parser
      // monta (data-copy); o do texto do usuario nao chega aqui com esse
      // atributo, as duas peneiras de string tiram todos.
      var copiar = tag === 'button' && node.hasAttribute('data-copy');
      if (!ALLOWED_TAGS[tag] && !copiar) { doomed.push(node); continue; }

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
      if (copiar) node.setAttribute('type', 'button');
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
