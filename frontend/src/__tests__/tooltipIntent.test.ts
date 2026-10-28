import { describe, it, expect } from "vitest";
import {
  reduceTooltipIntent,
  initialTooltipIntentState,
  tooltipIntent,
  DWELL_MS,
  HIDE_DELAY_MS,
  type TooltipIntentState,
} from "../lib/tooltipIntent";

describe("Tooltip Intent State Machine (tooltipIntent.test.ts)", () => {
  it("ancla estable con 20 movimientos dentro de la misma zona", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    // First hover enters zone "01" at (100, 150)
    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 150), 0);

    expect(state.active).toEqual({
      id: "01",
      x: 100,
      y: 150,
      data: undefined,
    });
    expect(state.pending).toBeNull();
    expect(state.hideAtMs).toBeNull();
    expect(state.isOverMap).toBe(true);

    // 20 subsequent hover movements inside the same zone "01"
    for (let i = 1; i <= 20; i++) {
      const x = 100 + i * 3;
      const y = 150 + i * 2;
      const nowMs = i * 15;
      state = reduceTooltipIntent(state, tooltipIntent.hover("01", x, y), nowMs);

      // Anchor MUST remain the point of entry (100, 150)
      expect(state.active?.id).toBe("01");
      expect(state.active?.x).toBe(100);
      expect(state.active?.y).toBe(150);
      expect(state.pending).toBeNull();
      expect(state.hideAtMs).toBeNull();
    }
  });

  it("cambio solo tras dwell", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    // Start in zone "01" at t=0
    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    expect(state.active?.id).toBe("01");

    // Move to zone "02" at t=100ms
    state = reduceTooltipIntent(state, tooltipIntent.hover("02", 200, 200), 100);

    // Active remains zone "01" because dwell (140ms) has not passed yet
    expect(state.active?.id).toBe("01");
    expect(state.active?.x).toBe(100);
    expect(state.active?.y).toBe(100);
    expect(state.pending?.anchor.id).toBe("02");
    expect(state.pending?.anchor.x).toBe(200);
    expect(state.pending?.anchor.y).toBe(200);
    expect(state.pending?.dwellUntilMs).toBe(100 + DWELL_MS); // 240ms

    // Movement inside zone "02" before dwell (t=180ms)
    state = reduceTooltipIntent(state, tooltipIntent.hover("02", 210, 210), 180);
    expect(state.active?.id).toBe("01");
    // Pending entry anchor remains (200, 200)
    expect(state.pending?.anchor.x).toBe(200);

    // Tick before dwell (t=239ms)
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 239);
    expect(state.active?.id).toBe("01");
    expect(state.pending).not.toBeNull();

    // Dwell completes at t=240ms
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 240);
    expect(state.active?.id).toBe("02");
    expect(state.active?.x).toBe(200);
    expect(state.active?.y).toBe(200);
    expect(state.pending).toBeNull();
  });

  it("entrar al tooltip cancela el cambio", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    // Active on zone "01"
    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);

    // Cross into zone "02" en route to tooltip at t=100
    state = reduceTooltipIntent(state, tooltipIntent.hover("02", 200, 200), 100);
    expect(state.pending?.anchor.id).toBe("02");

    // Cursor enters tooltip before dwell expires at t=160 (160 < 240)
    state = reduceTooltipIntent(state, tooltipIntent.enterTooltip(), 160);
    expect(state.isOverTooltip).toBe(true);
    expect(state.pending).toBeNull(); // Pending change is cancelled!
    expect(state.active?.id).toBe("01"); // Still zone "01"

    // Even well after dwell would have passed (t=350ms)
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 350);
    expect(state.active?.id).toBe("01");
    expect(state.pending).toBeNull();
  });

  it("salida con retardo", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    expect(state.active).not.toBeNull();

    // Cursor leaves map at t=100
    state = reduceTooltipIntent(state, tooltipIntent.leave(), 100);
    expect(state.isOverMap).toBe(false);
    expect(state.hideAtMs).toBe(100 + HIDE_DELAY_MS); // 320ms
    // Tooltip is NOT hidden immediately
    expect(state.active?.id).toBe("01");

    // At t=200ms (< 320ms)
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 200);
    expect(state.active?.id).toBe("01");

    // At t=320ms (delayed hide expires)
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 320);
    expect(state.active).toBeNull();
    expect(state.hideAtMs).toBeNull();
  });

  it("drag oculta", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    expect(state.active).not.toBeNull();

    // Map drag begins
    state = reduceTooltipIntent(state, tooltipIntent.dragStart(), 50);
    expect(state.active).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.hideAtMs).toBeNull();
  });

  it("guideOpen oculta", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    expect(state.active).not.toBeNull();

    // Interactive guide opens
    state = reduceTooltipIntent(state, tooltipIntent.guideOpen(), 50);
    expect(state.active).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.hideAtMs).toBeNull();
  });

  it("re-enter map cancels scheduled hide", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    state = reduceTooltipIntent(state, tooltipIntent.leave(), 100);
    expect(state.hideAtMs).toBe(320);

    // Re-enter zone "01" at t=150ms
    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 105, 105), 150);
    expect(state.hideAtMs).toBeNull();
    expect(state.active?.id).toBe("01");
    expect(state.active?.x).toBe(100); // Anchor remains original

    // At t=400ms it stays visible
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 400);
    expect(state.active?.id).toBe("01");
  });

  it("leaveTooltip triggers delayed hide if not over map", () => {
    let state: TooltipIntentState = initialTooltipIntentState;

    state = reduceTooltipIntent(state, tooltipIntent.hover("01", 100, 100), 0);
    state = reduceTooltipIntent(state, tooltipIntent.leave(), 50);
    state = reduceTooltipIntent(state, tooltipIntent.enterTooltip(), 100);
    expect(state.hideAtMs).toBeNull();

    // Cursor leaves tooltip at t=200
    state = reduceTooltipIntent(state, tooltipIntent.leaveTooltip(), 200);
    expect(state.isOverTooltip).toBe(false);
    expect(state.hideAtMs).toBe(200 + HIDE_DELAY_MS); // 420ms
    expect(state.active?.id).toBe("01");

    // Hide expires at t=420ms
    state = reduceTooltipIntent(state, tooltipIntent.tick(), 420);
    expect(state.active).toBeNull();
  });
});
