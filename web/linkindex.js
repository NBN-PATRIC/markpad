/**
 * Indice de links da pasta aberta: quem aponta para quem.
 *
 * O C# lista a pasta e manda o texto de cada nota que mudou desde a ultima
 * varredura (op `indexFolder`); daqui para frente e tudo JS, e de proposito
 * um parser so. O mesmo `varre` que monta o indice le o documento ainda nao
 * salvo (links de saida da aba ativa) e reescreve os links quando um arquivo
 * muda de nome ou de pasta — dois parsers, um em cada lado da ponte, mais
 * cedo ou mais tarde discordariam sobre o que e link.
 *
 * Caminhos aqui dentro sao relativos a raiz e sempre com '/'. Comparacao sem
 * caixa, como o Windows.
 *
 * Nada aqui toca o DOM nem a ponte: `node dev/test-linkindex.js` roda tudo.
 */
(function (root) {
  'use strict';

  // As mesmas extensoes que o C# trata como markdown.
  var RE_EXT_NOTA = /\.(md|markdown|mdown|mkd|mdx)$/i;

  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
  var RE_WIKI = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  // Rotulo com um nivel de colchete dentro (imagem dentro de link) e destino
  // no formato do parser de leitura: <com espaco> ou cru com parenteses
  // equilibrados, titulo opcional.
  var RE_MD = /(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
  var RE_TITULO = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
  // Regra do Obsidian, a mesma do leitor (markdown.js, passo 14).
  var RE_TAG = /(?:^|\s)#(?!\d+(?:[\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]|$))([^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]+)/g;
  var RE_TAG_NOME = /^(?!\d+$)[^\s!"#$%&'()*+,.:;<=>?@^`{|}~\[\]\\\u2000-\u206F\u2E00-\u2E7F]+$/;
  // Duas letras ou mais antes do ':' — "C:/notas/x.md" continua caminho.
  var RE_ESQUEMA = /^[a-z][a-z0-9+.\-]+:/i;
  var RE_YAML_CHAVE = /^([A-Za-z_][\w\u00C0-\u024F -]*):(.*)$/;
  var RE_YAML_ITEM = /^\s+-\s*(.*)$/;

  // ------------------------------------------------------------ caminhos

  function barras(p) { return String(p == null ? '' : p).replace(/\\/g, '/'); }
  function chave(p) { return barras(p).toLowerCase(); }
  function nomeDe(rel) { var s = barras(rel); return s.slice(s.lastIndexOf('/') + 1); }
  function pastaDe(rel) { var s = barras(rel); var i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); }
  function ehNota(nome) { return RE_EXT_NOTA.test(nome); }
  function semExtNota(nome) { return String(nome).replace(RE_EXT_NOTA, ''); }

  /** Junta pasta e caminho relativo resolvendo '.' e '..'. */
  function junta(dir, rel) {
    var out = [];
    (dir ? barras(dir).split('/') : []).concat(barras(rel).split('/')).forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..');
        return;
      }
      out.push(p);
    });
    return out.join('/');
  }

  /** Caminho relativo que leva da pasta `deDir` ao arquivo `para`. */
  function relativo(deDir, para) {
    var a = deDir ? barras(deDir).split('/') : [];
    var b = barras(para).split('/');
    var i = 0;
    while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
    var partes = [];
    for (var k = i; k < a.length; k++) partes.push('..');
    return partes.concat(b.slice(i)).join('/');
  }

  // ----------------------------------------------------------- varredura

  /** Faixas [inicio, fim) de codigo entre crases numa linha. */
  function trechosDeCodigo(linha) {
    var faixas = [];
    var re = /`+/g, m;
    while ((m = re.exec(linha))) {
      var n = m[0].length;
      var fecha = new RegExp('(^|[^`])(`{' + n + '})(?!`)', 'g');
      fecha.lastIndex = m.index + n;
      var f = fecha.exec(linha);
      if (!f) continue;   // crase sem par: texto comum
      var fim = f.index + f[1].length + n;
      faixas.push([m.index, fim]);
      re.lastIndex = fim;
    }
    return faixas;
  }

  function dentro(faixas, pos) {
    for (var i = 0; i < faixas.length; i++) if (pos >= faixas[i][0] && pos < faixas[i][1]) return true;
    return false;
  }

  function decodifica(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function linksDaLinha(linha, base, numero, so) {
    var achados = [];
    // links que nao entram no indice (ancora, URL), mas ocupam a linha
    achados.outros = [];
    var codigo = trechosDeCodigo(linha);
    var wikis = [];
    var m;

    RE_WIKI.lastIndex = 0;
    while ((m = RE_WIKI.exec(linha))) {
      if (dentro(codigo, m.index)) continue;
      var inicioDentro = m.index + m[1].length + 2;
      var miolo = m[2];
      var corte = miolo.indexOf('|');
      var alvoBruto = corte < 0 ? miolo : miolo.slice(0, corte);
      // [[Nota\|apelido]] e como se escreve o apelido dentro de tabela
      if (corte >= 0 && alvoBruto.slice(-1) === '\\') alvoBruto = alvoBruto.slice(0, -1);
      var hash = alvoBruto.indexOf('#');
      var arquivo = hash < 0 ? alvoBruto : alvoBruto.slice(0, hash);
      wikis.push([m.index, m.index + m[0].length]);
      achados.push({
        tipo: 'wiki',
        embed: m[1] === '!',
        alvo: arquivo.trim(),
        secao: hash < 0 ? null : alvoBruto.slice(hash + 1).trim(),
        apelido: corte < 0 ? null : miolo.slice(corte + 1),
        linha: numero,
        ini: base + m.index,
        fim: base + m.index + m[0].length,
        alvoIni: base + inicioDentro,
        alvoFim: base + inicioDentro + arquivo.length,
        bruto: arquivo
      });
    }
    if (so === 'wiki') return achados;

    (function procura(texto, desloc) {
      var re = new RegExp(RE_MD.source, 'g');
      var mm;
      while ((mm = re.exec(texto))) {
        var pos = desloc + mm.index;
        if (dentro(codigo, pos) || dentro(wikis, pos)) continue;
        var prefixo = mm[1].length + 1 + mm[2].length + 2;
        var destino = mm[3];
        var offDest = mm[0].indexOf(destino, prefixo);
        // imagem dentro do rotulo: [![x](img.png)](nota.md)
        if (mm[2].indexOf('](') >= 0) procura(mm[2], pos + mm[1].length + 1);
        if (!destino) continue;

        var angulo = destino.charAt(0) === '<';
        var cru = angulo ? destino.slice(1, -1) : destino;
        var cruIni = pos + offDest + (angulo ? 1 : 0);
        if (!cru || cru.charAt(0) === '#' || RE_ESQUEMA.test(cru)) {
          achados.outros.push([base + pos, base + pos + mm[0].length]);
          continue;
        }

        var h = cru.indexOf('#');
        var arq = h < 0 ? cru : cru.slice(0, h);
        achados.push({
          tipo: 'md',
          embed: mm[1] === '!',
          alvo: decodifica(arq),
          secao: h < 0 ? null : decodifica(cru.slice(h + 1)),
          apelido: null,
          linha: numero,
          ini: base + pos,
          fim: base + pos + mm[0].length,
          alvoIni: base + cruIni,
          alvoFim: base + cruIni + arq.length,
          bruto: arq,
          angulo: angulo
        });
      }
    })(linha, 0);

    var outros = achados.outros;
    achados.sort(function (a, b) { return a.ini - b.ini; });
    achados.outros = outros;
    return achados;
  }

  /*
   * Percorre o texto linha a linha chamando `cb(tipo, dados)`:
   *   ('link', link) para cada link (wikilink, embed, link markdown);
   *   ('titulo', { nivel, texto, linha }); ('tag', nome); ('apelido', nome).
   * Cerca de codigo e codigo entre crases ficam de fora; do frontmatter
   * saem as tags, os apelidos e os wikilinks escritos como valor.
   */
  function varre(texto, cb) {
    var linhas = String(texto == null ? '' : texto).split('\n');
    var pos = 0;
    var cerca = null;
    var frontmatter = linhas.length > 1 && linhas[0].replace(/\s+$/, '') === '---';
    var listaDe = null;

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];
      var base = pos;
      pos += linha.length + 1;
      var numero = i + 1;

      if (frontmatter) {
        if (i === 0) continue;
        var corte = linha.replace(/\s+$/, '');
        if (corte === '---' || corte === '...') { frontmatter = false; continue; }

        linksDaLinha(linha, base, numero, 'wiki').forEach(function (l) { cb('link', l); });

        var item = RE_YAML_ITEM.exec(linha);
        if (listaDe && item) { valoresYaml(item[1], listaDe, cb); continue; }
        var campo = RE_YAML_CHAVE.exec(linha);
        if (campo) {
          var nomeCampo = campo[1].trim().toLowerCase();
          listaDe = (nomeCampo === 'tags' || nomeCampo === 'tag') ? 'tag'
            : (nomeCampo === 'aliases' || nomeCampo === 'alias') ? 'apelido' : null;
          if (listaDe) valoresYaml(campo[2], listaDe, cb);
        }
        continue;
      }

      var cercaAqui = RE_FENCE.exec(linha);
      if (cerca) {
        if (cercaAqui && cercaAqui[1].charAt(0) === cerca.charAt(0) && cercaAqui[1].length >= cerca.length &&
            /^\s*$/.test(linha.slice(cercaAqui[0].length))) cerca = null;
        continue;
      }
      if (cercaAqui) { cerca = cercaAqui[1]; continue; }
      // bloco indentado com 4 espacos ou tab, fora de lista: codigo tambem
      if (/^( {4}|\t)/.test(linha) && !/^\s*([-*+]|\d+[.)])\s/.test(linha) && i > 0 && /^\s*$/.test(linhas[i - 1])) continue;

      var t = RE_TITULO.exec(linha);
      if (t) cb('titulo', { nivel: t[1].length, texto: t[2], linha: numero });

      var links = linksDaLinha(linha, base, numero);
      links.forEach(function (l) { cb('link', l); });

      // '#' dentro de link e ancora ([x](#secao)), nao tag
      var fora = trechosDeCodigo(linha).concat(links.concat(links.outros.map(function (f) {
        return { ini: f[0], fim: f[1] };
      })).map(function (l) { return [l.ini - base, l.fim - base]; }));
      var tm;
      RE_TAG.lastIndex = 0;
      while ((tm = RE_TAG.exec(linha))) {
        if (dentro(fora, tm.index + tm[0].indexOf('#'))) continue;
        cb('tag', tm[1].replace(/\/+$/, ''));
      }
    }
  }

  /** "a, b" / "[a, b]" / "a" — o jeito solto de escrever lista em YAML. */
  function valoresYaml(valor, tipo, cb) {
    valor = String(valor).trim().replace(/^\[|\]$/g, '').trim();
    if (!valor) return;
    var partes = tipo === 'tag' ? valor.split(/[,\s]+/) : valor.split(',');
    partes.forEach(function (p) {
      var v = p.trim().replace(/^["']|["']$/g, '').trim();
      if (tipo === 'tag') {
        v = v.replace(/^#/, '').replace(/\/+$/, '');
        if (!RE_TAG_NOME.test(v)) return;
      }
      if (v && !/^\[\[/.test(v)) cb(tipo, v);
    });
  }

  /** Tudo o que o indice guarda de uma nota. */
  function analisa(texto) {
    var linhas = String(texto == null ? '' : texto).split('\n');
    var out = { links: [], titulos: [], tags: [], apelidos: [] };
    var tagsVistas = {};
    varre(texto, function (tipo, d) {
      if (tipo === 'link') {
        out.links.push({
          tipo: d.tipo, embed: d.embed, alvo: d.alvo, secao: d.secao, linha: d.linha,
          texto: trechoDe(linhas[d.linha - 1], d.ini - inicioDaLinha(linhas, d.linha))
        });
      } else if (tipo === 'titulo') {
        out.titulos.push(d);
      } else if (tipo === 'tag') {
        var k = d.toLowerCase();
        if (!tagsVistas[k]) { tagsVistas[k] = 1; out.tags.push(d); }
      } else if (tipo === 'apelido') {
        out.apelidos.push(d);
      }
    });
    return out;
  }

  function inicioDaLinha(linhas, numero) {
    var p = 0;
    for (var i = 0; i < numero - 1; i++) p += linhas[i].length + 1;
    return p;
  }

  /** A linha do link, cortada em volta dele quando passa de 240 caracteres. */
  function trechoDe(linha, col) {
    linha = String(linha || '');
    if (linha.length <= 240) return linha.trim();
    var ini = Math.max(0, Math.min(col - 80, linha.length - 240));
    return (ini > 0 ? '…' : '') + linha.slice(ini, ini + 240).trim() + (ini + 240 < linha.length ? '…' : '');
  }

  // --------------------------------------------------------------- indice

  /*
   * arquivos: [{ path, rel, name, md, analise }] — analise so nas notas.
   * Monta os mapas de busca e resolve todos os links de uma vez: a pergunta
   * "quem aponta para esta nota" vira leitura de mapa, sem varrer de novo.
   */
  function cria(arquivos) {
    var idx = {
      arquivos: [],
      porRel: Object.create(null),
      porPath: Object.create(null),
      porNome: Object.create(null),       // nome com extensao
      porNomeNota: Object.create(null),   // nome da nota sem extensao
      entradas: Object.create(null),      // rel do alvo -> [{ de, link }]
      quebrados: []                       // [{ de, link }]
    };

    (arquivos || []).forEach(function (a) {
      var rel = barras(a.rel);
      var arq = { path: a.path, rel: rel, name: a.name || nomeDe(rel), md: !!a.md, analise: a.analise || null, saidas: [] };
      idx.arquivos.push(arq);
      idx.porRel[chave(rel)] = arq;
      if (a.path) idx.porPath[chave(a.path)] = arq;
      empilha(idx.porNome, arq.name.toLowerCase(), arq);
      if (arq.md) empilha(idx.porNomeNota, semExtNota(arq.name).toLowerCase(), arq);
    });

    idx.arquivos.forEach(function (arq) {
      if (!arq.analise) return;
      arq.analise.links.forEach(function (link) {
        var para = resolve(idx, link, arq.rel);
        arq.saidas.push({ link: link, para: para });
        if (para) {
          if (para !== arq) empilha(idx.entradas, chave(para.rel), { de: arq, link: link });
        } else {
          idx.quebrados.push({ de: arq, link: link });
        }
      });
    });

    return idx;
  }

  function empilha(mapa, k, v) {
    (mapa[k] || (mapa[k] = [])).push(v);
  }

  /*
   * Para onde um link aponta, ou null. Link markdown e relativo a pasta da
   * nota (e, quebrado, cai na busca por nome, como o clique ja fazia);
   * wikilink e nome: mesma pasta primeiro, depois caminho a partir da raiz,
   * depois o nome em qualquer pasta, o mais raso ganhando.
   */
  function resolve(idx, link, origemRel) {
    var alvo = barras(link.alvo).trim();
    var dir = pastaDe(origemRel);

    if (!alvo) {
      // [[#Secao]] e a propria nota
      return link.tipo === 'wiki' ? (idx.porRel[chave(origemRel)] || null) : null;
    }

    if (/^[a-zA-Z]:\//.test(alvo)) return idx.porPath[chave(alvo)] || null;
    if (alvo.charAt(0) === '/') alvo = alvo.replace(/^\/+/, '');

    if (link.tipo === 'md') {
      var rel = junta(dir, alvo);
      var achado = idx.porRel[chave(rel)] || (!ehNota(rel) ? idx.porRel[chave(rel + '.md')] : null);
      return achado || porNome(idx, alvo, dir);
    }

    var semPonto = alvo.replace(/^\.\//, '');
    var aoLado = junta(dir, semPonto);
    return idx.porRel[chave(aoLado)] || idx.porRel[chave(aoLado + '.md')] ||
      idx.porRel[chave(semPonto)] || idx.porRel[chave(semPonto + '.md')] ||
      porNome(idx, semPonto, dir);
  }

  function porNome(idx, alvo, dir) {
    var nome = nomeDe(alvo).toLowerCase();
    var vistos = [];
    (idx.porNome[nome] || []).concat(idx.porNomeNota[nome] || []).forEach(function (a) {
      if (vistos.indexOf(a) < 0) vistos.push(a);
    });
    if (!vistos.length) return null;

    // [[pasta/nota]]: o caminho escrito tem que bater com o fim do caminho real
    var temPasta = alvo.indexOf('/') >= 0;
    if (temPasta) {
      var fim = '/' + chave(alvo).replace(/^(\.\.?\/)+/, '');
      vistos = vistos.filter(function (a) {
        var r = '/' + chave(a.rel);
        return r.slice(-fim.length) === fim || semExtNota(r).slice(-fim.length) === fim;
      });
      if (!vistos.length) return null;
    }

    var dirK = chave(dir);
    vistos.sort(function (a, b) {
      var ma = chave(pastaDe(a.rel)) === dirK ? 0 : 1;
      var mb = chave(pastaDe(b.rel)) === dirK ? 0 : 1;
      if (ma !== mb) return ma - mb;
      var pa = a.rel.split('/').length, pb = b.rel.split('/').length;
      if (pa !== pb) return pa - pb;
      return chave(a.rel) < chave(b.rel) ? -1 : 1;
    });
    return vistos[0];
  }

  function arquivoDe(idx, caminho) {
    if (!idx || !caminho) return null;
    return idx.porPath[chave(caminho)] || idx.porRel[chave(caminho)] || null;
  }

  /*
   * Quem aponta para `caminho` (absoluto ou relativo a raiz), agrupado por
   * arquivo de origem: [{ path, rel, hits: [{ line, text }] }]. Dois links na
   * mesma linha contam uma vez — o que se mostra e a linha.
   */
  function backlinks(idx, caminho) {
    var arq = arquivoDe(idx, caminho);
    if (!arq) return [];
    var grupos = Object.create(null);
    var ordem = [];
    (idx.entradas[chave(arq.rel)] || []).forEach(function (e) {
      var k = chave(e.de.rel);
      var g = grupos[k];
      if (!g) { g = grupos[k] = { path: e.de.path, rel: e.de.rel, hits: [], linhas: {} }; ordem.push(g); }
      if (g.linhas[e.link.linha]) return;
      g.linhas[e.link.linha] = 1;
      g.hits.push({ line: e.link.linha, text: e.link.texto });
    });
    ordem.sort(function (a, b) { return chave(a.rel) < chave(b.rel) ? -1 : 1; });
    return ordem.map(function (g) {
      g.hits.sort(function (a, b) { return a.line - b.line; });
      return { path: g.path, rel: g.rel, hits: g.hits };
    });
  }

  /*
   * Os links que saem de um texto (o da aba, salvo ou nao), um por alvo:
   * [{ alvo, secao, embed, para: arquivo|null, linhas: [n] }]. Alvos que
   * resolvem para o mesmo arquivo se juntam; quebrados, pelo texto escrito.
   */
  function saidas(idx, texto, origemRel) {
    var out = [];
    var porChave = Object.create(null);
    analisa(texto).links.forEach(function (link) {
      if (!link.alvo) return;   // [[#Secao]]: navegacao interna
      var para = idx ? resolve(idx, link, origemRel) : null;
      var k = para ? 'a:' + chave(para.rel) : 'q:' + chave(link.alvo);
      var item = porChave[k];
      if (!item) {
        item = porChave[k] = { alvo: link.alvo, embed: link.embed, para: para, linhas: [] };
        out.push(item);
      }
      if (item.linhas.indexOf(link.linha) < 0) item.linhas.push(link.linha);
    });
    return out;
  }

  // ------------------------------------------------- menções sem link

  /*
   * A linha cita o nome da nota em prosa, fora de link e de codigo? E o que
   * o Obsidian chama de mencao nao ligada. Fronteira de palavra com letra
   * acentuada: \b do JS so conhece ASCII, e "Ação" nao pode bater em "Reação".
   */
  function mencionaSemLink(linha, nome) {
    nome = String(nome || '').trim();
    if (!nome) return false;
    var limpa = String(linha || '');
    var links = linksDaLinha(limpa, 0, 1);
    var tirar = trechosDeCodigo(limpa).concat(links.outros, links.map(function (l) { return [l.ini, l.fim]; }));
    tirar.sort(function (a, b) { return b[0] - a[0]; });
    tirar.forEach(function (f) { limpa = limpa.slice(0, f[0]) + ' '.repeat(f[1] - f[0]) + limpa.slice(f[1]); });
    var esc = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Colado em '#', '/' ou '\' e tag ou pedaco de caminho (#projeto/api,
    // docs/api.md), nao alguem falando da nota.
    return new RegExp('(^|[^\\p{L}\\p{N}_#/\\\\])' + esc + '(?![\\p{L}\\p{N}_/\\\\])', 'iu').test(limpa);
  }

  /*
   * O botao "Ligar" das mencoes nao ligadas: troca a primeira mencao solta
   * de `termo` na linha por [[alvo]] — ou [[alvo|como estava escrito]],
   * quando o texto da linha nao e o nome da nota (apelido, outra caixa).
   * Devolve a linha nova, ou null se a mencao ja nao esta la.
   */
  function ligaMencao(linha, termo, alvo) {
    linha = String(linha || '');
    termo = String(termo || '').trim();
    if (!termo) return null;
    var links = linksDaLinha(linha, 0, 1);
    var fora = trechosDeCodigo(linha).concat(links.outros, links.map(function (l) { return [l.ini, l.fim]; }));
    var esc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(^|[^\\p{L}\\p{N}_#/\\\\])(' + esc + ')(?![\\p{L}\\p{N}_/\\\\])', 'giu');
    var m;
    while ((m = re.exec(linha))) {
      var ini = m.index + m[1].length;
      if (dentro(fora, ini)) continue;
      var escrito = m[2];
      var link = escrito === alvo ? '[[' + alvo + ']]' : '[[' + alvo + '|' + escrito + ']]';
      return linha.slice(0, ini) + link + linha.slice(ini + escrito.length);
    }
    return null;
  }

  // ----------------------------------------------- reescrever ao mover

  /*
   * Reescreve os links de `texto` depois que um arquivo trocou de nome ou de
   * pasta. `idx` e o indice de ANTES da troca — e com ele que se sabe para
   * onde cada link apontava.
   *   opts.origem      rel da nota dona deste texto, antes
   *   opts.origemNova  rel dela depois (muda quando a propria nota foi movida)
   *   opts.de / opts.para  rel do arquivo que mudou, antes e depois
   * Wikilink escrito so com o nome continua so com o nome, a menos que o nome
   * novo fique ambiguo; com pasta, ganha o caminho novo. Link markdown vira o
   * caminho relativo novo, no mesmo formato (<...> ou com %20).
   * Devolve { texto, trocas }.
   */
  function reescreve(idx, texto, opts) {
    var origem = barras(opts.origem);
    var origemNova = barras(opts.origemNova || opts.origem);
    var deK = opts.de ? chave(opts.de) : null;
    var para = opts.para ? barras(opts.para) : null;
    var moveu = chave(origem) !== chave(origemNova);
    var trocas = [];

    varre(texto, function (tipo, link) {
      if (tipo !== 'link' || !link.alvo) return;
      var aponta = resolve(idx, link, origem);
      if (!aponta) return;
      var alvoNovo = null;

      if (deK && chave(aponta.rel) === deK) alvoNovo = para;
      else if (moveu && link.tipo === 'md' && !/^[a-zA-Z]:\//.test(link.alvo) &&
               chave(junta(pastaDe(origem), link.alvo)) === chave(aponta.rel)) alvoNovo = aponta.rel;
      if (!alvoNovo) return;

      var escrito = link.tipo === 'wiki'
        ? alvoWiki(idx, link, alvoNovo, deK)
        : alvoMd(link, pastaDe(origemNova), alvoNovo);
      if (escrito !== null && escrito !== link.bruto) trocas.push({ ini: link.alvoIni, fim: link.alvoFim, por: escrito, linha: link.linha });
    });

    if (!trocas.length) return { texto: texto, trocas: 0 };
    var out = texto;
    trocas.sort(function (a, b) { return b.ini - a.ini; });
    trocas.forEach(function (t) { out = out.slice(0, t.ini) + t.por + out.slice(t.fim); });
    return { texto: out, trocas: trocas.length };
  }

  function alvoWiki(idx, link, novoRel, excluiK) {
    var comExt = ehNota(link.alvo) || !ehNota(novoRel);
    var nome = nomeDe(novoRel);
    if (!comExt) nome = semExtNota(nome);

    // Outro arquivo com o mesmo nome em outra pasta: so o nome ficaria
    // ambiguo e o link podia passar a abrir o vizinho.
    var homonimos = (comExt ? idx.porNome[nomeDe(novoRel).toLowerCase()] : idx.porNomeNota[semExtNota(nomeDe(novoRel)).toLowerCase()]) || [];
    var outros = homonimos.filter(function (a) { return chave(a.rel) !== excluiK && chave(a.rel) !== chave(novoRel); });

    if (barras(link.alvo).indexOf('/') < 0 && !outros.length) return nome;
    return comExt ? barras(novoRel) : semExtNota(barras(novoRel));
  }

  function alvoMd(link, deDir, novoRel) {
    var rel = relativo(deDir, novoRel);
    if (link.angulo) return rel;
    // O mesmo jeito de escrever: quem codificava acento continua codificando.
    if (/%[89A-F][0-9A-F]/i.test(link.bruto)) return encodeURI(rel);
    return rel.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  // --------------------------------------------- operadores de busca

  var RE_OPERADOR = /(^|\s)(-?)(file|path|tag):("([^"]*)"|\S*)/gi;

  /*
   * Separa os operadores do Obsidian (file:, path:, tag:, com '-' na frente
   * para excluir e aspas para valor com espaco) do texto que vai para o
   * grep. Texto inteiro entre aspas perde as aspas: e frase exata, que e o
   * que a busca literal ja faz.
   *   "tag:proj -path:arquivo reuniao" -> { texto: 'reuniao', filtros: [...] }
   */
  function analisaConsulta(q) {
    var filtros = [];
    var texto = String(q == null ? '' : q).replace(RE_OPERADOR, function (tudo, antes, nao, op, valor, aspas) {
      var v = aspas !== undefined ? aspas : valor;
      if (!v) return tudo;   // "tag:" sozinho ainda esta sendo digitado
      filtros.push({ op: op.toLowerCase(), valor: v, nao: nao === '-' });
      return antes;
    }).trim();
    var frase = /^"([^"]*)"$/.exec(texto);
    if (frase) texto = frase[1];
    return { texto: texto, filtros: filtros };
  }

  /* Os arquivos do indice que passam em todos os filtros. */
  function filtra(idx, filtros) {
    if (!idx) return [];
    return idx.arquivos.filter(function (a) {
      return filtros.every(function (f) {
        var v = f.valor.toLowerCase();
        var bate;
        if (f.op === 'file') bate = a.name.toLowerCase().indexOf(v) >= 0;
        else if (f.op === 'path') bate = chave(a.rel).indexOf(chave(v)) >= 0;
        else {
          v = v.replace(/^#/, '');
          bate = !!(a.analise && a.analise.tags.some(function (tag) {
            tag = tag.toLowerCase();
            return tag === v || tag.indexOf(v + '/') === 0;
          }));
        }
        return f.nao ? !bate : bate;
      });
    });
  }

  var api = {
    analisaConsulta: analisaConsulta,
    filtra: filtra,
    analisa: analisa,
    varre: varre,
    cria: cria,
    resolve: resolve,
    arquivoDe: arquivoDe,
    backlinks: backlinks,
    saidas: saidas,
    mencionaSemLink: mencionaSemLink,
    ligaMencao: ligaMencao,
    reescreve: reescreve,
    relativo: relativo,
    junta: junta,
    ehNota: ehNota,
    semExtNota: semExtNota
  };

  root.MarkPadLinkIndex = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
