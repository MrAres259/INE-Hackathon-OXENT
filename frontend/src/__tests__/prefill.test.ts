import { describe, it, expect } from "vitest";
import {
  encodeCampaignPrefill,
  decodeCampaignPrefill,
  campaignPrefillUrl,
  type CampaignPrefillPayload,
} from "../lib/intel/prefill";

describe("Campaign Prefill Suite (prefill.test.ts)", () => {
  it("encodes and decodes valid prefill payload successfully (round-trip)", () => {
    const payload: CampaignPrefillPayload = {
      campaigns: [
        {
          lever: "promocion_jovenes",
          targeting: "rojo_naranja",
          effect_pp: 3.5,
          coverage: 80,
          ents: ["07", "20"],
        },
        {
          lever: "casillas_rurales",
          targeting: "todos",
          effect_pp: 2.0,
          coverage: 100,
          ents: [],
        },
      ],
    };

    const encoded = encodeCampaignPrefill(payload);
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe("string");
    // URL-safe checks
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");

    const decoded = decodeCampaignPrefill(encoded);
    expect(decoded).toEqual(payload);
  });

  it("handles all 4 valid levers and targeting options in a 4-campaign prefill", () => {
    const payload: CampaignPrefillPayload = {
      campaigns: [
        { lever: "promocion_jovenes", targeting: "rojo", effect_pp: 1.5, coverage: 50, ents: ["09"] },
        { lever: "casillas_rurales", targeting: "rojo_naranja", effect_pp: 2.5, coverage: 75, ents: ["07"] },
        { lever: "materiales_lengua_indigena", targeting: "todos", effect_pp: 3.0, coverage: 90, ents: ["20"] },
        { lever: "campana_general", targeting: "todos", effect_pp: 0.8, coverage: 100, ents: [] },
      ],
    };

    const encoded = encodeCampaignPrefill(payload);
    const decoded = decodeCampaignPrefill(encoded);
    expect(decoded).toEqual(payload);
  });

  it("generates valid map URL with campaignPrefillUrl", () => {
    const payload: CampaignPrefillPayload = {
      campaigns: [
        { lever: "promocion_jovenes", targeting: "todos", effect_pp: 4.0, coverage: 90, ents: [] },
      ],
    };

    const url = campaignPrefillUrl(payload);
    expect(url).toMatch(/^\/\?escenario=intervencion&campanas=[A-Za-z0-9_-]+$/);

    const match = url.match(/campanas=([^&]+)/);
    expect(match).not.toBeNull();
    const decoded = decodeCampaignPrefill(decodeURIComponent(match![1]));
    expect(decoded).toEqual(payload);
  });

  it("rejects invalid inputs gracefully with null", () => {
    expect(decodeCampaignPrefill("")).toBeNull();
    expect(decodeCampaignPrefill("   ")).toBeNull();
    expect(decodeCampaignPrefill("invalid-base-64-%%@@")).toBeNull();
    expect(decodeCampaignPrefill(Buffer.from("not-json").toString("base64"))).toBeNull();
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify({})).toString("base64"))).toBeNull();
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify({ campaigns: [] })).toString("base64"))).toBeNull();
  });

  it("rejects payload with more than 4 campaigns", () => {
    const payload = {
      campaigns: [
        { lever: "promocion_jovenes", effect_pp: 1, coverage: 100 },
        { lever: "casillas_rurales", effect_pp: 1, coverage: 100 },
        { lever: "materiales_lengua_indigena", effect_pp: 1, coverage: 100 },
        { lever: "campana_general", effect_pp: 1, coverage: 100 },
        { lever: "promocion_jovenes", effect_pp: 1, coverage: 100 }, // 5th
      ],
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(decodeCampaignPrefill(b64)).toBeNull();
  });

  it("rejects payload with invalid lever", () => {
    const payload = {
      campaigns: [
        { lever: "palanca_inexistente", effect_pp: 1, coverage: 100 },
      ],
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(decodeCampaignPrefill(b64)).toBeNull();
  });

  it("rejects invalid numbers (negative, NaN, out of bounds)", () => {
    // Negative effect_pp
    const negEffect = {
      campaigns: [{ lever: "promocion_jovenes", effect_pp: -2, coverage: 100 }],
    };
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify(negEffect)).toString("base64url"))).toBeNull();

    // Out of bounds effect_pp (> 20)
    const bigEffect = {
      campaigns: [{ lever: "promocion_jovenes", effect_pp: 25, coverage: 100 }],
    };
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify(bigEffect)).toString("base64url"))).toBeNull();

    // Out of bounds coverage (> 100)
    const bigCoverage = {
      campaigns: [{ lever: "promocion_jovenes", effect_pp: 2, coverage: 150 }],
    };
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify(bigCoverage)).toString("base64url"))).toBeNull();

    // Negative coverage
    const negCoverage = {
      campaigns: [{ lever: "promocion_jovenes", effect_pp: 2, coverage: -10 }],
    };
    expect(decodeCampaignPrefill(Buffer.from(JSON.stringify(negCoverage)).toString("base64url"))).toBeNull();
  });
});
