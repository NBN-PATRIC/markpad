/**
 * Paletas de cor do MarkPad.
 *
 * O style.css ja e todo dirigido por variaveis (`--color-base-*`, `--accent-*`,
 * as cores nomeadas), no mesmo desenho do Obsidian: `--background-primary` e
 * `var(--color-base-00)`, `--text-normal` e `var(--color-base-100)`, e assim por
 * diante. Trocar de paleta, entao, e so trocar essas ~20 raizes — todo o resto
 * da interface segue atras sozinho.
 *
 * As variaveis sao escritas no `style` do <body>, nao num <style> montado por
 * concatenacao. Inline nao ha regra para fechar nem seletor para abrir: o valor
 * entra pelo CSSOM como valor, e o pior que um valor estragado faz e nao valer
 * nada — a folha embutida continua sendo o padrao embaixo. E por isso que
 * remover uma paleta e so apagar as propriedades (`clear`), sem recarregar
 * nada.
 *
 * Ainda assim todo valor passa por `corSegura` antes de ser escrito, e isso
 * importa de verdade no tema importado do VS Code, que vem de um arquivo de
 * fora: a CSP da pagina permite `img-src https:`, entao um `--color-base-00`
 * com `url(https://algum-lugar/pixel)` dentro seria buscado na rede quando
 * caisse num `background` — um farol de "abriu o MarkPad" escondido num tema.
 * So literal de cor entra.
 */
