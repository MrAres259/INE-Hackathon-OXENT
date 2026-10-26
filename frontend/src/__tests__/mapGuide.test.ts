import { describe, it, expect, vi } from "vitest";
import {
  shouldShowGuide,
  dismissGuide,
  GUIDE_STORAGE_KEY,
} from "../components/map/MapGuide";

describe("MapGuide Pure Storage Logic (mapGuide.test.ts)", () => {
  it("exports the expected storage key 'atalaya.guide.v1'", () => {
    expect(GUIDE_STORAGE_KEY).toBe("atalaya.guide.v1");
  });

  describe("shouldShowGuide", () => {
    it("returns true when storage is empty (getItem returns null)", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn((key: string) => {
          expect(key).toBe(GUIDE_STORAGE_KEY);
          return null;
        }),
      };
      expect(shouldShowGuide(mockStorage)).toBe(true);
      expect(mockStorage.getItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY);
    });

    it("returns true when storage has empty string", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => ""),
      };
      expect(shouldShowGuide(mockStorage)).toBe(true);
    });

    it("returns false when the key is already stored ('1')", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn((key: string) => (key === GUIDE_STORAGE_KEY ? "1" : null)),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when the key is already stored with any value ('true')", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => "true"),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when getItem throws an exception (e.g. SecurityError or private browsing)", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: localStorage is disabled");
        }),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when storage is null", () => {
      expect(shouldShowGuide(null)).toBe(false);
    });

    it("returns false when storage is undefined", () => {
      expect(shouldShowGuide(undefined)).toBe(false);
    });
  });

  describe("dismissGuide", () => {
    it("writes '1' to GUIDE_STORAGE_KEY in storage", () => {
      const mockStorage: Pick<Storage, "setItem"> = {
        setItem: vi.fn(),
      };
      dismissGuide(mockStorage);
      expect(mockStorage.setItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY, "1");
    });

    it("catches and ignores exceptions if setItem throws (e.g. QuotaExceededError)", () => {
      const mockStorage: Pick<Storage, "setItem"> = {
        setItem: vi.fn(() => {
          throw new Error("QuotaExceededError");
        }),
      };
      expect(() => dismissGuide(mockStorage)).not.toThrow();
      expect(mockStorage.setItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY, "1");
    });

    it("safely handles null storage without throwing", () => {
      expect(() => dismissGuide(null)).not.toThrow();
    });

    it("safely handles being called with no arguments when window is undefined/mocked", () => {
      expect(() => dismissGuide()).not.toThrow();
    });
  });
});
