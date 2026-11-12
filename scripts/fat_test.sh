#!/usr/bin/env bash
# FAT volume regression test.
#
# The desktop app boots the kernel on q35 with the paper-plane directory attached
# as a QEMU vvfat drive on the AHCI controller, so "the plane landed" is only
# true if the kernel can mount that volume and read the dropped file back out of
# it. This test locks in that path (FAT16 over AHCI), the FAT12/FAT16/FAT32
# reader over the legacy ATA driver, and write-through to the host.
#
# Usage: scripts/fat_test.sh [--iso PATH] [--log PATH] [--timeout SECS] [--no-images]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ISO_PATH="${REPO_ROOT}/target/postcard-spatial-os.iso"
LOG_PATH="${REPO_ROOT}/target/fat_test.log"
WORK_DIR="${REPO_ROOT}/target/fat-test"
TIMEOUT_SECS=180
USE_IMAGES=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --iso) ISO_PATH="$2"; shift 2 ;;
        --log) LOG_PATH="$2"; shift 2 ;;
        --timeout|-t) TIMEOUT_SECS="$2"; shift 2 ;;
        --no-images) USE_IMAGES=0; shift ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ ! -f "$ISO_PATH" ]]; then
    echo "ISO not found at $ISO_PATH, building..."
    "${SCRIPT_DIR}/create_iso.sh"
fi

mkdir -p "$(dirname "$LOG_PATH")" "$WORK_DIR"

echo "=== Running FAT volume regression test ==="

python3 - "$ISO_PATH" "$LOG_PATH" "$WORK_DIR" "$TIMEOUT_SECS" "$USE_IMAGES" << 'EOF'
import os
import re
import select
import shutil
import subprocess
import sys
import time

iso_path = sys.argv[1]
log_path = sys.argv[2]
work_dir = sys.argv[3]
timeout_secs = float(sys.argv[4])
use_images = sys.argv[5] == "1"

log_file = open(log_path, "w", encoding="utf-8")


def log_write(text):
    log_file.write(text)
    log_file.flush()


PLANE_BODY = "paper plane over p2p"
WRITE_BODY = "fat test write"

failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if condition:
        print(f"  [OK] {name}")
    else:
        print(f"  [FAIL] {name} {detail}")
        failures.append(name)


def read_until(proc, pattern, timeout):
    buf = ""
    start = time.time()
    while pattern not in buf:
        if time.time() - start > timeout:
            raise TimeoutError(f"timed out waiting for {pattern!r}. Received:\n{buf}")
        rlist, _, _ = select.select([proc.stdout], [], [], 0.2)
        if not rlist:
            if proc.poll() is not None:
                raise RuntimeError(f"QEMU exited {proc.returncode} waiting for {pattern!r}. Received:\n{buf}")
            continue
        raw = os.read(proc.stdout.fileno(), 4096)
        if not raw:
            if proc.poll() is not None:
                raise RuntimeError(f"EOF waiting for {pattern!r} (exit {proc.returncode}). Received:\n{buf}")
            continue
        chunk = raw.decode("utf-8", "replace")
        buf += chunk
        log_write(chunk)
    return buf


def run_case(name, machine_args, cmds, boot_timeout):
    """Boot the ISO, run cmds in the shell, return the whole serial transcript."""
    print(f"--- {name} ---")
    cmd = [
        "qemu-system-x86_64",
        "-name", f"postcard-fat-test-{name}",
        "-m", "512M",
        "-display", "none",
        "-serial", "stdio",
        "-no-reboot",
    ] + machine_args + [
        "-drive", f"file={iso_path},media=cdrom,if=ide,index=1,readonly=on",
        "-boot", "order=d",
    ]
    log_write(f"\n===== {name} =====\n{' '.join(cmd)}\n")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, bufsize=0)
    try:
        out = read_until(proc, "spatial> ", boot_timeout)
        for line in cmds:
            log_write(f"\n$ {line}\n")
            proc.stdin.write((line + "\n").encode())
            proc.stdin.flush()
            out += read_until(proc, "spatial> ", timeout_secs)
        return out
    finally:
        if proc.poll() is None:
            try:
                proc.stdin.write(b"halt\n")
                proc.stdin.flush()
                time.sleep(0.3)
            except Exception:
                pass
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        if proc.stdout and not proc.stdout.closed:
            proc.stdout.close()


