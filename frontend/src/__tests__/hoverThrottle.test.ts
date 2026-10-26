import { describe, it, expect, vi } from "vitest";
import { createHoverScheduler, type HoverPoint } from "@/lib/hoverThrottle";

describe("hoverThrottle", () => {
  it("executes callback on RAF for the first scheduled point", () => {
    let queuedCb: (() => void) | null = null;
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      return 1;
    };
    const mockCancelRaf = vi.fn();

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, {
      raf: mockRaf,
      cancelRaf: mockCancelRaf,
      minMovePx: 3,
    });

    const accepted = scheduler.schedule({ x: 10, y: 10 });
    expect(accepted).toBe(true);
    expect(scheduler.isPending()).toBe(true);
    expect(run).not.toHaveBeenCalled();

    // Trigger RAF
    queuedCb!();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ x: 10, y: 10 });
    expect(scheduler.isPending()).toBe(false);
    expect(scheduler.getLastPoint()).toEqual({ x: 10, y: 10 });
  });

  it("discards movements below minMovePx distance", () => {
    let queuedCb: (() => void) | null = null;
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      return 1;
    };

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, {
      raf: mockRaf,
      minMovePx: 3,
    });

    scheduler.schedule({ x: 100, y: 100 });
    queuedCb!();
    expect(run).toHaveBeenCalledWith({ x: 100, y: 100 });

    // Move by dx=1, dy=1 -> dist = sqrt(2) ≈ 1.41 < 3
    const accepted = scheduler.schedule({ x: 101, y: 101 });
    expect(accepted).toBe(false);
    expect(scheduler.isPending()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    // Move by dx=2, dy=2 -> dist = sqrt(8) ≈ 2.83 < 3
    const accepted2 = scheduler.schedule({ x: 102, y: 102 });
    expect(accepted2).toBe(false);
    expect(scheduler.isPending()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    // Move by dx=3, dy=0 -> dist = 3 >= 3
    const accepted3 = scheduler.schedule({ x: 103, y: 100 });
    expect(accepted3).toBe(true);
    expect(scheduler.isPending()).toBe(true);
    queuedCb!();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({ x: 103, y: 100 });
  });

  it("coalesces multiple events in the same frame to the latest point", () => {
    let queuedCb: (() => void) | null = null;
    let rafCallCount = 0;
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      rafCallCount++;
      return rafCallCount;
    };

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, {
      raf: mockRaf,
      minMovePx: 3,
    });

    // Initial point
    scheduler.schedule({ x: 0, y: 0 });
    queuedCb!();

    // 5 rapid movements before RAF fires
    scheduler.schedule({ x: 10, y: 10 });
    scheduler.schedule({ x: 20, y: 20 });
    scheduler.schedule({ x: 30, y: 30 });
    scheduler.schedule({ x: 40, y: 40 });
    const acceptedLast = scheduler.schedule({ x: 50, y: 50 });

    expect(acceptedLast).toBe(true);
    // RAF should have been called only once for this batch
    expect(rafCallCount).toBe(2); // 1 initial + 1 for batch
    expect(run).toHaveBeenCalledTimes(1); // Only initial run so far

    // Fire the queued RAF
    queuedCb!();
    expect(run).toHaveBeenCalledTimes(2);
    // Must be called with the coalesced latest point
    expect(run).toHaveBeenLastCalledWith({ x: 50, y: 50 });
  });

  it("cancels pending execution and clears state", () => {
    let queuedCb: (() => void) | null = null;
    const mockCancelRaf = vi.fn();
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      return 42;
    };

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, {
      raf: mockRaf,
      cancelRaf: mockCancelRaf,
    });

    scheduler.schedule({ x: 10, y: 20 });
    expect(scheduler.isPending()).toBe(true);

    scheduler.cancel();
    expect(mockCancelRaf).toHaveBeenCalledWith(42);
    expect(scheduler.isPending()).toBe(false);
    expect(scheduler.getLastPoint()).toBeNull();

    // Even if queuedCb was somehow invoked, run should not fire
    if (typeof queuedCb === "function") {
      (queuedCb as () => void)();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reset clears pending RAF and resets last position so subsequent identical point is accepted", () => {
    let queuedCb: (() => void) | null = null;
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      return 1;
    };

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, { raf: mockRaf });

    scheduler({ x: 10, y: 10 });
    queuedCb!();
    expect(run).toHaveBeenCalledWith({ x: 10, y: 10 });

    scheduler.reset();
    expect(scheduler.getLastPoint()).toBeNull();

    // Submitting the same point again should now be accepted because lastPoint was cleared
    const accepted = scheduler({ x: 10, y: 10 });
    expect(accepted).toBe(true);
    queuedCb!();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("works when invoked directly as a callable function", () => {
    let queuedCb: (() => void) | null = null;
    const mockRaf = (cb: () => void) => {
      queuedCb = cb;
      return 1;
    };

    const run = vi.fn();
    const scheduler = createHoverScheduler(run, { raf: mockRaf });

    const ok = scheduler({ x: 5, y: 5 });
    expect(ok).toBe(true);
    queuedCb!();
    expect(run).toHaveBeenCalledWith({ x: 5, y: 5 });
  });
});
