# Assina executaveis, instaladores e scripts com um certificado do seu
# repositorio de certificados, ou com um .pfx.
#
#   .\tools\sign.ps1                                  # assina tudo em dist\
#   .\tools\sign.ps1 -Path dist\MarkPad-1.1.0-setup-win-x64.exe
#   .\tools\sign.ps1 -Thumbprint A1B2C3...
#   .\tools\sign.ps1 -PfxPath ~\.certs\NBN-Telecom.pfx
#   .\tools\sign.ps1 -Verify                          # so confere o que ja esta assinado
#
# Usa Set-AuthenticodeSignature, que vem no Windows: nao precisa do SDK nem do
# signtool. O carimbo de tempo e o que faz a assinatura continuar valida depois
# que o certificado expirar — sem ele, tudo vira invalido na data de validade.

[CmdletBinding()]
param(
    [string[]]$Path,
    [string]$Thumbprint,
    [string]$PfxPath,
    [string]$TimestampServer = 'http://timestamp.digicert.com',
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# --------------------------------------------------------------- alvos

if (-not $Path) {
    $dist = Join-Path $root 'dist'
    if (-not (Test-Path $dist)) { throw "dist\ nao existe. Rode os scripts de build antes." }
    $Path = Get-ChildItem (Join-Path $dist '*') -File |
        Where-Object { $_.Extension -in '.exe', '.msi', '.dll', '.ps1' } |
        Select-Object -ExpandProperty FullName
}

$targets = $Path | ForEach-Object { (Resolve-Path $_).Path }
if (-not $targets) { throw 'nenhum arquivo para assinar' }

# ------------------------------------------------------------- so conferir

if ($Verify) {
    Write-Host "conferindo assinaturas..." -ForegroundColor Cyan
    foreach ($t in $targets) {
        $sig = Get-AuthenticodeSignature -FilePath $t
        $cor = switch ($sig.Status) {
            'Valid'               { 'Green' }
            'UnknownError'        { 'Yellow' }   # autoassinado: cadeia nao confiavel
            'NotSigned'           { 'Red' }
            default               { 'Yellow' }
        }
        $quem = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '-' }
        $carimbo = if ($sig.TimeStamperCertificate) { 'com carimbo' } else { 'SEM carimbo' }
        Write-Host ("  {0,-46} {1,-14} {2}" -f (Split-Path $t -Leaf), $sig.Status, $carimbo) -ForegroundColor $cor
        Write-Host ("  {0,-46} {1}" -f '', $quem) -ForegroundColor DarkGray
    }
    return
}

# ------------------------------------------------------------- certificado

if ($PfxPath) {
    if (-not (Test-Path $PfxPath)) { throw "nao encontrei $PfxPath" }
    $senha = Read-Host -Prompt "Senha do .pfx" -AsSecureString
    $cert = Get-PfxCertificate -FilePath $PfxPath -Password $senha
}
elseif ($Thumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1
    if (-not $cert) { throw "certificado $Thumbprint nao encontrado" }
}
else {
    $todos = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue)
    if ($todos.Count -eq 0) {
        throw "nenhum certificado de assinatura de codigo. Rode .\tools\new-signing-cert.ps1 primeiro."
    }
    if ($todos.Count -gt 1) {
        Write-Host "Ha mais de um certificado. Escolha com -Thumbprint:" -ForegroundColor Yellow
        $todos | Select-Object Subject, NotAfter, Thumbprint | Format-Table -AutoSize
        return
    }
    $cert = $todos[0]
}

if ($cert.NotAfter -lt (Get-Date)) { throw "o certificado venceu em $($cert.NotAfter)" }

Write-Host "assinando com: $($cert.Subject)" -ForegroundColor Cyan
Write-Host "  validade ate $($cert.NotAfter.ToString('dd/MM/yyyy'))"
Write-Host ""

# ---------------------------------------------------------------- assinar

$ok = 0
$falhas = 0
$tocouDist = $false
$distDir = (Join-Path $root 'dist')

foreach ($t in $targets) {
    if ($t.StartsWith($distDir, [StringComparison]::OrdinalIgnoreCase)) { $tocouDist = $true }
    $nome = Split-Path $t -Leaf
    try {
        $sig = Set-AuthenticodeSignature -FilePath $t -Certificate $cert `
            -HashAlgorithm SHA256 -TimestampServer $TimestampServer -ErrorAction Stop

        # 'UnknownError' aqui e o esperado com certificado autoassinado: a
        # assinatura foi gravada, mas a cadeia nao termina numa CA confiavel.
        if ($sig.Status -in 'Valid', 'UnknownError') {
            $ok++
            Write-Host ("  ok   {0,-46} {1}" -f $nome, $sig.Status) -ForegroundColor Green
        }
        else {
            $falhas++
            Write-Host ("  erro {0,-46} {1}" -f $nome, $sig.StatusMessage) -ForegroundColor Red
        }
    }
    catch {
        $falhas++
        Write-Host ("  erro {0,-46} {1}" -f $nome, $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "$ok assinado(s), $falhas com falha" -ForegroundColor $(if ($falhas) { 'Yellow' } else { 'Green' })

if ($ok -and $cert.Issuer -eq $cert.Subject) {
    Write-Host ""
    Write-Host "Este certificado e autoassinado: para quem baixar da internet o" -ForegroundColor Yellow
    Write-Host "Windows continua dizendo 'Publicador desconhecido'. Ver docs/ASSINATURA.md." -ForegroundColor Yellow
}

# As somas mudam depois de assinar; regenerar para nao publicar hash errado.
# So faz sentido se algum arquivo assinado estava mesmo em dist\.
$sums = Join-Path $root 'dist\SHA256SUMS.txt'
if ((Test-Path $sums) -and $ok -and $tocouDist) {
    Get-ChildItem (Join-Path $root 'dist\*') -File -Exclude 'SHA256SUMS.txt' | ForEach-Object {
        '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name
    } | Out-File -FilePath $sums -Encoding ascii
    Write-Host "SHA256SUMS.txt regenerado (assinar muda o hash)." -ForegroundColor Cyan
}
