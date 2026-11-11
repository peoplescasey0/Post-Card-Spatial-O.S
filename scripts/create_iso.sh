#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Ensure kernel exists; build if missing and cargo is available
KERNEL_ELF="${REPO_ROOT}/target/x86_64-unknown-none/release/postcard-minimal-kernel"

if [[ ! -f "${KERNEL_ELF}" ]]; then
    if ! command -v cargo &>/dev/null; then
        if [[ -f "${HOME}/.cargo/env" ]]; then
            source "${HOME}/.cargo/env"
        fi
    fi
    if ! command -v cargo &>/dev/null; then
        echo "Error: ${KERNEL_ELF} missing and cargo not found" >&2
        exit 1
    fi
    export CARGO_INCREMENTAL=0
    "${SCRIPT_DIR}/build_kernel.sh"
fi

if [[ ! -f "${KERNEL_ELF}" ]]; then
    echo "Error: Kernel ELF not found at ${KERNEL_ELF}" >&2
    exit 1
fi

# Verify Multiboot2 heade
if command -v grub-file &>/dev/null; then
    if grub-file --is-x86-multiboot2 "${KERNEL_ELF}"; then
        echo "Multiboot2 header verified for ${KERNEL_ELF}"
    else
        echo "Error: ${KERNEL_ELF} is not a valid Multiboot2 ELF" >&2
        exit 1
    fi
fi

# Prepare ISO staging directory
RAMDISK_IMG="${REPO_ROOT}/ramdisk.img"
ISO_DIR="${REPO_ROOT}/target/iso"
BOOT_DIR="${ISO_DIR}/boot"
GRUB_DIR="${BOOT_DIR}/grub"
ISO_FILE="${REPO_ROOT}/target/postcard-spatial-os.iso"

rm -rf "${ISO_DIR}"
mkdir -p "${GRUB_DIR}"

cp "${KERNEL_ELF}" "${BOOT_DIR}/kernel.elf"
if [[ -f "${RAMDISK_IMG}" ]]; then
    cp "${RAMDISK_IMG}" "${BOOT_DIR}/ramdisk.img"
fi

cat > "${GRUB_DIR}/grub.cfg" << 'EOF'
insmod all_video
insmod efi_gop
insmod gfxterm
insmod part_gpt
insmod part_msdos
insmod fat
insmod iso9660
insmod multiboot2

serial --unit=0 --speed=115200
terminal_input serial console
terminal_output serial console
set gfxmode=auto
set gfxpayload=keep
set timeout=0
set default=0

menuentry "Post Card Spatial OS" {
    search --no-floppy --file --set=root /boot/kernel.elf
    multiboot2 /boot/kernel.elf console=ttyS0 console=tty0
    if [ -f /boot/ramdisk.img ]; then
        module2 /boot/ramdisk.img
    fi
    boot
}
EOF

echo "=== Generating Hybrid Multiboot2 ISO (UEFI + Legacy BIOS + Rufus/Etcher Ready) ==="
if ! command -v grub-mkrescue &>/dev/null; then
    echo "Error: grub-mkrescue not found" >&2
    exit 1
fi

grub-mkrescue -o "${ISO_FILE}" "${ISO_DIR}" -- -volid "POSTCARD_OS"

if [[ ! -s "${ISO_FILE}" ]]; then
    echo "Error: Failed to create ISO at ${ISO_FILE}" >&2
    exit 1
fi

ISO_SIZE=$(stat -c%s "${ISO_FILE}")
echo "Bootable ISO successfully created: ${ISO_FILE} (${ISO_SIZE} bytes)"
