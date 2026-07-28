# Publica o MarkPad como executavel unico e cria o atalho no Menu Iniciar.
#
#   .\build.ps1                 -> publica em .\publish\
#   .\build.ps1 -Shortcut       -> publica e cria atalho no Menu Iniciar
#   .\build.ps1 -SelfContained  -> embute o runtime .NET (nao precisa ter .NET instalado)

[CmdletBinding()]
param(
    [switch]$Shortcut,
    [switch]$SelfContained
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$outDir = Join-Path $PSScriptRoot 'publish'

$args = @(
    'publish', 'MarkPad.csproj',
    '-c', 'Release',
    '-r', 'win-x64',
    '-o', $outDir,
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableCompressionInSingleFile=true',
    '-p:DebugType=none'
)

if ($SelfContained) { $args += '--self-contained'; $args += 'true' }
else                { $args += '--self-contained'; $args += 'false' }

Write-Host "publicando em $outDir ..." -ForegroundColor Cyan
& dotnet @args
if ($LASTEXITCODE -ne 0) { throw "dotnet publish falhou (codigo $LASTEXITCODE)" }

$exe = Join-Path $outDir 'MarkPad.exe'
if (-not (Test-Path $exe)) { throw "nao encontrei $exe" }

$sizeMb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "pronto: $exe ($sizeMb MB)" -ForegroundColor Green

if ($Shortcut) {
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $lnk = Join-Path $startMenu 'MarkPad.lnk'

    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath       = $exe
    $sc.WorkingDirectory = $outDir
    $sc.IconLocation     = "$exe,0"
    $sc.Description      = 'Leitor/editor de Markdown com trava de edicao'
    $sc.Save()

    Write-Host "atalho criado: $lnk" -ForegroundColor Green
}

Write-Host ""
Write-Host "Para abrir arquivos .md com um duplo clique, use o menu (...) dentro"
Write-Host "do proprio MarkPad: 'Abrir arquivos .md com o MarkPad'."
