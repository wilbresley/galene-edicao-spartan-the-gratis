#!/usr/bin/env python3
"""Garante /home/docker/galene e sobe o stack. Distrobox nao entra aqui."""
import os
import shutil
import subprocess
import time

SRC = os.environ.get("GALENE_SRC", "/mnt/s/Workspaces/galene-edicao-spartan")
APP = os.environ.get("GALENE_APP", "/home/docker/galene")
USER_NAME = os.environ.get("LAB_USER", "wilian")


def sh(c, check=True):
    print("+", c, flush=True)
    subprocess.run(c, shell=True, check=check)


def copy_lf(src, dst):
    data = open(src, "rb").read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "wb").write(data)


def chown_tree(path):
    sh(f"chown -R {USER_NAME}:{USER_NAME} {path}", check=False)


def ensure_layout():
    sh(f"install -d -o {USER_NAME} -g {USER_NAME} -m 0755 /home/docker {APP} {APP}/data {APP}/groups {APP}/recordings")
    copy_lf(f"{SRC}/scripts/lab/compose.yaml", f"{APP}/compose.yaml")
    copy_lf(f"{SRC}/scripts/lab/compose.override.yaml", f"{APP}/compose.override.yaml")
    copy_lf(f"{SRC}/scripts/local-nginx.conf", f"{APP}/nginx.conf")
    env = f"{APP}/.env"
    if not os.path.isfile(env):
        open(env, "w", newline="\n").write(
            f"TURN_PUBLIC_IP=127.0.0.1\nGALENE_SRC={SRC}\n"
        )
    else:
        txt = open(env, encoding="utf-8").read()
        if "GALENE_SRC=" not in txt:
            open(env, "a", encoding="utf-8", newline="\n").write(f"GALENE_SRC={SRC}\n")
    leia = "/home/docker/LEIA-ME.txt"
    if not os.path.isfile(leia):
        open(leia, "w", newline="\n").write(
            "Pasta dos stacks Docker neste Debian WSL.\n"
            "Cada app numa pasta com o nome dela. Ex.: /home/docker/galene\n"
            "\n"
            "Distrobox NAO e para Docker — e para testar programas no Linux.\n"
            "Wipe do Galene: cd /home/docker/galene && docker compose down -v\n"
            "O Debian e as outras pastas em /home/docker ficam intactos.\n"
        )
    factory = f"{SRC}/factory-reset"
    pairs = [
        (f"{factory}/config.json", f"{APP}/data/config.json"),
        (f"{factory}/site.json", f"{APP}/data/site.json"),
        (f"{factory}/accounts.json", f"{APP}/data/accounts.json"),
        (f"{factory}/registry.json", f"{APP}/data/registry.json"),
        (f"{factory}/sidecar.auth", f"{APP}/data/sidecar.auth"),
        (f"{factory}/spartan.json", f"{APP}/groups/spartan.json"),
    ]
    force = os.environ.get("FORCE_FACTORY", "").strip().lower() in ("1", "true", "yes")
    if force:
        groups_dir = f"{APP}/groups"
        if os.path.isdir(groups_dir):
            for name in os.listdir(groups_dir):
                if name == "spartan.json":
                    continue
                p = os.path.join(groups_dir, name)
                if os.path.isfile(p):
                    os.remove(p)
        for extra in ("servers.json", "access.log", "net.log"):
            p = f"{APP}/data/{extra}"
            if os.path.isfile(p):
                os.remove(p)
        chat = f"{APP}/data/chat-files"
        if os.path.isdir(chat):
            shutil.rmtree(chat, ignore_errors=True)
    for src, dst in pairs:
        if not os.path.isfile(src):
            continue
        if force or not os.path.isfile(dst):
            shutil.copy2(src, dst)
    if os.path.isfile(f"{APP}/data/sidecar.auth"):
        os.chmod(f"{APP}/data/sidecar.auth", 0o600)
    chown_tree("/home/docker")


def ensure_image():
    r = subprocess.run("docker image inspect galene:local", shell=True, capture_output=True)
    if r.returncode != 0:
        tgz = f"{SRC}/images/galene-local.tgz"
        sh(f"docker load -i {tgz}")


def stop_old_repo_compose():
    if os.path.isfile(f"{SRC}/compose.yaml"):
        sh(f"cd {SRC} && docker compose down --remove-orphans", check=False)


def up():
    sh("systemctl start docker")
    sh(f"cd {APP} && docker compose up -d --remove-orphans")
    subprocess.call("pkill nginx", shell=True)
    time.sleep(1)
    sh("systemctl disable --now nginx", check=False)
    sh(f"nginx -c {APP}/nginx.conf")


def main():
    ensure_layout()
    ensure_image()
    stop_old_repo_compose()
    up()
    sh("docker ps")
    sh("curl -s -o /dev/null -w home:%{http_code}\\n http://127.0.0.1:8443/")


if __name__ == "__main__":
    main()
