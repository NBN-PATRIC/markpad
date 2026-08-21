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
| 🔒 **Travado** (padrão) | giz apagado, **Leitura** aceso no seletor do rodapé, livro na bandeira do cabeçalho | ler, rolar, buscar, copiar, recolher seções |
| 🖍️ **Editando** | giz colorido, faixa roxa no topo, aba sublinhada, título da janela avisa | tudo acima + digitar e salvar |

Acionar: clique no giz, escolha **Leitura** ou **Ao vivo** no seletor do rodapé,
ou <kbd>Ctrl</kbd>+<kbd>E</kbd>.

## Os três modos

O documento está sempre em **um** modo, nunca em dois. Troca no seletor do
rodapé; a bandeira no cabeçalho diz em qual você está (e clicar nela abre o
mesmo cardápio).

| | Modo | O que é |
|:--|:--|:--|
| 📖 | **Leitura** | o giz está travado; não existe campo de texto na página |
| ✏️ | **Edição ao vivo** | edita dentro do próprio leitor, sem ver markdown — só o bloco onde o cursor está vira texto cru |
| `<>` | **Código-fonte** | markdown cru, com numeração de linha e realce de sintaxe |

A **leitura ao lado do código** (tela dividida) é opcional e vive dentro do modo
código-fonte: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, ou o botão de colunas
no rodapé. Ela vem desligada — abrir um arquivo dá uma coluna de texto
centralizada, e não três painelões.

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
- Sumário lateral navegável, que acompanha a rolagem e recolhe por nível.
- **Painel de tags**: junta as tags de todos os arquivos da pasta aberta,
  `#a/b` vira árvore com contagem por nível, e clicar busca a tag na pasta.

**Edição** (quando destravada)
- **Edição ao vivo**: escreve dentro do próprio leitor. Só o bloco onde o cursor
  está mostra o markdown cru; o resto da página continua renderizado.
- **Código-fonte** com numeração de linha e realce da sintaxe do markdown,
  opcionalmente com a leitura ao lado.
- Formatação pelo botão direito — negrito, itálico, riscado, destaque, código,
  link, título, lista, tarefa, citação, tabela, linha, callout.
- Continuação automática de listas e citações no Enter, `Tab`/`Shift+Tab` para
  indentar bloco, `Ctrl+B`/`Ctrl+I`/`Ctrl+K`, `Ctrl+D` duplica linha,
  `Alt+↑/↓` move linha, `Ctrl+/` comenta.
- `Ctrl+Z` nativo preservado (as edições passam por `execCommand`).
- **Histórico na margem, estilo Notepad++**: a linha alterada e ainda não salva
  fica marcada de laranja; depois de salvar, verde. Fechar o app com alteração
  pendente guarda o texto editado num arquivo à parte, sem tocar no original.

**Arquivos**
- Abas, arrastar-e-soltar na janela, painel de pastas, recentes, sessão restaurada.
- Renomear (`F2`), mover, duplicar, excluir **para a Lixeira** e abrir no
  aplicativo padrão do Windows — tudo pelo menu ⋮ do documento ou pelo botão
  direito na árvore.
- Abre **qualquer tipo de arquivo**; se não for markdown, pergunta antes (com
  "não avisar de novo").
- Painel de pastas com **filtro `.md` / todos**, busca por nome, seis ordens e
  recolher tudo.
- **Abrir pelo nome** (`Ctrl+P`) e **paleta de comandos** (`Ctrl+Shift+P`).
- **Barra de acesso rápido** configurável e uma tela de **configurações** com
  abas.
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

Testes (o do parser inclui as verificações de sanitização):

```bash
node dev/test-markdown.js && node dev/test-liveedit.js && node dev/test-changes.js
```

