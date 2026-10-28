export const DWELL_MS = 140;
export const HIDE_DELAY_MS = 220;

export interface TooltipAnchor<T = any> {
  id: string;
  x: number;
  y: number;
  data?: T;
}

export interface TooltipIntentState<T = any> {
  active: TooltipAnchor<T> | null;
  pending: {
    anchor: TooltipAnchor<T>;
    dwellUntilMs: number;
  } | null;
  hideAtMs: number | null;
  isOverTooltip: boolean;
  isOverMap: boolean;
}

export type TooltipIntentEvent<T = any> =
  | { type: "hover"; id: string; x: number; y: number; data?: T }
  | { type: "leave" }
  | { type: "enterTooltip" }
  | { type: "leaveTooltip" }
  | { type: "tick" }
  | { type: "dragStart" }
  | { type: "guideOpen" };

export const initialTooltipIntentState: TooltipIntentState = {
  active: null,
  pending: null,
  hideAtMs: null,
  isOverTooltip: false,
  isOverMap: false,
};

export const tooltipIntent = {
  hover: <T>(id: string, x: number, y: number, data?: T): TooltipIntentEvent<T> => ({
    type: "hover",
    id,
    x,
    y,
    data,
  }),
  leave: (): TooltipIntentEvent => ({ type: "leave" }),
  enterTooltip: (): TooltipIntentEvent => ({ type: "enterTooltip" }),
  leaveTooltip: (): TooltipIntentEvent => ({ type: "leaveTooltip" }),
  tick: (): TooltipIntentEvent => ({ type: "tick" }),
  dragStart: (): TooltipIntentEvent => ({ type: "dragStart" }),
  guideOpen: (): TooltipIntentEvent => ({ type: "guideOpen" }),
};

export function reduceTooltipIntent<T = any>(
  state: TooltipIntentState<T>,
  event: TooltipIntentEvent<T>,
  nowMs: number = Date.now()
): TooltipIntentState<T> {
  switch (event.type) {
    case "guideOpen":
    case "dragStart": {
      return {
        ...state,
        active: null,
        pending: null,
        hideAtMs: null,
        isOverTooltip: false,
        isOverMap: false,
      };
    }

    case "enterTooltip": {
      return {
        ...state,
        isOverTooltip: true,
        pending: null,
        hideAtMs: null,
      };
    }

    case "leaveTooltip": {
      const hideAtMs = !state.isOverMap ? nowMs + HIDE_DELAY_MS : null;
      return {
        ...state,
        isOverTooltip: false,
        hideAtMs,
      };
    }

    case "leave": {
      const hideAtMs = !state.isOverTooltip ? nowMs + HIDE_DELAY_MS : null;
      return {
        ...state,
        isOverMap: false,
        pending: null,
        hideAtMs,
      };
    }

    case "hover": {
      const newAnchor: TooltipAnchor<T> = {
        id: event.id,
        x: event.x,
        y: event.y,
        data: event.data,
      };

      // If nothing active currently, activate immediately at entry point
      if (!state.active) {
        return {
          ...state,
          active: newAnchor,
          pending: null,
          hideAtMs: null,
          isOverMap: true,
        };
      }

      // If hovering within the SAME zone as currently active
      if (state.active.id === event.id) {
        return {
          ...state,
          // Keep the initial entry anchor position (x, y); optionally refresh data
          active: {
            ...state.active,
            data: event.data !== undefined ? event.data : state.active.data,
          },
          pending: null,
          hideAtMs: null,
          isOverMap: true,
        };
      }

      // If cursor is currently over tooltip, do not switch
      if (state.isOverTooltip) {
        return {
          ...state,
          isOverMap: true,
        };
      }

      // If already pending for this same candidate zone
      if (state.pending && state.pending.anchor.id === event.id) {
        if (nowMs >= state.pending.dwellUntilMs) {
          return {
            ...state,
            active: state.pending.anchor,
            pending: null,
            hideAtMs: null,
            isOverMap: true,
          };
        }
        return {
          ...state,
          isOverMap: true,
          hideAtMs: null,
        };
      }

      // It's a different zone and not pending for it yet: start dwell
      return {
        ...state,
        pending: {
          anchor: newAnchor,
          dwellUntilMs: nowMs + DWELL_MS,
        },
        hideAtMs: null,
        isOverMap: true,
      };
    }

    case "tick": {
      let nextState = state;

      // Handle pending dwell completion
      if (
        nextState.pending &&
        !nextState.isOverTooltip &&
        nowMs >= nextState.pending.dwellUntilMs
      ) {
        nextState = {
          ...nextState,
          active: nextState.pending.anchor,
          pending: null,
          hideAtMs: null,
        };
      }

      // Handle delayed hide completion
      if (
        nextState.hideAtMs !== null &&
        !nextState.isOverTooltip &&
        !nextState.isOverMap &&
        nowMs >= nextState.hideAtMs
      ) {
        nextState = {
          ...nextState,
          active: null,
          pending: null,
          hideAtMs: null,
        };
      }

      return nextState;
    }

    default:
      return state;
  }
}
