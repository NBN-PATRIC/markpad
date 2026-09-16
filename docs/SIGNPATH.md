# Assinatura pelo SignPath Foundation

O SignPath Foundation assina binários de projetos de código aberto sem cobrar,
com um certificado de autoridade certificadora **de verdade** — é o que resolve
o aviso do SmartScreen, ao contrário do certificado autoassinado descrito em
[ASSINATURA.md](ASSINATURA.md).

## O que já está pronto

| Requisito | Situação |
|:--|:--|
| Licença aprovada pela OSI | MIT |
| Repositório público | `github.com/NBN-PATRIC/markpad` |
| Build em CI pública e auditável | `.github/workflows/build.yml` |
| Passo de assinatura no workflow | pronto, inerte até as variáveis existirem |

Eles não assinam binário compilado na máquina de alguém: a procedência precisa
ser verificável, daí a exigência de CI. Por isso o workflow existe.

## O que depende de você

A inscrição é do mantenedor — envolve aceitar os termos deles e declarar-se
responsável pelo projeto. Não é coisa que eu deva fazer no seu nome.

**1. Inscrever o projeto**

Em <https://signpath.org/apply> (ou <https://about.signpath.io/product/open-source>),
com:

- Repositório: `https://github.com/NBN-PATRIC/markpad`
- Licença: MIT
- CI: GitHub Actions
- Descrição sugerida: *leitor e editor de Markdown para Windows, com trava de
  edição para leitura sem risco de alteração acidental; distribuído como
  portátil, instalador e MSI*

A aprovação não é automática — eles avaliam se o projeto tem relevância e se o
processo de build é auditável. Pode levar alguns dias e pode ser recusado.

**2. Depois de aprovado**

Eles criam a organização e o projeto no SignPath. Cadastre no repositório
(*Settings › Secrets and variables › Actions*):

| Tipo | Nome | Valor |
|:--|:--|:--|
| Variable | `SIGNPATH_ORGANIZATION_ID` | o GUID que eles fornecem |
| Secret | `SIGNPATH_API_TOKEN` | o token do usuário de CI |

Confira também se os identificadores no workflow batem com o que eles
criaram — hoje estão como `project-slug: markpad` e
`signing-policy-slug: release-signing`.

**3. Publicar**

```bash
git tag -a vX.Y.Z -m "MarkPad X.Y.Z" && git push origin vX.Y.Z
gh release create vX.Y.Z --title "..." --notes-file notas.md
```

**Nesta ordem, e a release precisa existir.** O workflow termina com
`gh release upload --clobber`, que anexa a uma release existente — ele *não*
cria nenhuma. Sem a release, esse passo falha e a tag fica sem artefato.

E como é `--clobber`, **não adianta subir binário compilado na sua máquina**:
o que o CI produzir substitui tudo alguns minutos depois, inclusive o
`SHA256SUMS.txt`. É de propósito — o artefato oficial é o do CI, com
procedência verificável, que é o que o SignPath exige. Crie a release com as
notas e deixe os arquivos por conta do workflow.

O workflow compila, envia para assinatura, espera terminar, recalcula as somas
SHA-256 (assinar muda o binário, logo muda o hash) e anexa tudo à release.

Enquanto as variáveis não existirem, o passo de assinatura é pulado e a release
sai sem assinatura — exatamente como hoje, sem quebrar nada.

## Se o SignPath recusar

Alternativas, em ordem de custo-benefício, detalhadas em
[ASSINATURA.md](ASSINATURA.md): **Azure Trusted Signing** (~US$ 10/mês, sem
token físico) e depois certificado **OV** de autoridade comercial.
