"""Unit tests for deterministic verify module (backend/atalaya/explain/verify.py)."""

from __future__ import annotations

import httpx
import pytest

from atalaya.explain import verify
from atalaya.explain.verify import (
    CorpusDoc,
    fetch_corpus,
    fold,
    html_to_text,
    is_electoral_relevant,
    mentions_zone,
    quote_in_text,
    rank_candidates,
    verify_finding,
)
from atalaya.websearch import NewsCandidate


def test_fold_accents_and_quotes():
    """fold strips accents, converts to lowercase, normalizes quotes/dashes, collapses spaces."""
    raw = "«¡Elección 2024: Quintana Roo—Cancún! ¿Por qué subió 5.3%?»"
    folded = fold(raw)
    assert folded == "eleccion 2024 quintana roo cancun por que subio 5 3"

    quotes_sample = '“Comillas dobles”, ‘comillas simples’, «latinas», „alemanas“ y -guiones--largos—em.'
    assert "comillas dobles" in fold(quotes_sample)
    assert "comillas simples" in fold(quotes_sample)
    assert "guiones largos em" in fold(quotes_sample)


def test_html_to_text_cleans_tags():
    """html_to_text strips script, style, nav, footer, aside, and normalizes spacing."""
    html_doc = """
    <!DOCTYPE html>
    <html>
      <head>
        <title>Noticia</title>
        <style>body { color: red; }</style>
        <script>alert("test");</script>
      </head>
      <body>
        <nav><a href="/">Inicio</a></nav>
        <header><h1>Encabezado del medio</h1></header>
        <article>
          <p>Primer párrafo sobre las elecciones en Quintana Roo.</p>
          <aside>Publicidad molesta</aside>
          <p>Segundo párrafo con datos oficiales del INE.</p>
        </article>
        <footer>Pie de página con derechos reservados</footer>
      </body>
    </html>
    """
    clean = html_to_text(html_doc)
    assert "alert" not in clean
    assert "color: red" not in clean
    assert "Inicio" not in clean
    assert "Publicidad molesta" not in clean
    assert "Pie de página" not in clean
    assert "Primer párrafo sobre las elecciones en Quintana Roo." in clean
    assert "Segundo párrafo con datos oficiales del INE." in clean


def test_quote_in_text_exact_and_4grams():
    """quote_in_text handles exact quote and quote with slightly different punctuation/sign via 4-grams."""
    article = (
        "En el municipio de Ocosingo se registro una abstencion historica del cincuenta por ciento "
        "debido a la gran distancia entre comunidades rurales y las casillas electorales instaladas "
        "por las autoridades del distrito electoral."
    )

    # Exact quote (10 words)
    exact_q = "se registro una abstencion historica del cincuenta por ciento debido a la"
    assert quote_in_text(exact_q, article) is True

    # Quote with slight punctuation / sign deviation (accents or comma)
    slight_diff_q = "se registró una abstención histórica del cincuenta por ciento, debido a la"
    assert quote_in_text(slight_diff_q, article) is True

    # Quote too short (< 6 words)
    short_q = "abstencion historica del cincuenta"
    assert quote_in_text(short_q, article) is False

    # Invented quote
    invented_q = "la participacion ciudadana aumento de manera masiva en las escuelas secundarias"
    assert quote_in_text(invented_q, article) is False


def test_verify_finding_cita_verificada():
    """Exact quote in page doc that mentions zone yields cita_verificada."""
    doc = CorpusDoc(
        id="s1",
        url="https://eluniversal.com.mx/noticia",
        title="Elección en Ocosingo",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-05",
        tier="medio_reconocido",
        text=(
            "En Ocosingo Chiapas los votantes enfrentaron largas distancias para llegar a las casillas. "
            "Un reporte local confirmo que las brigadas comunitarias no lograron cubrir todas las localidades."
        ),
        from_page=True,
    )
    docs = {"s1": doc}
    zone_names = ["Ocosingo", "Chiapas"]

    raw = {
        "title": "Distancia a casillas rurales",
        "summary": "Votantes tuvieron que trasladarse grandes distancias.",
        "quote": "los votantes enfrentaron largas distancias para llegar a las casillas",
        "evidence": ["s1"],
    }

    verif, q = verify_finding(raw, docs, zone_names)
    assert verif == "cita_verificada"
    assert q == "los votantes enfrentaron largas distancias para llegar a las casillas"


