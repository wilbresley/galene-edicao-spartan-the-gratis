# Requer administrador. Instala WSL2 + Debian no C: (nao no S:).
$ErrorActionPreference = 'Stop'
$Log = 'C:\WSL\install-wsl-debian.log'
New-Item -ItemType Directory -Force -Path 'C:\WSL' | Out-Null
function Log($m) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m
    Add-Content -Path $Log -Value $line
    Write-Host $line
}

Log 'Habilitando recursos WSL + VM Platform...'
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Host
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Host

Log 'Atualizando WSL e fixando versao 2...'
wsl.exe --update
wsl.exe --set-default-version 2

$loc = 'C:\WSL\Debian'
New-Item -ItemType Directory -Force -Path $loc | Out-Null

Log 'Instalando distro Debian no C:\WSL\Debian...'
$ok = $false
foreach ($args in @(
        @('--install', '-d', 'Debian', '--web-download', '--location', $loc, '--no-launch'),
        @('--install', '-d', 'Debian', '--web-download', '--no-launch'),
        @('--install', '-d', 'Debian', '--no-launch')
    )) {
    Log ('tentativa: wsl ' + ($args -join ' '))
    & wsl.exe @args
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Log ("falhou exit=$LASTEXITCODE")
}
if (-not $ok) {
    Log 'FALLBACK winget Debian.Debian'
    winget install --id Debian.Debian -e --accept-package-agreements --accept-source-agreements --disable-interactivity
}

Log 'Listando distros...'
wsl.exe -l -v | Out-Host
Log 'FIM'
exit 0
