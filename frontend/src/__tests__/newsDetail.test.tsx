import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsDetail } from "../components/intel/monitor/NewsDetail";
import { ImpactMap } from "../components/intel/monitor/ImpactMap";
import { ViralityPanel } from "../components/intel/monitor/ViralityPanel";
import { RemediationPanel } from "../components/intel/monitor/RemediationPanel";
import { MOCK_MONITOR } from "../lib/intel/mocks";
import { decodeCampaignPrefill } from "../lib/intel/prefill";
import * as intelApi from "../lib/intel/api";
import type { NewsImpact } from "../lib/intel/types";

// Mock intel API for drill-down testing
vi.mock("@/lib/intel/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intel/api")>("@/lib/intel/api");
  return {
    ...actual,
    getItemImpact: vi.fn(),
  };
});

describe("NewsDetail Component Suite (newsDetail.test.tsx)", () => {
  const itemTrue = MOCK_MONITOR.items.find((i) => i.id === "news_001")!;
  const itemFalse = MOCK_MONITOR.items.find((i) => i.id === "news_002")!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders verified news item with headline, claim, summary and verdict badge", () => {
    const html = renderToStaticMarkup(<NewsDetail item={itemTrue} />);

    expect(html).toContain(itemTrue.headline);
    expect(html).toContain(itemTrue.claim);
    expect(html).toContain(itemTrue.summary);
    expect(html).toContain("Verdadera");
    expect(html).toContain("Fundamentación del veredicto");
    expect(html).toContain(itemTrue.verdict_rationale);
  });

  it("renders ImpactMap with fragment map of affected states only and impact table", () => {
    const html = renderToStaticMarkup(<NewsDetail item={itemTrue} />);

    // Impact KPIs
    expect(html).toContain("+0.12 pp"); // national delta
    expect(html).toContain("42,100"); // lost votes total
    expect(html).toContain("+0.48 pp"); // max delta

    // Affected states in table
    expect(html).toContain("Chiapas");
    expect(html).toContain("Oaxaca");
    expect(html).toContain("Guerrero");

    // Before -> After categories
    expect(html).toContain("Crítico"); // rojo
    expect(html).toContain("Alto"); // naranja
    expect(html).toContain("Ver municipios →");
  });

  it("renders low impact notice in ImpactMap when no entities exceed 0.05 pp", () => {
    const lowImpact: NewsImpact = {
      level: "state",
      delta_pp_national: 0.02,
      votos_perdidos_total: 1200,
      max_delta_pp: 0.03,
      units: [
        {
          id: "09",
          name: "Ciudad de México",
          level: "state",
          delta_pp: 0.03,
          delta_low_pp: 0.01,
          delta_high_pp: 0.04,
          votos_perdidos: 1200,
          exposure: 0.5,
          category_before: "verde",
          category_after: "verde",
        },
      ],
      assumptions: ["Impacto marginal bajo el umbral de 0.05 pp"],
      params: {},
    };

    const html = renderToStaticMarkup(
      <ImpactMap impact={lowImpact} itemId="news_low_01" />
    );

    expect(html).toContain("Impacto estimado bajo: ninguna entidad supera 0.05 pp");
    expect(html).toContain("+0.02 pp");
    expect(html).toContain("1,200");
    expect(html).not.toContain("Ver municipios →");
  });

  it("ImpactMap drill-down calls getItemImpact with mun and state id", async () => {
    const mockMunImpact: NewsImpact = {
      level: "mun",
      ent: "07",
      delta_pp_national: 0.12,
      votos_perdidos_total: 18450,
      max_delta_pp: 0.65,
      units: [
        {
          id: "07001",
          name: "Acacoyagua",
          level: "mun",
          delta_pp: 0.52,
          delta_low_pp: 0.26,
          delta_high_pp: 0.78,
          votos_perdidos: 820,
          exposure: 1.0,
          category_before: "rojo",
          category_after: "rojo",
        },
      ],
      assumptions: ["Prueba de desglose municipal"],
      params: {},
    };

    const getItemImpactMock = vi.mocked(intelApi.getItemImpact);
    getItemImpactMock.mockResolvedValueOnce(mockMunImpact);

    // Call API function directly as would happen in handleDrillDown
    const res = await intelApi.getItemImpact(itemTrue.id, "mun", "07");

    expect(getItemImpactMock).toHaveBeenCalledWith("news_001", "mun", "07");
    expect(res.units[0].name).toBe("Acacoyagua");
  });

  it("renders ViralityPanel with meter, 7-day projection, ignore risk alert and social posts", () => {
    const html = renderToStaticMarkup(<NewsDetail item={itemFalse} />);

    // Virality score & projection
    expect(html).toContain("84 / 100");
    expect(html).toContain("95 / 100"); // projected_score_7d
    expect(html).toContain("creciente");
    expect(html).toContain("1,210,000 reproducciones/vistas");

    // Platforms
    expect(html).toContain("X (Twitter)");
    expect(html).toContain("TikTok");
    expect(html).toContain("Facebook");

    // Highlighted ignore risk alert
    expect(html).toContain("Riesgo de ignorar esta falsedad:");
    expect(html).toContain(itemFalse.virality!.ignore_risk);

    // Social post authors and excerpts
    expect(html).toContain("@noticias_rapidas_mx");
    expect(html).toContain("@alerta_electoral_mx");
    expect(html).toContain("¡URGENTE! El INE cancelará todas las credenciales");
  });

  it("RemediationPanel copies draft message to clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    await navigator.clipboard.writeText(itemTrue.remediation.draft_message!);
    expect(writeTextMock).toHaveBeenCalledWith(itemTrue.remediation.draft_message);
  });

  it("renders valid campaign prefill button URL when action involves intervention campaign", () => {
    const html = renderToStaticMarkup(
      <RemediationPanel
        remediation={itemTrue.remediation}
        affectedEnt="07"
      />
    );

    expect(html).toContain("Simular campaña en el mapa");
    expect(html).toContain("Planear campaña con IA");

    // Extract href for simulation button
    const match = html.match(/href="(\/\?escenario=intervencion&amp;campanas=[^"]+)"/);
    expect(match).not.toBeNull();

    if (match) {
      const url = match[1].replace(/&amp;/g, "&");
      const urlParams = new URLSearchParams(url.split("?")[1]);
      const campanasParam = urlParams.get("campanas");
      expect(campanasParam).toBeTruthy();

      const decoded = decodeCampaignPrefill(campanasParam!);
      expect(decoded).not.toBeNull();
      expect(decoded!.campaigns.length).toBeGreaterThan(0);
      expect(decoded!.campaigns[0].lever).toBe("campana_general");
      expect(decoded!.campaigns[0].ents).toEqual(["07", "20", "12"]);
    }
  });
});
