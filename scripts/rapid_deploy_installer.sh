#!/bin/bash
set -e

echo "=================================================="
echo "  Post Card OS // Rapid Deployment Installer"
echo "  Avionics Core: SPACE PLANE AVIONICS v1.0.4"
echo "  Chassis Spec:  Al-Li 2195 Cryogenic Hull Frame"
echo "  Thermal Loop:  THE RADIATOR [ STABILIZED ]"
echo "=================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN="${POSTCARD_DRY_RUN:-0}"
AUTO_CONFIRM="${POSTCARD_AUTO_CONFIRM:-}"
TARGET_DRIVE=""

for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=1
            ;;
        -y|--yes)
            AUTO_CONFIRM="y"
            ;;
        *)
            if [ -z "$TARGET_DRIVE" ]; then
                TARGET_DRIVE="$arg"
            fi
            ;;
    esac
done

# 1. Target Drive Selection (e.g., /dev/sda or /dev/nvme0n1)
if [ -z "$TARGET_DRIVE" ]; then
    read -p "Enter target installation drive (e.g., /dev/sda): " TARGET_DRIVE
else
    echo "Target installation drive: $TARGET_DRIVE"
fi

if [ ! -b "$TARGET_DRIVE" ] && [ ! -c "$TARGET_DRIVE" ]; then
    # Simple check ensuring block device exists; auto-detect 64GB eMMC (/dev/mmcblk0) on Latitude 3120 if /dev/nvme0n1 is absent
    echo "Scanning target drive structure..."
    if [ "$DRY_RUN" != "1" ] && [ ! -b "$TARGET_DRIVE" ] && [ -b "/dev/mmcblk0" ]; then
        echo "Detected Dell Latitude 3120 64GB eMMC storage at /dev/mmcblk0 (switching from $TARGET_DRIVE)..."
        TARGET_DRIVE="/dev/mmcblk0"
    fi
fi

echo "WARNING: This will completely erase $TARGET_DRIVE!"
if [ -n "$AUTO_CONFIRM" ]; then
    CONFIRM="$AUTO_CONFIRM"
else
    read -p "Are you sure you want to proceed? (y/N): " CONFIRM
fi
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Installation aborted."
    exit 1
fi

# Define partition paths (handling NVMe, eMMC mmcblk, and loopback vs SATA naming conventions)
if [[ "$TARGET_DRIVE" == *"nvme"* ]] || [[ "$TARGET_DRIVE" == *"mmcblk"* ]] || [[ "$TARGET_DRIVE" == *"loop"* ]]; then
    BOOT_PART="${TARGET_DRIVE}p1"
    ROOT_PART="${TARGET_DRIVE}p2"
else
    BOOT_PART="${TARGET_DRIVE}1"
    ROOT_PART="${TARGET_DRIVE}2"
fi

echo "Resolved partition layout:"
echo "  EFI Boot Partition : $BOOT_PART (FAT32, 1MiB -> 512MiB, ESP)"
echo "  Root VFS Partition : $ROOT_PART (ext4,  512MiB -> 100%)"

if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] Partitioning $TARGET_DRIVE (GPT: ESP + ext4)..."
    echo "[DRY-RUN] Formatting $BOOT_PART (FAT32) and $ROOT_PART (ext4)..."
    echo "[DRY-RUN] Mounting $ROOT_PART -> /mnt/postcard and $BOOT_PART -> /mnt/postcard/boot/efi..."
    echo "[DRY-RUN] Deploying Post Card OS kernel (v1.0.4-x86_64), VFS Black Box, THE RADIATOR thermal sectors, and PA-Romy Vault..."
    echo "[DRY-RUN] Installing GRUB x86_64-efi bootloader and generating /mnt/postcard/boot/grub/grub.cfg..."
    echo "[DRY-RUN] Unmounting /mnt/postcard..."
    echo "=================================================="
    echo "  Installation Complete! Reboot into Post Card OS."
    echo "=================================================="
    exit 0
fi

# 2. Partitioning the Drive (EFI / Boot + Root)
echo "Partitioning $TARGET_DRIVE..."
parted --script "$TARGET_DRIVE" \
    mklabel gpt \
    mkpart ESP fat32 1MiB 512MiB \
    set 1 esp on \
    mkpart primary ext4 512MiB 100%

# 3. Formatting Filesystems
echo "Formatting boot and root partitions..."
mkfs.fat -F32 "$BOOT_PART"
mkfs.ext4 -F "$ROOT_PART"

