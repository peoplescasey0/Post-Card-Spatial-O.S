export type ButlerEngineModel = "auto" | "qwen-coder" | "llama-chat";

export type ButlerContext = {
  /** Seconds since the user last interacted with the page. */
  idleSeconds: number;
  /** Latest guest error text, if any. */
  guestError?: string;
  /** Latest guest QEMU stderr or panic trace, if any. */
  guestStderr?: string;
  /** Selected card name. */
  cardName?: string;
  /** Whether the selected card's guest is running. */
  guestRunning: boolean;
  /** Whether the selected card still needs its guest installed. */
  needsInstall?: boolean;
  /** Whether the guest service itself could not be reached. */
  serviceUnavailable: boolean;
  /** Whether the display dialog is open. */
  displayOpen: boolean;
  /** Optional summary of all active cards in the room. */
  cardsList?: string[];
  /** Active local AI engine model. */
  model?: ButlerEngineModel;
};

export type ButlerChoiceId =
  | "tour"
  | "display"
  | "stuck"
  | "settings"
  | "bin"
  | "blueprints"
  | "opml"
  | "freeplane"
  | "vscode"
  | "swiftshader"
  | "snooze"
  | "dismiss";

export type ButlerNote = {
  key: string;
  message: string;
  choices: ButlerChoiceId[];
  actionPayload?: {
    type: "open-blueprint" | "download-opml" | "download-freeplane" | "toggle-swiftshader";
    blueprintId?: string;
    data?: string;
  };
};

export const IDLE_CHECK_IN_SECONDS = 90;
/** Minimum quiet time between unprompted check-ins. */
export const CHECK_IN_COOLDOWN_SECONDS = 180;
/** How long "Not now" silences idle check-ins (errors still break through). */
export const SNOOZE_SECONDS = 600;

/** Decides whether the butler should check in unprompted. Returns undefined to stay quiet. */
export function butlerCheckIn(context: ButlerContext): ButlerNote | undefined {
  if (context.guestError) {
    return {
      key: `error:${context.guestError}`,
      message: `Trouble detected on ${context.cardName ? `${context.cardName}` : "this card"}: "${context.guestError}". Would you like me to inspect system blueprints or execute an automated safe reboot?`,
      choices: ["stuck", "blueprints", "display", "dismiss"],
    };
  }
  if (context.serviceUnavailable) {
    return {
      key: "service",
      message: "I cannot reach the local guest service. Verify that `npm run dev` is running on your host, or let me diagnose with the architecture mindmap.",
      choices: ["stuck", "blueprints", "dismiss"],
    };
  }
  if (context.idleSeconds >= IDLE_CHECK_IN_SECONDS) {
    if (context.displayOpen) {
      return {
        key: "idle-display",
        message: "Still monitoring this card? You can twist the display to full screen or inspect its telemetry pipeline.",
        choices: ["display", "blueprints", "snooze"],
      };
    }
    if (context.needsInstall) {
      return {
        key: `install:${context.cardName ?? ""}`,
        message: `${context.cardName ?? "This card"} has no golden image installed yet. Press Install on the card whenever you are ready.`,
        choices: ["tour", "snooze"],
      };
    }
    return {
      key: "idle",
      message: "I am 'The One' AI Butler. I have indexed your system architecture blueprints, OPML outliner, and hypervisor tooling. What shall we coordinate?",
      choices: ["blueprints", "opml", "tour", "snooze"],
    };
  }
  return undefined;
}

export function butlerGreeting(context: ButlerContext): ButlerNote {
  return {
    key: "greeting",
    message: `At your service, Operator. I am 'The One' spatial AI co-pilot${context.cardName ? ` — standing by on ${context.cardName}` : ""}. Ready for multi-OS hypervisor orchestration, architecture blueprints, OPML outline synthesis, or VS Code remote hooks.`,
    choices: ["blueprints", "opml", "vscode", "tour", "display", "settings"],
  };
}

export const BUTLER_CHOICE_LABELS: Record<ButlerChoiceId, string> = {
  blueprints: "📐 System Blueprints",
  opml: "📝 Export OPML Outline",
  freeplane: "🧠 Freeplane Mind Map",
  vscode: "💻 VS Code Remote Hook",
  swiftshader: "⚡ SwiftShader / Vulkan",
  tour: "Show me around",
  display: "Make the screen bigger",
  stuck: "I'm stuck / Fix",
  settings: "Open settings",
  bin: "Where is the bin?",
  snooze: "Not now",
  dismiss: "I'm fine",
};

