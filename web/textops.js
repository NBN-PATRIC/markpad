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

  global.MarkPadTextOps = {
    expandReplacement: expandReplacement,
    replaceAll: replaceAll,
    replacementAt: replacementAt
  };
})(window);
