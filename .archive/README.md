# Archive record

## micro-host - retired (2026-11-12)

`https://github.com/peoplescasey0/micro-host` is archived and read-only. It was the
first home of the bare-metal engine: a v0.1.0-alpha prototype with 17 kernel source
files plus its own `user/`, `secure/`, `tests/`, Makefile and PowerShell scripts,
tagged `v0.1.0-alpha` at commit `eb4efd0`.

**Decision:** the engine lives in this repo, next to the interface it boots, so
micro-host was retired rather than merged. Nothing from it was copied into this
tree, and there is no `kernel-legacy/`: the live engine is `kernel/` here, which
already carries everything the prototype was used for.

What superseded it:

| Concern | Live code here | Prototype |
| --- | --- | --- |
| FAT volumes | `kernel/src/fat32.rs` (FAT12/16/32 + long names, 1290 lines) | no FAT reader at all |
| Block devices | `kernel/src/blockdev.rs` (SDHCI/eMMC, AHCI, ATA, NVMe paths, 1601 lines) | `storage.rs`, in-memory only |
| Laptop keyboard | PS/2 punctuation map and shift handling in `kernel/src/main.rs` | US letters and digits only |
| Regression tests | `scripts/emmc_test.sh`, `scripts/fat_test.sh`, `scripts/boot_test.sh`, `scripts/shell_test.sh` | `boot_test.sh`, `shell_test.sh` |

The retired repo keeps its full history and its `v0.1.0-alpha` tag on GitHub, so the
prototype stays readable there. Read it from the tag if it is ever needed; do not
restore it into this tree.
