# Gera Assets\app.ico (ICO multi-resolucao com quadros PNG).
# Rode so quando quiser mudar o desenho do icone; o .ico fica versionado.

Add-Type -AssemblyName System.Drawing

$sizes  = @(16, 24, 32, 48, 64, 128, 256)
$root   = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'Assets'
$outIco = Join-Path $outDir 'app.ico'

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-Frame([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # quadrado arredondado com o roxo de destaque
    $r    = [Math]::Max(2, [int]($size * 0.22))
    $pad  = [Math]::Max(0, [int]($size * 0.03))
    $side = $size - ($pad * 2)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($pad, $pad, $r * 2, $r * 2, 180, 90)
    $path.AddArc($pad + $side - $r * 2, $pad, $r * 2, $r * 2, 270, 90)
    $path.AddArc($pad + $side - $r * 2, $pad + $side - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc($pad, $pad + $side - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()

    $rect  = New-Object System.Drawing.Rectangle($pad, $pad, $side, $side)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 168, 130, 255),
        [System.Drawing.Color]::FromArgb(255, 122, 86, 224),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillPath($brush, $path)

    # "M" branco
    $fontSize = [single]($size * 0.60)
    $font     = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt      = New-Object System.Drawing.StringFormat
    $fmt.Alignment     = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $textRect = New-Object System.Drawing.RectangleF(0, [single](-$size * 0.04), [single]$size, [single]$size)
    $g.DrawString('M', $font, $white, $textRect, $fmt)

    # marca do giz: risco laranja na base (some nos tamanhos minusculos)
    if ($size -ge 32) {
        $penW = [single][Math]::Max(1.5, $size * 0.075)
        $pen  = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 190, 60), $penW)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
        $y = [single]($size * 0.775)
        $g.DrawLine($pen, [single]($size * 0.28), $y, [single]($size * 0.72), $y)
        $pen.Dispose()
    }

    $white.Dispose(); $font.Dispose(); $fmt.Dispose()
    $brush.Dispose(); $path.Dispose(); $g.Dispose()
    return $bmp
}

# --- monta o container ICO (cabecalho + diretorio + quadros PNG)
$frames = @()
foreach ($s in $sizes) {
    $bmp = New-Frame $s
    $ms  = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += [pscustomobject]@{ Size = $s; Bytes = $ms.ToArray() }
    $ms.Dispose(); $bmp.Dispose()
}

$stream = [System.IO.File]::Create($outIco)
$writer = New-Object System.IO.BinaryWriter($stream)

$writer.Write([uint16]0)                 # reservado
$writer.Write([uint16]1)                 # tipo 1 = icone
$writer.Write([uint16]$frames.Count)

$offset = 6 + (16 * $frames.Count)
foreach ($f in $frames) {
    $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
    $writer.Write([byte]$dim)            # largura
    $writer.Write([byte]$dim)            # altura
    $writer.Write([byte]0)               # cores da paleta
    $writer.Write([byte]0)               # reservado
    $writer.Write([uint16]1)             # planos
    $writer.Write([uint16]32)            # bits por pixel
    $writer.Write([uint32]$f.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $f.Bytes.Length
}

foreach ($f in $frames) { $writer.Write($f.Bytes) }

$writer.Flush(); $writer.Close(); $stream.Close()

Write-Output "icone gerado: $outIco ($($frames.Count) resolucoes, $((Get-Item $outIco).Length) bytes)"
