"""Tests for atalaya.websearch (Google News RSS and Bing News RSS parsing, filtering, deduplication, caching)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import email.utils
from pathlib import Path
import re
import httpx
import pytest

from atalaya import websearch
from atalaya.config import get_settings


@pytest.fixture(autouse=True)
def setup_websearch_env(tmp_path, monkeypatch):
    """Sandbox cache directory for websearch tests."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(websearch, "CACHE_DIR", cache_dir)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


GOOGLE_RSS_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>INE instala casillas especiales para comicios - El Universal</title>
      <link>https://news.google.com/rss/articles/CBMiREFy...test1</link>
      <pubDate>{recent_date_1}</pubDate>
      <description>&lt;a href="url"&gt;El INE reporta instalación completa de casillas.&lt;/a&gt;</description>
      <source url="https://www.eluniversal.com.mx">El Universal</source>
    </item>
    <item>
      <title>Noticia muy antigua del INE - Reforma</title>
      <link>https://news.google.com/rss/articles/CBMiREFy...old</link>
      <pubDate>{old_date}</pubDate>
      <description>Noticia de hace un ano.</description>
      <source url="https://www.reforma.com">Reforma</source>
    </item>
  </channel>
</rss>
"""

BING_RSS_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Bing News</title>
    <item>
      <title>Preparativos electorales avanzan con supervisión ciudadana</title>
      <link>https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=&amp;url=https%3A%2F%2Fwww.milenio.com%2Fpolitica%2Felecciones-mexico</link>
      <pubDate>{recent_date_2}</pubDate>
      <description>&lt;p&gt;Consejo general sesiona sobre medidas de seguridad.&lt;/p&gt;</description>
    </item>
  </channel>
</rss>
"""


