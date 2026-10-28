import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDrafts,
  saveDrafts,
  clearDrafts,
  updateSlideDraft,
  restoreSlideDraft,
  isSlideEdited,
  isPlanEdited,
  applyDraftToSlide,
  applyDraftsToSlides,
  buildExportSlidesOverride,
  ensurePlanSlides,
  _resetMemoryDrafts,
} from "../components/intel/campaign/campaignDraft";
import { MOCK_CAMPAIGN_PLAN } from "../lib/intel/mocks";
import type { Slide } from "../lib/intel/types";

describe("Campaign Draft Suite (campaignDraft.test.ts)", () => {
  const planId = "plan_test_123";

  beforeEach(() => {
    _resetMemoryDrafts();
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.clear();
      }
    } catch {
      // Fallback
    }
  });

  describe("1. Editar diapositivas", () => {
    it("detects when a slide has been edited vs original", () => {
      const origSlide: Slide = {
        id: "s1",
        kind: "portada",
        title: "Título Original",
        subtitle: "Subtítulo Original",
        bullets: ["Viñeta 1", "Viñeta 2"],
        notes: "Notas originales",
        data: { kpi: 100 },
      };

      expect(isSlideEdited(origSlide, undefined)).toBe(false);
      expect(isSlideEdited(origSlide, {})).toBe(false);

      // Same content
      expect(
        isSlideEdited(origSlide, {
          title: "Título Original",
          subtitle: "Subtítulo Original",
          bullets: ["Viñeta 1", "Viñeta 2"],
          notes: "Notas originales",
        })
      ).toBe(false);

      // Modified title
      expect(isSlideEdited(origSlide, { title: "Nuevo Título" })).toBe(true);

      // Modified subtitle
      expect(isSlideEdited(origSlide, { subtitle: "Nuevo Subtítulo" })).toBe(true);

      // Modified bullets
      expect(isSlideEdited(origSlide, { bullets: ["Viñeta 1"] })).toBe(true);

      // Modified notes
      expect(isSlideEdited(origSlide, { notes: "Nuevas notas del orador" })).toBe(true);
    });

    it("applies edits to slide while strictly preserving non-editable data and id", () => {
      const origSlide: Slide = {
        id: "s2",
        kind: "diagnostico_datos",
        title: "Diagnóstico",
        subtitle: null,
        bullets: ["Dato 1"],
        notes: "Nota base",
        data: { abstencion: 44.2, kpis: [{ label: "Base", value: "44.2%" }] },
      };

      const edited = applyDraftToSlide(origSlide, {
        title: "Diagnóstico Territorial Actualizado",
        subtitle: "Enfoque regional",
        bullets: ["Dato 1", "Nueva viñeta"],
        notes: "Notas actualizadas",
      });

      expect(edited.id).toBe("s2");
      expect(edited.kind).toBe("diagnostico_datos");
      expect(edited.title).toBe("Diagnóstico Territorial Actualizado");
      expect(edited.subtitle).toBe("Enfoque regional");
      expect(edited.bullets).toEqual(["Dato 1", "Nueva viñeta"]);
      expect(edited.notes).toBe("Notas actualizadas");
      // Data figures are preserved intact
      expect(edited.data).toEqual(origSlide.data);
    });

    it("updates drafts via updateSlideDraft and marks plan as edited", () => {
      const drafts = updateSlideDraft(planId, "s1", {
        title: "Plan Estratégico Modificado",
      });

      expect(drafts["s1"]).toBeDefined();
      expect(drafts["s1"].title).toBe("Plan Estratégico Modificado");
      expect(isPlanEdited(MOCK_CAMPAIGN_PLAN, drafts)).toBe(true);
    });
  });

  describe("2. Restaurar original", () => {
    it("restores a single slide draft using restoreSlideDraft", () => {
      updateSlideDraft(planId, "s1", { title: "Modificado" });
      updateSlideDraft(planId, "s2", { notes: "Nota modificada" });

      const afterRestoreS1 = restoreSlideDraft(planId, "s1");
      expect(afterRestoreS1["s1"]).toBeUndefined();
      expect(afterRestoreS1["s2"]).toBeDefined();

      const origS1 = ensurePlanSlides(MOCK_CAMPAIGN_PLAN).find((s) => s.id === "s1");
      if (origS1) {
        expect(isSlideEdited(origS1, afterRestoreS1["s1"])).toBe(false);
      }
    });

    it("clears all drafts using clearDrafts", () => {
      updateSlideDraft(planId, "s1", { title: "Modificado 1" });
      updateSlideDraft(planId, "s2", { title: "Modificado 2" });

      clearDrafts(planId);
      const drafts = getDrafts(planId);
      expect(drafts).toEqual({});
      expect(isPlanEdited(MOCK_CAMPAIGN_PLAN, drafts)).toBe(false);
    });
  });

  describe("3. Persistencia tolerante a fallos", () => {
    it("handles corrupted JSON in localStorage gracefully without throwing", () => {
      try {
        localStorage.setItem(`atalaya_campaign_draft_${planId}`, "MALFORMED_JSON{{{");
      } catch {
        // ignore
      }

      const drafts = getDrafts(planId);
      expect(drafts).toEqual({});
    });

    it("handles storage exceptions (e.g. quota exceeded) silently", () => {
      const origStorage = (globalThis as any).localStorage;
      try {
        (globalThis as any).localStorage = {
          getItem: vi.fn(),
          setItem: vi.fn().mockImplementation(() => {
            throw new Error("QuotaExceededError: storage is full");
          }),
          removeItem: vi.fn(),
        };

        // Should not crash when storage throws on setItem
        expect(() => {
          saveDrafts(planId, { s1: { title: "Test" } });
        }).not.toThrow();
      } finally {
        (globalThis as any).localStorage = origStorage;
      }
    });

    it("handles empty or null plan IDs gracefully", () => {
      expect(getDrafts("")).toEqual({});
      expect(() => saveDrafts("", {})).not.toThrow();
      expect(() => clearDrafts("")).not.toThrow();
    });
  });

  describe("4. Override para exportación", () => {
    it("returns null when plan has no edits", () => {
      const override = buildExportSlidesOverride(MOCK_CAMPAIGN_PLAN, {});
      expect(override).toBeNull();
    });

    it("returns slides array with updated fields when edits exist", () => {
      const drafts = {
        s1: {
          title: "Título de Portada Personalizado",
          bullets: ["Punto 1 personalizado"],
        },
      };

      const override = buildExportSlidesOverride(MOCK_CAMPAIGN_PLAN, drafts);
      expect(override).not.toBeNull();
      expect(Array.isArray(override)).toBe(true);

      const modifiedS1 = override?.find((s) => s.id === "s1");
      expect(modifiedS1?.title).toBe("Título de Portada Personalizado");
      expect(modifiedS1?.bullets).toEqual(["Punto 1 personalizado"]);

      // Unmodified slides maintain original properties
      const s2 = override?.find((s) => s.id === "s2");
      const origS2 = ensurePlanSlides(MOCK_CAMPAIGN_PLAN).find((s) => s.id === "s2");
      expect(s2?.title).toBe(origS2?.title);
    });
  });

  describe("5. Síntesis de 10 diapositivas canónicas (ensurePlanSlides)", () => {
    it("ensures all 10 slide kinds are present even with partial input", () => {
      const slides = ensurePlanSlides(MOCK_CAMPAIGN_PLAN);
      expect(slides.length).toBe(10);

      const kinds = slides.map((s) => s.kind);
      expect(kinds).toContain("portada");
      expect(kinds).toContain("diagnostico_datos");
      expect(kinds).toContain("problematicas");
      expect(kinds).toContain("region");
      expect(kinds).toContain("grupo_objetivo");
      expect(kinds).toContain("propuestas");
      expect(kinds).toContain("impacto");
      expect(kinds).toContain("implementacion");
      expect(kinds).toContain("riesgos_kpis");
      expect(kinds).toContain("fuentes");
    });
  });
});
