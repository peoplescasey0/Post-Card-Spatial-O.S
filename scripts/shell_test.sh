#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# The kernel builds to kernel/target, while older builds left the ELF in the
# repo-root target/. Accept either so the raw-disk path can find it.
kernel_elf() {
    local candidate
    for candidate in \
        "${REPO_ROOT}/kernel/target/x86_64-unknown-none/release/postcard-minimal-kernel" \
        "${REPO_ROOT}/target/x86_64-unknown-none/release/postcard-minimal-kernel"; do
        if [[ -f "${candidate}" ]]; then
            echo "${candidate}"
            return 0
        fi
    done
    return 1
}

TIMEOUT_SECS=30
ISO_PATH="${REPO_ROOT}/target/postcard-spatial-os.iso"
DISK_PATH="${REPO_ROOT}/target/postcard-os.raw"
LOG_PATH="${REPO_ROOT}/target/shell.log"
USE_DISK=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --log|--serial-log)
            LOG_PATH="$2"
            shift 2
            ;;
        --timeout|-t)
            TIMEOUT_SECS="$2"
            shift 2
            ;;
        --disk)
            USE_DISK="1"
            if [[ $# -gt 1 && ! "$2" =~ ^-- ]]; then
                DISK_PATH="$2"
                shift
            fi
            shift
            ;;
        --iso)
            if [[ $# -gt 1 && ! "$2" =~ ^-- ]]; then
                ISO_PATH="$2"
                shift
            fi
            shift
            ;;
        *)
            if [[ "$1" =~ ^[0-9]+$ ]]; then
                TIMEOUT_SECS="$1"
            fi
            shift
            ;;
    esac
done

mkdir -p "$(dirname "$LOG_PATH")"

if [[ -n "$USE_DISK" ]]; then
    if [[ ! -f "$DISK_PATH" ]]; then
        # The installer lives in the micro-host checkout, which usually sits
        # beside this one; it is not always executable, so run it through bash.
        INSTALLER=""
        for candidate in \
            "${SCRIPT_DIR}/install_postcard_os_wsl.sh" \
            "${REPO_ROOT}/../micro-host/install_postcard_os_wsl.sh"; do
            if [[ -f "${candidate}" ]]; then
                INSTALLER="${candidate}"
                break
            fi
        done
        if [[ -z "${INSTALLER}" ]]; then
            echo "Error: no raw disk at $DISK_PATH, and install_postcard_os_wsl.sh was not found." >&2
            echo "It lives in the micro-host checkout; put that beside this one, or drop --disk to test the ISO." >&2
            exit 1
        fi
        ELF="$(kernel_elf || true)"
        if [[ -z "${ELF}" ]]; then
            echo "Error: kernel ELF not found; run scripts/create_iso.sh first." >&2
            exit 1
        fi
        echo "Raw disk not found at $DISK_PATH, building via install_postcard_os_wsl.sh..."
        bash "${INSTALLER}" "$DISK_PATH" "${ELF}"
    fi
    MEDIA_ARG="--disk $DISK_PATH"
else
    if [[ ! -f "$ISO_PATH" ]]; then
        echo "ISO not found, building..."
        "${SCRIPT_DIR}/create_iso.sh"
    fi
    MEDIA_ARG="--iso $ISO_PATH"
fi

echo "=== Running QEMU Interactive Serial Shell Test ==="

python3 - "${MEDIA_ARG}" "${TIMEOUT_SECS}" "${LOG_PATH}" << 'EOF'
import os
import re
import select
import signal
import subprocess
import sys
import time

media_type = sys.argv[1].split()[0] # --iso or --disk
media_file = sys.argv[1].split()[1]
timeout_secs = float(sys.argv[2])
log_path = sys.argv[3] if len(sys.argv) > 3 else ""

if log_path:
    os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
    log_file = open(log_path, "w", encoding="utf-8")
else:
    log_file = None

def log_write(text):
    if log_file:
        log_file.write(text)
        log_file.flush()

qemu_cmd = [
    "qemu-system-x86_64",
    "-name", "Post Card OS Shell Test",
    "-machine", "pc",
    "-m", "256M",
    "-net", "nic,model=e1000",
    "-net", "user,net=10.0.2.0/24,host=10.0.2.2",
    "-display", "none",
    "-serial", "stdio",
    "-no-reboot"
]

if media_type == "--iso":
    qemu_cmd.extend(["-cdrom", media_file, "-boot", "d"])
else:
    qemu_cmd.extend(["-drive", f"file={media_file},format=raw,if=ide,index=0,snapshot=on", "-boot", "order=c"])

print(f"Launching QEMU ({media_type} {media_file})...")
proc = subprocess.Popen(
    qemu_cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=False,
    bufsize=0
)

def read_until(pattern, timeout):
    buf = ""
    start = time.time()
    while time.time() - start < timeout:
        if proc.poll() is not None:
            try:
                drain = os.read(proc.stdout.fileno(), 4096).decode("utf-8", errors="replace")
                if drain:
                    buf += drain
                    log_write(drain)
            except Exception:
                pass
            if pattern in buf:
                return buf
            raise RuntimeError(
                f"QEMU terminated prematurely with exit code {proc.returncode} "
                f"while waiting for '{pattern}'. Received so far:\n{buf}"
            )
        remaining = max(0.01, timeout - (time.time() - start))
        rlist, _, _ = select.select([proc.stdout], [], [], min(remaining, 0.2))
        if rlist:
            try:
                raw = os.read(proc.stdout.fileno(), 1024)
            except Exception:
                raw = b""
            if not raw:
                if pattern in buf:
                    return buf
                raise RuntimeError(
                    f"EOF on QEMU stdout while waiting for '{pattern}' (exit code {proc.poll()}). "
                    f"Received so far:\n{buf}"
                )
            chunk = raw.decode("utf-8", errors="replace")
            buf += chunk
            log_write(chunk)
            if pattern in buf:
                return buf
    raise TimeoutError(f"Timed out ({timeout}s) waiting for '{pattern}'. Received so far:\n{buf}")

def cleanup():
    if proc.poll() is None:
        try:
            proc.stdin.write(b"halt\n")
            proc.stdin.flush()
            time.sleep(0.3)
        except Exception:
            pass
    try:
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
    except Exception:
        pass
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    try:
        if proc.stdout and not proc.stdout.closed:
            proc.stdout.close()
    except Exception:
        pass
    try:
        if log_file and not log_file.closed:
            log_file.close()
    except Exception:
        pass

signal.signal(signal.SIGINT, lambda s, f: (cleanup(), sys.exit(130)))
signal.signal(signal.SIGTERM, lambda s, f: (cleanup(), sys.exit(143)))

try:
    print("Waiting for boot to reach 'spatial>' prompt...")
    boot_log = read_until("spatial> ", timeout=timeout_secs)
    print("Initial shell prompt reached.")

    test_commands = [
        ("help", ["echo", "uptime", "ps", "disks", "vmx", "vmrun", "gui", "mouse"]),
        ("uptime", ["ticks)"]),
        ("mem", ["frames"]),
        ("ps", ["shell", "running"]),
        ("pci", [r"re:class=[0-9A-Fa-f]{4} prog-if=[0-9A-Fa-f]{2}"]),
        ("disks", [r"re:ramdisk:\ start=0x[0-9A-Fa-f]+\ end=0x[0-9A-Fa-f]+"]),
        ("mouse", [r"re:Mouse: X=\d+ Y=\d+ Left=\d+ Right=\d+ Mid=\d+ Initialized=\d"]),
        ("routes", ["DYNAMIC DATAFLOW ROUTING", "Route #0", "Route #1", "Route #2", "Allocated"]),
        ("usbc", ["USB TYPE-C DEVICE CONTROLLER", r"re:Port\ \d+:\ \[REMOTE_HOST\]", r"re:Port\ \d+:\ \[SIMPLE_CHARGER\]"]),
        ("sec", ["IOT & ENCLAVE SECURITY", r"re:Security\ Tier:\ LVL\d+:MILITARY\-AES\-\d+"]),
        ("hsm", ["5G-SOFTHSM & BIOMETRIC VAULT", "Validation State: [AUTHENTICATED_GSSO]", r"re:Hardware\ Vault\ Key:\ \d+f\d+\.\.\d+\ \[AES\-\d+\ G\-SSO\ LOCKED\]"]),
        ("graph", ["GRAPH-BASED TRUST TOPOLOGY", "Avionics-HUD", "BlackBox-FAT32", "PA-Romy-Vault", "IoT-Sensor-Bus"]),
        ("trust isolate 7", ["[TRUST GRAPH] Card #7 ISOLATED & quarantined"]),
        ("trust release 7", ["[TRUST GRAPH] Card #7 quarantine released"]),
        ("net", ["BARE-METAL GIGABIT ETHERNET", r"re:MAC\ Address:\ \d+:\d+:\d+:\d+:\d+:\d+", r"re:Traffic:\ TX\ \d+\ packets\ \(\d+\ bytes\)"]),
        ("stream", ["[UDP 5173] Streamed flight telemetry packet to Studio"]),
        ("flynet 0", ["[FLYNET] PAPER AIRPLANE STREAMED VIA UDP/IP", r"re:CRC\d+:\ 0x[0-9A-Fa-f]+"]),
        ("cxl", ["CXL & IPU RESOURCE POOLING", r"re:Active\ Protocol:\ CXL\.cache\ \(Coherent\)", r"re:Pool:\ \d+/\d+\ KiB\ \(\d+\ MiB\ total\)"]),
        ("cxl arbitrate 300 100", ["[CXL] Protocol arbitrated", "CXL.mem (Direct Pool)"]),
        ("scibuf", ["SCIBUF & SCISYNC HETEROGENEOUS ZERO-COPY", "Pitch Alignment=4096 B", r"re:SciSync\ Fence:\ Syncpoint\ \#\d+"]),
        ("margin test 3 next", ["[LTSSM] Crosstalk Stress Test armed: Victim Lane #3", "GEN_NEXT (Near-End)"]),
        ("margin reset", ["[LTSSM] All 8 physical lanes reset to Standard L0."]),
        ("hud", ["SET-THEORY MULTI-USER HUD PERSONALIZATION", r"re:Operator\ Preferred:\ 0x[0-9A-Fa-f]+", "Combined Layout Bitmask"]),
        ("hud intersect", ["Combined Layout Bitmask (Mode: INTERSECTION)"]),
        ("span", ["MULTI-HYPERVISOR VIRTUAL MACHINE", "Span-MHVM-Enclave", r"re:Shared\ Footprint:\ \d+\ KiB\ \(\d+\ MiB\ @\ 0x[0-9A-Fa-f]+\)"]),
        ("span kick 2", ["[SPAN] Virtio kick on VCPU 2 -> kick_redirected_to_l1_source"]),
        ("span ipi 0 2", ["[SPAN] Cross-L1 IPI from VCPU 0 to VCPU 2 -> cross_l1_ipi_forwarded"]),
        ("span rebalance 3", ["[SPAN] Rebalanced VCPUs: 3 on L1_Source, 1 on L1_Target"]),
        ("rootvmm", ["TRUSTED ROOT MODE HYPERVISOR & ROOT MODE VMM", "Component 1 (EFI Root Core): ACTIVE", "PA-Romy-VMM-Core"]),
        ("rootvmm enter 2", ["[ROOT VMM] Module 2 -> promoted_to_root_mode"]),
        ("rootvmm exit 2", ["[ROOT VMM] Module 2 -> de_privileged_to_non_root_mode"]),
        ("rootvmm verify 1 0x00450000", ["[ROOT VMM] Target RIP 0x450000 verified inside Module 1 boundary [OK]"]),
        ("rootvmm verify 1 0x00900000", ["[ROOT VMM] Target RIP 0x900000 OUT-OF-BOUNDS for Module 1 -> Blue-Pill Trapped!"]),
        ("snvme", ["SMARTNIC EMULATED LOCAL STORAGE", "Emulated Controller: 'VMWR'", "Shared NIC Port: Port 0 (e1000)"]),
        ("snvme read 0", ["[SMARTNIC] NVMe-oF Read LBA 0", "POSTCARD_OS_SMARTNIC_NVMEOF"]),
        ("snvme write 100 HELLO_NVMEOF_WORLD", ["[SMARTNIC] NVMe-oF Write LBA 100", "Dispatched to Target SAN"]),
        ("snvme target 10.0.2.102 4420", ["[SMARTNIC] Registered External Target #3"]),
        ("hyos", ["HYBRID MULTI-OS & DUAL-FRAMEBUFFER ARCHITECTURE", r"re:Primary\ Framebuffer:\ \ \ 0x[0-9A-Fa-f]+\ \(\d+x\d+\ \d+bpp\)", r"re:Secondary\ Framebuffer:\ 0x[0-9A-Fa-f]+\ \(\d+0x[0-9A-Fa-f]+\ \d+bpp\)", "Microsoft Resource Partitioning", "Intel Asymmetric Disk Virtualization"]),
        ("dock", ["Docked to Desktop Smartdock!", "Secondary 1080p OS display activated"]),
        ("undock", ["Undocked from Desktop Smartdock!", "standalone mobile handheld HUD"]),
        ("pats 2048", ["DIRECT PHYSICAL ACCESS (vLBA == pLBA)", "Unrestricted Direct I/O"]),
        ("pats 100", ["UNASSIGNED PARTITION (Pattern Sector Guard)", "DUMMY_ZERO_FILL", "BLOCKED_GUARD"]),
        ("shrink 4096", ["Memory Shrink Successful: Primary OS shrunk to 4096 MiB", "Carved 12288 MiB for Secondary OS"]),
        ("sva", ["DELL DUAL-ENDPOINT PCIe I/O ACCELERATOR", "Root Port 1 (HV): ACTIVE", "Root Port 2 (SVA): ACTIVE", r"re:Endpoint\ \d+\ \(Hypervisor\ Facing\):\ State:\ \[HOT\-PLUG\ DETECTED\ \(Hypervisor\ Driver\ Bound\)\]", r"re:Endpoint\ \d+\ \(SVA\ Exclusive\ Pass\-Through\):\ State:\ \[ACTIVE\ ONLINE\ \(Exposed\ to\ Driver\)\]", r"re:Address\ Translator\ \d+:\ ATC\ Hits:\ \d+", r"re:DMA\ Engine\ \d+:\ Transfers\ Completed:\ \d+", r"re:Private\ Device\ \d+:\ \[Hardware\ Vault\ NVRAM\ /\ Key\ Store\]"]),
        ("sva activate", ["[DELL SVA] Activated Endpoint 1 via Endpoint 2", "Hypervisor hot-plug event recognized"]),
        ("sva morph nic", [r"re:\[DELL\ SVA\]\ Dynamic\ Personality\ Morphed\ to:\ Network\ Controller\ \(PCI\ Class\ 0x[0-9A-Fa-f]+\ \-\ HV\ NIC\ Driver\)\ \(FLR\ cycle\ on\ EP\d+\ \&\ EP\d+\ completed,\ driver\ rebound\)", "Network Controller (PCI Class 0x02"]),
        ("sva dma 0x20000 0x80000 4096", ["[DELL SVA] Zero-CPU DMA Transfer OK: 4096 B", "Host Physical A4"]),
        ("sva priv write DELL_AERO_MISSION_TOKEN", ["[DELL SVA] Private Hidden Vault: Wrote 23 bytes exclusively via Endpoint 2"]),
        ("sva priv read", ["DELL_AERO_MISSION_TOKEN", "Invisible to Hypervisor"]),
        ("latehv", ["RUNTIME HYPERVISOR LATE-LAUNCH & STATE CAPTURE", r"re:Launch\ Phase:\ \[ROOT_OS_VIRTUALIZED\ \(Transparent\ Micro\-VM\ Resumed\)\]", r"re:NMI\ Inhibition:\ Self\-Delivered\ NMI\ \(IRET\ suppressed,\ hardware\ NMI\ mask\ active\)", r"re:Captured CPU State: RIP=0x[0-9A-Fa-f]+ \| RSP=0x[0-9A-Fa-f]+ \| CR3=0x[0-9A-Fa-f]+", r"re:Captured\ APIC\ State:\ ID=\d+", r"re:Discovered\ Topology:\ Cores:\ \d+\ \(HT=YES\)"]),
        ("latehv trap", ["Handled trapped write to Local APIC MMIO page (0xFEE00000)", "Intercept emulated!"]),
        ("latehv step", ["Late-launch state transition re-cycled: Root OS transparently virtualized!"]),
        ("muse", ["INTEL MUSE MEDIATED-DEVICE IN USER SPACE", "MUSE Transport: /dev/muse", r"re:Instance\ \#\d+:\ Mdev\ ID:\ 0x[0-9A-Fa-f]+", r"re:User\ Parent:\ GVA\ Map:\ 0x[0-9A-Fa-f]+", r"re:Fast\-Path\ Ring:\ GPA=0x[0-9A-Fa-f]+", r"re:Decoupled\ IRQ:\ Vector\ \d+\ <\->\ IRQFD\ \#\d+\ <\->\ EVENTFD\ \#\d+"]),
        ("muse fast 0 1024", ["Packet (1024 B) enqueued into Ring #0", "Direct DPDK Zero-Copy Bypass"]),
        ("muse slow 0 2 0xDEADBEEF", ["Relayed CSR[2]=0xDEADBEEF via /dev/muse FUSE daemon to User Software Parent Device"]),
        ("coreiso", ["AMD HYPERVISOR-BASED PROCESSOR CORE ISOLATION", "Core Topology: Total Cores: 8", "Host OS Cores: 4", "Sequestered Cores: 4", r"re:Shared\ Queue\ Fabric:\ Work\ Queue:\ \d+\ entries", r"re:Inter\-Core\ Signaling:\ VMMCALL\ Doorbells:\ \d+"]),
        ("coreiso dispatch 2048 4096", ["Work Unit #2048 (4096 B) successfully scheduled & executed on Sequestered Core #4!"]),
        ("coreiso pf 4", ["Sequestered Core #4 #PF VMEXIT handled: Fault Queue DPC updated page tables and resumed via CMD_RESUME!"]),
        ("vgpu", ["INTEL MULTI-SLICE vGPU & MASTER/SLAVE MMU", r"re:Master\ MMU:\ IOMMU\ Direct\ Requests:\ \d+", r"re:Slave\ MMU\ \#\d+:\ Local\ TLB\ Hits:\ \d+", "20-bit PASID vGPU Scaling", "QoS Time Slice: 16 ms", "GPU Slices: 4 Slices Active"]),
        ("vgpu tx 0 0x00080000", ["Memory Transaction GVA 0x00080000 -> HPA 0x80080000", "Slave MMU #1"]),
        ("vgpu bounds 0 0x10000000", ["Offset 0x10000000 inside vGPU #0 HBM aperture [ALLOWED]"]),
        ("vgpu bounds 0 0x30000000", ["Offset 0x30000000 OUT-OF-BOUNDS for vGPU #0 HBM aperture [TRAPPED_BREACH]"]),
        ("sriov", ["VMWARE SR-IOV PF-VF MAILBOX DYNAMIC INTERCEPT VIRTUALIZER", r"re:Current\ State:\ DIRECT_PASS_THROUGH\ \(EPT\ Intercept\ Removed,\ Native\ Speed\)", "Callback Registered: true", r"re:Statistics:\ Messages\ Intercepted:\ \d+"]),
        ("sriov trigger 0x8042", ["[SR-IOV] VF Request 0x8042 -> Intercept Emulated Response: 0x52498042 (Checkpointed)"]),
        ("sriov error", ["Injected hardware device error: all MMIO intercepted, guest writes dropped.", "ERROR_ISOLATION"]),
        ("sriov reset", ["Device recovered: direct pass-through restored, EPT intercepts removed.", "DIRECT_PASS_THROUGH"]),
        ("vmsec", ["VMWARE VM DATA SECURITY & NESTED ROOT PARTITIONS", r"re:Apparent\ Storage\ \(Guest\ Truncated\):\ \d+\ blocks\ \(\d+\ MiB\)", "State Partition: Encrypted Vault Key Armed: true", "PRIMARY_VDISK", "STATE_DATA"]),
        ("vmsec io 500 16 read", ["[VMSEC IO] Guest vLBA 500 (+16 blk, read) -> Translated Physical pLBA 2548 [BOUNDS OK]"]),
        ("vmsec io 2000000 10 write", ["Translation fault: vmsec_err: guest I/O violates truncated partition bounds", "Blocked Bounds Violations: 1"]),
        ("vmsec snap 1712000000", ["[VMSEC] Created array snapshot #2 (Epoch 1712000000)"]),
        ("ppt", ["INTEL PLATFORM PROTECTION TECHNOLOGY (PPT) DUAL-VIEW EPT", "Active EPT View: VIEW_0_UNTRUSTED", r"re:Asserted\ Page\ Table\ \(APT\):\ Base\ CR\d+:\ 0x[0-9A-Fa-f]+", "Verified Entry RIP: 0x00007FFF80001000", "Secure Cookie Value (SCV): 0x5050545F53454356"]),
        ("ppt ecall 0x5050545F53454356 0x7FFF80001000", ["[PPT INT-29] SCV verified! Switched to EPT View 1 (Trusted TA)", "Active EPT View: VIEW_1_TRUSTED"]),
        ("ppt aex", ["[PPT INT-30] AEX triggered! Saved volatile state in SSA", "Active EPT View: VIEW_0_UNTRUSTED", "State Save Area (SSA): Valid: true"]),
        ("ppt exit", ["Exit error: ppt_err: EEXIT called outside View 1 Trusted state"]),
        ("ppt ecall 0x5050545F53454356 0x7FFF80001000", ["[PPT INT-29] SCV verified! Switched to EPT View 1 (Trusted TA)"]),
        ("ppt exit", ["[PPT INT-31] EEXIT clean return: secrets cleared, View 0 restored", "Active EPT View: VIEW_0_UNTRUSTED"]),
        ("vam", ["DELL VIRTUAL ACCELERATOR MANAGER (VAM) & TPE", r"re:Total\ Dispatched\ Tasks:\ \d+", "dell-aero-hbm3", "PCIe Gen5 x16 (63.0 GB/s)", "dell-rtx-gddr6", "dell-fpga-hbm2", "dell-qcom-sec"]),
        ("vam profile 64 4", ["[VAM TPE] Task Scheduled -> Slot #0: dell-aero-hbm3", "HIGH_BANDWIDTH_INTENSIVE"]),
        ("vam bench", ["VAM TASK PERFORMANCE ENHANCER MULTI-WORKLOAD BENCHMARK", "LLM_TENSOR_WEIGHTS", "RAYTRACING_FRAME", "CRYPTO_AES_BLOCKS"]),
        ("hvm", ["HPE MULTI-OS HETEROGENEOUS VIRTUAL MACHINE (HVM)", r"re:Guest\ Physical\ Memory:\ SOS:\ \d+\ MiB\ \(0x[0-9A-Fa-f]+\)", "BARRIER=true", "Virtual Core Pinning: SOS Cores", r"re:VR\-NIC\ Counters:\ RMA\ Intercepts:\ \d+"]),
        ("hvm rma put 8192", ["[VR-NIC RMA] Intercepted RMA_PUT (8192 B) -> Converted to Ethernet Frame", "Signaled Inter-Processor Interrupt from SOS Core 0 -> AOS Core 4"]),
        ("hvm poll", ["[AOS NET] Dequeued Frame", "Passed down Protocol Stack -> Physical NIC [SENT]"]),
        ("hvm ingress 1400", ["[AOS INGRESS] Received 1400 bytes on Physical NIC -> Ingress Shared Memory -> Delivered to SOS VR-NIC"]),
        ("wasm", ["EMBEDDED WEBASSEMBLY (WASM) MICRO-SANDBOX & FUEL METER", "Specification: W3C WebAssembly Core 1.0", "Linear Memory: 1 Page (65536 bytes / 64 KiB)", "Execution State: Last Return: 200"]),
        ("wasm test", ["WEBASSEMBLY (WASM) SANDBOX TEST SUITE", "[WASM PASS] Module 'math_expr' returned 200 (Expected 200)", "[WASM PASS] Module 'memory_store_load' returned 50 (Expected 50)"]),
        ("wasm fuel 25000", ["[WASM] Reset runtime fuel budget to 25000 units"]),
        ("maxq", ["NVIDIA MAX-Q OPTIMAL OPERATING POINT ESTIMATOR", r"re:Active\ Mode:\ MAX_EFFICIENCY\ \(Tangent\ dPerf/dPower\ Slope\ Threshold\)", r"re:Current\ V\-F\ State:\ GPU:\ \d+\ MHz\ \(\d+\ mV\)", r"re:Telemetry\ \&\ Budget:\ Shared\ TDP:\ \d+\ W"]),
        ("maxq opt perf", ["[MAX-Q] Optimization Mode switched to: MAX_PERFORMANCE"]),
        ("maxq step", ["[MAX-Q OPTIMAL POINT]", r"re:Predicted\ Output:\ \d+\ FPS", r"re:Predicted\ Draw:\ \d+\ Watts\ \(TDP:\ \d+W\)"]),
        ("maxq step mem", ["[MAX-Q OPTIMAL POINT] GPU: 1500 MHz", "GPU clock capped: memory bottleneck detected"]),
        ("maxq opt eff", ["[MAX-Q] Optimization Mode switched to: MAX_EFFICIENCY"]),
        ("shm", ["BEIJING VOYAGER SHARED MEMORY IPC", r"re:Registered\ Topics:\ \d+", "Topic #0: 'lidar_cloud'"]),
        ("shm pub 1 MISSION_TELEMETRY_SAMPLE_OK", ["[VOYAGER SHM] Published", r"re:Published \d+ bytes to Topic #1 -> new tail_offset=\d+"]),
        ("shm sub 1", [r're:\[VOYAGER\ SHM\]\ Subscribed\ read:\ \d+\ bytes\ from\ Topic\ \#\d+:\ "MISSION_TELEMETRY_SAMPLE_OK"', "MISSION_TELEMETRY_SAMPLE_OK"]),
        ("arais", ["S2 SYSTEMS ARAIS NETWORK VECTOR RENDERING", "Interception Level: SourceCodeHook", r"re:Bandwidth\ Optimization:\ Vector\ Sent:\ \d+\ B"]),
        ("arais level dll", ["[ARAIS] Interception Level set to: DllDetour"]),
        ("arais flush", ["[ARAIS] Flushed", "vector commands to WebAssembly Canvas renderer"]),
        ("astguard", ["TALA SECURITY SCRIPT AST / GAST STRUCTURE GUARD", r"re:Registered\ GAST\ Clusters:\ \d+/\d+", "telemetry_loop", "login_form"]),
        ("astguard test", ["[AST GUARD PASS] Script classified as BENIGN", "[AST GUARD BLOCK] Malicious script intercepted & blocked"]),
        ("kwasm", ["BLACK SESAME IN-KERNEL WEBASSEMBLY (KWASM) ENGINE", "FPU Policy: STRICT_DISABLED (Kernel Safe)", "Symbol #0: 'sys_get_uptime'"]),
        ("kwasm test", ["[KWASM PASS] Invoked 'sys_math_i64_add(500, 250)' in kernel space -> result=750", r"re:\[KWASM\ PASS\]\ FPU\ opcode\ 0x[0-9A-Fa-f]+\ rejected:\ FPU\ instruction\ rejected:\ Kernel\-mode\ WebAssembly\ strictly\ forbids\ floating\-point"]),
        ("kwasm call sys_read_pci 1 2", ["[KWASM] 'sys_read_pci(1, 2)' returned: 65538"]),
        ("mddma", ["WAVE COMPUTING MULTIDIMENSIONAL DMA", "256-bit Descriptor: Base: 0x00000000E0000000", r"re:Hardware\ PE\ Quad\ Cluster:\ q\d+=AwakeDataValid\ q\d+=LowPowerSleep\ q\d+=LowPowerSleep\ q\d+=LowPowerSleep"]),
        ("mddma burst 0xE0000000 4096", ["[MD-DMA] Burst transfer: Base 0x00000000E0000000 -> 4096 bytes (4KB-Aligned: true)"]),
        ("mddma 5d", ["[MD-DMA] 5-D Tensor Address Synthesized: Base 0x0000000020000000 -> Element [2,1,2,1,1]"]),
        ("dtree", ["INTEL MEMORY-EFFICIENT FLAT DECISION TREE (US 2021/0097449 A1)", "Flat Node Array: 9 nodes active", "In-place contiguous feature splitting"]),
        ("dtree eval 80 85 50 40", ["[DTREE] Telemetry [T:80C, P:85W, Heap:50%, Rate:40Hz] -> Classification: THERMAL_THROTTLE_REQUIRED"]),
        ("dtree test", ["[DTREE PASS] Telemetry [60, 65, 40, 50] -> NOMINAL_CRUISE [Nominal Flight]", "[DTREE PASS] Telemetry [80, 85, 50, 40] -> THERMAL_THROTTLE_REQUIRED [Thermal Throttle (Temp > 75C)]"]),
        ("panda", ["TOM HERBERT PANDA PARALLEL PIPELINE & PARSER GRAPH (US 12,026,546 B2)", "PANDA Thread Set: 4 worker threads active", "Vertical parallelism"]),
        ("panda test", ["[PANDA PASS] Vertical Parallelism on 'quic'", "Vertical Parallel Execution Completed"]),
        ("fortinet", ["FORTINET KERNEL SPACE PACKET CAPTURE & EOS (US 11,870,693 B2)", "Header Slice: 78 Bytes"]),
        ("fortinet test", [r"re:\[FORTINET\ PASS\]\ EOS\ Benchmark:\ \d+\ packets\ tested\ \->\ Accuracy\ Ratio:\ \d+%", "Accuracy Ratio: 100%", "SATISFACTORY_PERFORMANCE"]),
        ("nudt", ["NUDT JOINT KERNEL-USER NETWORK ACCELERATOR (CN 118301090 A)", r"re:Shared\ Flow\ Map:\ \d+\ rules\ active\ \(Max:\ \d+\)", "Latency Drop: -84%"]),
        ("nudt test", ["[NUDT PASS] Packet 0x9999: FirstUploadToController", "[NUDT PASS] Packet 0x9999 (Hit): FastPathBypassReassembled"]),
        ("snic", ["YUANNAO SMARTNIC HARDWARE-OFFLOADED XDP ENGINE (CN 116996602 B)", r"re:SmartNIC\ SRAM\ MetaTable:\ \d+\ rules\ active\ \(Max:\ \d+\)", "Host CPU Utilization: 0%"]),
        ("snic test", ["[SMARTNIC PASS] Valid Ingress: TxHardwareNat", "[SMARTNIC PASS] Anomaly Ingress (TTL=0): DropAnomaly", "[SMARTNIC PASS] Deadline Exceeded: DropTimeoutDeadline"]),
        ("afxdp", ["CAS CNIC DUAL-STACK AF_XDP MULTIPLEXER (CN 115714679 A)", r"re:UMEM\ Memory\ Pool:\ Chunk\ Size:\ \d+\ B", r"re:Zero\-Copy\ Transfer\ Volume:\ \d+\ bytes\ delivered\ directly\ to\ UMEM\ rings"]),
        ("afxdp test", ["[AF_XDP PASS] Class 1 Packet: Class1UserSpace", "[AF_XDP PASS] Class 2 Packet: Class2KernelSpace"]),
        ("mesh", ["LANGHE SERVICE MESH SOCKOPS ACCELERATOR (CN 114025370 B)", "Service Mesh Topology: Sidecar Proxy Port: 15001", r"re:Sockmap\ Two\-Way\ Mappings:\ \d+\ active\ connection\ tuples\ \(Max:\ \d+\)"]),
        ("mesh test", ["[MESH PASS] Egress Intercept: EgressDivertedToSidecar(15001)", "[MESH PASS] Ingress Restore: IngressRestoredOriginalPort(8080)"]),
        ("soundhound", ["SOUNDHOUND DIFFERENTIAL SPATIAL RENDERING ENGINE (US 11,589,184 B1)", r"re:Listener\ Head\ Pose:\ Pos=\(\d+,\d+,\d+\)", r"re:Spatial\ Sources:\ \d+\ registered\ \(Max:\ \d+\)"]),
        ("soundhound test", ["[SOUNDHOUND PASS] Differential Spatial Test: SoundHound differential spatial rendering verified"]),
        ("ericsson", ["ERICSSON SPATIALLY HETEROGENEOUS 6DoF AUDIO ENGINE (JP 2022-515910 A)", r"re:Listener\ Virtual\ Coordinates:\ \(\d+,\ \d+,\ \d+\)\ cm", r"re:Optimization\ Telemetry:\ Matrix\ Updates:\ \d+"]),
        ("ericsson test", ["[ERICSSON PASS] 6DoF Hetero-Audio Dynamics: Ericsson 6DoF heterogeneous audio verified"]),
        ("astound", ["GENAUDIO ASTOUNDSOUND 4D SPATIALIZATION ENGINE (US 9,154,896 B2)", r"re:\d+D\ Trajectory\ State:\ Pos=\(\d+,\d+,\d+\)\ cm", r"re:%\-Center\ Bypass:\ Center\ Concentration:\ \d+%"]),
        ("astound test", ["[ASTOUND PASS] AstoundSound 4D Engine: AstoundSound 4D engine verified"]),
        ("vcr", ["RBC VIRTUAL CLEAN ROOM MULTIPARTY ENCLAVE (US 12,210,636 B2)", "Attestation State: Verified (SVN >= 2)", "Non-Exportable (NE): CRD_NO"]),
        ("vcr test", ["[VCR PASS] RBC Virtual Clean Room: RBC Virtual Clean Room verified"]),
        ("fsm", ["UCF DUAL FS/M BYTE-ADDRESSABLE DAX CONTROLLER (US 11,398,894 B2)", "Hardware Tables: CPT: 4 Cores mapped", "Line-Rate Crypto: Dual-Pad XOR"]),
        ("fsm test", ["[FSM PASS] UCF Dual FS/M DAX: UCF Dual FS/M verified"]),
        ("mongo", ["MONGODB PLUGGABLE ENCRYPTED STORAGE ENGINE (US 10,846,411 B2)", r"re:Active\ Storage\ Format:\ Row\-Store\ \(B\+\ Tree\)", "Key Hierarchy: System Master Key"]),
        ("mongo test", ["[MONGO PASS] MongoDB Pluggable Storage: MongoDB Pluggable Encrypted Storage verified"]),
        ("enclave", ["MICROSOFT CROSS-PLATFORM ENCLAVE IDENTITY ENGINE (EP 3 574 435 B1)", "Abstraction Model: SGX & VSM Unified ABI", "5-Tier Identity: ExactHash"]),
        ("enclave test", ["[ENCLAVE PASS] Microsoft Cross-Platform: Microsoft Cross-Platform Enclaves verified"]),
        ("metal", ["APPLE METAL UNIFIED SHADING & COMPUTE PIPELINE ENGINE (EP 3 137 992 B1)", "Language Model: Unified C++11 Graphics & Compute", "Address Spaces: global (VRAM)"]),
        ("metal test", ["[METAL PASS] Apple Metal Engine: All 7 Metal unified shader & compute pipeline checks PASSED"]),
        ("metal pipeline", [r"re:\[METAL\ PIPELINE\]\ Transformed\ Pos:\ \[\d+\.\d+,\ \d+\.\d+,\ \d+\.\d+,\ \d+\.\d+\]\ \->\ Shaded\ Pixel:\ 0x[0-9A-Fa-f]+"]),
        ("kunlun", ["KUNLUNXIN CONFIDENTIAL AI MESH & ATTESTATION ENGINE (CN 112528244 B / CN 112953855 B)", "Silicon Security: Die-Integrated SU (SK_RK / PK_RK)", "Fabric Topology: 4-DPA Inter-Accelerator Ring/Mesh"]),
        ("kunlun test", ["[KUNLUN PASS] Confidential AI Mesh & Attestation: All Kunlunxin confidential AI mesh & attestation tests passed"]),
        ("kunlun broadcast", ["[KUNLUN BROADCAST] Succeeded across 4 hops: Broadcast traversed entire ring; cycle terminated at originator"]),
        ("kunlun drm", ["[KUNLUN DRM] Model 0xCAFE0001 Validated!", "Valid: true"]),
        ("kunlun attest", ["[KUNLUN ATTEST] Kernel 0x2001 Attested!", "Valid: true"]),
        ("kunlun cache", [r"re:\[KUNLUN\ CACHE\]\ Slot\ \d+\ Active\ Algorithm:\ HybridDualFactor\ \(T_expire\ valid\)", "T_expire valid"]),
        ("antmem", ["ANT GROUP SAFE MEMORY & NUDT FORMAL INVARIANTS (CN 117908859 A / CN 116484439 B)", "Architecture: 100% Safe Management Interface (101)", "Kernel Stack Guard Page (4 KiB at boot_stack_bottom)"]),
        ("antmem test", ["[ANTMEM PASS] Safe Memory & Invariants: All Ant Group safe memory & NUDT formal invariant tests passed"]),
        ("quantum", ["QOMPLX HYBRID QUANTUM ORCHESTRATOR & BUPT RTOS (US 2026/0148042 A1 / CN 117931412 A)", "Orchestration: Content-Aware Complexity Scoring across CPU SIMD, Tensor Mesh & Quantum Annealer", "Flight RTOS: Dual-Kernel Priority Ceiling with Backtracking Stack"]),
        ("quantum test", ["[QUANTUM PASS] Complexity Router & Priority Backtracking: All Qomplx complexity orchestrator & BUPT priority backtracking tests passed"]),
        ("quantum route qubo", ["[QUANTUM ROUTE] Task 'qubo' -> Tier: QuantumAnnealingQubo", "Combinatorial NP-hard / Quadratic Hamiltonian"]),
        ("quantum solve", ["[QUANTUM SOLVE] Spins: 8", "Converged: true"]),
        ("browse test", ["[BROWSER PASS] Web Engine & HTTP: All web browser & HTTP engine tests passed"]),
        ("bookmarks", ["POST CARD SPATIAL OS - WEB BOOKMARKS", "Spatial OS Studio", "Linux Kernel Archives"]),
        ("browse http://github.com", ["HTTP 200 OK", "GitHub - Post-Card-Spatial-OS"]),
        ("email test", ["[EMAIL PASS] Mailbox & Provenance: All email client & mailbox tests passed"]),
        ("email inbox", ["INBOX MAILBOX (SPATIAL OS CARRIER)", "avionics@postcard.os", "Welcome to Post Card Spatial OS"]),
        ("email read 1", ["EMAIL MESSAGE #1", "From:    avionics@postcard.os", "Status:  RelayDelivered"]),
        ("email send ground-control@satellite.org FlightStatus Nominal", ["[EMAIL SENT] Message", "queued for dispatch to <ground-control@satellite.org>"]),
        ("socbridge", ["DISAGGREGATED SoC SYSCALL BRIDGE & ARBITER STACK (CN 113989099 B / US 2020/0301764 A1)", "SoC Chiplets: 3 dies active"]),
        ("socbridge test", ["[SOCBRIDGE PASS] CN113989099B SoC Bridge & US2020/0301764A1 Arbiter/NAPI checks passed"]),
        ("forensics", ["HYPERVISOR FORENSICS & ZERO-CONTEXT-SWITCH eBPF (US 9,721,089 B2 / US 12,242,629 B2)", r"re:Version\-Tree\ Entries:\ \d+"]),
        ("forensics test", ["[FORENSICS PASS] US9721089B2 Forensics & US12242629B2 eBPF In-Kernel Audit passed"]),
        ("anjuna", ["ANJUNA SECURE RUNTIME & BARKLY HYPERVISOR MSR SHADOW (US 11,714,895 B2 / US 9,589,132 B2)", r"re:OS\ Bridge:\ \d+\ Syscalls"]),
        ("anjuna test", ["[ANJUNA PASS] US11714895B2 Enclave Runtime & US9589132B2 MSR Shadow/EPT verified"]),
        ("gpuslide", ["CITRIX DYNAMIC GPU PASSTHROUGH <-> EMULATION SLIDING (US 9,406,099 B2)", r"re:Active\ Hardware\ GPU\ Owner:\ VM\ \d+"]),
        ("gpuslide test", ["[GPUSLIDE PASS] US9406099B2 Dynamic GPU Sliding & Emulation continuity verified"]),
        ("provenance", ["OMEGALOG UPG & POINT-ISA PVM GUARD (US 11,704,129 B2 / US 11,042,631 B2)", r"re:L_uni\ Events:\ \d+"]),
        ("provenance test", ["[PROVENANCE PASS] US11704129B2 OmegaLog UPG/CFI + US11042631B2 Point-ISA/DTAM/DataMeld verified"]),
        ("diov", ["DYNAVISOR DIOV STREAMS & BIDIRECTIONAL EHAS (US 9,910,689 B2)", r"re:Streams\ Processed:\ \d+"]),
        ("diov test", ["[DIOV PASS] US9910689B2 Split-Context Streams, Bidirectional EHAS, RFO-free Cache & diovmalloc verified"]),
        ("slmshare", ["INTER-KERNEL SHARED LOCAL MEMORY SHARING (CN 113490917 A)", r"re:SLM\ Flushes\ Bypassed:\ \d+"]),
        ("slmshare test", ["[SLMSHARE PASS] CN113490917A Inter-Kernel SLM Bypass, NN Layer Reuse & Mismatch Flush verified"]),
        ("kadapt", ["CROSS-PLATFORM KERNEL ADAPTATION (CN 119311315 A)", r"re:CSR\ Edges\ \(>=\d+\.\d+\):\ \d+"]),
        ("kadapt test", ["[KADAPT PASS] CN119311315A CSR Matrix (>=0.8), CPUID Probe, Moore FSM & Watchdog verified"]),
        ("oromsandbox", ["BOOT FIRMWARE OROM SANDBOXING (CN 112740211 A)", r"re:Active\ Sandboxes:\ \d+"]),
        ("oromsandbox test", ["[OROM PASS] CN112740211A Ring-3 Boot OROM Sandbox, Downcall/Sidecall & MMIO guard verified"]),
        ("sandbox", [r"re:sandbox\ identity:\ PA\-Romy\ Coprocessor\ Vault\ \[ACTIVE\ //\ ENCLAVE\ LOCKED\]"]),
        ("cpu", [r"re:CPU Vendor: *\| Brand: \S+", r"re:Features: VMX=\d SVM=\d HV=\d"]),
        ("vmx", [
            r"re:VMX Root Active: (true|false) \| VMCS Loaded: (true|false) \| VMCS Rev ID: 0x[0-9A-Fa-f]+",
            r"re:VMXON Region PA: 0x[0-9A-Fa-f]+ \| Guest VMCS PA: 0x[0-9A-Fa-f]+",
            r"re:IA32_FEATURE_CONTROL: 0x[0-9A-Fa-f]+",
            "inv:vmx_state",
        ]),
        ("vms", ["pa-romy-vault", "radiator-rtos"]),
        ("vmrun 0", ["[VM-EXIT] VM 0 [pa-romy-vault]"]),
        ("fly 0", ["[PAPER AIRPLANE]", "CAPSULE HANDOVER FRAME SERIALIZED", r"re:CRC\d+:\ 0x[0-9A-Fa-f]+\ \[INTEGRITY\ OK\]"]),
        ("land 0", ["[PAPER AIRPLANE]", "CAPSULE HANDOVER LANDED & RESUMED", "State: Resumed"]),
        ("elf bench", ["Magic: 7F 45 4C 46", "EM_X86_64"]),
        ("exec telemetry", ["[CATAPULT] Loaded ELF64", "[EXEC OK]"]),
        ("sched", ["PREEMPTIVE / ROUND-ROBIN SCHEDULER", "PID 4: [telemetry]"]),
        ("syscall 39", ["[SYSCALL] nr=39 dispatched"]),
        ("install", ["POST CARD SPATIAL OS - BARE-METAL DISK INSTALLER", "EFI Bootloader: /EFI/BOOT/BOOTX64.EFI [READY]"]),
        ("install test", ["[INSTALL COMPLETE] Post Card Spatial OS successfully installed to disk", "Protective MBR with 0x55AA boot signature"]),
        ("foobar_unknown_cmd", ["unknown command: foobar_unknown_cmd"])
    ]

    # Invariants: relationships that must hold on any machine, asserted instead of
    # assuming what the values are. Nothing here is a guess about the hardware.
    def invariant_vmx_state(output):
        feature = re.search(r"IA32_FEATURE_CONTROL: 0x([0-9A-Fa-f]+)", output)
        active = re.search(r"VMX Root Active: (true|false)", output)
        loaded = re.search(r"VMCS Loaded: (true|false)", output)
        regions = re.search(
            r"VMXON Region PA: 0x([0-9A-Fa-f]+) \| Guest VMCS PA: 0x([0-9A-Fa-f]+)", output
        )
        if not (feature and active and loaded and regions):
            raise AssertionError("vmx output is missing a field this invariant needs")
        root_active = active.group(1) == "true"
        # VMX root operation is only possible with VMX enabled (bit 2) and locked (bit 0)
        vmx_enabled = (int(feature.group(1), 16) & 0x5) == 0x5
        if root_active and not vmx_enabled:
            raise AssertionError(
                f"VMX Root Active is true, but IA32_FEATURE_CONTROL=0x{feature.group(1)} does not "
                f"have VMX enabled and locked, so the CPU cannot be in VMX root operation."
            )
        if root_active and loaded.group(1) != "true":
            raise AssertionError("VMX Root Active is true but no VMCS is loaded")
        vmxon_pa, vmcs_pa = int(regions.group(1), 16), int(regions.group(2), 16)
        if vmxon_pa % 4096 or vmcs_pa % 4096:
            raise AssertionError(
                f"VMXON/VMCS regions must be 4 KiB aligned, got 0x{vmxon_pa:x} and 0x{vmcs_pa:x}"
            )
        if vmxon_pa == vmcs_pa:
            raise AssertionError(
                f"VMXON region and guest VMCS share the physical page 0x{vmxon_pa:x}"
            )

    INVARIANTS = {"vmx_state": invariant_vmx_state}

    for cmd, expected_substrings in test_commands:
        print(f"Executing shell command: '{cmd}'")
        log_write(f"spatial> {cmd}\n")
        proc.stdin.write(f"{cmd}\n".encode("utf-8"))
        proc.stdin.flush()
        
        output = read_until("spatial> ", timeout=10.0)
        for expected in expected_substrings:
            if expected.startswith("inv:"):
                name = expected[4:]
                if name not in INVARIANTS:
                    raise AssertionError(f"Unknown invariant '{name}' for command '{cmd}'")
                INVARIANTS[name](output)
                continue
            if expected.startswith("re:"):
                pattern = expected[3:]
                if re.search(pattern, output) is None:
                    raise AssertionError(
                        f"Command '{cmd}' output does not match required pattern '{pattern}'.\n"
                        f"Output:\n{output}"
                    )
                continue
            if expected.rstrip()[-1:] in (":", "="):
                raise AssertionError(
                    f"Assertion '{expected}' for command '{cmd}' only checks that a label was "
                    f"printed, not the value after it. Assert the value, or use an 're:' pattern."
                )
            if expected not in output:
                raise AssertionError(f"Command '{cmd}' output missing expected substring '{expected}'. Output:\n{output}")
        print(f"  [OK] '{cmd}' returned expected output.")

    # Test full GUI Desktop mode entry and exit via 'q'
    print("Executing GUI Desktop launch and exit round-trip...")
    log_write("spatial> gui\n")
    proc.stdin.write(b"gui\n")
    proc.stdin.flush()
    time.sleep(0.5)
    log_write("q\n")
    proc.stdin.write(b"q\n")
    proc.stdin.flush()
    gui_out = read_until("spatial> ", timeout=10.0)
    if "Returned from Spatial Card Deck" not in gui_out:
        raise AssertionError(f"Expected GUI return message. Output:\n{gui_out}")
    print("  [OK] GUI Desktop entered and cleanly returned to shell.")

    print("\nAll shell tests passed successfully!")

finally:
    cleanup()

EOF

echo "QEMU serial shell test completed successfully."
