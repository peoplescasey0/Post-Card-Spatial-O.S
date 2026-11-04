import { execFile, execFileSync, execSync, spawn } from "node:child_process";
import { createConnection, isIP } from "node:net";
import { availableParallelism } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleStripeRequest } from "./stripe-api.mjs";

const execFileAsync = promisify(execFile);
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(appDirectory, "..");
const DEFAULT_WEBSOCKET_PORT = 5700;
const DEFAULT_QMP_PORT = 4444;
const DEFAULT_VNC_PORT = 5900;
const DEFAULT_SERIAL_PORT = 4544;
const DEFAULT_TPM_PORT = 23200;
const MAX_GUESTS = 16;
const MAX_CONCURRENT_GUESTS = 6;
const GUEST_MEMORY_MB = 2048;
const DEFAULT_DISK_SIZE = "32G";
const WINDOWS_DISK_SIZE = "64G";
const WINDOWS_MEMORY_MB = 4096;
const MAX_GUEST_MEMORY_MB = 8192;
const MAX_GUEST_VCPUS = 4;
const EXPECTED_DISK_SIZE = 32 * 1024 * 1024 * 1024;
const START_TIMEOUT_MS = 20_000;
const GUEST_RUNTIME_KEY = Symbol.for("post-card-os.guest-runtime");
const WINDOWS_OS = "windows";
const LINUX_OS = "linux";
const ANDROID_OS = "android";
const MACOS_OS = "macos";

function resolveCardMemoryMb(os, profile = "eco") {
  if (os === WINDOWS_OS || os === MACOS_OS) {
    if (profile === "performance") return 4096;
    if (profile === "balanced") return 3072;
    return 2048;
  }
  if (profile === "performance") return 2048;
  if (profile === "balanced") return 1536;
  return 1024;
}

function resolveCardVcpus(profile = "balanced") {
  const requested = profile === "gaming" ? 4 : profile === "eco" ? 1 : 2;
  return Math.max(1, Math.min(requested, MAX_GUEST_VCPUS, availableParallelism()));
}

class GuestApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isLoopback(address) {
  if (!address) return false;
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (isIP(address) === 4) return address.startsWith("127.");
  return address === "::1";
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 2048) {
  if (!request.headers["content-type"]?.includes("application/json")) {
    throw new GuestApiError(415, "Expected an application/json request.");
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxBytes) {
      throw new GuestApiError(413, "Request body is too large.");
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new GuestApiError(400, "Request body must be valid JSON.");
  }
}

function findExecutable(environmentKey, defaultPath, executableName) {
  const configuredPath = process.env[environmentKey];
  if (configuredPath) return configuredPath;

  if (process.platform === "win32") {
    const standardPath = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "qemu", executableName);
    return standardPath;
  }

  return defaultPath;
}

async function executableExists(executable) {
  if (path.isAbsolute(executable)) {
    try {
      return (await stat(executable)).isFile();
    } catch {
      return false;
    }
  }
  return true;
}

async function imageInfo(qemuImgPath, diskPath) {
  if (!(await executableExists(qemuImgPath))) {
    throw new GuestApiError(503, `qemu-img was not found at ${qemuImgPath}. Set POSTCARD_QEMU_IMG to its path.`);
  }
  try {
    const result = await execFileAsync(qemuImgPath, ["info", "--output=json", diskPath], {
      windowsHide: true,
      timeout: 30_000,
    });
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new GuestApiError(500, `Could not inspect guest disk ${diskPath}: ${error.message}`);
  }
}

async function createEmptyDiskIfNeeded(diskPath, qemuImgPath, diskSize = DEFAULT_DISK_SIZE) {
  await mkdir(path.dirname(diskPath), { recursive: true });
  try {
    const existing = await stat(diskPath);
    if (!existing.isFile()) {
      throw new GuestApiError(500, `Guest disk path is not a file: ${diskPath}`);
    }
    return;
  } catch (error) {
    if (error instanceof GuestApiError) throw error;
    if (error.code !== "ENOENT") throw error;
  }

  if (!(await executableExists(qemuImgPath))) {
    throw new GuestApiError(503, `qemu-img was not found at ${qemuImgPath}. Set POSTCARD_QEMU_IMG to its path.`);
  }

  try {
    await execFileAsync(qemuImgPath, ["create", "-f", "qcow2", diskPath, diskSize], {
      windowsHide: true,
      timeout: 30_000,
    });
  } catch (error) {
    throw new GuestApiError(500, `Could not create the Linux guest disk: ${error.message}`);
  }
}

async function createOverlayIfNeeded(baseDiskPath, overlayPath, qemuImgPath) {
  const verifyBacking = async () => {
    const info = await imageInfo(qemuImgPath, overlayPath);
    if (
      info.format !== "qcow2" ||
      !info["backing-filename"] ||
      path.resolve(info["backing-filename"]) !== baseDiskPath
    ) {
      throw new GuestApiError(409, `The overlay for this card does not use the configured Debian golden image: ${overlayPath}`);
    }
  };
  await mkdir(path.dirname(overlayPath), { recursive: true });
  try {
    const existing = await stat(overlayPath);
    if (!existing.isFile()) {
      throw new GuestApiError(500, `Guest overlay path is not a file: ${overlayPath}`);
    }
    await verifyBacking();
    return;
  } catch (error) {
    if (error instanceof GuestApiError) throw error;
    if (error.code !== "ENOENT") throw error;
  }

  await imageInfo(qemuImgPath, baseDiskPath);
  try {
    await execFileAsync(
      qemuImgPath,
      ["create", "-f", "qcow2", "-b", baseDiskPath, "-F", "qcow2", overlayPath],
      { windowsHide: true, timeout: 30_000 },
    );
    await verifyBacking();
  } catch (error) {
    if (error instanceof GuestApiError) throw error;
    throw new GuestApiError(500, `Could not create the card's QCOW2 overlay: ${error.message}`);
  }
}

function tcpPortIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForQemu(child, port) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new GuestApiError(500, `QEMU exited before its display was ready (exit ${child.exitCode}).`);
    }
    if (await tcpPortIsOpen(port)) return;
    await wait(150);
  }
  throw new GuestApiError(504, "QEMU started but its VNC display did not become ready in time.");
}

function buildNetworkArgs(networkMode = "nat", deviceModel = "virtio-net-pci") {
  if (networkMode === "airgap") {
    return ["-nic", "none"];
  }
  if (networkMode === "cyber-range") {
    return [
      "-netdev", "socket,id=net0,mcast=230.0.0.1:4550",
      "-device", `${deviceModel},netdev=net0`,
    ];
  }
  return [
    "-netdev", "user,id=net0",
    "-device", `${deviceModel},netdev=net0`,
  ];
}

function qemuArguments({ bootMode, cardId, diskPath, isoPath, ports, networkMode = "nat", dropDir, memoryMb = 1024, vcpus = 2, isMacOs = false, openCorePath = "", macOvmfCode = "", macOvmfVars = "", kernelPath = "", initrdPath = "" }) {
  if (isMacOs) {
    const args = [
      "-name", `Post Card ${cardId} macOS guest`,
      "-machine", "q35",
      "-accel", process.platform === "win32" ? "whpx,kernel-irqchip=off" : "tcg",
      "-cpu", "Penryn,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on,+ssse3,+sse4.2,+popcnt,+avx,+aes,+xsave,+xsaveopt",
      "-smp", String(vcpus),
      "-m", String(memoryMb),
      // The Apple SMC key is not bundled. Supply your own via POSTCARD_MAC_OSK.
      "-device", process.env.POSTCARD_MAC_OSK ? `isa-applesmc,osk=${process.env.POSTCARD_MAC_OSK}` : "isa-applesmc",
      "-smbios", "type=2",
      "-device", "ich9-ahci,id=sata",
      "-device", "ich9-intel-hda",
      "-device", "hda-duplex",
      ...(macOvmfCode && existsSync(macOvmfCode)
        ? [
            "-drive", `if=pflash,format=raw,readonly=on,file=${macOvmfCode}`,
            "-drive", `if=pflash,format=raw,file=${macOvmfVars}`,
          ]
        : []),
      ...(openCorePath && existsSync(openCorePath)
        ? [
            "-drive", `id=OpenCoreBoot,if=none,snapshot=on,format=qcow2,file=${openCorePath}`,
            "-device", "ide-hd,bus=sata.2,drive=OpenCoreBoot",
          ]
        : []),
      ...(isoPath && existsSync(isoPath)
        ? [
            "-drive", `id=InstallMedia,if=none,format=${/\.(img|raw)$/i.test(isoPath) ? "raw" : "qcow2"},file=${isoPath}`,
            "-device", "ide-hd,bus=sata.3,drive=InstallMedia",
          ]
        : []),
      "-drive", `file=${diskPath},if=none,id=macdisk,format=${/\.(img|raw)$/i.test(diskPath) ? "raw" : "qcow2"}`,
      "-device", "ide-hd,bus=sata.4,drive=macdisk",
      "-device", "vmware-svga",
      "-device", "qemu-xhci",
      "-device", "usb-kbd",
      "-device", "usb-tablet",
      ...buildNetworkArgs(networkMode, "e1000"),
      ...(ports.serialPort
        ? [
            "-chardev", `socket,id=charserial0,host=127.0.0.1,port=${ports.serialPort},server=on,wait=off`,
            "-serial", "chardev:charserial0",
          ]
        : []),
      "-display", "none",
      "-vnc", `127.0.0.1:${ports.vncPort - DEFAULT_VNC_PORT},websocket=${ports.websocketPort}`,
      "-qmp", `tcp:127.0.0.1:${ports.qmpPort},server=on,wait=off`,
    ];
    return args;
  }
  const args = [
    "-name", `Post Card ${cardId} Linux guest`,
    "-machine", "q35",
    // WHPX's in-kernel IRQ chip hangs SeaBIOS at "Booting from Hard Disk...";
    // the userspace IRQ chip boots reliably.
    "-accel", process.platform === "win32" ? "whpx,kernel-irqchip=off" : "tcg",
    "-cpu", "max",
    "-smp", String(vcpus),
    "-m", String(memoryMb),
    "-device", "virtio-balloon",
    // Explicit bootindex: SeaBIOS otherwise prefers the IDE paper-plane FAT
    // drive over the virtio OS disk and hangs at "Booting from Hard Disk...".
    "-drive", `file=${diskPath},if=none,id=osdisk,format=qcow2`,
    "-device", `virtio-blk-pci,drive=osdisk${bootMode === "installer" ? "" : ",bootindex=0"}`,
    "-device", "virtio-vga",
    "-device", "qemu-xhci",
    "-device", "usb-kbd",
    "-device", "usb-tablet",
    ...(dropDir ? ["-drive", `file=fat:rw:${dropDir},if=ide,index=2,format=raw`] : []),
    ...buildNetworkArgs(networkMode, "e1000"),
    ...(ports.serialPort
      ? [
        "-chardev", `socket,id=charserial0,host=127.0.0.1,port=${ports.serialPort},server=on,wait=off`,
        "-serial", "chardev:charserial0",
      ]
      : []),


    "-display", "none",
    "-vnc", `127.0.0.1:${ports.vncPort - DEFAULT_VNC_PORT},websocket=${ports.websocketPort}`,
    "-qmp", `tcp:127.0.0.1:${ports.qmpPort},server=on,wait=off`,
  ];

  if (kernelPath && existsSync(kernelPath)) {
    args.push("-kernel", kernelPath);
    if (initrdPath && existsSync(initrdPath)) {
      args.push("-initrd", initrdPath);
    }
  } else if (bootMode === "installer") {
    args.push("-cdrom", isoPath, "-boot", "order=d");
  } else {
    args.push("-boot", "order=c");
  }

  return args;
}

