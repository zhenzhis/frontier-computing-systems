$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$source = [string]$request.command
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { exit 2 }
$names = @{}
foreach ($name in @('Remove-Item', 'Move-Item', 'Rename-Item', 'Clear-Content', 'Set-Content', 'Out-File', 'rm', 'del', 'erase', 'rd', 'rmdir', 'ri', 'mv', 'git', 'git.exe')) {
    $names[$name.ToLowerInvariant()] = $name
}
$commands = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)
$replacements = foreach ($command in $commands) {
    $name = $command.GetCommandName()
    if (-not $name) { continue }
    $leaf = ($name -split '\\')[-1]
    $canonical = $names[$leaf.ToLowerInvariant()]
    if (-not $canonical) { continue }
    $normalized = $name.Substring(0, $name.Length - $leaf.Length) + $canonical
    $extent = $command.CommandElements[0].Extent
    $replacement = $normalized
    if ($extent.Text.StartsWith("'") -or $extent.Text.StartsWith('"')) {
        $quote = $extent.Text.Substring(0, 1)
        $replacement = $quote + $normalized + $quote
    }
    if ($extent.Text -cne $replacement) {
        [pscustomobject]@{ Start=$extent.StartOffset; Length=$extent.EndOffset-$extent.StartOffset; Text=$replacement }
    }
}
foreach ($replacement in @($replacements) | Sort-Object Start -Descending) {
    $source = $source.Remove($replacement.Start, $replacement.Length).Insert($replacement.Start, $replacement.Text)
}
@{ command=$source } | ConvertTo-Json -Compress
