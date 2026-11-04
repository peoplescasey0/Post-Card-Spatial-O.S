export type GuestActionStatus = "offline" | "starting" | "running" | "stopping" | "error";
export type GuestActionOs = "linux" | "windows" | "android" | "macos";
export type OnCardAction = "guest" | "shutdown" | "settings" | "bin" | "delete";

export type OnCardActionState = {
  guestLabel: string;
  guestDisabled: boolean;
  showShutdown: boolean;
  shutdownDisabled: boolean;
  showBin: boolean;
  showDelete: boolean;
};

export function getOnCardActionState(input: {
  os: GuestActionOs;
  guestStatus?: GuestActionStatus;
  baseReady: boolean;
  hasDisk: boolean;
  canMoveToBin: boolean;
}): OnCardActionState {
  const busy = input.guestStatus === "starting" || input.guestStatus === "stopping";
  const guestLabel =
    input.guestStatus === "running"
      ? "Open"
      : input.guestStatus === "starting"
        ? "Starting…"
        : input.guestStatus === "stopping"
          ? "Stopping…"
          : input.os === "windows"
            ? input.hasDisk
              ? "Resume"
              : "Install"
            : input.hasDisk
              ? "Resume"
              : input.baseReady
                ? "Launch"
                : "Install";

  return {
    guestLabel,
    guestDisabled: busy,
    showShutdown: input.guestStatus === "running",
    shutdownDisabled: input.guestStatus !== "running",
    showBin: input.canMoveToBin,
    showDelete: input.canMoveToBin,
  };
}

export function routeOnCardAction(
  action: OnCardAction,
  handlers: Record<OnCardAction, () => void>,
): void {
  handlers[action]();
}

export async function runConfirmedCardDeletion<T>(options: {
  deleteGuest: () => Promise<T>;
  waitForFlight: () => Promise<void>;
  onSuccess: (result: T) => void;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  let result: T;
  try {
    result = await options.deleteGuest();
    await options.waitForFlight();
  } catch (error) {
    options.onFailure(error);
    return;
  }
  options.onSuccess(result);
}
