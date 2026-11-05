/*
 * textops.js — operacoes de texto puras do MarkPad (sem DOM), testaveis no
 * Node por dev/test-textops.js.
 *
 * Substituir: o modo expressao regular aceita, no texto de substituicao,
 *   $1..$99   grupo numerado        $<nome>  grupo com nome
 *   $&        o trecho encontrado   $$       um cifrao
 *   \n \r \t  quebra, retorno, tab  \\       uma barra
 * (o mesmo vocabulario do Notepad++ e do VS Code). Fora do modo regex o texto
 * de substituicao vale ao pe da letra, cifrao e barra inclusos.
 */
(function (global) {
  'use strict';

  function expandEscapes(s) {
    return s.replace(/\\([nrt\\])/g, function (_, c) {
      return c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : '\\';
    });
  }

  /** Monta o texto de substituicao para UMA ocorrencia `m` (resultado de exec). */
  function expandReplacement(template, m) {
    var out = template.replace(/\$(\$|&|<([^>]*)>|(\d{1,2}))/g, function (tudo, sinal, nome, num) {
      if (sinal === '$') return '$';
      if (sinal === '&') return m[0];
      if (nome !== undefined) {
        var g = m.groups && Object.prototype.hasOwnProperty.call(m.groups, nome) ? m.groups[nome] : undefined;
        return g === undefined ? (m.groups ? '' : tudo) : g;
      }
      // $12 vale como grupo 12 se ele existir; senao, $1 seguido de "2".
      var n = parseInt(num, 10);
      if (num.length === 2 && n >= m.length) {
        var um = parseInt(num[0], 10);
        if (um >= 1 && um < m.length) return (m[um] || '') + num[1];
        return tudo;
      }
      if (n >= 1 && n < m.length) return m[n] || '';
      return tudo;
    });
    return expandEscapes(out);
  }

  function replacementFor(template, m, regexMode) {
    return regexMode ? expandReplacement(template, m) : template;
  }

  /** Troca todas as ocorrencias. `re` precisa ter a flag g. */
  function replaceAll(text, re, template, regexMode) {
    var count = 0;
    re.lastIndex = 0;
    var next = text.replace(re, function () {
      count++;
      var args = Array.prototype.slice.call(arguments);
      // Os ultimos argumentos do replace sao posicao, texto inteiro e, quando
      // ha grupos com nome, o objeto deles. Remonta o formato do exec.
      var temGrupos = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
      var grupos = temGrupos ? args.pop() : undefined;
      args.pop(); // texto inteiro
      args.pop(); // posicao
      var m = args;
      m.groups = grupos;
      return replacementFor(template, m, regexMode);
    });
    return { text: next, count: count };
  }

  /**
   * Substituicao da ocorrencia que comeca em `start`, com o contexto inteiro
   * (lookbehind e ancoras continuam valendo). Devolve o texto novo daquele
   * trecho e o fim do trecho original, ou null se nao casar ali.
   */
  function replacementAt(text, re, start, template, regexMode) {
    var flags = re.flags.replace('g', '');
    if (flags.indexOf('y') === -1) flags += 'y';
    var sticky = new RegExp(re.source, flags);
    sticky.lastIndex = start;
    var m = sticky.exec(text);
    if (!m) return null;
    return { start: start, end: start + m[0].length, text: replacementFor(template, m, regexMode) };
  }

  // ================================================== operacoes com linhas
  //
  // Do Notepad++ (estudo 02, secoes 9 a 11), com a torcao do Markdown: linha
  // vazia separa bloco (nada a apaga sem pedir), dois espacos no fim e quebra
  // forcada (aparar preserva), recuo e estrutura de lista (ordenar lista leva
  // os subitens junto). Todas recebem o texto inteiro e a selecao e devolvem
  // { ini, fim, texto, selIni, selFim }: o trecho [ini, fim) troca por `texto`
  // e a selecao nova. Assim o editor aplica com insertText e o Ctrl+Z desfaz.

  /** As linhas inteiras que a selecao toca (o fim no comeco de uma linha nao a inclui). */
  function faixaDeLinhas(texto, s, e) {
    if (e > s && texto.charAt(e - 1) === '\n') e--;
    var ini = texto.lastIndexOf('\n', s - 1) + 1;
    var fim = texto.indexOf('\n', e);
    if (fim === -1) fim = texto.length;
    return { ini: ini, fim: fim };
  }

  function porLinhas(texto, s, e, fn) {
    var f = faixaDeLinhas(texto, s, e);
    var linhas = texto.slice(f.ini, f.fim).split('\n');
    var novas = fn(linhas);
    var novo = novas.join('\n');
    return { ini: f.ini, fim: f.fim, texto: novo, selIni: f.ini, selFim: f.ini + novo.length };
  }

  var colador = null;
  function compara(a, b) {
    if (!colador) {
      try { colador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }); }
      catch (err) { colador = { compare: function (x, y) { return x < y ? -1 : x > y ? 1 : 0; } }; }
    }
    return colador.compare(a, b);
  }

  /** modo: 'az', 'za', 'tamanho', 'inverter'. Estavel: iguais ficam na ordem em que estavam. */
  function ordenaLinhas(texto, s, e, modo) {
    return porLinhas(texto, s, e, function (linhas) {
      if (modo === 'inverter') return linhas.slice().reverse();
      var idx = linhas.map(function (l, i) { return { l: l, i: i }; });
      idx.sort(function (a, b) {
        var c = modo === 'tamanho' ? a.l.length - b.l.length : compara(a.l, b.l);
        if (modo === 'za') c = -c;
        return c || a.i - b.i;
      });
      return idx.map(function (x) { return x.l; });
    });
  }

  var RE_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[.\]\s+)?/;

  /*
   * Ordena os itens de uma lista levando os subitens e as linhas de
   * continuacao juntos (o Notepad++ embaralharia os filhos). O nivel e o do
   * item menos recuado da selecao; numeracao 1. 2. 3. e refeita na ordem nova.
   */
  function ordenaLista(texto, s, e, modo) {
    return porLinhas(texto, s, e, function (linhas) {
      var base = Infinity;
      linhas.forEach(function (l) { var m = RE_ITEM.exec(l); if (m) base = Math.min(base, m[1].length); });
      if (base === Infinity) return linhas;
      var antes = [], grupos = [], atual = null;
      linhas.forEach(function (l) {
        var m = RE_ITEM.exec(l);
        if (m && m[1].length === base) { atual = { linhas: [l], chave: l.slice(m[0].length) }; grupos.push(atual); }
        else if (atual) atual.linhas.push(l);
        else antes.push(l);
      });
      // Linha em branco no fim de um grupo fica onde estava (fim da lista).
      var cauda = [];
      var ultimo = grupos[grupos.length - 1];
      while (ultimo && ultimo.linhas.length > 1 && !ultimo.linhas[ultimo.linhas.length - 1].trim()) cauda.unshift(ultimo.linhas.pop());
      var ordenados = grupos.map(function (g, i) { return { g: g, i: i }; });
      ordenados.sort(function (a, b) {
        var c = compara(a.g.chave, b.g.chave);
        if (modo === 'za') c = -c;
        return c || a.i - b.i;
      });
      var numerada = grupos.length && /^\s*\d+[.)]/.test(grupos[0].linhas[0]);
      var saida = antes.slice();
      ordenados.forEach(function (x, n) {
        var ls = x.g.linhas.slice();
        if (numerada) ls[0] = ls[0].replace(/^(\s*)\d+([.)])/, function (t, r, p) { return r + (n + 1) + p; });
        saida.push.apply(saida, ls);
      });
      return saida.concat(cauda);
    });
  }

  /** Remove linhas repetidas (todas, ou so as seguidas). A primeira fica. */
  function removeDuplicadas(texto, s, e, seguidas) {
    return porLinhas(texto, s, e, function (linhas) {
      var vistas = Object.create(null);
      return linhas.filter(function (l, i) {
        if (seguidas) return i === 0 || l !== linhas[i - 1];
        if (vistas['\u0001' + l]) return false;
        vistas['\u0001' + l] = true;
        return true;
      });
    });
  }

  /** Varias linhas vazias seguidas viram uma (o seguro em Markdown). */
  function reduzVazias(texto, s, e) {
    return porLinhas(texto, s, e, function (linhas) {
      return linhas.filter(function (l, i) { return l.trim() || i === 0 || linhas[i - 1].trim(); });
    });
  }

  function removeVazias(texto, s, e) {
    return porLinhas(texto, s, e, function (linhas) { return linhas.filter(function (l) { return l.trim(); }); });
  }

  /*
   * Une as linhas num paragrafo so (texto colado de PDF ou e-mail). A partir
   * da segunda, tira o recuo e o '>' de citacao; o prefixo da primeira fica.
   * Hifen de quebra de palavra no fim da linha some ("manu-\ntencao").
   */
  function unirLinhas(texto, s, e) {
    var f = faixaDeLinhas(texto, s, e);
    var linhas = texto.slice(f.ini, f.fim).split('\n');
    if (linhas.length < 2) {
      // Sem selecao de varias linhas: junta a linha do cursor com a de baixo.
      if (f.fim >= texto.length) return null;
      var prox = texto.indexOf('\n', f.fim + 1);
      if (prox === -1) prox = texto.length;
      f = { ini: f.ini, fim: prox };
      linhas = texto.slice(f.ini, f.fim).split('\n');
    }
    var out = linhas[0].replace(/\s+$/, '');
    for (var i = 1; i < linhas.length; i++) {
      var resto = linhas[i].replace(/^\s*(>\s?)*/, '').trim();
      if (!resto) continue;
      if (/[A-Za-zÀ-ÿ]-$/.test(out)) out = out.slice(0, -1) + resto;
      else out += (out ? ' ' : '') + resto;
    }
    return { ini: f.ini, fim: f.fim, texto: out, selIni: f.ini + out.length, selFim: f.ini + out.length };
  }

  /*
   * Apara espacos no fim da linha sem mudar o que o Markdown mostra: dois ou
   * mais espacos antes de uma linha com texto sao quebra forcada e viram
   * exatamente dois. Dentro de bloco de codigo cercado nada muda.
   */
  function aparaDireita(texto, s, e) {
    var tudo = s === e;
    var f = tudo ? { ini: 0, fim: texto.length } : faixaDeLinhas(texto, s, e);
    var linhas = texto.slice(f.ini, f.fim).split('\n');
    // A cerca e contada desde o comeco do documento, nao da selecao.
    var cerca = null;
    texto.slice(0, f.ini).split('\n').forEach(function (l) {
      var m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (m) { if (!cerca) cerca = m[1].charAt(0); else if (m[1].charAt(0) === cerca) cerca = null; }
    });
    var depois = texto.slice(f.fim + 1).split('\n')[0] || '';
    var novas = linhas.map(function (l, i) {
      var m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (m) { if (!cerca) cerca = m[1].charAt(0); else if (m[1].charAt(0) === cerca) cerca = null; return l.replace(/\s+$/, ''); }
      if (cerca) return l;
      var seguinte = i + 1 < linhas.length ? linhas[i + 1] : depois;
      var quebra = / {2,}$/.test(l) && l.trim() && seguinte.trim();
      return l.replace(/[ \t]+$/, '') + (quebra ? '  ' : '');
    });
    var novo = novas.join('\n');
    return { ini: f.ini, fim: f.fim, texto: novo, selIni: tudo ? s : f.ini, selFim: tudo ? s : f.ini + novo.length };
  }

  /** So o recuo (o comeco da linha): TAB para `n` espacos, ou o contrario. */
  function trocaRecuo(texto, s, e, paraEspacos, n) {
    n = n || 4;
    var tudo = s === e;
    var f = tudo ? { ini: 0, fim: texto.length } : faixaDeLinhas(texto, s, e);
    var novo = texto.slice(f.ini, f.fim).split('\n').map(function (l) {
      var m = /^[ \t]+/.exec(l);
      if (!m) return l;
      var col = 0;
      for (var i = 0; i < m[0].length; i++) col = m[0].charAt(i) === '\t' ? col + n - (col % n) : col + 1;
      var recuo = paraEspacos ? new Array(col + 1).join(' ') : new Array(Math.floor(col / n) + 1).join('\t') + new Array(col % n + 1).join(' ');
      return recuo + l.slice(m[0].length);
    }).join('\n');
    return { ini: f.ini, fim: f.fim, texto: novo, selIni: tudo ? s : f.ini, selFim: tudo ? s : f.ini + novo.length };
  }

  // Particulas que o titulo em portugues deixa minusculas (menos no comeco).
  var PARTICULAS = ['a', 'à', 'ao', 'aos', 'as', 'às', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no',
    'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'sem', 'sob', 'um', 'uma'];

  /** modo: 'maiusculas', 'minusculas', 'titulo' (com as particulas), 'frase'. Sem selecao: a palavra do cursor. */
  function trocaCaixa(texto, s, e, modo) {
    if (s === e) {
      var a = s, b = s;
      while (a > 0 && /[\wÀ-ÿ]/.test(texto.charAt(a - 1))) a--;
      while (b < texto.length && /[\wÀ-ÿ]/.test(texto.charAt(b))) b++;
      s = a; e = b;
      if (s === e) return null;
    }
    var trecho = texto.slice(s, e);
    var novo;
    if (modo === 'maiusculas') novo = trecho.toLocaleUpperCase('pt-BR');
    else if (modo === 'minusculas') novo = trecho.toLocaleLowerCase('pt-BR');
    else if (modo === 'titulo') {
      var primeira = true;
      novo = trecho.toLocaleLowerCase('pt-BR').replace(/[\wÀ-ÿ]+/g, function (p) {
        var r = (!primeira && PARTICULAS.indexOf(p) !== -1) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1);
        primeira = false;
        return r;
      });
    } else {
      var inicio = true;
      novo = trecho.toLocaleLowerCase('pt-BR').replace(/[\wÀ-ÿ]|[.!?]\s|\n/g, function (c) {
        if (c.length > 1 || c === '\n') { inicio = true; return c; }
        if (inicio) { inicio = false; return c.toLocaleUpperCase('pt-BR'); }
        return c;
      });
    }
    return { ini: s, fim: e, texto: novo, selIni: s, selFim: s + novo.length };
  }

  /** Com selecao duplica o trecho logo depois dele; sem, a linha do cursor (regra do Notepad++). */
  function duplica(texto, s, e) {
    if (s !== e) {
      var t = texto.slice(s, e);
      return { ini: e, fim: e, texto: t, selIni: e, selFim: e + t.length };
    }
    var f = faixaDeLinhas(texto, s, s);
    var linha = texto.slice(f.ini, f.fim);
    var col = s - f.ini;
    return { ini: f.fim, fim: f.fim, texto: '\n' + linha, selIni: f.fim + 1 + col, selFim: f.fim + 1 + col };
  }

  /** Move as linhas da selecao uma linha para cima (-1) ou para baixo (+1). */
  function moveLinhas(texto, s, e, dir) {
    var f = faixaDeLinhas(texto, s, e);
    if (dir < 0) {
      if (f.ini === 0) return null;
      var a = texto.lastIndexOf('\n', f.ini - 2) + 1;
      var acima = texto.slice(a, f.ini - 1);
      var bloco = texto.slice(f.ini, f.fim);
      return { ini: a, fim: f.fim, texto: bloco + '\n' + acima, selIni: s - (acima.length + 1), selFim: e - (acima.length + 1) };
    }
    if (f.fim >= texto.length) return null;
    var b = texto.indexOf('\n', f.fim + 1);
    if (b === -1) b = texto.length;
    var abaixo = texto.slice(f.fim + 1, b);
    var blk = texto.slice(f.ini, f.fim);
    return { ini: f.ini, fim: b, texto: abaixo + '\n' + blk, selIni: s + abaixo.length + 1, selFim: e + abaixo.length + 1 };
  }

  /** Apaga as linhas inteiras da selecao (com a quebra). */
  function apagaLinhas(texto, s, e) {
    var f = faixaDeLinhas(texto, s, e);
    var ini = f.ini, fim = f.fim;
    if (fim < texto.length) fim++;
    else if (ini > 0) ini--;
    return { ini: ini, fim: fim, texto: '', selIni: ini, selFim: ini };
  }

  // ------------------------------------------------------------- tabelas
  //
  // Tabela GFM como texto: celulas separadas por '|' que nao esteja escapado
  // ('\|' fica dentro da celula, como no [[nota\|apelido]]).

  function celulasDaLinha(linha) {
    var s = String(linha).trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.length && s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
    var celulas = [], atual = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) { atual += ch + s.charAt(i + 1); i++; continue; }
      if (ch === '|') { celulas.push(atual.trim()); atual = ''; continue; }
      atual += ch;
    }
    celulas.push(atual.trim());
    return celulas;
  }

  function eDelimitador(celulas) {
    return celulas.length > 0 && celulas.every(function (c) { return /^:?-+:?$/.test(c.replace(/\s+/g, '')); });
  }

  function larguraVisual(s) { return Array.from(s).length; }

  function repete(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }

  /**
   * Alinha as colunas de uma tabela (o texto das linhas dela), respeitando o
   * alinhamento da linha de tracos (:--, :-:, --:). Sem linha de tracos na
   * segunda linha, devolve o texto como veio.
   */
  function formataTabela(texto) {
    var linhas = String(texto).split('\n');
    if (linhas.length < 2) return texto;
    var recuo = /^[ \t]*/.exec(linhas[0])[0];
    var linhasCel = linhas.map(celulasDaLinha);
    if (!eDelimitador(linhasCel[1])) return texto;
    var n = 0;
    linhasCel.forEach(function (r) { n = Math.max(n, r.length); });
    var alin = [], larg = [];
    for (var c = 0; c < n; c++) {
      var d = (linhasCel[1][c] || '---').replace(/\s+/g, '');
      alin[c] = /^:.*:$/.test(d) ? 'c' : /:$/.test(d) ? 'd' : /^:/.test(d) ? 'e' : '';
      var w = 3;
      for (var r = 0; r < linhasCel.length; r++) {
        if (r === 1) continue;
        w = Math.max(w, larguraVisual(linhasCel[r][c] || ''));
      }
      larg[c] = w;
    }
    return linhasCel.map(function (r, i) {
      var partes = [];
      for (var c2 = 0; c2 < n; c2++) {
        var x = larg[c2], a = alin[c2];
        if (i === 1) {
          partes.push(a === 'c' ? ':' + repete('-', x - 2) + ':' : a === 'e' ? ':' + repete('-', x - 1) : a === 'd' ? repete('-', x - 1) + ':' : repete('-', x));
          continue;
        }
        var t = r[c2] || '';
        var folga = x - larguraVisual(t);
        partes.push(a === 'd' ? repete(' ', folga) + t
          : a === 'c' ? repete(' ', Math.floor(folga / 2)) + t + repete(' ', Math.ceil(folga / 2))
          : t + repete(' ', folga));
      }
      return recuo + '| ' + partes.join(' | ') + ' |';
    }).join('\n');
  }

  /** Inicio (sem os espacos da borda) e fim do texto da celula n de uma linha. */
  function faixaDaCelula(linha, n) {
    var p = 0;
    if (/^\s*\|/.test(linha)) p = linha.indexOf('|') + 1;
    for (var col = 0; p < linha.length && col < n; p++) {
      var ch = linha.charAt(p);
      if (ch === '\\') { p++; continue; }
      if (ch === '|') col++;
    }
    var q = p;
    while (q < linha.length) {
      var c = linha.charAt(q);
      if (c === '\\') { q += 2; continue; }
      if (c === '|') break;
      q++;
    }
    q = Math.min(q, linha.length);
    var ini = p, fim = q;
    while (ini < fim && linha.charAt(ini) === ' ') ini++;
    while (fim > ini && linha.charAt(fim - 1) === ' ') fim--;
    // Celula vazia: o cursor fica depois do espaco da borda, nao colado na barra.
    if (ini === q && ini > p) ini = fim = p + 1;
    return { ini: ini, fim: fim };
  }

  /** Quantas barras de coluna ha antes da posicao (a da borda esquerda conta). */
  function colunaNaLinha(linha, pos) {
    var n = 0;
    for (var i = 0; i < pos && i < linha.length; i++) {
      var ch = linha.charAt(i);
      if (ch === '\\') { i++; continue; }
      if (ch === '|') n++;
    }
    return /^\s*\|/.test(linha) ? Math.max(0, n - 1) : n;
  }

  global.MarkPadTextOps = {
    celulasDaLinha: celulasDaLinha,
    formataTabela: formataTabela,
    faixaDaCelula: faixaDaCelula,
    colunaNaLinha: colunaNaLinha,
    expandReplacement: expandReplacement,
    replaceAll: replaceAll,
    replacementAt: replacementAt,
    faixaDeLinhas: faixaDeLinhas,
    ordenaLinhas: ordenaLinhas,
    ordenaLista: ordenaLista,
    removeDuplicadas: removeDuplicadas,
    reduzVazias: reduzVazias,
    removeVazias: removeVazias,
    unirLinhas: unirLinhas,
    aparaDireita: aparaDireita,
    trocaRecuo: trocaRecuo,
    trocaCaixa: trocaCaixa,
    duplica: duplica,
    moveLinhas: moveLinhas,
    apagaLinhas: apagaLinhas
  };
})(window);