export function butlerAnswer(choice: ButlerChoiceId, context: ButlerContext): string {
  switch (choice) {
    case "blueprints":
      return `Opening the Architectural Blueprint HUD. You have 5 verified system designs available: CI/CD Pipeline, Postgres/Supabase ERD Data Model, Spatial OS System Mindmap, LiDAR UART State-Machine Filter, and Product Development Flow.`;
    case "opml":
      return `Synthesizing OPML 2.0 outline from current spatial state. I have validated this against the opml.org specification. You can import this into any outliner, RSS reader, or note tree.`;
    case "freeplane":
      return `Generating Freeplane (.mm) Mind Map with full node core formatting, summary groups, calculations (=3+4), relations, cloud boundaries, and floating nodes. Spooling to download...`;
    case "vscode": {
      const safeName = (context.cardName || "Fedora-Workstation").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return `Launch a remote VS Code editor directly attached to ${context.cardName || "Fedora-Workstation"}'s isolated virtual filesystem.\nCommand: \`code --remote ssh-remote+postcard-${safeName} /opt/postcard/workspace\``;
    }
    case "swiftshader": {
      return `SwiftShader status: HARDWARE mode. Native GPU acceleration (DirectLink / WebGL2).`;
    }
    case "tour":
      return "Scroll or use arrow keys to spin the 3D carousel. Spin the ring and the selected card faces you. Its controls are on the card itself: Launch, Stop, Zoom, Settings, Clone, Save, Perf, and Bin.";
    case "display":
      return "Opening the guest display and twisting it to retina full size. Press T or click Twist to shrink it again.";
    case "stuck":
      if (context.serviceUnavailable) {
        return "Start the host service with `npm run dev` in workspace-prototype, then reload. I'll keep an eye out.";
      }
      if (context.guestStderr) {
        const lastStderr = context.guestStderr.trim().split(/\r?\n/).slice(-3).join(" | ");
        return `QEMU Diagnostic Log: "${lastStderr}". Use Stop, then Launch again with the safe display profile or inspection blueprints.`;
      }
      if (context.guestError) {
        return "Try Stop, then Launch again. If the installer ignores shutdown, use Force stop in the display. Disks and snapshots stay safe.";
      }
      return "Nothing looks broken. Try the card's Help or Perf buttons, inspect Blueprints, or press ? for the manual.";
    case "settings":
      return "Flipping the card to its settings and hardware configuration plane.";
    case "bin":
      return "The paper bin is the grey can in the far back-left corner of the room, or use Bin on the card. Click it to restore binned cards.";
    case "snooze":
      return "Understood, Operator. I will hold quiet unless a critical VM fault occurs.";
    case "dismiss":
      return "Very good. 'The One' is always active in the background.";
  }
}

