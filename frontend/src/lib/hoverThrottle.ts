export interface HoverPoint {
  x: number;
  y: number;
}

export interface HoverSchedulerOptions {
  /**
   * Injectable requestAnimationFrame (defaults to window.requestAnimationFrame or setTimeout).
   */
  raf?: (cb: () => void) => any;
  /**
   * Injectable cancelAnimationFrame (defaults to window.cancelAnimationFrame or clearTimeout).
   */
  cancelRaf?: (id: any) => void;
  /**
   * Minimum movement in pixels to consider a new hover query (defaults to 3).
   */
  minMovePx?: number;
}

export interface HoverScheduler {
  (pt: HoverPoint): boolean;
  schedule(pt: HoverPoint): boolean;
  cancel(resetPoint?: boolean): void;
  reset(): void;
  isPending(): boolean;
  getLastPoint(): HoverPoint | null;
}

/**
 * Pure scheduler that coalesces hover events into at most one execution per frame
 * using requestAnimationFrame, and discards movements below `minMovePx` (default 3px).
 */
export function createHoverScheduler(
  run: (pt: HoverPoint) => void,
  options?: HoverSchedulerOptions
): HoverScheduler {
  const minMovePx = options?.minMovePx ?? 3;
  const minMovePxSq = minMovePx * minMovePx;

  const defaultRaf = (cb: () => void) =>
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(cb)
      : (setTimeout(cb, 16) as unknown as number);

  const defaultCancelRaf = (id: any) =>
    typeof cancelAnimationFrame !== "undefined"
      ? cancelAnimationFrame(id)
      : clearTimeout(id);

  const raf = options?.raf ?? defaultRaf;
  const cancelRaf = options?.cancelRaf ?? defaultCancelRaf;

  let rafId: any = null;
  let pendingPoint: HoverPoint | null = null;
  let lastProcessedPoint: HoverPoint | null = null;

  function cancel(resetPoint = true): void {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    pendingPoint = null;
    if (resetPoint) {
      lastProcessedPoint = null;
    }
  }

  function reset(): void {
    cancel(true);
  }

  function schedule(pt: HoverPoint): boolean {
    if (lastProcessedPoint !== null) {
      const dx = pt.x - lastProcessedPoint.x;
      const dy = pt.y - lastProcessedPoint.y;
      if (dx * dx + dy * dy < minMovePxSq) {
        return false;
      }
    }

    pendingPoint = pt;

    if (rafId === null) {
      rafId = raf(() => {
        rafId = null;
        if (pendingPoint !== null) {
          const target = pendingPoint;
          pendingPoint = null;
          lastProcessedPoint = target;
          run(target);
        }
      });
    }

    return true;
  }

  const scheduler = Object.assign((pt: HoverPoint) => schedule(pt), {
    schedule,
    cancel,
    reset,
    isPending: () => rafId !== null,
    getLastPoint: () => lastProcessedPoint,
  });

  return scheduler;
}
