# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Planejado
- Instalador para Windows, com opção marcável de assumir os arquivos `.md`
- Assinatura do executável (hoje o SmartScreen avisa por ser binário novo)

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

[Não lançado]: https://github.com/NBN-PATRIC/markpad/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/NBN-PATRIC/markpad/releases/tag/v1.0.0
