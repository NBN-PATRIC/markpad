# MarkPad

## O que é

Leitor/editor de Markdown para Windows (WPF C#/.NET 9 + WebView2), da NBN
Telecom. Abre `.md` solto em abas, sem vault/projeto; o diferencial é a trava:
todo arquivo abre em modo leitura e a edição só existe quando destravada de
propósito. Interface web embutida no assembly (exe de arquivo único).

## Mapa

- `MainWindow.xaml.cs` — lado nativo: janela, abas, bridge com o WebView2
- `web/` — toda a UI (app.js, liveedit.js, markdown.js, style.css); embutida no build
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
- Repositório privado da NBN: `github.com/NBN-PATRIC/markpad`. Não trocar o
  remote nem publicar em outro lugar sem o Patric pedir.
- O Updater só aceita pacote com SHA-256 conferido — não enfraquecer essa
  checagem nem editar `SHA256SUMS.txt` à mão.
- Release: usar `tools/build-release.ps1` (não `dotnet publish` avulso), e
  atualizar `CHANGELOG.md` + `<Version>` no `.csproj` juntos.

## Estado (2026-08-28)

Ativo. v1.2.0 lançada em 2026-08-21 (instaladores em `dist/`). Desde a tag há
7 commits não lançados — auto-update (`Updater.cs`), paridade do parser com o
Obsidian e polimento — listados em `[Não lançado]` no CHANGELOG; além disso,
mudanças não commitadas em `web/app.js` e `web/style.css`.
