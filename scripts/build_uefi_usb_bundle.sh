#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLE="${REPO_ROOT}/target/usb-deploy-bundle"
KERNEL_ELF="${REPO_ROOT}/target/x86_64-unknown-none/release/postcard-minimal-kernel"
RAMDISK_IMG="${REPO_ROOT}/ramdisk.img"

mkdir -p "${BUNDLE}/EFI/BOOT" "${BUNDLE}/boot/grub" "${BUNDLE}/scripts"

cp "${KERNEL_ELF}" "${BUNDLE}/postcard-kernel-v1.0.4-x86_64"
cp "${KERNEL_ELF}" "${BUNDLE}/postcard-kernel"
cp "${KERNEL_ELF}" "${BUNDLE}/boot/postcard-kernel-v1.0.4-x86_64"
cp "${KERNEL_ELF}" "${BUNDLE}/boot/kernel.elf"

cp "${RAMDISK_IMG}" "${BUNDLE}/initrd.img"
cp "${RAMDISK_IMG}" "${BUNDLE}/boot/initrd.img"
cp "${RAMDISK_IMG}" "${BUNDLE}/boot/ramdisk.img"

cp "${SCRIPT_DIR}/rapid_deploy_installer.sh" "${BUNDLE}/rapid_deploy_installer.sh"
cp "${SCRIPT_DIR}/rapid_deploy_installer.sh" "${BUNDLE}/scripts/rapid_deploy_installer.sh"

cat > "${BUNDLE}/boot/grub/grub.cfg" << 'EOF'
insmod all_video
insmod efi_gop
insmod gfxterm
insmod part_gpt
insmod part_msdos
insmod fat
insmod ext2
insmod multiboot2
insmod linux
insmod serial

serial --unit=0 --speed=115200
terminal_input serial console
terminal_output serial gfxterm

set gfxmode=auto
set gfxpayload=keep
set timeout=5
set default=0

menuentry "Post Card Spatial OS // Space Plane Avionics (Universal Auto-Mount Boot)" {
    if [ -f (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 ]; then
        multiboot2 (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0 console=tty0
        if [ -f (memdisk)/boot/initrd.img ]; then
            module2 (memdisk)/boot/initrd.img
        fi
    else
        search --no-floppy --file --set=root /boot/postcard-kernel-v1.0.4-x86_64
        multiboot2 /boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0 console=tty0
        if [ -f /boot/initrd.img ]; then
            module2 /boot/initrd.img
        fi
    fi
    boot
}

menuentry "Post Card Spatial OS // Space Plane Avionics (Screen-Only No-Serial Mode)" {
    if [ -f (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 ]; then
        multiboot2 (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 console=tty0 noserial
        if [ -f (memdisk)/boot/initrd.img ]; then
            module2 (memdisk)/boot/initrd.img
        fi
    else
        search --no-floppy --file --set=root /boot/postcard-kernel-v1.0.4-x86_64
        multiboot2 /boot/postcard-kernel-v1.0.4-x86_64 console=tty0 noserial
        if [ -f /boot/initrd.img ]; then
            module2 /boot/initrd.img
        fi
    fi
    boot
}

menuentry "Post Card Spatial OS // Safe Mode (RAM-Only / No Block Device Probe)" {
    if [ -f (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 ]; then
        multiboot2 (memdisk)/boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0 console=tty0 nostorage
    else
        search --no-floppy --file --set=root /boot/postcard-kernel-v1.0.4-x86_64
        multiboot2 /boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0 console=tty0 nostorage
    fi
    boot
}

menuentry "UEFI Firmware Settings (BIOS / Setup)" {
    fwsetup
}

menuentry "Reboot System" {
    reboot
}
EOF

sed -i 's/\r$//' "${BUNDLE}/boot/grub/grub.cfg"
cp "${BUNDLE}/boot/grub/grub.cfg" "${BUNDLE}/grub.cfg"

grub-mkstandalone \
  -O x86_64-efi \
  -o "${BUNDLE}/EFI/BOOT/BOOTX64.EFI" \
  "boot/grub/grub.cfg=${BUNDLE}/boot/grub/grub.cfg" \
  "boot/postcard-kernel-v1.0.4-x86_64=${BUNDLE}/boot/postcard-kernel-v1.0.4-x86_64" \
  "boot/initrd.img=${BUNDLE}/boot/initrd.img"

cp "${BUNDLE}/EFI/BOOT/BOOTX64.EFI" "${BUNDLE}/EFI/BOOT/grubx64.efi"

ISO_FILE="${REPO_ROOT}/target/postcard-spatial-os.iso"
grub-mkrescue -o "${ISO_FILE}" "${BUNDLE}"

echo "=== Built UEFI + BIOS Multiboot2 USB Bundle & Hybrid ISO ==="
ls -lh "${BUNDLE}/EFI/BOOT/BOOTX64.EFI" "${BUNDLE}/boot/grub/grub.cfg" "${ISO_FILE}"
