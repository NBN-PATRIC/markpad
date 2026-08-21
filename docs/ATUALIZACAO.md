# Atualização automática

Como o MarkPad descobre que existe uma versão nova, como ela chega ao disco e
como ela entra no lugar da que está rodando.

O código está em [`Updater.cs`](../Updater.cs) (a parte que sabe de rede e de
processos), em [`App.xaml.cs`](../App.xaml.cs) (o momento da troca) e em
`web/app.js`, seção *atualizacao* (a conversa com quem está usando).

---

## A regra que manda em todas as outras

**Nada é executado sem que o SHA-256 confira com o publicado na release.**

Os binários do MarkPad ainda não são assinados por uma autoridade
certificadora (ver [ASSINATURA.md](ASSINATURA.md)). Sem a assinatura, um
atualizador que baixe um `.exe` e o execute é o elo mais fraco do programa
inteiro: quem conseguir se meter entre o app e o GitHub troca o instalador e
pronto. A soma publicada é o que sobra para fechar essa porta, e por isso ela
não é um detalhe de implementação — é a condição para o download existir.

Consequências práticas espalhadas pelo código:

- A release precisa publicar `SHA256SUMS.txt` **cobrindo o instalador**. Se o
  arquivo não existir, ou não citar o `.exe` de setup, `canInstall` volta
  `false` e o aviso na tela vira um link para a página de releases — não um
  botão de baixar. É degradação, não falha.
- A soma é conferida **duas vezes**: ao terminar o download (e o arquivo é
  apagado se não bater) e de novo no instante de executar, porque entre uma
  coisa e outra o app pode ter sido fechado e reaberto dias depois.
- A URL precisa ser `https` e apontar para `github.com`, `api.github.com` ou
  `*.githubusercontent.com`. A API poderia mandar qualquer URL; o app não
  segue qualquer URL.
- O nome do arquivo tem que ser um `.exe` sem caminho nenhum dentro. O
  `pending.json` também é conferido contra `Path.GetFileName` na leitura — um
  registro adulterado não vira `..\..\algum\lugar`.
- O download tem teto de 300 MB, conferido no cabeçalho **e** durante a
  leitura (o `Content-Length` é uma promessa, não um fato).

Onde as somas são geradas: [`tools/write-sums.ps1`](../tools/write-sums.ps1),
chamado pelo `build-release.ps1` e de novo pelo `build-installer.ps1` — o
último a terminar reescreve o arquivo já completo. O fluxo de CI chama o mesmo
script depois de assinar, porque assinar muda o binário e portanto muda o hash.

---

## O caminho inteiro

### 1. A consulta

`GET https://api.github.com/repos/NBN-PATRIC/markpad/releases/latest`, uma vez
por dia, na abertura, **depois** de tudo o que o usuário pediu já estar na tela
(a última etapa da cadeia de boot, atrás até da restauração dos rascunhos).
Rede fora não atrasa nem atrapalha nada: `CheckAsync` nunca lança, devolve
`{ ok: false }` e o assunto morre ali.

O intervalo de um dia mora em `settings.lastUpdateCheck`. Sem ele, abrir e
fechar o MarkPad dez vezes numa manhã seriam dez consultas — e a API do GitHub
tem limite por IP. O botão **Procurar agora**, nas configurações, ignora tanto
o intervalo quanto a preferência: quem clicou quer a resposta agora.

Comparação de versões por `System.Version`, não por texto: `1.10.0` é mais nova
que `1.9.0`, o que a ordem alfabética diria ao contrário.

### 2. O aviso

Uma faixa presa no canto inferior direito. **Nunca um modal** — quem abriu o
MarkPad queria ler um arquivo, não responder uma caixa de diálogo. O `x` só
esconde: a versão continua anotada nas configurações e o aviso volta na próxima
consulta.

Quatro estados, na mesma faixa:

