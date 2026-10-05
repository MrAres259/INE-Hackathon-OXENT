"""Content and query guard for ATALAYA conversational assistant."""

from __future__ import annotations

import re

# Regular expression for Mexican CURP (18 characters)
CURP_REGEX = re.compile(r"\b[A-Za-z]{4}\d{6}[HhMm][A-Za-z]{5}[A-Za-z0-9]\d\b")

# Regular expression for Mexican Voter ID code (clave de elector - 18 alphanumeric)
CLAVE_ELECTOR_REGEX = re.compile(r"\b[A-Za-z]{6}\d{8}[HhMm]\d{3}\b")

# Patterns indicating queries requesting individual or private voter data
PERSONAL_DATA_PATTERNS = [
    r"clave\s+de\s+elector",
    r"credencial\s+de\s+elector",
    r"domicilio\s+de",
    r"tel[eé]fono\s+de",
    r"nombre(?:s)?\s+de\s+los\s+votantes",
    r"padr[oó]n\s+con\s+nombres",
    r"lista\s+con\s+nombres",
    r"qui[eé]n\s+vot[oó]",
    r"qui[eé]n\s+fue\s+a\s+votar",
    r"datos\s+personales",
    r"direcci[oó]n\s+de",
]

# Patterns requesting partisan preferences, candidates, or winner predictions
POLITICAL_PATTERNS = [
    r"por\s+qui[eé]n",
    r"qu[eé]\s+partido",
    r"cu[aá]l\s+partido",
    r"ganar[aá]",
    r"va\s+a\s+ganar",
    r"qui[eé]n\s+gana",
    r"candidat[oa]s?",
    r"preferencia(?:s)?\s+electoral(?:es)?",
    r"intenci[oó]n\s+de\s+voto",
    r"\b(?:morena|pri|prd|pvem|pt|mc|pan)\b",
]

REJECTION_PERSONAL_DATA = (
    "Por razones de privacidad y protección de datos personales, ATALAYA no almacena, "
    "gestiona ni procesa información individual, nominal ni datos personales de la ciudadanía. "
    "La plataforma opera exclusivamente con estadísticas e indicadores agregados a nivel municipal y estatal."
)

REJECTION_POLITICAL = (
    "ATALAYA es una herramienta de análisis predictivo enfocada exclusivamente en la participación "
    "ciudadana y el riesgo de abstención. No registra ni pronostica preferencias políticas, "
    "intención de voto, partidos ni candidaturas."
)


def check(message: str) -> str | None:
    """Evaluate user message against privacy and content safeguards.
    
    Returns a courteous rejection message if the query requests personal voter data,
    electoral preferences, parties or candidates. Returns None if the message passes.
    Truncates message to 1000 characters.
    """
    if not message:
        return None

    # Truncate message > 1000 chars
    text = message[:1000]

    # 1. Check for personal data (CURP, clave de elector, personal queries)
    if CURP_REGEX.search(text) or CLAVE_ELECTOR_REGEX.search(text):
        return REJECTION_PERSONAL_DATA

    for pattern in PERSONAL_DATA_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return REJECTION_PERSONAL_DATA

    # 2. Check for political preferences, candidates, or party predictions
    for pattern in POLITICAL_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return REJECTION_POLITICAL

    return None