def test_verify_finding_zone_not_mentioned():
    """Page that does not mention the zone cannot yield cita_verificada."""
    doc = CorpusDoc(
        id="s1",
        url="https://reforma.com/nacional",
        title="Reporte electoral",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-05",
        tier="medio_reconocido",
        text=(
            "A nivel nacional se observo que los votantes enfrentaron largas distancias para llegar a las casillas "
            "en diversos municipios del norte del pais."
        ),
        from_page=True,
    )
    docs = {"s1": doc}
    zone_names = ["Ocosingo", "Chiapas"]

    raw = {
        "title": "Distancia a casillas rurales",
        "summary": "Votantes tuvieron que trasladarse grandes distancias.",
        "quote": "los votantes enfrentaron largas distancias para llegar a las casillas",
        "evidence": ["s1"],
    }

    verif, q = verify_finding(raw, docs, zone_names)
    assert verif != "cita_verificada"


def test_verify_finding_cifras_inventadas():
    """Number in summary absent from doc text triggers sin_verificar."""
    doc = CorpusDoc(
        id="s1",
        url="https://eluniversal.com.mx/noticia",
        title="Elección en Ocosingo",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-05",
        tier="medio_reconocido",
        text="En Ocosingo Chiapas la abstencion fue sumamente alta debido a la dispersion comunitaria.",
        from_page=True,
    )
    docs = {"s1": doc}
    zone_names = ["Ocosingo", "Chiapas"]

    # Summary invents 45.8% which never appears in doc
    raw = {
        "title": "Alta abstención",
        "summary": "En el municipio se registró un 45.8% de abstención total.",
        "quote": "la abstencion fue sumamente alta debido a la dispersion comunitaria",
        "evidence": ["s1"],
    }

    verif, q = verify_finding(raw, docs, zone_names)
    assert verif == "sin_verificar"
    assert q is None


def test_verify_finding_fuente_verificada_snippet():
    """Snippet from aggregator doc (from_page=False) yields fuente_verificada."""
    doc = CorpusDoc(
        id="s2",
        url="https://news.google.com/articles/123",
        title="Participación cívica",
        domain="news.google.com",
        outlet="Google News",
        published="2024-05-01",
        tier="medio_reconocido",
        text="Reporte INE: se detectaron dificultades de acceso a casillas comunitarias en varias secciones.",
        from_page=False,
    )
    docs = {"s2": doc}
    zone_names = ["Toluca"]

    raw = {
        "title": "Dificultad de acceso",
        "summary": "Problemas de acceso a casillas comunitarias.",
        "quote": "se detectaron dificultades de acceso a casillas comunitarias",
        "evidence": ["s2"],
    }

    verif, q = verify_finding(raw, docs, zone_names)
    assert verif == "fuente_verificada"
    assert q == "se detectaron dificultades de acceso a casillas comunitarias"


