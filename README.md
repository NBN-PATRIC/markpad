# MarkPad

Leitor e editor de Markdown para Windows. A leitura sai igual à do Obsidian
(os tokens de cor foram extraídos do `app.css` do Obsidian 1.12.7), mas **sem
cofre, sem vault, sem projeto**: você abre um `.md` solto e pronto, como faria
no Notepad++.

A diferença principal está na trava.

## 🖍️ A trava

Todo arquivo abre **travado**. No estado travado o app não é "um editor com
`readonly` ligado" — **não existe campo de digitação na página**. Só o texto
renderizado. Não há tecla que edite, apague ou insira nada, porque não há onde
digitar.

A edição só aparece quando você aciona o giz de propósito:

| Estado | Como fica | O que dá pra fazer |
|:--|:--|:--|
| 🔒 **Travado** (padrão) | pílula cinza, giz apagado, rodapé "Somente leitura" | ler, rolar, buscar, copiar, recolher seções |
| 🖍️ **Editando** | pílula roxa, giz colorido, faixa roxa no topo, aba sublinhada, título da janela avisa | tudo acima + digitar e salvar |

Acionar: clique no giz, clique no indicador do rodapé, ou <kbd>Ctrl</kbd>+<kbd>E</kbd>.

Reforços contra edição acidental:

- `Ctrl+S` com o documento travado não grava nada e avisa.
- Substituir (na barra de localizar) fica desabilitado enquanto travado.
- Opção **"Pedir confirmação ao destravar"** para exigir um segundo passo.
- Opção **"Abrir sempre travado"** (ligada) — desligue se preferir.
- No lado nativo há uma allowlist: só é possível gravar em caminhos que você
  abriu nesta sessão, e só em extensões de texto.

## O que ele faz

**Leitura**
- Markdown completo: títulos, ênfases, listas, tarefas, tabelas, citações,
  código com realce, notas de rodapé, `==destaque==`, HTML inline seguro.
- Extensões do Obsidian: **callouts** (`> [!warning]`, incluindo os dobráveis
  com `-`/`+`), **wikilinks** `[[Nota]]`, embutidos `![[foto.png|300]]`, tags
  `#assunto/sub`, frontmatter YAML.
- **Seções recolhíveis**: seta ao lado de cada título (ou duplo clique) recolhe
  tudo até o próximo título de mesmo nível. Listas aninhadas também recolhem.
  `Ctrl+Shift+-` recolhe tudo, `Ctrl+Shift++` expande.
- Tabelas com borda arredondada, cabeçalho fixo ao rolar e alinhamento por
  coluna (`:---`, `:---:`, `---:`).
- Sumário lateral navegável.

**Edição** (quando destravada)
- Editor com numeração de linha e realce da sintaxe do próprio markdown.
- Modo **código** ou **dividido** (fonte + prévia lado a lado).
- Continuação automática de listas e citações no Enter, `Tab`/`Shift+Tab` para
  indentar bloco, `Ctrl+B`/`Ctrl+I`/`Ctrl+K`, `Ctrl+D` duplica linha,
  `Alt+↑/↓` move linha, `Ctrl+/` comenta.
- `Ctrl+Z` nativo preservado (as edições passam por `execCommand`).

**Arquivos**
- Abas, arrastar-e-soltar na janela, painel de pastas, recentes, sessão restaurada.
- Busca dentro do arquivo (com regex) e **busca em toda a pasta**.
- Detecta e preserva codificação (UTF-8/BOM, UTF-16, Latin-1) e fim de linha
  (CRLF/LF) — ambos trocáveis pelo rodapé.
- Grava via arquivo temporário + troca atômica: falta de energia no meio não
  deixa o original truncado.
- Recarrega sozinho quando o arquivo muda no disco (se não houver edição pendente).
- Exportar HTML, imprimir, tema claro/escuro/sistema, zoom.

## Segurança do conteúdo

Um `.md` é dado, não código. O HTML gerado passa por duas peneiras — uma na
montagem da string e outra sobre o DOM já construído (allowlist de tags e
atributos). `<script>`, `on*=`, `javascript:` e `<svg>` não sobrevivem; blocos
HTML crus viram texto inerte. Imagens da internet ficam bloqueadas por padrão
(clique para carregar). Há CSP na página e nenhuma navegação sai do app.

## Rodar e instalar

```powershell
dotnet build -c Release
.\bin\Release\net9.0-windows\MarkPad.exe
```

Executável único + atalho no Menu Iniciar:

```powershell
.\build.ps1 -Shortcut
```

Para não depender do .NET instalado (arquivo maior, ~70 MB):

```powershell
.\build.ps1 -Shortcut -SelfContained
```

Para abrir `.md` com duplo clique: menu `(...)` → **"Abrir arquivos .md com o
MarkPad"**. Mexe só em `HKCU` e é reversível pelo mesmo menu.

Requisitos: Windows 10/11 e o **WebView2 Runtime** (já vem no Windows 11).
Segunda instância reaproveita a janela aberta e vira uma aba nova.

## Atalhos

| | |
|:--|:--|
| `Ctrl+E` | travar / liberar edição |
| `Ctrl+O` / `Ctrl+Shift+O` | abrir arquivo / pasta |
| `Ctrl+N` · `Ctrl+S` · `Ctrl+Shift+S` | nova nota · salvar · salvar como |
| `Ctrl+W` · `Ctrl+Tab` · `Ctrl+1..9` | fechar aba · próxima aba · ir para aba |
| `Ctrl+F` / `Ctrl+Shift+F` | localizar no arquivo / na pasta |
| `Ctrl+G` | ir para a linha |
| `Ctrl+Shift+-` / `Ctrl+Shift++` | recolher / expandir todas as seções |
| `Ctrl+Shift+P` | paleta de comandos |
| `Ctrl+\` · `Alt+Z` | painel lateral · quebra de linha |
| `Ctrl+P` · `Ctrl+ +/-/0` | imprimir · zoom |

## Estrutura

```
MarkPad.csproj        WPF + WebView2 (net9.0-windows)
MainWindow.xaml.cs    ponte com o disco: leitura, gravação, diálogos,
                      busca em pasta, monitoramento, allowlist de escrita
App.xaml.cs           instância única (named pipe) + argumentos de linha
NativeMethods.cs      barra de título escura, "mostrar no Explorer"
web/                  a interface inteira
  markdown.js         parser + sanitizador (sem dependências)
  highlight.js        realce de ~20 linguagens + do markdown-fonte
  app.js              abas, trava, editor, painéis, busca, comandos
  style.css           tokens de cor extraídos do Obsidian
dev/                  preview no navegador + testes do parser
tools/build-icon.ps1  gera Assets/app.ico
```

Testes do parser (inclui as verificações de sanitização):

```bash
node dev/test-markdown.js
```

Zero dependências de runtime além do WebView2: sem npm, sem CDN, funciona
offline.
