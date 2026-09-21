# Sobe o Galene em /home/docker/galene no Debian WSL (lab local).
# Uso no PowerShell (pasta do repo ou caminho absoluto):
#   powershell -File scripts\start-local.ps1
# Ou no Windows Terminal:
#   .\scripts\start-local.ps1
$ErrorActionPreference = 'Stop'
$Distro = 'Debian'
$Repo = '/mnt/s/Workspaces/galene-edicao-spartan'

Write-Host 'Acordando Debian WSL...'
Start-Process -FilePath 'wsl.exe' -ArgumentList '-d', $Distro, '--', 'sleep', 'infinity' -WindowStyle Hidden
Start-Sleep -Seconds 2

Write-Host 'Subindo /home/docker/galene + nginx...'
wsl -d $Distro -u root -- python3 -c "p=r'$Repo/scripts/lab-boot.py'; d=open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\r',b'\n'); open('/tmp/lab-boot.py','wb').write(d)"
wsl -d $Distro -u root -- python3 /tmp/lab-boot.py

# Garante que o sidecar Python releia registry.py (montagem do repo).
Write-Host 'Reiniciando spartan-reg (registry.py)...'
wsl -d $Distro -u root -- docker restart spartan-reg | Out-Null
Start-Sleep -Seconds 2

Write-Host ''
Write-Host 'Pronto para testar (http + 127.0.0.1 — nao use localhost):'
Write-Host '  Home:  http://127.0.0.1:8443/'
Write-Host '  Sala:  http://127.0.0.1:8443/group/spartan/'
Write-Host '  Admin: http://127.0.0.1:8443/admin/'
Write-Host 'Login fabrica: admin / Mudar@123  (troque no 1o acesso)'
Write-Host 'Hard refresh (Ctrl+F5) se o ?v= nao bater.'
Write-Host 'Stack: /home/docker/galene   Distrobox: programas, nao Docker'
