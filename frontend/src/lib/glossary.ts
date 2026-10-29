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
  // Inteligencia (Ola 1 · W1-H)
  plan_campana: {
    title: "Plan Estratégico de Campaña",
    body: "Propuesta operativa integral para reducir la abstención en un estado o municipio prioritario. Combina diagnóstico territorial, investigación de causas documentadas y propuestas focalizadas sobre las atribuciones del INE.",
    relation: "Se genera a partir del diagnóstico de Atalaya y orienta las acciones cívicas en campo.",
    example: "Plan Chiapas 2027: atención prioritaria a jóvenes y casillas extraordinarias comunitarias.",
  },
  investigacion_gemini: {
    title: "Investigación Asistida con Gemini",
    body: "Búsqueda automatizada con Gemini 3.8 Flash conectada a Google Search. Rastrea causas documentadas del abstencionismo local en fuentes rigurosamente verificadas de los últimos 6 años.",
    relation: "Aporta evidencia contrastable antes de formular cualquier propuesta de intervención.",
    example: "Rastreo de dispersión geográfica y barreras de transporte en la región Selva de Chiapas.",
  },
  fuentes_verificadas: {
    title: "Fuentes Verificadas",
    body: "Repositorios documentales y medios institucionales admitidos: acuerdos del INE, informes censales del INEGI, publicaciones académicas (UNAM, CIDE, Colmex) y medios informativos reconocidos.",
    relation: "Toda afirmación y propuesta del plan debe respaldarse en al menos una fuente verificada.",
    example: "Estudios CCPC del INE y resultados censales de población y vivienda 2020 de INEGI.",
  },
  nivel_verificacion: {
    title: "Nivel de Verificación de Fuentes",
    body: "Clasificación jerárquica del sustento documental: oficial (INE, OPLEs, dependencias públicas), verificador acreditado, académico o medio reconocido. Excluye redes sociales y fuentes no institucionales.",
    relation: "Garantiza la trazabilidad, imparcialidad y objetividad técnica del diagnóstico.",
    example: "Un informe de la Junta Local Ejecutiva tiene nivel de verificación oficial.",
  },
  hallazgo: {
    title: "Hallazgo Documentado",
    body: "Causa específica y comprobada de baja participación identificada en la investigación local (por ejemplo, distancia física a casillas, brecha de credencialización en jóvenes o barreras lingüísticas).",
    relation: "Cada propuesta de campaña debe atender al menos un hallazgo documentado.",
    example: "Jóvenes de 18 a 24 años presentan una participación 8.6 pp menor al promedio estatal.",
  },
  grupo_objetivo: {
    title: "Grupo Objetivo Prioritario",
    body: "Segmento del electorado hacia el que se orientan las acciones de promoción (jóvenes universitarios, población rural aislada o comunidades indígenas bilingües).",
    relation: "El tamaño poblacional se calcula con datos oficiales del censo o lista nominal.",
    example: "622,900 electores de 18 a 24 años en cabeceras distritales de alta marginación.",
  },
  propuesta_palanca: {
    title: "Propuesta por Palanca",
    body: "Acción táctica asociada a una de las cuatro palancas de intervención del INE: promoción del voto joven, casillas rurales, materiales en lenguas originarias o campaña general.",
    relation: "Cada propuesta se vincula con la metodología cuantitativa del simulador.",
    example: "Instalación de casillas extraordinarias comunitarias y esquemas de apoyo a la movilidad.",
  },
  impacto_simulado: {
    title: "Impacto Simulado en Participación",
    body: "Cálculo matemático de votos adicionales y reducción de abstención que lograría la estrategia, aplicando rendimientos decrecientes y ponderación sociodemográfica.",
    relation: "Traduce las propuestas cualitativas en estimaciones cuantitativas para la toma de decisiones.",
    example: "+180,720 votos estimados y reducción neta de 4.7 pp en la abstención de Chiapas.",
  },
  diapositivas_editables: {
    title: "Diapositivas Ejecutivas Editables",
    body: "Estructura de presentación en 10 diapositivas adaptada a los lineamientos del INE, exportable a PowerPoint (PPTX) y PDF. Permite modificar textos, viñetas y notas de orador antes de descargar.",
    relation: "Facilita la difusión ejecutiva y discusión técnica en comisiones y juntas ejecutivas.",
    example: "Ajuste de metas y fechas clave en la diapositiva de implementación operativa.",
  },
  sesion: {
    title: "Inicio de Sesión y Control de Acceso",
    body: "Mecanismo de autenticación institucional mediante usuario y contraseña seguros contra ataques de fuerza bruta. Toda la plataforma exige una sesión activa que desbloquea las funciones de investigación, escaneo de medios y registro oficial.",
    relation: "La protección opera en el servidor mediante cookies HttpOnly; tras iniciar sesión, todas las herramientas quedan habilitadas.",
    example: "Bloqueo temporal automático por usuario o dirección IP tras múltiples intentos fallidos de acceso.",
  },
  monitor_ine: {
    title: "Monitor Institucional de Medios",
    body: "Módulo de alerta temprana que detecta noticias desfavorables, rumores y campañas de desinformación sobre el INE, evaluando su veracidad, viralidad y riesgo de desmovilización ciudadana.",
    relation: "Permite una respuesta institucional ágil y neutral con base en evidencia técnica.",
    example: "Monitoreo continuo de desinformación sobre sedes de votación y vigencia de credenciales.",
  },
  veredicto: {
    title: "Veredicto de Veracidad",
    body: "Calificación analítica de una afirmación pública: verdadera (respaldada en hechos oficiales), falsa (desmentida por verificadores), engañosa (hechos distorsionados) o sin verificar (en revisión).",
    relation: "Determina la ruta de atención institucional: comunicado, corrección o desmentido.",
    example: "Clasificación de un rumor sobre costos de credencial como afirmación falsa.",
  },
  noticia_verdadera: {
    title: "Noticia Crítica Verdadera",
    body: "Información verificada que reporta dificultades reales de operación, ajustes presupuestales o contingencias del proceso electoral, con potencial de inhibir la asistencia ciudadana.",
    relation: "Detona el cálculo de impacto territorial realista en puntos de abstención.",
    example: "Ajustes de itinerario en módulos móviles por reducciones presupuestales regionales.",
  },
  fake_news: {
    title: "Noticia Falsa (Desinformación)",
    body: "Afirmación sin sustento fáctico difundida deliberadamente o por error para sembrar desconfianza en la autoridad electoral, entorpecer el voto o promover fraudes.",
    relation: "Activa la medición de viralidad y el diseño de desmentidos oficiales (#INEdesmiente).",
    example: "Mensajes que afirman la anulación anticipada de credenciales vigentes.",
  },
  noticia_enganosa: {
    title: "Noticia Engañosa",
    body: "Narrativa que toma un dato verdadero pero omite contexto, manipula plazos o presenta interpretaciones tendenciosas que confunden al electorado.",
    relation: "Requiere respuestas aclaratorias y contextualizadas en los canales donde circula.",
    example: "Presentar la reubicación ordinaria de una casilla por remodelación como supresión del voto.",
  },
  sin_verificar: {
    title: "Información Sin Verificar",
    body: "Contenido reciente o rumor incipiente que carece de sustento documental o posicionamiento de verificadores acreditados, sujeto a monitoreo preventivo.",
    relation: "Se mantiene en seguimiento para evitar respuestas prematuras que amplifiquen el rumor.",
    example: "Reportes aislados en mensajería privada sobre presunta saturación del portal de citas.",
  },
  impacto_noticia: {
    title: "Impacto Territorial de la Noticia",
    body: "Efecto estimado en puntos porcentuales de abstención en las entidades o municipios expuestos a una noticia verdadera, ponderado por susceptibilidad local y lejanía de la elección.",
    relation: "Mide cuántos votos potenciales podrían perderse si no se toman medidas correctivas.",
    example: "Aumento proyectado de 0.48 pp de abstención en municipios con alta marginación.",
  },
  decaimiento_noticia: {
    title: "Decaimiento Temporal del Impacto",
    body: "Factor matemático que reduce la influencia de una noticia conforme transcurre el tiempo hasta la elección de junio de 2027. Distingue entre eventos coyunturales, persistentes y estructurales.",
    relation: "Evita sobrestimar el impacto de controversias pasajeras frente a problemas de fondo.",
    example: "Una nota coyuntural de 2026 decae exponencialmente hacia la jornada de 2027.",
  },
  exposicion: {
    title: "Nivel de Exposición Territorial",
    body: "Grado en que la población de un territorio recibe la información según su alcance geográfico (nacional, estatal o municipal) y la penetración de internet en la zona.",
    relation: "Pondera el impacto potencial: sin exposición informativa no hay afectación electoral.",
    example: "Exposición plena en los estados directamente mencionados en la cobertura informativa.",
  },
  susceptibilidad: {
    title: "Susceptibilidad Electoral Territorial",
    body: "Propensión de un municipio o estado a resentir una noticia según su perfil sociodemográfico y electoral (volatilidad previa, conectividad, proporción de jóvenes o ruralidad).",
    relation: "Multiplica el impacto en zonas más frágiles frente a la temática en cuestión.",
    example: "Zonas con alta volatilidad histórica presentan mayor susceptibilidad a controversias.",
  },
  viralidad: {
    title: "Índice de Viralidad Digital",
    body: "Puntuación de 0 a 100 que mide la propagación de una afirmación en redes sociales según reproducciones, compartidos, comentarios, plataformas involucradas y aceleración temporal.",
    relation: "Permite jerarquizar qué desinformaciones ameritan desmentido urgente antes de propagarse.",
    example: "Un rumor con 1.2 millones de vistas y tracción en TikTok y X alcanza viralidad crítica.",
  },
  riesgo_ignorar: {
    title: "Riesgo de Ignorar la Desinformación",
    body: "Consecuencias de no intervenir ante falsedades virales: consolida la versión falsa como única referencia, debilita la confianza institucional y puede desmovilizar votantes en la jornada.",
    relation: "Justifica técnicamente los plazos perentorios de respuesta (de 12 a 48 horas).",
    example: "Permitir que un rumor sobre credenciales desmovilice a electores desinformados.",
  },
  severidad: {
    title: "Nivel de Severidad Institucional",
    body: "Clasificación integral (baja, media, alta, crítica) que combina el impacto en votos de noticias verdaderas o el índice de viralidad y gravedad temática de noticias falsas.",
    relation: "Determina la jerarquía de atención, las acciones inmediatas y los plazos límite.",
    example: "Una falsedad viral sobre requisitos de votación se clasifica como severidad crítica.",
  },
  accion_remediacion: {
    title: "Acción de Remediación Sugerida",
    body: "Medida institucional recomendada ante un incidente informativo: registro preventivo, comunicado oficial, campaña de intervención, respuesta en redes o desmentido formal.",
    relation: "Guía a las áreas de comunicación social y capacitación para mitigar el daño electoral.",
    example: "Emisión urgente de cápsula oficial #INEdesmiente y reporte directo a la plataforma.",
  },
  registro_ine: {
    title: "Registro Inmutable de Enterado",
    body: "Bitácora cronológica e inalterable donde el personal operador del INE registra que la institución tuvo conocimiento de un evento informativo y documenta las medidas adoptadas.",
    relation: "Garantiza certeza, rendición de cuentas interna y trazabilidad de las decisiones.",
    example: "Asignación del estado 'comunicado_emitido' con fecha, hora e identificador de operador.",
  },
  fragmento_mapa: {
    title: "Fragmento Cartográfico 2D",
    body: "Visualización vectorial enfocada exclusivamente en los estados o municipios afectados por una noticia o campaña, con escala secuencial de impacto y contexto limítrofe tenue.",
    relation: "Permite inspeccionar con precisión el territorio bajo análisis sin saturación visual.",
    example: "Fragmento de Chiapas, Oaxaca y Guerrero coloreado según el incremento de abstención.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossaryFor(key: string): GlossaryEntry | undefined {
  if (key === "clave_operador") {
    return GLOSSARY["sesion"];
  }
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
