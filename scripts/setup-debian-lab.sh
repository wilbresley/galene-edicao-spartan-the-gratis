#!/usr/bin/env bash
# Debian WSL: /home/docker/<app> para Compose; Distrobox so para testar programas.
set -euo pipefail

USER_NAME="${SUDO_USER:-${LAB_USER:-wilian}}"
if [[ "$(id -u)" -eq 0 && "$USER_NAME" == "root" ]]; then
  USER_NAME="wilian"
fi
REPO="${REPO:-/mnt/s/Workspaces/galene-edicao-spartan}"
BOX_NAME="${BOX_NAME:-galene-lab}"

echo "==> Debian lab: usuario=$USER_NAME repo=$REPO box=$BOX_NAME"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  sudo curl ca-certificates gnupg git uidmap slirp4netns fuse-overlayfs \
  podman crun iptables iproute2 procps python3 \
  passwd adduser distrobox docker.io docker-cli

# compose v2 (plugin) se existir; senao docker-compose v1
apt-get install -y --no-install-recommends docker-compose-v2 2>/dev/null || \
  apt-get install -y --no-install-recommends docker-compose

if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos 'Galene lab' "$USER_NAME"
fi
usermod -aG sudo,docker "$USER_NAME"
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$USER_NAME"
chmod 440 "/etc/sudoers.d/$USER_NAME"

cat > /etc/wsl.conf <<EOF
[boot]
systemd=true
command = mount --make-rshared /

[user]
default=$USER_NAME

[network]
generateResolvConf=true

[interop]
enabled=true
appendWindowsPath=true
EOF

HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
BOX_HOME="$HOME_DIR/boxes/$BOX_NAME"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$HOME_DIR/boxes" "$BOX_HOME" "$HOME_DIR/bin"
mkdir -p /etc/containers
if [[ ! -f /home/$USER_NAME/.config/containers/containers.conf ]]; then
  install -d -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.config/containers"
  cat > "/home/$USER_NAME/.config/containers/containers.conf" <<'EOF'
[engine]
cgroup_manager = "cgroupfs"
EOF
  chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.config/containers/containers.conf"
fi

loginctl enable-linger "$USER_NAME" 2>/dev/null || true
systemctl enable --now docker
systemctl start user@1000.service 2>/dev/null || true
mount --make-rshared / 2>/dev/null || true

install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /home/docker /home/docker/galene

echo "==> Distrobox $BOX_NAME (para testar programas; Docker fica em /home/docker)"
if sudo -u "$USER_NAME" -H distrobox list 2>/dev/null | grep -qw "$BOX_NAME"; then
  echo "    box ja existe — pulando create"
else
  sudo -u "$USER_NAME" -H distrobox create \
    --name "$BOX_NAME" \
    --image docker.io/library/debian:12 \
    --home "$BOX_HOME" \
    --yes \
    --additional-packages "ca-certificates curl git python3"
fi

echo "==> Galene em /home/docker/galene (codigo do Cursor montado, dados vivos aqui)"
if [[ ! -f $REPO/scripts/lab-boot.py ]]; then
  echo "ERRO: repo nao montado em $REPO"
  exit 1
fi
python3 -c "p='$REPO/scripts/lab-boot.py'; d=open(p,'rb').read().replace(b'\\r\\n',b'\\n').replace(b'\\r',b'\\n'); open('/tmp/lab-boot.py','wb').write(d)"
GALENE_SRC="$REPO" python3 /tmp/lab-boot.py

echo
echo "=============================================="
echo " Docker: /home/docker/galene"
echo " Distrobox $BOX_NAME: programas (nao e Docker)"
echo " Wipe Galene: cd /home/docker/galene && docker compose down -v"
echo " Home:  http://127.0.0.1:8443/"
echo " Sala:  http://127.0.0.1:8443/group/spartan/"
echo " Admin: http://127.0.0.1:8443/admin/"
echo "=============================================="
