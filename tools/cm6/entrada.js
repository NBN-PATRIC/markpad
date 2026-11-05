// Pacote do CodeMirror 6 para o MarkPad.
// Gera um unico arquivo (IIFE, global window.CM) que vai para web/codemirror.js.
// Tudo embutido: nada e carregado da rede nem sob demanda.
export * as state from '@codemirror/state';
export * as view from '@codemirror/view';
export * as commands from '@codemirror/commands';
export * as language from '@codemirror/language';
export * as markdown from "@codemirror/lang-markdown";
export * as yaml from "@codemirror/lang-yaml";
export * as search from '@codemirror/search';
export * as autocomplete from '@codemirror/autocomplete';
export * as lezerMarkdown from '@lezer/markdown';
export * as highlight from '@lezer/highlight';
export * as common from '@lezer/common';

// HTML colado vira Markdown (o mesmo que o Obsidian usa).
export { default as TurndownService } from 'turndown';
export { gfm as turndownGfm } from 'turndown-plugin-gfm';

import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';

function desc(name, alias, support) {
  return LanguageDescription.of({ name, alias, support });
}
function antigo(name, alias, modo) {
  return LanguageDescription.of({ name, alias, support: new LanguageSupport(StreamLanguage.define(modo)) });
}

// Linguagens dos blocos de codigo (``` lang). Aliases iguais aos do realce
// do leitor (web/highlight.js), para o mesmo bloco ter cor nos dois lados.
export const codeLanguages = [
  desc('javascript', ['js', 'jsx', 'mjs', 'cjs', 'node'], javascript({ jsx: true })),
  desc('typescript', ['ts', 'tsx'], javascript({ jsx: true, typescript: true })),
  desc('python', ['py', 'python3'], python()),
  desc('css', ['scss', 'less'], css()),
  desc('html', ['htm', 'xhtml', 'vue'], html()),
  desc('json', ['jsonc', 'json5'], json()),
  desc('sql', ['mysql', 'psql', 'postgres', 'sqlite'], sql()),
  desc('xml', ['svg'], xml()),
  desc('yaml', ['yml'], yaml()),
  antigo('shell', ['sh', 'bash', 'zsh', 'console', 'fish'], shell),
  antigo('powershell', ['ps1', 'pwsh', 'posh'], powerShell),
  antigo('go', ['golang'], go),
  antigo('rust', ['rs'], rust),
  antigo('c', ['h'], c),
  antigo('cpp', ['c++', 'hpp', 'cc'], cpp),
  antigo('csharp', ['cs', 'c#', 'dotnet'], csharp),
  antigo('java', [], java),
  antigo('kotlin', ['kt'], kotlin),
  antigo('ruby', ['rb'], ruby),
  antigo('lua', [], lua),
  antigo('perl', ['pl'], perl),
  antigo('toml', [], toml),
  antigo('ini', ['cfg', 'conf', 'properties', 'editorconfig'], properties),
  antigo('diff', ['patch'], diff),
  antigo('dockerfile', ['docker'], dockerFile),
  antigo('nginx', [], nginx),
  antigo('protobuf', ['proto'], protobuf)
];
