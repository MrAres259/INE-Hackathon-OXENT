export interface CameraPoint {
  lng: number;
  lat: number;
}

export interface CameraOptions {
  center: CameraPoint | { lng: number; lat: number } | [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface SyncableCamera {
  on(event: "move", listener: () => void): void;
  off(event: "move", listener: () => void): void;
  getCenter(): CameraPoint | { lng: number; lat: number } | [number, number];
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  jumpTo(options: CameraOptions): void;
}

export interface CameraSyncHandle {
  dispose(): void;
}

/**
 * Creates camera synchronization between two maps (A and B).
 * When one moves, it updates the camera of the other via jumpTo.
 * Uses an anti-reentrancy flag to prevent infinite loops.
 */
export function createCameraSync(
  a: SyncableCamera,
  b: SyncableCamera
): CameraSyncHandle {
  let isSyncing = false;

  const onMoveA = () => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      b.jumpTo({
        center: a.getCenter(),
        zoom: a.getZoom(),
        bearing: a.getBearing(),
        pitch: a.getPitch(),
      });
    } finally {
      isSyncing = false;
    }
  };

  const onMoveB = () => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      a.jumpTo({
        center: b.getCenter(),
        zoom: b.getZoom(),
        bearing: b.getBearing(),
        pitch: b.getPitch(),
      });
    } finally {
      isSyncing = false;
    }
  };

  a.on("move", onMoveA);
  b.on("move", onMoveB);

  return {
    dispose() {
      a.off("move", onMoveA);
      b.off("move", onMoveB);
    },
  };
}
