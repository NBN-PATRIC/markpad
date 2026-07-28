/*
 * highlight.js — realce de sintaxe do MarkPad. Sem dependencias.
 *
 * Dois usos:
 *   highlight(code, lang)          -> blocos ``` no modo leitura
 *   highlightMarkdownSource(text)  -> o proprio markdown no editor
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function span(cls, text) {
    return '<span class="tok-' + cls + '">' + esc(text) + '</span>';
  }

  function words(str) {
    var set = Object.create(null);
    str.split(/\s+/).forEach(function (w) { if (w) set[w] = true; });
    return set;
  }

  // -------------------------------------------------------------- linguagens

  var COMMON_JS_KW = 'break case catch class const continue debugger default delete do else export ' +
    'extends finally for function if import in instanceof let new return super switch this throw try ' +
    'typeof var void while with yield async await of static get set';

  var LANGS = {
    javascript: {
      aliases: ['js', 'jsx', 'mjs', 'cjs', 'node', 'javascript'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'],
      keywords: words(COMMON_JS_KW + ' true false null undefined NaN Infinity'),
      builtins: words('console window document Math JSON Object Array String Number Boolean Promise ' +
        'Map Set WeakMap WeakSet Symbol RegExp Date Error require module exports process globalThis ' +
        'setTimeout setInterval clearTimeout clearInterval fetch parseInt parseFloat isNaN')
    },
    typescript: {
      aliases: ['ts', 'tsx', 'typescript'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'],
      keywords: words(COMMON_JS_KW + ' interface type enum namespace declare implements private public ' +
        'protected readonly abstract as satisfies keyof infer is true false null undefined'),
      builtins: words('string number boolean any unknown never void object symbol bigint Array Promise ' +
        'Record Partial Pick Omit Readonly console Math JSON Object')
    },
    python: {
      aliases: ['py', 'python', 'python3'],
      line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], quotes: ['"', "'"],
      keywords: words('and as assert async await break class continue def del elif else except finally ' +
        'for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
        'True False None match case'),
      builtins: words('print len range str int float bool list dict set tuple open enumerate zip map ' +
        'filter sum min max abs sorted reversed type isinstance super self cls format input round ' +
        'Exception ValueError TypeError KeyError IndexError')
    },
    csharp: {
      aliases: ['cs', 'csharp', 'c#', 'dotnet'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"],
      keywords: words('abstract as base bool break byte case catch char checked class const continue ' +
        'decimal default delegate do double else enum event explicit extern false finally fixed float ' +
        'for foreach goto if implicit in int interface internal is lock long namespace new null object ' +
        'operator out override params private protected public readonly ref return sbyte sealed short ' +
        'sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked ' +
        'unsafe ushort using var virtual void volatile while async await record init nameof when where'),
      builtins: words('Console String Int32 List Dictionary Task File Directory Path Math Exception ' +
        'IEnumerable IList Func Action Nullable Guid DateTime StringBuilder')
    },
    java: {
      aliases: ['java'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"],
      keywords: words('abstract assert boolean break byte case catch char class const continue default ' +
        'do double else enum extends final finally float for goto if implements import instanceof int ' +
        'interface long native new package private protected public return short static strictfp super ' +
        'switch synchronized this throw throws transient try void volatile while var record true false null'),
      builtins: words('System String Integer Double Boolean List Map Set ArrayList HashMap Object ' +
        'Exception Math Thread Optional Stream')
    },
    c: {
      aliases: ['c', 'cpp', 'c++', 'h', 'hpp', 'cc'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"],
      keywords: words('auto break case char const continue default do double else enum extern float for ' +
        'goto if inline int long register restrict return short signed sizeof static struct switch ' +
        'typedef union unsigned void volatile while class public private protected virtual template ' +
        'namespace using new delete this true false nullptr constexpr override final friend operator ' +
        'explicit try catch throw'),
      builtins: words('printf scanf malloc free memcpy memset strlen strcpy strcmp fopen fclose fprintf ' +
        'std cout cin endl vector string map size_t uint8_t uint16_t uint32_t uint64_t int8_t int32_t NULL'),
      preprocessor: true
    },
    go: {
      aliases: ['go', 'golang'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'],
      keywords: words('break case chan const continue default defer else fallthrough for func go goto ' +
        'if import interface map package range return select struct switch type var true false nil iota'),
      builtins: words('append cap close complex copy delete imag len make new panic print println real ' +
        'recover string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 ' +
        'byte rune bool error fmt os io')
    },
    rust: {
      aliases: ['rs', 'rust'],
      line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"],
      keywords: words('as async await break const continue crate dyn else enum extern false fn for if ' +
        'impl in let loop match mod move mut pub ref return self Self static struct super trait true ' +
        'type unsafe use where while'),
      builtins: words('Vec String Option Some None Result Ok Err Box Rc Arc HashMap HashSet println ' +
        'format print panic i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 bool str char')
    },
    sql: {
      aliases: ['sql', 'mysql', 'psql', 'postgres', 'sqlite'],
      line: ['--'], block: [['/*', '*/']], quotes: ['"', "'"], caseInsensitive: true,
      keywords: words('select from where insert into values update set delete create table alter drop ' +
        'index view join inner left right full outer on group by order having limit offset union all ' +
        'distinct as and or not null is in between like exists case when then else end primary key ' +
        'foreign references default constraint unique check cascade begin commit rollback transaction ' +
        'with returning if replace database schema grant revoke'),
      builtins: words('count sum avg min max coalesce cast now current_timestamp concat substring ' +
        'length upper lower trim round int varchar text boolean timestamp date serial numeric')
    },
    shell: {
      aliases: ['sh', 'bash', 'zsh', 'shell', 'console', 'fish'],
      line: ['#'], block: [], quotes: ['"', "'"],
      keywords: words('if then else elif fi for while until do done case esac function return in break ' +
        'continue local export source alias unset declare readonly shift trap exit set'),
      builtins: words('echo cd ls cat grep sed awk find cp mv rm mkdir rmdir touch chmod chown ln ps ' +
        'kill top df du tar curl wget ssh scp git npm pnpm node python pip docker sudo apt dnf systemctl ' +
        'printf read test which pwd head tail sort uniq wc xargs tee jq make'),
      variables: /\$\{?[A-Za-z_][\w]*\}?|\$[0-9@*#?$!-]/
    },
    powershell: {
      aliases: ['powershell', 'ps1', 'pwsh', 'posh'],
      line: ['#'], block: [['<#', '#>']], quotes: ['"', "'"], caseInsensitive: true,
      keywords: words('if else elseif switch foreach for while do until break continue return function ' +
        'filter param begin process end try catch finally throw class enum in trap exit'),
      builtins: words('Get-ChildItem Get-Content Set-Content Write-Output Write-Host Select-Object ' +
        'Where-Object ForEach-Object New-Item Remove-Item Copy-Item Move-Item Test-Path Get-Item ' +
        'Invoke-RestMethod Invoke-WebRequest Start-Process Get-Process Stop-Process Measure-Object ' +
        'Sort-Object Out-File Join-Path Split-Path Get-Command Import-Module ConvertTo-Json ConvertFrom-Json'),
      variables: /\$[A-Za-z_][\w:]*|\$\{[^}]+\}/
    },
    php: {
      aliases: ['php'],
      line: ['//', '#'], block: [['/*', '*/']], quotes: ['"', "'"],
      keywords: words('abstract and array as break callable case catch class clone const continue ' +
        'declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile ' +
        'enum extends final finally fn for foreach function global goto if implements include include_once ' +
        'instanceof insteadof interface isset list match namespace new or print private protected public ' +
        'readonly require require_once return static switch throw trait try unset use var while xor yield ' +
        'true false null'),
      builtins: words('strlen count array_map array_filter implode explode json_encode json_decode ' +
        'var_dump print_r sprintf preg_match preg_replace file_get_contents in_array str_replace trim'),
      variables: /\$[A-Za-z_]\w*/
    },
    ruby: {
      aliases: ['rb', 'ruby'],
      line: ['#'], block: [['=begin', '=end']], quotes: ['"', "'"],
      keywords: words('alias and begin break case class def defined do else elsif end ensure false for ' +
        'if in module next nil not or redo rescue retry return self super then true undef unless until ' +
        'when while yield attr_accessor attr_reader attr_writer require require_relative'),
      builtins: words('puts print p gets each map select reject reduce inject new to_s to_i to_a length ' +
        'size push pop nil? empty? include? String Integer Array Hash Symbol')
    },
    yaml: { aliases: ['yaml', 'yml'], custom: 'yaml' },
    json: { aliases: ['json', 'jsonc', 'json5'], custom: 'json' },
    html: { aliases: ['html', 'xml', 'xhtml', 'svg', 'vue', 'htm'], custom: 'html' },
    css: { aliases: ['css', 'scss', 'sass', 'less'], custom: 'css' },
    ini: { aliases: ['ini', 'toml', 'cfg', 'conf', 'properties', 'editorconfig'], custom: 'ini' },
    diff: { aliases: ['diff', 'patch'], custom: 'diff' },
    markdown: { aliases: ['md', 'markdown', 'mdx'], custom: 'markdown' }
  };

  var ALIAS_MAP = Object.create(null);
  Object.keys(LANGS).forEach(function (name) {
    ALIAS_MAP[name] = LANGS[name];
    (LANGS[name].aliases || []).forEach(function (a) { ALIAS_MAP[a] = LANGS[name]; });
  });

  // ---------------------------------------------------------- scanner comum

  var RE_NUMBER = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[uUlLfFdDnm]*/;
  var RE_WORD = /^[A-Za-z_$][\w$]*/;
  var RE_OPERATOR = /^(?:=>|->|<=|>=|===|!==|==|!=|&&|\|\||\?\?|\+\+|--|<<|>>|\*\*|[+\-*/%=<>!&|^~?:])/;

  function generic(code, lang) {
    var out = '';
    var i = 0;
    var n = code.length;
    var lineComments = lang.line || [];
    var blocks = lang.block || [];
    var quotes = lang.quotes || [];

    function startsWith(str) { return code.startsWith(str, i); }

    while (i < n) {
      var ch = code[i];

      // quebra de linha e espaco: passa direto
      if (ch === '\n' || ch === ' ' || ch === '\t' || ch === '\r') { out += ch; i++; continue; }

      // diretiva de pre-processador (#include, #define)
      if (lang.preprocessor && ch === '#' && (i === 0 || code[i - 1] === '\n')) {
        var pEnd = code.indexOf('\n', i);
        if (pEnd === -1) pEnd = n;
        out += span('meta', code.slice(i, pEnd));
        i = pEnd;
        continue;
      }

      // comentario de bloco
      var handledBlock = false;
      for (var b = 0; b < blocks.length; b++) {
        if (!startsWith(blocks[b][0])) continue;
        var close = code.indexOf(blocks[b][1], i + blocks[b][0].length);
        var stop = close === -1 ? n : close + blocks[b][1].length;
        out += span('com', code.slice(i, stop));
        i = stop;
        handledBlock = true;
        break;
      }
      if (handledBlock) continue;

      // comentario de linha
      var handledLine = false;
      for (var l = 0; l < lineComments.length; l++) {
        if (!startsWith(lineComments[l])) continue;
        var lEnd = code.indexOf('\n', i);
        if (lEnd === -1) lEnd = n;
        out += span('com', code.slice(i, lEnd));
        i = lEnd;
        handledLine = true;
        break;
      }
      if (handledLine) continue;

      // variavel ($var, $env:X)
      if (lang.variables) {
        var vm = lang.variables.exec(code.slice(i));
        if (vm && vm.index === 0) { out += span('var', vm[0]); i += vm[0].length; continue; }
      }

      // string
      if (quotes.indexOf(ch) !== -1) {
        var j = i + 1;
        while (j < n) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === ch) { j++; break; }
          if (code[j] === '\n' && ch !== '`') { break; }
          j++;
        }
        out += span('str', code.slice(i, j));
        i = j;
        continue;
      }

      // numero
      var num = RE_NUMBER.exec(code.slice(i));
      if (num && !/[\w$]/.test(code[i - 1] || '')) {
        out += span('num', num[0]);
        i += num[0].length;
        continue;
      }

      // palavra
      var word = RE_WORD.exec(code.slice(i));
      if (word) {
        var w = word[0];
        var lookup = lang.caseInsensitive ? w.toLowerCase() : w;
        var after = code.slice(i + w.length);
        var isCall = /^\s*\(/.test(after);

        if (lang.keywords && lang.keywords[lookup]) out += span('kw', w);
        else if (lang.builtins && lang.builtins[lookup]) out += span('bi', w);
        else if (isCall) out += span('fn', w);
        else if (/^[A-Z]/.test(w)) out += span('type', w);
        else out += esc(w);

        i += w.length;
        continue;
      }

      // operador
      var op = RE_OPERATOR.exec(code.slice(i));
      if (op) { out += span('op', op[0]); i += op[0].length; continue; }

      if ('{}[]()'.indexOf(ch) !== -1) { out += span('punc', ch); i++; continue; }

      out += esc(ch);
      i++;
    }

    return out;
  }

  // ------------------------------------------------------ tokenizers proprios

  var CUSTOM = {
    json: function (code) {
      return code.replace(
        /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
        function (all, str, colon, lit, num, punc) {
          if (str) return colon ? span('key', str) + span('punc', colon) : span('str', str);
          if (lit) return span('kw', lit);
          if (num) return span('num', num);
          if (punc) return span('punc', punc);
          return esc(all);
        }
      );
    },

    yaml: function (code) {
      return code.split('\n').map(function (line) {
        var comment = '';
        var body = line;
        var hash = body.search(/(^|\s)#/);
        if (hash !== -1 && !/^\s*["']/.test(body)) {
          comment = span('com', body.slice(hash));
          body = body.slice(0, hash);
        }

        var doc = /^(---|\.\.\.)\s*$/.exec(body);
        if (doc) return span('meta', body) + comment;

        var kv = /^(\s*(?:-\s+)?)([A-Za-z0-9_.$-]+)(\s*:)(\s*)(.*)$/.exec(body);
        if (kv) {
          return esc(kv[1]) + span('key', kv[2]) + span('punc', kv[3]) + kv[4] +
            highlightYamlValue(kv[5]) + comment;
        }

        var item = /^(\s*)(-)(\s+)(.*)$/.exec(body);
        if (item) return item[1] + span('punc', '-') + item[3] + highlightYamlValue(item[4]) + comment;

        return esc(body) + comment;
      }).join('\n');

      function highlightYamlValue(v) {
        if (!v) return '';
        if (/^["'].*["']$/.test(v)) return span('str', v);
        if (/^(true|false|null|yes|no|on|off|~)$/i.test(v.trim())) return span('kw', v);
        if (/^-?\d+(\.\d+)?$/.test(v.trim())) return span('num', v);
        if (/^[&*]\w+/.test(v.trim())) return span('meta', v);
        return esc(v);
      }
    },

    ini: function (code) {
      return code.split('\n').map(function (line) {
        if (/^\s*[;#]/.test(line)) return span('com', line);
        var section = /^(\s*)(\[[^\]]*\])(\s*)$/.exec(line);
        if (section) return section[1] + span('sel', section[2]) + section[3];
        var kv = /^(\s*)([^=:]+?)(\s*[=:]\s*)(.*)$/.exec(line);
        if (kv) {
          var value = /^["'].*["']$/.test(kv[4]) ? span('str', kv[4])
            : /^-?\d+(\.\d+)?$/.test(kv[4].trim()) ? span('num', kv[4])
              : /^(true|false)$/i.test(kv[4].trim()) ? span('kw', kv[4])
                : esc(kv[4]);
          return kv[1] + span('key', kv[2]) + span('op', kv[3]) + value;
        }
        return esc(line);
      }).join('\n');
    },

    diff: function (code) {
      return code.split('\n').map(function (line) {
        if (/^(\+\+\+|---)/.test(line)) return span('meta', line);
        if (/^@@/.test(line)) return span('bi', line);
        if (/^\+/.test(line)) return span('add', line);
        if (/^-/.test(line)) return span('del', line);
        if (/^(diff|index|new file|deleted file|similarity|rename)/.test(line)) return span('meta', line);
        return esc(line);
      }).join('\n');
    },

    html: function (code) {
      var out = '';
      var i = 0;
      while (i < code.length) {
        if (code.startsWith('<!--', i)) {
          var ce = code.indexOf('-->', i);
          ce = ce === -1 ? code.length : ce + 3;
          out += span('com', code.slice(i, ce));
          i = ce;
          continue;
        }
        if (code[i] === '<') {
          var te = code.indexOf('>', i);
          if (te === -1) { out += esc(code.slice(i)); break; }
          var tag = code.slice(i, te + 1);
          out += tag.replace(
            /^(<\/?)([\w:-]*)|([\w:-]+)(=)("(?:[^"]*)"|'(?:[^']*)'|[^\s>]*)|(\/?>)$/g,
            function (all, open, name, attr, eq, val, close) {
              if (open !== undefined) return span('punc', open) + span('tag', name || '');
              if (attr) return span('attr', attr) + span('op', eq) + span('str', val);
              if (close) return span('punc', close);
              return esc(all);
            }
          );
          i = te + 1;
          continue;
        }
        var next = code.indexOf('<', i);
        if (next === -1) { out += esc(code.slice(i)); break; }
        out += esc(code.slice(i, next));
        i = next;
      }
      return out;
    },

    css: function (code) {
      return code.replace(
        /(\/\*[\s\S]*?\*\/)|(@[\w-]+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([\w-]+)(\s*:)|(-?\d*\.?\d+)(px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ch|ex|vmin|vmax)?|(#[0-9a-fA-F]{3,8})\b|([{}();,])/g,
        function (all, com, at, str, prop, colon, num, unit, hex, punc) {
          if (com) return span('com', com);
          if (at) return span('kw', at);
          if (str) return span('str', str);
          if (prop) return span('prop', prop) + span('punc', colon);
          if (hex) return span('num', hex);
          if (num) return span('num', num + (unit || ''));
          if (punc) return span('punc', punc);
          return esc(all);
        }
      );
    },

    markdown: function (code) {
      return highlightMarkdownSource(code);
    }
  };

  // ------------------------------------------- markdown como codigo-fonte

  function highlightMarkdownSource(text) {
    var lines = String(text).split('\n');
    var inFence = false;
    var fenceMarker = '';
    var inFrontmatter = false;

    return lines.map(function (line, index) {
      // frontmatter YAML no topo
      if (index === 0 && /^---\s*$/.test(line)) { inFrontmatter = true; return span('meta', line); }
      if (inFrontmatter) {
        if (/^(---|\.\.\.)\s*$/.test(line)) { inFrontmatter = false; return span('meta', line); }
        return CUSTOM.yaml(line);
      }

      // blocos de codigo
      var fence = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence[2][0];
          return span('meta', fence[1] + fence[2]) + span('bi', fence[3]);
        }
        if (fence[2][0] === fenceMarker) { inFence = false; return span('meta', line); }
      }
      if (inFence) return span('code-body', line);

      // titulo
      var h = /^(\s{0,3})(#{1,6})(\s+)(.*)$/.exec(line);
      if (h) return h[1] + span('md-hash', h[2]) + h[3] + span('md-h' + h[2].length, h[4]);

      // linha horizontal
      if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) return span('meta', line);

      // citacao
      var q = /^(\s{0,3}>+\s?)(.*)$/.exec(line);
      if (q) {
        var callout = /^(\[!\w+\][+-]?)(.*)$/.exec(q[2]);
        if (callout) return span('md-quote', q[1]) + span('kw', callout[1]) + span('md-quote', inlineMd(callout[2]));
        return span('md-quote', q[1]) + span('md-quote', inlineMd(q[2]));
      }

      // tabela
      if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(line)) {
        return line.replace(/\|/g, span('punc', '|'));
      }

      // lista
      var li = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX~/-]\]\s+)?(.*)$/.exec(line);
      if (li) {
        return li[1] + span('md-bullet', li[2]) + li[3] +
          (li[4] ? span('kw', li[4]) : '') + inlineMd(li[5]);
      }

      return inlineMd(line);
    }).join('\n');
  }

  /** Realce inline dentro de uma linha de markdown. */
  function inlineMd(line) {
    var pieces = [];
    var re = /(`+[^`]*?`+)|(!?\[\[[^\]]*\]\])|(!?\[[^\]]*\]\([^)]*\))|(\*\*\*[^*]+\*\*\*|___[^_]+___)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|(?:^|\s)_[^_\n]+_)|(~~[^~]+~~)|(==[^=]+==)|(\$[^$\n]+\$)|(https?:\/\/[^\s<>"')\]]+)|((?:^|\s)#[A-Za-z][\w/-]*)/g;
    var last = 0;
    var m;

    while ((m = re.exec(line)) !== null) {
      if (m.index > last) pieces.push(esc(line.slice(last, m.index)));

      if (m[1]) pieces.push(span('md-code', m[1]));
      else if (m[2]) pieces.push(span('md-link', m[2]));
      else if (m[3]) pieces.push(span('md-link', m[3]));
      else if (m[4]) pieces.push(span('md-bolditalic', m[4]));
      else if (m[5]) pieces.push(span('md-bold', m[5]));
      else if (m[6]) pieces.push(span('md-italic', m[6]));
      else if (m[7]) pieces.push(span('md-strike', m[7]));
      else if (m[8]) pieces.push(span('md-mark', m[8]));
      else if (m[9]) pieces.push(span('math', m[9]));
      else if (m[10]) pieces.push(span('md-url', m[10]));
      else if (m[11]) pieces.push(span('md-tag', m[11]));
      else pieces.push(esc(m[0]));

      last = m.index + m[0].length;
    }

    if (last < line.length) pieces.push(esc(line.slice(last)));
    return pieces.join('');
  }

  // ----------------------------------------------------------------- API

  function highlight(code, lang) {
    var def = ALIAS_MAP[String(lang || '').toLowerCase()];
    if (!def) return esc(code);
    if (def.custom) return CUSTOM[def.custom](code);
    return generic(code, def);
  }

  global.MarkPadHighlight = {
    highlight: highlight,
    highlightMarkdownSource: highlightMarkdownSource,
    languages: Object.keys(LANGS)
  };
})(window);
