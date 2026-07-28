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
git tag -a v1.2.0 -m "MarkPad 1.2.0" && git push origin v1.2.0
```

O workflow compila, envia para assinatura, espera terminar, recalcula as somas
SHA-256 (assinar muda o binário, logo muda o hash) e anexa tudo à release.

Enquanto as variáveis não existirem, o passo de assinatura é pulado e a release
sai sem assinatura — exatamente como hoje, sem quebrar nada.

## Se o SignPath recusar

Alternativas, em ordem de custo-benefício, detalhadas em
[ASSINATURA.md](ASSINATURA.md): **Azure Trusted Signing** (~US$ 10/mês, sem
token físico) e depois certificado **OV** de autoridade comercial.
