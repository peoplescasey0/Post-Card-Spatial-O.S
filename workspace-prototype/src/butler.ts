/**
 * The butler's operator notebook.
 *
 * Every entry in BUTLER_GUIDE is a topic the butler can answer from. Add a
 * topic, give it a few keywords, and the same prompt matching picks it up —
 * there is no separate document to keep in sync.
 */

export type ButlerContext = {
  /** Seconds since the user last interacted with the page. */
  idleSeconds: number;
  /** Latest guest error text, if any. */
  guestError?: string;
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
  /** Active room environment name, e.g. "Sunset Library". */
  roomName?: string;
  /** Active card surface style name, e.g. "Carbon". */
  cardStyleName?: string;
  /** Selected card's current facet label, e.g. "03 · SECURITY". */
  facetLabel?: string;
  /** Number of cards in the room. */
  cardCount?: number;
  /** Cards waiting in the paper bin. */
  binCount?: number;
  /** Cards currently on the front bench (1–3). */
  benchCount?: number;
  /** Whether the selected card is zoomed to fill the stage. */
  zoomed?: boolean;
};

export type ButlerChoiceId = "tour" | "display" | "stuck" | "settings" | "bin" | "guide" | "snooze" | "dismiss";

export type ButlerNote = {
  key: string;
  message: string;
  choices: ButlerChoiceId[];
};

/** Things the butler can actually do, not just describe. */
export type ButlerAction =
  | "zoom"
  | "unzoom"
  | "install"
  | "display"
  | "settings"
  | "front"
  | "next-room"
  | "next-style"
  | "manual"
  | "performance"
  | "new-instance"
  | "bin"
  | "bench";

/** Every action the butler can run. Mirrors BUTLER_ROUTER_ACTIONS in guest-api.mjs. */
export const BUTLER_ACTION_IDS: readonly ButlerAction[] = [
  "zoom",
  "unzoom",
  "install",
  "display",
  "settings",
  "front",
  "next-room",
  "next-style",
  "manual",
  "performance",
  "new-instance",
  "bin",
  "bench",
];

export type ButlerTopicId =
  | "workspace"
  | "zoom"
  | "flip"
  | "install"
  | "display"
  | "rooms"
  | "bench"
  | "bin"
  | "savepoints"
  | "planes"
  | "new-instance"
  | "keys"
  | "performance"
  | "playbooks";

export type ButlerTopic = {
  id: ButlerTopicId;
  title: string;
  keywords: readonly string[];
  answer: (context: ButlerContext) => string;
};

/** Where the user is right now, in one clause. */
function where(context: ButlerContext): string {
  if (!context.cardName) return "I don't have a card in focus just now";
  const facet = context.facetLabel ? ` on ${context.facetLabel}` : "";
  return `You're on ${context.cardName}${facet}`;
}