| estado | o que mostra | botões |
|---|---|---|
| `disponivel` + `canInstall` | versão nova e tamanho do download | **Baixar**, Ver as notas |
| `disponivel` sem `canInstall` | por que o automático não vale aqui | Abrir a página |
| `baixando` | progresso, com barra | — |
| `pronta` | já baixado e conferido | **Reiniciar agora**, Na próxima vez |

O caso "sem `canInstall`" cobre dois motivos diferentes, e o texto diz qual:
release sem soma publicada, ou **instalação portátil**. Portátil fica fora da
autoinstalação de propósito — pode estar num pendrive só de leitura, ou existir
em três cópias na mesma máquina, e trocar sozinha seria trocar a cópia errada.
Portátil é avisada e mandada para a página.

### 3. O download

Só depois de um clique. A consulta é automática; o download nunca é.

Grava em `<DataRoot>\updates\<nome>.part` e só renomeia para o nome final
depois da soma conferir. Enquanto baixa, o host emite um evento
`updateProgress` a cada 512 KB (e um no fim) — a ponte é estritamente
pergunta/resposta, então sem esses eventos um download de 55 MB ficaria mudo.

Terminado, escreve `updates\pending.json` com versão, arquivo e soma. Downloads
antigos na mesma pasta são apagados.

### 4. A troca

O instalador precisa sobrescrever o `.exe` que está rodando. Há dois caminhos,
e a diferença entre eles é só *quando*:

**Reiniciar agora.** `ApplyNow()` reconfere a soma, dispara um `cmd` solto e
manda a janela fechar:

```
cmd /c "ping -n 3 127.0.0.1 >nul & "<setup>" /SILENT /SUPPRESSMSGBOXES /NORESTART & start "" "<exe>""
```

O `ping` é o atraso — dá tempo de o processo morrer de verdade antes de o
instalador tentar escrever por cima. Não é `timeout`: `timeout.exe` lê do
console e falha debaixo de `CreateNoWindow=true`, que é justamente como esse
processo é criado.

**Na próxima vez.** `ApplyPendingAtStartup()` roda em `App.OnStartup`, **antes
de existir qualquer janela** — o único instante em que nada nosso está segurando
o executável. Aqui o instalador roda de forma síncrona (`WaitForExit`, exige
`ExitCode == 0`) e o MarkPad se relança **carregando os argumentos originais**,
para que dar duplo clique num `.md` continue abrindo aquele `.md` depois da
troca.

Três travas nesse caminho:

- Só acontece se **nenhuma outra instância** estiver no ar
  (`Mutex.TryOpenExisting`). Com duas janelas abertas a troca não teria como
  funcionar; na dúvida, adia.
- Se o `pending.json` aponta para uma versão **igual ou mais velha** que a
  instalada, o registro é descartado sozinho. É o que impede um pendente
  esquecido de reinstalar a mesma coisa toda vez que o app abre.
- O corpo inteiro é um `try/catch` que devolve `false`. **Atualização nunca
  pode impedir o app de abrir** — na pior das hipóteses, não atualiza.

---

## O que fica guardado

```
<DataRoot>\updates\
  MarkPad-x.y.z-setup-win-x64.exe   o instalador baixado e conferido
  pending.json                      { version, file, sha256 }
```

`<DataRoot>` é `%APPDATA%\MarkPad` na instalação normal, ou a pasta `data\` ao
lado do executável na portátil (que nunca chega a baixar nada).

Preferências envolvidas, em `settings.json`:

- `checkUpdates` — consultar na abertura (padrão: ligado)
- `lastUpdateCheck` — carimbo da última consulta, para o intervalo de um dia

---

## Testar sem rede

O preview do navegador encena o fluxo inteiro:

```bash
node dev/make-preview.js
```

e abra `dev/preview.html?update=1`. O stub finge uma 1.3.0 disponível, um
download com barra de progresso que enche em uns três segundos e o estado
"pronta para instalar", incluindo o descarte. Sem `?update=1`, o stub responde
que já está na versão mais nova — que é o caminho normal.