def test_fetch_corpus_mock():
    """fetch_corpus parses HTML, rejects PDF, truncates 2 MB, and handles aggregators."""
    candidates = [
        NewsCandidate(
            title="Elecciones en Cancún",
            url="https://eluniversal.com.mx/cancun",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-06-01",
            snippet="Snippet Cancún",
            provider="google_news",
        ),
        NewsCandidate(
            title="Documento PDF Técnico",
            url="https://reforma.com/reporte.pdf",
            domain="reforma.com",
            outlet="Reforma",
            published="2024-06-02",
            snippet="PDF snippet",
            provider="google_news",
        ),
        NewsCandidate(
            title="Noticia Agregador Sin Resolver",
            url="https://news.google.com/aggregator-story",
            domain="news.google.com",
            outlet="Google News",
            published="2024-06-03",
            snippet="Snippet de agregador",
            provider="google_news",
        ),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "cancun" in url_str:
            html = (
                "<html><body>"
                "<p>Texto general sin zona.</p>"
                "<p>En Cancún Quintana Roo la participación fue histórica con amplia presencia juvenil.</p>"
                "</body></html>"
            )
            return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=html)
        if "reporte.pdf" in url_str:
            return httpx.Response(200, headers={"Content-Type": "application/pdf"}, content=b"%PDF-1.4...")
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    zone_names = ["Cancún", "Quintana Roo"]

    docs = fetch_corpus(candidates, zone_names=zone_names, client=client)

    # 3 candidates processed:
    # 1. eluniversal -> text/html, from_page=True, mentions_zone=True
    # 2. reforma.pdf -> content-type application/pdf -> fallback snippet, from_page=False
    # 3. news.google.com -> unresolved aggregator -> from_page=False
    assert len(docs) >= 2
    # Document mentioning zone must be sorted first: id='s1'
    assert docs[0].id == "s1"
    assert docs[0].from_page is True
    assert "Cancún" in docs[0].text
    assert mentions_zone(docs[0].text, zone_names) is True


def test_verify_finding_non_electoral_rejected():
    """Finding with verified quote but without electoral term yields sin_verificar."""
    doc = CorpusDoc(
        id="s1",
        url="https://vanguardia.com.mx/noticia",
        title="Omisión legislativa en acciones afirmativas",
        domain="vanguardia.com.mx",
        outlet="Vanguardia",
        published="2024-06-05",
        tier="medio_reconocido",
        text=(
            "En Quintana Roo se señalo una omision legislativa sobre personas con discapacidad. "
            "Organizaciones civiles de Quintana Roo exigieron adecuar las normas locales."
        ),
        from_page=True,
    )
    docs = {"s1": doc}
    zone_names = ["Quintana Roo"]

    raw = {
        "title": "Omisión legislativa sobre personas con discapacidad",
        "summary": "Organizaciones civiles exigieron adecuar las normas locales.",
        "quote": "Organizaciones civiles de Quintana Roo exigieron adecuar las normas locales",
        "evidence": ["s1"],
    }

    verif, q = verify_finding(raw, docs, zone_names)
    assert verif == "sin_verificar"
    assert q is None


def test_is_electoral_relevant_ine_word_boundary():
    """Word 'línea' does not count as electoral term 'ine', but standalone 'ine' does."""
    finding_linea = {
        "title": "Apertura de nueva línea de atención",
        "summary": "El servicio telefónico de la línea opera en la zona.",
        "quote": "nueva línea de atención para usuarios",
    }
    doc_linea = "Se inauguró una nueva línea telefónica para reportes en la localidad."
    assert is_electoral_relevant(finding_linea, doc_linea) is False

    finding_ine = {
        "title": "Módulos de credencialización",
        "summary": "El INE anuncio apertura de módulos.",
        "quote": "el INE anuncio apertura de módulos",
    }
    doc_ine = "El INE desplegó personal para atender solicitudes de credencial."
    assert is_electoral_relevant(finding_ine, doc_ine) is True


def test_verify_finding_menu_single_mention_rejected():
    """Doc that only mentions the zone once in a menu/breadcrumb yields unverified."""
    doc = CorpusDoc(
        id="s1",
        url="https://reforma.com/noticia",
        title="Jornada cívica y casillas",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-05",
        tier="medio_reconocido",
        text=(
            "Inicio | Quintana Roo | Portada. "
            "La jornada electoral transcurrió con afluencia constante de votantes en las casillas instaladas."
        ),
        from_page=True,
    )
    docs = {"s1": doc}
    zone_names = ["Quintana Roo"]

    raw = {
        "title": "Afluencia de votantes",
        "summary": "Votantes acudieron a las casillas instaladas.",
        "quote": "con afluencia constante de votantes en las casillas instaladas",
        "evidence": ["s1"],
    }

    # Only 1 mention in text and 0 in title => mentions_zone is False
    assert mentions_zone(doc, zone_names) is False
    verif, q = verify_finding(raw, docs, zone_names)
    assert verif == "sin_verificar"
    assert q is None