export function generateDeckOpml(cardNames: string[] = []): string {
  const cards = cardNames.length > 0 ? cardNames : ["Linux Workstation", "Windows 11", "Cupertino macOS", "Android Sandbox", "Cyber Range"];
  const outlinesXml = cards.map((name, i) => `    <outline text="Card 0${i + 1}: ${name}" type="system-card" />`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Post Card Spatial OS - Active Virtual Workspace Deck</title>\n    <ownerName>Operator</ownerName>\n  </head>\n  <body>\n    <outline text="Spatial Operating System Hypervisor Core">\n${outlinesXml}\n    </outline>\n  </body>\n</opml>`;
}

export function butlerInterpretPrompt(
  rawPrompt: string,
  context: ButlerContext,
): { choice?: ButlerChoiceId; reply?: string; actionPayload?: ButlerNote["actionPayload"] } {
  const q = rawPrompt.trim().toLowerCase();
  if (!q) return { reply: "Tell me what you need, Operator, or select an operational capability below." };

  // Determine engine persona
  const activeModel = context.model || "auto";
  const isCoder =
    activeModel === "qwen-coder" ||
    (activeModel === "auto" && /\b(code|build|script|terminal|qemu|kvm|bash|git|sh|kernel|patch|compile|test|port|bug|fix|error|opml|json)\b/i.test(q));
  const engineBadge = isCoder ? "💻 [Qwen 2.5 Coder 1.5B]" : "💬 [Llama 3.2 1B]";

  // Blueprints & Architecture
  if (/\b(blueprint|diagram|architecture|erd|pipeline|mindmap|lidar|flowchart|mermaid|schema)\b/.test(q)) {
    let matchedId: string | undefined = undefined;
    if (q.includes("pipeline") || q.includes("ci")) matchedId = "ci-cd-pipeline";
    else if (q.includes("erd") || q.includes("database") || q.includes("postgres")) matchedId = "erd-data-model";
    else if (q.includes("lidar") || q.includes("sensor") || q.includes("uart")) matchedId = "lidar-decimation-filter";
    else if (q.includes("flowchart") || q.includes("product")) matchedId = "product-flowchart";
    else if (q.includes("mindmap") || q.includes("system")) matchedId = "system-mindmap";

    return {
      choice: "blueprints",
      reply: `${engineBadge} ${butlerAnswer("blueprints", context)}`,
      actionPayload: { type: "open-blueprint", blueprintId: matchedId },
    };
  }

  // OPML Outliner & Export
  if (/\b(opml|outline|outliner|tree|export deck|hierarchy|notes)\b/.test(q)) {
    const opmlText = generateDeckOpml(context.cardsList);
    return {
      choice: "opml",
      reply: `${engineBadge} Generated OPML 2.0 Deck Outline tree. Spooling to local download...`,
      actionPayload: { type: "download-opml", data: opmlText },
    };
  }

  // Freeplane Mind Map
  if (/\b(freeplane|freemind|mind\s*map|mindmap\.mm|\.mm|bubble node)\b/.test(q)) {
    return {
      choice: "freeplane",
      reply: `${engineBadge} ${butlerAnswer("freeplane", context)}`,
      actionPayload: { type: "download-freeplane" },
    };
  }

  // VS Code remote
  if (/\b(vscode|code|editor|ide|remote)\b/.test(q)) {
    return { choice: "vscode", reply: `${engineBadge} ${butlerAnswer("vscode", context)}` };
  }

  // SwiftShader / Vulkan graphics
  if (/\b(swiftshader|vulkan|egl|software render|software rasterizer|gpu)\b/.test(q)) {
    return { choice: "swiftshader", reply: `${engineBadge} ${butlerAnswer("swiftshader", context)}` };
  }

  if (/\b(screen|display|bigger|twist|full\s*screen|expand)\b/.test(q)) {
    return { choice: "display", reply: `${engineBadge} ${butlerAnswer("display", context)}` };
  }
  if (/\b(trash|bin|delete|restore|corner)\b/.test(q)) {
    return { choice: "bin", reply: `${engineBadge} ${butlerAnswer("bin", context)}` };
  }
  if (/\b(setting|back|hardware|flip)\b/.test(q)) {
    return { choice: "settings", reply: `${engineBadge} ${butlerAnswer("settings", context)}` };
  }
  if (/\b(tour|around|how\s+do\s+i|controls|buttons)\b/.test(q)) {
    return { choice: "tour", reply: `${engineBadge} ${butlerAnswer("tour", context)}` };
  }
  if (/\b(windows|iso|wsl)\b/.test(q)) {
    return {
      reply:
        `${engineBadge} Windows install media is not bundled. Point POSTCARD_WINDOWS_ISO at your own ISO; keeping it inside WSL Ubuntu lets QEMU read it directly without crossing the slow Windows mount.`,
    };
  }
  if (/\b(foundry|catapult|black\s*box|radiator|glass\s*cockpit|beacon|pa-romy|romy|hangar|flight\s*deck|lockedheap|elf64|avionics|2195|al-li|cryogenic|hull)\b/.test(q)) {
    return {
      reply:
        `${engineBadge} Post Card OS // Space Plane Avionics v1.0.4: Chassis (Al-Li 2195 Cryogenic Hull Frame [SECURED]) · The Foundry (16MB LockedHeap Arena [STABLE]) · The Catapult (ELF64 Ring 3 Spatial Loader [ARMED]) · The Black Box (VfsStorageBridge Sector Mirror [LOCKED]) · The Radiator (Cryogenic Thermal Control Loop [STABILIZED]) · PA-Romy Vault (Isolated Neural Coprocessor [ACTIVE]) · The Glass Cockpit & The Beacon (/telemetry WebSocket stream).`,
    };
  }

  if (/\b(stuck|trouble|error|broken|help|slow|fix)\b/.test(q)) {
    return { choice: "stuck", reply: `${engineBadge} ${butlerAnswer("stuck", context)}` };
  }

  if (isCoder) {
    return {
      reply: `${engineBadge} Standing by on code & hypervisor ops: "${rawPrompt}". I can generate QEMU launch flags, inspect system blueprints, export OPML outlines, or inject SecOps playbooks into running guests.`,
    };
  }

  return {
    reply: `${engineBadge} Great to chat with you, Operator. I'm keeping your spatial deck running smoothly. What would you like to explore or customize today?`,
  };
}
