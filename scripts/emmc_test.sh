#!/usr/bin/env bash
# eMMC / SDHCI storage regression test.
#
# The Dell Latitude 3120 boots from eMMC behind a Jasper Lake SDHCI controller,
# not from NVMe. blockdev.rs carries an SDHCI transport for that path, and this
# test locks it in: it builds a real MBR disk with a FAT16 partition, attaches it
# to an emulated sdhci-pci controller, and drives the shell until a file on the
# card has been read back and a file written from the guest has reached the host
# image byte for byte.
#
# The last case types "cat /plane-emmc.txt" over the PS/2 keyboard rather than
# the serial line, because a laptop user only has the keyboard: the shell echo
# has to contain the slash and the dot for a path to be typeable at all.
#
# Usage: scripts/emmc_test.sh [--iso PATH] [--log PATH] [--timeout SECS] [--no-images]
# Requires: qemu-system-x86_64 on PATH, mtools (mformat/mcopy) unless --no-images.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ISO_PATH="${REPO_ROOT}/target/postcard-spatial-os.iso"
LOG_PATH="${REPO_ROOT}/target/emmc_test.log"
WORK_DIR="${REPO_ROOT}/target/emmc-test"
TIMEOUT_SECS=240
USE_IMAGES=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --iso) ISO_PATH="$2"; shift 2 ;;
        --log) LOG_PATH="$2"; shift 2 ;;
        --timeout|-t) TIMEOUT_SECS="$2"; shift 2 ;;
        --no-images) USE_IMAGES=0; shift ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ ! -f "$ISO_PATH" ]]; then
    echo "ISO not found at $ISO_PATH, building..."
    "${SCRIPT_DIR}/create_iso.sh"
fi

mkdir -p "$(dirname "$LOG_PATH")" "$WORK_DIR"

echo "=== Running eMMC / SDHCI storage regression test ==="

python3 - "$ISO_PATH" "$LOG_PATH" "$WORK_DIR" "$TIMEOUT_SECS" "$USE_IMAGES" << 'EOF'
import json
import os
import select
import shutil
import socket
import struct
import subprocess
import sys
import time

iso_path, log_path, work_dir = sys.argv[1], sys.argv[2], sys.argv[3]
timeout_secs, use_images = float(sys.argv[4]), sys.argv[5] == "1"

DISK_BYTES = 64 * 1024 * 1024
PART_LBA = 2048
PART_SECTORS = DISK_BYTES // 512 - PART_LBA
CARD_BODY = "landed on the dell eMMC"
WRITE_BODY = "emmc test write"
WRITE_NAME = "note.txt"

log_file = open(log_path, "w", encoding="utf-8")


def log_write(text):
    log_file.write(text)
    log_file.flush()


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


def read_until(proc, pattern, timeout, buf=""):
    start = time.time()
    while pattern not in buf:
        if time.time() - start > timeout:
            raise TimeoutError(f"timed out waiting for {pattern!r}. Received:\n{buf[-2000:]}")
        rlist, _, _ = select.select([proc.stdout], [], [], 0.2)
        if not rlist:
            if proc.poll() is not None:
                raise RuntimeError(f"QEMU exited {proc.returncode} waiting for {pattern!r}. Received:\n{buf[-2000:]}")
            continue
        raw = os.read(proc.stdout.fileno(), 4096)
        if not raw:
            if proc.poll() is not None:
                raise RuntimeError(f"EOF waiting for {pattern!r} (exit {proc.returncode}). Received:\n{buf[-2000:]}")
            continue
        chunk = raw.decode("utf-8", "replace")
        buf += chunk
        log_write(chunk)
    return buf


# ---------------------------------------------------------------------------
# Build an MBR disk with one FAT16 partition - the shape of a real eMMC card.
# ---------------------------------------------------------------------------
if not use_images:
    print("--- eMMC: skipped (--no-images) ---")
elif not (shutil.which("mformat") and shutil.which("mcopy")):
    print("--- eMMC: skipped (mtools not installed: mformat/mcopy) ---")
