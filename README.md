# Post Card Spatial OS

The spatial workspace: a 3D (Three.js) desktop that runs and displays guest
operating systems (Windows, Linux, macOS, Kali, AI copilot) as cards in space.

## Documentation & User Manual
For comprehensive operating procedures, 3D navigation shortcuts, multi-OS hypervisor profiles, AI Butler orchestration, Freeplane mind mapping, and commercial editions, see the **[Official User Manual & Field Guide](USER_MANUAL.md)** or press `?` inside the running workspace.

## Layout
- `workspace-prototype/` - Vite + TypeScript + Three.js front end, noVNC display,
  and `guest-api.mjs`, the QEMU/QMP/VNC backend that starts and manages guests.
- `supabase/` - Supabase project configuration.
- `scripts/stripe_sync.mjs` - Stripe catalog sync (reads keys from environment variables).

## Relationship to micro-host
The bare-metal kernel, user programs and security layer live in a separate repo:
https://github.com/peoplescasey0/micro-host

Spatial OS is the product; micro-host is the engine it is meant to run on.
Long term the two merge, with the workspace talking to the host through a small,
versioned VM-control API.

## Run
```powershell
cd workspace-prototype
npm install
npm run dev
```

Guest disk images and overlays live in `workspace-prototype/data/` and are
**not** tracked in git (they are many GB). Keep them backed up separately.

## Storage and tests
The kernel reaches its disk over any of the transports the hardware uses:

- `-machine pc` - legacy ATA (PIO) on the primary channel.
- `-machine q35` - SATA/AHCI, which is what `workspace-prototype/guest-api.mjs`
  starts. The AHCI transport reuses one command slot per request, polls for
  completion and never takes an interrupt, so an odd controller cannot hang the
  boot or the shell.
- eMMC/SD behind an SDHCI controller - the Dell Latitude 3120 (Jasper Lake) boots
  from eMMC, not NVMe. The SDHCI transport identifies the card from its CSD and
  reads and writes it a block at a time in PIO mode.

The shell reads the PS/2 keyboard in set 1 scancodes with the US layout and
shift, so a path like `cat /plane.txt` can be typed on a laptop's own keyboard;
without the `/` (0x35) and `.` (0x34) keys no path is typeable at all.

Any of these transports can mount FAT12, FAT16 and FAT32. The width comes from the BPB
shape first (only FAT32 leaves the 16-bit root-entry count and the 16-bit FAT
size at zero) and from the cluster count otherwise, because QEMU's vvfat
paper-plane volume is FAT16 while mtools can emit a FAT32 volume whose cluster
count sits in FAT16 range.

| script | what it proves |
| --- | --- |
| `scripts/boot_test.sh` | the ISO reaches the shell and prints its banner |
| `scripts/shell_test.sh` | the serial shell suite (commands, VMX invariants, network) |
| `scripts/fat_test.sh` | the app's own topology: q35 + AHCI + FAT16 paper-plane volume mounts, lists and reads the dropped plane, and a guest write reaches the host volume; plus FAT12/FAT16/FAT32 images over ATA |
| `scripts/emmc_test.sh` | the Dell's path: a real MBR disk with a FAT16 partition on an emulated `sdhci-pci` controller is identified, mounted, listed and read; a guest write reaches the card image; and a path typed over the PS/2 keyboard keeps its slash and dot |

```bash
./scripts/create_iso.sh        # rebuilds the kernel, then the ISO
./scripts/boot_test.sh
./scripts/shell_test.sh
./scripts/fat_test.sh          # add --no-images to skip the mtools cases
./scripts/emmc_test.sh         # needs mtools; --no-images skips it
```

`fat_test.sh` only means something with the app's drive topology: the
paper-plane directory is attached as `if=ide,index=2` on `-machine q35` and the
installer CD as `if=ide,index=1`, so the CD can never claim the index the
paper-plane volume uses. The `--disk` mode of `boot_test.sh` and
`shell_test.sh` builds `target/postcard-os.raw` with
`install_postcard_os_wsl.sh`, which lives in the micro-host checkout rather than
here. Those modes use a copy beside this repository (the usual `micro-host/`
layout) and stop with a clear message when they cannot find one.

## Secrets
Never commit keys. Use environment variables (for example `STRIPE_SECRET_KEY`).

## License

Copyright (c) 2026 peoplescasey0. All rights reserved. See [LICENSE](LICENSE).
