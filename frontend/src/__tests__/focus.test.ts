import { describe, it, expect } from "vitest";
import { resolveFocusEnt, entFromFeature } from "@/lib/focus";

describe("focus module", () => {
  describe("resolveFocusEnt", () => {
    it("la selección manda: returns selectedEnt when present, overriding center and previous", () => {
      // Selection rules over center and previous
      const focus1 = resolveFocusEnt({
        selectedEnt: "14",
        zoom: 6.5,
        centerEnt: "09",
        previous: "15",
      });
      expect(focus1).toBe("14");

      // Selection rules even if zoom is low or high
      const focus2 = resolveFocusEnt({
        selectedEnt: "07",
        zoom: 4.0,
        centerEnt: "14",
        previous: null,
      });
      expect(focus2).toBe("07");
    });

    it("zoom < 5.5 ⇒ null: returns null when no state is selected and zoom is below 5.5", () => {
      // National level zoom (e.g. 4.3, 5.0, 5.49)
      expect(
        resolveFocusEnt({
          zoom: 4.3,
          centerEnt: "14",
          previous: "14",
        })
      ).toBeNull();

      expect(
        resolveFocusEnt({
          selectedEnt: null,
          zoom: 5.49,
          centerEnt: "09",
          previous: "09",
        })
      ).toBeNull();

      expect(
        resolveFocusEnt({
          selectedEnt: "",
          zoom: 3.5,
          centerEnt: "15",
          previous: null,
        })
      ).toBeNull();
    });

    it("centro en un estado ⇒ ese: returns centerEnt when zoom >= 5.5 and centerEnt is present", () => {
      const focusAtBoundary = resolveFocusEnt({
        zoom: 5.5,
        centerEnt: "14",
        previous: "09",
      });
      expect(focusAtBoundary).toBe("14");

      const focusZoomedIn = resolveFocusEnt({
        zoom: 7.2,
        centerEnt: "09",
        previous: "14",
      });
      expect(focusZoomedIn).toBe("09");
    });

    it("centro en el mar ⇒ conserva el anterior: returns previous when center is null/undefined", () => {
      // Center over sea / outside state boundaries
      expect(
        resolveFocusEnt({
          zoom: 6.0,
          centerEnt: null,
          previous: "14",
        })
      ).toBe("14");

      expect(
        resolveFocusEnt({
          zoom: 7.0,
          centerEnt: undefined,
          previous: "09",
        })
      ).toBe("09");

      expect(
        resolveFocusEnt({
          zoom: 8.0,
          centerEnt: "",
          previous: "15",
        })
      ).toBe("15");

      // When both center and previous are absent, returns null
      expect(
        resolveFocusEnt({
          zoom: 6.0,
          centerEnt: null,
          previous: null,
        })
      ).toBeNull();
    });
  });

  describe("entFromFeature", () => {
    it("reads properties.ent directly", () => {
      expect(entFromFeature({ properties: { ent: "14" } })).toBe("14");
      expect(entFromFeature({ properties: { ent: "09", name: "CDMX" } })).toBe("09");
      expect(entFromFeature({ properties: { ent: 9 } })).toBe("09");
      expect(entFromFeature({ properties: { ent: "7" } })).toBe("07");
    });

    it("reads first 2 digits from 5-digit municipal id", () => {
      expect(entFromFeature({ id: "14039" })).toBe("14");
      expect(entFromFeature({ id: "07101" })).toBe("07");
      expect(entFromFeature({ id: 14039 })).toBe("14");
      expect(entFromFeature({ properties: { id: "15001" } })).toBe("15");
    });

    it("reads 2-digit state id directly", () => {
      expect(entFromFeature({ id: "09" })).toBe("09");
      expect(entFromFeature({ id: "14" })).toBe("14");
    });

    it("returns null when feature or identifiers are missing or empty", () => {
      expect(entFromFeature(null)).toBeNull();
      expect(entFromFeature(undefined)).toBeNull();
      expect(entFromFeature({})).toBeNull();
      expect(entFromFeature({ properties: {} })).toBeNull();
      expect(entFromFeature({ properties: { ent: "" } })).toBeNull();
    });
  });
});
