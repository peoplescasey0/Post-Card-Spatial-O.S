const INTERACTIVE_WHEEL_TARGETS =
  "button, a, input, select, textarea, summary, .pulldown, [role='dialog']";

export function attachCarouselWheelListener(
  sceneShell: HTMLElement,
  onWheel: (event: WheelEvent) => void,
): void {
  sceneShell.addEventListener(
    "wheel",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        !target.closest("#room-card-nav") &&
        target.closest(INTERACTIVE_WHEEL_TARGETS)
      ) {
        return;
      }
      onWheel(event);
    },
    { capture: true, passive: false },
  );
}

export function createWheelCarouselHandler(
  cardCount: () => number,
  advance: (direction: 1 | -1) => void,
  now: () => number = () => performance.now(),
  cooldownMs = 140,
): (event: WheelEvent) => void {
  let wheelAccumulator = 0;
  let lastWheelStepTime = 0;

  return (event) => {
    if (!event.deltaY || cardCount() < 2) return;
    event.preventDefault();
    wheelAccumulator += event.deltaY;
    const time = now();

    if (Math.abs(wheelAccumulator) >= 36 && time - lastWheelStepTime > cooldownMs) {
      const direction: 1 | -1 = wheelAccumulator > 0 ? 1 : -1;
      wheelAccumulator = 0;
      lastWheelStepTime = time;
      advance(direction);
    }
  };
}

