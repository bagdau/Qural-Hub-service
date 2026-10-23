$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDoc = Join-Path $taskRoot 'Alageum_Service_Hub_Overview_Technical.docx'
$taskPdf = Join-Path $PSScriptRoot 'render\document.pdf'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    $taskDocument = $taskWord.Documents.Open($taskDoc, $false, $false)
    $taskDocument.Repaginate()
    $taskDocument.Fields.Update() | Out-Null
    $taskDocument.Save()
    $taskDocument.ExportAsFixedFormat($taskPdf, 17)
    Write-Output "Pages: $($taskDocument.ComputeStatistics(2))"
    $taskDocument.Close(0)
} finally {
    $taskWord.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskWord) | Out-Null
}
