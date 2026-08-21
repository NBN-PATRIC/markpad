/*
 * icons.js — registro de icones (traco 24x24, estilo Lucide).
 *
 * Os SVG sao criados por codigo nosso via createElementNS, nunca por innerHTML
 * vindo de arquivo. Por isso a peneira do markdown pode proibir <svg> inteiro.
 */
(function (global) {
  'use strict';

  var PATHS = {
    // interface
    'panel-left': ['M3 3h18v18H3z', 'M9 3v18'],
    'plus': ['M12 5v14', 'M5 12h14'],
    'x': ['M18 6 6 18', 'M6 6l12 12'],
    'search': ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4.2-4.2'],
    'folder': ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    'folder-open': ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z', 'M3 10h18l-2 8H5z'],
    'file-text': ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
    'sort': ['M4 6h10', 'M4 12h7', 'M4 18h4', 'M17 8v11', 'M14 16l3 3 3-3'],
    'chevrons-up': ['M7 11l5-5 5 5', 'M7 18l5-5 5 5'],
    'filter': ['M3 5h18l-7 8v6l-4 2v-8z'],
    'list': ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    'hash': ['M4 9h16', 'M4 15h16', 'M10 3L8 21', 'M16 3l-2 18'],
    'clock': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    'refresh': ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
    'trash': ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
    'more': ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
    'command': ['M6 3a3 3 0 0 1 3 3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6z'],
    'pencil': ['M12 20h9', 'M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
    'code': ['M9 18l-6-6 6-6', 'M15 6l6 6-6 6'],
    'columns': ['M4 4h16v16H4z', 'M12 4v16'],
    'book-open': ['M12 6c-2-1.5-4.5-2-8-2v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2z', 'M12 6v14'],
    'chevron-right': ['M9 6l6 6-6 6'],
    'chevron-down': ['M6 9l6 6 6-6'],
    'chevron-up': ['M18 15l-6-6-6 6'],
    'lock': ['M6 11h12v9H6z', 'M9 11V7a3 3 0 0 1 6 0v4'],
    'unlock': ['M6 11h12v9H6z', 'M9 11V7a3 3 0 0 1 5.8-1.6'],
    'save': ['M5 3h11l3 3v15H5z', 'M8 3v6h7V3', 'M8 21v-7h8v7'],
    'printer': ['M7 9V3h10v6', 'M5 9h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2z'],
    'external': ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    'copy': ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    'sun': ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    'moon': ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'],
    'wrap': ['M3 6h18', 'M3 12h13a4 4 0 0 1 0 8h-3', 'M16 16l-3 4 3 4'],
    'settings': ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6 1.6 1.6 0 0 0 8 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z'],
    'check': ['M20 6L9 17l-5-5'],
    'link': ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
    'eye': ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    'reveal': ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 13l2 2 4-4'],

    // formatação
    'bold': ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'],
    'italic': ['M14 5h5', 'M5 19h5', 'M14 5l-4 14'],
    'strike': ['M4 12h16', 'M7 7a4 3 0 0 1 8-1', 'M9 17a4 3 0 0 0 8-1'],
    'highlight': ['M4 20h16', 'M6 16l8-9 4 4-8 9H6z'],
    'heading': ['M6 5v14', 'M18 5v14', 'M6 12h12'],
    'text': ['M5 6h14', 'M12 6v13', 'M9 19h6'],
    'table': ['M3 5h18v14H3z', 'M3 10h18', 'M9 5v14'],
    'minus': ['M5 12h14'],

    // callouts
    'note': ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
    'abstract': ['M9 3h6v3H9z', 'M6 6h12v15H6z', 'M9 11h6', 'M9 15h4'],
    'info': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v6', 'M12 8h.01'],
    'todo': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12l3 3 5-6'],
    'tip': ['M12 2c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5-1-8z'],
    'success': ['M20 6L9 17l-5-5'],
    'question': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7', 'M12 17h.01'],
    'warning': ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
    'failure': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M15 9l-6 6', 'M9 9l6 6'],
    'danger': ['M13 2 3 14h9l-1 8 10-12h-9z'],
    'bug': ['M8 6a4 4 0 0 1 8 0', 'M6 10h12v5a6 6 0 0 1-12 0z', 'M3 13h3', 'M18 13h3', 'M4 7l2 2', 'M20 7l-2 2', 'M4 19l2-2', 'M20 19l-2-2'],
    'example': ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    'quote': ['M7 7h4v6a4 4 0 0 1-4 4', 'M15 7h4v6a4 4 0 0 1-4 4']
  };

  function build(name, size) {
    var paths = PATHS[name];
    if (!paths) return null;

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 16);
    svg.setAttribute('height', size || 16);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    paths.forEach(function (d) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });

    return svg;
  }

  /** Preenche todo [data-icon] ainda vazio dentro de root. */
  function apply(root, size) {
    var nodes = (root || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.firstElementChild && el.firstElementChild.tagName.toLowerCase() === 'svg') continue;
      var svg = build(el.getAttribute('data-icon'), size || el.getAttribute('data-icon-size'));
      if (!svg) continue;
      el.textContent = '';
      el.appendChild(svg);
    }
  }

  global.MarkPadIcons = { build: build, apply: apply, has: function (n) { return !!PATHS[n]; } };
})(window);