def test_fetch_corpus_google_news_decoded():
    """fetch_corpus decodes Google News candidate URL and fetches HTML from destination domain."""
    from atalaya import websearch

    websearch.clear_decode_cache()

    cand = NewsCandidate(
        title="Elecciones en Quintana Roo",
        url="https://news.google.com/rss/articles/CBMi_QR_TEST",
        domain="news.google.com",
        outlet="Google News",
        published="2024-06-01",
        snippet="Snippet de Quintana Roo",
        provider="google_news",
    )

    article_html = (
        "<html><body>"
        "<p>En Quintana Roo los votantes acudieron masivamente a las urnas y casillas instaladas por el INE.</p>"
        "<p>La jornada electoral en Quintana Roo transcurrió con gran entusiasmo ciudadano.</p>"
        "</body></html>"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "rss/articles/CBMi_QR_TEST" in url_str:
            return httpx.Response(200, text='<html><div data-n-a-sg="sig_qr" data-n-a-ts="1710000000"></div></html>')
        if "batchexecute" in url_str:
            dest = "https://eluniversal.com.mx/estados/elecciones-quintana-roo"
            resp = f')}}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"{dest}\\",1]",null,null,null,"generic"]]'
            return httpx.Response(200, text=resp)
        if "elecciones-quintana-roo" in url_str:
            return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=article_html)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    zone_names = ["Quintana Roo"]

    docs = fetch_corpus([cand], zone_names=zone_names, client=client)
    assert len(docs) == 1
    doc = docs[0]
    assert doc.from_page is True
    assert doc.domain == "eluniversal.com.mx"
    assert doc.url == "https://eluniversal.com.mx/estados/elecciones-quintana-roo"
    assert "casillas instaladas" in doc.text


def test_rank_candidates_local_causal_beats_national():
    """Local causal note (e.g. Playa del Carmen for Quintana Roo) ranks above national institutional note."""
    local_cand = NewsCandidate(
        title="Abstención en Playa del Carmen, Quintana Roo",
        url="https://eluniversal.com.mx/qr-abstencion",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-05",
        snippet="Se reportó abstención y baja participación de votantes en casillas instaladas.",
        provider="google_news",
    )
    national_cand = NewsCandidate(
        title="INE aprueba conteo rápido 2027",
        url="https://reforma.com/ine-conteo",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-05",
        snippet="El consejo general del INE aprobó el presupuesto y licitación de contratos.",
        provider="google_news",
    )

    ranked = rank_candidates([national_cand, local_cand], zone_names=["Quintana Roo"], state_name=None)
    assert len(ranked) == 1
    assert ranked[0].title == local_cand.title


def test_rank_candidates_no_zone_no_state_discarded():
    """A note without zone or state mention is discarded even with causal terms."""
    generic_cand = NewsCandidate(
        title="Participación y abstención de jóvenes en las elecciones",
        url="https://eluniversal.com.mx/generica",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-05",
        snippet="Ciudadanos acuden a votar a las casillas con su credencial.",
        provider="google_news",
    )

    ranked = rank_candidates([generic_cand], zone_names=["Quintana Roo"], state_name=None)
    assert ranked == []


