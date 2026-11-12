#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

KERNEL_DIR="${REPO_ROOT}/kernel"
KERNEL_TARGET="x86_64-unknown-none"
KERNEL_NAME="postcard-minimal-kernel"
RAMDISK_IMG="${REPO_ROOT}/ramdisk.img"
ISO_DIR="${REPO_ROOT}/target/iso"
BOOT_DIR="${ISO_DIR}/boot"
GRUB_DIR="${BOOT_DIR}/grub"
ISO_FILE="${REPO_ROOT}/target/postcard-spatial-os.iso"

# `cargo build` inside kernel/ writes to kernel/target, while older builds left the
# ELF in the repo-root target/. Accept either so a stale copy cannot be shipped.
find_kernel_elf() {
    local candidate
    for candidate in \
        "${KERNEL_DIR}/target/${KERNEL_TARGET}/release/${KERNEL_NAME}" \
        "${REPO_ROOT}/target/${KERNEL_TARGET}/release/${KERNEL_NAME}"; do
        if [[ -f "${candidate}" ]]; then
            echo "${candidate}"
            return 0
        fi
    done
    return 1
}

build_kernel() {
    if ! command -v cargo &>/dev/null; then
        if [[ -f "${HOME}/.cargo/env" ]]; then
            # shellcheck disable=SC1091
            source "${HOME}/.cargo/env"
        fi
    fi
    if ! command -v cargo &>/dev/null; then
        echo "Error: kernel ELF is missing and cargo was not found." >&2
        echo "Install Rust (https://rustup.rs), then run: rustup target add ${KERNEL_TARGET}" >&2
        exit 1
    fi
    echo "=== Building kernel (${KERNEL_TARGET}, release) ==="
    # Run cargo from inside kernel/ so kernel/.cargo/config.toml is picked up. That file
    # supplies -Tlinker.ld, relocation-model=static and code-model=kernel; building with
    # --manifest-path from the repo root silently ignores it and produces a PIE with no
    # Multiboot2 header, which cannot boot.
    (
        cd "${KERNEL_DIR}"
        CARGO_INCREMENTAL=0 cargo build --release --target "${KERNEL_TARGET}"
    )
}

KERNEL_ELF="$(find_kernel_elf || true)"
if [[ -z "${KERNEL_ELF}" ]]; then
    build_kernel
    KERNEL_ELF="$(find_kernel_elf || true)"
fi
if [[ -z "${KERNEL_ELF}" ]]; then
    echo "Error: kernel ELF not found after building (looked in kernel/target and target/)" >&2
    exit 1
fi
echo "Using kernel: ${KERNEL_ELF}"

if command -v grub-file &>/dev/null; then
    if grub-file --is-x86-multiboot2 "${KERNEL_ELF}"; then
        echo "Multiboot2 header verified for ${KERNEL_ELF}"
    else
        echo "Error: ${KERNEL_ELF} is not a valid Multiboot2 ELF" >&2
        exit 1
    fi
fi

rm -rf "${ISO_DIR}"
mkdir -p "${GRUB_DIR}"

cp "${KERNEL_ELF}" "${BOOT_DIR}/kernel.elf"
if [[ -f "${RAMDISK_IMG}" ]]; then
    cp "${RAMDISK_IMG}" "${BOOT_DIR}/ramdisk.img"
fi

cat > "${GRUB_DIR}/grub.cfg" << 'EOF'
insmod all_video
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

# An ISO with no El Torito boot record cannot boot, and grub-mkrescue exits 0 while
# producing exactly that when it cannot find its platform modules. Always verify.
iso_is_bootable() {
    local iso="$1"
    if ! command -v xorriso &>/dev/null; then
        return 0
    fi
    xorriso -indev "${iso}" -report_el_torito plain 2>/dev/null | grep -q "El Torito"
}

grub_module_dir() {
    local dir
    for dir in \
        /usr/lib/grub/i386-pc \
        /usr/lib/grub/x86_64-pc/i386-pc \
        "$(dirname "$(command -v grub-mkimage 2>/dev/null || true)")/../lib/grub/i386-pc"; do
        if [[ -d "${dir}" ]]; then
            echo "${dir}"
            return 0
        fi
    done
    return 1
}

build_iso_manually() {
    local moddir
    if ! moddir="$(grub_module_dir)"; then
        echo "Error: could not locate the GRUB i386-pc module directory" >&2
        return 1
    fi
    if ! command -v grub-mkimage &>/dev/null || ! command -v xorriso &>/dev/null; then
        echo "Error: grub-mkimage and xorriso are both required for the fallback ISO build" >&2
        return 1
    fi

    echo "=== Building ISO manually (grub-mkimage + xorriso) ==="
    mkdir -p "${GRUB_DIR}/i386-pc"
    grub-mkimage -d "${moddir}" -O i386-pc-eltorito \
        -o "${GRUB_DIR}/i386-pc/eltorito.img" -p /boot/grub \
        biosdisk part_msdos part_gpt fat iso9660 normal search search_fs_uuid \
        search_label configfile multiboot2 serial terminal echo test all_video \
        gfxterm boot ls cat
    cp "${moddir}"/*.mod "${moddir}"/*.lst "${GRUB_DIR}/i386-pc/" 2>/dev/null || true
    xorriso -as mkisofs -o "${ISO_FILE}" \
        -b boot/grub/i386-pc/eltorito.img -no-emul-boot -boot-load-size 4 \
        -boot-info-table -R -J -V "POSTCARD_OS" "${ISO_DIR}"
}

echo "=== Generating Multiboot2 ISO (UEFI + Legacy BIOS + Rufus/Etcher Ready) ==="
if command -v grub-mkrescue &>/dev/null; then
    grub-mkrescue -o "${ISO_FILE}" "${ISO_DIR}" -- -volid "POSTCARD_OS" || true
fi

if [[ ! -s "${ISO_FILE}" ]] || ! iso_is_bootable "${ISO_FILE}"; then
    echo "Warning: grub-mkrescue did not produce a bootable ISO; falling back to a manual build" >&2
    build_iso_manually
fi

if [[ ! -s "${ISO_FILE}" ]]; then
    echo "Error: Failed to create ISO at ${ISO_FILE}" >&2
    exit 1
fi

if ! iso_is_bootable "${ISO_FILE}"; then
    echo "Error: ${ISO_FILE} has no El Torito boot record, so it cannot boot." >&2
    exit 1
fi

ISO_SIZE=$(stat -c%s "${ISO_FILE}")
echo "Bootable ISO successfully created: ${ISO_FILE} (${ISO_SIZE} bytes)"