export const BUTLER_GUIDE: readonly ButlerTopic[] = [
  {
    id: "workspace",
    title: "Getting around the room",
    keywords: ["around", "navigate", "carousel", "cards", "what can i do", "overview", "start", "basics", "help me"],
    answer: (context) =>
      `${where(context)}${context.roomName ? `, in the ${context.roomName} room` : ""}. Scroll or use the arrow keys to spin the carousel, then use the buttons printed on the card: Install, Stop, Settings, Screen, Zoom, Flip, Clone, Save, Perf and Bin. Room tools in the top bar holds card view, card ops, playbooks and New instance.`,
  },
  {
    id: "zoom",
    title: "Zooming the card",
    keywords: ["zoom", "closer", "fill the stage"],
    answer: (context) =>
      context.zoomed
        ? `${context.cardName ?? "The card"} now fills the stage. Press Z again, say "zoom out", or click empty space to pull back to the room.`
        : `Back at room scale — the whole carousel is visible. Say "zoom in" or press Z when you want one card full size.`,
  },
  {
    id: "flip",
    title: "Flipping the card",
    keywords: ["flip", "facet", "side", "face", "rotate", "settings", "security", "planes", "ports", "telemetry"],
    answer: (context) =>
      `The card has six faces plus three diagonal enclaves. Press 1–6 for 01 DISPLAY, 02 SETTINGS, 03 SECURITY, 04 PLANES, 05 ACTIONS and 06 TELEMETRY, or click the edge tabs (A / D / W / S). The 9-dot rail on the card face and the compass in the D-pad reach the corners: 07 PATENT LAB, 08 SLM TENSOR and 09 DIOV STREAMS. ${where(context)}.`,
  },
  {
    id: "install",
    title: "Installing and running a guest",
    keywords: ["install", "boot", "start", "launch", "guest", "operating system", "os", "qemu", "vnc"],
    answer: (context) =>
      context.serviceUnavailable
        ? "The local guest service isn't answering, so nothing can boot yet. Start it with `npm run dev` in workspace-prototype and reload; I'll keep watching."
        : `${context.needsInstall ? "This card has no system yet: press Install on the card to build the overlay and boot the guest." : "Press Install to boot the guest, Stop for a clean shutdown, or Screen to open the live display."} Guests run through the local service; disks and checkpoints are kept per card.`,
  },
  {
    id: "display",
    title: "The live display",
    keywords: ["screen", "display", "bigger", "twist", "expand", "fullscreen", "resolution"],
    answer: (context) =>
      `Open the display with the Screen button on the card or by double-clicking the card. Grab a display corner to twist it bigger in place, or use the screen dialog's twist control. ${context.displayOpen ? "The display window is open right now." : "Guest pixels only stream while a guest is running."}`,
  },
  {
    id: "rooms",
    title: "Rooms and card styles",
    keywords: ["room", "environment", "style", "theme", "preset", "lighting", "background", "surface", "color"],
    answer: (context) =>
      `Two axes, mixed freely: six rooms (Pixel Studio, Sunset Library, Forest Emerald, Lavender Mist, Obsidian Monochrome, Cyber Mainframe) and four card surfaces (Signature, Blueprint, Hologram, Carbon). The Two-Axis Inspector on the right swaps either one, and the Quick Presets mix both. Right now: ${context.roomName ?? "Cyber Mainframe"} + ${context.cardStyleName ?? "Signature"}.`,
  },
  {
    id: "bench",
    title: "The front bench",
    keywords: ["bench", "side by side", "compare", "two cards", "three cards"],
    answer: (context) =>
      `Bench pulls 1, 2 or 3 cards to the front workbench for side-by-side work; press B or the BENCH pill in the top bar. You currently have ${context.benchCount ?? 1} card${(context.benchCount ?? 1) === 1 ? "" : "s"} on the bench.`,
  },
  {
    id: "bin",
    title: "The paper bin",
    keywords: ["bin", "trash", "restore", "delete", "recover", "removed"],
    answer: (context) =>
      `The paper bin is the grey can in the back-left corner of the room; the Bin button on a card drops it in. Opening the bin restores cards with their disks and overlays. Deleting from there is permanent. ${context.binCount ?? 0} card${(context.binCount ?? 0) === 1 ? "" : "s"} in the bin.`,
  },
  {
    id: "savepoints",
    title: "Savepoints and rewind",
    keywords: ["savepoint", "rewind", "snapshot", "time travel", "checkpoint", "swarm", "fork"],
    answer: () =>
      "Save writes a Time-Travel Savepoint of RAM and disk in one go; Rewind restores the last one. Both sit under Playbooks & Ops in Room tools, alongside Swarm ×2 to fork the card into parallel clones.",
  },
  {
    id: "planes",
    title: "Paper planes and files",
    keywords: ["plane", "share", "send", "file", "drop", "transfer", "upload"],
    answer: () =>
      "Send a paper plane moves something from the selected card to another card in the room. You can also drag a file straight from your desktop onto a card to drop it in.",
  },
  {
    id: "new-instance",
    title: "Adding a new instance",
    keywords: ["new instance", "add card", "another card", "new card", "add a screen", "more cards", "instance", "duplicate"],
    answer: (context) =>
      `Room tools → New instance adds a card the way a phone adds a home screen: pick Windows, Linux, Android or macOS, clone the current card, or point at your own ISO / QCOW2. That makes ${(context.cardCount ?? 0) + 1} cards in the room.`,
  },
  {
    id: "keys",
    title: "Keyboard shortcuts",
    keywords: ["key", "shortcut", "keyboard", "manual", "handbook", "hotkey"],
    answer: () =>
      "Arrows or scroll browse the ring · Z zoom · F flip front/back · 1–6 facets · 7–9 enclaves · A / D / W / S edge flips · B bench · T tour · M editions · Ctrl+K or / call me · ? opens the full manual.",
  },
  {
    id: "performance",
    title: "Performance and graphics",
    keywords: ["performance", "fps", "cpu profile", "gpu", "quality"],
    answer: () =>
      "The Performance suite (⚡ in Room tools, or Perf on the card) sets the CPU profile — Eco, Balanced or Gaming — and the graphics profile — Performance, Balanced or Quality. Lower profiles cut shadow maps and pixel ratio so live guests stay smooth.",
  },
  {
    id: "playbooks",
    title: "Playbooks and SecOps",
    keywords: ["playbook", "secops", "cyber range", "net mode", "eco ram", "serial pipe", "drop file"],
    answer: () =>
      "Playbooks & Ops in Room tools runs the SecOps set (Recon Ports, Priv Audit, Live Sockets, Firewall, Forensics) plus Net Mode, Eco RAM, Drop File and Serial Pipe. Anything else you type goes to the selected card as a command.",
  },
];

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
      message: `That looks like trouble${context.cardName ? ` with ${context.cardName}` : ""}: "${context.guestError}". Shall I walk you through a fix?`,
      choices: ["stuck", "display", "dismiss"],
    };
  }
  if (context.serviceUnavailable) {
    return {
      key: "service",
      message: "I can't reach the local guest service. Is `npm run dev` still running?",
      choices: ["stuck", "dismiss"],
    };
  }
  if (context.idleSeconds >= IDLE_CHECK_IN_SECONDS) {
    if (context.displayOpen) {
      return {
        key: "idle-display",
        message: "Still with us? Twist the display bigger if the screen feels cramped.",
        choices: ["display", "stuck", "snooze"],
      };
    }
    if (context.needsInstall) {
      return {
        key: `install:${context.cardName ?? ""}`,
        message: `${context.cardName ?? "This card"} has no system installed yet. Press Install on the card whenever you are ready.`,
        choices: ["tour", "snooze"],
      };
    }
    return {
      key: "idle",
      message: "Just checking in. Need a hand finding something?",
      choices: ["tour", "stuck", "snooze"],
    };
  }
  return undefined;
}

