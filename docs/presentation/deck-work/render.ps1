param([string]$InputFile,[string]$RenderDirectory)
$pptApp = New-Object -ComObject PowerPoint.Application
try {
    $deck = $pptApp.Presentations.Open($InputFile, -1, 0, 0)
    $deck.Export($RenderDirectory, 'PNG', 1280, 720)
    $issues = @()
    foreach ($slide in $deck.Slides) {
        foreach ($shape in $slide.Shapes) {
            if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
                $range = $shape.TextFrame2.TextRange
                if ($range.BoundHeight -gt ($shape.Height + 4) -or $range.BoundWidth -gt ($shape.Width + 5)) {
                    $issues += [pscustomobject]@{Slide=$slide.SlideIndex;Text=$range.Text;Width=$shape.Width;Height=$shape.Height;BoundWidth=$range.BoundWidth;BoundHeight=$range.BoundHeight}
                }
            }
        }
    }
    $issues | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $RenderDirectory 'text-bounds.json') -Encoding utf8
    Write-Output "Rendered $($deck.Slides.Count) slides. Text bounds issues: $($issues.Count)"
    $deck.Close()
} finally {
    $pptApp.Quit()
}
