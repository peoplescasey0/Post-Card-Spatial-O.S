import { createInterface } from "node:readline";

const API_BASE = (process.env.POSTCARD_API_URL ?? "http://127.0.0.1:5173").replace(/\/+$/, "");

const TOOLS = [
  {
    name: "guest_status",
    description: "Get Post Card OS guest runtime status, active VMs, ports (including host SSH port), acceleration mode, lockdown state, and recent action journal.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guest_start",
    description: "Boot a VM card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Lowercase card ID (e.g. linux, windows, kali-red)." },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"], default: "linux" },
        bootMode: { type: "string", enum: ["disk", "installer"], default: "disk" },
      },
      required: ["cardId"],
    },
  },
  {
    name: "guest_stop",
    description: "Stop a running VM card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"], default: "linux" },
        force: { type: "boolean", default: false },
      },
      required: ["cardId"],
    },
  },
  {
    name: "guest_stop_all",
    description: "Stop all running VM cards and optionally reap orphaned QEMU processes.",
    inputSchema: {
      type: "object",
      properties: {
        includeOrphans: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "guest_snapshot",
    description: "Save or rewind a Time-Travel snapshot for a card (live QMP savevm/loadvm when running, qcow2 internal snapshot when stopped).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["save", "rewind"] },
        cardId: { type: "string" },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"], default: "linux" },
        tag: { type: "string", default: "time-travel" },
      },
      required: ["action", "cardId"],
    },
  },
  {
    name: "guest_network_mode",
    description: "Set a card's network topology mode.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        networkMode: { type: "string", enum: ["nat", "cyber-range", "airgap"] },
      },
      required: ["cardId", "networkMode"],
    },
  },
  {
    name: "guest_lockdown",
    description: "Engage or disengage room-wide Lockdown (airgaps all guests and blocks AI command injection).",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
      required: ["enabled"],
    },
  },
  {
    name: "guest_exec_serial",
    description: "Execute a command over the card's serial console.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"], default: "linux" },
        command: { type: "string" },
      },
      required: ["cardId", "command"],
    },
  },
  {
    name: "guest_provision_ssh_key",
    description: "Register an SSH public key for unattended provisioning on a card's drop drive.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        publicKey: { type: "string" },
      },
      required: ["cardId", "publicKey"],
    },
  },
  {
    name: "guest_disk_usage",
    description: "Inspect per-card qcow2 disk usage across the workspace.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guest_journal",
    description: "Read the append-only guest action journal.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guest_fork_card",
    description: "Non-destructively fork a card's disk into a new card ID so risky work doesn't touch the original.",
    inputSchema: {
      type: "object",
      properties: {
        sourceCardId: { type: "string" },
        targetCardId: { type: "string", description: "Optional target card ID; auto-allocated if omitted." },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"], default: "linux" },
      },
      required: ["sourceCardId"],
    },
  },
  {
    name: "guest_readiness",
    description: "Probe QEMU, qemu-img, ISOs, host acceleration, and get the single next setup action.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guest_shared_folder",
    description: "Mount or clear a host directory for a card (read-only by default).",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        hostPath: { type: "string", description: "Host directory path; empty to clear." },
        readOnly: { type: "boolean", default: true },
      },
      required: ["cardId"],
    },
  },
  {
    name: "guest_report_task",
    description: "Publish a structured task handoff summary (goal, summary, exitCode) onto a card for the human operator.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        goal: { type: "string" },
        summary: { type: "string" },
        exitCode: { type: "number", default: 0 },
      },
      required: ["cardId", "summary"],
    },
  },
];

async function callGuestApi(pathname, method = "GET", body = undefined) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status} from ${pathname}`);
  }
  return payload;
}

export async function handleMcpRequest(request) {
  const { id, method, params } = request ?? {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "postcard-guest-mcp", version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized") {
    return null;
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      let data;
      switch (name) {
        case "guest_status":
          data = await callGuestApi("/api/guest/status");
          break;
        case "guest_start":
          data = await callGuestApi("/api/guest/start", "POST", {
            cardId: args.cardId,
            os: args.os ?? "linux",
            bootMode: args.bootMode ?? "disk",
          });
          break;
        case "guest_stop":
          data = await callGuestApi(args.force ? "/api/guest/force-stop" : "/api/guest/stop", "POST", {
            cardId: args.cardId,
            os: args.os ?? "linux",
          });
          break;
        case "guest_stop_all":
          data = await callGuestApi("/api/guest/stop-all", "POST", {
            includeOrphans: args.includeOrphans !== false,
          });
          break;
        case "guest_snapshot":
          data = await callGuestApi("/api/guest/snapshot", "POST", {
            action: args.action,
            cardId: args.cardId,
            os: args.os ?? "linux",
            tag: args.tag ?? "time-travel",
          });
          break;
        case "guest_network_mode":
          data = await callGuestApi("/api/guest/network-mode", "POST", {
            cardId: args.cardId,
            networkMode: args.networkMode,
          });
          break;
        case "guest_lockdown":
          data = await callGuestApi("/api/guest/lockdown", "POST", { enabled: Boolean(args.enabled) });
          break;
        case "guest_exec_serial":
          data = await callGuestApi("/api/guest/serial-exec", "POST", {
            cardId: args.cardId,
            os: args.os ?? "linux",
            command: args.command,
          });
          break;
        case "guest_provision_ssh_key":
          data = await callGuestApi("/api/guest/ssh-key", "POST", {
            cardId: args.cardId,
            publicKey: args.publicKey,
          });
          break;
        case "guest_disk_usage":
          data = await callGuestApi("/api/guest/disk-usage");
          break;
        case "guest_journal":
          data = await callGuestApi("/api/guest/journal");
          break;
        case "guest_fork_card":
          data = await callGuestApi("/api/guest/fork-card", "POST", {
            sourceCardId: args.sourceCardId,
            targetCardId: args.targetCardId,
            os: args.os ?? "linux",
          });
          break;
        case "guest_readiness":
          data = await callGuestApi("/api/guest/readiness");
          break;
        case "guest_shared_folder":
          data = await callGuestApi("/api/guest/shared-folder", "POST", {
            cardId: args.cardId,
            hostPath: args.hostPath ?? "",
            readOnly: args.readOnly !== false,
          });
          break;
        case "guest_report_task":
          data = await callGuestApi("/api/guest/task-report", "POST", {
            cardId: args.cardId,
            goal: args.goal ?? "",
            summary: args.summary ?? "",
            exitCode: args.exitCode ?? 0,
            actor: "mcp-agent",
          });
          break;
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unsupported method: ${method}` },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("guest-mcp.mjs")) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const request = JSON.parse(trimmed);
      const response = await handleMcpRequest(request);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`,
      );
    }
  });
}
