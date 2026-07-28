# Gera os instaladores do MarkPad em .\dist\
#
#   .\tools\build-installer.ps1          -> setup.exe (Inno) + .msi (WiX)
#   .\tools\build-installer.ps1 -OnlyInno
#   .\tools\build-installer.ps1 -OnlyMsi
#
# Ferramentas:
#   Inno Setup 6   winget install --id JRSoftware.InnoSetup -e
#   WiX 7          dotnet tool install --global wix --add-source https://api.nuget.org/v3/index.json

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$OnlyInno,
    [switch]$OnlyMsi
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

# ------------------------------------------------- binario a ser instalado
# Sem o marcador MarkPad.portable: a versao instalada guarda as configuracoes
# em %APPDATA%, que e o esperado de um programa instalado.

$installedDir = Join-Path $root 'publish\installed'
Remove-Item -Recurse -Force $installedDir -ErrorAction SilentlyContinue

Write-Host "publicando o binario para o instalador..." -ForegroundColor Cyan
& dotnet publish MarkPad.csproj -c Release -r win-x64 -o $installedDir `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none `
    "-p:Version=$Version" `
    -v quiet --nologo
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish falhou' }

$exeSource = Join-Path $installedDir 'MarkPad.exe'
if (-not (Test-Path $exeSource)) { throw "nao encontrei $exeSource" }

# ------------------------------------------------------------- Inno Setup

if (-not $OnlyMsi) {
    $iscc = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $iscc) {
        throw "ISCC.exe nao encontrado. Instale com: winget install --id JRSoftware.InnoSetup -e"
    }

    Write-Host "compilando o setup.exe (Inno Setup)..." -ForegroundColor Cyan
    & $iscc /Q "/DAppVersion=$Version" "/DExeSource=$exeSource" (Join-Path $root 'installer\markpad.iss')
    if ($LASTEXITCODE -ne 0) { throw "ISCC falhou (codigo $LASTEXITCODE)" }
}

# -------------------------------------------------------------------- WiX

if (-not $OnlyInno) {
    $env:PATH = "$env:PATH;$env:USERPROFILE\.dotnet\tools"
    if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
        throw "wix nao encontrado. Instale com: dotnet tool install --global wix --add-source https://api.nuget.org/v3/index.json"
    }

    Write-Host "compilando o .msi (WiX)..." -ForegroundColor Cyan
    $msi = Join-Path $dist "MarkPad-$Version-win-x64.msi"
    & wix build (Join-Path $root 'installer\markpad.wxs') `
        -arch x64 `
        -d "Version=$Version" `
        -d "ExeSource=$exeSource" `
        -o $msi
    if ($LASTEXITCODE -ne 0) { throw "wix build falhou (codigo $LASTEXITCODE)" }
}

# ---------------------------------------------------------------- resumo

Write-Host ""
Write-Host "instaladores em $dist" -ForegroundColor Green
Get-ChildItem $dist -File | Where-Object { $_.Extension -in '.exe', '.msi' } | ForEach-Object {
    '{0,-46} {1,8:N1} MB' -f $_.Name, ($_.Length / 1MB)
}