def test_search_news_parsing_and_filtering(monkeypatch):
    """Google News and Bing News RSS are parsed, real URLs extracted, and old items filtered out."""
    now = datetime.now(timezone.utc)
    recent_1 = email.utils.format_datetime(now - timedelta(days=2))
    recent_2 = email.utils.format_datetime(now - timedelta(days=5))
    old = email.utils.format_datetime(now - timedelta(days=60))

    g_xml = GOOGLE_RSS_FIXTURE.format(recent_date_1=recent_1, old_date=old)
    b_xml = BING_RSS_FIXTURE.format(recent_date_2=recent_2)

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "news.google.com" in url_str:
            return httpx.Response(200, content=g_xml.encode("utf-8"))
        elif "bing.com" in url_str:
            return httpx.Response(200, content=b_xml.encode("utf-8"))
        return httpx.Response(404)

    monkeypatch.setattr(
        websearch,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    results = websearch.search_news(["elecciones ine"], days=30, max_items=10)

    # Old item (60 days ago) should be filtered out
    assert len(results) == 2

    # Check Google News item
    g_item = next(r for r in results if r.provider == "google_news")
    assert "casillas especiales" in g_item.title
    assert g_item.domain == "eluniversal.com.mx"
    assert g_item.outlet == "El Universal"
    assert "El INE reporta" in g_item.snippet
    assert "<" not in g_item.snippet

    # Check Bing News item (extracted real url from apiclick.aspx)
    b_item = next(r for r in results if r.provider == "bing_news")
    assert b_item.url == "https://www.milenio.com/politica/elecciones-mexico"
    assert b_item.domain == "milenio.com"
    assert "Consejo general" in b_item.snippet


def test_search_news_deduplication(monkeypatch):
    """Duplicate titles and URLs are deduplicated across queries."""
    now = datetime.now(timezone.utc)
    date_str = email.utils.format_datetime(now - timedelta(days=1))

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>News</title>
    <item>
      <title>INE aprueba presupuesto 2027 - Animal Politico</title>
      <link>https://animalpolitico.com/elecciones/presupuesto</link>
      <pubDate>{date_str}</pubDate>
      <source url="https://animalpolitico.com">Animal Politico</source>
    </item>
    <item>
      <title>INE aprueba presupuesto 2027</title>
      <link>https://animalpolitico.com/elecciones/presupuesto/</link>
      <pubDate>{date_str}</pubDate>
      <source url="https://animalpolitico.com">Animal Politico</source>
    </item>
  </channel>
</rss>
"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=xml.encode("utf-8"))

    monkeypatch.setattr(
        websearch,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    results = websearch.search_news(["presupuesto ine", "ine presupuesto"], days=30)
    assert len(results) == 1
    assert "presupuesto 2027" in results[0].title.lower()


def test_search_news_disk_caching(monkeypatch):
    """Subsequent call for same query hits disk cache and skips HTTP calls."""
    now = datetime.now(timezone.utc)
    date_str = email.utils.format_datetime(now - timedelta(days=1))
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>News</title>
    <item>
      <title>Cacheadable - Jornada</title>
      <link>https://jornada.com.mx/noticia</link>
      <pubDate>{date_str}</pubDate>
      <source url="https://jornada.com.mx">La Jornada</source>
    </item>
  </channel>
</rss>
"""
    http_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal http_count
        http_count += 1
        return httpx.Response(200, content=xml.encode("utf-8"))

    monkeypatch.setattr(
        websearch,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    # First call: makes HTTP requests (Google + Bing = 2)
    res1 = websearch.search_news(["noticias ine"], days=15)
    assert len(res1) >= 1
    count_after_first = http_count
    assert count_after_first > 0

    # Second call: uses cache
    res2 = websearch.search_news(["noticias ine"], days=15)
    assert len(res2) == len(res1)
    assert http_count == count_after_first


def test_search_news_error_tolerance(monkeypatch):
    """HTTP errors or timeouts return empty list without raising."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal Server Error")

    monkeypatch.setattr(
        websearch,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    results = websearch.search_news(["error query"])
    assert results == []


def test_domain_of():
    """domain_of cleans hostnames correctly."""
    assert websearch.domain_of("https://www.reforma.com/articulo") == "reforma.com"
    assert websearch.domain_of("http://gob.mx") == "gob.mx"
    assert websearch.domain_of("") == ""


def test_decode_google_news_url_success():
    """decode_google_news_url extracts signature, posts to batchexecute, and returns real publisher URL."""
    websearch.clear_decode_cache()
    article_html = '<html><head><div data-n-a-sg="sig_test_abc" data-n-a-ts="1710000000"></div></head></html>'
    batch_resp = ')]}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://medio.mx/nota\\",1]",null,null,null,"generic"]]'

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "rss/articles/GNT1" in url_str:
            return httpx.Response(200, text=article_html)
        if "batchexecute" in url_str:
            return httpx.Response(200, text=batch_resp)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = websearch.decode_google_news_url("https://news.google.com/rss/articles/GNT1", client=client)
    assert res == "https://medio.mx/nota"


def test_decode_google_news_url_no_signature():
    """Missing signature/timestamp returns None without raising."""
    websearch.clear_decode_cache()
    article_html = '<html><body>Sin firma ni timestamp</body></html>'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=article_html)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = websearch.decode_google_news_url("https://news.google.com/rss/articles/NOSIG1", client=client)
    assert res is None


def test_decode_google_news_url_non_google():
    """Non-Google URLs are returned unchanged without making requests."""
    websearch.clear_decode_cache()
    non_google = "https://medio.mx/noticia/electoral"
    res = websearch.decode_google_news_url(non_google)
    assert res == non_google


def test_decode_google_news_url_cached():
    """Second call uses cache and avoids HTTP requests."""
    websearch.clear_decode_cache()
    article_html = '<html><div data-n-a-sg="sig_test_1" data-n-a-ts="1710000000"></div></html>'
    batch_resp = ')]}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://medio.mx/nota-cache\\",1]",null,null,null,"generic"]]'
    req_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal req_count
        req_count += 1
        url_str = str(request.url)
        if "rss/articles/CACHED1" in url_str:
            return httpx.Response(200, text=article_html)
        if "batchexecute" in url_str:
            return httpx.Response(200, text=batch_resp)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res1 = websearch.decode_google_news_url("https://news.google.com/rss/articles/CACHED1", client=client)
    assert res1 == "https://medio.mx/nota-cache"
    assert req_count == 2

    # Second call hits memory cache
    res2 = websearch.decode_google_news_url("https://news.google.com/rss/articles/CACHED1", client=client)
    assert res2 == "https://medio.mx/nota-cache"
    assert req_count == 2


def test_search_news_decodes_and_respects_cap(monkeypatch):
    """search_news decodes at most 12 Google News candidates and updates url and domain."""
    websearch.clear_decode_cache()
    now = datetime.now(timezone.utc)
    date_str = email.utils.format_datetime(now - timedelta(days=1))

    # Generate RSS with 15 Google News items
    items = []
    for i in range(15):
        items.append(f"""
        <item>
          <title>Noticia electoral {i:02d} - Medio</title>
          <link>https://news.google.com/rss/articles/GNCAP_{i:02d}</link>
          <pubDate>{date_str}</pubDate>
          <source url="https://google.com">Google</source>
        </item>
        """)
    rss_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Google News</title>
        {''.join(items)}
      </channel>
    </rss>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "news.google.com/rss/search" in url_str:
            return httpx.Response(200, content=rss_xml.encode("utf-8"))
        if "rss/articles/GNCAP_" in url_str:
            return httpx.Response(200, text='<html><div data-n-a-sg="sg" data-n-a-ts="1710000000"></div></html>')
        if "batchexecute" in url_str:
            req_body = request.read().decode("utf-8")
            match = re.search(r"GNCAP_(\d+)", req_body)
            num = match.group(1) if match else "00"
            dest = f"https://medio{num}.mx/nota"
            resp = f')}}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"{dest}\\",1]",null,null,null,"generic"]]'
            return httpx.Response(200, text=resp)
        return httpx.Response(404)

    monkeypatch.setattr(
        websearch,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    results = websearch.search_news(["cap test"], days=30, max_items=20)
    assert len(results) == 15

    # Count how many have decoded URLs (not news.google.com)
    decoded_count = sum(1 for r in results if "news.google.com" not in r.url)
    assert decoded_count == 12  # Capped at 12

    # Check that domain was updated for decoded ones
    decoded_items = [r for r in results if "news.google.com" not in r.url]
    for d in decoded_items:
        assert d.domain.startswith("medio") and d.domain.endswith(".mx")

    # Remaining 3 keep news.google.com
    non_decoded = [r for r in results if "news.google.com" in r.url]
    assert len(non_decoded) == 3