export function butlerGreeting(context: ButlerContext): ButlerNote {
  return {
    key: "greeting",
    message: `${where(context)}${context.roomName ? ` in the ${context.roomName} room` : ""}. Ask me about rooms, installs, savepoints or the bin — or say \"zoom in\" and I'll do it.`,
    choices: ["guide", "tour", "display", "stuck"],
  };
}

export const BUTLER_CHOICE_LABELS: Record<ButlerChoiceId, string> = {
  guide: "What can I do here?",
  tour: "Show me around",
  display: "Make the screen bigger",
  stuck: "I'm stuck",
  settings: "Open settings",
  bin: "Where is the bin?",
  snooze: "Not now",
  dismiss: "I'm fine",
};

export function butlerAnswer(choice: ButlerChoiceId, context: ButlerContext): string {
  switch (choice) {
    case "guide":
      return BUTLER_GUIDE[0].answer(context);
    case "tour":
      return "Scroll or use the arrow keys to spin the carousel. Spin the ring and the selected card faces you. Its buttons are printed on the card itself: Install, Stop, Settings, Screen, Zoom, Flip, Clone, Save, Perf and Bin.";
    case "display":
      return "Opening the display and twisting it to full size. Grab a display corner to untwist it again.";
    case "stuck":
      if (context.serviceUnavailable) {
        return "Start the host service with `npm run dev` in workspace-prototype, then reload. I'll keep an eye out.";
      }
      if (context.guestError) {
        return "Try Stop, then Install again. If the installer ignores shutdown, use Force stop in the display, which discards unsaved work. Your disks and checkpoints stay safe.";
      }
      return "Nothing looks broken. Try the card's Help or Perf buttons, or press ? for the manual.";
    case "settings":
      return "Flipping the card to its settings side.";
    case "bin":
      return "The paper bin is the grey can in the far back-left corner of the room, or use Bin on the card. Click it to restore binned cards.";
    case "snooze":
      return "Understood. I won't interrupt for a while unless something goes wrong.";
    case "dismiss":
      return "Very good. I'll be nearby.";
  }
}

