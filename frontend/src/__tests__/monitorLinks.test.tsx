import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ViralityPanel } from "../components/intel/monitor/ViralityPanel";
import { RemediationPanel } from "../components/intel/monitor/RemediationPanel";
import { SourceList } from "../components/intel/SourceList";
import type { SocialPost, Virality, Remediation, SourceRef } from "../lib/intel/types";

describe("Monitor Links UI Suite (monitorLinks.test.tsx)", () => {
  it("renders citado_en_fuente post with 'Ver publicación' link and 'Enlace citado en la nota de El Financiero' evidence link", () => {
    const post: SocialPost = {
      platform: "x",
      url: "https://x.com/Sergeluna_S/status/2116260787865944083",
      author: "@Sergeluna_S",
      published: "2026-10-28T14:30:00Z",
      engagement: { likes: 120, shares: 45, comments: 12, views: 3500 },
      excerpt: "Declaraciones sobre las casillas electorales",
      link_status: "citado_en_fuente",
      evidence_url: "https://www.elfinanciero.com.mx/nacional/2026/10/28/elecciones-casillas",
      evidence_outlet: "El Financiero",
    };

    const virality: Virality = {
      score: 55,
      level: "media",
      platforms: ["x"],
      posts: [post],
      growth: "estable",
      projected_score_7d: 60,
      basis: ["Mención verificada en medio"],
      ignore_risk: "Riesgo de desinformación moderado",
    };

    const html = renderToStaticMarkup(<ViralityPanel virality={virality} />);

    // Ver publicación link with exact href
    expect(html).toContain("Ver publicación");
    expect(html).toContain('href="https://x.com/Sergeluna_S/status/2116260787865944083"');

    // Evidence line with outlet and exact href
    expect(html).toContain("Enlace citado en la nota de El Financiero");
    expect(html).toContain('href="https://www.elfinanciero.com.mx/nacional/2026/10/28/elecciones-casillas"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not render posts that lack link_status or have sin_verificar", () => {
    const unverifiedPost1: SocialPost = {
      platform: "facebook",
      url: "https://facebook.com/fake_post_1",
      author: "@Facebook_User",
      engagement: {},
      excerpt: "Publicación falsa no citada en ninguna nota",
      // link_status omitted / undefined
    };

    const unverifiedPost2: SocialPost = {
      platform: "tiktok",
      url: "https://tiktok.com/@fake/video/123",
      author: "@fake",
      engagement: {},
      excerpt: "Video sin verificar",
      link_status: "sin_verificar",
    };

    const virality: Virality = {
      score: 40,
      level: "baja",
      platforms: ["facebook", "tiktok"],
      posts: [unverifiedPost1, unverifiedPost2],
      growth: "estable",
      projected_score_7d: 40,
      basis: [],
      ignore_risk: "Bajo riesgo",
    };

    const html = renderToStaticMarkup(<ViralityPanel virality={virality} />);

    expect(html).not.toContain("https://facebook.com/fake_post_1");
    expect(html).not.toContain("@Facebook_User");
    expect(html).not.toContain("Publicación falsa no citada en ninguna nota");
    expect(html).not.toContain("https://tiktok.com/@fake/video/123");
    expect(html).not.toContain("Video sin verificar");
  });

  it("renders neutral notice when rumor has no verified public social posts", () => {
    const virality: Virality = {
      score: 50,
      level: "media",
      platforms: ["x"],
      posts: [],
      growth: "estable",
      projected_score_7d: 55,
      basis: [],
      ignore_risk: "Riesgo de rumor",
    };

    const html = renderToStaticMarkup(
      <ViralityPanel virality={virality} itemVerdict="falsa" itemKind="rumor" />
    );

    expect(html).toContain(
      "No se encontraron enlaces públicos verificables a publicaciones en redes. Los rumores se detectan a través de verificadores y medios; con búsqueda web completa la cobertura aumenta."
    );
  });

  it("displays 'Cuenta sin nombre en el enlace' when post author is null and never invents anonymous author", () => {
    const post: SocialPost = {
      platform: "x",
      url: "https://x.com/status/999999",
      author: null,
      engagement: {},
      excerpt: "Cita de texto verificada",
      link_status: "grounding",
    };

    const virality: Virality = {
      score: 30,
      level: "baja",
      platforms: ["x"],
      posts: [post],
      growth: "estable",
      projected_score_7d: 30,
      basis: [],
      ignore_risk: "Riesgo bajo",
    };

    const html = renderToStaticMarkup(<ViralityPanel virality={virality} />);

    expect(html).toContain("Cuenta sin nombre en el enlace");
    expect(html).not.toContain("Autor anónimo");
    expect(html).toContain("Encontrado por búsqueda web");
  });

  it("renders notice in RemediationPanel when action is reportar_plataforma and there are no report targets", () => {
    const remediation: Remediation = {
      action: "reportar_plataforma",
      secondary_actions: [],
      measures: ["Contactar a la plataforma para retirar contenido"],
      rationale: "Desinformación sin enlaces verificables directos",
      report_targets: [],
      deadline_hours: 12,
      degraded: false,
    };

    const html = renderToStaticMarkup(<RemediationPanel remediation={remediation} />);

    expect(html).toContain(
      "No hay enlaces verificables para reportar. Ubica la publicación desde la nota del verificador citada en las fuentes."
    );
  });

  it("renders report targets with proof line in RemediationPanel when target matches post", () => {
    const post: SocialPost = {
      platform: "x",
      url: "https://x.com/noticias_falsas/status/123",
      author: "@noticias_falsas",
      engagement: {},
      excerpt: "Texto de la publicación",
      link_status: "citado_en_fuente",
      evidence_url: "https://animalpolitico.com/sabueso/desmentido-123",
      evidence_outlet: "Animal Político",
    };

    const remediation: Remediation = {
      action: "reportar_plataforma",
      secondary_actions: [],
      measures: ["Reportar cuenta infractora"],
      rationale: "Publicación desmentida por verificador",
      report_targets: [
        {
          platform: "x",
          url: "https://x.com/noticias_falsas/status/123",
          author: "@noticias_falsas",
          reason: "Desinformación electoral",
        },
      ],
      deadline_hours: 6,
      degraded: false,
    };

    const html = renderToStaticMarkup(
      <RemediationPanel remediation={remediation} posts={[post]} />
    );

    expect(html).toContain("Reportar enlace");
    expect(html).toContain('href="https://x.com/noticias_falsas/status/123"');
    expect(html).toContain("Enlace citado en la nota de Animal Político");
    expect(html).toContain('href="https://animalpolitico.com/sabueso/desmentido-123"');
  });

  it("renders '(vía Google News)' for sources with news.google.com URLs", () => {
    const sources: SourceRef[] = [
      {
        id: "s1",
        url: "https://news.google.com/rss/articles/CBMiWWh0dHBzOi8vd3d3LmVsZmluYW5jaWVyby5jb20ubXgvbmFjaW9uYWwvMjAyNi8xMC8yOC9hbGVydGEtZWxlY3RvcmFsLXJ1bW9yZXMtY2FzaWxsYXMv0gEA?oc=5",
        title: "Alerta electoral sobre casillas",
        domain: "news.google.com",
        outlet: "El Financiero",
        tier: "medio_reconocido",
        published: "2026-10-28",
      },
    ];

    const html = renderToStaticMarkup(<SourceList sources={sources} />);

    expect(html).toContain("(vía Google News)");
    expect(html).toContain("El Financiero (vía Google News)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
