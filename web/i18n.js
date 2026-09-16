/**
 * Idiomas da interface.
 *
 * A chave de tradução é o próprio texto em português, não um identificador
 * (`t('Salvar como...')`, não `t('menu.saveAs')`). Duas razões: o código
 * continua legível — quem lê `t('Excluir arquivo?')` sabe o que aparece na
 * tela sem abrir outro arquivo — e o português nunca precisa de dicionário,
 * então não existe o modo de falha clássico do i18n, que é a tela mostrar
 * `menu.saveAs` porque alguém esqueceu de cadastrar a chave. Aqui o pior caso
 * é aparecer em português.
 *
 * O preço é que mudar o texto em português desliga a tradução daquela frase
 * silenciosamente. É o que `dev/test-i18n.js` vigia: toda chave do dicionário
 * tem que existir no código, senão o teste aponta a frase órfã.
 *
 * `{alvo}` no meio de uma frase é substituído por `t('...', { alvo: x })`, e
 * existe só onde a variável cai no meio — prefixo simples (`t('Salvo: ') + nome`)
 * não precisa disso.
 */
(function () {
  'use strict';

  var IDIOMAS = [
    { code: 'pt-BR', nome: 'Português (Brasil)' },
    { code: 'en', nome: 'English' },
    { code: 'es', nome: 'Español' }
  ];

  var EN = {
    // ------------------------------------------------------------- arquivo
    'Abrir': 'Open',
    'Abrir arquivo...': 'Open file...',
    'Abrir arquivo pelo nome...': 'Open file by name...',
    'Abrir pasta...': 'Open folder...',
    'Abrir a nota': 'Open the note',
    'Abrir no app padrao': 'Open in default app',
    'Abrir no app padrao do Windows': 'Open in the default Windows app',
    'Nova nota': 'New note',
    'Salvar': 'Save',
    'Salvar como...': 'Save as...',
    'Salvar e sair': 'Save and quit',
    'Sair sem salvar': 'Quit without saving',
    'Fechar': 'Close',
    'Fechar (Esc)': 'Close (Esc)',
    'Fechar aba': 'Close tab',
    'Fechar as outras': 'Close the others',
    'Fechar o MarkPad?': 'Quit MarkPad?',
    'Reabrir aba fechada': 'Reopen closed tab',
    'Renomear...': 'Rename...',
    'Mover para...': 'Move to...',
    'Duplicar': 'Duplicate',
    'Excluir': 'Delete',
    'Excluir arquivo?': 'Delete file?',
    'Excluir arquivo...': 'Delete file...',
    'Restaurar': 'Restore',
    'Descartar': 'Discard',
    'Cancelar': 'Cancel',
    'Sim': 'Yes',
    'Não': 'No',
    'Recarregar do disco': 'Reload from disk',
    'Mostrar no Explorer': 'Show in Explorer',
    'Copiar caminho': 'Copy path',
    'Copiar caminho do arquivo': 'Copy the file path',
    'Exportar como HTML...': 'Export as HTML...',
    'Imprimir': 'Print',
    'sem titulo': 'untitled',
    'sem titulo.md': 'untitled.md',

    // --------------------------------------------------------------- avisos
    'Salvo: ': 'Saved: ',
    'Recarregado do disco.': 'Reloaded from disk.',
    'Falha ao recarregar: ': 'Could not reload: ',
    'Falha ao renderizar: ': 'Could not render: ',
    'Falha ao exportar: ': 'Could not export: ',
    'Exportado para ': 'Exported to ',
    'Copia criada: ': 'Copy created: ',
    'Movido para ': 'Moved to ',
    'Agora se chama ': 'Now called ',
    'Foi para a Lixeira: ': 'Moved to the Recycle Bin: ',
    'Arquivo nao encontrado: ': 'File not found: ',
    'Nao consegui ': 'Could not ',
    'Nao consegui abrir: ': 'Could not open: ',
    'Nao consegui salvar: ': 'Could not save: ',
    'Nao consegui alterar: ': 'Could not change: ',
    'Nao consegui ler a pasta: ': 'Could not read the folder: ',
    'Busca falhou: ': 'Search failed: ',
    'Caminho copiado.': 'Path copied.',
    'Tag copiada.': 'Tag copied.',
    'Copiado': 'Copied',
    'Digite alguma coisa.': 'Type something.',
    'Nada para substituir.': 'Nothing to replace.',
    'Salve o documento antes de renomear.': 'Save the document before renaming it.',
    'Sem pasta de referencia para resolver o link.': 'No reference folder to resolve the link against.',
    'Sem barras — para trocar de pasta, use "Mover para...".':
      'No slashes — to change folders, use "Move to...".',
    'Texto restaurado. Salve com Ctrl+S para gravar no arquivo.':
      'Text restored. Press Ctrl+S to write it to the file.',
    'Atencao: o arquivo esta marcado como somente leitura no disco.':
      'Careful: the file is marked read-only on disk.',
    'Documento travado — nada foi alterado.': 'Document locked — nothing was changed.',
    'Travado. As alteracoes continuam por salvar (Ctrl+S).':
      'Locked. The changes are still unsaved (Ctrl+S).',
    'Nenhuma aba fechada para reabrir.': 'No closed tab to reopen.',
    'Nenhum arquivo com esse nome.': 'No file by that name.',
    'Nenhum comando com esse nome.': 'No command by that name.',
    'Nenhum arquivo da pasta aponta para este.': 'No file in the folder points here.',
    'Secao nao encontrada: ': 'Section not found: ',
    'Embed circular: ': 'Circular embed: ',
    'imagem nao encontrada: ': 'image not found: ',
    'ponte indisponivel': 'bridge unavailable',
    'Procurando...': 'Searching...',
    'e mais ': 'and ',
    'vazio': 'empty',
    'ativo': 'on',
    'mudou no disco': 'changed on disk',
    'somente leitura no disco': 'read-only on disk',
    'Alteracoes nao salvas': 'Unsaved changes',
    'Alterações não salvas da sessão anterior': 'Unsaved changes from the previous session',

    // ---------------------------------------------------------------- trava
    'A trava': 'The lock',
    'Trava': 'Lock',
    'Travar edicao': 'Lock editing',
    'Liberar': 'Unlock',
    'Liberar edicao': 'Unlock editing',
    'Liberar edicao?': 'Unlock editing?',
    'Edicao liberada — clique ou Ctrl+E para travar':
      'Editing unlocked — click or press Ctrl+E to lock',
    'Edicao travada — clique ou Ctrl+E para liberar':
      'Editing locked — click or press Ctrl+E to unlock',
    'Edicao travada. Ctrl+E para liberar.': 'Editing is locked. Press Ctrl+E to unlock.',
    'Destrave a edicao (Ctrl+E) para marcar': 'Unlock editing (Ctrl+E) to tick this',
    'Destrave a edicao para substituir.': 'Unlock editing to replace.',
    'Substituir (destrave para usar)': 'Replace (unlock to use)',
    'Abrir sempre travado': 'Always open locked',
    'Pedir confirmacao ao destravar': 'Ask before unlocking',
    'Novos arquivos abrirao travados.': 'New files will open locked.',
    'Novos arquivos abrirao destravados.': 'New files will open unlocked.',

    // ----------------------------------------------------------------- modos
    'Modo de exibicao': 'View mode',
    'Modo: leitura': 'Mode: reading',
    'Modo: edicao ao vivo': 'Mode: live editing',
    'Modo: codigo-fonte': 'Mode: source',
    'Leitura': 'Reading',
    'Edicao ao vivo': 'Live editing',
    'Codigo-fonte': 'Source',
    'Leitura ao lado do codigo': 'Reading beside the source',

    // ---------------------------------------------------------- busca/navegacao
    'Localizar': 'Find',
    'Localizar no documento': 'Find in the document',
    'Substituir no documento': 'Replace in the document',
    'Buscar na pasta': 'Search the folder',
    'Filtrar arquivos por nome': 'Filter files by name',
    'Filtrar comandos': 'Filter commands',
    'escolha um comando': 'pick a command',
    'Ir para a linha...': 'Go to line...',
    'Ir para a linha (1-{total}):': 'Go to line (1-{total}):',
    'Navegar': 'Navigate',
    'Ln ': 'Ln ',

    // ------------------------------------------------------------- estrutura
    'Recolher / expandir secao': 'Collapse / expand section',
    'Recolher todas as secoes': 'Collapse every section',
    'Expandir todas as secoes': 'Expand every section',
    'Recolher todas as pastas': 'Collapse every folder',
    'Ordenar por': 'Sort by',
    'Ordenar arquivos por...': 'Sort files by...',
    'Ordenar tags por...': 'Sort tags by...',
    'Nome (A → Z)': 'Name (A → Z)',
    'Nome (Z → A)': 'Name (Z → A)',
    'Mais usadas primeiro': 'Most used first',
    'Painel de arquivos': 'Files panel',
    'Painel lateral': 'Side panel',
    'Painel lateral visivel': 'Side panel visible',
    'Painel: só arquivos markdown': 'Panel: markdown files only',
    'Painel: tags': 'Panel: tags',
    'Mencoes ligadas': 'Linked mentions',
    'Propriedades': 'Properties',
    'Mostrar propriedades': 'Show properties',

    // ------------------------------------------------------------- formatacao
    'Formatar': 'Format',
    'Inserir': 'Insert',
    'Inserir no documento': 'Insert into the document',
    'Parágrafo': 'Paragraph',
    'Título 2': 'Heading 2',
    'Título 3': 'Heading 3',
    'Itálico': 'Italic',
    'Código': 'Code',
    'Bloco matemático': 'Math block',
    'Destaque (callout)': 'Callout',
    'Links': 'Links',
    'Documento': 'Document',
    'Copiar': 'Copy',
    'Copiar #': 'Copy #',
    'Recortar': 'Cut',
    'Colar': 'Paste',
    'Selecionar tudo': 'Select all',
    'Marcar ou desmarcar': 'Tick or untick',

    // ------------------------------------------------------- configuracoes
    'Configuracoes': 'Settings',
    'Configuracoes...': 'Settings...',
    'Configuracoes   Ctrl+,': 'Settings   Ctrl+,',
    'Restaurar o padrao': 'Restore the default',
    'Aparencia': 'Appearance',
    'Editor e trava': 'Editor and lock',
    'Arquivos': 'Files',
    'Barra rapida': 'Quick bar',
    'Atalhos': 'Shortcuts',
    'Atualizacoes': 'Updates',
    'Sobre': 'About',
    'Visual': 'Look',
    'Edicao': 'Editing',
    'Janela': 'Window',
    'Texto': 'Text',
    'Ao abrir': 'On open',

    // tema
    'Tema': 'Theme',
    'Tema da janela': 'Window theme',
    'O tema "sistema" segue a configuracao do Windows.':
      'The "system" theme follows the Windows setting.',
    'Alternar tema': 'Switch theme',
    'Escuro': 'Dark',
    'Claro': 'Light',
    'Sistema': 'System',
    'Paleta de cores...': 'Colour palette...',
    'Cor de destaque': 'Accent colour',
    'Vale sobre a cor da paleta. Muda o link, o foco e o realce da selecao.':
      'Overrides the palette colour. Changes links, focus and the selection highlight.',
    'Usar a da paleta': "Use the palette's",
    'Outra cor': 'Another colour',
    'Roxo': 'Purple',
    'Azul': 'Blue',
    'Verde': 'Green',
    'Laranja': 'Orange',
    'Vermelho': 'Red',
    'Rosa': 'Pink',
    'Ciano': 'Cyan',
    'Grafite': 'Graphite',
    'Tema do VS Code': 'VS Code theme',
    'Um arquivo .json de tema do VS Code vira paleta aqui. So as cores entram — o resto do arquivo e ignorado.':
      'A VS Code theme .json becomes a palette here. Only the colours are read — the rest of the file is ignored.',
    'Importar...': 'Import...',
    'Remover': 'Remove',
    'Tema "{nome}" importado.': 'Theme "{nome}" imported.',
    'Tema importado removido.': 'Imported theme removed.',
    'Nao deu para importar: ': 'Could not import: ',
    'Valendo agora: tema importado "{nome}".': 'In effect now: imported theme "{nome}".',
    'O tema importado "{nome}" e {modo} e esta fora do ar no modo atual.':
      'The imported theme "{nome}" is {modo} and is out of play in the current mode.',
    'escuro': 'dark',
    'claro': 'light',

    // idioma
    'Idioma': 'Language',
    'Idioma da interface': 'Interface language',
    'O idioma do documento nao muda — so os menus, avisos e configuracoes.':
      'The document\'s language does not change — only menus, notices and settings.',
    'Seguir o Windows': 'Follow Windows',

    // texto e janela
    'Tamanho da fonte de leitura': 'Reading font size',
    'Vale para o modo leitura e para o painel de leitura.':
      'Applies to reading mode and to the reading pane.',
    'Tamanho da fonte do editor': 'Editor font size',
    'Vale para o painel de codigo-fonte.': 'Applies to the source pane.',
    'Largura total da linha': 'Full line width',
    'Desligado, o texto fica numa coluna estreita, mais confortavel de ler.':
      'Off, the text sits in a narrow column, easier to read.',
    'Aumentar fonte': 'Increase font size',
    'Diminuir fonte': 'Decrease font size',
    'Fonte padrao': 'Default font size',
    'Animacoes': 'Animations',
    'Quebra automatica de linha': 'Word wrap',
    'Quebra: sim': 'Wrap: on',
    'Numeros de linha': 'Line numbers',
    'Salvar automaticamente': 'Save automatically',
    'Carregar imagens da internet': 'Load images from the internet',
    'Previa ao pairar o mouse': 'Preview on hover',
    'Pare o mouse sobre um link interno e a nota aparece num cartao.':
      'Rest the pointer on an internal link and the note appears in a card.',
    'Restaurar a sessao anterior': 'Restore the previous session',
    'Mostrar so arquivos markdown': 'Show markdown files only',
    'Arquivos .md': '.md files',
    'Pastas antes dos arquivos': 'Folders before files',
    'Avisar ao abrir arquivo nao-markdown': 'Warn when opening a non-markdown file',
    'Avisar ao abrir arquivo não-markdown': 'Warn when opening a non-markdown file',
    'Aviso desligado.': 'Warning turned off.',
    'O aviso volta a aparecer.': 'The warning comes back.',
    'Arquivo não identificado como markdown': 'File not recognised as markdown',
    'Pasta de dados': 'Data folder',

    // barra rapida
    'A barra': 'The bar',
    'Botoes': 'Buttons',
    'Barra de acesso rapido': 'Quick access bar',
    'A fileira de botoes abaixo das abas.': 'The row of buttons below the tabs.',
    'Mostrar a barra de acesso rapido': 'Show the quick access bar',
    'Ocultar a barra': 'Hide the bar',
    'Configurar a barra...': 'Configure the bar...',
    'Adicionar um botao': 'Add a button',
    'Mostrar os rotulos': 'Show the labels',
    'Mostrar rotulos': 'Show labels',
    'A barra esta vazia. Escolha um comando abaixo para comecar.':
      'The bar is empty. Pick a command below to start.',
    'sem atalho': 'no shortcut',

    // ------------------------------------------------------------ associacao
    'Windows': 'Windows',
    'Abrir arquivos .md com o MarkPad': 'Open .md files with MarkPad',
    'Registrar e definir padrão': 'Register and set as default',
    'Só registrar': 'Just register',
    'Registrado. O MarkPad já aparece em "Abrir com".':
      'Registered. MarkPad now shows up under "Open with".',
    'Registrado, mas o padrão não mudou — a escolha foi cancelada.':
      'Registered, but the default did not change — the choice was cancelled.',
    'Pronto. Arquivos .md agora abrem no MarkPad.': 'Done. .md files now open in MarkPad.',
    'O MarkPad e o aplicativo padrao para .md.': 'MarkPad is the default app for .md files.',
    'Remover associacao?': 'Remove the association?',
    'Associacao removida.': 'Association removed.',

    // ---------------------------------------------------------- atualizacao
    'Atualizacao automatica': 'Automatic updates',
    'Procurar atualizacoes ao abrir': 'Check for updates on start',
    'Procurar': 'Check',
    'Procurar agora': 'Check now',
    'Ver as versoes': 'See the releases',
    'Instalacao': 'Installation',
    'Instalar agora': 'Install now',
    'Download pronto': 'Download ready',
    'Baixando MarkPad ': 'Downloading MarkPad ',
    'O MarkPad ja esta na versao mais nova.': 'MarkPad is already on the newest version.',
    'Nao deu para consultar as versoes agora.': 'Could not check the releases right now.',
    'Nao deu para baixar a atualizacao: ': 'Could not download the update: ',
    'Nao deu para iniciar a instalacao: ': 'Could not start the install: ',
    'A atualizacao entra na proxima vez que o MarkPad abrir.':
      'The update lands the next time MarkPad opens.',
    'O MarkPad fecha, instala e abre de novo — leva alguns segundos. ':
      'MarkPad closes, installs and comes back — it takes a few seconds. ',
    'Esta versao nao publicou a soma de conferencia do instalador, ':
      'This release did not publish the installer checksum, ',
    'Esta e a versao portatil: baixe o novo .zip e substitua a pasta.':
      'This is the portable build: download the new .zip and replace the folder.',
    'Modo portatil. ': 'Portable mode. ',
    'Versao': 'Version',
    'Versao instalada': 'Installed version',
    'Voce esta na ': 'You are on ',
    'Sera gravado em ': 'It will be written to ',

    // --------------------------------------------------------------- sobre
    'Leitor e editor de Markdown para Windows. Sem cofre, sem projeto, sem cerimonia: ':
      'A Markdown reader and editor for Windows. No vault, no project, no ceremony: ',
    'Licenca': 'Licence',
    'Relatar um problema': 'Report a problem',
    'Diagnostico': 'Diagnostics',
    'Ferramentas do desenvolvedor': 'Developer tools',

    // ------------------------------------------- descricoes das configuracoes
    'Ctrl+\\ tambem alterna.': 'Ctrl+\\ toggles it too.',
    'Alt+Z tambem alterna.': 'Alt+Z toggles it too.',
    'A ficha com o bloco --- do topo do documento, no modo leitura.':
      'The card with the --- block from the top of the document, in reading mode.',
    'No fim da leitura: quem, na pasta aberta, aponta para este documento.':
      'At the end of reading: who, in the open folder, points at this document.',
    'Desligue para uma interface instantanea, sem transicoes.':
      'Turn off for an instant interface, with no transitions.',
    'O jeito seguro: nenhum arquivo abre em modo de edicao.':
      'The safe way: no file opens in editing mode.',
    'Uma pergunta a mais antes de liberar a edicao.':
      'One more question before unlocking editing.',
    'Grava sozinho pouco depois de voce parar de digitar.':
      'Writes by itself shortly after you stop typing.',
    'Na margem do painel de codigo-fonte.': 'In the margin of the source pane.',
    'Desligado, a arvore lista todos os arquivos da pasta.':
      'Off, the tree lists every file in the folder.',
    'Vale para a arvore inteira. Tambem esta no botao de ordenar do painel.':
      'Applies to the whole tree. It is also on the panel\'s sort button.',
    'Desligado, pastas e arquivos entram na mesma ordenacao.':
      'Off, folders and files go into the same sort.',
    'A confirmacao antes de abrir algo que nao parece markdown.':
      'The confirmation before opening something that does not look like markdown.',
    'Reabre as abas e a pasta que estavam abertas.':
      'Reopens the tabs and the folder that were open.',
    'Desligado, so imagens do proprio disco aparecem. Mais privado.':
      'Off, only images from your own disk show up. More private.',
    'Com o nome ao lado do icone, a barra fica mais larga.':
      'With the name beside the icon, the bar gets wider.',
    'Volta a barra para os sete botoes originais.':
      'Puts the bar back to the original seven buttons.',
    'Abre a pagina de issues do repositorio.': 'Opens the repository issues page.',
    'Console do WebView2, para investigar um erro.':
      'The WebView2 console, to dig into an error.',
    'Consulta as versoes publicadas no GitHub uma vez por dia, quando o MarkPad inicia. ':
      'Checks the releases published on GitHub once a day, when MarkPad starts. ',
    'Nada e baixado sem voce mandar.': 'Nothing is downloaded unless you say so.',
    'Ultima consulta: ': 'Last check: ',
    'Ainda nao foi consultado nesta instalacao.': 'Not checked yet on this install.',

    // ------------------------------------------------------- arvore e tags
    'Abra uma pasta para procurar por nome.': 'Open a folder to search by name.',
    'Pasta vazia.': 'Empty folder.',
    'Nenhum arquivo .md aqui. Toque no filtro acima para ver todos.':
      'No .md file here. Tap the filter above to see them all.',
    'nenhuma pasta aberta': 'no folder open',
    'Nenhuma tag com esse nome.': 'No tag by that name.',
    'Nenhuma tag nos arquivos desta pasta.': 'No tag in this folder\'s files.',
    'Nenhuma tag nos documentos abertos. Abra uma pasta para varrer o disco.':
      'No tag in the open documents. Open a folder to sweep the disk.',
    'Mostrando só markdown — clique para ver todos os arquivos':
      'Showing markdown only — click to see every file',
    'Mostrando todos os arquivos — clique para ver só markdown':
      'Showing every file — click to see markdown only',
    'Nome (A a Z)': 'Name (A to Z)',
    'Nome (Z a A)': 'Name (Z to A)',
    'Criado (recente primeiro)': 'Created (newest first)',
    'Criado (antigo primeiro)': 'Created (oldest first)',
    'Modificado (recente primeiro)': 'Modified (newest first)',
    'Modificado (antigo primeiro)': 'Modified (oldest first)',
    'Tirar da barra': 'Remove from the bar',
    'Buscar no documento': 'Search the document',

    // ------------------------------------------------------------- dialogos
    'Renomear arquivo': 'Rename file',
    'Renomear': 'Rename',
    'Ele continua na mesma pasta.': 'It stays in the same folder.',
    'Digite um nome.': 'Type a name.',
    'O Windows nao aceita estes: < > : " | ? *':
      'Windows does not accept these: < > : " | ? *',
    'Não exibir esta mensagem novamente': 'Do not show this message again',
    'Salvamento automatico ligado.': 'Automatic saving on.',
    'Salvamento automatico desligado.': 'Automatic saving off.',
    'Quebra: nao': 'Wrap: off',
    'nao salvo': 'unsaved',
    'Modo: ': 'Mode: ',
    'falha desconhecida': 'unknown failure',
    'Nao consegui ler: ': 'Could not read: ',
    'abrir no app padrao': 'open in the default app',
    'O arquivo <strong>{nome}</strong> tem mudancas que ainda nao foram gravadas.':
      'The file {nome} has changes that have not been written yet.',
    'O documento <strong>{nome}</strong> passara a aceitar digitacao.':
      'The document {nome} will start accepting typing.',
    'O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows.':
      'The file <strong>{nome}</strong> goes to the Windows Recycle Bin.',
    'O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows, e as alteracoes que ainda nao foram salvas se perdem junto.':
      'The file <strong>{nome}</strong> goes to the Windows Recycle Bin, and the changes that have not been saved go with it.',
    '<strong>{nome}</strong> tem extensão <code>.{ext}</code>, que não é markdown.':
      '<strong>{nome}</strong> has the extension <code>.{ext}</code>, which is not markdown.',
    '<strong>{nome}</strong> não tem extensão.': '<strong>{nome}</strong> has no extension.',
    'Ele será aberto como texto puro. Deseja mesmo abrir?':
      'It will be opened as plain text. Open it anyway?',
    'Ha alteracoes nao salvas em: <strong>{nomes}</strong>.': 'There are unsaved changes in: {nomes}.',
    'O MarkPad guardou o texto de <strong>{nomes}</strong> que não chegou a ser gravado.':
      'MarkPad kept the text of {nomes} that never got written.',
    'O arquivo em disco continua intacto. Se restaurar, o texto volta como estava ':
      'The file on disk is untouched. If you restore, the text comes back as it was ',
    'e você decide se salva por cima.': 'and you decide whether to save over it.',
    'O MarkPad entrará na lista de aplicativos para <strong>.md</strong>, ':
      'MarkPad will join the app list for <strong>.md</strong>, ',
    'ele mostra uma caixa de escolha. Nenhum programa pode fazer isso sozinho.':
      'it shows a chooser. No program can do that on its own.',
    'O MarkPad sairá da lista de aplicativos para arquivos <strong>.md</strong>.':
      'MarkPad will leave the app list for <strong>.md</strong> files.',
    'O MarkPad ainda nao esta registrado para .md.':
      'MarkPad is not registered for .md yet.',
    'O MarkPad aparece em "Abrir com". Ainda nao e o padrao.':
      'MarkPad shows up under "Open with". It is not the default yet.',
    'Definir o MarkPad como padrao de .md': 'Make MarkPad the default for .md',
    'Remover o MarkPad como padrao de .md': 'Stop MarkPad being the default for .md',
    'Tornar padrao': 'Make default',

    // ------------------------------------------------------ embeds e leitura
    'Arquivo grande demais para embutir.': 'File too large to embed.',
    'Embeds fundos demais; este ficou como link.':
      'Embeds nested too deep; this one stayed a link.',
    'Caminho absoluto nao se embute sozinho — clique no link para abrir.':
      'An absolute path does not embed by itself — click the link to open it.',
    'So notas de texto se embutem: ': 'Only text notes embed: ',
    'markdown cru, com numeros de linha': 'raw markdown, with line numbers',
    'edita no proprio leitor, sem ver o codigo': 'edit in the reader itself, without seeing the code',
    'o giz esta travado, a tecla nao escreve': 'the chalk is locked, the key does not write',

    // --------------------------------------------------- atualizacao (texto)
    'Baixando agora...': 'Downloading now...',
    'Na proxima vez': 'Next time',
    'Reiniciar agora': 'Restart now',
    'Abrir a pagina': 'Open the page',
    'Ver as notas': 'See the notes',
    'Ja baixado e conferido. Entra sozinho na proxima vez que o MarkPad abrir, ':
      'Downloaded and checked. It lands by itself the next time MarkPad opens, ',
    'ou agora, se voce mandar.': 'or now, if you say so.',
    'Se preferir, a troca acontece sozinha na proxima vez que voce abrir.':
      'If you prefer, the swap happens by itself the next time you open it.',
    'entao o download automatico fica de fora. Baixe pela pagina.':
      'so the automatic download is out. Download it from the page.',
    'MarkPad {versao} ja esta baixada.': 'MarkPad {versao} is already downloaded.',
    'MarkPad {versao} esta disponivel.': 'MarkPad {versao} is available.',
    'MarkPad {versao} disponivel': 'MarkPad {versao} available',
    'MarkPad {versao} pronta para instalar': 'MarkPad {versao} ready to install',
    '{arquivo} foi atualizado no disco.': '{arquivo} was updated on disk.',

    // ----------------------------------------------------------- sobre (texto)
    'abre um arquivo e pronto. Todo arquivo abre travado — no estado travado nao existe campo de ':
      'open a file and that is it. Every file opens locked — in the locked state there is no text ',
    'texto na tela, entao nao ha tecla que edite, apague ou digite nada.':
      'field on screen, so no key can edit, delete or type anything.',

    // ------------------------------------------------------- fim de linha
    'Windows (CRLF)': 'Windows (CRLF)',
    'Unix (LF)': 'Unix (LF)',

    // --------------------------------------------- marcacao estatica (index)
    'Painel lateral (Ctrl+\\)': 'Side panel (Ctrl+\\)',
    'Nova nota (Ctrl+N)': 'New note (Ctrl+N)',
    'Paleta de comandos (Ctrl+Shift+P)': 'Command palette (Ctrl+Shift+P)',
    'Buscar na pasta (Ctrl+Shift+F)': 'Search the folder (Ctrl+Shift+F)',
    'Sumario': 'Outline',
    'Tags': 'Tags',
    'Recentes': 'Recent',
    'Abertos recentemente': 'Recently opened',
    'Alternar entre só markdown e todos os arquivos':
      'Switch between markdown only and every file',
    'Filtrar por nome': 'Filter by name',
    'filtrar por nome': 'filter by name',
    'filtrar tags': 'filter tags',
    'Ordenar': 'Sort',
    'Recolher tudo': 'Collapse everything',
    'Abrir pasta (Ctrl+Shift+O)': 'Open folder (Ctrl+Shift+O)',
    'Abrir pasta': 'Open folder',
    'Abrir arquivo': 'Open file',
    'Abrir arquivo pelo nome': 'Open file by name',
    'Atualizar': 'Refresh',
    'Limpar lista': 'Clear the list',
    'Abra uma pasta para navegar pelos arquivos.': 'Open a folder to browse the files.',
    'Nao precisa de cofre.': 'No vault needed.',
    'Digite para buscar em todos os arquivos da pasta.':
      'Type to search every file in the folder.',
    'Os titulos do documento aparecem aqui.': 'The document headings show up here.',
    'As tags dos documentos aparecem aqui.': 'The documents\' tags show up here.',
    'Nada por aqui ainda.': 'Nothing here yet.',
    'texto ou expressao regular': 'text or regular expression',
    'Diferenciar maiusculas': 'Match case',
    'Expressao regular': 'Regular expression',
    'Digite um comando': 'Type a command',
    'alteracoes nao salvas': 'unsaved changes',
    'Modo de exibição': 'View mode',
    'Localizar (Ctrl+F)': 'Find (Ctrl+F)',
    'Mais opcoes': 'More options',
    'Travado': 'Locked',
    'localizar': 'find',
    'Substituir': 'Replace',
    'Trocar': 'Replace',
    'Trocar tudo': 'Replace all',
    'Proximo (Enter)': 'Next (Enter)',
    'Anterior (Shift+Enter)': 'Previous (Shift+Enter)',
    'Fechar aviso': 'Dismiss',
    'Agora nao': 'Not now',
    'Arraste arquivos para esta janela': 'Drag files onto this window',
    'Leitura — o giz trava a edição (Ctrl+E)':
      'Reading — the chalk locks editing (Ctrl+E)',
    'Edição ao vivo — edita no próprio leitor':
      'Live editing — edit in the reader itself',
    'Código-fonte — markdown cru (Ctrl+Shift+C)': 'Source — raw markdown (Ctrl+Shift+C)',
    'Leitura ao lado do código (Ctrl+Shift+L)': 'Reading beside the source (Ctrl+Shift+L)',
    'Ao vivo': 'Live',
    'Quebra de linha (Alt+Z)': 'Word wrap (Alt+Z)',
    'Zoom (Ctrl + / Ctrl -)': 'Zoom (Ctrl + / Ctrl -)',
    'Codificacao': 'Encoding',
    'Fim de linha': 'Line ending',
    'Fonte': 'Font',
    'abrir ·': 'open ·',
    'salvar ·': 'save ·',
    'destrava e trava a edicao': 'unlocks and locks editing',
    'abra um arquivo e pronto.': 'open a file and that is it.',
    'Leitor e editor de Markdown. Sem cofre, sem projeto, sem cerimonia:':
      'A Markdown reader and editor. No vault, no project, no ceremony:'
  };

  var ES = {
    'Abrir': 'Abrir',
    'Abrir arquivo...': 'Abrir archivo...',
    'Abrir arquivo pelo nome...': 'Abrir archivo por nombre...',
    'Abrir pasta...': 'Abrir carpeta...',
    'Abrir a nota': 'Abrir la nota',
    'Abrir no app padrao': 'Abrir en la app predeterminada',
    'Abrir no app padrao do Windows': 'Abrir en la app predeterminada de Windows',
    'Nova nota': 'Nota nueva',
    'Salvar': 'Guardar',
    'Salvar como...': 'Guardar como...',
    'Salvar e sair': 'Guardar y salir',
    'Sair sem salvar': 'Salir sin guardar',
    'Fechar': 'Cerrar',
    'Fechar (Esc)': 'Cerrar (Esc)',
    'Fechar aba': 'Cerrar pestaña',
    'Fechar as outras': 'Cerrar las demás',
    'Fechar o MarkPad?': '¿Cerrar MarkPad?',
    'Reabrir aba fechada': 'Reabrir pestaña cerrada',
    'Renomear...': 'Renombrar...',
    'Mover para...': 'Mover a...',
    'Duplicar': 'Duplicar',
    'Excluir': 'Eliminar',
    'Excluir arquivo?': '¿Eliminar el archivo?',
    'Excluir arquivo...': 'Eliminar archivo...',
    'Restaurar': 'Restaurar',
    'Descartar': 'Descartar',
    'Cancelar': 'Cancelar',
    'Sim': 'Sí',
    'Não': 'No',
    'Recarregar do disco': 'Recargar desde el disco',
    'Mostrar no Explorer': 'Mostrar en el Explorador',
    'Copiar caminho': 'Copiar la ruta',
    'Copiar caminho do arquivo': 'Copiar la ruta del archivo',
    'Exportar como HTML...': 'Exportar como HTML...',
    'Imprimir': 'Imprimir',
    'sem titulo': 'sin título',
    'sem titulo.md': 'sin-titulo.md',

    'Salvo: ': 'Guardado: ',
    'Recarregado do disco.': 'Recargado desde el disco.',
    'Falha ao recarregar: ': 'No se pudo recargar: ',
    'Falha ao renderizar: ': 'No se pudo renderizar: ',
    'Falha ao exportar: ': 'No se pudo exportar: ',
    'Exportado para ': 'Exportado a ',
    'Copia criada: ': 'Copia creada: ',
    'Movido para ': 'Movido a ',
    'Agora se chama ': 'Ahora se llama ',
    'Foi para a Lixeira: ': 'Fue a la Papelera: ',
    'Arquivo nao encontrado: ': 'Archivo no encontrado: ',
    'Nao consegui ': 'No pude ',
    'Nao consegui abrir: ': 'No pude abrir: ',
    'Nao consegui salvar: ': 'No pude guardar: ',
    'Nao consegui alterar: ': 'No pude cambiar: ',
    'Nao consegui ler a pasta: ': 'No pude leer la carpeta: ',
    'Busca falhou: ': 'La búsqueda falló: ',
    'Caminho copiado.': 'Ruta copiada.',
    'Tag copiada.': 'Etiqueta copiada.',
    'Copiado': 'Copiado',
    'Digite alguma coisa.': 'Escriba algo.',
    'Nada para substituir.': 'Nada que reemplazar.',
    'Salve o documento antes de renomear.': 'Guarde el documento antes de renombrarlo.',
    'Sem pasta de referencia para resolver o link.':
      'No hay carpeta de referencia para resolver el enlace.',
    'Sem barras — para trocar de pasta, use "Mover para...".':
      'Sin barras — para cambiar de carpeta, use "Mover a...".',
    'Texto restaurado. Salve com Ctrl+S para gravar no arquivo.':
      'Texto restaurado. Guarde con Ctrl+S para escribirlo en el archivo.',
    'Atencao: o arquivo esta marcado como somente leitura no disco.':
      'Atención: el archivo está marcado como solo lectura en el disco.',
    'Documento travado — nada foi alterado.': 'Documento bloqueado — no se cambió nada.',
    'Travado. As alteracoes continuam por salvar (Ctrl+S).':
      'Bloqueado. Los cambios siguen sin guardarse (Ctrl+S).',
    'Nenhuma aba fechada para reabrir.': 'No hay pestaña cerrada para reabrir.',
    'Nenhum arquivo com esse nome.': 'Ningún archivo con ese nombre.',
    'Nenhum comando com esse nome.': 'Ningún comando con ese nombre.',
    'Nenhum arquivo da pasta aponta para este.':
      'Ningún archivo de la carpeta apunta a este.',
    'Secao nao encontrada: ': 'Sección no encontrada: ',
    'Embed circular: ': 'Inclusión circular: ',
    'imagem nao encontrada: ': 'imagen no encontrada: ',
    'ponte indisponivel': 'puente no disponible',
    'Procurando...': 'Buscando...',
    'e mais ': 'y ',
    'vazio': 'vacío',
    'ativo': 'activo',
    'mudou no disco': 'cambió en el disco',
    'somente leitura no disco': 'solo lectura en el disco',
    'Alteracoes nao salvas': 'Cambios sin guardar',
    'Alterações não salvas da sessão anterior': 'Cambios sin guardar de la sesión anterior',

    'A trava': 'El bloqueo',
    'Trava': 'Bloqueo',
    'Travar edicao': 'Bloquear la edición',
    'Liberar': 'Desbloquear',
    'Liberar edicao': 'Desbloquear la edición',
    'Liberar edicao?': '¿Desbloquear la edición?',
    'Edicao liberada — clique ou Ctrl+E para travar':
      'Edición desbloqueada — haga clic o Ctrl+E para bloquear',
    'Edicao travada — clique ou Ctrl+E para liberar':
      'Edición bloqueada — haga clic o Ctrl+E para desbloquear',
    'Edicao travada. Ctrl+E para liberar.': 'La edición está bloqueada. Ctrl+E para desbloquear.',
    'Destrave a edicao (Ctrl+E) para marcar': 'Desbloquee la edición (Ctrl+E) para marcar',
    'Destrave a edicao para substituir.': 'Desbloquee la edición para reemplazar.',
    'Substituir (destrave para usar)': 'Reemplazar (desbloquee para usar)',
    'Abrir sempre travado': 'Abrir siempre bloqueado',
    'Pedir confirmacao ao destravar': 'Pedir confirmación al desbloquear',
    'Novos arquivos abrirao travados.': 'Los archivos nuevos abrirán bloqueados.',
    'Novos arquivos abrirao destravados.': 'Los archivos nuevos abrirán desbloqueados.',

    'Modo de exibicao': 'Modo de vista',
    'Modo: leitura': 'Modo: lectura',
    'Modo: edicao ao vivo': 'Modo: edición en vivo',
    'Modo: codigo-fonte': 'Modo: código fuente',
    'Leitura': 'Lectura',
    'Edicao ao vivo': 'Edición en vivo',
    'Codigo-fonte': 'Código fuente',
    'Leitura ao lado do codigo': 'Lectura junto al código',

    'Localizar': 'Buscar',
    'Localizar no documento': 'Buscar en el documento',
    'Substituir no documento': 'Reemplazar en el documento',
    'Buscar na pasta': 'Buscar en la carpeta',
    'Filtrar arquivos por nome': 'Filtrar archivos por nombre',
    'Filtrar comandos': 'Filtrar comandos',
    'escolha um comando': 'elija un comando',
    'Ir para a linha...': 'Ir a la línea...',
    'Ir para a linha (1-{total}):': 'Ir a la línea (1-{total}):',
    'Navegar': 'Navegar',
    'Ln ': 'Lín ',

    'Recolher / expandir secao': 'Plegar / desplegar la sección',
    'Recolher todas as secoes': 'Plegar todas las secciones',
    'Expandir todas as secoes': 'Desplegar todas las secciones',
    'Recolher todas as pastas': 'Plegar todas las carpetas',
    'Ordenar por': 'Ordenar por',
    'Ordenar arquivos por...': 'Ordenar archivos por...',
    'Ordenar tags por...': 'Ordenar etiquetas por...',
    'Nome (A → Z)': 'Nombre (A → Z)',
    'Nome (Z → A)': 'Nombre (Z → A)',
    'Mais usadas primeiro': 'Más usadas primero',
    'Painel de arquivos': 'Panel de archivos',
    'Painel lateral': 'Panel lateral',
    'Painel lateral visivel': 'Panel lateral visible',
    'Painel: só arquivos markdown': 'Panel: solo archivos markdown',
    'Painel: tags': 'Panel: etiquetas',
    'Mencoes ligadas': 'Menciones enlazadas',
    'Propriedades': 'Propiedades',
    'Mostrar propriedades': 'Mostrar las propiedades',

    'Formatar': 'Formato',
    'Inserir': 'Insertar',
    'Inserir no documento': 'Insertar en el documento',
    'Parágrafo': 'Párrafo',
    'Título 2': 'Título 2',
    'Título 3': 'Título 3',
    'Itálico': 'Cursiva',
    'Código': 'Código',
    'Bloco matemático': 'Bloque matemático',
    'Destaque (callout)': 'Destacado (callout)',
    'Links': 'Enlaces',
    'Documento': 'Documento',
    'Copiar': 'Copiar',
    'Copiar #': 'Copiar #',
    'Recortar': 'Cortar',
    'Colar': 'Pegar',
    'Selecionar tudo': 'Seleccionar todo',
    'Marcar ou desmarcar': 'Marcar o desmarcar',

    'Configuracoes': 'Configuración',
    'Configuracoes...': 'Configuración...',
    'Configuracoes   Ctrl+,': 'Configuración   Ctrl+,',
    'Restaurar o padrao': 'Restaurar lo predeterminado',
    'Aparencia': 'Apariencia',
    'Editor e trava': 'Editor y bloqueo',
    'Arquivos': 'Archivos',
    'Barra rapida': 'Barra rápida',
    'Atalhos': 'Atajos',
    'Atualizacoes': 'Actualizaciones',
    'Sobre': 'Acerca de',
    'Visual': 'Aspecto',
    'Edicao': 'Edición',
    'Janela': 'Ventana',
    'Texto': 'Texto',
    'Ao abrir': 'Al abrir',

    'Tema': 'Tema',
    'Tema da janela': 'Tema de la ventana',
    'O tema "sistema" segue a configuracao do Windows.':
      'El tema "sistema" sigue la configuración de Windows.',
    'Alternar tema': 'Cambiar de tema',
    'Escuro': 'Oscuro',
    'Claro': 'Claro',
    'Sistema': 'Sistema',
    'Paleta de cores...': 'Paleta de colores...',
    'Cor de destaque': 'Color de acento',
    'Vale sobre a cor da paleta. Muda o link, o foco e o realce da selecao.':
      'Manda sobre el color de la paleta. Cambia el enlace, el foco y el resalte de la selección.',
    'Usar a da paleta': 'Usar el de la paleta',
    'Outra cor': 'Otro color',
    'Roxo': 'Morado',
    'Azul': 'Azul',
    'Verde': 'Verde',
    'Laranja': 'Naranja',
    'Vermelho': 'Rojo',
    'Rosa': 'Rosa',
    'Ciano': 'Cian',
    'Grafite': 'Grafito',
    'Tema do VS Code': 'Tema de VS Code',
    'Um arquivo .json de tema do VS Code vira paleta aqui. So as cores entram — o resto do arquivo e ignorado.':
      'Un .json de tema de VS Code se vuelve paleta aquí. Solo entran los colores — el resto del archivo se ignora.',
    'Importar...': 'Importar...',
    'Remover': 'Quitar',
    'Tema "{nome}" importado.': 'Tema "{nome}" importado.',
    'Tema importado removido.': 'Tema importado quitado.',
    'Nao deu para importar: ': 'No se pudo importar: ',
    'Valendo agora: tema importado "{nome}".': 'En uso ahora: tema importado "{nome}".',
    'O tema importado "{nome}" e {modo} e esta fora do ar no modo atual.':
      'El tema importado "{nome}" es {modo} y está fuera de juego en el modo actual.',
    'escuro': 'oscuro',
    'claro': 'claro',

    'Idioma': 'Idioma',
    'Idioma da interface': 'Idioma de la interfaz',
    'O idioma do documento nao muda — so os menus, avisos e configuracoes.':
      'El idioma del documento no cambia — solo los menús, avisos y la configuración.',
    'Seguir o Windows': 'Seguir a Windows',

    'Tamanho da fonte de leitura': 'Tamaño de letra de lectura',
    'Vale para o modo leitura e para o painel de leitura.':
      'Vale para el modo lectura y para el panel de lectura.',
    'Tamanho da fonte do editor': 'Tamaño de letra del editor',
    'Vale para o painel de codigo-fonte.': 'Vale para el panel de código fuente.',
    'Largura total da linha': 'Ancho completo de línea',
    'Desligado, o texto fica numa coluna estreita, mais confortavel de ler.':
      'Apagado, el texto queda en una columna estrecha, más cómoda de leer.',
    'Aumentar fonte': 'Aumentar la letra',
    'Diminuir fonte': 'Reducir la letra',
    'Fonte padrao': 'Letra predeterminada',
    'Animacoes': 'Animaciones',
    'Quebra automatica de linha': 'Ajuste de línea',
    'Quebra: sim': 'Ajuste: sí',
    'Numeros de linha': 'Números de línea',
    'Salvar automaticamente': 'Guardar automáticamente',
    'Carregar imagens da internet': 'Cargar imágenes de internet',
    'Previa ao pairar o mouse': 'Vista previa al pasar el ratón',
    'Pare o mouse sobre um link interno e a nota aparece num cartao.':
      'Deje el ratón sobre un enlace interno y la nota aparece en una tarjeta.',
    'Restaurar a sessao anterior': 'Restaurar la sesión anterior',
    'Mostrar so arquivos markdown': 'Mostrar solo archivos markdown',
    'Arquivos .md': 'Archivos .md',
    'Pastas antes dos arquivos': 'Carpetas antes que archivos',
    'Avisar ao abrir arquivo nao-markdown': 'Avisar al abrir un archivo no markdown',
    'Avisar ao abrir arquivo não-markdown': 'Avisar al abrir un archivo no markdown',
    'Aviso desligado.': 'Aviso desactivado.',
    'O aviso volta a aparecer.': 'El aviso vuelve a aparecer.',
    'Arquivo não identificado como markdown': 'Archivo no identificado como markdown',
    'Pasta de dados': 'Carpeta de datos',

    'A barra': 'La barra',
    'Botoes': 'Botones',
    'Barra de acesso rapido': 'Barra de acceso rápido',
    'A fileira de botoes abaixo das abas.': 'La fila de botones debajo de las pestañas.',
    'Mostrar a barra de acesso rapido': 'Mostrar la barra de acceso rápido',
    'Ocultar a barra': 'Ocultar la barra',
    'Configurar a barra...': 'Configurar la barra...',
    'Adicionar um botao': 'Agregar un botón',
    'Mostrar os rotulos': 'Mostrar las etiquetas',
    'Mostrar rotulos': 'Mostrar etiquetas',
    'A barra esta vazia. Escolha um comando abaixo para comecar.':
      'La barra está vacía. Elija un comando abajo para empezar.',
    'sem atalho': 'sin atajo',

    'Windows': 'Windows',
    'Abrir arquivos .md com o MarkPad': 'Abrir archivos .md con MarkPad',
    'Registrar e definir padrão': 'Registrar y poner como predeterminado',
    'Só registrar': 'Solo registrar',
    'Registrado. O MarkPad já aparece em "Abrir com".':
      'Registrado. MarkPad ya aparece en "Abrir con".',
    'Registrado, mas o padrão não mudou — a escolha foi cancelada.':
      'Registrado, pero lo predeterminado no cambió — se canceló la elección.',
    'Pronto. Arquivos .md agora abrem no MarkPad.':
      'Listo. Los archivos .md ahora abren en MarkPad.',
    'O MarkPad e o aplicativo padrao para .md.':
      'MarkPad es la aplicación predeterminada para .md.',
    'Remover associacao?': '¿Quitar la asociación?',
    'Associacao removida.': 'Asociación quitada.',

    'Atualizacao automatica': 'Actualización automática',
    'Procurar atualizacoes ao abrir': 'Buscar actualizaciones al abrir',
    'Procurar': 'Buscar',
    'Procurar agora': 'Buscar ahora',
    'Ver as versoes': 'Ver las versiones',
    'Instalacao': 'Instalación',
    'Instalar agora': 'Instalar ahora',
    'Download pronto': 'Descarga lista',
    'Baixando MarkPad ': 'Descargando MarkPad ',
    'O MarkPad ja esta na versao mais nova.': 'MarkPad ya está en la versión más nueva.',
    'Nao deu para consultar as versoes agora.':
      'No se pudo consultar las versiones ahora.',
    'Nao deu para baixar a atualizacao: ': 'No se pudo descargar la actualización: ',
    'Nao deu para iniciar a instalacao: ': 'No se pudo iniciar la instalación: ',
    'A atualizacao entra na proxima vez que o MarkPad abrir.':
      'La actualización entra la próxima vez que MarkPad abra.',
    'O MarkPad fecha, instala e abre de novo — leva alguns segundos. ':
      'MarkPad se cierra, instala y vuelve — tarda unos segundos. ',
    'Esta versao nao publicou a soma de conferencia do instalador, ':
      'Esta versión no publicó la suma de verificación del instalador, ',
    'Esta e a versao portatil: baixe o novo .zip e substitua a pasta.':
      'Esta es la versión portátil: descargue el nuevo .zip y reemplace la carpeta.',
    'Modo portatil. ': 'Modo portátil. ',
    'Versao': 'Versión',
    'Versao instalada': 'Versión instalada',
    'Voce esta na ': 'Usted está en la ',
    'Sera gravado em ': 'Se escribirá en ',

    'Leitor e editor de Markdown para Windows. Sem cofre, sem projeto, sem cerimonia: ':
      'Lector y editor de Markdown para Windows. Sin bóveda, sin proyecto, sin ceremonia: ',
    'Licenca': 'Licencia',
    'Relatar um problema': 'Reportar un problema',
    'Diagnostico': 'Diagnóstico',
    'Ferramentas do desenvolvedor': 'Herramientas de desarrollo',

    'Ctrl+\\ tambem alterna.': 'Ctrl+\\ también alterna.',
    'Alt+Z tambem alterna.': 'Alt+Z también alterna.',
    'A ficha com o bloco --- do topo do documento, no modo leitura.':
      'La ficha con el bloque --- del inicio del documento, en modo lectura.',
    'No fim da leitura: quem, na pasta aberta, aponta para este documento.':
      'Al final de la lectura: quién, en la carpeta abierta, apunta a este documento.',
    'Desligue para uma interface instantanea, sem transicoes.':
      'Apáguelo para una interfaz instantánea, sin transiciones.',
    'O jeito seguro: nenhum arquivo abre em modo de edicao.':
      'El modo seguro: ningún archivo abre en modo de edición.',
    'Uma pergunta a mais antes de liberar a edicao.':
      'Una pregunta más antes de desbloquear la edición.',
    'Grava sozinho pouco depois de voce parar de digitar.':
      'Guarda solo, poco después de que deje de escribir.',
    'Na margem do painel de codigo-fonte.': 'En el margen del panel de código fuente.',
    'Desligado, a arvore lista todos os arquivos da pasta.':
      'Apagado, el árbol lista todos los archivos de la carpeta.',
    'Vale para a arvore inteira. Tambem esta no botao de ordenar do painel.':
      'Vale para todo el árbol. También está en el botón de ordenar del panel.',
    'Desligado, pastas e arquivos entram na mesma ordenacao.':
      'Apagado, carpetas y archivos entran en el mismo orden.',
    'A confirmacao antes de abrir algo que nao parece markdown.':
      'La confirmación antes de abrir algo que no parece markdown.',
    'Reabre as abas e a pasta que estavam abertas.':
      'Reabre las pestañas y la carpeta que estaban abiertas.',
    'Desligado, so imagens do proprio disco aparecem. Mais privado.':
      'Apagado, solo aparecen imágenes del propio disco. Más privado.',
    'Com o nome ao lado do icone, a barra fica mais larga.':
      'Con el nombre junto al icono, la barra queda más ancha.',
    'Volta a barra para os sete botoes originais.':
      'Devuelve la barra a los siete botones originales.',
    'Abre a pagina de issues do repositorio.':
      'Abre la página de issues del repositorio.',
    'Console do WebView2, para investigar um erro.':
      'Consola de WebView2, para investigar un error.',
    'Consulta as versoes publicadas no GitHub uma vez por dia, quando o MarkPad inicia. ':
      'Consulta las versiones publicadas en GitHub una vez al día, cuando MarkPad inicia. ',
    'Nada e baixado sem voce mandar.': 'No se descarga nada sin que usted lo pida.',
    'Ultima consulta: ': 'Última consulta: ',
    'Ainda nao foi consultado nesta instalacao.':
      'Todavía no se consultó en esta instalación.',

    'Abra uma pasta para procurar por nome.': 'Abra una carpeta para buscar por nombre.',
    'Pasta vazia.': 'Carpeta vacía.',
    'Nenhum arquivo .md aqui. Toque no filtro acima para ver todos.':
      'Ningún archivo .md aquí. Toque el filtro de arriba para verlos todos.',
    'nenhuma pasta aberta': 'ninguna carpeta abierta',
    'Nenhuma tag com esse nome.': 'Ninguna etiqueta con ese nombre.',
    'Nenhuma tag nos arquivos desta pasta.':
      'Ninguna etiqueta en los archivos de esta carpeta.',
    'Nenhuma tag nos documentos abertos. Abra uma pasta para varrer o disco.':
      'Ninguna etiqueta en los documentos abiertos. Abra una carpeta para recorrer el disco.',
    'Mostrando só markdown — clique para ver todos os arquivos':
      'Mostrando solo markdown — haga clic para ver todos los archivos',
    'Mostrando todos os arquivos — clique para ver só markdown':
      'Mostrando todos los archivos — haga clic para ver solo markdown',
    'Nome (A a Z)': 'Nombre (A a Z)',
    'Nome (Z a A)': 'Nombre (Z a A)',
    'Criado (recente primeiro)': 'Creado (más reciente primero)',
    'Criado (antigo primeiro)': 'Creado (más antiguo primero)',
    'Modificado (recente primeiro)': 'Modificado (más reciente primero)',
    'Modificado (antigo primeiro)': 'Modificado (más antiguo primero)',
    'Tirar da barra': 'Quitar de la barra',
    'Buscar no documento': 'Buscar en el documento',

    'Renomear arquivo': 'Renombrar archivo',
    'Renomear': 'Renombrar',
    'Ele continua na mesma pasta.': 'Sigue en la misma carpeta.',
    'Digite um nome.': 'Escriba un nombre.',
    'O Windows nao aceita estes: < > : " | ? *':
      'Windows no acepta estos: < > : " | ? *',
    'Não exibir esta mensagem novamente': 'No mostrar este mensaje otra vez',
    'Salvamento automatico ligado.': 'Guardado automático activado.',
    'Salvamento automatico desligado.': 'Guardado automático desactivado.',
    'Quebra: nao': 'Ajuste: no',
    'nao salvo': 'sin guardar',
    'Modo: ': 'Modo: ',
    'falha desconhecida': 'falla desconocida',
    'Nao consegui ler: ': 'No pude leer: ',
    'abrir no app padrao': 'abrir en la app predeterminada',
    'O arquivo <strong>{nome}</strong> tem mudancas que ainda nao foram gravadas.':
      'El archivo {nome} tiene cambios que aún no se guardaron.',
    'O documento <strong>{nome}</strong> passara a aceitar digitacao.':
      'El documento {nome} pasará a aceptar escritura.',
    'O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows.':
      'El archivo <strong>{nome}</strong> va a la Papelera de Windows.',
    'O arquivo <strong>{nome}</strong> vai para a Lixeira do Windows, e as alteracoes que ainda nao foram salvas se perdem junto.':
      'El archivo <strong>{nome}</strong> va a la Papelera de Windows, y los cambios que aún no se guardaron se pierden con él.',
    '<strong>{nome}</strong> tem extensão <code>.{ext}</code>, que não é markdown.':
      '<strong>{nome}</strong> tiene la extensión <code>.{ext}</code>, que no es markdown.',
    '<strong>{nome}</strong> não tem extensão.': '<strong>{nome}</strong> no tiene extensión.',
    'Ele será aberto como texto puro. Deseja mesmo abrir?':
      'Se abrirá como texto plano. ¿Abrir de todos modos?',
    'Ha alteracoes nao salvas em: <strong>{nomes}</strong>.': 'Hay cambios sin guardar en: {nomes}.',
    'O MarkPad guardou o texto de <strong>{nomes}</strong> que não chegou a ser gravado.':
      'MarkPad guardó el texto de {nomes} que no llegó a escribirse.',
    'O arquivo em disco continua intacto. Se restaurar, o texto volta como estava ':
      'El archivo en disco sigue intacto. Si lo restaura, el texto vuelve como estaba ',
    'e você decide se salva por cima.': 'y usted decide si guarda encima.',
    'O MarkPad entrará na lista de aplicativos para <strong>.md</strong>, ':
      'MarkPad entrará en la lista de aplicaciones para <strong>.md</strong>, ',
    'ele mostra uma caixa de escolha. Nenhum programa pode fazer isso sozinho.':
      'muestra un cuadro de elección. Ningún programa puede hacerlo por su cuenta.',
    'O MarkPad sairá da lista de aplicativos para arquivos <strong>.md</strong>.':
      'MarkPad saldrá de la lista de aplicaciones para archivos <strong>.md</strong>.',
    'O MarkPad ainda nao esta registrado para .md.':
      'MarkPad todavía no está registrado para .md.',
    'O MarkPad aparece em "Abrir com". Ainda nao e o padrao.':
      'MarkPad aparece en "Abrir con". Todavía no es el predeterminado.',
    'Definir o MarkPad como padrao de .md':
      'Poner MarkPad como predeterminado de .md',
    'Remover o MarkPad como padrao de .md':
      'Quitar MarkPad como predeterminado de .md',
    'Tornar padrao': 'Poner como predeterminado',

    'Arquivo grande demais para embutir.': 'Archivo demasiado grande para incluir.',
    'Embeds fundos demais; este ficou como link.':
      'Inclusiones demasiado anidadas; esta quedó como enlace.',
    'Caminho absoluto nao se embute sozinho — clique no link para abrir.':
      'Una ruta absoluta no se incluye sola — haga clic en el enlace para abrirla.',
    'So notas de texto se embutem: ': 'Solo se incluyen notas de texto: ',
    'markdown cru, com numeros de linha': 'markdown crudo, con números de línea',
    'edita no proprio leitor, sem ver o codigo':
      'edita en el propio lector, sin ver el código',
    'o giz esta travado, a tecla nao escreve':
      'la tiza está bloqueada, la tecla no escribe',

    'Baixando agora...': 'Descargando ahora...',
    'Na proxima vez': 'La próxima vez',
    'Reiniciar agora': 'Reiniciar ahora',
    'Abrir a pagina': 'Abrir la página',
    'Ver as notas': 'Ver las notas',
    'Ja baixado e conferido. Entra sozinho na proxima vez que o MarkPad abrir, ':
      'Ya descargado y verificado. Entra solo la próxima vez que MarkPad abra, ',
    'ou agora, se voce mandar.': 'o ahora, si usted lo pide.',
    'Se preferir, a troca acontece sozinha na proxima vez que voce abrir.':
      'Si prefiere, el cambio ocurre solo la próxima vez que abra.',
    'entao o download automatico fica de fora. Baixe pela pagina.':
      'así que la descarga automática queda fuera. Descárguelo desde la página.',
    'MarkPad {versao} ja esta baixada.': 'MarkPad {versao} ya está descargada.',
    'MarkPad {versao} esta disponivel.': 'MarkPad {versao} está disponible.',
    'MarkPad {versao} disponivel': 'MarkPad {versao} disponible',
    'MarkPad {versao} pronta para instalar': 'MarkPad {versao} lista para instalar',
    '{arquivo} foi atualizado no disco.': '{arquivo} se actualizó en el disco.',

    'abre um arquivo e pronto. Todo arquivo abre travado — no estado travado nao existe campo de ':
      'abre un archivo y ya. Todo archivo abre bloqueado — en el estado bloqueado no existe campo de ',
    'texto na tela, entao nao ha tecla que edite, apague ou digite nada.':
      'texto en la pantalla, así que no hay tecla que edite, borre o escriba nada.',

    'Windows (CRLF)': 'Windows (CRLF)',
    'Unix (LF)': 'Unix (LF)',

    'Painel lateral (Ctrl+\\)': 'Panel lateral (Ctrl+\\)',
    'Nova nota (Ctrl+N)': 'Nota nueva (Ctrl+N)',
    'Paleta de comandos (Ctrl+Shift+P)': 'Paleta de comandos (Ctrl+Shift+P)',
    'Buscar na pasta (Ctrl+Shift+F)': 'Buscar en la carpeta (Ctrl+Shift+F)',
    'Sumario': 'Índice',
    'Tags': 'Etiquetas',
    'Recentes': 'Recientes',
    'Abertos recentemente': 'Abiertos recientemente',
    'Alternar entre só markdown e todos os arquivos':
      'Alternar entre solo markdown y todos los archivos',
    'Filtrar por nome': 'Filtrar por nombre',
    'filtrar por nome': 'filtrar por nombre',
    'filtrar tags': 'filtrar etiquetas',
    'Ordenar': 'Ordenar',
    'Recolher tudo': 'Plegar todo',
    'Abrir pasta (Ctrl+Shift+O)': 'Abrir carpeta (Ctrl+Shift+O)',
    'Abrir pasta': 'Abrir carpeta',
    'Abrir arquivo': 'Abrir archivo',
    'Abrir arquivo pelo nome': 'Abrir archivo por nombre',
    'Atualizar': 'Actualizar',
    'Limpar lista': 'Limpiar la lista',
    'Abra uma pasta para navegar pelos arquivos.':
      'Abra una carpeta para navegar por los archivos.',
    'Nao precisa de cofre.': 'No hace falta una bóveda.',
    'Digite para buscar em todos os arquivos da pasta.':
      'Escriba para buscar en todos los archivos de la carpeta.',
    'Os titulos do documento aparecem aqui.':
      'Los títulos del documento aparecen aquí.',
    'As tags dos documentos aparecem aqui.':
      'Las etiquetas de los documentos aparecen aquí.',
    'Nada por aqui ainda.': 'Nada por aquí todavía.',
    'texto ou expressao regular': 'texto o expresión regular',
    'Diferenciar maiusculas': 'Distinguir mayúsculas',
    'Expressao regular': 'Expresión regular',
    'Digite um comando': 'Escriba un comando',
    'alteracoes nao salvas': 'cambios sin guardar',
    'Modo de exibição': 'Modo de vista',
    'Localizar (Ctrl+F)': 'Buscar (Ctrl+F)',
    'Mais opcoes': 'Más opciones',
    'Travado': 'Bloqueado',
    'localizar': 'buscar',
    'Substituir': 'Reemplazar',
    'Trocar': 'Reemplazar',
    'Trocar tudo': 'Reemplazar todo',
    'Proximo (Enter)': 'Siguiente (Enter)',
    'Anterior (Shift+Enter)': 'Anterior (Shift+Enter)',
    'Fechar aviso': 'Cerrar el aviso',
    'Agora nao': 'Ahora no',
    'Arraste arquivos para esta janela': 'Arrastre archivos a esta ventana',
    'Leitura — o giz trava a edição (Ctrl+E)':
      'Lectura — la tiza bloquea la edición (Ctrl+E)',
    'Edição ao vivo — edita no próprio leitor':
      'Edición en vivo — edita en el propio lector',
    'Código-fonte — markdown cru (Ctrl+Shift+C)':
      'Código fuente — markdown crudo (Ctrl+Shift+C)',
    'Leitura ao lado do código (Ctrl+Shift+L)':
      'Lectura junto al código (Ctrl+Shift+L)',
    'Ao vivo': 'En vivo',
    'Quebra de linha (Alt+Z)': 'Ajuste de línea (Alt+Z)',
    'Zoom (Ctrl + / Ctrl -)': 'Zoom (Ctrl + / Ctrl -)',
    'Codificacao': 'Codificación',
    'Fim de linha': 'Fin de línea',
    'Fonte': 'Fuente',
    'abrir ·': 'abrir ·',
    'salvar ·': 'guardar ·',
    'destrava e trava a edicao': 'desbloquea y bloquea la edición',
    'abra um arquivo e pronto.': 'abra un archivo y ya.',
    'Leitor e editor de Markdown. Sem cofre, sem projeto, sem cerimonia:':
      'Lector y editor de Markdown. Sin bóveda, sin proyecto, sin ceremonia:'
  };

  var DICIONARIOS = { en: EN, es: ES };

  var atual = 'pt-BR';

  /**
   * Resolve 'auto' contra o idioma do Windows (que o WebView2 repassa em
   * `navigator.language`). Um `pt-PT` cai em português, um `en-GB` em inglês:
   * o que importa é a primeira parte.
   */
  function resolver(pedido) {
    if (pedido && pedido !== 'auto') return existe(pedido) ? pedido : 'pt-BR';
    var nav = (navigator.language || 'pt-BR');
    if (existe(nav)) return nav;
    var raiz = nav.split('-')[0];
    for (var i = 0; i < IDIOMAS.length; i++) {
      if (IDIOMAS[i].code.split('-')[0] === raiz) return IDIOMAS[i].code;
    }
    return 'pt-BR';
  }

  function existe(code) {
    for (var i = 0; i < IDIOMAS.length; i++) if (IDIOMAS[i].code === code) return true;
    return false;
  }

  function definir(pedido) {
    atual = resolver(pedido);
    document.documentElement.setAttribute('lang', atual);
    return atual;
  }

  function t(texto, vars) {
    var d = DICIONARIOS[atual];
    var s = (d && Object.prototype.hasOwnProperty.call(d, texto)) ? d[texto] : texto;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (inteiro, chave) {
        return Object.prototype.hasOwnProperty.call(vars, chave) ? String(vars[chave]) : inteiro;
      });
    }
    return s;
  }

  window.MarkPadI18n = {
    IDIOMAS: IDIOMAS,
    DICIONARIOS: DICIONARIOS,
    definir: definir,
    atual: function () { return atual; },
    t: t
  };
})();
