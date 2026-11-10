# Post Card OS // System Architecture & Boot Specification
*A high-performance, bare-metal spatial micro-host with an uncompromising industrial aesthetic.*

---

## 1. System Overview & Codename Schema

Post Card OS is engineered for raw speed, memory isolation, and zero software bloat. Every layer of the architecture is mapped to precision aviation and industrial operations:

* **The Foundry (`LockedHeap`):** The dynamic free-list memory allocator managing RAM chunks and recycling blocks without garbage collection staggers.
* **The Catapult (`ELF64 Loader`):** The binary parsing engine that validates magic bytes and safely spawns user-space processes into isolated Ring 3 segments.
* **The Black Box (`VfsStorageBridge`):** Persistent sector storage bridging modified VFS nodes and Freeplane mind-maps down to raw disk blocks via `MemoryBlockDevice`.
* **The Radiator (`Cryogenic Thermal Control Loop`):** Active thermal regulation loop maintaining Al-Li 2195 hull and PA-Romy neural vault thermal equilibrium (`[ STABILIZED ]`).
* **The Glass Cockpit (`render_native_hud`):** The immediate-mode framebuffer renderer blitting crisp typography and high-contrast telemetry straight into VRAM.
* **The Beacon (`WebSocket Stream`):** The real-time `/telemetry` bridge streaming live guest diagnostics to the host-side dashboard.
* **PA-Romy (`Coprocessor Vault`):** The hardware-isolated neural container with a clean, read-only telemetry mirror.
* **Paper Planes:** The lightweight spatial data packets and UI cards gliding across the system.
* **Flight Deck & Hangar Bay:** The queuing buffer on the sending side and the persistent staging zone on reception.

---

## 2. Cold Boot & Space Plane Avionics Ignition Sequence

### GRUB / UEFI Bootloader Handoff
```text
kernel /boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0,115200 root=/dev/nvme0n1p2
initrd /boot/initrd.img
boot
```

When the micro-host initializes on bare metal, the kernel executes the following boot and Space Plane Avionics ignition sequence over the linear framebuffer and serial telemetry (`ttyS0` at `115200` baud):

```text
========================================================================
[ 0.000000 ] POST CARD OS // SPACE PLANE AVIONICS v1.0.4... [ CORE ]
[ 0.001042 ] CHASSIS: Al-Li 2195 Cryogenic Hull Frame... [ SECURED ]
[ 0.002890 ] THE FOUNDRY: 16MB LockedHeap Arena... [ STABLE ]
[ 0.004510 ] THE CATAPULT: ELF64 Ring 3 Spatial Loader... [ ARMED ]
[ 0.007120 ] THE BLACK BOX: VfsStorageBridge Sector Mirror... [ LOCKED ]
[ 0.010200 ] THE RADIATOR: Cryogenic Thermal Control Loop... [ STABILIZED ]
[ 0.014500 ] PA-ROMY VAULT: Isolated Neural Coprocessor... [ ACTIVE ]
========================================================================
```

### Kernel Core Serial Trace (`ttyS0` / `COM1`)
```text
[ 0.000000 ] POST CARD OS // KERNEL CORE v1.0.4-x86_64
[ 0.001042 ] CPU: Initializing IDT, GDT, & CR3 Page Table Isolation... [ SECURE ]
[ 0.002890 ] THE FOUNDRY: Locking 16MB dynamic free-list memory arena... [ ALLOCATED ]
[ 0.004510 ] THE CATAPULT: Loading ELF64 ring 3 segment validator... [ ARMED ]
[ 0.007120 ] THE BLACK BOX: Mounting VfsStorageBridge over memory sectors... [ PERSISTENT ]
[ 0.010200 ] PA-ROMY VAULT: Isolating hardware coprocessor core & telemetry mirror... [ LOCKED ]
[ 0.014500 ] THE BEACON: Binding WebSocket telemetry stream to /telemetry... [ BROADCASTING ]
```

---

## 3. The Glass Cockpit HUD & Telemetry Pods

The UI runs on a fixed-function, high-density telemetry layout using the Obsidian & Amber design system (`#0B0C10` matte black, `#1F2833` industrial slate, and `#FFB703` amber phosphor):

* **Mission Control Header:** Top-left monospaced status panel displaying vCPU clock cycles and system uptime.
* **PA-Romy Status (`#romy-status`):** Pulsing telemetry pod tracking neural throughput and vCPU state from the hardware vault.
* **The Foundry Heap Pressure Bar (`#heap-meter`):** Zero-allocation visual meter tracking dynamic heap fragmentation and free-list block reuse in real time.
* **The Flight Deck Staging Area:** Central launcher rails holding active spatial windows and paper planes.

---

## 4. Deployment Pipeline & PXE Netboot

The system includes an automated rapid deployment installer (`scripts/rapid_deploy_installer.sh`) supporting SATA, NVMe (`/dev/nvme0n1p1`), and loopback devices with bulletproof POSIX block/character device checks.

### PXE / TFTP Netboot Staging (`/srv/tftp/postcard/grub.cfg`)
```grub
set timeout=3
set default=0

menuentry "Post Card OS // Space Plane Avionics v1.0.4 (Netboot)" {
    linux /postcard-kernel console=ttyS0,115200 root=/dev/nvme0n1p2
    initrd /initrd.img
}
```

### Dell Latitude 3120 USB -> NVMe Bare-Metal Deployment Runbook
1. **Step 1 — Stage the USB Drive on Host Workstation**:
   - Flash a live Linux environment (or Ventoy/FAT32 USB) and copy `target/usb-deploy-bundle/` (`rapid_deploy_installer.sh`, `postcard-kernel-v1.0.4-x86_64`, `initrd.img`, `netboot_grub.cfg`) onto the USB root.
2. **Step 2 — Boot from USB on Dell Latitude 3120**:
   - Tap `F2` at power-on to verify BIOS settings: **Secure Boot = OFF**, **PTT = ON**, **Absolute Module = Disabled**.
   - Reboot, tap `F12` at the Dell splash screen for the One-Time Boot Menu, and select the UEFI USB device.
3. **Step 3 — Drop the Hammer on the NVMe**:
   ```bash
   sudo ./scripts/rapid_deploy_installer.sh /dev/nvme0n1 -y
   ```
   - Automatically partitions `/dev/nvme0n1p1` (512 MiB FAT32 ESP) and `/dev/nvme0n1p2` (ext4 Root VFS), deploys the kernel, **The Radiator** cryogenic thermal control loop sectors, and installs `grub-install --target=x86_64-efi --removable`.
