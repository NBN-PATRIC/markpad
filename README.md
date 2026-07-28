# MarkPad

Leitor e editor de Markdown para Windows — porque o Windows não tem um decente
de fábrica.

**Sem cofre, sem vault, sem projeto**: você abre um `.md` solto e pronto, como
faria no Notepad++. Várias abas, vários documentos ao mesmo tempo.

> O visual do modo leitura foi calibrado a partir das cores do Obsidian, mas
> **o MarkPad não depende dele em nada**: não lê vaults, não precisa que esteja
> instalado e não fala com ele. Os valores de cor são constantes no
> `web/style.css`. O Obsidian foi só o ponto de partida do desenho.

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

## Instalar

Baixe em [Releases](https://github.com/NBN-PATRIC/markpad/releases).

### Portátil

`MarkPad-x.y.z-portable-win-x64.zip` — descompacte e execute. Um `.exe` único
com a interface embutida; nada é instalado.

O arquivo-marcador `MarkPad.portable` que vem no zip liga o **modo portátil**:
configurações, sessão e cache vão para a subpasta `data\`, ao lado do
executável. Nada é gravado no perfil do usuário nem no registro. Cabe num
pendrive; apagar a pasta remove o programa por inteiro.

Sem o marcador, o mesmo `.exe` guarda as configurações em `%APPDATA%\MarkPad`.

### Instalador

`MarkPad-x.y.z-setup-win-x64.exe` — instala em `%LOCALAPPDATA%\Programs\MarkPad`
**por usuário, sem pedir administrador**. Cria atalho no Menu Iniciar, aparece
em "Adicionar ou remover programas" e desinstala sem deixar rastro.

Duas opções marcáveis na instalação:

- **Abrir arquivos .md com o MarkPad** — registra o aplicativo
- **Confirmar o MarkPad como padrão ao final** — o Windows mostra a caixa de
  escolha para você confirmar num clique

### Pacote `.msi` (implantação gerenciada)

Para GPO ou instalação em lote. A associação é uma *feature* separada:

```powershell
msiexec /i MarkPad-x.y.z-win-x64.msi /qn
```

Instala tudo, inclusive o registro dos `.md`. Para instalar **sem** mexer em
associações, acrescente `ADDLOCAL=AppFeature`.

### Por que "assumir automaticamente" os .md não existe

Nenhum instalador consegue — nem este, nem nenhum outro. Desde o Windows 10 o
aplicativo padrão de verdade fica em
`HKCU\...\Explorer\FileExts\.md\UserChoice`, e o valor é validado por um hash
que só o shell sabe calcular. Quem promete trocar isso sozinho ou está mentindo
ou usa truque que quebra na atualização seguinte.

O MarkPad faz o caminho legítimo: registra o aplicativo — passando a aparecer
em "Abrir com" e em Configurações › Aplicativos padrão — e pede ao próprio
Windows que mostre a caixa de escolha. O clique final é seu.

### Associar pela linha de comando

```powershell
MarkPad.exe --register-md
```

Registra `.md`, `.markdown`, `.mdown`, `.mkd` e `.mdx`. Use `--set-default-md`
para registrar **e** abrir a caixa de escolha do Windows, ou `--unregister-md`
para desfazer tudo. Escreve só em `HKCU`, não pede administrador e é
reversível. O registro aponta para o caminho atual do executável — se mover a
pasta, rode de novo.

Pelo app: menu `(...)` → **"Abrir arquivos .md com o MarkPad"**.

Requisitos: Windows 10/11 e o **WebView2 Runtime** (já vem no Windows 11).
Segunda instância reaproveita a janela aberta e vira uma aba nova.

## Compilar

```powershell
dotnet build -c Release
```

```powershell
.\tools\build-release.ps1
```

```powershell
.\tools\build-installer.ps1
```

O primeiro compila para `bin\Release\net9.0-windows\`. O segundo gera `dist\`
com o zip portátil e as somas SHA-256. O terceiro acrescenta o `setup.exe` e o
`.msi`, e precisa de duas ferramentas:

```powershell
winget install --id JRSoftware.InnoSetup -e
```

```powershell
dotnet tool install --global wix --version 5.* --add-source https://api.nuget.org/v3/index.json
```

O WiX é fixado na 5 de propósito: a 7 passou a exigir aceitação do EULA da
*Open Source Maintenance Fee*. A 5 é MS-RL e faz tudo o que precisamos.

Testes do parser (incluem as verificações de sanitização):

```bash
node dev/test-markdown.js
```

No build de desenvolvimento a pasta `web\` fica ao lado do `.exe` e é servida
do disco. No executável publicado ela vai embutida no binário — por isso a
distribuição é um arquivo só.

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
FileAssociation.cs    registro de .md em HKCU (menu, --register-md, instalador)
NativeMethods.cs      barra de título escura, "mostrar no Explorer"
web/                  a interface inteira (embutida no exe publicado)
  markdown.js         parser + sanitizador (sem dependências)
  highlight.js        realce de ~20 linguagens + do markdown-fonte
  app.js              abas, trava, editor, painéis, busca, comandos
  style.css           tokens de cor e layout
dev/                  preview no navegador + testes do parser
tools/                ícone, artefatos de release e instaladores
installer/            markpad.iss (Inno Setup) e markpad.wxs (WiX)
```

Zero dependências de runtime além do WebView2: sem npm, sem CDN, sem Electron,
sem Obsidian. Funciona offline.

Histórico de versões em [CHANGELOG.md](CHANGELOG.md).
