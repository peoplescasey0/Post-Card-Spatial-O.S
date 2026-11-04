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
};

export type ButlerChoiceId = "tour" | "display" | "stuck" | "settings" | "bin" | "snooze" | "dismiss";

export type ButlerNote = {
  key: string;
  message: string;
  choices: ButlerChoiceId[];
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
    message: `At your service${context.cardName ? ` — you are on ${context.cardName}` : ""}. What do you need?`,
    choices: ["tour", "display", "stuck", "settings", "bin"],
  };
}

export const BUTLER_CHOICE_LABELS: Record<ButlerChoiceId, string> = {
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
    case "tour":
      return "Scroll or use the arrow keys to spin the carousel. Spin the ring and the selected card faces you. Its buttons are printed on the card itself: Launch, Stop, Zoom, Settings, Clone, Save, Perf and Bin.";
    case "display":
      return "Opening the display and twisting it to full size. Press T or use Twist to shrink it again.";
    case "stuck":
      if (context.serviceUnavailable) {
        return "Start the host service with `npm run dev` in workspace-prototype, then reload. I'll keep an eye out.";
      }
      if (context.guestError) {
        return "Try Stop, then Launch again. If the installer ignores shutdown, use Force stop in the display, which discards unsaved work. Your disks and checkpoints stay safe.";
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

export function butlerInterpretPrompt(
  rawPrompt: string,
  context: ButlerContext,
): { choice?: ButlerChoiceId; reply?: string } {
  const q = rawPrompt.trim().toLowerCase();
  if (!q) return { reply: "Tell me what you need, or pick an option below." };
  if (/\b(screen|display|bigger|twist|full\s*screen|expand)\b/.test(q)) {
    return { choice: "display", reply: butlerAnswer("display", context) };
  }
  if (/\b(trash|bin|delete|restore|corner)\b/.test(q)) {
    return { choice: "bin", reply: butlerAnswer("bin", context) };
  }
  if (/\b(setting|back|hardware|flip)\b/.test(q)) {
    return { choice: "settings", reply: butlerAnswer("settings", context) };
  }
  if (/\b(tour|around|how\s+do\s+i|controls|buttons)\b/.test(q)) {
    return { choice: "tour", reply: butlerAnswer("tour", context) };
  }
  if (/\b(windows|iso|wsl)\b/.test(q)) {
    return {
      reply:
        "Windows install media is not bundled. Point POSTCARD_WINDOWS_ISO at your own ISO; keeping it inside WSL Ubuntu lets QEMU read it directly without crossing the slow Windows mount.",
    };
  }
  if (/\b(stuck|trouble|error|broken|help|slow|fix)\b/.test(q)) {
    return { choice: "stuck", reply: butlerAnswer("stuck", context) };
  }
  return {};
}


