# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Atualização automática.** Uma consulta por dia ao GitHub, na abertura, e
  uma faixa no canto quando sai versão nova — nunca um modal, porque quem abriu
  o MarkPad queria ler um arquivo. Baixar é um clique; a troca acontece na hora
  (o app fecha, instala e volta) ou na próxima abertura, antes de a janela
  existir. Reiniciando por conta própria, o MarkPad se relança com os mesmos
  argumentos, então o `.md` que você clicou continua abrindo.
  - **Nada é executado sem o SHA-256 conferir com o publicado na release**, e
    conferido duas vezes: ao terminar o download e no instante de instalar.
    Sem assinatura de autoridade certificadora, essa é a única coisa entre o
    atualizador e um instalador trocado no meio do caminho. Release sem somas
    publicadas não ganha botão de baixar — ganha um link.
  - Só URLs `https` de `github.com`, `api.github.com` e `*.githubusercontent.com`;
    nome de arquivo sem caminho embutido; teto de 300 MB conferido no cabeçalho
    **e** durante a leitura.
  - A troca na próxima abertura exige que **nenhuma outra instância** esteja no
    ar, e um pendente apontando para versão igual ou mais velha se descarta
    sozinho. Falha em qualquer ponto não impede o app de abrir.
  - A **portátil não se autoinstala** de propósito (pendrive só de leitura,
    várias cópias): é avisada e mandada para a página.
  - Aba **Atualizações** nas configurações: ligar/desligar a consulta,
    *Procurar agora* (ignora o intervalo), e descartar um download pronto.
  - Projeto e travas em [docs/ATUALIZACAO.md](docs/ATUALIZACAO.md).

### Corrigido
- **`SHA256SUMS.txt` cobria só metade dos artefatos.** As somas eram gravadas
  no fim do `build-release.ps1`, que roda *antes* do `build-installer.ps1` — o
  instalador e o `.msi` chegavam à release sem hash nenhum. Como o atualizador
  recusa o que não consegue conferir, isso deixava justamente o instalador
  fora do caminho de atualização. Virou um passo à parte
  (`tools/write-sums.ps1`), chamado pelos dois scripts e também pelo CI depois
  de assinar; o último a rodar reescreve o arquivo já completo.
- **`.wixpdb` não vai mais para a release.** Símbolo de depuração do instalador
  não é artefato de distribuição, e um deles vazou para a 1.2.0.
- **`[[Nota]]` só abria o arquivo se ele estivesse na mesma pasta.** A busca por
  nome era um esqueleto que sabia apenas dizer "não encontrado". Agora varre o
  índice da pasta aberta como o Obsidian: primeiro o caminho relativo inteiro,
  depois o nome com extensão, depois sem ela — nessa ordem, porque
  `notas/api.md` e `arquivo/api.md` são arquivos diferentes e o caminho é a
  única coisa no link que distingue os dois. Havendo homônimos, abre o mais
  raso e avisa que houve escolha.
- **`[[#Seção]]` e `[[#^bloco]]` eram links mortos.** Sem arquivo antes do `#`
  não há o que abrir — há aonde rolar. Passam a saltar dentro do próprio
  documento, com o mesmo destaque temporário do sumário.
- **Rótulo do wikilink escondia o destino.** `[[Nota#Seção]]` aparecia como
  "Nota"; agora mostra `Nota > Seção`, como no Obsidian.
- **O painel de tags contava tag que o texto não pintava.** A regra do `#`
  existe em três cópias (leitor, índice e host) e a do leitor tinha ficado só
  no espaço, ignorando `(` e `[`. As três voltaram a dizer a mesma coisa.
- **Ctrl+G e "recolher/expandir tudo" não faziam nada na edição ao vivo.** Os
  dois olhavam só para a trava, então no modo vivo mexiam num `textarea`
  escondido, com valor velho. Leitura e edição ao vivo desenham no mesmo lugar.
- **"Liberar edição" no menu de contexto travava quando já estava destravado.**
  O rótulo era fixo e mentia sobre o que o clique ia fazer.
- **Criar, renomear, mover, duplicar e apagar deixavam o índice para trás.** A
  árvore era redesenhada, mas Ctrl+P, o filtro por nome e o painel de tags
  continuavam oferecendo o nome antigo — e abrir esse item dava erro.
- **Fechar o filtro no meio da digitação prendia a lista.** O *debounce* de
  160 ms acordava depois, com a caixa já escondida, e filtrava assim mesmo.
  Valia para o filtro da árvore e para o de tags.
- **"Atualizar" recolhia a árvore inteira de brinde.** Quem clica ali quer ver
  o arquivo novo, não perder quatro níveis de pasta abertos — recolher já tem
  botão próprio.
- **A busca rápida descartava arquivo com pontuação legítima.** O `-1` que
  significava "não casou" colidia com nota negativa válida; virou sentinela
  própria.
- **Sublista de tarefa era desenhada à direita do pai, na mesma linha**, e o
  risco de uma tarefa concluída riscava junto as subtarefas ainda abertas.
