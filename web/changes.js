/*
 * changes.js — histórico de edição por linha, no estilo do Notepad++.
 *
 * Duas referências, não uma:
 *   origem  = como o arquivo estava quando foi aberto do disco
 *   salvo   = como estava na última gravação
 *
 * Daí saem os dois estados que interessam, com as cores do Notepad++ 8.9:
 *   diferente de "salvo"                    -> modificado, não gravado (#FF8000)
 *   igual a "salvo" mas diferente da origem -> alteração já gravada  (#00A000)
 *
 * O Notepad++ ainda distingue "revertido para o salvo" e "revertido para a
 * origem". Não implementados: exigiriam guardar o histórico de cada linha ao
 * longo da sessão, e as duas cores acima já respondem o que se quer saber.
 */
(function (global) {
  'use strict';

  var LIMITE_LCS = 400;   // acima disso o alinhamento fino sai caro demais

  /**
   * Alinha duas listas de linhas e devolve, para cada linha de `atual`,
   * true se ela não tem correspondente em `base`.
   *
   * Estratégia: corta o prefixo e o sufixo iguais — que é a maior parte de
   * qualquer edição real — e só then alinha o miolo. Se o miolo for grande,
   * marca tudo como alterado em vez de gastar O(n*m).
   */
  function linhasAlteradas(base, atual) {
    var n = atual.length;
    var marcas = new Array(n);
    for (var i = 0; i < n; i++) marcas[i] = false;

    var ini = 0;
    var limite = Math.min(base.length, n);
    while (ini < limite && base[ini] === atual[ini]) ini++;

    var fim = 0;
    while (fim < limite - ini && base[base.length - 1 - fim] === atual[n - 1 - fim]) fim++;

    var baseMiolo = base.slice(ini, base.length - fim);
    var atualMiolo = atual.slice(ini, n - fim);

    if (!atualMiolo.length) return marcas;

    if (baseMiolo.length > LIMITE_LCS || atualMiolo.length > LIMITE_LCS) {
      for (var k = 0; k < atualMiolo.length; k++) marcas[ini + k] = true;
      return marcas;
    }

    // LCS clássico; só roda no miolo, que aqui é pequeno por construção.
    var a = baseMiolo.length, b = atualMiolo.length;
    var tabela = [];
    for (var r = 0; r <= a; r++) tabela.push(new Int32Array(b + 1));

    for (var x = a - 1; x >= 0; x--) {
      for (var y = b - 1; y >= 0; y--) {
        tabela[x][y] = baseMiolo[x] === atualMiolo[y]
          ? tabela[x + 1][y + 1] + 1
          : Math.max(tabela[x + 1][y], tabela[x][y + 1]);
      }
    }

    var p = 0, q = 0;
    while (p < a && q < b) {
      if (baseMiolo[p] === atualMiolo[q]) { p++; q++; }
      else if (tabela[p + 1][q] >= tabela[p][q + 1]) p++;
      else { marcas[ini + q] = true; q++; }
    }
    while (q < b) { marcas[ini + q] = true; q++; }

    return marcas;
  }

  /**
   * Estado de cada linha do texto atual: '', 'mod' ou 'saved'.
   */
  function statusPorLinha(origem, salvo, atual) {
    var linhasAtual = atual.split('\n');
    var vazio = new Array(linhasAtual.length);
    for (var i = 0; i < linhasAtual.length; i++) vazio[i] = '';

    var mudouDesdeSalvo = salvo === atual ? null : linhasAlteradas(salvo.split('\n'), linhasAtual);
    var mudouDesdeOrigem = origem === atual ? null : linhasAlteradas(origem.split('\n'), linhasAtual);

    for (var j = 0; j < linhasAtual.length; j++) {
      if (mudouDesdeSalvo && mudouDesdeSalvo[j]) vazio[j] = 'mod';
      else if (mudouDesdeOrigem && mudouDesdeOrigem[j]) vazio[j] = 'saved';
    }

    return vazio;
  }

  /** Resumo para a barra de status. */
  function resumo(status) {
    var mod = 0, salvas = 0;
    for (var i = 0; i < status.length; i++) {
      if (status[i] === 'mod') mod++;
      else if (status[i] === 'saved') salvas++;
    }
    return { modificadas: mod, gravadas: salvas };
  }

  global.MarkPadChanges = {
    statusPorLinha: statusPorLinha,
    linhasAlteradas: linhasAlteradas,
    resumo: resumo
  };
})(window);
