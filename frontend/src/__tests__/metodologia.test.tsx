import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import MetodologiaPage from "../app/metodologia/page";
import {
  NEWS_IMPACT_PARAMS,
  SEVERITY_ACTIONS_RULES,
  type NewsImpactParam,
  type SeverityActionRule,
} from "../lib/intel/methodology";

describe("Metodología: Inteligencia con IA (metodologia.test.tsx)", () => {
  describe("NEWS_IMPACT_PARAMS constant vs data/seed/news_impact_params.csv", () => {
    it("exactamente replica los valores del CSV oficial con lectura directa por fs", () => {
      // Find CSV file relative to test file or process.cwd()
      const candidatePaths = [
        path.resolve(__dirname, "../../../data/seed/news_impact_params.csv"),
        path.resolve(process.cwd(), "../data/seed/news_impact_params.csv"),
        path.resolve(process.cwd(), "data/seed/news_impact_params.csv"),
      ];
      let csvPath = candidatePaths.find((p) => fs.existsSync(p));
      expect(csvPath, "No se encontró el archivo news_impact_params.csv").toBeDefined();

      const rawCsv = fs.readFileSync(csvPath!, "utf-8");
      const lines = rawCsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const header = lines[0];
      expect(header).toBe("topic,s_topic_pp,harm,susc_var,label_es,rationale_es");

      const dataRows = lines.slice(1);
      expect(NEWS_IMPACT_PARAMS.length).toBe(dataRows.length);
      expect(NEWS_IMPACT_PARAMS.length).toBe(9);

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        // Parse CSV columns: topic,s_topic_pp,harm,susc_var,label_es,rationale_es
        const parts = row.split(",");
        expect(parts.length).toBeGreaterThanOrEqual(6);
        const [topic, s_topic_pp, harm, susc_var, label_es, ...rationaleParts] = parts;
        const rationale_es = rationaleParts.join(",");

        const expectedItem: NewsImpactParam = {
          topic,
          s_topic_pp: parseFloat(s_topic_pp),
          harm: parseFloat(harm),
          susc_var,
          label_es,
          rationale_es,
        };

        const actualItem = NEWS_IMPACT_PARAMS[i];
        expect(actualItem.topic).toBe(expectedItem.topic);
        expect(actualItem.s_topic_pp).toBeCloseTo(expectedItem.s_topic_pp, 4);
        expect(actualItem.harm).toBeCloseTo(expectedItem.harm, 4);
        expect(actualItem.susc_var).toBe(expectedItem.susc_var);
        expect(actualItem.label_es).toBe(expectedItem.label_es);
        expect(actualItem.rationale_es).toBe(expectedItem.rationale_es);
      }
    });

    it("cubre temas sensibles clave: seguridad_violencia con 2.5 pp y credencial_padron con 1.0 pp", () => {
      const seguridad = NEWS_IMPACT_PARAMS.find((p) => p.topic === "seguridad_violencia");
      expect(seguridad).toBeDefined();
      expect(seguridad?.s_topic_pp).toBe(2.5);
      expect(seguridad?.harm).toBe(0.7);
      expect(seguridad?.susc_var).toBe("r_vuln");

      const credencial = NEWS_IMPACT_PARAMS.find((p) => p.topic === "credencial_padron");
      expect(credencial).toBeDefined();
      expect(credencial?.s_topic_pp).toBe(1.0);
      expect(credencial?.harm).toBe(1.0);
      expect(credencial?.susc_var).toBe("pct_18_24");
    });
  });

  describe("SEVERITY_ACTIONS_RULES table specification", () => {
    it("contiene los 7 umbrales y plazos de atención institucionales requeridos", () => {
      expect(SEVERITY_ACTIONS_RULES.length).toBe(7);

      const deadlines = SEVERITY_ACTIONS_RULES.map((r) => r.deadline_hours);
      // Contains all institutional deadlines: 12h, 24h, 48h, 72h, 168h
      expect(deadlines).toContain(12);
      expect(deadlines).toContain(24);
      expect(deadlines).toContain(48);
      expect(deadlines).toContain(72);
      expect(deadlines).toContain(168);

      const actions = SEVERITY_ACTIONS_RULES.map((r) => r.action_label);
      expect(actions).toContain("Desmentido oficial (#INEdesmiente)");
      expect(actions).toContain("Reportar a plataforma");
      expect(actions).toContain("Responder y corregir");
      expect(actions).toContain("Registrar en bitácora");
      expect(actions).toContain("Campaña de intervención");
      expect(actions).toContain("Comunicado oficial");
    });
  });

  describe("Renderizado completo de MetodologiaPage (/metodologia)", () => {
    const html = renderToStaticMarkup(<MetodologiaPage />);

    it("incluye la nueva sección 'inteligencia-ia' con ID de ancla y chip de navegación", () => {
      expect(html).toContain('id="inteligencia-ia"');
      expect(html).toContain('href="#inteligencia-ia"');
      expect(html).toContain("Inteligencia con IA");
    });

    it("describe el Plan de Campaña: flujo de 5 etapas, niveles de verificación y filtros anti-alucinación", () => {
      // 5 etapas del flujo
      expect(html).toContain("1. Datos Atalaya");
      expect(html).toContain("2. Investigación");
      expect(html).toContain("3. Planeación GLM");
      expect(html).toContain("4. Simulación");
      expect(html).toContain("5. Diapositivas");

      // Niveles de verificación admitidos (VERIFIABLE_TIERS)
      expect(html).toContain("VERIFIABLE_TIERS");
      expect(html).toContain("Oficial");
      expect(html).toContain("Verificadores acreditados");
      expect(html).toContain("Académico");
      expect(html).toContain("Medios reconocidos");

      // Fuentes descartadas y anti-alucinación
      expect(html).toContain("Fuentes descartadas");
      expect(html).toContain("Redes sociales");
      expect(html).toContain("partidos políticos");
      expect(html).toContain("grounding chunks");

      // Por qué el LLM no escribe cifras de impacto
      expect(html).toContain("Por qué el LLM no escribe cifras de impacto");
      expect(html).toContain("model.scenarios.simulate");

      // Modos de respaldo
      expect(html).toContain("Modo de respaldo y sin internet");
      expect(html).toContain("Google News / Bing");
      expect(html).toContain("llm.degraded = true");
    });

    it("describe el Monitor INE: veredictos, fórmula de impacto territorial, decaimiento y tope de 3 pp", () => {
      // 4 veredictos
      expect(html).toContain("1. Verdadera");
      expect(html).toContain("2. Falsa");
      expect(html).toContain("3. Engañosa");
      expect(html).toContain("4. Sin verificar");

      // Fórmula de impacto
      expect(html).toContain("Δ_i (pp de abstención) = min(CAP, S_topic × intensity × decay × exposure_i × susc_i)");
      expect(html).toContain("S_topic");
      expect(html).toContain("intensity");
      expect(html).toContain("decay");
      expect(html).toContain("exposure_i");
      expect(html).toContain("susc_i");

      // Días restantes a la elección federal 6 de junio de 2027
      expect(html).toContain("2027-06-06");
      expect(html).toContain("exp(−d/60)");
      expect(html).toContain("exp(−d/240)");

      // Tope institucional y banda
      expect(html).toContain("Tope máximo estricto de 3.0 pp");
      expect(html).toContain("0.5 × Δ_i");

      // Tabla de efectos por temática
      for (const p of NEWS_IMPACT_PARAMS) {
        expect(html).toContain(p.label_es);
        expect(html).toContain(p.topic);
      }
    });

    it("describe la viralidad (§7.4), riesgo de ignorar, matriz de severidad y registro inmutable", () => {
      // Viralidad logarítmica
      expect(html).toContain("Índice de Viralidad Digital");
      expect(html).toContain("15·log10(1+Σe)");
      expect(html).toContain("Crítica");

      // Riesgo de ignorar desinformación
      expect(html).toContain("Riesgo de ignorar la desinformación");
      expect(html).toContain("desmovilización electoral");

      // Severidad y matriz de acción
      for (const r of SEVERITY_ACTIONS_RULES) {
        expect(html).toContain(r.action_label);
      }

      // Registro append-only y clave de operador
      expect(html).toContain("registry.jsonl");
      expect(html).toContain("ATALAYA_OPERATOR_TOKEN");
      expect(html).toContain("X-Operator-Token");
    });

    it("expone las salvaguardas éticas: escenarios hipotéticos, privacidad sin datos personales, neutralidad y revisión humana", () => {
      expect(html).toContain("Escenarios hipotéticos");
      expect(html).toContain("Privacidad y anonimato");
      expect(html).toContain("handles");
      expect(html).toContain("Neutralidad institucional");
      expect(html).toContain("Supervisión humana");
      expect(html).toContain("La IA se equivoca");
      expect(html).toContain("Cuota y sustentabilidad");
      expect(html).toContain("40 consultas");
    });
  });
});
