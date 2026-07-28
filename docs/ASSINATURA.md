# Assinatura de código

O que a assinatura resolve, o que ela não resolve, e quanto custa cada
caminho. Vale para o MarkPad e para qualquer outro executável de vocês.

## O problema

Windows baixado da internet ganha a marca `Zone.Identifier`. Ao executar, o
SmartScreen consulta a reputação do arquivo. Binário novo e sem assinatura →
tela azul de "O Windows protegeu o computador".

Assinar **não** é um interruptor que desliga isso. O que conta é a **reputação
do publicador**, e reputação depende de um certificado emitido por uma
autoridade certificadora em que o Windows já confia.

## Certificado autoassinado (o que os scripts daqui geram)

```powershell
.\tools\new-signing-cert.ps1
.\tools\sign.ps1 -Thumbprint <impressão digital>
.\tools\sign.ps1 -Verify
```

Chave privada em `.pfx` protegido por senha, parte pública em `.cer`.

**Não resolve o SmartScreen.** A cadeia termina em vocês mesmos, não numa CA
pública. Para quem baixa da internet o resultado continua "Publicador
desconhecido" — na prática igual a não assinar.

Onde ele de fato serve:

| Uso | Como |
|:--|:--|
| **Dentro do domínio** | Distribua o `.cer` como Editor Confiável por GPO: *Configuração do Computador › Políticas › Configurações do Windows › Políticas de Chave Pública › Editores Confiáveis*. As máquinas da NBN passam a confiar e o aviso some — só nelas. |
| **Detecção de adulteração** | Qualquer byte alterado invalida a assinatura. `sign.ps1 -Verify` acusa. |
| **Ensaiar o processo** | Descobrir que o pipeline quebra antes de gastar com certificado de verdade. |

## Para distribuição pública, sem aviso

Desde 1º de junho de 2023 as regras do CA/Browser Forum exigem que a chave
privada de qualquer certificado de assinatura de código publicamente confiável
fique em **hardware** (HSM ou token FIPS 140-2 nível 2). Acabou o tempo de
`.pfx` no disco. Isso encarece e burocratiza todas as opções abaixo.

| Opção | Custo aprox. | Efeito no SmartScreen | Observação |
|:--|:--|:--|:--|
| **Azure Trusted Signing** | ~US$ 10/mês | Bom — reputação da Microsoft | **Melhor custo-benefício hoje.** Sem token físico: a chave fica no HSM da Microsoft. Exige organização com histórico verificável de 3 anos. |
| **OV** (Organization Validation) | ~US$ 200–500/ano | Some com o tempo, conforme baixam | Token físico enviado pelo correio. Validação da empresa. |
| **EV** (Extended Validation) | ~US$ 300–700/ano | Some de imediato | Token físico. Validação mais rígida. |
| **SignPath Foundation** | grátis | Igual a um OV | Só para projeto de código aberto que se qualifique. Como o MarkPad vai ser público e é MIT, **vale tentar**. |

Recomendação, na ordem: SignPath Foundation (grátis, se aceitarem o projeto) →
Azure Trusted Signing (barato, sem token) → OV.

## Enquanto não houver certificado

Não tem jeito bonito. O que dá para fazer é reduzir o atrito:

- Publicar `SHA256SUMS.txt` junto (já fazemos) para quem quiser conferir.
- Explicar na release o caminho "Mais informações → Executar assim mesmo".
- Oferecer o `.zip` portátil: arquivo dentro de zip às vezes recebe menos
  atrito que `.exe` solto.

**Não** tente contornar o SmartScreen por outros meios. Além de não funcionar
de forma duradoura, é exatamente o comportamento que a proteção existe para
barrar.

## Higiene da chave privada

- `.pfx` **nunca** vai para o git. Já está no `.gitignore`.
- Guarde a senha num cofre de senhas, não num arquivo ao lado.
- Assine **sempre com carimbo de tempo** (`sign.ps1` já usa o da DigiCert).
  Sem carimbo, tudo o que você assinou vira inválido no dia em que o
  certificado expirar. Com carimbo, continua válido para sempre.
- Se a chave vazar, revogue na CA e reassine. Com autoassinado, gere outro e
  redistribua o `.cer`.