- **"Restaurar o padrão" devolvia a barra de acesso rápido já estragada.** As
  configurações eram uma cópia rasa do padrão, e editar a barra mutava o
  próprio padrão.
- **A barra de acesso rápido saía na impressão**, junto com a paleta, os avisos
  e o véu dos diálogos.

### Alterado
- **A paleta de comandos dava um pulo ao terminar de abrir.** Ela emprestava a
  animação dos diálogos, que termina centrada nos dois eixos, enquanto a paleta
  só se centra na horizontal — no último quadro ela despencava meia altura.
- **O realce ao passar o mouse quase não aparecia no tema escuro** (6,7% de
  branco). Vale para a árvore, os menus, a paleta e mais 19 lugares que leem o
  mesmo token.
- **O painel lateral desliza em vez de sumir de uma vez**, e sai de verdade:
  fechado, o Tab não entra mais na caixa de busca dele.
- **Os interruptores respondem ao toque.** Eram o único controle do app sem
  resposta ao clique.
- **A pasta aberta na árvore ganhou ícone de pasta aberta** — o triângulo já
  dizia o estado e o ícone dizia o contrário dele.
- **Menu de formatação alcança bloco matemático, link interno e tag.** O leitor
  já entendia `$$…$$`, `[[…]]` e `#tag`; faltava caminho de mouse para quem não
  decorou a sintaxe.
- Empilhamento das camadas agora tem nomes (`--layer-*`) em vez de sete números
  soltos: um "salvo" no canto não tapa mais o menu que você acabou de abrir.
- A ponte deixou de chamar de `writeBytes` uma operação que escreve texto e só
  aceita `.html`; passou a `writeHtml`.
- Removidos tokens e um *keyframe* que nunca saíram da definição
  (`--anim-instant`, `--anim-slow`, `--anim-ease-in`, `slide-in-left`).

## [1.2.0] — 2026-08-21

### Corrigido
- **O painel de código não some mais quando deveria sumir.** `.editing-view`,
  `.reading-view` e `.preview-pane` declaravam `display: flex`, e isso ganha do
  `display: none` que o navegador dá para `[hidden]`. Resultado: o leitor e o
  editor ficavam lado a lado na mesma janela — o leitor espremido em meia tela
  (texto descentralizado) e o painel de código mostrando o documento da *outra*
  guia, porque ninguém o atualizava. Uma regra `[hidden] { display: none
  !important; }` no topo da folha mata a armadilha inteira, e não só nesses
  três: qualquer classe com `display` quebrava o `hidden` dela.

### Alterado
- **Um documento, um painel.** Os dois alternadores independentes do cabeçalho
  (`<>` e colunas) viraram **um modo só, com três valores exclusivos**:
  **Leitura**, **Edição ao vivo** e **Código-fonte**. É o mesmo par
  (travado, código) de antes — só que dito em voz alta, sem dois botões que
  podiam se contradizer.
- **O seletor de modo desceu para o rodapé**, como no Obsidian: longe do texto,
  perto do resto do estado do documento. É um segmentado com nome em cada
  opção; em janela estreita fica só o ícone.
- **No cabeçalho ficou uma bandeira**: um ícone que diz em que modo o documento
  está — livro (leitura), lápis (ao vivo), `<>` (fonte). Clicar abre o mesmo
  cardápio. Ela indica; quem troca é o rodapé.
- **A tela dividida virou opcional de verdade.** Deixou de ser o padrão
  (`sideReader`, novo e desligado) e só existe dentro do modo código-fonte, num
  botão próprio do rodapé (`Ctrl+Shift+L`). Abrir um arquivo agora dá uma
  coluna de texto centralizada, e não três painelões.
- `Ctrl+Shift+C` entra e sai do código-fonte vindo de qualquer modo — antes
  só funcionava com o giz já destravado.
- A pastilha de trava do rodapé saiu: dizia a mesma coisa que o seletor de modo
  agora diz melhor. O giz continua no canto superior direito, onde sempre esteve.

### Adicionado
- **Painel de tags**, a quarta aba da barra lateral. Junta as tags de todos
  os arquivos da pasta aberta — `#a/b` vira árvore, com contagem por nível
  — e sem pasta aberta ele conta as tags dos documentos abertos. Sem cofre:
  a pasta é só uma pasta, e fechar a janela não deixa índice nenhum para trás.
- Tags: filtro por nome dentro do próprio painel (`Esc` fecha e limpa), três
  ordens (mais usadas, A→Z, Z→A), clique busca a tag na pasta e o clique
  direito copia ou insere a tag no documento aberto.
- Ponte: `listTags` — a varredura acontece no C#, fora do fio da interface,
  com teto de arquivos e de tamanho; o painel só recebe a contagem pronta.
  Reconhece tag no texto e no frontmatter (`tags: a, b` e lista com `-`),
  ignorando bloco de código e código em linha.
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

[Não lançado]: https://github.com/NBN-PATRIC/markpad/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.2.0
[1.1.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.1.0
[1.0.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.0.0
