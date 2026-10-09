$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$archiveDirectory = Join-Path $projectRoot 'output'
New-Item -ItemType Directory -Force -Path $archiveDirectory | Out-Null
$archivePath = Join-Path $archiveDirectory 'factory-event-dashboard.zip'
$sourceEntries = @('server.js', 'package.json', 'package-lock.json', 'playwright.config.js', '.env.example', '.gitignore', '.prettierrc.json', '.prettierignore', 'docker-compose.yml', 'README.md', 'TECHNICAL_EXPLANATION.md', 'AI_USAGE.md', 'src', 'migrations', 'public', 'scripts', 'tests', 'docs')
$absoluteEntries = $sourceEntries | ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $absoluteEntries -DestinationPath $archivePath -Force
Write-Output "Clean source archive: $archivePath"