export function windowsPathToWsl(windowsPath, distribution) {
  if (typeof windowsPath !== "string") return "";
  const cleaned = windowsPath.replaceAll("\\", "/");
  if (cleaned.startsWith("/mnt/")) return cleaned;
  const uncMatch = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i.exec(cleaned);
  if (uncMatch) {
    const [, uncDistribution, uncPath = ""] = uncMatch;
    if (distribution && uncDistribution.toLowerCase() !== distribution.toLowerCase()) {
      throw new Error(
        `Windows ISO UNC path belongs to WSL distribution "${uncDistribution}", but POSTCARD_WSL_DISTRO is "${distribution}".`,
      );
    }
    return `/${uncPath.replace(/^\/+/, "")}`;
  }
  const match = /^([a-zA-Z]):\/(.*)$/.exec(cleaned);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
  return cleaned;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function guestKey(os, cardId) {
  return `${os}:${cardId}`;
}

function windowsQemuArguments({ bootMode, cardId, diskPath, isoPath, firmwarePath, varsPath, tpmSocketPath, ports, networkMode = "nat", dropDir, memoryMb = 2048, vcpus = 2 }) {
  const args = [
    "-name", `Post Card ${cardId} Windows guest`,
    "-machine", "q35,smm=on",
    "-accel", "kvm",
    "-accel", "tcg,thread=multi",
    // -svm/-vmx: this VM already runs nested inside WSL's Hyper-V VM. If Windows sees
    // virtualization extensions it enables VBS/Hyper-V mid-install and KVM dies with
    // "internal-error" (kvm_amd invalid VMCB). hv-*: standard Windows-on-KVM hints.
    "-cpu", "max,-svm,-vmx,hv-relaxed,hv-vapic,hv-spinlocks=0x1fff,hv-time",
    "-smp", String(vcpus),
    "-m", String(memoryMb),
    "-device", "virtio-balloon",
    "-drive", `if=pflash,format=raw,unit=0,readonly=on,file=${firmwarePath}`,
    "-drive", `if=pflash,format=raw,unit=1,file=${varsPath}`,
    "-drive", `file=${diskPath},if=ide,index=0,format=qcow2`,
    "-vga", "std",
    "-device", "qemu-xhci",
    "-device", "usb-kbd",
    "-device", "usb-tablet",
    ...(dropDir ? ["-drive", `file=fat:rw:${dropDir},if=ide,index=2,format=raw`] : []),
    ...buildNetworkArgs(networkMode, "e1000"),
    ...(ports.serialPort
      ? [
        "-chardev", `socket,id=charserial0,host=127.0.0.1,port=${ports.serialPort},server=on,wait=off`,
        "-serial", "chardev:charserial0",
      ]
      : []),

    "-chardev", `socket,id=chrtpm,path=${tpmSocketPath}`,
    "-tpmdev", "emulator,id=tpm0,chardev=chrtpm",
    "-device", "tpm-tis,tpmdev=tpm0",
    "-display", "none",
    "-vnc", `127.0.0.1:${ports.vncPort - DEFAULT_VNC_PORT},websocket=${ports.websocketPort}`,
    "-qmp", `tcp:127.0.0.1:${ports.qmpPort},server=on,wait=off`,
  ];
  if (bootMode === "installer") {
    args.push("-drive", `file=${isoPath},media=cdrom,if=ide,index=1`, "-boot", "order=d");
  } else {
    args.push("-boot", "order=c");
  }
  return args;
}

function charToQKeyCodes(ch) {
  if (ch >= "a" && ch <= "z") return [ch];
  if (ch >= "A" && ch <= "Z") return ["shift", ch.toLowerCase()];
  if (ch >= "0" && ch <= "9") return [ch];
  const map = {
    " ": ["spc"],
    "\n": ["ret"],
    "\r": ["ret"],
    "\t": ["tab"],
    "-": ["minus"],
    "_": ["shift", "minus"],
    "=": ["equal"],
    "+": ["shift", "equal"],
    "[": ["bracket_left"],
    "{": ["shift", "bracket_left"],
    "]": ["bracket_right"],
    "}": ["shift", "bracket_right"],
    ";": ["semicolon"],
    ":": ["shift", "semicolon"],
    "'": ["apostrophe"],
    "\"": ["shift", "apostrophe"],
    ",": ["comma"],
    "<": ["shift", "comma"],
    ".": ["dot"],
    ">": ["shift", "dot"],
    "/": ["slash"],
    "?": ["shift", "slash"],
    "\\": ["backslash"],
    "|": ["shift", "backslash"],
    "`": ["grave_accent"],
    "~": ["shift", "grave_accent"],
    "!": ["shift", "1"],
    "@": ["shift", "2"],
    "#": ["shift", "3"],
    "$": ["shift", "4"],
    "%": ["shift", "5"],
    "^": ["shift", "6"],
    "&": ["shift", "7"],
    "*": ["shift", "8"],
    "(": ["shift", "9"],
    ")": ["shift", "0"],
  };
  return map[ch] ?? null;
}

function textToQmpSendKeyCommands(text) {
  const commands = [];
  for (const ch of text) {
    const codes = charToQKeyCodes(ch);
    if (!codes) continue;
    commands.push({
      execute: "send-key",
      arguments: {
        keys: codes.map((data) => ({ type: "qcode", data })),
        "hold-time": 20,
      },
    });
  }
  return commands;
}

function requestQmpCommands(port, commands) {
  if (commands.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    let buffer = "";
    let greetingSeen = false;
    let capabilitiesSent = false;
    let commandIndex = -1;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new GuestApiError(504, "Timed out communicating with QEMU."));
    }, 8_000);

    const finish = (error) => {
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    const sendNext = () => {
      commandIndex += 1;
      if (commandIndex >= commands.length) {
        finish();
        return;
      }
      const cmd = commands[commandIndex];
      const payload = typeof cmd === "string" ? { execute: cmd } : cmd;
      socket.write(`${JSON.stringify(payload)}\r\n`);
    };

    socket.once("error", (error) =>
      finish(new GuestApiError(503, `Cannot reach QEMU control socket: ${error.message}`)),
    );
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.QMP && !greetingSeen) {
          greetingSeen = true;
          socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\r\n`);
          capabilitiesSent = true;
        } else if (capabilitiesSent && (message.return || message.error)) {
          if (message.error) {
            finish(
              new GuestApiError(500, message.error.desc ?? "QEMU rejected control command."),
            );
            return;
          }
          sendNext();
        }
      }
    });
  });
}

/** Send one QMP command and resolve with QEMU's full reply ({ return } or { error }). */
function requestQmpRaw(port, command, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    let buffer = "";
    let ready = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new GuestApiError(504, "Timed out communicating with QEMU."));
    }, timeoutMs);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.once("error", (error) => finish(new GuestApiError(503, `Cannot reach QEMU control socket: ${error.message}`)));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.QMP) {
          socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\r\n`);
        } else if (!ready && message.return !== undefined) {
          ready = true;
          socket.write(`${JSON.stringify(command)}\r\n`);
        } else if (ready && (message.return !== undefined || message.error)) {
          finish(null, message);
          return;
        }
      }
    });
  });
}

