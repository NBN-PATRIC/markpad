# Grava dist\SHA256SUMS.txt com a soma de cada artefato distribuivel.
#
# Ficava no fim do build-release.ps1, que roda antes do build-installer.ps1:
# o arquivo saia cobrindo so o .zip e o .exe avulso, e o instalador e o .msi
# chegavam na release sem soma nenhuma. Como o atualizador automatico recusa
# baixar o que nao consegue conferir, isso deixava o proprio instalador de
# fora do caminho de atualizacao. Agora e um passo separado, chamado por
# quem termina, e o ultimo a rodar reescreve o arquivo ja completo.
#
#   .\tools\write-sums.ps1
#   .\tools\write-sums.ps1 -Pasta signed

[CmdletBinding()]
param(
    [string]$Pasta = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $Pasta) { $Pasta = Join-Path $root 'dist' }
if (-not (Test-Path $Pasta)) { throw "pasta nao encontrada: $Pasta" }

# O que nao e artefato de distribuicao: o proprio arquivo de somas e os
# simbolos que o WiX deixa cair na pasta de saida.
$foraDaLista = 'SHA256SUMS.txt', '*.wixpdb', '*.pdb'

# Atencao: -Exclude so filtra os filhos se o -Path terminar em curinga.
# Sem o '*', o filtro se aplica a propria pasta e o resultado vem vazio.
$arquivos = Get-ChildItem (Join-Path $Pasta '*') -File -Exclude $foraDaLista |
    Sort-Object Name

if (-not $arquivos) { throw "nenhum artefato encontrado em $Pasta" }

$sums = $arquivos | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name
}

$destino = Join-Path $Pasta 'SHA256SUMS.txt'
$sums | Out-File -FilePath $destino -Encoding ascii

Write-Host ""
Write-Host "somas gravadas em $destino ($($arquivos.Count) artefatos)" -ForegroundColor Green
$sums | ForEach-Object { Write-Host "  $_" }
