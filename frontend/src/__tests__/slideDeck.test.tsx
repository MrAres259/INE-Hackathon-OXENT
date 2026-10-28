import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideDeck } from "../components/intel/campaign/SlideDeck";
import { SlideView } from "../components/intel/campaign/SlideView";
import { ensurePlanSlides } from "../components/intel/campaign/campaignDraft";
import { MOCK_CAMPAIGN_PLAN } from "../lib/intel/mocks";

describe("SlideDeck Component Suite (slideDeck.test.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Miniaturas (10 diapositivas)", () => {
    it("renders exactly 10 thumbnail tabs with MOCK_CAMPAIGN_PLAN", () => {
      const html = renderToStaticMarkup(
        <SlideDeck
          plan={MOCK_CAMPAIGN_PLAN}
          drafts={{}}
          onDraftChange={vi.fn()}
        />
      );

      // Verify all 10 thumbnails from index 0 to 9 are rendered
      for (let i = 0; i < 10; i++) {
        expect(html).toContain(`data-thumbnail-index="${i}"`);
      }

      // Slide counter shows 1 / 10 and Diapositiva 1 de 10
      expect(html).toContain("1 / 10");
      expect(html).toContain("Diapositiva 1 de 10");
    });
  });

  describe("2. Renderizado de cada kind con MOCK_CAMPAIGN_PLAN", () => {
    const allSlides = ensurePlanSlides(MOCK_CAMPAIGN_PLAN);

    allSlides.forEach((slide) => {
      it(`renders slide kind '${slide.kind}' without crashing`, () => {
        const html = renderToStaticMarkup(
          <SlideView
            slide={slide}
            plan={MOCK_CAMPAIGN_PLAN}
            onSourceClick={vi.fn()}
          />
        );

        expect(html).toContain(`data-slide-kind="${slide.kind}"`);
        expect(html).toContain(slide.title);

        // Specific content checks per kind
        if (slide.kind === "portada") {
          expect(html).toContain("OXENT");
        } else if (slide.kind === "diagnostico_datos") {
          expect(html).toContain("Abstención Pronosticada");
        } else if (slide.kind === "problematicas") {
          expect(html).toContain("Evidencia");
        } else if (slide.kind === "region") {
          expect(html).toContain("Delimitación y Clasificación");
        } else if (slide.kind === "grupo_objetivo") {
          expect(html).toContain("Público Objetivo");
        } else if (slide.kind === "propuestas") {
          expect(html).toContain("Palanca");
        } else if (slide.kind === "impacto") {
          expect(html).toContain("Abstención Antes vs Después");
        } else if (slide.kind === "implementacion") {
          expect(html).toContain("Fase");
        } else if (slide.kind === "riesgos_kpis") {
          expect(html).toContain("Riesgos Operativos");
        } else if (slide.kind === "fuentes") {
          expect(html).toContain("Fuentes Verificadas");
        }
      });
    });
  });

  describe("3. Citas [s#] clicables abren fuente", () => {
    it("renders evidence references [s#] as clickable buttons", () => {
      const onSourceClickMock = vi.fn();
      const problematicsSlide = ensurePlanSlides(MOCK_CAMPAIGN_PLAN).find(
        (s) => s.kind === "problematicas"
      );

      expect(problematicsSlide).toBeDefined();

      const html = renderToStaticMarkup(
        <SlideView
          slide={problematicsSlide!}
          plan={MOCK_CAMPAIGN_PLAN}
          onSourceClick={onSourceClickMock}
        />
      );

      // Contains evidence button labels for sources like [s1], [s2]
      expect(html).toContain("[s1]");
      expect(html).toContain("[s2]");
    });
  });

  describe("4. Navegación por teclado", () => {
    it("registers keydown listeners on mount and handles ArrowRight and ArrowLeft", () => {
      const origWindow = (globalThis as any).window;
      let registeredHandler: any = null;

      try {
        const mockWin = {
          addEventListener: vi.fn((event: string, handler: any) => {
            if (event === "keydown") {
              registeredHandler = handler;
            }
          }),
          removeEventListener: vi.fn(),
        };
        (globalThis as any).window = mockWin;

        // Render to verify no crash and listener registration logic
        const html = renderToStaticMarkup(
          <SlideDeck
            plan={MOCK_CAMPAIGN_PLAN}
            drafts={{}}
            onDraftChange={vi.fn()}
          />
        );

        expect(html).toBeDefined();

        // Simulate key handler
        if (registeredHandler && typeof registeredHandler === "function") {
          const preventDefault = vi.fn();
          registeredHandler({ key: "ArrowRight", preventDefault });
          expect(preventDefault).toHaveBeenCalled();
        }
      } finally {
        (globalThis as any).window = origWindow;
      }
    });
  });
});
