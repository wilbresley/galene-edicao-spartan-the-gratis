# Zera so o stack Galene em /home/docker/galene. Debian e Distrobox ficam.
$ErrorActionPreference = 'Stop'
$Distro = 'Debian'
$Repo = '/mnt/s/Workspaces/galene-edicao-spartan'
Write-Host 'Limpando /home/docker/galene (Debian e Distrobox permanecem)...'
wsl -d $Distro -u root -- bash -lc 'cd /home/docker/galene && docker compose down -v --remove-orphans; rm -rf data groups recordings'
wsl -d $Distro -u root -- python3 -c "p=r'$Repo/scripts/lab-boot.py'; d=open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\r',b'\n'); open('/tmp/lab-boot.py','wb').write(d)"
wsl -d $Distro -u root -- env FORCE_FACTORY=1 python3 /tmp/lab-boot.py
Write-Host 'Pronto. Abra http://127.0.0.1:8443/'