function requestQmpCommand(port, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    let buffer = "";
    let greetingSeen = false;
    let capabilitiesSent = false;
    let commandSent = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new GuestApiError(504, "Timed out communicating with QEMU."));
    }, 5_000);

    const finish = (error) => {
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.once("error", (error) => finish(new GuestApiError(503, `Cannot reach QEMU control socket: ${error.message}`)));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.QMP && !greetingSeen) {
          greetingSeen = true;
          socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\r\n`);
          capabilitiesSent = true;
        } else if (capabilitiesSent && !commandSent && (message.return || message.error)) {
          if (message.error) {
            finish(new GuestApiError(500, message.error.desc ?? "QEMU rejected control negotiation."));
            return;
          }
          socket.write(`${JSON.stringify({ execute: command })}\r\n`);
          commandSent = true;
        } else if (commandSent && (message.return || message.error)) {
          finish(message.error
            ? new GuestApiError(500, message.error.desc ?? `QEMU rejected ${command}.`)
            : undefined);
          return;
        }
      }
    });
  });
}

function waitForExit(child, timeoutMs, guestName) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new GuestApiError(504, `${guestName} did not shut down in time. It is still running.`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once("exit", onExit);
  });
}

export function createGuestApi(options = {}) {
  const dataDirectory = process.env.POSTCARD_VM_DATA
    ? path.resolve(process.env.POSTCARD_VM_DATA)
    : path.join(appDirectory, "data");
  const cardIdRegistryPath = path.join(dataDirectory, "card-id-registry.json");
  const defaultReservedCardIds = [
    "android",
    "windows",
    "linux",
    "macos",
    "kali-red",
    "workspace-fallback",
    "windows-5",
  ];
  const baseDiskPath = process.env.POSTCARD_LINUX_BASE
    ? path.resolve(process.env.POSTCARD_LINUX_BASE)
    : path.join(dataDirectory, "master-images", "debian-golden.qcow2");
  const overlayDirectory = path.join(dataDirectory, "overlays");
  const readyMarkerPath = path.join(dataDirectory, "debian-golden.ready.json");
  const paperPlanesPath = path.join(dataDirectory, "paper-planes.json");
  const paperPlanesDropDir = path.join(dataDirectory, "paper-planes");
  const checkpointsPath = path.join(dataDirectory, "checkpoints.json");
  const networkModesPath = path.join(dataDirectory, "network-modes.json");
  const memoryProfilesPath = path.join(dataDirectory, "memory-profiles.json");
  const cpuProfilesPath = path.join(dataDirectory, "cpu-profiles.json");
  const customIsosPath = path.join(dataDirectory, "custom-isos.json");
  const androidIsoPath = process.env.POSTCARD_ANDROID_ISO
    ? path.resolve(process.env.POSTCARD_ANDROID_ISO)
    : path.join(projectDirectory, "archive", "guest-vm-setup", "android-x86_64.iso");
  const isoPath = process.env.POSTCARD_DEBIAN_ISO
    ? path.resolve(process.env.POSTCARD_DEBIAN_ISO)
    : path.join(projectDirectory, "archive", "guest-vm-setup", "debian-13.7.0-amd64-netinst.iso");
  const postcardKernelPath = process.env.POSTCARD_KERNEL
    ? path.resolve(process.env.POSTCARD_KERNEL)
    : path.join(dataDirectory, "master-images", "postcard-minimal-kernel");
  const postcardRamdiskPath = process.env.POSTCARD_RAMDISK
    ? path.resolve(process.env.POSTCARD_RAMDISK)
    : path.join(dataDirectory, "master-images", "ramdisk.img");
  // Windows install media is never bundled. Users supply their own licensed ISO
  // via POSTCARD_WINDOWS_ISO or the card's "Load custom OS ISO" action.
  const kvmHostRaw = process.env.POSTCARD_KVM_HOST ?? "";
  const kvmHost = /^([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/.test(kvmHostRaw) ? kvmHostRaw : "";
  const kvmWorkDirRaw = process.env.POSTCARD_KVM_WORKDIR ?? "~/postcard-kvm";
  const kvmWorkDir = /^[A-Za-z0-9._~\/-]+$/.test(kvmWorkDirRaw) ? kvmWorkDirRaw : "~/postcard-kvm";
  const windowsIsoPath = process.env.POSTCARD_WINDOWS_ISO
    ? (process.env.POSTCARD_WINDOWS_ISO.startsWith("\\\\")
      ? process.env.POSTCARD_WINDOWS_ISO
      : path.resolve(process.env.POSTCARD_WINDOWS_ISO))
    : "";
  const windowsDiskDirectory = path.join(dataDirectory, "windows", "disks");
  const windowsFirmwareDirectory = path.join(dataDirectory, "windows", "firmware");
  const windowsTpmDirectory = path.join(dataDirectory, "windows", "tpm");
  let registryMutationQueue = Promise.resolve();
  function withRegistryMutation(operation) {
    const result = registryMutationQueue.then(operation);
    registryMutationQueue = result.catch(() => undefined);
    return result;
  }

  async function readCardIdRegistry() {
    let raw;
    try {
      raw = await readFile(cardIdRegistryPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          version: 1,
          nextId: 1,
          reservedIds: [...defaultReservedCardIds],
          deletedIds: [],
        };
      }
      throw new GuestApiError(500, `Could not read the card ID registry: ${error.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new GuestApiError(500, "The card ID registry is invalid; allocations and deletions are paused to prevent ID reuse.");
    }
    const validIds = (ids) =>
      Array.isArray(ids) &&
      ids.every((id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.nextId) ||
      parsed.nextId < 1 ||
      !validIds(parsed.reservedIds) ||
      !validIds(parsed.deletedIds)
    ) {
      throw new GuestApiError(500, "The card ID registry is invalid; allocations and deletions are paused to prevent ID reuse.");
    }
    return {
      version: 1,
      nextId: parsed.nextId,
      reservedIds: [...new Set([...defaultReservedCardIds, ...parsed.reservedIds])],
      deletedIds: [...new Set(parsed.deletedIds)],
    };
  }

  async function writeCardIdRegistry(registry) {
    const temporaryPath = `${cardIdRegistryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dataDirectory, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(registry, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, cardIdRegistryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new GuestApiError(500, `Could not save the card ID registry: ${error.message}`);
    }
  }

  async function allocateCardId({ prefix, existingIds }) {
    if (typeof prefix !== "string" || !/^[a-z0-9][a-z0-9_-]{0,20}$/.test(prefix)) {
      throw new GuestApiError(400, "prefix must be a short lowercase card ID prefix.");
    }
    if (
      !Array.isArray(existingIds) ||
      existingIds.length > 512 ||
      existingIds.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
    ) {
      throw new GuestApiError(400, "existingIds must contain valid card identifiers.");
    }

    const allocatedCardId = await withRegistryMutation(async () => {
      const registry = await readCardIdRegistry();
      const existing = new Set([
        ...registry.reservedIds,
        ...registry.deletedIds,
        ...existingIds,
        ...await preparedCardIds(),
        ...await preparedWindowsCardIds(),
        ...[...guests.values()].map((guest) => guest.cardId),
      ]);
      registry.reservedIds = [...new Set([...registry.reservedIds, ...existingIds])];

      let candidate;
      do {
        if (!Number.isSafeInteger(registry.nextId) || registry.nextId >= Number.MAX_SAFE_INTEGER) {
          throw new GuestApiError(507, "The card ID allocator is exhausted.");
        }
        candidate = `${prefix}-${registry.nextId}`;
        registry.nextId += 1;
      } while (existing.has(candidate));

      registry.reservedIds.push(candidate);
      await writeCardIdRegistry(registry);
      return candidate;
    });

    const result = await status();
    result.allocatedCardId = allocatedCardId;
    return result;
  }
  const wslDistribution = process.env.POSTCARD_WSL_DISTRO ?? "Ubuntu";
  const wslPath = process.env.POSTCARD_WSL ?? "wsl.exe";
  const wslQemuPath = process.env.POSTCARD_WSL_QEMU ?? "qemu-system-x86_64";
  const wslQemuImgPath = process.env.POSTCARD_WSL_QEMU_IMG ?? "qemu-img";
  const wslSwtpmPath = process.env.POSTCARD_WSL_SWTPM ?? "swtpm";
  const wslFirmwarePath = process.env.POSTCARD_WSL_OVMF_CODE
    ?? "/usr/share/OVMF/OVMF_CODE_4M.ms.fd";
  const wslVarsTemplatePath = process.env.POSTCARD_WSL_OVMF_VARS
    ?? "/usr/share/OVMF/OVMF_VARS_4M.ms.fd";
  const qemuPath = findExecutable(
    "POSTCARD_QEMU",
    "qemu-system-x86_64",
    "qemu-system-x86_64.exe",
  );
  const qemuImgPath = findExecutable("POSTCARD_QEMU_IMG", "qemu-img", "qemu-img.exe");
  const runtimeStore = globalThis;
  const previousRuntime = runtimeStore[GUEST_RUNTIME_KEY];
  const guests = previousRuntime instanceof Map ? previousRuntime : new Map();
  let baseFinalizationInProgress = false;
  if (previousRuntime instanceof Map) {
    for (const [key, guest] of previousRuntime) {
      if (!key.includes(":") && guest.cardId) {
        guests.set(`${LINUX_OS}:${guest.cardId}`, { ...guest, os: LINUX_OS });
        guests.delete(key);
      }
    }
  }
  if (previousRuntime && !(previousRuntime instanceof Map) && previousRuntime.cardId) {
    guests.set(`${LINUX_OS}:${previousRuntime.cardId}`, {
      ...previousRuntime,
      os: LINUX_OS,
      ports: previousRuntime.child?.exitCode === null
        ? {
          slot: 0,
          websocketPort: DEFAULT_WEBSOCKET_PORT,
          qmpPort: DEFAULT_QMP_PORT,
          vncPort: DEFAULT_VNC_PORT,
        }
        : undefined,
    });
  }
  runtimeStore[GUEST_RUNTIME_KEY] = guests;

  function resolveDataChild(parent, entryName) {
    const dataRoot = path.resolve(dataDirectory);
    const resolvedParent = path.resolve(parent);
    const relativeParent = path.relative(dataRoot, resolvedParent);
    if (
      relativeParent === ".." ||
      relativeParent.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeParent)
    ) {
      throw new GuestApiError(409, "Card data path is outside the configured VM data directory.");
    }

    const candidate = path.resolve(resolvedParent, entryName);
    if (path.dirname(candidate) !== resolvedParent) {
      throw new GuestApiError(400, "Card data path must be a direct child of its storage directory.");
    }
    return { candidate, relativeParent, resolvedParent };
  }

  async function inspectOwnedPath(parent, entryName, expectedType = "any") {
    const { candidate, relativeParent, resolvedParent } = resolveDataChild(parent, entryName);
    let dataRoot;
    let actualParent;
    try {
      dataRoot = await realpath(dataDirectory);
      actualParent = await realpath(resolvedParent);
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw new GuestApiError(500, `Could not verify card data directory: ${error.message}`);
    }

    const expectedParent = path.resolve(dataRoot, relativeParent);
    if (path.relative(expectedParent, actualParent) !== "") {
      throw new GuestApiError(409, "Card data directory resolves outside its owned location.");
    }

    let details;
    try {
      details = await lstat(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw new GuestApiError(500, `Could not inspect card data: ${error.message}`);
    }
    if (details.isSymbolicLink()) {
      throw new GuestApiError(409, "Refusing to delete a symbolic link in card data.");
    }
    if (
      (expectedType === "file" && !details.isFile()) ||
      (expectedType === "directory" && !details.isDirectory())
    ) {
      throw new GuestApiError(409, "Card data path has an unexpected file type.");
    }
    return { path: candidate, details };
  }

  async function readDeleteMetadata(fileName, expectedShape) {
    const file = await inspectOwnedPath(dataDirectory, fileName, "file");
    if (!file) return { exists: false, value: expectedShape === "array" ? [] : {} };

    let value;
    try {
      value = JSON.parse(await readFile(file.path, "utf8"));
    } catch (error) {
      throw new GuestApiError(500, `Could not read ${fileName} before deleting card data: ${error.message}`);
    }
    const valid =
      expectedShape === "array"
        ? Array.isArray(value)
        : value !== null && typeof value === "object" && !Array.isArray(value);
    if (!valid) {
      throw new GuestApiError(500, `${fileName} has an invalid format; card data was not deleted.`);
    }
    return { exists: true, path: file.path, value };
  }

  async function isBaseReady() {
    let marker;
    try {
      marker = JSON.parse(await readFile(readyMarkerPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw new GuestApiError(500, `Could not read Debian base status: ${error.message}`);
    }
    if (marker.version !== 1 || path.resolve(marker.baseDiskPath) !== baseDiskPath) {
      throw new GuestApiError(409, "The Debian base marker does not match the configured base image.");
    }
    if (!existsSync(baseDiskPath)) {
      throw new GuestApiError(409, "The Debian golden image is missing. Remove its ready marker before reinstalling.");
    }
    return true;
  }

  async function preparedCardIds() {
    let entries;
    try {
      entries = await readdir(overlayDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new GuestApiError(500, `Could not list Linux card overlays: ${error.message}`);
    }

    return entries
      .filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9_-]{0,63}\.qcow2$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -".qcow2".length));
  }

  async function preparedWindowsCardIds() {
    let entries;
    try {
      entries = await readdir(windowsDiskDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new GuestApiError(500, `Could not list Windows card disks: ${error.message}`);
    }
    return entries
      .filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9_-]{0,63}\.qcow2$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -".qcow2".length));
  }

  async function installedWindowsCardIds() {
    let entries;
    try {
      entries = await readdir(windowsDiskDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new GuestApiError(500, `Could not list Windows card disks: ${error.message}`);
    }
    const ids = [];
    for (const entry of entries) {
      if (entry.isFile() && /^[a-z0-9][a-z0-9_-]{0,63}\.qcow2$/.test(entry.name)) {
        try {
          const s = await stat(path.join(windowsDiskDirectory, entry.name));
          if (s.size > 500 * 1024 * 1024) {
            ids.push(entry.name.slice(0, -".qcow2".length));
          }
        } catch { }
      }
    }
    return ids;
  }

  async function runWsl(executable, args, message) {
    if (process.platform === "linux") {
      try {
        return await execFileAsync(executable, args, {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        throw new GuestApiError(503, `${message}: ${error.message}`);
      }
    }
    if (!(await executableExists(wslPath))) {
      throw new GuestApiError(503, `${wslPath} was not found. Install WSL or set POSTCARD_WSL.`);
    }
    try {
      return await execFileAsync(wslPath, ["-d", wslDistribution, "--exec", executable, ...args], {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      throw new GuestApiError(503, `${message}: ${error.message}`);
    }
  }

  async function prepareWindowsFiles(cardId, bootMode, customIsoOverride) {
    const activeWinIso = customIsoOverride || windowsIsoPath;
    const isoWslPath = windowsPathToWsl(activeWinIso, wslDistribution);
    const diskPath = path.join(windowsDiskDirectory, `${cardId}.qcow2`);
    const varsPath = path.join(windowsFirmwareDirectory, `${cardId}-VARS.fd`);
    const tpmStatePath = path.join(windowsTpmDirectory, cardId);
    const linuxDiskPath = windowsPathToWsl(diskPath);
    const linuxVarsPath = windowsPathToWsl(varsPath);
    const linuxTpmStatePath = windowsPathToWsl(tpmStatePath);
    const linuxTpmSocketDir = `/tmp/postcard-tpm/${cardId}`;
    const linuxTpmSocketPath = `${linuxTpmSocketDir}/swtpm-sock`;
    const linuxFirmwarePath = wslFirmwarePath;
    const linuxVarsTemplatePath = wslVarsTemplatePath;
    let diskExists = false;
    try {
      diskExists = (await stat(diskPath)).isFile();
      if (!diskExists) throw new GuestApiError(500, `Windows guest disk path is not a file: ${diskPath}`);
    } catch (error) {
      if (error instanceof GuestApiError) throw error;
      if (error.code !== "ENOENT") throw error;
    }
    if (bootMode === "disk" && !diskExists && /^windows[-_]/.test(cardId)) {
      const primaryWinDisk = path.join(windowsDiskDirectory, "windows.qcow2");
      if (existsSync(primaryWinDisk)) {
        await mkdir(windowsDiskDirectory, { recursive: true });
        await copyFile(primaryWinDisk, diskPath, fsConstants.COPYFILE_EXCL);
        diskExists = true;
      }
    }
    if (bootMode === "disk" && !diskExists) {
      throw new GuestApiError(409, "Install Windows (from your own ISO) before booting this card from disk.");
    }
    try {
      if (!(await stat(activeWinIso)).isFile()) throw new Error("not a file");
    } catch {
      throw new GuestApiError(
        503,
        activeWinIso
          ? `Windows ISO was not found at ${activeWinIso}. Set POSTCARD_WINDOWS_ISO or attach a custom ISO path.`
          : "No Windows ISO configured. Windows is not bundled: provide your own licensed ISO via POSTCARD_WINDOWS_ISO or the card's Load custom OS ISO action.",
      );
    }
    await mkdir(windowsDiskDirectory, { recursive: true });
    await mkdir(windowsFirmwareDirectory, { recursive: true });
    await mkdir(windowsTpmDirectory, { recursive: true });
    const checkAndPrepare = [
      `test -r ${shellQuote(isoWslPath)}`,
      `test -r ${shellQuote(linuxFirmwarePath)}`,
      `test -r ${shellQuote(linuxVarsTemplatePath)}`,
      `command -v ${shellQuote(wslQemuPath)} >/dev/null`,
      `command -v ${shellQuote(wslQemuImgPath)} >/dev/null`,
      `command -v ${shellQuote(wslSwtpmPath)} >/dev/null`,
      `mkdir -p ${shellQuote(windowsPathToWsl(windowsDiskDirectory))}`,
      `mkdir -p ${shellQuote(windowsPathToWsl(windowsFirmwareDirectory))}`,
      `mkdir -p ${shellQuote(linuxTpmStatePath)}`,
      `mkdir -p ${shellQuote(linuxTpmSocketDir)}`,
      `rm -f ${shellQuote(linuxTpmSocketPath)}`,
      bootMode === "installer"
        ? `cp -f ${shellQuote(linuxVarsTemplatePath)} ${shellQuote(linuxVarsPath)}`
        : `if [ ! -e ${shellQuote(linuxVarsPath)} ]; then cp ${shellQuote(linuxVarsTemplatePath)} ${shellQuote(linuxVarsPath)}; fi`,
    ].join(" && ");
    try {
      await runWsl("bash", ["-lc", checkAndPrepare], "Windows guest prerequisites are unavailable in WSL");
    } catch (error) {
      if (error instanceof GuestApiError) {
        throw new GuestApiError(error.status, `${error.message}. Verify the Windows ISO and install TPM-enabled QEMU, swtpm, and OVMF in ${wslDistribution}.`);
      }
      throw error;
    }
    if (!diskExists) {
      await runWsl(
        wslQemuImgPath,
        ["create", "-f", "qcow2", linuxDiskPath, WINDOWS_DISK_SIZE],
        "Could not create the Windows guest disk",
      );
    }
    return {
      diskPath,
      isoPath: isoWslPath,
      firmwarePath: linuxFirmwarePath,
      varsPath: linuxVarsPath,
      tpmStatePath: linuxTpmStatePath,
      tpmSocketPath: linuxTpmSocketPath,
    };
  }

  function normalizeGuestState(guest) {
    if (guest.child?.exitCode !== null && guest.child?.exitCode !== undefined) {
      const isClean =
        guest.phase === "stopping" ||
        guest.child.exitCode === 0 ||
        guest.child.signalCode === "SIGTERM" ||
        guest.child.signalCode === "SIGINT";
      guest.phase = isClean ? "offline" : "error";
      if (guest.phase === "error" && !guest.error) {
        guest.error = `QEMU exited with code ${guest.child.exitCode}.`;
      } else if (isClean) {
        guest.error = undefined;
      }
      guest.child = undefined;
      guest.ports = undefined;
    }
  }

  function activeGuests() {
    for (const guest of guests.values()) normalizeGuestState(guest);
    return [...guests.values()].filter((guest) =>
      guest.phase === "starting" || guest.phase === "running" || guest.phase === "stopping",
    );
  }

  async function status() {
    const baseReady = await isBaseReady();
    return {
      baseReady,
      baseDiskExists: existsSync(baseDiskPath),
      baseDiskPath,
      deletedCardIds: (await readCardIdRegistry()).deletedIds,
      preparedCardIds: await preparedCardIds(),
      preparedWindowsCardIds: await preparedWindowsCardIds(),
      installedWindowsCardIds: await installedWindowsCardIds(),
      paperPlanes: await readPaperPlanes(),
      checkpoints: await readCheckpoints(),
      networkModes: await readNetworkModes(),
      memoryProfiles: await readMemoryProfiles(),
      cpuProfiles: await readCpuProfiles(),
      customIsos: await readCustomIsos(),
      cpuCapacity: availableParallelism(),
      maxConcurrentGuests: MAX_CONCURRENT_GUESTS,
      guests: [...guests.values()].map((guest) => {
        normalizeGuestState(guest);
        return {
          os: guest.os ?? LINUX_OS,
          cardId: guest.cardId,
          status: guest.phase,
          bootMode: guest.bootMode,
          error: guest.error,
          websocketPort: guest.ports?.websocketPort ?? null,
          qmpPort: guest.ports?.qmpPort ?? null,
          serialPort: guest.ports?.serialPort ?? null,
          serialOutput: guest.serialOutput ?? "",
          memoryMb: guest.memoryMb ?? resolveCardMemoryMb(guest.os ?? LINUX_OS, "eco"),
          vcpus: guest.vcpus ?? resolveCardVcpus("balanced"),
          diskPath: guest.os === WINDOWS_OS
            ? path.join(windowsDiskDirectory, `${guest.cardId}.qcow2`)
            : guest.bootMode === "installer"
              ? baseDiskPath
              : path.join(overlayDirectory, `${guest.cardId}.qcow2`),
        };
      }),
    };
  }

  async function finalizeBase() {
    if (baseFinalizationInProgress) {
      throw new GuestApiError(409, "Debian base finalization is already in progress.");
    }
    if (activeGuests().some((guest) => guest.os === LINUX_OS)) {
      throw new GuestApiError(409, "Shut down all Linux guests before finalizing the Debian base image.");
    }
    baseFinalizationInProgress = true;
    try {
      if (await isBaseReady()) {
        throw new GuestApiError(409, "The Debian base image is already finalized and locked.");
      }
      let info;
      try {
        info = await imageInfo(qemuImgPath, baseDiskPath);
      } catch (error) {
        if (error instanceof GuestApiError && error.status === 500) {
          throw new GuestApiError(409, "Run the Debian installer and complete installation before finalizing the base image.");
        }
        throw error;
      }
      if (
        info.format !== "qcow2" ||
        info["virtual-size"] !== EXPECTED_DISK_SIZE ||
        info["actual-size"] < 1024 * 1024
      ) {
        throw new GuestApiError(409, "The Debian base disk is empty or invalid. Complete the installer before finalizing it.");
      }

      await mkdir(dataDirectory, { recursive: true });
      const marker = {
        version: 1,
        baseDiskPath,
        finalizedAt: new Date().toISOString(),
      };
      const temporaryMarkerPath = `${readyMarkerPath}.${process.pid}.tmp`;
      await writeFile(temporaryMarkerPath, JSON.stringify(marker, null, 2), { flag: "wx" });
      await rename(temporaryMarkerPath, readyMarkerPath);
      return status();
    } finally {
      baseFinalizationInProgress = false;
    }
  }

  async function reservePorts(guest) {
    for (let slot = 0; slot < MAX_GUESTS; slot += 1) {
      const reserved = [...guests.values()].some((item) =>
        item !== guest &&
        item.ports?.slot === slot &&
        (item.phase === "starting" || item.phase === "running" || item.phase === "stopping"),
      );
      if (reserved) continue;
      const ports = {
        slot,
        websocketPort: DEFAULT_WEBSOCKET_PORT + slot,
        qmpPort: DEFAULT_QMP_PORT + slot,
        serialPort: DEFAULT_SERIAL_PORT + slot,
        vncPort: DEFAULT_VNC_PORT + slot,
      };
      guest.ports = ports;
      if (
        await tcpPortIsOpen(ports.websocketPort) ||
        await tcpPortIsOpen(ports.qmpPort) ||
        await tcpPortIsOpen(ports.vncPort)
      ) {
        guest.ports = undefined;
        continue;
      }
      return ports;
    }
    throw new GuestApiError(503, "No free local QEMU display and control ports are available.");
  }

  async function start(os, bootMode, cardId) {
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    if (bootMode !== "installer" && bootMode !== "disk") {
      throw new GuestApiError(400, "bootMode must be 'installer' or 'disk'.");
    }
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os === LINUX_OS && baseFinalizationInProgress) {
      throw new GuestApiError(409, "Wait for Debian base finalization to complete before starting a guest.");
    }
    const key = guestKey(os, cardId);
    const existing = guests.get(key);
    if (existing && (existing.phase === "starting" || existing.phase === "running" || existing.phase === "stopping")) {
      throw new GuestApiError(409, `This ${os} card is already starting or running.`);
    }
    const active = activeGuests();
    const memProfiles = await readMemoryProfiles();
    // Windows 11 Setup hard-requires 4 GB RAM and 2 CPUs; the eco profile (2 GB / 1 vCPU)
    // makes it fail with "This PC can't run Windows 11". Floor them for Windows.
    const memoryMb = os === WINDOWS_OS
      ? Math.max(4096, resolveCardMemoryMb(os, memProfiles[cardId] ?? "eco"))
      : resolveCardMemoryMb(os, memProfiles[cardId] ?? "eco");
    const cpuProfiles = await readCpuProfiles();
    const vcpus = os === WINDOWS_OS
      ? Math.max(Math.min(2, availableParallelism()), resolveCardVcpus(cpuProfiles[cardId] ?? "balanced"))
      : resolveCardVcpus(cpuProfiles[cardId] ?? "balanced");
    if (
      active.length >= MAX_CONCURRENT_GUESTS ||
      active.reduce((total, g) => total + (g.memoryMb ?? resolveCardMemoryMb(g.os, memProfiles[g.cardId] ?? "eco")), 0) +
      memoryMb > MAX_GUEST_MEMORY_MB
    ) {
      throw new GuestApiError(409, `Guest launch would exceed the ${MAX_CONCURRENT_GUESTS}-guest / ${MAX_GUEST_MEMORY_MB / 1024} GiB memory limit.`);
    }
    const customIsos = await readCustomIsos();
    const cardCustomIso = customIsos[cardId];
    if (
      !cardCustomIso &&
      (active.some((guest) => guest.os === LINUX_OS && guest.bootMode === "installer") ||
        (os === LINUX_OS && bootMode === "installer" && active.length > 0))
    ) {
      throw new GuestApiError(409, "Shut down all Linux guests before installing or changing the shared Debian base image.");
    }
    const guest = {
      child: undefined,
      tpmChild: undefined,
      phase: "starting",
      bootMode,
      os,
      cardId,
      error: undefined,
      stderr: "",
      memoryMb,
      vcpus,
      ports: undefined,
    };
    guests.set(key, guest);
    try {
      let diskPath;
      let args;
      if (os === WINDOWS_OS) {
        const files = await prepareWindowsFiles(cardId, bootMode, cardCustomIso);
        diskPath = files.diskPath;
        const ports = await reservePorts(guest);
        const tpmArgs = [
          "socket",
          "--tpm2",
          "--tpmstate", `dir=${files.tpmStatePath}`,
          "--ctrl", `type=unixio,path=${files.tpmSocketPath}`,
        ];
        const isLinux = process.platform === "linux";
        const tpmBin = isLinux ? wslSwtpmPath : wslPath;
        const tpmCmdArgs = isLinux ? tpmArgs : ["-d", wslDistribution, "--exec", wslSwtpmPath, ...tpmArgs];
        guest.tpmChild = spawn(tpmBin, tpmCmdArgs, {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        });
        guest.tpmChild.stderr.setEncoding("utf8");
        guest.tpmChild.stderr.on("data", (chunk) => {
          guest.stderr = `${guest.stderr}${chunk}`.slice(-4000);
        });
        guest.tpmChild.once("error", (error) => {
          guest.error = `Could not start the Windows software TPM: ${error.message}`;
        });
        await new Promise((resolve, reject) => {
          guest.tpmChild.once("spawn", resolve);
          guest.tpmChild.once("error", reject);
        });
        const tpmDeadline = Date.now() + 5000;
        let tpmReady = false;
        while (Date.now() < tpmDeadline) {
          if (guest.tpmChild.exitCode !== null) {
            throw new GuestApiError(500, `swtpm exited prematurely with code ${guest.tpmChild.exitCode}.`);
          }
          try {
            await runWsl("test", ["-S", files.tpmSocketPath], "Checking swtpm socket");
            tpmReady = true;
            break;
          } catch {
            await wait(100);
          }
        }
        if (!tpmReady) {
          throw new GuestApiError(504, "Could not start the Windows software TPM in WSL: socket did not initialize in time.");
        }
        args = windowsQemuArguments({
          bootMode,
          cardId,
          diskPath: windowsPathToWsl(diskPath),
          isoPath: files.isoPath,
          firmwarePath: files.firmwarePath,
          varsPath: files.varsPath,
          tpmSocketPath: files.tpmSocketPath,
          networkMode: (await readNetworkModes())[cardId] ?? "nat",
          memoryMb,
          vcpus,
          ports,
        });
        guest.ports = ports;
      } else if (cardCustomIso) {
        if (!(await executableExists(qemuPath))) {
          throw new GuestApiError(503, `QEMU was not found at ${qemuPath}. Set POSTCARD_QEMU to its path.`);
        }
        const isQcow2Image = /\.qcow2$/i.test(cardCustomIso);
        const isRawDiskImage = /\.(img|raw)$/i.test(cardCustomIso);
        if (bootMode === "installer" || isQcow2Image || isRawDiskImage) {
          try {
            if (!(await stat(cardCustomIso)).isFile()) throw new Error("not a file");
          } catch {
            throw new GuestApiError(503, `Custom ISO was not found at ${cardCustomIso}. Verify the path and try again.`);
          }
        }
        diskPath = path.join(overlayDirectory, `${cardId}.qcow2`);
        if (isQcow2Image) {
          const resolvedBase = path.resolve(cardCustomIso);
          try {
            await createOverlayIfNeeded(resolvedBase, diskPath, qemuImgPath);
          } catch {
            await rm(diskPath, { force: true }).catch(() => { });
            await createOverlayIfNeeded(resolvedBase, diskPath, qemuImgPath);
          }
        } else {
          await createEmptyDiskIfNeeded(diskPath, qemuImgPath);
        }
        const ports = await reservePorts(guest);
        const cardDropDir = path.join(paperPlanesDropDir, cardId);
        await mkdir(cardDropDir, { recursive: true });
        const networkMode = (await readNetworkModes())[cardId] ?? "nat";
        const effectiveBootMode = isQcow2Image || isRawDiskImage ? "disk" : bootMode;
        guest.bootMode = effectiveBootMode;
        const isMac = os === MACOS_OS || cardId === "macos";
        const openCoreMaster = path.join(dataDirectory, "master-images", "OpenCore.qcow2");
        const macOvmfCodeMaster = path.join(dataDirectory, "master-images", "OVMF_CODE_mac.fd");
        const macOvmfVarsMaster = path.join(dataDirectory, "master-images", "OVMF_VARS_mac.fd");
        let macOvmfVars = macOvmfVarsMaster;
        if (isMac && existsSync(macOvmfVarsMaster)) {
          const cardVars = path.join(overlayDirectory, `${cardId}-mac-VARS.fd`);
          if (!existsSync(cardVars)) {
            await copyFile(macOvmfVarsMaster, cardVars);
          }
          if (existsSync(cardVars)) {
            macOvmfVars = cardVars;
          }
        }
        args = qemuArguments({
          bootMode: effectiveBootMode,
          cardId,
          diskPath: isMac ? path.join(overlayDirectory, `${cardId}.qcow2`) : (isRawDiskImage ? cardCustomIso : diskPath),
          isoPath: cardCustomIso,
          ports,
          networkMode,
          dropDir: cardDropDir,
          memoryMb,
          vcpus,
          isMacOs: isMac,
          openCorePath: openCoreMaster,
          macOvmfCode: macOvmfCodeMaster,
          macOvmfVars,
        });
      } else {
        if (!(await executableExists(qemuPath))) {
          throw new GuestApiError(503, `QEMU was not found at ${qemuPath}. Set POSTCARD_QEMU to its path.`);
        }
        const baseReady = await isBaseReady();
        if (bootMode === "installer" && baseReady) {
          throw new GuestApiError(409, "The Debian base image is already finalized. Start this card to use its private overlay.");
        }
        if (bootMode === "disk" && !baseReady) {
          throw new GuestApiError(409, "Install Debian and finalize the golden base image before starting a card overlay.");
        }
        if (bootMode === "installer") {
          try {
            if (!(await stat(isoPath)).isFile()) throw new Error("not a file");
          } catch {
            throw new GuestApiError(503, `Debian installer ISO was not found at ${isoPath}. Set POSTCARD_DEBIAN_ISO to its path.`);
          }
          await createEmptyDiskIfNeeded(baseDiskPath, qemuImgPath);
        } else {
          await createOverlayIfNeeded(
            baseDiskPath,
            path.join(overlayDirectory, `${cardId}.qcow2`),
            qemuImgPath,
          );
        }
        diskPath = bootMode === "installer"
          ? baseDiskPath
          : path.join(overlayDirectory, `${cardId}.qcow2`);
        const ports = await reservePorts(guest);
        const cardDropDir = path.join(paperPlanesDropDir, cardId);
        await mkdir(cardDropDir, { recursive: true });
        const networkMode = (await readNetworkModes())[cardId] ?? "nat";
        const targetIso = os === ANDROID_OS && existsSync(androidIsoPath) ? androidIsoPath : isoPath;
        const isKernelGuest = cardId === "postcard-os" || os === "kernel";
        const kernelPath = isKernelGuest && existsSync(postcardKernelPath) ? postcardKernelPath : "";
        const initrdPath = isKernelGuest && existsSync(postcardRamdiskPath) ? postcardRamdiskPath : "";
        args = qemuArguments({ bootMode, cardId, diskPath, isoPath: targetIso, ports, networkMode, dropDir: cardDropDir, memoryMb, vcpus, kernelPath, initrdPath });
      }

      let child;
      // Remote KVM host is opt-in (POSTCARD_KVM_HOST=user@host); nothing is hardcoded.
      const useWorkstationMac = (os === MACOS_OS || cardId === "macos") && Boolean(kvmHost) && process.env.POSTCARD_MAC_LOCAL !== "true";
      if (useWorkstationMac) {
        try {
          execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", kvmHost,
            `podman rm -f macos-kvm 2>/dev/null; podman run --rm -d --name macos-kvm --device /dev/kvm -v ${kvmWorkDir}:/work:z -p 5702:5702 -p 4446:4446 localhost/postcard-kvm /work/run-macos.sh`,
          ], { stdio: "ignore" });
        } catch {
          // If container already running or ssh transient, continue to tunnel
        }
        child = spawn("ssh", [
          "-o", "BatchMode=yes",
          "-N",
          "-L", `${ports.websocketPort}:127.0.0.1:5702`,
          "-L", `${ports.qmpPort}:127.0.0.1:4446`,
          kvmHost,
        ], {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } else {
        const isLinux = process.platform === "linux";
        const qemuBin = isLinux || os !== WINDOWS_OS ? (os === WINDOWS_OS ? wslQemuPath : qemuPath) : wslPath;
        const qemuCmdArgs = isLinux || os !== WINDOWS_OS ? args : ["-d", wslDistribution, "--exec", wslQemuPath, ...args];
        child = spawn(qemuBin, qemuCmdArgs, {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        });
      }
      guest.child = child;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        guest.stderr = `${guest.stderr}${chunk}`.slice(-4000);
      });
      child.once("error", (error) => {
        guest.error = `Could not start QEMU: ${error.message}`;
        guest.phase = "error";
        guest.ports = undefined;
      });
      child.once("exit", (code, signal) => {
        if (guest.tpmChild && guest.tpmChild.exitCode === null) guest.tpmChild.kill();
        guest.tpmChild = undefined;
        if (guest.watchdog) clearInterval(guest.watchdog);
        guest.watchdog = undefined;
        const isClean =
          !guest.crashMessage &&
          (guest.phase === "stopping" ||
            code === 0 ||
            signal === "SIGTERM" ||
            signal === "SIGINT");
        guest.phase = isClean ? "offline" : "error";
        if (guest.crashMessage) {
          guest.error = guest.crashMessage;
          guest.crashMessage = undefined;
        } else if (guest.phase === "error") {
          const details = guest.stderr.trim().split(/\r?\n/).slice(-4).join(" ");
          guest.error = `QEMU exited ${code === null ? `from ${signal}` : `with code ${code}`}.${details ? ` ${details}` : ""}`;
        } else if (isClean) {
          guest.error = undefined;
        }
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await waitForQemu(child, guest.ports.websocketPort);
      guest.phase = "running";
      guest.crashMessage = undefined;
      if (os === WINDOWS_OS) startWindowsWatchdog(guest, cardId);
      if (os === WINDOWS_OS && bootMode === "installer" && guest.ports?.qmpPort) {
        // The ISO shows "Press any key to boot from CD or DVD" for only ~3.5s. On a cold
        // start (fresh NVRAM) its timing is unpredictable, but after a warm reset it
        // reliably appears ~8s in. So: warm-reset, tap space for 16s, then watch for the
        // firmware's "BdsDxe: failed ... Time out" screen; if the prompt was missed, retry.
        // Taps stop long before Windows Setup's UI exists, so they can't click anything.
        void (async () => {
          const shotPath = path.join(windowsDiskDirectory, `.boot-probe-${cardId}.ppm`);
          const alive = () => guest.phase === "running" && guest.ports?.qmpPort;
          const qmp = (commands) => requestQmpCommands(guest.ports.qmpPort, commands);
          const missedPrompt = async () => {
            await qmp([{ execute: "screendump", arguments: { filename: windowsPathToWsl(shotPath) } }]);
            const shot = await readFile(shotPath);
            const header = shot.toString("latin1", 0, 32).split("\n");
            const width = Number(header[1].split(" ")[0]);
            const offset = header[0].length + header[1].length + header[2].length + 3;
            const colours = new Set();
            for (let i = shot.length - 3; i > offset && colours.size <= 8; i -= 3 * 97) {
              colours.add((shot[i] << 16) | (shot[i + 1] << 8) | shot[i + 2]);
            }
            let failText = 0; // "BdsDxe: failed ..." lines sit in rows ~45-70
            for (let y = 45; y < 70; y += 2) {
              for (let x = 0; x < width; x += 4) {
                if (shot[offset + (y * width + x) * 3] > 100) failText += 1;
              }
            }
            return colours.size <= 4 && failText > 40;
          };
          try {
            await wait(2_000);
            for (let attempt = 0; attempt < 3 && alive(); attempt += 1) {
              await qmp([{ execute: "system_reset" }]);
              const tapUntil = Date.now() + 16_000;
              while (Date.now() < tapUntil && alive()) {
                await qmp([
                  { execute: "send-key", arguments: { keys: [{ type: "qcode", data: "spc" }], "hold-time": 150 } },
                ]).catch(() => { });
                await wait(400);
              }
              let missed = false;
              const watchUntil = Date.now() + 25_000;
              while (Date.now() < watchUntil && alive() && !missed) {
                await wait(2_000);
                missed = await missedPrompt().catch(() => false);
              }
              if (!missed) break; // prompt caught: Windows is loading
            }
          } catch { }
          await rm(shotPath, { force: true }).catch(() => { });
        })();
      }
      return status();
    } catch (error) {
      if (guest.child?.exitCode === null) guest.child.kill();
      if (guest.tpmChild?.exitCode === null) guest.tpmChild.kill();
      if (os === WINDOWS_OS && process.platform === "win32") {
        try {
          await runWsl("pkill", ["-f", `qemu-system-x86_64.*${cardId}`], "Stopping QEMU in WSL");
        } catch { }
        try {
          await runWsl("pkill", ["-f", `swtpm.*${cardId}`], "Stopping swtpm in WSL");
        } catch { }
      }
      guest.phase = "error";
      guest.ports = undefined;
      const message = error instanceof Error ? error.message : String(error);
      const details = guest.stderr.trim().split(/\r?\n/).slice(-4).join(" ");
      guest.error = details && !message.includes(details) ? `${message} ${details}` : message;
      throw error;
    }
  }

  // --- Windows crash watchdog + automatic disk checkpoints -------------------
  // Every 15s: ask QEMU for its run state. A KVM "internal-error" (or a guest panic)
  // is unrecoverable, so quit QEMU and report it instead of leaving a frozen screen.
  // Every 10 min: take a live, disk-only qcow2 internal snapshot (~0.3s, no visible
  // pause) and keep the newest AUTO_CHECKPOINT_KEEP. Restore with restoreCheckpoint().
  const AUTO_CHECKPOINT_PREFIX = "auto-";
  const AUTO_CHECKPOINT_KEEP = 3;
  const AUTO_CHECKPOINT_INTERVAL_MS = 10 * 60_000;
  const WINDOWS_DISK_DEVICE = "ide0-hd0";

  function checkpointName(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${AUTO_CHECKPOINT_PREFIX}${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function startWindowsWatchdog(guest, cardId) {
    if (guest.watchdog) clearInterval(guest.watchdog);
    guest.autoCheckpoints = [];
    let lastCheckpoint = Date.now();
    let busy = false;
    guest.watchdog = setInterval(async () => {
      if (busy || guest.phase !== "running" || !guest.ports?.qmpPort) return;
      busy = true;
      try {
        const port = guest.ports.qmpPort;
        const reply = await requestQmpRaw(port, { execute: "query-status" });
        const state = reply?.return?.status;
        if (state === "internal-error" || state === "guest-panicked" || state === "io-error") {
          const last = guest.autoCheckpoints.at(-1);
          guest.crashMessage =
            `The Windows VM crashed (${state}). Your disk is safe` +
            (last ? `; the newest automatic checkpoint is ${last}. Use "Restore last checkpoint" to roll back to it.` : ".");
          await requestQmpCommands(port, [{ execute: "quit" }]).catch(() => { });
          return;
        }
        if (state === "running" && Date.now() - lastCheckpoint >= AUTO_CHECKPOINT_INTERVAL_MS) {
          lastCheckpoint = Date.now();
          const name = checkpointName();
          await requestQmpCommands(port, [
            { execute: "blockdev-snapshot-internal-sync", arguments: { device: WINDOWS_DISK_DEVICE, name } },
          ]);
          guest.autoCheckpoints.push(name);
          while (guest.autoCheckpoints.length > AUTO_CHECKPOINT_KEEP) {
            const old = guest.autoCheckpoints.shift();
            await requestQmpCommands(port, [
              { execute: "blockdev-snapshot-delete-internal-sync", arguments: { device: WINDOWS_DISK_DEVICE, name: old } },
            ]).catch(() => { });
          }
        }
      } catch {
        // QEMU busy or exiting; try again next tick.
      } finally {
        busy = false;
      }
    }, 15_000);
  }

  async function listWindowsCheckpoints(cardId) {
    const diskPath = windowsPathToWsl(path.join(windowsDiskDirectory, `${cardId}.qcow2`));
    const { stdout } = await runWsl(wslQemuImgPath, ["snapshot", "-U", "-l", diskPath], "Could not list disk checkpoints");
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 2 && /^\d+$/.test(cols[0]))
      .map((cols) => cols[1]);
  }

  async function restoreCheckpoint(cardId, name) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    const guest = guests.get(guestKey(WINDOWS_OS, cardId));
    if (guest) normalizeGuestState(guest);
    if (guest && (guest.phase === "starting" || guest.phase === "running" || guest.phase === "stopping")) {
      throw new GuestApiError(409, "Stop this Windows card before restoring a checkpoint.");
    }
    const names = await listWindowsCheckpoints(cardId);
    const target = typeof name === "string" && name ? name : names.filter((n) => n.startsWith(AUTO_CHECKPOINT_PREFIX)).at(-1) ?? names.at(-1);
    if (!target || !names.includes(target)) {
      throw new GuestApiError(404, "This Windows card has no disk checkpoints yet.");
    }
    const diskPath = windowsPathToWsl(path.join(windowsDiskDirectory, `${cardId}.qcow2`));
    await runWsl(wslQemuImgPath, ["snapshot", "-a", target, diskPath], "Could not restore the disk checkpoint");
    if (guest) guest.error = undefined;
    const result = await status();
    return { ...result, restoredCheckpoint: target, availableCheckpoints: names };
  }

  async function stop(cardId, os = LINUX_OS, force = false) {
    const guest = guests.get(guestKey(os, cardId));
    if (!guest || !guest.child || guest.child.exitCode !== null) {
      if (guest) {
        guest.phase = "offline";
        guest.error = undefined;
        guest.ports = undefined;
        guest.child = undefined;
      }
      return status();
    }
    const child = guest.child;
    guest.phase = "stopping";
    if ((os === MACOS_OS || cardId === "macos") && kvmHost) {
      try {
        execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=2", kvmHost, "podman stop -t 2 macos-kvm 2>/dev/null"], { stdio: "ignore" });
      } catch {}
    }
    try {
      await requestQmpCommand(guest.ports.qmpPort, force ? "quit" : "system_powerdown");
      await waitForExit(child, force ? 5_000 : 20_000, os === WINDOWS_OS ? "Windows" : "Linux");
    } catch (error) {
      guest.phase = child.exitCode === null ? "running" : "offline";
      throw error;
    }
    guest.child = undefined;
    if (guest.tpmChild?.exitCode === null) guest.tpmChild.kill();
    guest.tpmChild = undefined;
    guest.phase = "offline";
    guest.ports = undefined;
    guest.error = undefined;
    return status();
  }

  async function deleteCard(body) {
    return withRegistryMutation(() => deleteCardInternal(body));
  }

  async function deleteCardInternal({ cardId, os = LINUX_OS, confirm }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (![LINUX_OS, WINDOWS_OS, ANDROID_OS, MACOS_OS].includes(os)) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    if (confirm !== true) {
      throw new GuestApiError(400, "Explicit final confirmation is required to delete a card.");
    }

    const key = guestKey(os, cardId);
    const targetGuest = guests.get(key);
    if (targetGuest) normalizeGuestState(targetGuest);
    if (
      targetGuest?.phase === "starting" ||
      targetGuest?.phase === "stopping"
    ) {
      throw new GuestApiError(409, "Wait for this guest to finish starting or stopping before deleting it.");
    }

    const cardFiles = os === WINDOWS_OS
      ? [
        { parent: windowsDiskDirectory, name: `${cardId}.qcow2`, type: "file", disk: true },
        { parent: windowsFirmwareDirectory, name: `${cardId}-VARS.fd`, type: "file" },
        { parent: windowsTpmDirectory, name: cardId, type: "directory" },
      ]
      : [
        { parent: overlayDirectory, name: `${cardId}.qcow2`, type: "file", disk: true },
        { parent: overlayDirectory, name: `${cardId}.qcow2.checkpoint`, type: "file" },
      ];
    cardFiles.push({
      parent: paperPlanesDropDir,
      name: cardId,
      type: "directory",
    });

    const filesToRemove = [];
    for (const entry of cardFiles) {
      const ownedPath = await inspectOwnedPath(entry.parent, entry.name, entry.type);
      if (!ownedPath) continue;

      if (entry.disk) {
        if (path.resolve(ownedPath.path) === path.resolve(baseDiskPath)) {
          throw new GuestApiError(409, "Refusing to delete the shared Debian golden image.");
        }
        try {
          const baseDetails = await stat(baseDiskPath);
          if (ownedPath.details.dev === baseDetails.dev && ownedPath.details.ino === baseDetails.ino) {
            throw new GuestApiError(409, "Refusing to delete a card disk that is the shared Debian golden image.");
          }
        } catch (error) {
          if (error instanceof GuestApiError) throw error;
          if (error.code !== "ENOENT") {
            throw new GuestApiError(500, `Could not verify the shared Debian image before deletion: ${error.message}`);
          }
        }
      }
      filesToRemove.push({ ...entry, path: ownedPath.path });
    }

    const metadataUpdates = [];
    for (const fileName of [
      "checkpoints.json",
      "network-modes.json",
      "memory-profiles.json",
      "cpu-profiles.json",
      "custom-isos.json",
    ]) {
      const metadata = await readDeleteMetadata(fileName, "object");
      if (metadata.exists && Object.prototype.hasOwnProperty.call(metadata.value, cardId)) {
        delete metadata.value[cardId];
        metadataUpdates.push({ path: metadata.path, value: metadata.value });
      }
    }

    const planes = await readDeleteMetadata("paper-planes.json", "array");
    if (planes.exists) {
      for (const plane of planes.value) {
        if (
          !plane ||
          typeof plane !== "object" ||
          typeof plane.fromCardId !== "string" ||
          typeof plane.toCardId !== "string"
        ) {
          throw new GuestApiError(500, "paper-planes.json has an invalid record; card data was not deleted.");
        }
      }
      const retainedPlanes = planes.value.filter(
        (plane) => plane.fromCardId !== cardId && plane.toCardId !== cardId,
      );
      if (retainedPlanes.length !== planes.value.length) {
        metadataUpdates.push({ path: planes.path, value: retainedPlanes });
      }
    }

    const isRunning = typeof options.isGuestRunning === "function"
      ? await options.isGuestRunning(cardId, os)
      : targetGuest?.phase === "running";
    if (isRunning) {
      const forceStop = typeof options.forceStopGuest === "function"
        ? options.forceStopGuest
        : (selectedCardId, selectedOs) => stop(selectedCardId, selectedOs, true);
      await forceStop(cardId, os);
      const afterStop = guests.get(key);
      if (afterStop) {
        normalizeGuestState(afterStop);
        if (afterStop.phase === "starting" || afterStop.phase === "running" || afterStop.phase === "stopping") {
          throw new GuestApiError(409, "The selected guest is still running; its files were kept.");
        }
      }
    }

    for (const entry of filesToRemove) {
      const currentPath = await inspectOwnedPath(entry.parent, entry.name, entry.type);
      if (!currentPath || currentPath.path !== entry.path) {
        throw new GuestApiError(409, "Card data changed during deletion; no success was reported.");
      }
      await rm(currentPath.path, { recursive: entry.type === "directory", force: false });
    }

    for (const update of metadataUpdates) {
      const currentPath = await inspectOwnedPath(dataDirectory, path.basename(update.path), "file");
      if (!currentPath || currentPath.path !== update.path) {
        throw new GuestApiError(409, "Card metadata changed during deletion; no success was reported.");
      }
      await writeFile(currentPath.path, JSON.stringify(update.value, null, 2), "utf8");
    }

    guests.delete(key);
    const registry = await readCardIdRegistry();
    registry.reservedIds = [...new Set([...registry.reservedIds, cardId])];
    registry.deletedIds = [...new Set([...registry.deletedIds, cardId])].sort();
    const result = await status();
    result.deletedCardIds = registry.deletedIds;
    await writeCardIdRegistry(registry);
    return result;
  }

  async function resetOverlay(cardId, os = LINUX_OS) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    const existing = guests.get(guestKey(os, cardId));
    if (existing) normalizeGuestState(existing);
    if (
      existing &&
      (existing.phase === "starting" || existing.phase === "running" || existing.phase === "stopping")
    ) {
      throw new GuestApiError(409, "Shut down this card before resetting its disk overlay.");
    }
    if (os === WINDOWS_OS) {
      await rm(path.join(windowsDiskDirectory, `${cardId}.qcow2`), { force: true });
      await rm(path.join(windowsFirmwareDirectory, `${cardId}-VARS.fd`), { force: true });
      await rm(path.join(windowsTpmDirectory, cardId), { recursive: true, force: true });
    } else {
      await rm(path.join(overlayDirectory, `${cardId}.qcow2`), { force: true });
    }
    if (existing) {
      existing.error = undefined;
      existing.phase = "offline";
    }
    return status();
  }

  async function cloneOverlay(sourceCardId, targetCardId, os = LINUX_OS) {
    if (typeof sourceCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceCardId)) {
      throw new GuestApiError(400, "sourceCardId must be a lowercase card identifier.");
    }
    if (typeof targetCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(targetCardId)) {
      throw new GuestApiError(400, "targetCardId must be a lowercase card identifier.");
    }
    if (sourceCardId === targetCardId) {
      throw new GuestApiError(400, "sourceCardId and targetCardId must be different.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    for (const id of [sourceCardId, targetCardId]) {
      const g = guests.get(guestKey(os, id));
      if (g) normalizeGuestState(g);
      if (g && (g.phase === "starting" || g.phase === "running" || g.phase === "stopping")) {
        throw new GuestApiError(409, "Shut down the card before cloning its disk.");
      }
    }
    if (os === WINDOWS_OS) {
      const srcDisk = path.join(windowsDiskDirectory, `${sourceCardId}.qcow2`);
      const dstDisk = path.join(windowsDiskDirectory, `${targetCardId}.qcow2`);
      if (existsSync(dstDisk)) {
        throw new GuestApiError(409, "Target Windows card already has a disk.");
      }
      if (existsSync(srcDisk)) {
        await mkdir(windowsDiskDirectory, { recursive: true });
        await copyFile(srcDisk, dstDisk, fsConstants.COPYFILE_EXCL);
      }
    } else {
      const srcOverlay = path.join(overlayDirectory, `${sourceCardId}.qcow2`);
      const dstOverlay = path.join(overlayDirectory, `${targetCardId}.qcow2`);
      if (existsSync(dstOverlay)) {
        throw new GuestApiError(409, "Target Linux card already has a disk overlay.");
      }
      if (existsSync(srcOverlay)) {
        await mkdir(overlayDirectory, { recursive: true });
        await copyFile(srcOverlay, dstOverlay, fsConstants.COPYFILE_EXCL);
      } else if (await isBaseReady()) {
        await createOverlayIfNeeded(baseDiskPath, dstOverlay, qemuImgPath);
      }
    }
    return status();
  }

  async function readPaperPlanes() {
    try {
      const raw = await readFile(paperPlanesPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      return [];
    }
  }

  async function writePaperPlanes(planes) {
    await mkdir(dataDirectory, { recursive: true });
    const trimmed = planes.slice(-64);
    await writeFile(paperPlanesPath, JSON.stringify(trimmed, null, 2), "utf8");
  }

  async function deliverToRemoteComputer(remoteTarget, payload) {
    const raw = typeof remoteTarget === "string" ? remoteTarget.trim() : "";
    if (!raw) return { delivered: false, info: "" };
    if (raw.length > 256) {
      throw new GuestApiError(400, "remoteTarget must be at most 256 characters.");
    }

    if (raw.startsWith("tcp://")) {
      const parsed = new URL(raw);
      const host = parsed.hostname;
      const port = Number(parsed.port);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new GuestApiError(400, "tcp:// remoteTarget must include a valid host and port.");
      }
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host, port });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new GuestApiError(502, `Timed out connecting to live TCP computer ${host}:${port}.`));
        }, 3500);
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(new GuestApiError(502, `Could not reach live TCP computer ${host}:${port}: ${err.message}`));
        });
        socket.once("connect", () => {
          socket.end(`${payload.message}\n`, () => {
            clearTimeout(timer);
            resolve();
          });
        });
      });
      return { delivered: true, info: `tcp://${host}:${port}` };
    }

    const withScheme =
      raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`;
    let parsedUrl;
    try {
      parsedUrl = new URL(withScheme);
    } catch {
      throw new GuestApiError(
        400,
        "remoteTarget must be a valid HTTP(S) URL, host:port, or tcp://host:port.",
      );
    }
    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
      parsedUrl.pathname = "/api/guest/paper-plane/inbox";
    }
    let response;
    try {
      response = await fetch(parsedUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3500),
      });
    } catch (error) {
      throw new GuestApiError(
        502,
        `Could not reach live computer at ${parsedUrl.origin}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new GuestApiError(
        502,
        `Live computer at ${parsedUrl.origin} returned HTTP ${response.status}.`,
      );
    }
    return { delivered: true, info: parsedUrl.origin };
  }

  async function sendPaperPlane({
    fromCardId,
    toCardId,
    os = LINUX_OS,
    message,
    remoteTarget = "",
    injectToVm = true,
  }) {
    if (typeof fromCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(fromCardId)) {
      throw new GuestApiError(400, "fromCardId must be a lowercase card identifier.");
    }
    if (typeof toCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(toCardId)) {
      throw new GuestApiError(400, "toCardId must be a lowercase card identifier.");
    }
    if (fromCardId === toCardId && !remoteTarget) {
      throw new GuestApiError(400, "fromCardId and toCardId must be different.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS && os !== "remote") {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', 'macos', or 'remote'.");
    }
    if (typeof message !== "string" || message.trim().length === 0 || message.length > 160) {
      throw new GuestApiError(400, "message must be a non-empty string up to 160 characters.");
    }
    const cleanMessage = message.trim();
    const cleanRemoteTarget = typeof remoteTarget === "string" ? remoteTarget.trim() : "";

    let deliveredToRemote = false;
    let remoteDeliveryInfo = "";
    if (cleanRemoteTarget) {
      const remoteResult = await deliverToRemoteComputer(cleanRemoteTarget, {
        fromCardId,
        toCardId: toCardId === "remote-peer" ? "linux" : toCardId,
        os: os === "remote" ? LINUX_OS : os,
        message: cleanMessage,
        sentAt: new Date().toISOString(),
        source: "post-card-os",
      });
      deliveredToRemote = remoteResult.delivered;
      remoteDeliveryInfo = remoteResult.info;
    }

    let deliveredToVm = false;
    if (injectToVm && (os === LINUX_OS || os === WINDOWS_OS || os === ANDROID_OS || os === MACOS_OS)) {
      const targetGuest = guests.get(guestKey(os, toCardId));
      if (targetGuest) normalizeGuestState(targetGuest);
      if (targetGuest && targetGuest.phase === "running" && targetGuest.ports?.qmpPort) {
        const commands = textToQmpSendKeyCommands(cleanMessage);
        if (commands.length > 0) {
          await requestQmpCommands(targetGuest.ports.qmpPort, commands);
          deliveredToVm = true;
        }
      }
    }

    const planes = await readPaperPlanes();
    const prevHash = planes.length > 0 ? (planes[planes.length - 1].chainHash ?? "GENESIS") : "GENESIS";
    const createdAt = new Date().toISOString();
    const chainHash = createHash("sha256")
      .update(`${prevHash}|${fromCardId}|${toCardId}|${cleanMessage}|${createdAt}`)
      .digest("hex")
      .slice(0, 16);
    const record = {
      id: `plane-${Date.now()}-${planes.length + 1}`,
      fromCardId,
      toCardId,
      os,
      message: cleanMessage,
      createdAt,
      deliveredToVm,
      chainHash,
      remoteTarget: cleanRemoteTarget || undefined,
      deliveredToRemote: deliveredToRemote || undefined,
      remoteDeliveryInfo: remoteDeliveryInfo || undefined,
    };
    planes.push(record);
    await writePaperPlanes(planes);

    const cardDropDir = path.join(paperPlanesDropDir, toCardId);
    await mkdir(cardDropDir, { recursive: true });
    await writeFile(path.join(cardDropDir, "latest.txt"), `${cleanMessage}\n`, "utf8");
    await writeFile(
      path.join(cardDropDir, `plane-${Date.now()}.txt`),
      `From: ${fromCardId}\nSent: ${record.createdAt}\n\n${cleanMessage}\n`,
      "utf8",
    );

    return status();
  }

  async function injectPaperPlane({ cardId, os = LINUX_OS, message }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    const targetGuest = guests.get(guestKey(os, cardId));
    if (targetGuest) normalizeGuestState(targetGuest);
    if (!targetGuest || targetGuest.phase !== "running" || !targetGuest.ports?.qmpPort) {
      throw new GuestApiError(
        409,
        "Start this guest before injecting a paper plane into its live session.",
      );
    }

    const planes = await readPaperPlanes();
    let textToInject = typeof message === "string" ? message.trim() : "";
    let matchedPlane = undefined;
    if (!textToInject) {
      for (let i = planes.length - 1; i >= 0; i -= 1) {
        if (planes[i].toCardId === cardId) {
          matchedPlane = planes[i];
          textToInject = planes[i].message;
          break;
        }
      }
    }
    if (!textToInject) {
      throw new GuestApiError(404, "No paper plane is waiting for this card.");
    }

    const commands = textToQmpSendKeyCommands(textToInject);
    if (commands.length === 0) {
      throw new GuestApiError(400, "Paper plane contains no typable ASCII characters.");
    }
    await requestQmpCommands(targetGuest.ports.qmpPort, commands);
    if (matchedPlane) {
      matchedPlane.deliveredToVm = true;
      await writePaperPlanes(planes);
    }
    return status();
  }

  async function wakeGuestScreen({ cardId, os = LINUX_OS }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    const targetGuest = guests.get(guestKey(os, cardId));
    if (targetGuest) normalizeGuestState(targetGuest);
    if (targetGuest?.phase !== "running" || !targetGuest.ports?.qmpPort) {
      throw new GuestApiError(409, "Start this guest before waking its screen.");
    }

    await requestQmpCommands(targetGuest.ports.qmpPort, [
      {
        execute: "send-key",
        arguments: {
          keys: [{ type: "qcode", data: "shift" }],
          "hold-time": 20,
        },
      },
    ]);
    return status();
  }

  async function readCheckpoints() {
    try {
      const raw = await readFile(checkpointsPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeCheckpoints(checkpoints) {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(checkpointsPath, JSON.stringify(checkpoints, null, 2), "utf8");
  }

  async function snapshotCard({ action = "save", cardId, os = LINUX_OS, tag = "time-travel" }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    if (action !== "save" && action !== "rewind") {
      throw new GuestApiError(400, "action must be 'save' or 'rewind'.");
    }
    const cleanTag =
      typeof tag === "string" && /^[a-z0-9_-]{1,32}$/i.test(tag) ? tag : "time-travel";

    const targetGuest = guests.get(guestKey(os, cardId));
    if (targetGuest) normalizeGuestState(targetGuest);

    const diskPath =
      os === WINDOWS_OS
        ? path.join(windowsDiskDirectory, `${cardId}.qcow2`)
        : path.join(overlayDirectory, `${cardId}.qcow2`);
    const checkpointDiskPath = `${diskPath}.checkpoint`;

    if (targetGuest && targetGuest.phase === "running" && targetGuest.ports?.qmpPort) {
      const hmpCmd = action === "save" ? `savevm ${cleanTag}` : `loadvm ${cleanTag}`;
      await requestQmpCommands(targetGuest.ports.qmpPort, [
        {
          execute: "human-monitor-command",
          arguments: { "command-line": hmpCmd },
        },
      ]);
    } else if (action === "save") {
      if (existsSync(diskPath)) {
        await copyFile(diskPath, checkpointDiskPath);
      }
    } else if (action === "rewind") {
      const checkpoints = await readCheckpoints();
      if (!checkpoints[cardId] && !existsSync(checkpointDiskPath)) {
        throw new GuestApiError(404, "No Time-Travel savepoint exists for this card yet.");
      }
      if (existsSync(checkpointDiskPath)) {
        await copyFile(checkpointDiskPath, diskPath);
      }
    }

    const checkpoints = await readCheckpoints();
    if (action === "save") {
      checkpoints[cardId] = {
        tag: cleanTag,
        os,
        savedAt: new Date().toISOString(),
        mode: targetGuest?.phase === "running" ? "live-qmp-ram" : "disk-overlay",
      };
    } else if (checkpoints[cardId]) {
      checkpoints[cardId].rewoundAt = new Date().toISOString();
    }
    await writeCheckpoints(checkpoints);
    return status();
  }

  function synthesizeSecOpsOrAiCommand(prompt, os = LINUX_OS) {
    const clean = typeof prompt === "string" ? prompt.trim() : "";
    const lower = clean.toLowerCase();
    const isWin = os === WINDOWS_OS;

    const playbooks = [
      {
        match: (q) =>
          q === "recon-ports" ||
          (q.includes("port") && (q.includes("scan") || q.includes("recon") || q.includes("open") || q.includes("audit") || q.includes("listen"))),
        category: "SECOPS · NETWORK RECON",
        linuxCmd: "ss -tulpn || netstat -tulpn",
        winCmd: "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess",
        rationale: "Enumerates all listening TCP/UDP sockets and owning processes.",
      },
      {
        match: (q) =>
          q === "priv-audit" ||
          q.includes("suid") ||
          q.includes("privilege") ||
          q.includes("privesc") ||
          q.includes("sudo") ||
          q.includes("whoami"),
        category: "SECOPS · PRIVILEGE AUDIT",
        linuxCmd: "id && sudo -n -l 2>/dev/null; find / -perm -4000 -type f 2>/dev/null | head -n 20",
        winCmd: "whoami /all",
        rationale: "Audits current user identity, sudoers posture, and SUID/privilege escalation vectors.",
      },
      {
        match: (q) =>
          q === "active-conns" ||
          q.includes("connection") ||
          q.includes("outbound") ||
          q.includes("c2") ||
          q.includes("socket") ||
          q.includes("traffic"),
        category: "SECOPS · LIVE C2 & SOCKETS",
        linuxCmd: "ss -tupn state established",
        winCmd: "Get-NetTCPConnection -State Established | Select-Object LocalPort,RemoteAddress,RemotePort,OwningProcess",
        rationale: "Inspects established outbound connections for active C2 or unauthorized telemetry.",
      },
      {
        match: (q) =>
          q === "harden-fw" ||
          q.includes("firewall") ||
          q.includes("harden") ||
          q.includes("ufw") ||
          q.includes("iptables") ||
          q.includes("ssh"),
        category: "SECOPS · ZERO-TRUST HARDENING",
        linuxCmd: "ufw status verbose 2>/dev/null || iptables -L -n -v; grep -E '^(PermitRootLogin|PasswordAuthentication)' /etc/ssh/sshd_config 2>/dev/null",
        winCmd: "Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction",
        rationale: "Verifies host firewall rules and SSH authentication hardening posture.",
      },
      {
        match: (q) =>
          q === "sys-forensics" ||
          q.includes("forensic") ||
          q.includes("process") ||
          q.includes("cron") ||
          q.includes("persistence") ||
          q.includes("malware"),
        category: "SECOPS · LIVE FORENSICS",
        linuxCmd: "ps aux --sort=-%cpu | head -n 12 && crontab -l 2>/dev/null",
        winCmd: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 Name,Id,CPU,Path",
        rationale: "Captures top CPU processes and scheduled persistence hooks.",
      },
      {
        match: (q) => q.includes("disk") || q.includes("storage") || q.includes("space"),
        category: "AI OPS · STORAGE",
        linuxCmd: "df -h && lsblk",
        winCmd: "Get-PSDrive -PSProvider FileSystem",
        rationale: "Checks mounted filesystems and block device utilization.",
      },
      {
        match: (q) => q.includes("ip") || q.includes("network") || q.includes("interface") || q.includes("route"),
        category: "AI OPS · NETWORKING",
        linuxCmd: "ip -br addr && ip route",
        winCmd: "ipconfig /all",
        rationale: "Displays network interfaces, IP assignments, and routing table.",
      },
    ];

    for (const item of playbooks) {
      if (item.match(lower)) {
        return {
          command: isWin ? item.winCmd : item.linuxCmd,
          rationale: item.rationale,
          category: item.category,
        };
      }
    }

    return {
      command: clean,
      rationale: `Direct ${isWin ? "PowerShell" : "shell"} payload synthesized for ${os.toUpperCase()} guest.`,
      category: "AI COPILOT · DIRECT EXEC",
    };
  }

  async function aiCommand({
    prompt,
    targetCardId = "linux",
    os = LINUX_OS,
    remoteTarget = "",
    autoDispatch = true,
  }) {
    if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 160) {
      throw new GuestApiError(400, "prompt must be a non-empty string up to 160 characters.");
    }
    if (typeof targetCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(targetCardId)) {
      throw new GuestApiError(400, "targetCardId must be a lowercase card identifier.");
    }
    const normalizedOs =
      os === WINDOWS_OS || os === "android" || os === "remote" ? os : LINUX_OS;

    const synthesized = synthesizeSecOpsOrAiCommand(prompt, normalizedOs);
    const SafeCommand = synthesized.command.slice(0, 160);

    if (autoDispatch) {
      await sendPaperPlane({
        fromCardId: "ai-copilot",
        toCardId: targetCardId,
        os: normalizedOs,
        message: SafeCommand,
        remoteTarget,
        injectToVm: true,
      });
    }

    const currentStatus = await status();
    return {
      ...currentStatus,
      aiResult: {
        prompt: prompt.trim(),
        command: SafeCommand,
        rationale: synthesized.rationale,
        category: synthesized.category,
        targetCardId,
        os: normalizedOs,
      },
    };
  }

  async function readNetworkModes() {
    try {
      const raw = await readFile(networkModesPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeNetworkModes(modes) {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(networkModesPath, JSON.stringify(modes, null, 2), "utf8");
  }

  async function setNetworkMode({ cardId, networkMode = "nat" }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (networkMode !== "nat" && networkMode !== "cyber-range" && networkMode !== "airgap") {
      throw new GuestApiError(400, "networkMode must be 'nat', 'cyber-range', or 'airgap'.");
    }
    const modes = await readNetworkModes();
    modes[cardId] = networkMode;
    await writeNetworkModes(modes);
    return status();
  }

  async function readMemoryProfiles() {
    try {
      const raw = await readFile(memoryProfilesPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeMemoryProfiles(profiles) {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(memoryProfilesPath, JSON.stringify(profiles, null, 2), "utf8");
  }

  async function setMemoryProfile({ cardId, memoryProfile = "eco" }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (memoryProfile !== "eco" && memoryProfile !== "balanced" && memoryProfile !== "performance") {
      throw new GuestApiError(400, "memoryProfile must be 'eco', 'balanced', or 'performance'.");
    }
    const profiles = await readMemoryProfiles();
    profiles[cardId] = memoryProfile;
    await writeMemoryProfiles(profiles);
    return status();
  }

  async function readCpuProfiles() {
    try {
      const raw = await readFile(cpuProfilesPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function setCpuProfile({ cardId, cpuProfile = "balanced" }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (cpuProfile !== "eco" && cpuProfile !== "balanced" && cpuProfile !== "gaming") {
      throw new GuestApiError(400, "cpuProfile must be 'eco', 'balanced', or 'gaming'.");
    }
    const profiles = await readCpuProfiles();
    profiles[cardId] = cpuProfile;
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(cpuProfilesPath, JSON.stringify(profiles, null, 2), "utf8");
    return status();
  }

  async function readCustomIsos() {
    try {
      const raw = await readFile(customIsosPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function setCustomIso({ cardId, isoPath: nextIsoPath = "" }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (typeof nextIsoPath !== "string" || nextIsoPath.length > 480) {
      throw new GuestApiError(400, "isoPath must be a string up to 480 characters.");
    }
    const trimmed = nextIsoPath.trim().replace(/^["']|["']$/g, "");
    if (trimmed && !/\.(iso|img|qcow2|raw|dmg)$/i.test(trimmed)) {
      throw new GuestApiError(400, "Custom OS image path must end in .iso, .img, .qcow2, .raw, or .dmg.");
    }
    const isos = await readCustomIsos();
    if (!trimmed) {
      delete isos[cardId];
    } else {
      isos[cardId] = trimmed;
    }
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(customIsosPath, JSON.stringify(isos, null, 2), "utf8");
    return status();
  }

  async function swarmFork({
    sourceCardId = "linux",
    os = LINUX_OS,
    count = 3,
    targetCardIds = [],
    prompt = "",
  }) {
    if (typeof sourceCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceCardId)) {
      throw new GuestApiError(400, "sourceCardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    const forkCount = Math.min(Math.max(Number(count) || 2, 1), 4);
    const createdCardIds = [];
    for (let i = 0; i < forkCount; i += 1) {
      const candidateId =
        Array.isArray(targetCardIds) &&
          typeof targetCardIds[i] === "string" &&
          /^[a-z0-9][a-z0-9_-]{0,63}$/.test(targetCardIds[i])
          ? targetCardIds[i]
          : `${sourceCardId}-swarm-${Date.now().toString(36)}-${i + 1}`;
      await cloneOverlay(sourceCardId, candidateId, os);
      createdCardIds.push(candidateId);
      if (typeof prompt === "string" && prompt.trim().length > 0) {
        await aiCommand({
          prompt,
          targetCardId: candidateId,
          os,
          autoDispatch: true,
        });
      }
    }
    const currentStatus = await status();
    return {
      ...currentStatus,
      swarmResult: {
        sourceCardId,
        os,
        createdCardIds,
      },
    };
  }

  async function dropFile({
    fromCardId = "host-drop",
    toCardId = "linux",
    os = LINUX_OS,
    fileName,
    contentBase64,
  }) {
    if (typeof toCardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(toCardId)) {
      throw new GuestApiError(400, "toCardId must be a lowercase card identifier.");
    }
    const cleanFrom =
      typeof fromCardId === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(fromCardId)
        ? fromCardId
        : "host-drop";
    if (typeof fileName !== "string" || fileName.trim().length === 0) {
      throw new GuestApiError(400, "fileName is required.");
    }
    const safeFileName = path.basename(fileName.trim()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    if (!safeFileName || safeFileName.startsWith(".")) {
      throw new GuestApiError(400, "fileName must be a valid file name.");
    }
    if (typeof contentBase64 !== "string" || contentBase64.length > 750_000) {
      throw new GuestApiError(400, "contentBase64 must be a base64 string up to 512 KiB.");
    }
    const buffer = Buffer.from(contentBase64, "base64");
    const cardDropDir = path.join(paperPlanesDropDir, toCardId);
    await mkdir(cardDropDir, { recursive: true });
    const targetFilePath = path.join(cardDropDir, safeFileName);
    await writeFile(targetFilePath, buffer);

    const summaryMsg = `📦 FILE DROP: ${safeFileName} (${buffer.length} B) → VVFAT drive`;
    await sendPaperPlane({
      fromCardId: cleanFrom,
      toCardId: toCardId === cleanFrom ? "linux" : toCardId,
      os: os === WINDOWS_OS || os === "android" ? os : LINUX_OS,
      message: summaryMsg.slice(0, 160),
      injectToVm: false,
    });

    const currentStatus = await status();
    return {
      ...currentStatus,
      fileDropResult: {
        toCardId,
        fileName: safeFileName,
        bytes: buffer.length,
        hostPath: targetFilePath,
      },
    };
  }

  async function serialExec({ cardId = "linux", os = LINUX_OS, command }) {
    if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
      throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
    }
    if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
      throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
    }
    if (typeof command !== "string" || command.trim().length === 0 || command.length > 160) {
      throw new GuestApiError(400, "command must be a non-empty string up to 160 characters.");
    }
    const targetGuest = guests.get(guestKey(os, cardId));
    if (targetGuest) normalizeGuestState(targetGuest);
    if (!targetGuest || targetGuest.phase !== "running" || !targetGuest.ports?.serialPort) {
      throw new GuestApiError(
        409,
        "Start this guest before reading/writing its bidirectional serial pipe.",
      );
    }

    const serialPort = targetGuest.ports.serialPort;
    const cleanCmd = command.trim();
    const output = await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: serialPort });
      socket.setEncoding("utf8");
      let collected = "";
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(collected.trim());
      }, 950);
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new GuestApiError(503, `Serial bridge connection failed: ${err.message}`));
      });
      socket.once("connect", () => {
        socket.write(`${cleanCmd}\n`);
      });
      socket.on("data", (chunk) => {
        collected = `${collected}${chunk}`.slice(-4000);
      });
    });

    targetGuest.serialOutput = `${targetGuest.serialOutput ?? ""}\n$ ${cleanCmd}\n${output}`
      .trim()
      .slice(-2000);

    const currentStatus = await status();
    return {
      ...currentStatus,
      serialResult: {
        cardId,
        os,
        command: cleanCmd,
        output,
      },
    };
  }

  return async (request, response, next) => {
    if (await handleStripeRequest(request, response)) return;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/guest/")) {
      next();
      return;
    }

    const isNetworkPlaneRoute =
      (request.method === "POST" && url.pathname === "/api/guest/paper-plane/inbox") ||
      (request.method === "GET" && url.pathname === "/api/guest/paper-plane/catch");
    if (!isNetworkPlaneRoute && !isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: "Guest controls are available only from this computer." });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/guest/status") {
        sendJson(response, 200, await status());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/allocate-card-id") {
        const body = await readJson(request);
        sendJson(response, 200, await allocateCardId({
          prefix: body?.prefix,
          existingIds: body?.existingIds,
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/start") {
        const body = await readJson(request);
        sendJson(response, 200, await start(body?.os ?? LINUX_OS, body?.bootMode, body?.cardId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/finalize-base") {
        await readJson(request);
        sendJson(response, 200, await finalizeBase());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/stop") {
        const body = await readJson(request);
        if (typeof body?.cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.cardId)) {
          throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
        }
        const os = body.os ?? LINUX_OS;
        if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
          throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
        }
        sendJson(response, 200, await stop(body.cardId, os));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/delete") {
        const body = await readJson(request);
        sendJson(response, 200, await deleteCard({
          cardId: body?.cardId,
          os: body?.os ?? LINUX_OS,
          confirm: body?.confirm,
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/restore-checkpoint") {
        const body = await readJson(request);
        sendJson(response, 200, await restoreCheckpoint(body?.cardId, body?.name));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/force-stop") {
        const body = await readJson(request);
        if (typeof body?.cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.cardId)) {
          throw new GuestApiError(400, "cardId must be a lowercase card identifier.");
        }
        const os = body.os ?? LINUX_OS;
        if (os !== LINUX_OS && os !== WINDOWS_OS && os !== ANDROID_OS && os !== MACOS_OS) {
          throw new GuestApiError(400, "os must be 'linux', 'windows', 'android', or 'macos'.");
        }
        sendJson(response, 200, await stop(body.cardId, os, true));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/reset-overlay") {
        const body = await readJson(request);
        sendJson(response, 200, await resetOverlay(body?.cardId, body?.os ?? LINUX_OS));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/clone-overlay") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await cloneOverlay(body?.sourceCardId, body?.targetCardId, body?.os ?? LINUX_OS),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/paper-plane") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await sendPaperPlane({
            fromCardId: body?.fromCardId,
            toCardId: body?.toCardId,
            os: body?.os ?? LINUX_OS,
            message: body?.message,
            remoteTarget: body?.remoteTarget ?? "",
            injectToVm: body?.injectToVm !== false,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/paper-plane/inbox") {
        const body = await readJson(request);
        let fromId =
          typeof body?.fromCardId === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.fromCardId)
            ? body.fromCardId
            : "remote-peer";
        const toId =
          typeof body?.toCardId === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.toCardId)
            ? body.toCardId
            : "linux";
        if (fromId === toId) {
          fromId = ("remote-" + fromId).slice(0, 63);
        }
        const os =
          body?.os === WINDOWS_OS || body?.os === ANDROID_OS || body?.os === MACOS_OS
            ? body.os
            : LINUX_OS;
        sendJson(
          response,
          200,
          await sendPaperPlane({
            fromCardId: fromId,
            toCardId: toId,
            os,
            message: body?.message,
            injectToVm: body?.injectToVm !== false,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/custom-iso") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await setCustomIso({
            cardId: body?.cardId,
            isoPath: body?.isoPath,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/guest/paper-plane/catch") {
        const planes = await readPaperPlanes();
        const cardFilter = url.searchParams.get("cardId");
        const candidates = cardFilter
          ? planes.filter((p) => p.toCardId === cardFilter || p.fromCardId === cardFilter)
          : planes;
        const latest = candidates.length > 0 ? candidates[candidates.length - 1] : null;
        if (!latest) {
          sendJson(response, 404, { error: "No paper planes available to catch yet." });
          return;
        }
        if (url.searchParams.get("format") === "json") {
          sendJson(response, 200, latest);
          return;
        }
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(`${latest.message}\n`);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/paper-plane/inject") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await injectPaperPlane({
            cardId: body?.cardId,
            os: body?.os ?? LINUX_OS,
            message: body?.message,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/wake") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await wakeGuestScreen({
            cardId: body?.cardId,
            os: body?.os ?? LINUX_OS,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/ai-command") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await aiCommand({
            prompt: body?.prompt,
            targetCardId: body?.targetCardId ?? "linux",
            os: body?.os ?? LINUX_OS,
            remoteTarget: body?.remoteTarget ?? "",
            autoDispatch: body?.autoDispatch !== false,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/snapshot") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await snapshotCard({
            action: body?.action ?? "save",
            cardId: body?.cardId,
            os: body?.os ?? LINUX_OS,
            tag: body?.tag ?? "time-travel",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/network-mode") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await setNetworkMode({
            cardId: body?.cardId,
            networkMode: body?.networkMode ?? "nat",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/memory-profile") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await setMemoryProfile({
            cardId: body?.cardId,
            memoryProfile: body?.memoryProfile ?? "eco",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/cpu-profile") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await setCpuProfile({
            cardId: body?.cardId,
            cpuProfile: body?.cpuProfile ?? "balanced",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/swarm-fork") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await swarmFork({
            sourceCardId: body?.sourceCardId ?? "linux",
            os: body?.os ?? LINUX_OS,
            count: body?.count ?? 2,
            targetCardIds: body?.targetCardIds,
            prompt: body?.prompt ?? "",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/file-drop") {
        const body = await readJson(request, 1024 * 1024);
        sendJson(
          response,
          200,
          await dropFile({
            fromCardId: body?.fromCardId ?? "host-drop",
            toCardId: body?.toCardId ?? "linux",
            os: body?.os ?? LINUX_OS,
            fileName: body?.fileName,
            contentBase64: body?.contentBase64,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/guest/serial-exec") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await serialExec({
            cardId: body?.cardId ?? "linux",
            os: body?.os ?? LINUX_OS,
            command: body?.command,
          }),
        );
        return;
      }
      sendJson(response, 404, { error: "Unknown guest API endpoint." });
    } catch (error) {
      const statusCode = error instanceof GuestApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Unexpected guest service error.";
      sendJson(response, statusCode, { error: message });
    }
  };
}
