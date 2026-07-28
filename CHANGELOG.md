# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Planejado
- Assinatura do executável (hoje o SmartScreen avisa por ser binário novo)
- Escolher a licença antes de tornar o repositório público

## [1.1.0] — 2026-07-28

Distribuição: além do portátil, agora há instalador.

### Adicionado
- **Instalador (`setup.exe`, Inno Setup)** — instala por usuário em
  `%LOCALAPPDATA%\Programs\MarkPad`, sem pedir administrador. Cria atalho no
  Menu Iniciar, aparece em "Adicionar ou remover programas" e desinstala sem
  deixar rastro. Duas opções marcáveis:
  - "Abrir arquivos .md com o MarkPad" — registra o aplicativo
  - "Confirmar o MarkPad como padrão ao final" — abre a caixa do Windows
- **Pacote `.msi` (WiX)** — para implantação gerenciada/GPO. A associação é
  uma *feature* separada: `msiexec /i MarkPad.msi /qn ADDLOCAL=AppFeature`
  instala sem assumir os `.md`.
- Registro como aplicativo em Configurações › Aplicativos padrão
  (`RegisteredApplications` + `Capabilities`).
- Flags de linha de comando `--register-md`, `--unregister-md` e
  `--set-default-md`, usadas pelo instalador e pelo desinstalador.
- O menu do app agora mostra qual programa abre `.md` hoje e oferece
  "só registrar" ou "registrar e definir padrão".

### Sobre "assumir automaticamente" os .md

Não é possível — por nenhum instalador, em nenhuma linguagem. Desde o
Windows 10 o aplicativo padrão de verdade fica em
`HKCU\...\Explorer\FileExts\.md\UserChoice`, e o valor é validado por um hash
que só o shell sabe calcular. Programas que prometem trocar isso sozinhos ou
mentem, ou usam truque que quebra na atualização seguinte.

O que o MarkPad faz é o caminho legítimo: registra o aplicativo (passando a
aparecer em "Abrir com" e em Aplicativos padrão) e pede ao próprio Windows que
mostre a caixa de escolha. O clique final é seu — um clique.

Verificado nesta máquina: instalar com a opção de associação marcada registrou
tudo e **não alterou** o `UserChoice` existente; desinstalar removeu cada chave
criada e deixou o `UserChoice` como estava.

### Corrigido
- `SHA256SUMS.txt` saía com zero byte (`Get-ChildItem -Exclude` só filtra os
  filhos quando o `-Path` termina em curinga), o que derrubava o upload do
  asset e, junto, a release inteira.

[Não lançado]: https://github.com/NBN-PATRIC/markpad/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.1.0

## [1.0.0] — 2026-07-27

Primeira versão. Leitor/editor de Markdown para Windows, sem cofre e sem
dependência de outros aplicativos.

### A trava de edição
- Todo arquivo abre **travado**. Nesse estado não existe campo de digitação na
  página — só o texto renderizado. Nenhuma tecla edita porque não há onde
  digitar; é garantia estrutural, não um `readonly`.
- Alternância por `Ctrl+E`, pelo giz 🖍️ no cabeçalho ou pelo indicador do rodapé.
- Estado visível em quatro lugares ao mesmo tempo: pílula do giz, faixa no topo,
  sublinhado da aba e título da janela.
- `Ctrl+S` travado não grava e avisa. "Substituir" fica desabilitado.
- Opções: "abrir sempre travado" (ligada) e "pedir confirmação ao destravar".

### Leitura
- Markdown completo: títulos, ênfases, listas, tarefas, tabelas, citações,
  código com realce (~20 linguagens), notas de rodapé, `==destaque==`.
- Extensões do Obsidian suportadas por conta própria: callouts (incluindo
  dobráveis), wikilinks, embutidos `![[img|300]]`, tags, frontmatter YAML.
- **Seções recolhíveis** por título (seta ou duplo clique), com aninhamento;
  listas também recolhem. `Ctrl+Shift+-` / `Ctrl+Shift++` para todas.
- Tabelas com moldura arredondada, cabeçalho fixo ao rolar e alinhamento por
  coluna.
- Sumário lateral navegável.

### Edição
- Numeração de linha e realce da sintaxe do markdown-fonte.
- Modo código ou dividido (fonte + prévia).
- Continuação de listas/citações no Enter, `Tab`/`Shift+Tab` em bloco,
  `Ctrl+B`/`I`/`K`, `Ctrl+D`, `Alt+↑/↓`, `Ctrl+/`.
- `Ctrl+Z` nativo preservado.

### Arquivos
- **Abas** com vários documentos abertos ao mesmo tempo, arrastar-e-soltar,
  árvore de pastas, recentes e sessão restaurada.
- Busca dentro do arquivo (com regex) e em toda a pasta.
- Detecta e preserva codificação (UTF-8/BOM, UTF-16, Latin-1) e fim de linha.
- Gravação atômica (arquivo temporário + troca).
- Recarrega sozinho quando o arquivo muda no disco.
- Exportar HTML, imprimir, tema claro/escuro/sistema, zoom.

### Distribuição
- **Portátil**: executável único de ~57 MB com a interface embutida no binário.
  Com o arquivo-marcador `MarkPad.portable` ao lado, configurações e cache vão
  para `data/` na mesma pasta e nada é escrito no perfil do usuário.
- Instância única: abrir um segundo `.md` vira uma aba nova na janela existente.
- Associação de `.md` opcional, só em `HKCU`, reversível — pelo menu do app ou
  pelas flags `--register-md` / `--unregister-md`.

### Segurança
- Sanitização em duas camadas (montagem da string e DOM pronto) mais CSP:
  `<script>`, `on*=`, `javascript:` e `<svg>` não sobrevivem; HTML cru vira
  texto inerte. Imagens da internet bloqueadas por padrão.
- Gravação restrita a caminhos abertos na sessão e a extensões de texto.
- Nenhuma navegação sai do aplicativo.

[1.0.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.0.0
