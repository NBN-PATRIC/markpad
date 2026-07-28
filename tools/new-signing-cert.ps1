# Cria um certificado AUTOASSINADO de assinatura de codigo, reutilizavel em
# qualquer projeto de voces.
#
#   .\tools\new-signing-cert.ps1
#   .\tools\new-signing-cert.ps1 -Subject "CN=Fulano" -Years 5 -OutDir C:\certs
#
# LEIA ANTES DE ESPERAR MILAGRE
# -----------------------------
# Certificado autoassinado NAO resolve o aviso do SmartScreen para quem baixa
# da internet. O Windows so confia numa cadeia que termina numa autoridade
# certificadora publica; um certificado feito aqui termina em voces mesmos.
# Para o publico, o resultado continua "Publicador desconhecido".
#
# Onde ele serve de verdade:
#   1. Dentro do dominio. Distribuindo o .cer publico como Editor Confiavel
#      (GPO: Configuracao do Computador > Politicas > Configuracoes do Windows
#      > Politicas de Chave Publica > Editores Confiaveis), as maquinas da
#      empresa passam a confiar e o aviso some — so nelas.
#   2. Deteccao de adulteracao. Qualquer byte alterado invalida a assinatura.
#   3. Ensaiar o processo antes de gastar com certificado de verdade.
#
# Para distribuicao publica sem aviso, ver docs/ASSINATURA.md.

[CmdletBinding()]
param(
    [string]$Subject = "CN=NBN Telecom, O=NBN Telecom, C=BR",
    [int]$Years = 5,
    [string]$OutDir = "$env:USERPROFILE\.certs",
    [string]$FriendlyName = "Assinatura de codigo - NBN",
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- existente

$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject }

if ($existing -and -not $Force) {
    Write-Host "Ja existe um certificado com este titular:" -ForegroundColor Yellow
    $existing | Select-Object Subject, NotAfter, Thumbprint | Format-Table -AutoSize
    Write-Host "Use -Force para criar outro assim mesmo." -ForegroundColor Yellow
    return
}

# ------------------------------------------------------------------- senha

Write-Host "O .pfx guarda a chave privada e sera protegido por senha." -ForegroundColor Cyan
Write-Host "Guarde essa senha num cofre: sem ela o arquivo nao serve para nada." -ForegroundColor Cyan
$password = Read-Host -Prompt "Senha para o .pfx" -AsSecureString
if ($password.Length -eq 0) { throw "senha vazia: aborta." }

# -------------------------------------------------------------- certificado

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "gerando o certificado..." -ForegroundColor Cyan

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -FriendlyName $FriendlyName `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature `
    -NotAfter (Get-Date).AddYears($Years) `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")   # EKU: assinatura de codigo

$safe = ($Subject -replace '^CN=', '' -replace '[^\w-]', '-' -replace '-+', '-').Trim('-')
$pfx = Join-Path $OutDir "$safe.pfx"
$cer = Join-Path $OutDir "$safe.cer"

# .pfx = certificado + chave privada. NUNCA versionar, nunca enviar por e-mail.
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password -Force | Out-Null

# .cer = so a parte publica. Este sim pode ser distribuido (GPO, colegas).
Export-Certificate -Cert $cert -FilePath $cer -Force | Out-Null

# ------------------------------------------------------------------ resumo

Write-Host ""
Write-Host "certificado criado" -ForegroundColor Green
Write-Host "  titular:    $($cert.Subject)"
Write-Host "  impressao:  $($cert.Thumbprint)"
Write-Host "  validade:   ate $($cert.NotAfter.ToString('dd/MM/yyyy'))"
Write-Host "  privado:    $pfx   <- NAO versionar, NAO compartilhar"
Write-Host "  publico:    $cer   <- este pode ser distribuido"
Write-Host ""
Write-Host "assinar com ele:" -ForegroundColor Cyan
Write-Host "  .\tools\sign.ps1 -Thumbprint $($cert.Thumbprint)"
Write-Host ""
Write-Host "Lembrete: isto NAO tira o aviso do SmartScreen para quem baixa da" -ForegroundColor Yellow
Write-Host "internet. Serve dentro do dominio e para detectar adulteracao." -ForegroundColor Yellow
Write-Host "Ver docs/ASSINATURA.md." -ForegroundColor Yellow
