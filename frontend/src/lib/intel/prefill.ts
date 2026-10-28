// ATALAYA Intel - Campaign Prefill encoding/decoding for map URL state
import type { Lever, Targeting } from "./types";

export interface PrefillCampaign {
  lever: Lever;
  targeting: Targeting;
  effect_pp: number;
  coverage: number;
  ents?: string[];
}

export interface CampaignPrefillPayload {
  campaigns: PrefillCampaign[];
}

const VALID_LEVERS: Set<Lever> = new Set([
  "promocion_jovenes",
  "casillas_rurales",
  "materiales_lengua_indigena",
  "campana_general",
]);

const VALID_TARGETINGS: Set<Targeting> = new Set([
  "rojo",
  "rojo_naranja",
  "todos",
]);

function toBase64Url(str: string): string {
  let b64: string;
  if (typeof Buffer !== "undefined") {
    b64 = Buffer.from(str, "utf-8").toString("base64");
  } else {
    // Browser UTF-8 safe base64
    b64 = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf-8");
  } else {
    const raw = atob(b64);
    return decodeURIComponent(
      Array.prototype.map.call(raw, (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
  }
}

export function encodeCampaignPrefill(payload: CampaignPrefillPayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export function decodeCampaignPrefill(str: string): CampaignPrefillPayload | null {
  if (!str || typeof str !== "string") return null;
  try {
    const jsonStr = fromBase64Url(str.trim());
    const parsed = JSON.parse(jsonStr);

    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.campaigns)) return null;
    if (parsed.campaigns.length === 0 || parsed.campaigns.length > 4) return null;

    const validatedCampaigns: PrefillCampaign[] = [];

    for (const c of parsed.campaigns) {
      if (!c || typeof c !== "object") return null;
      if (!VALID_LEVERS.has(c.lever)) return null;

      const targeting: Targeting = VALID_TARGETINGS.has(c.targeting) ? c.targeting : "todos";

      const effect_pp = Number(c.effect_pp);
      if (!Number.isFinite(effect_pp) || effect_pp < 0 || effect_pp > 20) return null;

      const coverage = Number(c.coverage);
      if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) return null;

      let ents: string[] = [];
      if (Array.isArray(c.ents)) {
        ents = c.ents.filter((e: unknown) => typeof e === "string" && e.length > 0);
      }

      validatedCampaigns.push({
        lever: c.lever,
        targeting,
        effect_pp,
        coverage,
        ents,
      });
    }

    return { campaigns: validatedCampaigns };
  } catch {
    return null;
  }
}

export function campaignPrefillUrl(payload: CampaignPrefillPayload): string {
  const encoded = encodeCampaignPrefill(payload);
  return `/?escenario=intervencion&campanas=${encodeURIComponent(encoded)}`;
}