def test_rank_candidates_stable_order():
    """Candidates with equal scores and tiebreakers preserve their original relative order."""
    c1 = NewsCandidate(
        title="Casillas y notas en Quintana Roo",
        url="https://medio1.com/voto",
        domain="medio1.com",
        outlet="Medio 1",
        published="2024-06-01",
        snippet="Reporte electoral",
        provider="google_news",
    )
    c2 = NewsCandidate(
        title="Casillas y datos en Quintana Roo",
        url="https://medio2.com/casillas",
        domain="medio2.com",
        outlet="Medio 2",
        published="2024-06-01",
        snippet="Reporte electoral",
        provider="google_news",
    )

    ranked1 = rank_candidates([c1, c2], zone_names=["Quintana Roo"])
    assert [c.title for c in ranked1] == [c1.title, c2.title]

    ranked2 = rank_candidates([c2, c1], zone_names=["Quintana Roo"])
    assert [c.title for c in ranked2] == [c2.title, c1.title]


def test_rank_candidates_municipality_unprefixed():
    """Municipality matches unprefixed name (+4) vs state-only mention (+1)."""
    c_mun = NewsCandidate(
        title="Abstención en Tijuana supera expectativas",
        url="https://eluniversal.com.mx/tijuana",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-01",
        snippet="Reportan casillas vacías en la localidad.",
        provider="google_news",
    )
    c_state = NewsCandidate(
        title="Participación electoral en Baja California",
        url="https://reforma.com/bc",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-01",
        snippet="Reportan casillas en diversas zonas.",
        provider="google_news",
    )
    c_national = NewsCandidate(
        title="INE aprueba presupuesto nacional",
        url="https://reforma.com/ine",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-01",
        snippet="Consejeros debaten licitaciones.",
        provider="google_news",
    )

    ranked = rank_candidates(
        [c_national, c_state, c_mun],
        zone_names=["Municipio de Tijuana"],
        state_name="Baja California",
    )
    assert len(ranked) == 2
    assert ranked[0].title == c_mun.title
    assert ranked[1].title == c_state.title


def test_rank_candidates_tiebreakers_tier_and_date():
    """Tiebreakers prioritize better verifiable tier, then newer publication date."""
    # Tier tiebreaker
    c_oficial = NewsCandidate(
        title="Casillas en Zacatecas boletín oficial",
        url="https://ine.mx/casillas-zac",
        domain="ine.mx",
        outlet="INE",
        published="2024-01-01",
        snippet="Informe",
        provider="google_news",
    )
    c_medio = NewsCandidate(
        title="Casillas en Zacatecas reporte periodístico",
        url="https://eluniversal.com.mx/casillas-zac",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-01-01",
        snippet="Informe",
        provider="google_news",
    )
    ranked_tier = rank_candidates([c_medio, c_oficial], zone_names=["Zacatecas"])
    assert ranked_tier[0].title == c_oficial.title

    # Date tiebreaker (both medio_reconocido)
    c_older = NewsCandidate(
        title="Participación en Zacatecas nota antigua",
        url="https://eluniversal.com.mx/antigua",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-01-01",
        snippet="Informe",
        provider="google_news",
    )
    c_newer = NewsCandidate(
        title="Participación en Zacatecas nota reciente",
        url="https://reforma.com/reciente",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-05",
        snippet="Informe",
        provider="google_news",
    )
    ranked_date = rank_candidates([c_older, c_newer], zone_names=["Zacatecas"])
    assert ranked_date[0].title == c_newer.title


def test_rank_candidates_dedup_normalized_title():
    """Normalized duplicate titles are deduplicated keeping the higher-priority item."""
    c_lower = NewsCandidate(
        title="Elección en Cancún, Quintana Roo",
        url="https://reforma.com/cancun",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-01-01",
        snippet="Casillas y votación",
        provider="google_news",
    )
    c_higher = NewsCandidate(
        title="«Elección en Cancún, Quintana Roo!»",
        url="https://ine.mx/cancun",
        domain="ine.mx",
        outlet="INE",
        published="2024-06-01",
        snippet="Casillas y votación",
        provider="google_news",
    )
    ranked = rank_candidates([c_lower, c_higher], zone_names=["Quintana Roo"])
    assert len(ranked) == 1
    assert ranked[0].domain == "ine.mx"

