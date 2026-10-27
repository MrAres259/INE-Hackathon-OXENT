export type ToastKind = "success" | "error";

export interface ToastPayload {
  id?: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  durationMs?: number;
}

export interface ToastItem extends ToastPayload {
  id: string;
}

type ToastListener = (toasts: ToastItem[]) => void;

let currentToasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  const snapshot = [...currentToasts];
  listeners.forEach((fn) => fn(snapshot));
}

export function getToasts(): ToastItem[] {
  return [...currentToasts];
}

export function showToast(payload: ToastPayload): string {
  const id = payload.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const durationMs = payload.durationMs ?? 3500;
  const item: ToastItem = {
    ...payload,
    id,
    durationMs,
  };

  const next = [...currentToasts, item];
  currentToasts = next.length > 2 ? next.slice(-2) : next;
  notify();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("atalaya:toast", { detail: item }));
  }

  setTimeout(() => {
    dismissToast(id);
  }, durationMs);

  return id;
}

export function dismissToast(id: string) {
  if (!currentToasts.some((t) => t.id === id)) return;
  currentToasts = currentToasts.filter((t) => t.id !== id);
  notify();
}

export function clearToasts() {
  currentToasts = [];
  notify();
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...currentToasts]);
  return () => {
    listeners.delete(listener);
  };
}
