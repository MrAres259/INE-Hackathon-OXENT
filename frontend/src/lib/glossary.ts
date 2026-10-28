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
    title: "Base (Inercial)",
    body: "Pronóstico para 2027 si las tendencias actuales continúan sin intervención. La participación de cada municipio mantiene su nivel histórico relativo, calibrado a una participación nacional supuesta de 51.84 % (última intermedia, 2021).",
  },
  "escenario.intervencion": {
    title: "Intervención",
    body: "Simula el impacto de acciones focalizadas de promoción del voto. Solo modifica la abstención en los municipios seleccionados; el resto permanece igual. Es un supuesto de trabajo para comparar opciones operativas, no una evaluación de impacto real.",
  },
  "escenario.pesimista": {
    title: "Pesimista",
    body: "Simula una caída general de la participación y que se acentúen las tendencias históricas a la baja. Permite identificar qué zonas pasarían a semáforo rojo ante un escenario adverso.",
  },
  "param.lever": {
    title: "Palanca de intervención",
    body: "Tipo de acción institucional a implementar en cada campaña. Decide dónde rinde más el esfuerzo: el efecto se multiplica por un peso relativo según el perfil del municipio frente al percentil 75 nacional (tope 1.5×).",
    relation: "A mayor peso en la variable de la palanca, mayor reducción de abstención en ese municipio.",
  },
  "lever.promocion_jovenes": {
    title: "Promoción del voto joven",
    body: "Focaliza esfuerzos en población de 18 a 24 años. El peso se calcula con el porcentaje de jóvenes según el censo INEGI 2020, rindiendo más donde hay mayor proporción de jóvenes.",
    relation: "Mayor impacto en municipios con alta proporción de personas de 18 a 24 años.",
  },
  "lever.casillas_rurales": {
    title: "Casillas y traslado en zonas rurales",
    body: "Instalación y difusión de casillas en zonas rurales. Tiene mayor efecto en municipios rurales, donde la dispersión territorial y la distancia a la casilla pesan más en la decisión de votar.",
    relation: "Mayor impacto en municipios con alto porcentaje de población rural.",
  },
  "lever.materiales_lengua_indigena": {
    title: "Materiales y capacitación en lenguas indígenas",
    body: "Producción y difusión de materiales electorales en lenguas originarias. El impacto se pondera según el porcentaje de población hablante de lengua indígena en cada municipio.",
    relation: "Mayor impacto en zonas con mayor porcentaje de hablantes de lengua indígena.",
  },
  "lever.campana_general": {
    title: "Campaña general de promoción del voto",
    body: "Campaña institucional uniforme con peso de 1× para todos los municipios focalizados, sin ponderación sociodemográfica diferencial.",
    relation: "Aplica el mismo peso a todas las zonas seleccionadas.",
  },
  "param.targeting": {
    title: "Focalización",
    body: "Define qué municipios reciben cada campaña según su nivel de riesgo en el escenario base. «Rojas y naranjas» atiende únicamente zonas de riesgo crítico y alto. Se calibra por campaña y se combina con su ámbito.",
    relation: "Solo se intervienen los municipios que coinciden con el criterio seleccionado para esa campaña.",
  },
  "targeting.rojo": {
    title: "Solo zonas rojas",
    body: "Aplica la intervención únicamente en los municipios clasificados en riesgo crítico (semáforo rojo) en el escenario base.",
    relation: "Concentra el 100 % de los recursos en los municipios con mayor abstención esperada y vulnerabilidad.",
  },
  "targeting.rojo_naranja": {
    title: "Zonas rojas y naranjas",
    body: "Aplica la intervención en municipios con riesgo crítico y alto (rojo y naranja) en el escenario base. Los municipios moderados y bajos no cambian.",
    relation: "Cubre los dos niveles prioritarios de atención electoral preventiva.",
  },
  "targeting.todos": {
    title: "Todo el país",
    body: "Extiende la intervención a todos los municipios del país con datos válidos, independientemente de su nivel de riesgo.",
    relation: "Aplica el efecto de forma homogénea a nivel nacional.",
  },
  "param.effect_pp": {
    title: "Efecto máximo esperado",
    body: "Puntos porcentuales (pp) que aumentaría la participación en cada campaña en un municipio con peso 1× y cobertura del 100 %. 1 pp equivale a 1 persona votante por cada 100 de la lista nominal (rango 0–10).",
    relation: "Base del cálculo por campaña antes de multiplicar por cobertura y peso de la palanca.",
  },
  "param.coverage": {
    title: "Cobertura de la intervención",
    body: "Porcentaje de la población objetivo que realmente se alcanza en territorio para cada campaña (rango 0–100 %).",
    relation: "Efecto real por campaña = efecto máximo × cobertura × peso de la palanca.",
    example: "3.0 pp × 50 % × 1.2 = 1.8 pp de incremento real.",
  },
  "param.shock_pp": {
    title: "Caída general de participación",
    body: "Puntos porcentuales (pp) que disminuye la participación en todos los municipios del país en el escenario pesimista.",
  },
  "param.trend_amplifier": {
    title: "Acentuación de tendencias negativas",
    body: "En municipios cuya participación viene cayendo, suma este porcentaje de su caída histórica al pronóstico de abstención. Con 0 % no hay penalización extra.",
  },
  "simulacion.votos": {
    title: "Votos Adicionales o Perdidos",
    body: "Estimación neta de votos adicionales (o perdidos) calculada como el cambio de participación en cada municipio multiplicado por su lista nominal, sumado a nivel nacional.",
    relation: "Cambio de participación × lista nominal, acumulado en todos los municipios.",
  },
  campanas: {
    title: "Campañas Simultáneas",
    body: "Permite simular hasta 4 campañas concurrentes, una por cada palanca del INE. Cada campaña define su propia focalización por semáforo, ámbito geográfico, efecto esperado y cobertura. Son supuestos hipotéticos para planeación.",
    relation: "Permite evaluar estrategias combinadas (p. ej. voto joven nacional con casillas rurales en estados prioritarios).",
    example: "Campaña 1: Jóvenes en todo el país + Campaña 2: Casillas rurales en Chiapas y Oaxaca.",
  },
  ambito: {
    title: "Ámbito Geográfico",
    body: "Alcance territorial de la campaña: todo el país o estados específicos correspondientes a las 32 Juntas Locales Ejecutivas del INE. Se combina con la focalización por semáforo para delimitar los municipios atendidos.",
    relation: "Un municipio recibe la campaña si su estado está en el ámbito y su riesgo coincide con la focalización.",
    example: "Ámbito Chiapas y Oaxaca con focalización Zonas rojas interviene solo municipios en rojo de esos dos estados.",
  },
  combinacion: {
    title: "Combinación (Rendimientos Decrecientes)",
    body: "Regla que modela que cada campaña adicional actúa sobre la abstención remanente con rendimientos decrecientes: a' = a × (1 - r1) × (1 - r2)… Evita sobrestimaciones y garantiza que la participación no supere el tope de 98 %.",
    relation: "Con una sola campaña equivale a la resta directa; con varias evita duplicar el conteo de votos.",
    example: "Con 60 % de abstención base, dos campañas de -6 pp y -4 pp solas logran -9.6 pp combinadas (no -10 pp).",
  },
  traslape: {
    title: "Traslape de Campañas",
    body: "Votos adicionales de traslape que se contarían dos veces si se sumaran las campañas por separado. Refleja la concurrencia de acciones sobre una misma población y explica por qué la suma individual siempre supera al total combinado.",
    relation: "Traslape = Suma de votos individuales − Votos adicionales combinados (siempre ≥ 0).",
    example: "Suma individual: 120,000 votos; Total combinado: 110,000 votos ⇒ Traslape: 10,000 votos.",
  },
  lineamientos: {
    title: "Lineamientos del Simulador",
    body: "Garantías institucionales: escenario hipotético para planeación (no efecto causal medido); criterios territoriales y de semáforo sin variables partidistas; datos agregados y disociados sin datos personales; y palancas en las atribuciones del INE.",
    relation: "Asegura certeza, legalidad, imparcialidad, objetividad y máxima publicidad en el ejercicio de simulación.",
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
    body: "Porcentaje de la lista nominal que se espera que no acuda a votar en la elección federal de 2027 según el modelo estadístico de Atalaya Electoral.",
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
    title: "Vista 3D",
    body: "Los estados y municipios se levantan como bloques cuya altura es su índice de riesgo (rojo más alto que verde; en Cambio Δ, el tamaño del cambio). En vista nacional se levantan los estados; al acercarte a un estado se levantan solo sus municipios y el resto queda plano para ver el contexto. Si seleccionas un estado, ese queda en foco. Inclinada para apreciar alturas, Cenital para ver desde arriba. No es topografía.",
  },
  motor: {
    title: "Motor de Datos",
    body: "Fuente de datos activa: OpenSearch (búsqueda indexada en la nube) o memoria local (respaldo de alta velocidad en el servidor). Ambos entregan exactamente los mismos resultados.",
  },
  asistente: {
    title: "Asistente de Atalaya Electoral",
    body: "Asistente enfocado exclusivamente en participación y abstención ciudadana con los datos oficiales de Atalaya Electoral. Cada cifra proviene de los cálculos del sistema; no emite opiniones partidistas ni genera código.",
  },
  "ranking.orden": {
    title: "Criterio de ordenación",
    body: "Permite ordenar las zonas por índice de riesgo (vulnerabilidad y abstención relativa), abstención esperada (volumen absoluto de personas no votantes) o prioridad (atención sugerida entre zonas críticas rojas y naranjas).",
  },
  "ranking.csv": {
    title: "Descarga de datos (CSV)",
    body: "Descarga una tabla en formato CSV con el listado actual ordenado: clave geográfica, nombre, nivel, lista nominal, participación 2024, abstención 2027 pronosticada, abstención esperada en personas, prioridad, índice de riesgo y semáforo.",
  },
  "detalle.serie": {
    title: "Serie histórica de participación",
    body: "Muestra la participación ciudadana en elecciones federales previas (CCPC). Los años con tasa de no especificados mayor a 50 % se omiten por falta de confiabilidad estadística. La elección judicial extraordinaria 2025 se presenta por separado al tener naturaleza distinta.",
  },
  "detalle.componentes": {
    title: "Componentes del índice de riesgo",
    body: "El índice de riesgo (0–100) combina cuatro dimensiones ponderadas: 50 % abstención pronosticada, 20 % vulnerabilidad sociodemográfica, 15 % tendencia histórica a la baja y 15 % volatilidad electoral, calculadas según la posición relativa de la zona.",
  },
  "detalle.escenarios": {
    title: "Comparación de escenarios",
    body: "Contrasta el comportamiento proyectado de la zona entre el escenario Base (inercial), Intervención (con acciones focalizadas del INE) y Pesimista (caída general de participación y acentuación de tendencias).",
  },
  "comparar.resumen": {
    title: "Resumen comparativo",
    body: "Indica el cambio neto de zonas en cada color del semáforo entre el escenario base y el intervenido (por ejemplo, reducción de municipios en rojo crítico) y cuántas zonas mejoran hacia un nivel de menor riesgo.",
  },
  buscador: {
    title: "Búsqueda geográfica",
    body: "Permite localizar rápidamente cualquier estado o municipio de México por nombre o clave geográfica, sin distinción de mayúsculas, minúsculas o acentos ortográficos.",
  },
  navegacion: {
    title: "Navegación territorial",
    body: "Explora el país a tres niveles: nacional, estatal y municipal. Haz clic en una entidad para ver sus municipios y en «← México» en la barra de navegación para regresar a la vista nacional.",
  },
  "asistente.alcance": {
    title: "Alcance del asistente",
    body: "El asistente responde preguntas sobre participación ciudadana, abstención y semáforo 2027 con datos de Atalaya Electoral. Por diseño no genera código ni scripts, no opina sobre partidos o candidaturas, ni procesa datos personales.",
  },
  guia: {
    title: "Guía de uso del tablero",
    body: "1. Explora el mapa nacional y su semáforo con capas arriba a la izquierda. 2. Elige un estado o busca en la barra superior. 3. Consulta el diagnóstico territorial en el panel lateral. 4. Simula intervenciones con Ajustar en la barra superior.",
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
  campaigns: "campanas",
  ambito: "ambito",
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
  const targetingCandidate = `targeting.${value}`;
  if (targetingCandidate in GLOSSARY) {
    return targetingCandidate as GlossaryKey;
  }
  return undefined;
}