No build de desenvolvimento a pasta `web\` fica ao lado do `.exe` e é servida
do disco. No executável publicado ela vai embutida no binário — por isso a
distribuição é um arquivo só.

## Atalhos

| | |
|:--|:--|
| `Ctrl+E` | travar / liberar edição |
| `Ctrl+Shift+C` · `Ctrl+Shift+L` | código-fonte · leitura ao lado do código |
| `Ctrl+O` / `Ctrl+Shift+O` | abrir arquivo / pasta |
| `Ctrl+P` · `Ctrl+Shift+P` | abrir arquivo pelo nome · paleta de comandos |
| `Ctrl+N` · `Ctrl+S` · `Ctrl+Shift+S` | nova nota · salvar · salvar como |
| `Ctrl+W` · `Ctrl+Tab` · `Ctrl+1..9` | fechar aba · próxima aba · ir para aba |
| `Ctrl+Shift+T` | reabrir a última aba fechada |
| `F2` | renomear o documento aberto |
| `Ctrl+F` / `Ctrl+Shift+F` | localizar no arquivo / na pasta |
| `Ctrl+H` | substituir no arquivo |
| `Ctrl+G` | ir para a linha |
| `Ctrl+Shift+-` / `Ctrl+Shift++` | recolher / expandir todas as seções |
| `Ctrl+\` · `Alt+Z` · `Ctrl+,` | painel lateral · quebra de linha · configurações |
| `Ctrl+Alt+P` · `Ctrl+ +/-/0` | imprimir · zoom |

A lista completa, sempre em dia com o código, está em
**Configurações › Atalhos** — ela é gerada do mesmo registro de comandos que
alimenta a paleta, o menu ⋮ e a barra de acesso rápido.

## Estrutura

```
MarkPad.csproj        WPF + WebView2 (net9.0-windows)
MainWindow.xaml.cs    ponte com o disco: leitura, gravação, diálogos,
                      busca em pasta, monitoramento, allowlist de escrita
App.xaml.cs           instância única (named pipe) + argumentos de linha
FileAssociation.cs    registro de .md em HKCU (menu, --register-md, instalador)
NativeMethods.cs      barra de título escura, "mostrar no Explorer"
web/                  a interface inteira (embutida no exe publicado)
  index.html          a página, com a CSP
  markdown.js         parser + sanitizador (sem dependências)
  highlight.js        realce de ~20 linguagens + do markdown-fonte
  liveedit.js         edição dentro do leitor, bloco a bloco
  changes.js          diff por linha para a margem de alterações
  icons.js            os ícones, montados em SVG
  app.js              abas, trava, modos, painéis, busca, comandos
  style.css           tokens de cor e layout
dev/                  preview no navegador + testes
tools/                ícone, artefatos de release e instaladores
installer/            markpad.iss (Inno Setup) e markpad.wxs (WiX)
```

Zero dependências de runtime além do WebView2: sem npm, sem CDN, sem Electron,
sem Obsidian. Funciona offline.

Histórico de versões em [CHANGELOG.md](CHANGELOG.md).

## Assinatura dos binários

Os executáveis publicados **não são assinados por uma autoridade
certificadora**, então o SmartScreen avisa na primeira execução: *Mais
informações → Executar assim mesmo*. Confira o download pelo
`SHA256SUMS.txt` da release.

Há um par de scripts para assinar com certificado próprio:

```powershell
.\tools\new-signing-cert.ps1
```

```powershell
.\tools\sign.ps1 -Thumbprint <impressão digital>
```

Certificado autoassinado **não** elimina o aviso do SmartScreen — serve para
confiança dentro do domínio (via GPO de Editores Confiáveis) e para detectar
adulteração. O porquê disso está em [docs/ASSINATURA.md](docs/ASSINATURA.md).

Para eliminar o aviso de verdade, o projeto está sendo inscrito no **SignPath
Foundation**, que assina projetos de código aberto com certificado de
autoridade certificadora real. O passo de assinatura já está no workflow de
CI, inerte até a aprovação — ver [docs/SIGNPATH.md](docs/SIGNPATH.md).

## Contribuindo

O projeto compila em CI a cada envio ([build.yml](.github/workflows/build.yml)).
Antes de abrir um pull request:

```bash
node dev/test-markdown.js
```

```bash
node dev/test-liveedit.js
```

```bash
node dev/test-changes.js
```

O segundo cobre o que pode corromper arquivo na edição bloco a bloco. Não
mexa nele sem entender o porquê de cada caso. O terceiro cobre o diff que
pinta a margem de alterações.

## Licença

[MIT](LICENSE) — © 2026 NBN Telecom e Patric Farias.
