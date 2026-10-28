"""Deterministic virality scoring and projection model for social media posts."""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any

from atalaya.intel.schemas import (
    Engagement,
    NewsTopic,
    Platform,
    SeverityLevel,
    SocialPost,
    Virality,
)


def _parse_iso_date(val: str | None) -> datetime | None:
    """Safely parse ISO datetime or date string into a timezone-naive datetime."""
    if not val or not isinstance(val, str):
        return None
    cleaned = val.strip()
    if not cleaned:
        return None
    # Strip trailing Z if present
    if cleaned.endswith("Z") or cleaned.endswith("z"):
        cleaned = cleaned[:-1]
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        # Fallback to date only format
        try:
            return datetime.strptime(cleaned[:10], "%Y-%m-%d")
        except Exception:
            return None


def _calc_post_interaction(post: SocialPost) -> float:
    """Calculate interaction score e for a single post: 3*shares + 2*comments + likes + 0.05*views."""
    eng = post.engagement
    if eng is None:
        return 50.0

    likes = eng.likes
    shares = eng.shares
    comments = eng.comments
    views = eng.views

    # If all metrics are unknown / None -> fallback to minimum evidence: e = 50
    if likes is None and shares is None and comments is None and views is None:
        return 50.0

    return (
        3.0 * float(shares or 0)
        + 2.0 * float(comments or 0)
        + 1.0 * float(likes or 0)
        + 0.05 * float(views or 0)
    )


def virality(
    posts: list[SocialPost],
    *,
    topic: NewsTopic,
    today: datetime | None = None,
) -> Virality:
    """Compute virality score, risk of ignoring, and 7-day trajectory for social claims."""
    ref_today = today or datetime.now()
    if ref_today.tzinfo is not None:
        ref_today = ref_today.astimezone(timezone.utc).replace(tzinfo=None)

    if not posts:
        return Virality(
            score=0,
            level="baja",
            platforms=[],
            posts=[],
            reach_estimate=None,
            growth="desconocido",
            projected_score_7d=8,
            basis=["Sin publicaciones sociales registradas."],
            ignore_risk="Sin riesgo aparente al no detectarse publicaciones activas.",
        )

    # 1. Unique platforms preserving order of appearance
    platforms: list[Platform] = []
    seen_platforms = set()
    for p in posts:
        if p.platform not in seen_platforms:
            seen_platforms.add(p.platform)
            platforms.append(p.platform)

    n_platforms = len(platforms)
    n_posts = len(posts)

    # 2. Sum of interactions e
    e_total = sum(_calc_post_interaction(p) for p in posts)

    # 3. Recency bonus R and date parsing
    dated_posts: list[datetime] = []
    for p in posts:
        p_dt = _parse_iso_date(p.published)
        if p_dt is not None:
            dated_posts.append(p_dt)

    min_age_hours: float | None = None
    if dated_posts:
        ages = [(ref_today - p_dt).total_seconds() / 3600.0 for p_dt in dated_posts]
        # Only consider valid non-future dates
        valid_ages = [a for a in ages if a >= 0]
        if valid_ages:
            min_age_hours = min(valid_ages)

    R = 0
    if min_age_hours is not None:
        if min_age_hours <= 48.0:
            R = 10
        elif min_age_hours <= 168.0:  # 7 days
            R = 5

    # 4. Score calculation: min(100, round(22*log10(1+Σe) + 8*(n_plataformas-1) + 4*min(n_posts,5) + R))
    raw_score = 22.0 * math.log10(1.0 + e_total) + 8.0 * (n_platforms - 1) + 4.0 * min(n_posts, 5) + R
    score = max(0, min(100, int(round(raw_score))))

    # 5. Severity level classification
    if score < 25:
        level: SeverityLevel = "baja"
    elif score < 50:
        level = "media"
    elif score < 75:
        level = "alta"
    else:
        level = "critica"

    # 6. Growth trend calculation: last 48h vs previous 120h (hours 48 to 168)
    if len(dated_posts) < 2:
        growth = "desconocido"
    else:
        w1_count = 0
        w2_count = 0
        for p_dt in dated_posts:
            age_s = (ref_today - p_dt).total_seconds()
            if 0 <= age_s <= 48.0 * 3600.0:
                w1_count += 1
            elif 48.0 * 3600.0 < age_s <= 168.0 * 3600.0:
                w2_count += 1

        if w1_count > w2_count:
            growth = "creciente"
        elif w1_count == w2_count:
            growth = "estable"
        else:
            growth = "decreciente"

    # 7. Projected score in 7 days if ignored (+15 / +5 / -10 / +8)
    growth_deltas = {
        "creciente": 15,
        "estable": 5,
        "decreciente": -10,
        "desconocido": 8,
    }
    projected_score_7d = max(0, min(100, score + growth_deltas[growth]))

    # 8. Reach estimate (sum of known views)
    known_views = [p.engagement.views for p in posts if p.engagement and p.engagement.views is not None]
    reach_estimate = sum(known_views) if known_views else None

    # 9. Basis explanation signals
    basis: list[str] = [
        f"{n_posts} publicación(es) monitoreada(s) en {n_platforms} plataforma(s) ({', '.join(platforms)}).",
        f"Interacciones estimadas (Σe): {round(e_total, 1)}.",
    ]
    if min_age_hours is not None:
        basis.append(f"Publicación más reciente detectada hace {round(min_age_hours, 1)} h (bono de recencia: +{R} pts).")
    else:
        basis.append("Publicaciones sin fecha verificada (bono de recencia: 0 pts).")
    basis.append(f"Dinámica de crecimiento: {growth} (proyección a 7 días: {projected_score_7d} pts).")

    # 10. Risk of ignoring template
    if topic in ("procedimiento_votacion", "credencial_padron"):
        ignore_risk = (
            f"La narrativa desinforma directamente sobre el procedimiento de votación o la credencial. "
            f"Al alcanzar un nivel de viralidad '{level}', ignorarla puede desmovilizar directamente al electorado "
            "o provocar que ciudadanos acudan con documentación inválida o a sedes incorrectas."
        )
    elif topic in ("resultados_fraude", "organizacion_casillas", "confianza_institucional"):
        ignore_risk = (
            f"La afirmación erosiona la confianza ciudadana en la certeza de las elecciones. "
            f"Ignorarla en nivel '{level}' la consolida como la única versión disponible en redes, "
            "sembrando sospechas infundadas sobre la integridad del proceso y del cómputo oficial."
        )
    else:
        ignore_risk = (
            f"El contenido genera desinformación sobre funcionarios o presupuesto institucional. "
            f"Al superar el umbral de viralidad '{level}', no desmentirlo permite que el rumor se fije en la opinión pública "
            "sin contraparte técnica institucional verificada."
        )

    return Virality(
        score=score,
        level=level,
        platforms=platforms,
        posts=posts,
        reach_estimate=reach_estimate,
        growth=growth,
        projected_score_7d=projected_score_7d,
        basis=basis,
        ignore_risk=ignore_risk,
    )
