#!/usr/bin/env bash
set -euo pipefail

if [ ! -e /work/macos-VARS.fd ]; then
  cp -f /work/OVMF_VARS_mac.fd /work/macos-VARS.fd
fi

exec qemu-system-x86_64 \
  -name "Post Card macOS guest" \
  -machine q35,accel=kvm \
  -cpu Penryn,kvm=on,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on,+ssse3,+sse4.2,+popcnt,+avx,+aes,+xsave,+xsaveopt,check \
  -smp 4,cores=2,threads=2 \
  -m 4096 \
  -device isa-applesmc,osk="$(cat /work/mac-osk.txt)" \
  -drive if=pflash,format=raw,readonly=on,file=/work/OVMF_CODE_mac.fd \
  -drive if=pflash,format=raw,file=/work/macos-VARS.fd \
  -smbios type=2 \
  -device ich9-intel-hda -device hda-duplex \
  -device ich9-ahci,id=sata \
  -drive id=OpenCoreBoot,if=none,snapshot=on,format=qcow2,file=/work/OpenCore.qcow2 \
  -device ide-hd,bus=sata.2,drive=OpenCoreBoot \
  -device ide-hd,bus=sata.3,drive=InstallMedia \
  -drive id=InstallMedia,if=none,file=/work/BaseSystem.img,format=raw \
  -drive id=MacHDD,if=none,file=/work/macos.qcow2,format=qcow2 \
  -device ide-hd,bus=sata.4,drive=MacHDD \
  -device vmware-svga \
  -device qemu-xhci,id=xhci \
  -device usb-kbd,bus=xhci.0 \
  -device usb-tablet,bus=xhci.0 \
  -netdev user,id=net0 \
  -device e1000,netdev=net0,id=nic0 \
  -display none \
  -vnc 0.0.0.0:2,websocket=5702 \
  -qmp tcp:0.0.0.0:4446,server=on,wait=off

