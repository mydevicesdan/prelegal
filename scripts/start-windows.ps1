# Build and start Prelegal at http://localhost:8000
Set-Location (Join-Path $PSScriptRoot "..")

docker rm -f prelegal 2>$null | Out-Null
docker build -t prelegal .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$envArgs = @()
if (Test-Path .env) { $envArgs = @("--env-file", ".env") }
docker run -d --name prelegal -p 8000:8000 @envArgs prelegal
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Prelegal is running at http://localhost:8000"
