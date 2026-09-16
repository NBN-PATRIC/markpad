# MarkPad

## O que é

Leitor/editor de Markdown para Windows (WPF C#/.NET 9 + WebView2), da NBN
Telecom. Abre `.md` solto em abas, sem vault/projeto; o diferencial é a trava:
todo arquivo abre em modo leitura e a edição só existe quando destravada de
propósito. Interface web embutida no assembly (exe de arquivo único).

## Mapa

- `MainWindow.xaml.cs` — lado nativo: janela, abas, bridge com o WebView2
- `web/` — toda a UI (app.js, liveedit.js, markdown.js, themes.js, i18n.js,
  style.css); embutida no build
- `dev/` — preview.html + stub-bridge.js para iterar na UI sem recompilar; scripts de teste
- `tools/` — build-release.ps1, build-installer.ps1, sign.ps1 (assinatura de código)
- `installer/` — markpad.iss (Inno Setup) e markpad.wxs (MSI/WiX)
- `docs/` — ASSINATURA.md, ATUALIZACAO.md (auto-update), SIGNPATH.md
- `dist/` — binários gerados (ignorado no git); `publish/` idem
- `Updater.cs` — atualização automática, valida SHA-256 antes de aplicar
- `.github/workflows/build.yml` — CI de build

## Regras

- NUNCA versionar chaves de assinatura (`*.pfx`, `*.p12`, `.certs/`) nem
  binários (`dist/`, `publish/`, `bin/`, `obj/`) — o `.gitignore` já cobre;
  não relaxar essas entradas.
- Repositório **público** da NBN: `github.com/NBN-PATRIC/markpad` (conferido
  em 16/09/2026; este arquivo dizia "privado", que estava errado). Não trocar o
  remote nem publicar em outro lugar sem o Patric pedir — e, sendo público,
  vale dobrado a regra de não commitar segredo nenhum.
- O Updater só aceita pacote com SHA-256 conferido — não enfraquecer essa
  checagem nem editar `SHA256SUMS.txt` à mão.
- Release: usar `tools/build-release.ps1` (não `dotnet publish` avulso), e
  atualizar `CHANGELOG.md` + `<Version>` no `.csproj` juntos.
- **Texto de interface passa por `t()`** (`web/i18n.js`). A chave é o próprio
  português, não um identificador. Ao mexer numa frase já traduzida, ajuste o
  dicionário junto — `node dev/test-i18n.js` reprova chave órfã e frase pedida
  sem tradução.
- **Cor nova vai como variável CSS**, não como valor solto: as paletas de
  `web/themes.js` trocam as raízes e o resto da folha segue atrás. Valor vindo
  de arquivo de fora (tema do VS Code) só entra se for literal de cor.
- Antes de commitar, rodar os cinco testes de nó: `markdown`, `liveedit`,
  `changes`, `themes`, `i18n`.

## Estado (2026-09-16)

Ativo. **v1.3.0 lançada em 2026-09-16** — paletas de cor, tema do VS Code,
interface em pt-BR/inglês/espanhol, e a edição ao vivo consertada (na 1.2.0 ela
não abria editor dentro de nenhuma seção, ou seja quase nunca). É também a
primeira release que o atualizador automático consome: `MarkPad-1.3.0-setup-win-x64.exe`
e `SHA256SUMS.txt` estão publicados, e a cadeia de conferência foi validada
contra o digest da própria API do GitHub.

Pendentes do rumo Obsidian (conferidos no código, não na lista): painel de
links de saída, operadores de busca (`path:`, `tag:`, `file:`), gráfico local,
arrastar título para reordenar seção. **KaTeX e Mermaid** estão parados à
espera de decisão: os dois pedem biblioteca externa, contra a promessa de
"zero dependências, funciona offline" do README.
