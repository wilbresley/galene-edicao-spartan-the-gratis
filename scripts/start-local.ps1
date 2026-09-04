# Sobe o Galene local neste PC (WSL2 + Docker Engine).
# Duplo clique ou: powershell -File scripts\start-local.ps1
$ErrorActionPreference = 'Stop'
Write-Host 'Iniciando Ubuntu WSL + containers Galene...'
# Mantém o WSL acordado: sem uma sessão aberta o VM desliga e o Firefox recusa :8443.
Start-Process -FilePath 'wsl.exe' -ArgumentList '-d','Ubuntu-26.04','--','sleep','infinity' -WindowStyle Hidden
Start-Sleep -Seconds 2
wsl -d Ubuntu-26.04 -- bash -lc "set -euo pipefail; systemctl is-active docker >/dev/null || true; cd /mnt/s/workspace/galene-castro; docker compose up -d --remove-orphans; docker compose ps"
Write-Host ''
Write-Host 'Home:  http://127.0.0.1:8443/          (shell SPA — mesma aba)'
Write-Host 'Sala:  http://127.0.0.1:8443/#/group/spartan'
Write-Host 'Admin: http://127.0.0.1:8443/admin/'
Write-Host 'Use http (nao https). Login: admin / Mudar@123'
