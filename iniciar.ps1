$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$posNode = Get-Command node -ErrorAction SilentlyContinue
if ($posNode) { $posRuntime = $posNode.Source } else { $posRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (-not (Test-Path -LiteralPath $posRuntime)) { throw 'Instala Node.js 20 o posterior para abrir la aplicación.' }
Write-Host 'Abre http://localhost:4173 para operar o http://localhost:4173/?demo=1 para la demostración.'
& $posRuntime (Join-Path $PSScriptRoot 'serve.cjs')
