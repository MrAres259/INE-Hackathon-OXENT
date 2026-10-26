export type GlossaryEntry = {
  title: string;
  body: string;
  relation?: string;
  example?: string;
};

export const GLOSSARY = {
  escenarios: {
    title: "Escenarios 2027",
    body: "Tres formas de proyectar la participación en la elección de 2027: base inercial sin cambios, intervención con acciones del INE o pesimista ante una caída general. Todo el mapa, el ranking y el diagnóstico se recalculan con el escenario elegido.",
  },
  "escenario.base": {
    title: "Escenario Base (Inercial)",
    body: "Pronóstico para 2027 si las tendencias actuales continúan sin intervención. La participación de cada municipio mantiene su nivel histórico relativo, calibrado a una participación nacional supuesta de 51.84 % (última intermedia, 2021).",
  },
  "escenario.intervencion": {
    title: "Escenario de Intervención",
    body: "Simula el impacto de acciones focalizadas de promoción del voto. Solo modifica la abstención en los municipios seleccionados; el resto permanece igual. Es un supuesto de trabajo para comparar opciones operativas, no una evaluación de impacto real.",
  },
  "escenario.pesimista": {
    title: "Escenario Pesimista",
    body: "Simula una caída general de la participación y que se acentúen las tendencias históricas a la baja. Permite identificar qué zonas pasarían a semáforo rojo ante un escenario adverso.",
  },
  "param.lever": {
    title: "Palanca Operativa",
    body: "Tipo de acción institucional a implementar. Decide dónde rinde más el esfuerzo: el efecto se multiplica por un peso relativo según el perfil del municipio frente al percentil 75 nacional (tope 1.5×).",
    relation: "A mayor peso en la variable de la palanca, mayor reducción de abstención en ese municipio.",
  },
  "lever.promocion_jovenes": {
    title: "Promoción en Jóvenes",
    body: "Focaliza esfuerzos en población de 18 a 24 años. El peso se calcula con el porcentaje de jóvenes según el censo INEGI 2020, rindiendo más donde hay mayor proporción de jóvenes.",
    relation: "Mayor impacto en municipios con alta proporción de personas de 18 a 24 años.",
  },
  "lever.casillas_rurales": {
    title: "Casillas Rurales",
    body: "Instalación y difusión de casillas en zonas rurales. Tiene mayor efecto en municipios rurales, donde la dispersión territorial y la distancia a la casilla pesan más en la decisión de votar.",
    relation: "Mayor impacto en municipios con alto porcentaje de población rural.",
  },
  "lever.materiales_lengua_indigena": {
    title: "Materiales en Lengua Indígena",
    body: "Producción y difusión de materiales electorales en lenguas originarias. El impacto se pondera según el porcentaje de población hablante de lengua indígena en cada municipio.",
    relation: "Mayor impacto en zonas con mayor porcentaje de hablantes de lengua indígena.",
  },
  "lever.campana_general": {
    title: "Campaña General de Difusión",
    body: "Campaña institucional uniforme con peso de 1× para todos los municipios focalizados, sin ponderación sociodemográfica diferencial.",
    relation: "Aplica el mismo peso a todas las zonas seleccionadas.",
  },
  "param.targeting": {
    title: "Criterio de Focalización",
    body: "Define qué municipios reciben la acción según su nivel de riesgo en el escenario base. «Rojas y naranjas» atiende únicamente zonas de riesgo crítico y alto. Los demás municipios no cambian.",
    relation: "Solo se intervienen los municipios que coinciden con el criterio seleccionado.",
  },
  "param.effect_pp": {
    title: "Efecto Máximo Esperado",
    body: "Puntos porcentuales (pp) que aumentaría la participación en un municipio con peso 1× y cobertura del 100 %. 1 pp equivale a 1 persona votante por cada 100 de la lista nominal (rango 0–10).",
    relation: "Base del cálculo antes de multiplicar por cobertura y peso de la palanca.",
  },
  "param.coverage": {
    title: "Cobertura de la Acción",
    body: "Porcentaje de la población objetivo que realmente se alcanza con la intervención en territorio.",
    relation: "Efecto real = efecto máximo × cobertura × peso de la palanca.",
    example: "3.0 pp × 50 % × 1.2 = 1.8 pp de incremento real.",
  },
  "param.shock_pp": {
    title: "Caída General de Participación",
    body: "Puntos porcentuales (pp) que disminuye la participación en todos los municipios del país en el escenario pesimista.",
  },
  "param.trend_amplifier": {
    title: "Acentuación de Tendencia Negativa",
    body: "En municipios cuya participación viene cayendo, suma este porcentaje de su caída histórica al pronóstico de abstención. Con 0 % no hay penalización extra.",
  },
  "simulacion.votos": {
    title: "Votos Adicionales o Perdidos",
    body: "Estimación neta de votos adicionales (o perdidos) calculada como el cambio de participación en cada municipio multiplicado por su lista nominal, sumado a nivel nacional.",
    relation: "Cambio de participación × lista nominal, acumulado en todos los municipios.",
  },
  semaforo: {
    title: "Semáforo de Riesgo",
    body: "Clasifica cada zona por su índice de riesgo de abstención 2027: 🔴 Crítico (≥ 75), 🟠 Alto (55–75), 🟡 Moderado (35–55) y 🟢 Bajo (< 35). Compara zonas entre sí respecto a la media nacional; no es un porcentaje de abstención.",
  },
  risk_score: {
    title: "Índice de Riesgo (0–100)",
    body: "Puntaje resumen que integra: 50 % abstención pronosticada, 20 % vulnerabilidad sociodemográfica, 15 % tendencia histórica a la baja y 15 % volatilidad entre elecciones, cada uno como posición relativa frente a otras zonas del mismo nivel.",
  },
  r_abs: {
    title: "Componente de Abstención (0–100)",
    body: "Posición relativa del municipio o estado según su abstención pronosticada para 2027. Un valor de 100 indica la zona con mayor abstención esperada del país.",
    relation: "Aporta el 50 % del índice de riesgo total.",
  },
  r_vuln: {
    title: "Componente de Vulnerabilidad (0–100)",
    body: "Posición relativa según factores sociodemográficos que dificultan el voto (marginación, escolaridad). 100 corresponde a la zona con mayor vulnerabilidad.",
    relation: "Aporta el 20 % del índice de riesgo total.",
  },
  r_trend: {
    title: "Componente de Tendencia (0–100)",
    body: "Posición relativa según la caída de participación entre elecciones federales recientes. 100 representa el mayor deterioro histórico en la afluencia electoral.",
    relation: "Aporta el 15 % del índice de riesgo total.",
  },
  r_vol: {
    title: "Componente de Volatilidad (0–100)",
    body: "Posición relativa según la inestabilidad de la participación a lo largo del tiempo. Un valor alto indica una participación que cambia bruscamente de una elección a otra.",
    relation: "Aporta el 15 % del índice de riesgo total.",
  },
  pred_abstention: {
    title: "Abstención Pronosticada 2027",
    body: "Porcentaje de la lista nominal que se espera que no acuda a votar en la elección federal de 2027 según el modelo estadístico de ATALAYA.",
  },
  intervalo: {
    title: "Intervalo de Confianza (~90 %)",
    body: "Rango probabilístico en el que se prevé que quede la abstención real, calculado como ± 1.645 veces el error típico del modelo observado en 2024.",
  },
  abstencion_esperada: {
    title: "Abstención Esperada (Personas)",
    body: "Personas que se espera que no voten: abstención pronosticada multiplicada por la lista nominal. Mide el volumen absoluto de población no votante en la zona.",
    relation: "Indica dónde una acción institucional tiene el potencial de alcanzar a más personas.",
  },
  prioridad: {
    title: "Orden de Prioridad",
    body: "Orden de atención entre zonas en semáforo rojo y naranja ordenadas por abstención esperada (número de personas). La prioridad 1 señala dónde la acción alcanza a más ciudadanos.",
  },
  lista_nominal: {
    title: "Lista Nominal",
    body: "Ciudadanos que cuentan con credencial para votar vigente y están registrados en el padrón electoral definitivo del INE para ejercer su voto.",
  },
  pct_ln: {
    title: "% de Lista Nominal (% LN)",
    body: "Porcentaje de la lista nominal nacional que reside en municipios o entidades agrupados bajo esa categoría de riesgo.",
  },
  vulnerability_pp: {
    title: "Vulnerabilidad Sociodemográfica (pp)",
    body: "Abstención adicional en puntos porcentuales predicha por las condiciones sociodemográficas del municipio o estado respecto al promedio nacional.",
  },
  trend_pp: {
    title: "Tendencia de Participación (pp)",
    body: "Cambio de la participación ciudadana entre elecciones federales recientes en puntos porcentuales. Un valor negativo indica que la participación viene cayendo.",
  },
  volatility: {
    title: "Volatilidad Electoral",
    body: "Medida de cuánto sube y baja la participación histórica entre elecciones en la zona. Una volatilidad alta señala que el pronóstico es menos estable.",
  },
  participacion: {
    title: "Participación Ciudadana",
    body: "Porcentaje de votantes efectivos respecto a la lista nominal según los Conteos Censales de Participación Ciudadana (CCPC) del INE, excluyendo registros no especificados.",
  },
  ns_rate: {
    title: "Tasa de No Especificados",
    body: "Porcentaje de registros sin dato válido en un municipio y año en los Conteos Censales. Si supera el 50 %, el registro se considera no confiable.",
  },
  confiabilidad: {
    title: "Confiabilidad del Dato",
    body: "Criterio de calidad estadística: si más de la mitad de los registros de un municipio-año no se especificaron, el dato no se utiliza y se indica «sin información confiable».",
  },
  sin_dato: {
    title: "Sin Información Suficiente",
    body: "Zona territorial que no cuenta con datos históricos confiables o suficientes para emitir un pronóstico estadístico válido.",
  },
  factores: {
    title: "Factores Sociodemográficos",
    body: "Variables del entorno local (escolaridad, marginación, conectividad, ruralidad) que más se asocian con la abstención estimada, en puntos porcentuales. Son asociaciones estadísticas, no causas directas.",
  },
  recomendaciones: {
    title: "Recomendaciones Operativas",
    body: "Acciones preventivas sugeridas por reglas lógicas a partir de los indicadores de riesgo y el perfil de la zona (hasta un máximo de 4 por territorio).",
  },
  "ccpc.pct_ln_18_34": {
    title: "% Lista Nominal de 18 a 34 años",
    body: "Porcentaje de la lista nominal de la zona que corresponde a jóvenes y adultos jóvenes de 18 a 34 años de edad.",
  },
  "ccpc.part_18_34": {
    title: "Participación de 18 a 34 años",
    body: "Tasa de participación electoral del grupo de 18 a 34 años registrada en los Conteos Censales del INE.",
  },
  "ccpc.gap_youth_pp": {
    title: "Brecha Jóvenes vs Resto (pp)",
    body: "Diferencia en puntos porcentuales entre la participación de jóvenes de 18 a 34 años y la del resto del electorado en la zona.",
  },
  "ccpc.gap_sexo_pp": {
    title: "Brecha por Sexo (pp)",
    body: "Diferencia en puntos porcentuales entre la tasa de participación de mujeres y la de hombres registrada en los Conteos Censales.",
  },
  "ccpc.pct_ln_rural": {
    title: "% Lista Nominal Rural",
    body: "Porcentaje de la lista nominal de la zona que vive en secciones electorales clasificadas como rurales por el INE.",
  },
  perfil_edad_sexo: {
    title: "Perfil por Edad y Sexo",
    body: "Distribución de participación por grupos de edad y sexo de los Conteos Censales (CCPC). Por protección de datos personales, las celdas con menos de 10 personas se ocultan.",
  },
  "modo.semaforo": {
    title: "Modo Semáforo",
    body: "Colorea cada zona del mapa con su categoría de riesgo de abstención (rojo, naranja, amarillo, verde) en el escenario activo.",
  },
  "modo.delta": {
    title: "Modo Cambio Δ",
    body: "Muestra la diferencia en puntos porcentuales de abstención entre el escenario alternativo y el base. Azul indica menor abstención (mejora) y rojo mayor abstención.",
  },
  "modo.comparar": {
    title: "Modo Comparar",
    body: "Vista interactiva con cortina deslizante: a la izquierda el escenario sin intervención y a la derecha con intervención. Arrastra la cortina para contrastar resultados.",
  },
  "modo.3d": {
    title: "Vista 3D (Columnas)",
    body: "Muestra columnas sobre cada zona donde la altura representa el índice de riesgo (rojo más alto) o la magnitud del cambio |Δ|. Usa «Inclinada» para ver alturas o «Cenital» desde arriba.",
  },
  motor: {
    title: "Motor de Datos",
    body: "Fuente de datos activa: OpenSearch (búsqueda indexada en la nube) o memoria local (respaldo de alta velocidad en el servidor). Ambos entregan exactamente los mismos resultados.",
  },
  asistente: {
    title: "Asistente Virtual ATALAYA",
    body: "Asistente enfocado exclusivamente en participación y abstención ciudadana con los datos oficiales de ATALAYA. Cada cifra proviene de los cálculos del sistema; no emite opiniones partidistas ni genera código.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossaryFor(key: string): GlossaryEntry | undefined {
  if (key in GLOSSARY) {
    return GLOSSARY[key as GlossaryKey];
  }
  return undefined;
}

export const PARAM_TERM: Record<string, GlossaryKey> = {
  lever: "param.lever",
  targeting: "param.targeting",
  effect_pp: "param.effect_pp",
  coverage: "param.coverage",
  shock_pp: "param.shock_pp",
  trend_amplifier: "param.trend_amplifier",
};

export function optionTerm(paramKey: string, value: string): GlossaryKey | undefined {
  const direct = `${paramKey}.${value}`;
  if (direct in GLOSSARY) {
    return direct as GlossaryKey;
  }
  const leverCandidate = `lever.${value}`;
  if (leverCandidate in GLOSSARY) {
    return leverCandidate as GlossaryKey;
  }
  return undefined;
}