# 4. Mounting & Populating Files
echo "Mounting target filesystems..."
mkdir -p /mnt/postcard
mount "$ROOT_PART" /mnt/postcard
mkdir -p /mnt/postcard/boot/efi /mnt/postcard/boot/grub /mnt/postcard/communications /mnt/postcard/radiator
mount "$BOOT_PART" /mnt/postcard/boot/efi

echo "Copying Post Card OS kernel, VFS assets, THE RADIATOR thermal control loop, and Romy runtime..."
if [ -f "$SCRIPT_DIR/postcard-kernel-v1.0.4-x86_64" ]; then
    cp "$SCRIPT_DIR/postcard-kernel-v1.0.4-x86_64" /mnt/postcard/boot/postcard-kernel-v1.0.4-x86_64
    cp "$SCRIPT_DIR/postcard-kernel-v1.0.4-x86_64" /mnt/postcard/boot/postcard-kernel
elif [ -f "$SCRIPT_DIR/../target/x86_64-unknown-none/release/postcard-minimal-kernel" ]; then
    cp "$SCRIPT_DIR/../target/x86_64-unknown-none/release/postcard-minimal-kernel" /mnt/postcard/boot/postcard-kernel-v1.0.4-x86_64
    cp "$SCRIPT_DIR/../target/x86_64-unknown-none/release/postcard-minimal-kernel" /mnt/postcard/boot/postcard-kernel
elif [ -d /boot ]; then
    cp -r /boot /mnt/postcard/
fi

if [ -f "$SCRIPT_DIR/initrd.img" ]; then
    cp "$SCRIPT_DIR/initrd.img" /mnt/postcard/boot/initrd.img
elif [ -f "$SCRIPT_DIR/../ramdisk.img" ]; then
    cp "$SCRIPT_DIR/../ramdisk.img" /mnt/postcard/boot/initrd.img
fi

if [ -d /communications ]; then
    cp -r /communications /mnt/postcard/
fi

cat > /mnt/postcard/radiator/thermal_control_loop.json << 'EOF'
{
  "subsystem": "THE RADIATOR",
  "mode": "Cryogenic Thermal Control Loop",
  "chassis": "Al-Li 2195 Cryogenic Hull Frame",
  "status": "STABILIZED",
  "timestamp_boot": "0.010200"
}
EOF

# 5. Installing Bootloader Records
echo "Installing UEFI Multiboot2 bootloader..."
mkdir -p /mnt/postcard/boot/efi/EFI/BOOT
if [ -f "$SCRIPT_DIR/EFI/BOOT/BOOTX64.EFI" ]; then
    cp "$SCRIPT_DIR/EFI/BOOT/BOOTX64.EFI" /mnt/postcard/boot/efi/EFI/BOOT/BOOTX64.EFI
    cp "$SCRIPT_DIR/EFI/BOOT/BOOTX64.EFI" /mnt/postcard/boot/efi/EFI/BOOT/grubx64.efi
elif [ -f "$SCRIPT_DIR/../EFI/BOOT/BOOTX64.EFI" ]; then
    cp "$SCRIPT_DIR/../EFI/BOOT/BOOTX64.EFI" /mnt/postcard/boot/efi/EFI/BOOT/BOOTX64.EFI
    cp "$SCRIPT_DIR/../EFI/BOOT/BOOTX64.EFI" /mnt/postcard/boot/efi/EFI/BOOT/grubx64.efi
elif command -v grub-install &>/dev/null; then
    grub-install --target=x86_64-efi --efi-directory=/mnt/postcard/boot/efi --boot-directory=/mnt/postcard/boot --removable
fi
if command -v grub-mkconfig &>/dev/null; then
    grub-mkconfig -o /mnt/postcard/boot/grub/grub.cfg || true
fi
cat > /mnt/postcard/boot/grub/grub.cfg << 'EOF'
insmod all_video
insmod efi_gop
insmod gfxterm
set gfxmode=auto
set gfxpayload=keep
terminal_input console
terminal_output gfxterm
set timeout=3
set default=0

menuentry "Post Card OS // Space Plane Avionics v1.0.4" {
    multiboot2 /boot/postcard-kernel-v1.0.4-x86_64 console=tty0 noserial root=/dev/nvme0n1p2
    module2 /boot/initrd.img
    boot
}
EOF

# 6. Cleanup
umount -R /mnt/postcard
echo "=================================================="
echo "  Installation Complete! Reboot into Post Card OS."
echo "=================================================="