# ---------------------------------------------------------------------------
# Case 1: the topology the desktop app uses - q35, AHCI, vvfat paper-plane dir.
# ---------------------------------------------------------------------------
drop_dir = os.path.join(work_dir, "plane-drop")
shutil.rmtree(drop_dir, ignore_errors=True)
os.makedirs(drop_dir, exist_ok=True)
with open(os.path.join(drop_dir, "plane-test.txt"), "w") as f:
    f.write(PLANE_BODY + "\n")

out = run_case(
    "q35-ahci-fat16",
    ["-machine", "q35", "-drive", f"file=fat:rw:{drop_dir},if=ide,index=2"],
    ["disks", "ls", "cat /plane-test.txt", f"write /POSTCARD/hello.txt {WRITE_BODY}", "sync"],
    boot_timeout=timeout_secs,
)

check("AHCI controller and drive are used", "ahci0" in out)
check("vvfat volume is recognised as FAT16", bool(re.search(r'FAT16 "QEMU VVFAT".*\[MOUNTED\]', out)))
check("the mounted volume is announced", '[ok] FAT persistence: mounted "QEMU VVFAT"' in out)
# Match the listing line, not the echoed command, so an unmounted volume fails.
check("root directory lists the landed plane", bool(re.search(r"bytes\s+plane-test\.txt", out)))
check("the landed plane reads back byte for byte", PLANE_BODY in out)
check("a file written from the guest is acknowledged",
      "[BLACK BOX] wrote /POSTCARD/hello.txt" in out)

host_writes = []
for root, _dirs, files in os.walk(drop_dir):
    for name in files:
        if name.lower() == "hello.txt":
            host_writes.append(os.path.join(root, name))
check("the guest write reached the host volume", len(host_writes) == 1,
      f"(found {host_writes})")
if len(host_writes) == 1:
    with open(host_writes[0]) as f:
        content = f.read().strip()
    check("the written file has the right content on the host", content == WRITE_BODY,
          f"(host content {content!r})")

# ---------------------------------------------------------------------------
# Case 2: FAT12 / FAT16 / FAT32 images over the legacy ATA driver.
# ---------------------------------------------------------------------------
mformat = shutil.which("mformat")
mcopy = shutil.which("mcopy")
if not use_images:
    print("--- fat12/fat16/fat32 over ATA: skipped (--no-images) ---")
elif not (mformat and mcopy):
    print("--- fat12/fat16/fat32 over ATA: skipped (mtools not installed) ---")
else:
    source = os.path.join(work_dir, "fat-test.txt")
    with open(source, "w") as f:
        f.write(PLANE_BODY + "\n")
    for label, args in (
        ("FAT12", ["-T", "2880"]),
        ("FAT16", ["-T", "65536"]),
        ("FAT32", ["-F", "-c", "1", "-T", "131072"]),
    ):
        image = os.path.join(work_dir, f"{label.lower()}.img")
        if os.path.exists(image):
            os.unlink(image)
        subprocess.run([mformat, "-i", image, "-C", "-v", "PLANE", *args, "::"], check=True)
        subprocess.run([mcopy, "-i", image, source, "::fat-test.txt"], check=True)
        out = run_case(
            f"ata-{label.lower()}",
            ["-machine", "pc", "-drive", f"file={image},format=raw,if=ide,index=0"],
            ["disks", "cat /fat-test.txt"],
            boot_timeout=timeout_secs,
        )
        check(f"{label} image mounts over ATA", bool(re.search(rf'{label} "PLANE" \[MOUNTED\]', out)))
        check(f"{label} file reads back", PLANE_BODY in out)

log_file.close()

print()
if failures:
    print(f"[FAIL] {len(failures)} of {checks} checks failed: {', '.join(failures)}")
    print(f"full log: {log_path}")
    sys.exit(1)
print(f"[OK] all {checks} FAT checks passed")
print(f"full log: {log_path}")
EOF
