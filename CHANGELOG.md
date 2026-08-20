# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Menu ⋮ reorganizado como no Obsidian**: o que se faz *com* o documento
  primeiro — salvar, renomear, mover, duplicar, exportar, imprimir, abrir
  fora, excluir — e as preferências depois, em grupos com cabeçalho. Quem
  abre esse menu quase sempre quer a primeira parte.
- **Renomear** (`F2`), **Mover para...**, **Duplicar**, **Abrir no app padrão
  do Windows** e **Excluir arquivo**. Estão no menu ⋮, no clique direito da
  guia e no clique direito de qualquer arquivo do painel — árvore ou lista
  filtrada, o mesmo cardápio nos três. A guia, o título, os recentes e o
  vigia de disco seguem o arquivo quando ele muda de nome ou de pasta.
- **Excluir manda para a Lixeira do Windows**, nunca para o vazio
  (`SHFileOperation` com `FOF_ALLOWUNDO`). A confirmação diz o nome do
  arquivo, avisa quando há alteração não salva — e deixa *Cancelar* como
  padrão do teclado, para que `Enter` nunca apague nada.
- **Caixa de texto própria para renomear**, com validação antes de fechar
  (nome vazio, barras, `< > : " | ? *`) e a extensão fora da seleção inicial.
  `window.prompt` no WebView2 é caixa do sistema: fora do tema e sem
  validação.
- Ponte: `renameFile`, `moveFile`, `duplicateFile`, `deleteFile` e
  `openWithDefault`. Todas respeitam a trava de caminho autorizado (só vale
  para arquivo aberto nesta sessão) e abrir no app padrão recusa executáveis
  (`.exe`, `.bat`, `.ps1`, `.lnk`…) — num leitor de texto, “abrir” nunca
  pode virar “executar”.
- **Tarefas clicáveis no modo leitura.** Com o giz destravado, marcar `- [ ]`
  é um clique na caixinha: a linha de origem é reescrita, o documento fica
  sujo e o backup entra na fila. Travado, a caixinha continua desabilitada —
  a trava vale para ela também.
- **Bloco de propriedades** no início do documento, montado a partir do
  frontmatter `---` (que antes sumia da leitura). Recolhível, com `tags` e
  `aliases` virando fichas; clicar numa tag abre a busca da pasta por ela.
  Liga e desliga em Configurações › Aparência ou pela paleta.
- `data-task-line` no HTML gerado: a linha exata de cada tarefa, só quando o
  mapa de linhas está ligado. É atributo próprio de propósito — `data-line`
  significa “bloco editável” para o editor ao vivo, e um `<li>` não é um.
- `dev/make-preview.js`: a página de desenvolvimento passa a ser **gerada** a
  partir de `web/index.html`. Era mantida à mão e vivia atrasada.
- **Barra de acesso rápido** abaixo das guias, com os botões que o usuário
  escolher. É montada a partir do mesmo registro de comandos que alimenta a
  paleta e o menu ⋮, então todo comando novo aparece nela sem código extra.
  Clique direito na barra: configurar, mostrar rótulos ou esconder.
- **Tela de configurações** (`Ctrl+,`) com sete abas — Aparência, Editor e
  trava, Arquivos, Barra rápida, Atalhos, Atualizações e Sobre.
- **Ordenação do painel de arquivos**: nome (A→Z / Z→A), modificado e criado,
  nos dois sentidos, com opção de pôr pastas antes dos arquivos. Ordem
  natural — `cap 2` vem antes de `cap 10`.
- **Filtro por nome no painel de arquivos** (ícone de lupa no cabeçalho). Com
  filtro ligado a árvore vira lista rasa e mostra a pasta de origem ao lado.
- **Recolher todas as pastas** num botão só.
- **Abrir arquivo pelo nome** (`Ctrl+P`), com busca aproximada sobre a pasta
  inteira e as letras casadas em destaque. Sem pasta aberta, lista os
  recentes.
- Escala única de animação (`--anim-*`) usada por toda a interface, com
  interruptor em Aparência e respeito automático a `prefers-reduced-motion`.
- Ponte: operação `listFiles`, um índice raso da pasta (caminho, nome e datas,
  nunca conteúdo) que alimenta o filtro e o seletor rápido.
- **Licença MIT** (`LICENSE`), © NBN Telecom e Patric Farias.
- `tools/new-signing-cert.ps1` e `tools/sign.ps1` — geração de certificado
  próprio e assinatura com carimbo de tempo, usando apenas o PowerShell do
  Windows (sem precisar do SDK nem do `signtool`).
- `docs/ASSINATURA.md` — o que assinatura resolve, o que não resolve e quanto
  custa cada caminho.
- `.gitignore` passa a barrar `*.pfx`, `*.p12`, `*.snk` e `.certs/`.

### Alterado
- `Ctrl+P` passa a abrir arquivo pelo nome, como em qualquer editor.
  **Imprimir foi para `Ctrl+Alt+P`** e continua no menu ⋮, na paleta de
  comandos e disponível para a barra rápida.
- Devtools saiu do menu ⋮ (segue na paleta e em Configurações › Sobre).

### Corrigido
- **Linhas erradas dentro de listas.** Blocos aninhados num item de lista
  recebiam `data-line` somado duas vezes (índice local + base absoluta), então
  apontavam uma linha que não era a deles. Isso desalinhava a edição ao vivo,
  o “ir para a linha” e o realce de alterações em qualquer parágrafo, código
  ou citação indentado sob um `-`. Há teste travando o caso.
- **Separador solto no menu de contexto da guia** (dois seguidos, sem nada
  entre eles). `showMenu` passa a limpar separadores repetidos e nas pontas,
  o que vale para todos os menus de uma vez — eles são montados por pedaços
  condicionais, então sempre sobra um.

### Sobre o aviso do SmartScreen

Continua. Certificado autoassinado **não** o elimina: o Windows exige uma
cadeia que termine numa autoridade certificadora pública, e desde junho de 2023
a chave privada desses certificados precisa ficar em hardware. O autoassinado
serve para confiança dentro do domínio (GPO de Editores Confiáveis) e para
detectar adulteração.

Caminhos que resolvem de fato estão comparados em `docs/ASSINATURA.md` —
SignPath Foundation (grátis para código aberto qualificado) é o primeiro a
tentar, já que o projeto é MIT.

### Planejado
- Obter certificado de uma CA pública para a distribuição sem aviso

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