export function butlerTopic(id: ButlerTopicId, context: ButlerContext): ButlerNote {
  const topic = BUTLER_GUIDE.find((entry) => entry.id === id) ?? BUTLER_GUIDE[0];
  return { key: `topic:${topic.id}`, message: topic.answer(context), choices: ["tour", "dismiss"] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highest-scoring notebook topic for a question, if any keywords matched. */
function matchTopic(prompt: string): ButlerTopic | undefined {
  let best: ButlerTopic | undefined;
  let bestScore = 0;
  for (const topic of BUTLER_GUIDE) {
    let score = 0;
    for (const keyword of topic.keywords) {
      // Optional plural so "room" also catches "rooms" and "shortcut" "shortcuts".
      if (new RegExp(`\\b${escapeRegExp(keyword)}s?\\b`, "i").test(prompt)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best;
}

export type ButlerInterpretation = {
  choice?: ButlerChoiceId;
  action?: ButlerAction;
  reply?: string;
  topic?: ButlerTopicId;
};

/** Topic ids in notebook order. Mirrors BUTLER_ROUTER_TOPICS in guest-api.mjs. */
export const BUTLER_TOPIC_IDS: readonly ButlerTopicId[] = BUTLER_GUIDE.map((entry) => entry.id);

const BUTLER_ACTION_SET = new Set<string>(BUTLER_ACTION_IDS);
const BUTLER_TOPIC_SET = new Set<string>(BUTLER_TOPIC_IDS);

/**
 * Turns a schema-constrained router reply into a usable interpretation. Anything
 * the model invents, or anything it isn't confident about, is ignored so the
 * keyword matcher takes over.
 */
export function interpretButlerRouterReply(
  reply: unknown,
  minConfidence = 0.4,
): ButlerInterpretation | undefined {
  if (!reply || typeof reply !== "object") return undefined;
  const record = reply as { action?: unknown; topic?: unknown; confidence?: unknown };
  const confidence = typeof record.confidence === "number" ? record.confidence : 0;
  if (!(confidence >= minConfidence)) return undefined;
  const action =
    typeof record.action === "string" && BUTLER_ACTION_SET.has(record.action)
      ? (record.action as ButlerAction)
      : undefined;
  const topic =
    typeof record.topic === "string" && BUTLER_TOPIC_SET.has(record.topic)
      ? (record.topic as ButlerTopicId)
      : undefined;
  if (!action && !topic) return undefined;
  return { action, topic };
}

/**
 * Asks the guest service for a routing decision from the optional local model.
 * Any failure (router off, unreachable, slow, low confidence) returns undefined
 * so the caller can fall back to `butlerInterpretPrompt`.
 */
export async function requestButlerRouting(
  prompt: string,
  context: ButlerContext,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ButlerInterpretation | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl("/api/butler/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        prompt,
        context: {
          facet: context.facetLabel,
          room: context.roomName,
          guestRunning: context.guestRunning,
          needsInstall: context.needsInstall,
          displayOpen: context.displayOpen,
          zoomed: context.zoomed,
        },
      }),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { enabled?: boolean; ok?: boolean; reply?: unknown };
    if (!data?.enabled || !data?.ok) return undefined;
    return interpretButlerRouterReply(data.reply);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the keyword matcher recognised nothing, so the optional router is
 * worth a round trip. Known phrasing answers immediately instead of waiting.
 */
export function butlerNeedsRouter(interpretation: ButlerInterpretation): boolean {
  return !interpretation.action && !interpretation.choice && !interpretation.reply && !interpretation.topic;
}

/**
 * Keyword matcher first; the router is consulted only for prompts the matcher
 * does not understand. A router that finds nothing leaves the empty
 * interpretation in place, which the caller treats as "ask before forwarding".
 */
export async function butlerInterpretPromptWithRouter(
  prompt: string,
  context: ButlerContext,
  route: (prompt: string, context: ButlerContext) => Promise<ButlerInterpretation | undefined>,
): Promise<ButlerInterpretation> {
  const local = butlerInterpretPrompt(prompt, context);
  if (!butlerNeedsRouter(local)) return local;
  return (await route(prompt, context)) ?? local;
}

export function butlerInterpretPrompt(rawPrompt: string, context: ButlerContext): ButlerInterpretation {
  const q = rawPrompt.trim().toLowerCase();
  if (!q) return { reply: "Tell me what you need, or pick an option below." };
  if (/^(help|hi|hello|hey)[!.?]*$/.test(q)) {
    return { choice: "guide", reply: butlerAnswer("guide", context) };
  }
  // SecOps-shaped prompts are card commands; let them reach the card untouched.
  if (
    /\b(recon|nmap|scan|audit|forensics|sockets|harden|firewall|exec|serial|screenshot)\b/.test(q) &&
    !/^(what|how|where|why|which|explain|tell)\b/.test(q)
  ) {
    return {};
  }

  // Actions first: only fire when the phrasing is unambiguous.
  if (/\b(zoom|closer)\b/.test(q) && !/\b(out|back|reset)\b/.test(q)) {
    return { action: "zoom", topic: "zoom" };
  }
  if (/\bzoom out\b|\bunzoom\b|\bback out\b/.test(q)) {
    return { action: "unzoom", topic: "zoom" };
  }
  if (/\b(install|boot|launch|start)\b/.test(q) && !/\b(manual|tour)\b/.test(q)) {
    return { action: "install", topic: "install" };
  }
  if (/\b(next|change|switch|different|another)\b/.test(q) && /\b(room|environment|lighting)\b/.test(q)) {
    return { action: "next-room", topic: "rooms" };
  }
  if (/\b(next|change|switch|different|another)\b/.test(q) && /\b(style|surface|look)\b/.test(q)) {
    return { action: "next-style", topic: "rooms" };
  }
  if (/\b(manual|handbook)\b/.test(q)) {
    return { action: "manual", topic: "keys" };
  }
  if (/\b(performance|fps|cpu|gpu profile)\b/.test(q)) {
    return { action: "performance", topic: "performance" };
  }
  if (/\b(new instance|add a card|add another card|add a screen|new card)\b/.test(q)) {
    return { action: "new-instance", topic: "new-instance" };
  }
  if (/\b(open|show)\b.*\b(bin|trash)\b/.test(q)) {
    return { action: "bin", topic: "bin" };
  }

  // Chip choices keep their direct behaviour.
  if (/\b(screen|display|bigger|twist|fullscreen|expand)\b/.test(q)) {
    return { choice: "display", reply: butlerAnswer("display", context) };
  }
  if (/\b(settings|hardware|back side)\b/.test(q)) {
    return { choice: "settings", reply: butlerAnswer("settings", context) };
  }
  if (/\b(trash|bin|delete|restore)\b/.test(q)) {
    return { choice: "bin", reply: butlerAnswer("bin", context) };
  }
  if (/\b(tour|around the room|controls|buttons)\b/.test(q)) {
    return { choice: "tour", reply: butlerAnswer("tour", context) };
  }
  if (/\b(stuck|trouble|error|broken|slow|fix)\b/.test(q)) {
    return { choice: "stuck", reply: butlerAnswer("stuck", context) };
  }

  // Anything else is answered from the operator notebook.
  const topic = matchTopic(q);
  if (topic) {
    return { reply: topic.answer(context), topic: topic.id };
  }
  return {};
}
