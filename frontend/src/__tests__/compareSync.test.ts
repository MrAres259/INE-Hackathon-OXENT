import { describe, it, expect, vi } from "vitest";
import {
  createCameraSync,
  type SyncableCamera,
  type CameraOptions,
} from "../components/map/compareSync";

class FakeMap implements SyncableCamera {
  private listeners: Record<string, (() => void)[]> = {};
  public center = { lng: -99.1332, lat: 19.4326 };
  public zoom = 5;
  public bearing = 0;
  public pitch = 0;
  public jumpToCalls: CameraOptions[] = [];

  on(event: "move", listener: () => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  off(event: "move", listener: () => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
  }

  getCenter() {
    return this.center;
  }

  getZoom(): number {
    return this.zoom;
  }

  getBearing(): number {
    return this.bearing;
  }

  getPitch(): number {
    return this.pitch;
  }

  jumpTo(options: CameraOptions): void {
    this.jumpToCalls.push(options);
    if ("lng" in options.center && "lat" in options.center) {
      this.center = options.center;
    }
    this.zoom = options.zoom;
    this.bearing = options.bearing;
    this.pitch = options.pitch;
    // MapLibre fires 'move' synchronously or asynchronously on camera change:
    this.fire("move");
  }

  fire(event: "move"): void {
    const handlers = [...(this.listeners[event] || [])];
    for (const handler of handlers) {
      handler();
    }
  }

  getListenerCount(event: "move"): number {
    return (this.listeners[event] || []).length;
  }
}

describe("createCameraSync", () => {
  it("syncs B when A moves without infinite recursion", () => {
    const mapA = new FakeMap();
    const mapB = new FakeMap();

    const sync = createCameraSync(mapA, mapB);

    // Initial state: no jumps
    expect(mapA.jumpToCalls.length).toBe(0);
    expect(mapB.jumpToCalls.length).toBe(0);

    // Simulate user moving A
    mapA.center = { lng: -100.5, lat: 25.5 };
    mapA.zoom = 7.5;
    mapA.bearing = 15;
    mapA.pitch = 30;
    mapA.fire("move");

    // B should have received jumpTo with A's new coordinates
    expect(mapB.jumpToCalls.length).toBe(1);
    expect(mapB.jumpToCalls[0]).toEqual({
      center: { lng: -100.5, lat: 25.5 },
      zoom: 7.5,
      bearing: 15,
      pitch: 30,
    });
    expect(mapB.center).toEqual({ lng: -100.5, lat: 25.5 });
    expect(mapB.zoom).toBe(7.5);
    expect(mapB.bearing).toBe(15);
    expect(mapB.pitch).toBe(30);

    // Crucially, B's jumpTo fired 'move' on B, but anti-reentrancy prevented A from jumping
    expect(mapA.jumpToCalls.length).toBe(0);

    sync.dispose();
  });

  it("syncs A when B moves without infinite recursion", () => {
    const mapA = new FakeMap();
    const mapB = new FakeMap();

    const sync = createCameraSync(mapA, mapB);

    // Simulate user moving B
    mapB.center = { lng: -96.1, lat: 15.8 };
    mapB.zoom = 8.0;
    mapB.bearing = 45;
    mapB.pitch = 60;
    mapB.fire("move");

    // A should have received jumpTo with B's new coordinates
    expect(mapA.jumpToCalls.length).toBe(1);
    expect(mapA.jumpToCalls[0]).toEqual({
      center: { lng: -96.1, lat: 15.8 },
      zoom: 8.0,
      bearing: 45,
      pitch: 60,
    });
    expect(mapA.center).toEqual({ lng: -96.1, lat: 15.8 });
    expect(mapA.zoom).toBe(8.0);

    // B did not jump back
    expect(mapB.jumpToCalls.length).toBe(0);

    sync.dispose();
  });

  it("dispose() unregisters all event listeners", () => {
    const mapA = new FakeMap();
    const mapB = new FakeMap();

    expect(mapA.getListenerCount("move")).toBe(0);
    expect(mapB.getListenerCount("move")).toBe(0);

    const sync = createCameraSync(mapA, mapB);
    expect(mapA.getListenerCount("move")).toBe(1);
    expect(mapB.getListenerCount("move")).toBe(1);

    sync.dispose();
    expect(mapA.getListenerCount("move")).toBe(0);
    expect(mapB.getListenerCount("move")).toBe(0);

    // Moving after dispose does nothing
    mapA.center = { lng: -105.0, lat: 20.0 };
    mapA.fire("move");
    expect(mapB.jumpToCalls.length).toBe(0);
  });

  it("safe to call dispose multiple times", () => {
    const mapA = new FakeMap();
    const mapB = new FakeMap();
    const sync = createCameraSync(mapA, mapB);
    sync.dispose();
    expect(() => sync.dispose()).not.toThrow();
  });
});

