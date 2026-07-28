/*
 * Testa o histórico de edição por linha.
 *
 * O risco aqui não é corromper arquivo, é mentir: marcar linha que não mudou
 * ou deixar de marcar linha que mudou. Ambos corroem a confiança na marca.
 *
 *   node dev/test-changes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'web', 'changes.js'), 'utf8'), sandbox);
const ch = sandbox.window.MarkPadChanges;

let passed = 0, failed = 0;

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FALHA ' + name + (detail ? '\n        ' + detail : '')); }
}

/** Índices marcados como alterados, para ficar legível na asserção. */
function marcados(status, tipo) {
  const out = [];
  status.forEach((s, i) => { if (s === tipo) out.push(i); });
  return out;
}

const BASE = ['um', 'dois', 'tres', 'quatro', 'cinco'].join('\n');

console.log('\nsem alteracao');
{
  const s = ch.statusPorLinha(BASE, BASE, BASE);
  check('nada marcado', marcados(s, 'mod').length === 0 && marcados(s, 'saved').length === 0);
}

console.log('\numa linha alterada e nao salva');
{
  const atual = ['um', 'DOIS', 'tres', 'quatro', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, BASE, atual);
  check('so a linha 1 marcada como modificada',
    JSON.stringify(marcados(s, 'mod')) === '[1]', JSON.stringify(marcados(s, 'mod')));
  check('nenhuma marcada como gravada', marcados(s, 'saved').length === 0);
}

console.log('\nalteracao ja gravada (origem != salvo == atual)');
{
  const gravado = ['um', 'DOIS', 'tres', 'quatro', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, gravado, gravado);
  check('linha 1 marcada como gravada',
    JSON.stringify(marcados(s, 'saved')) === '[1]', JSON.stringify(marcados(s, 'saved')));
  check('nada pendente de gravar', marcados(s, 'mod').length === 0);
}

console.log('\ngravada antes, e alterada de novo depois');
{
  const gravado = ['um', 'DOIS', 'tres', 'quatro', 'cinco'].join('\n');
  const atual = ['um', 'DOIS', 'tres', 'QUATRO', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, gravado, atual);
  check('linha 3 pendente', JSON.stringify(marcados(s, 'mod')) === '[3]', JSON.stringify(marcados(s, 'mod')));
  check('linha 1 continua verde', JSON.stringify(marcados(s, 'saved')) === '[1]', JSON.stringify(marcados(s, 'saved')));
}

console.log('\nlinha inserida');
{
  const atual = ['um', 'dois', 'NOVA', 'tres', 'quatro', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, BASE, atual);
  check('so a inserida marcada', JSON.stringify(marcados(s, 'mod')) === '[2]', JSON.stringify(marcados(s, 'mod')));
}

console.log('\nlinha removida');
{
  const atual = ['um', 'tres', 'quatro', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, BASE, atual);
  check('remocao nao marca as sobreviventes', marcados(s, 'mod').length === 0,
    JSON.stringify(marcados(s, 'mod')));
}

console.log('\nvarias alteracoes espalhadas');
{
  const atual = ['UM', 'dois', 'tres', 'QUATRO', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, BASE, atual);
  check('marca as duas, e so as duas',
    JSON.stringify(marcados(s, 'mod')) === '[0,3]', JSON.stringify(marcados(s, 'mod')));
}

console.log('\ninsercao no comeco nao desloca as marcas');
{
  const atual = ['ZERO', 'um', 'dois', 'tres', 'quatro', 'cinco'].join('\n');
  const s = ch.statusPorLinha(BASE, BASE, atual);
  check('so a linha 0 marcada', JSON.stringify(marcados(s, 'mod')) === '[0]',
    JSON.stringify(marcados(s, 'mod')));
}

console.log('\ndocumento grande: cai no modo conservador sem travar');
{
  const grande = Array.from({ length: 3000 }, (_, i) => 'linha ' + i).join('\n');
  const mexido = grande.split('\n');
  for (let i = 0; i < 1200; i += 2) mexido[i] = 'X' + i;
  const inicio = Date.now();
  const s = ch.statusPorLinha(grande, grande, mexido.join('\n'));
  const ms = Date.now() - inicio;
  check('terminou rapido', ms < 1500, ms + 'ms');
  check('marcou alguma coisa', marcados(s, 'mod').length > 0);
  check('nao marcou o arquivo inteiro', marcados(s, 'mod').length < 3000,
    marcados(s, 'mod').length + ' de 3000');
}

console.log('\nresumo para a barra de status');
{
  const gravado = ['um', 'DOIS', 'tres', 'quatro', 'cinco'].join('\n');
  const atual = ['um', 'DOIS', 'tres', 'QUATRO', 'cinco'].join('\n');
  const r = ch.resumo(ch.statusPorLinha(BASE, gravado, atual));
  check('conta 1 pendente e 1 gravada', r.modificadas === 1 && r.gravadas === 1,
    JSON.stringify(r));
}

console.log('\n' + passed + '/' + (passed + failed) + ' passaram');
process.exit(failed ? 1 : 0);
