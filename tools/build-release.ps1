# Monta os artefatos de distribuicao do MarkPad em .\dist\
#
#   .\tools\build-release.ps1                 -> portatil (zip)
#   .\tools\build-release.ps1 -Framework      -> tambem a versao que exige .NET 9
#   .\tools\build-release.ps1 -Version 1.1.0  -> sobrescreve a versao do csproj
#
# O instalador tem script proprio: tools\build-installer.ps1

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Framework
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Version) {
    [xml]$csproj = Get-Content (Join-Path $root 'MarkPad.csproj')
    $Version = ($csproj.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
}
if (-not $Version) { throw 'nao consegui determinar a versao' }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function Publish-Variant {
    param([string]$Name, [bool]$SelfContained)

    $out = Join-Path $root "publish\$Name"
    Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue

    Write-Host "publicando '$Name' (autocontido: $SelfContained)..." -ForegroundColor Cyan

    $publishArgs = @(
        'publish', 'MarkPad.csproj',
        '-c', 'Release',
        '-r', 'win-x64',
        '-o', $out,
        '--self-contained', $SelfContained.ToString().ToLower(),
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:EnableCompressionInSingleFile=true',
        '-p:DebugType=none',
        "-p:Version=$Version",
        '-v', 'quiet', '--nologo'
    )

    & dotnet @publishArgs
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish falhou para '$Name'" }

    $exe = Join-Path $out 'MarkPad.exe'
    if (-not (Test-Path $exe)) { throw "nao encontrei $exe" }
    return $out
}

# ---------------------------------------------------------------- portatil

$portableDir = Publish-Variant -Name 'portable' -SelfContained $true

# O marcador liga o modo portatil: configuracoes e cache ficam em .\data\
New-Item -ItemType File -Force -Path (Join-Path $portableDir 'MarkPad.portable') | Out-Null

@"
MarkPad $Version - versao portatil
==================================

Basta executar MarkPad.exe. Nao precisa instalar nada.

O arquivo MarkPad.portable ao lado do executavel liga o modo portatil:
configuracoes, sessao e cache ficam na subpasta data\, nesta mesma pasta.
Nada e gravado no perfil do usuario nem no registro do Windows.

Para levar num pendrive, copie a pasta inteira (incluindo data\, se ja existir).
Apagar a pasta remove o programa por completo.

Requisito: Windows 10/11 com o Microsoft Edge WebView2 Runtime, que ja vem
instalado no Windows 11.

Para abrir arquivos .md com um duplo clique, use o menu (...) dentro do
programa: "Abrir arquivos .md com o MarkPad". Isso escreve so em HKCU e some
com a opcao inversa no mesmo menu. Aponta para o caminho atual do executavel,
entao se voce mover a pasta, refaca.

https://github.com/NBN-PATRIC/markpad
"@ | Out-File -FilePath (Join-Path $portableDir 'LEIAME.txt') -Encoding utf8

Copy-Item (Join-Path $root 'README.md')    (Join-Path $portableDir 'README.md')    -Force
Copy-Item (Join-Path $root 'CHANGELOG.md') (Join-Path $portableDir 'CHANGELOG.md') -Force

$zip = Join-Path $dist "MarkPad-$Version-portable-win-x64.zip"
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $portableDir '*') -DestinationPath $zip -CompressionLevel Optimal

# executavel avulso tambem, para quem so quer o arquivo
$loose = Join-Path $dist "MarkPad-$Version-win-x64.exe"
Copy-Item (Join-Path $portableDir 'MarkPad.exe') $loose -Force

# ------------------------------------------------- variante que exige .NET

if ($Framework) {
    $fwDir = Publish-Variant -Name 'framework' -SelfContained $false
    Copy-Item (Join-Path $fwDir 'MarkPad.exe') (Join-Path $dist "MarkPad-$Version-win-x64-net9.exe") -Force
}

# ------------------------------------------------------------------ resumo

Write-Host ""
Write-Host "artefatos em $dist" -ForegroundColor Green
Get-ChildItem $dist | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    '{0,-46} {1,8:N1} MB  {2}' -f $_.Name, ($_.Length / 1MB), $hash.Substring(0, 16)
}

# Arquivo de somas, para conferencia do download.
# Atencao: -Exclude so filtra os filhos se o -Path terminar em curinga.
# Sem o '*', o filtro se aplica a propria pasta e o resultado vem vazio.
$sums = Get-ChildItem (Join-Path $dist '*') -File -Exclude 'SHA256SUMS.txt' | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name
}
if (-not $sums) { throw 'nenhum artefato encontrado para somar' }
$sums | Out-File -FilePath (Join-Path $dist 'SHA256SUMS.txt') -Encoding ascii

Write-Host ""
Write-Host "somas gravadas em dist\SHA256SUMS.txt" -ForegroundColor Green