(function () {
  'use strict';

  // ------------------------------------------------------- validacao de cor

  var HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var NUM = '(?:\\d{1,3}(?:\\.\\d+)?%?)';
  var ALPHA = '(?:\\d{1,3}(?:\\.\\d+)?%?|\\.\\d+)';
  var RGB_VIRGULA = new RegExp('^rgba?\\(\\s*' + NUM + '\\s*(?:,\\s*' + NUM + '\\s*){2}(?:,\\s*' + ALPHA + '\\s*)?\\)$', 'i');
  var RGB_ESPACO = new RegExp('^rgba?\\(\\s*' + NUM + '\\s+' + NUM + '\\s+' + NUM + '\\s*(?:\\/\\s*' + ALPHA + '\\s*)?\\)$', 'i');
  var HSL = new RegExp('^hsla?\\(\\s*' + NUM + '(?:deg)?\\s*(?:[,\\s]\\s*' + NUM + '\\s*){2}(?:[,\\/]\\s*' + ALPHA + '\\s*)?\\)$', 'i');

  var NOMEADAS = {
    transparent: 1, currentcolor: 1, black: 1, white: 1, gray: 1, grey: 1,
    silver: 1, red: 1, maroon: 1, orange: 1, yellow: 1, olive: 1, green: 1,
    lime: 1, teal: 1, aqua: 1, cyan: 1, blue: 1, navy: 1, purple: 1,
    fuchsia: 1, magenta: 1, pink: 1
  };

  function corSegura(v) {
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (!s || s.length > 64) return false;
    if (HEX.test(s)) return true;
    if (RGB_VIRGULA.test(s) || RGB_ESPACO.test(s) || HSL.test(s)) return true;
    return NOMEADAS[s.toLowerCase()] === 1;
  }

  // As tres do acento nao sao cores: sao os componentes soltos de um hsl()
  // (`--accent-h: 258`, `--accent-s: 88%`). Um numero com % opcional, so.
  var COMPONENTE = /^-?\d{1,3}(?:\.\d+)?%?$/;

  // ------------------------------------------------------------- cor: contas

  function paraRgb(hex) {
    var s = String(hex).trim().replace('#', '');
    if (s.length === 3 || s.length === 4) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (s.length === 8) s = s.slice(0, 6);
    if (s.length !== 6) return null;
    var n = parseInt(s, 16);
    if (isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function paraHex(rgb) {
    function dois(n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + dois(rgb.r) + dois(rgb.g) + dois(rgb.b);
  }

  function misturar(a, b, t) {
    return paraHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    });
  }

  /** Luminancia relativa (WCAG), para decidir se um tema e claro ou escuro. */
  function luminancia(rgb) {
    function canal(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * canal(rgb.r) + 0.7152 * canal(rgb.g) + 0.0722 * canal(rgb.b);
  }

  function ehEscuro(hex) {
    var rgb = paraRgb(hex);
    return rgb ? luminancia(rgb) < 0.25 : true;
  }

  /** hex -> {h, s, l} em graus e porcentagem, como as variaveis do acento. */
  function paraHsl(hex) {
    var rgb = paraRgb(hex);
    if (!rgb) return null;
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  // A escada de cinzas do tema padrao, lida como posicao entre o fundo (0) e o
  // texto (1). Qualquer par fundo/texto passa por aqui e sai com a mesma
  // proporcao de contraste que o tema de casa — e por isso que um tema do VS
  // Code, que so declara duas ou tres cores de fundo, chega inteiro.
  var DEGRAUS = [
    ['00', 0], ['05', 0.015], ['10', 0.03], ['20', 0.045], ['25', 0.08],
    ['30', 0.13], ['35', 0.18], ['40', 0.29], ['50', 0.38], ['60', 0.65],
    ['70', 0.77], ['100', 1]
  ];

  /** Escada completa de `--color-base-*` a partir de duas pontas. */
  function escada(fundo, texto) {
    var a = paraRgb(fundo), b = paraRgb(texto);
    if (!a || !b) return {};
    var vars = {};
    for (var i = 0; i < DEGRAUS.length; i++) {
      vars['--color-base-' + DEGRAUS[i][0]] = misturar(a, b, DEGRAUS[i][1]);
    }
    return vars;
  }

  /**
   * Um modo de uma paleta. `fundo`/`texto` desenham a escada; `extra` corrige
   * os degraus que a paleta original define a mao (o Nord tem os seus proprios
   * cinzas azulados, e interpolar perderia o azul).
   */
  function modo(fundo, texto, acento, extra) {
    var vars = escada(fundo, texto);
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) vars[k] = extra[k];
    vars['--mono-rgb-100'] = ehEscuro(fundo) ? '255, 255, 255' : '0, 0, 0';
    vars['__acento'] = acento;
    vars['__escuro'] = ehEscuro(fundo);
    return vars;
  }

  // --------------------------------------------------------------- paletas

  var PALETAS = [
    {
      id: 'markpad',
      nome: 'MarkPad',
      descricao: 'A paleta de casa, herdada do Obsidian.',
      // Sem variaveis: a folha embutida ja e esta paleta. Escolher "MarkPad"
      // limpa tudo em vez de reescrever o que ja esta la.
      dark: null,
      light: null
    },
    {
      id: 'nord',
      nome: 'Nord',
      descricao: 'Azul polar, baixo contraste.',
      dark: modo('#2e3440', '#eceff4', '#88c0d0', {
        '--color-base-05': '#2f3643', '--color-base-10': '#323a47',
        '--color-base-20': '#353d4b', '--color-base-25': '#3b4252',
        '--color-base-30': '#434c5e', '--color-base-35': '#4c566a',
        '--color-base-40': '#5b667c', '--color-base-50': '#6b778d',
        '--color-base-60': '#8d97ab', '--color-base-70': '#d8dee9',
        '--color-red': '#bf616a', '--color-orange': '#d08770',
        '--color-yellow': '#ebcb8b', '--color-green': '#a3be8c',
        '--color-cyan': '#88c0d0', '--color-blue': '#81a1c1',
        '--color-purple': '#b48ead', '--color-pink': '#d3a0b8'
      }),
      light: modo('#eceff4', '#2e3440', '#5e81ac', {
        '--color-base-25': '#e5e9f0', '--color-base-30': '#dde3ec',
        '--color-base-35': '#d2dae6',
        '--color-red': '#bf616a', '--color-orange': '#d08770',
        '--color-yellow': '#b48a2f', '--color-green': '#6d8f52',
        '--color-cyan': '#4a8fa3', '--color-blue': '#5e81ac',
        '--color-purple': '#9a6f93', '--color-pink': '#b3728f'
      })
    },
    {
      id: 'dracula',
      nome: 'Dracula',
      descricao: 'Roxo e rosa sobre ardosia.',
      dark: modo('#282a36', '#f8f8f2', '#bd93f9', {
        '--color-base-25': '#343746', '--color-base-30': '#44475a',
        '--color-base-35': '#4f5368',
        '--color-red': '#ff5555', '--color-orange': '#ffb86c',
        '--color-yellow': '#f1fa8c', '--color-green': '#50fa7b',
        '--color-cyan': '#8be9fd', '--color-blue': '#6272a4',
        '--color-purple': '#bd93f9', '--color-pink': '#ff79c6'
      }),
      light: modo('#fffbf2', '#1f1f1f', '#7c3aed', {
        '--color-red': '#cb3a2a', '--color-orange': '#a34d14',
        '--color-yellow': '#846e15', '--color-green': '#14710a',
        '--color-cyan': '#036a96', '--color-blue': '#3c5ea8',
        '--color-purple': '#7c3aed', '--color-pink': '#a3144d'
      })
    },
    {
      id: 'solarized',
      nome: 'Solarized',
      descricao: 'O classico do Ethan Schoonover.',
      dark: modo('#002b36', '#93a1a1', '#268bd2', {
        '--color-base-25': '#073642', '--color-base-30': '#0c4553',
        '--color-base-35': '#125264', '--color-base-70': '#839496',
        '--color-base-100': '#a3b1b1',
        '--color-red': '#dc322f', '--color-orange': '#cb4b16',
        '--color-yellow': '#b58900', '--color-green': '#859900',
        '--color-cyan': '#2aa198', '--color-blue': '#268bd2',
        '--color-purple': '#6c71c4', '--color-pink': '#d33682'
      }),
      light: modo('#fdf6e3', '#586e75', '#268bd2', {
        '--color-base-25': '#f2ead3', '--color-base-30': '#eee8d5',
        '--color-base-35': '#e4ddc8', '--color-base-70': '#5f7278',
        '--color-base-100': '#4a5f66',
        '--color-red': '#dc322f', '--color-orange': '#cb4b16',
        '--color-yellow': '#b58900', '--color-green': '#859900',
        '--color-cyan': '#2aa198', '--color-blue': '#268bd2',
        '--color-purple': '#6c71c4', '--color-pink': '#d33682'
      })
    },
    {
      id: 'gruvbox',
      nome: 'Gruvbox',
      descricao: 'Terroso, quente, pouco brilho.',
      dark: modo('#282828', '#ebdbb2', '#83a598', {
        '--color-base-25': '#32302f', '--color-base-30': '#3c3836',
        '--color-base-35': '#504945',
        '--color-red': '#fb4934', '--color-orange': '#fe8019',
        '--color-yellow': '#fabd2f', '--color-green': '#b8bb26',
        '--color-cyan': '#8ec07c', '--color-blue': '#83a598',
        '--color-purple': '#d3869b', '--color-pink': '#e6819c'
      }),
      light: modo('#fbf1c7', '#3c3836', '#076678', {
        '--color-base-25': '#f2e5bc', '--color-base-30': '#ebdbb2',
        '--color-base-35': '#d5c4a1',
        '--color-red': '#9d0006', '--color-orange': '#af3a03',
        '--color-yellow': '#b57614', '--color-green': '#79740e',
        '--color-cyan': '#427b58', '--color-blue': '#076678',
        '--color-purple': '#8f3f71', '--color-pink': '#b5638c'
      })
    },
    {
      id: 'github',
      nome: 'GitHub',
      descricao: 'O cinza-azulado de quem le README o dia todo.',
      dark: modo('#0d1117', '#e6edf3', '#2f81f7', {
        '--color-base-25': '#161b22', '--color-base-30': '#30363d',
        '--color-base-35': '#3d444d',
        '--color-red': '#f85149', '--color-orange': '#db6d28',
        '--color-yellow': '#d29922', '--color-green': '#3fb950',
        '--color-cyan': '#39c5cf', '--color-blue': '#58a6ff',
        '--color-purple': '#bc8cff', '--color-pink': '#f778ba'
      }),
      light: modo('#ffffff', '#1f2328', '#0969da', {
        '--color-base-20': '#f6f8fa', '--color-base-25': '#eff2f5',
        '--color-base-30': '#d1d9e0', '--color-base-35': '#c3ccd6',
        '--color-red': '#cf222e', '--color-orange': '#bc4c00',
        '--color-yellow': '#9a6700', '--color-green': '#1a7f37',
        '--color-cyan': '#1b7c83', '--color-blue': '#0969da',
        '--color-purple': '#8250df', '--color-pink': '#bf3989'
      })
    },
    {
      id: 'rosepine',
      nome: 'Rose Pine',
      descricao: 'Malva e rosa empoeirado.',
      dark: modo('#191724', '#e0def4', '#c4a7e7', {
        '--color-base-25': '#1f1d2e', '--color-base-30': '#26233a',
        '--color-base-35': '#302c48',
        '--color-red': '#eb6f92', '--color-orange': '#f6c177',
        '--color-yellow': '#f6c177', '--color-green': '#31748f',
        '--color-cyan': '#9ccfd8', '--color-blue': '#31748f',
        '--color-purple': '#c4a7e7', '--color-pink': '#ebbcba'
      }),
      light: modo('#faf4ed', '#575279', '#907aa9', {
        '--color-base-25': '#f2e9e1', '--color-base-30': '#eee0d8',
        '--color-base-35': '#e4d5cd', '--color-base-70': '#6e6a8c',
        '--color-red': '#b4637a', '--color-orange': '#ea9d34',
        '--color-yellow': '#ea9d34', '--color-green': '#286983',
        '--color-cyan': '#56949f', '--color-blue': '#286983',
        '--color-purple': '#907aa9', '--color-pink': '#d7827e'
      })
    },
    {
      id: 'papel',
      nome: 'Papel',
      descricao: 'Sepia, para ler muito tempo seguido.',
      dark: modo('#1c1a17', '#e8dcc6', '#c49a6c', {
        '--color-base-25': '#24211d', '--color-base-30': '#2e2a24',
        '--color-base-35': '#3a352d',
        '--color-red': '#d97757', '--color-orange': '#cf9350',
        '--color-yellow': '#d9bb6c', '--color-green': '#8f9f6b',
        '--color-cyan': '#79a3a0', '--color-blue': '#7e93b8',
        '--color-purple': '#a98fb8', '--color-pink': '#c98fa0'
      }),
      light: modo('#f4ecd8', '#3b3228', '#8f6b3f', {
        '--color-base-25': '#ebe2cc', '--color-base-30': '#e2d8bf',
        '--color-base-35': '#d6cab0',
        '--color-red': '#a33a22', '--color-orange': '#9c6212',
        '--color-yellow': '#8a6d12', '--color-green': '#5a6b2b',
        '--color-cyan': '#37706c', '--color-blue': '#3f5c85',
        '--color-purple': '#6f4a87', '--color-pink': '#97406a'
      })
    },
    {
      id: 'contraste',
      nome: 'Alto contraste',
      descricao: 'Preto no branco, branco no preto — sem meio-tom.',
      dark: modo('#000000', '#ffffff', '#ffd400', {
        '--color-base-20': '#0a0a0a', '--color-base-25': '#141414',
        '--color-base-30': '#4d4d4d', '--color-base-35': '#666666',
        '--color-base-40': '#808080', '--color-base-50': '#999999',
        '--color-base-60': '#cccccc', '--color-base-70': '#e6e6e6',
        '--background-modifier-hover': 'rgba(255, 255, 255, 0.28)',
        '--color-red': '#ff6b6b', '--color-orange': '#ffa94d',
        '--color-yellow': '#ffd400', '--color-green': '#51cf66',
        '--color-cyan': '#66d9e8', '--color-blue': '#74c0fc',
        '--color-purple': '#d0bfff', '--color-pink': '#faa2c1'
      }),
      light: modo('#ffffff', '#000000', '#0033cc', {
        '--color-base-20': '#f2f2f2', '--color-base-25': '#e6e6e6',
        '--color-base-30': '#999999', '--color-base-35': '#808080',
        '--color-base-40': '#666666', '--color-base-50': '#4d4d4d',
        '--color-base-60': '#333333', '--color-base-70': '#1a1a1a',
        '--background-modifier-hover': 'rgba(0, 0, 0, 0.16)',
        '--color-red': '#c92a2a', '--color-orange': '#a14900',
        '--color-yellow': '#8a6d00', '--color-green': '#1f7a33',
        '--color-cyan': '#0b6b73', '--color-blue': '#0033cc',
        '--color-purple': '#6b2fbf', '--color-pink': '#a61e69'
      })
    }
  ];

  function paleta(id) {
    for (var i = 0; i < PALETAS.length; i++) if (PALETAS[i].id === id) return PALETAS[i];
    return PALETAS[0];
  }

  // -------------------------------------------------- tema do VS Code

  /**
   * O que um tema do VS Code tem que o MarkPad sabe ler.
   *
   * Um tema de la e uma lista de cores de editor (`colors`) mais regras de
   * realce por escopo (`tokenColors`). O MarkPad nao tokeniza como o VS Code —
   * o modo leitura renderiza HTML, nao texto colorido — entao o que importa
   * aqui sao as poucas cores de superficie: fundo do editor, texto, fundo da
   * barra lateral, cor de foco. O resto da escada sai da interpolacao, e as
   * cores nomeadas vem dos diagnosticos (erro = vermelho, aviso = laranja),
   * que praticamente todo tema declara.
   */
  var MAPA_VSCODE = [
    ['--color-base-00', ['editor.background']],
    ['--color-base-20', ['sideBar.background', 'activityBar.background']],
    ['--color-base-25', ['input.background', 'dropdown.background']],
    ['--color-base-30', ['editorGroup.border', 'panel.border', 'contrastBorder']],
    ['--color-base-100', ['editor.foreground', 'foreground']],
    ['--color-red', ['errorForeground', 'editorError.foreground']],
    ['--color-orange', ['editorWarning.foreground']],
    ['--color-blue', ['textLink.foreground', 'editorInfo.foreground']],
    ['--text-highlight-bg', ['editor.findMatchHighlightBackground']],
    ['--editor-active-line', ['editor.lineHighlightBackground']]
  ];

  var ACENTO_VSCODE = ['focusBorder', 'textLink.foreground', 'button.background',
    'editorCursor.foreground', 'progressBar.background'];

  /**
   * Converte o JSON de um tema do VS Code no formato de paleta do MarkPad.
   * Devolve `{ nome, escuro, vars }` ou lanca com o motivo, para o chamador
   * poder dizer por que o arquivo nao serviu.
   */
  function doVSCode(texto, nomeArquivo) {
    var json;
    try {
      // Tema do VS Code aceita comentario e virgula sobrando (jsonc); o
      // JSON.parse nao. Tirar os dois e o preco de ler os temas de verdade.
      json = JSON.parse(semJsonc(texto));
    } catch (e) {
      throw new Error('o arquivo nao e um JSON valido');
    }
    if (!json || typeof json !== 'object') throw new Error('o arquivo nao e um tema');

    var cores = json.colors;
    if (!cores || typeof cores !== 'object') throw new Error('o tema nao tem um bloco "colors"');

    function pegar(chaves) {
      for (var i = 0; i < chaves.length; i++) {
        var v = cores[chaves[i]];
        if (corSegura(v)) return String(v).trim();
      }
      return null;
    }

    var fundo = pegar(['editor.background']);
    var texto100 = pegar(['editor.foreground', 'foreground']);
    if (!fundo || !texto100) throw new Error('o tema nao declara fundo e texto do editor');

    // `type` e a palavra do proprio tema; quando falta, a luminancia do fundo
    // decide — e ela nunca mente sobre um fundo #1e1e1e.
    var escuro = json.type === 'dark' ? true : json.type === 'light' ? false : ehEscuro(fundo);

    var vars = escada(fundo, texto100);
    for (var i = 0; i < MAPA_VSCODE.length; i++) {
      var v = pegar(MAPA_VSCODE[i][1]);
      if (v) vars[MAPA_VSCODE[i][0]] = v;
    }
    vars['--mono-rgb-100'] = escuro ? '255, 255, 255' : '0, 0, 0';

    var acento = pegar(ACENTO_VSCODE) || (escuro ? '#8a5cf6' : '#6c3ce9');

    return {
      nome: String(json.name || nomeArquivo || 'Tema importado').slice(0, 60),
      escuro: escuro,
      vars: limpar(vars),
      acento: corSegura(acento) ? acento : null
    };
  }

  /** Tira comentarios e virgula sobrando — o jsonc que o VS Code aceita. */
  function semJsonc(texto) {
    var fora = '';
    var i = 0, n = texto.length;
    while (i < n) {
      var c = texto[i];
      if (c === '"') {
        var j = i + 1;
        while (j < n) {
          if (texto[j] === '\\') { j += 2; continue; }
          if (texto[j] === '"') break;
          j++;
        }
        fora += texto.slice(i, j + 1);
        i = j + 1;
      } else if (c === '/' && texto[i + 1] === '/') {
        while (i < n && texto[i] !== '\n') i++;
      } else if (c === '/' && texto[i + 1] === '*') {
        i += 2;
        while (i < n && !(texto[i] === '*' && texto[i + 1] === '/')) i++;
        i += 2;
      } else {
        fora += c;
        i++;
      }
    }
    return fora.replace(/,(\s*[}\]])/g, '$1');
  }

  /** Descarta tudo que nao for literal de cor — o chamador cai no padrao. */
  function limpar(vars) {
    var seguro = {};
    for (var k in vars) {
      if (!vars.hasOwnProperty(k) || k.indexOf('__') === 0) continue;
      if (k === '--mono-rgb-100') {
        if (/^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(String(vars[k]))) seguro[k] = vars[k];
        continue;
      }
      if (corSegura(vars[k])) seguro[k] = String(vars[k]).trim();
    }
    return seguro;
  }

  // ------------------------------------------------------------- aplicacao

  // O que foi escrito da ultima vez, para apagar exatamente isso ao trocar de
  // paleta. Sem essa lista, sobraria no <body> o degrau que a paleta nova nao
  // declara e a anterior declarava — dois temas misturados.
  var escritas = [];

  /**
   * Escreve a paleta no <body>.
   *
   * `opcoes`: { paletaId, escuro, acento, importado }
   *   - `importado` (o tema do VS Code) manda na paleta quando existe e quando
   *     o modo atual bate com o dele: um tema escuro nao tem o que dizer sobre
   *     a janela clara, e forcar deixaria texto branco em fundo branco.
   */
  function aplicar(opcoes) {
    var corpo = document.body;
    for (var i = 0; i < escritas.length; i++) corpo.style.removeProperty(escritas[i]);
    escritas = [];

    var vars = null;
    var acentoPaleta = null;

    var imp = opcoes.importado;
    if (imp && imp.vars && imp.escuro === !!opcoes.escuro) {
      // Filtrado de novo, e nao so no import: o tema fica guardado nas
      // configuracoes, que sao um arquivo em disco como qualquer outro. O que
      // voltou de la nao e mais o que foi validado na hora de importar.
      vars = limpar(imp.vars);
      acentoPaleta = corSegura(imp.acento) ? imp.acento : null;
    } else {
      var p = paleta(opcoes.paletaId);
      var m = opcoes.escuro ? p.dark : p.light;
      if (m) {
        vars = limpar(m);
        acentoPaleta = m['__acento'];
      }
    }

    if (vars) {
      for (var k in vars) {
        if (!vars.hasOwnProperty(k)) continue;
        corpo.style.setProperty(k, vars[k]);
        escritas.push(k);
      }
    }

    // O acento escolhido a mao vale sobre o da paleta; sem nenhum dos dois, a
    // folha embutida (roxo) fica.
    var acento = corSegura(opcoes.acento) ? opcoes.acento : acentoPaleta;
    if (acento) {
      var hsl = paraHsl(acento);
      if (hsl) {
        var trio = [['--accent-h', String(hsl.h)], ['--accent-s', hsl.s + '%'], ['--accent-l', hsl.l + '%']];
        for (var j = 0; j < trio.length; j++) {
          if (!COMPONENTE.test(trio[j][1])) continue;
          corpo.style.setProperty(trio[j][0], trio[j][1]);
          escritas.push(trio[j][0]);
        }
      }
    }
  }

  /** A cor que representa a paleta num seletor (para amostras na tela). */
  function amostra(id, escuro) {
    var p = paleta(id);
    var m = escuro ? p.dark : p.light;
    if (!m) return { fundo: escuro ? '#1e1e1e' : '#ffffff', acento: '#8a5cf6' };
    return { fundo: m['--color-base-00'], acento: m['__acento'] };
  }

  window.MarkPadThemes = {
    PALETAS: PALETAS,
    paleta: paleta,
    aplicar: aplicar,
    amostra: amostra,
    corSegura: corSegura,
    doVSCode: doVSCode,
    paraHsl: paraHsl,
    ehEscuro: ehEscuro
  };
})();
