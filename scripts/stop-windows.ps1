# Stop and remove the Prelegal container (its temporary database goes with it).
docker rm -f prelegal 2>$null | Out-Null
Write-Host "Prelegal stopped"