else:
    disk = os.path.join(work_dir, "emmc.raw")
    part = os.path.join(work_dir, "emmc-part.img")
    source = os.path.join(work_dir, "plane-emmc.txt")
    with open(source, "w") as f:
        f.write(CARD_BODY + "\n")

    with open(part, "wb") as f:
        f.truncate(PART_SECTORS * 512)
    subprocess.run(["mformat", "-i", part, "-T", str(PART_SECTORS), "-h", "64", "-s", "32",
                    "-v", "EMMCDATA", "::"], check=True)
    subprocess.run(["mcopy", "-i", part, source, "::/plane-emmc.txt"], check=True)
    subprocess.run(["mcopy", "-i", part, source, "::/PLANE-EM.TXT"], check=True)

    mbr = bytearray(512)
    mbr[446] = 0x80          # bootable
    mbr[450] = 0x06          # FAT16, CHS-addressed
    mbr[451:454] = bytes([0xFE, 0xFF, 0xFF])
    struct.pack_into("<II", mbr, 454, PART_LBA, PART_SECTORS)
    mbr[510:512] = b"\x55\xaa"

    with open(disk, "wb") as out:
        out.write(mbr)
        out.truncate(DISK_BYTES)
    with open(part, "rb") as src, open(disk, "r+b") as out:
        out.seek(PART_LBA * 512)
        shutil.copyfileobj(src, out)

    # -----------------------------------------------------------------------
    # Boot with the card on an emulated SDHCI controller and drive the shell.
    # -----------------------------------------------------------------------
    qmp_sock = os.path.join(work_dir, "qmp.sock")
    if os.path.exists(qmp_sock):
        os.unlink(qmp_sock)

    cmd = [
        "qemu-system-x86_64",
        "-name", "postcard-emmc-test",
        "-machine", "q35",
        "-m", "2048M",
        "-display", "none",
        "-serial", "stdio",
        "-no-reboot",
        "-device", "sdhci-pci",
        "-drive", f"if=none,id=sd0,file={disk},format=raw",
        "-device", "sd-card,drive=sd0",
        "-drive", f"file={iso_path},media=cdrom,if=ide,index=1,readonly=on",
        "-boot", "order=d",
        "-qmp", f"unix:{qmp_sock},server=on,wait=off",
    ]
    log_write("\n===== eMMC on sdhci-pci =====\n" + " ".join(cmd) + "\n")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, bufsize=0)

    serial_cmds = ["disks", "mount", "ls", "cat /plane-emmc.txt",
                   f"write {WRITE_NAME} {WRITE_BODY}", "sync", "ls", f"cat {WRITE_NAME}"]
    ps2_out = ""
    try:
        out = read_until(proc, "spatial> ", timeout_secs)
        for line in serial_cmds:
            log_write(f"\n$ {line}\n")
            proc.stdin.write((line + "\n").encode())
            proc.stdin.flush()
            out += read_until(proc, "spatial> ", timeout_secs)

        # A laptop user has only the keyboard, so type the last path over PS/2.
        qcode = {" ": "spc", ".": "dot", "-": "minus", "/": "slash", "\n": "ret"}
        try:
            qmp = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            qmp.settimeout(5)
            qmp.connect(qmp_sock)
            qmp.recv(65536)
            qmp.sendall(b'{"execute":"qmp_capabilities"}\n')
            time.sleep(0.3)
            qmp.recv(65536)
            typed = "cat /plane-emmc.txt\n"
            log_write(f"\n$ (typed on the PS/2 keyboard) {typed.strip()}\n")
            for ch in typed:
                key = qcode.get(ch) or ch.lower()
                qmp.sendall((json.dumps({"execute": "send-key",
                                         "arguments": {"keys": [{"type": "qcode", "data": key}]}}) + "\n").encode())
                time.sleep(0.05)
                try:
                    qmp.settimeout(0.05)
                    qmp.recv(4096)
                except Exception:
                    pass
            ps2_out = read_until(proc, "spatial> ", timeout_secs)
            out += ps2_out
            qmp.close()
        except Exception as exc:  # noqa: BLE001 - reported as a failed check
            print(f"  [FAIL] PS/2 typing could not be driven: {exc}")
            failures.append("PS/2 typing could not be driven")
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

    check("the SDHCI controller is found", "SDHCI eMMC/SD controller identified" in out)
    check("the card answers and reports its capacity", 'mmc0: SDHCI "SD QEMU!"' in out)
    check("the partition is seen on the card", "mmc0 part 1 MBR LBA" in out)
    check("the FAT16 volume is mounted", '[ok] FAT persistence: mounted "EMMCDATA"' in out)
    check("the card's file is listed", "plane-emmc.txt" in out and "PLANE-EM.TXT" in out)
    check("the card's file reads back", CARD_BODY in out)
    check("a file written from the guest is acknowledged",
          f"[BLACK BOX] wrote {WRITE_NAME}" in out)
    check("the written file reads back", out.rfind(WRITE_BODY) > out.rfind(f"$ cat {WRITE_NAME}"))
    check("a path typed on the PS/2 keyboard keeps its slash and dot",
          "cat /plane-emmc.txt" in ps2_out)
    check("the keyboard-typed path reads the card", CARD_BODY in ps2_out)

    # The guest write has to be on the card, not only in a cache.
    with open(disk, "rb") as f:
        image = f.read()
    check("the guest write reached the card image", WRITE_BODY.encode() in image,
          f"({len(image)} bytes scanned)")

print()
print(f"=== eMMC result: {checks - len(failures)}/{checks} checks passed ===")
log_file.close()
sys.exit(1 if failures else 0)
EOF

STATUS=$?
if [[ $STATUS -eq 0 ]]; then
    echo "[OK] eMMC / SDHCI regression test passed"
else
    echo "[FAIL] eMMC / SDHCI regression test failed (see ${LOG_PATH})"
fi
exit $STATUS
