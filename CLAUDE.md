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
- Repositório **público** da NBN: `github.com/NBN-PATRIC/markpad`. Público de
  propósito, e não por descuido: o atualizador automático consulta
  `api.github.com/.../releases/latest` sem token nenhum, e num repo privado essa
  chamada voltaria 404 — o auto-update simplesmente não existiria. Não trocar o
  remote nem publicar em outro lugar sem o Patric pedir, e **nada de segredo em
  commit**, que aqui é leitura pública.
- O Updater só aceita pacote com SHA-256 conferido — não enfraquecer essa
  checagem nem editar `SHA256SUMS.txt` à mão.
- Release: usar `tools/build-release.ps1` (não `dotnet publish` avulso), e
  atualizar `CHANGELOG.md` + `<Version>` no `.csproj` juntos.
- **Publicar é: empurrar a tag, criar a release (notas), e deixar os binários
  com o CI.** O workflow termina em `gh release upload --clobber`, que exige
  uma release já existente e substitui tudo que estiver lá — inclusive o
  `SHA256SUMS.txt`. Subir artefato compilado localmente é trabalho perdido, e
  pior: você confere as somas de binários que o CI vai trocar. O oficial é o
  do CI, que tem procedência (exigência do SignPath). Confira a cadeia
  **depois** que o workflow terminar.
- **Texto de interface passa por `t()`** (`web/i18n.js`). A chave é o próprio
  português, não um identificador. Ao mexer numa frase já traduzida, ajuste o
  dicionário junto — `node dev/test-i18n.js` reprova chave órfã e frase pedida
  sem tradução.
- **Cor nova vai como variável CSS**, não como valor solto: as paletas de
  `web/themes.js` trocam as raízes e o resto da folha segue atrás. Valor vindo
  de arquivo de fora (tema do VS Code) só entra se for literal de cor.
- Antes de commitar, rodar os testes de nó: `markdown`, `editor`, `changes`,
  `themes`, `i18n`, `textops`, `linkindex`, `highlight` (`node dev/test-<nome>.js`).
- O editor (ao vivo e fonte) é o CodeMirror 6 embutido em `web/codemirror.js`,
  gerado por `node tools/cm6/construir.js` (versões fixas no `package-lock.json` de
  `tools/cm6`, compilação em `C:\dev\markpad-cm6`, fora do ownCloud). Não editar
  `web/codemirror.js` à mão; o que é do MarkPad mora em `web/editor.js`.

## Estado (2026-11-05)

Ativo. **v1.4.0 lançada em 2026-11-05**: editor CodeMirror 6 nos modos ao vivo
e fonte (`web/editor.js`), tela dividida, abas empilhadas, janela destacada,
barra lateral da direita, espaços de trabalho, notas (hoje, modelos, única),
grafo da pasta, `.canvas`, slides, KaTeX embutido e o pacote de funções do
Notepad++. Binários do CI (setup, exe, msi, zip) e `SHA256SUMS.txt` conferidos
contra o digest da API do GitHub e contra o download; quem tem a 1.3.0 recebe
pelo atualizador. O exe do CI abre e se identifica como `1.4.0+96ff672`.

Pendentes: **Mermaid** (a v12 embute o ELK, licença EPL-2.0, e pesa 5,5 MB;
decisão de licença do Patric), leitor de `.base`, modo Vim, janela destacada
na mesma instância. A matriz de paridade mora em `estudo-obsidian\` (fora do git).
