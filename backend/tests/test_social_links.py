"""Unit tests for deterministic social link extraction (backend/atalaya/intel/social_links.py)

and corpus integration (backend/atalaya/explain/verify.py).
"""

from __future__ import annotations

import httpx
import pytest

from atalaya.explain.verify import CorpusDoc, fetch_corpus
from atalaya.intel.social_links import (
    ExtractedPost,
    canonical_post_url,
    extract_social_posts,
    handle_of,
    platform_of,
)
from atalaya.websearch import NewsCandidate


def test_platform_of_supported_and_unsupported():
    """platform_of detects x, facebook, tiktok, instagram, youtube, telegram; None otherwise."""
    assert platform_of("https://x.com/ine_mexico/status/1") == "x"
    assert platform_of("https://twitter.com/user/status/2") == "x"
    assert platform_of("mobile.twitter.com/user/status/3") == "x"

    assert platform_of("https://www.facebook.com/pagina/posts/123") == "facebook"
    assert platform_of("https://m.facebook.com/story.php") == "facebook"
    assert platform_of("https://web.facebook.com/videos/123") == "facebook"
    assert platform_of("https://fb.watch/xyz123") == "facebook"
    assert platform_of("plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fposts%2F1") == "facebook"

    assert platform_of("https://www.tiktok.com/@user/video/123") == "tiktok"
    assert platform_of("https://vm.tiktok.com/ZMNx123") == "tiktok"

    assert platform_of("https://www.instagram.com/p/ABC123xyz") == "instagram"
    assert platform_of("https://instagram.com/reel/DEF456") == "instagram"

    assert platform_of("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "youtube"
    assert platform_of("https://youtu.be/dQw4w9WgXcQ") == "youtube"

    assert platform_of("https://t.me/canal_oficial/45") == "telegram"
    assert platform_of("t.me/noticias/99") == "telegram"

    # Non-social domains return None
    assert platform_of("https://eluniversal.com.mx/noticia") is None
    assert platform_of("https://google.com/search") is None
    assert platform_of("") is None
    assert platform_of("invalid-url") is None


def test_canonical_post_url_rules():
    """canonical_post_url matches the exact contract specifications."""
    # X / Twitter
    assert canonical_post_url("twitter.com/u/status/1?s=20") == "https://x.com/u/status/1"
    assert canonical_post_url("https://x.com/u/status/1?s=20&t=abc") == "https://x.com/u/status/1"
    assert canonical_post_url("https://x.com/Sergeluna_S/status/2116260787865944083") == "https://x.com/Sergeluna_S/status/2116260787865944083"
    assert canonical_post_url("x.com/u") is None  # profile -> None
    assert canonical_post_url("https://twitter.com/u") is None
    assert canonical_post_url("https://twitter.com/intent/tweet?text=test") is None
    assert canonical_post_url("https://platform.twitter.com/embed/Tweet.html?id=123456") == "https://x.com/i/status/123456"

    # Facebook
    assert canonical_post_url("facebook.com/sharer/sharer.php?u=https://example.com") is None
    assert canonical_post_url("https://www.facebook.com/sharer.php?u=foo") is None
    assert canonical_post_url("https://facebook.com/share.php?v=123") is None
    assert (
        canonical_post_url("plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fpagina%2Fposts%2F123")
        == "https://www.facebook.com/pagina/posts/123"
    )
    assert (
        canonical_post_url("https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fpagina%2Fposts%2F123")
        == "https://www.facebook.com/pagina/posts/123"
    )
    assert (
        canonical_post_url("https://www.facebook.com/permalink.php?story_fbid=pfbid02z3p9n5T5t3&id=10006456789&extra=ignored")
        == "https://www.facebook.com/permalink.php?story_fbid=pfbid02z3p9n5T5t3&id=10006456789"
    )
    assert canonical_post_url("https://www.facebook.com/watch/?v=987654321&ref=sharing") == "https://www.facebook.com/watch/?v=987654321"
    assert canonical_post_url("https://fb.watch/xyz123abc/") == "https://fb.watch/xyz123abc"
    assert canonical_post_url("https://www.facebook.com/reel/1122334455/?mibextid=rS40aB7S9Ucbxw6v") == "https://www.facebook.com/reel/1122334455"
    assert (
        canonical_post_url("https://www.facebook.com/photo.php?fbid=998877&id=112233&set=a.1000")
        == "https://www.facebook.com/photo.php?fbid=998877&id=112233"
    )
    assert canonical_post_url("https://www.facebook.com/photo/?fbid=998877") == "https://www.facebook.com/photo.php?fbid=998877"
    assert canonical_post_url("https://www.facebook.com/eluniversal") is None  # profile -> None
    assert canonical_post_url("https://www.facebook.com/login.php") is None

    # YouTube
    assert canonical_post_url("youtu.be/abc") == "https://www.youtube.com/watch?v=abc"
    assert canonical_post_url("https://youtu.be/abc?feature=shared") == "https://www.youtube.com/watch?v=abc"
    assert canonical_post_url("https://www.youtube.com/watch?v=abc&list=RDabc&t=42s") == "https://www.youtube.com/watch?v=abc"
    assert canonical_post_url("https://www.youtube.com/shorts/xyz789") == "https://www.youtube.com/shorts/xyz789"
    assert canonical_post_url("https://www.youtube.com/@INEMexico") is None  # channel -> None

    # TikTok
    assert (
        canonical_post_url("https://www.tiktok.com/@ine_mexico/video/7123456789012345678?is_from_webapp=1")
        == "https://www.tiktok.com/@ine_mexico/video/7123456789012345678"
    )
    assert canonical_post_url("https://vm.tiktok.com/ZM8ABCDEF/") == "https://vm.tiktok.com/ZM8ABCDEF"
    assert canonical_post_url("https://www.tiktok.com/@ine_mexico") is None  # profile -> None

    # Instagram
    assert (
        canonical_post_url("https://www.instagram.com/p/CFg3h45jklM/?utm_source=ig_embed&utm_campaign=loading")
        == "https://www.instagram.com/p/CFg3h45jklM"
    )
    assert canonical_post_url("https://www.instagram.com/reel/C-abc456/") == "https://www.instagram.com/reel/C-abc456"
    assert canonical_post_url("https://www.instagram.com/inemexico/") is None  # profile -> None

    # Telegram
    assert canonical_post_url("t.me/canal/45") == "https://t.me/canal/45"
    assert canonical_post_url("https://t.me/canal/45") == "https://t.me/canal/45"
    assert canonical_post_url("https://t.me/s/canal/45") == "https://t.me/canal/45"
    assert canonical_post_url("https://t.me/canal") is None  # profile/channel -> None


def test_handle_of():
    """handle_of extracts @handle from URLs that carry a user/channel identifier."""
    assert handle_of("https://x.com/usuario/status/12345") == "@usuario"
    assert handle_of("https://x.com/Sergeluna_S/status/2116260787865944083") == "@Sergeluna_S"
    assert handle_of("https://x.com/i/status/12345") is None

    assert handle_of("https://www.tiktok.com/@scout2015/video/6718335390845095173") == "@scout2015"
    assert handle_of("https://vm.tiktok.com/ZM8ABCDEF") is None

    assert handle_of("https://t.me/canal_oficial/45") == "@canal_oficial"

    # Facebook: handle when named page/user, None when numeric
    assert handle_of("https://www.facebook.com/pagina/posts/123") == "@pagina"
    assert handle_of("https://www.facebook.com/permalink.php?story_fbid=123&id=10006456789") is None
    assert handle_of("https://www.facebook.com/10006456789/posts/123") is None
    assert handle_of("https://www.facebook.com/watch/?v=123") is None

    # Instagram: None for standard /p/<code> permalinks
    assert handle_of("https://www.instagram.com/p/CFg3h45jklM") is None
    assert handle_of("https://www.youtube.com/watch?v=abc") is None


def test_extract_social_posts_page_with_embeds():
    """Page with: embedded tweet, share buttons, outlet profile link, and Facebook permalink.

    Must yield EXACTLY 2 posts in document order, with correct handles and source_url.
    """
    html_page = """
    <!DOCTYPE html>
    <html lang="es">
    <head><title>Noticia de Fact-Checking</title></head>
    <body>
      <header>
        <a href="https://twitter.com/eluniversal">Síguenos en Twitter</a>
        <a href="https://facebook.com/eluniversal">Síguenos en Facebook</a>
      </header>

      <main>
        <h1>Verificación electoral</h1>
        <p>Un usuario en redes sociales difundió información falsa sobre las casillas:</p>

        <blockquote class="twitter-tweet">
          <p>Miren lo que están diciendo de las boletas electorales</p>
          &mdash; Ciudadano Alerta (@ciudadano_alerta)
          <a href="https://twitter.com/ciudadano_alerta/status/1795123456789012345?s=20">May 27, 2024</a>
        </blockquote>

        <p>Asimismo, en Facebook circuló la siguiente publicación sobre el padrón:</p>
        <p>
          Consulta la publicación original en
          <a href="https://www.facebook.com/permalink.php?story_fbid=987654321098&id=1000123456789&substory_index=0">Facebook</a>.
        </p>

        <div class="share-buttons">
          <a href="https://www.facebook.com/sharer/sharer.php?u=https://eluniversal.com.mx/noticia">Compartir en FB</a>
          <a href="https://twitter.com/intent/tweet?text=Lee+esta+nota">Compartir en Twitter</a>
        </div>
      </main>
    </body>
    </html>
    """

    page_url = "https://eluniversal.com.mx/estados/verificacion-electoral-2024"
    outlet = "El Universal"

    posts = extract_social_posts(html_page, page_url=page_url, outlet=outlet)

    assert len(posts) == 2

    # Post 1: X tweet
    p1 = posts[0]
    assert p1.platform == "x"
    assert p1.url == "https://x.com/ciudadano_alerta/status/1795123456789012345"
    assert p1.handle == "@ciudadano_alerta"
    assert p1.source_url == page_url
    assert p1.source_outlet == outlet

    # Post 2: Facebook permalink (numeric ID -> handle is None)
    p2 = posts[1]
    assert p2.platform == "facebook"
    assert p2.url == "https://www.facebook.com/permalink.php?story_fbid=987654321098&id=1000123456789"
    assert p2.handle is None
    assert p2.source_url == page_url
    assert p2.source_outlet == outlet


def test_extract_social_posts_all_embed_types():
    """extract_social_posts supports TikTok cite, Instagram permalink, Facebook plugins iframe, YouTube and Telegram."""
    html = """
    <div>
      <!-- TikTok embed with cite attribute -->
      <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@ine_oficial/video/7100000000000000000">
        <section>Video de TikTok</section>
      </blockquote>

      <!-- Instagram media with data-instgrm-permalink -->
      <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/CzXyZ123/?utm_source=ig_embed">
      </blockquote>

      <!-- Facebook iframe embed with plugins/post.php?href=... -->
      <iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fpagina_ine%2Fposts%2F456789&show_text=true"></iframe>

      <!-- YouTube in text and link -->
      <p>Video resumen en https://youtu.be/abc12345678 disponible para todos.</p>

      <!-- Telegram message in text -->
      <p>Canal de alertas: t.me/canal_electoral/102</p>

      <!-- Duplicate of earlier TikTok link -->
      <a href="https://www.tiktok.com/@ine_oficial/video/7100000000000000000">Ver TikTok otra vez</a>
    </div>
    """

    posts = extract_social_posts(html, page_url="https://animalpolitico.com/sabueso/nota", outlet="Animal Político")

    assert len(posts) == 5

    # 1. TikTok
    assert posts[0].platform == "tiktok"
    assert posts[0].url == "https://www.tiktok.com/@ine_oficial/video/7100000000000000000"
    assert posts[0].handle == "@ine_oficial"

    # 2. Instagram
    assert posts[1].platform == "instagram"
    assert posts[1].url == "https://www.instagram.com/p/CzXyZ123"
    assert posts[1].handle is None

    # 3. Facebook
    assert posts[2].platform == "facebook"
    assert posts[2].url == "https://www.facebook.com/pagina_ine/posts/456789"
    assert posts[2].handle == "@pagina_ine"

    # 4. YouTube
    assert posts[3].platform == "youtube"
    assert posts[3].url == "https://www.youtube.com/watch?v=abc12345678"
    assert posts[3].handle is None

    # 5. Telegram
    assert posts[4].platform == "telegram"
    assert posts[4].url == "https://t.me/canal_electoral/102"
    assert posts[4].handle == "@canal_electoral"


def test_fetch_corpus_extract_posts_toggle():
    """fetch_corpus fills doc.posts when extract_posts=True, and leaves it empty when False."""
    article_html = """
    <html><body>
      <p>En Chiapas se detectaron publicaciones desinformativas sobre la elección.</p>
      <blockquote class="twitter-tweet">
        <a href="https://twitter.com/alertas_chiapas/status/1789000111222333444">Tweet</a>
      </blockquote>
      <p>Las urnas se instalarán con normalidad según confirmó el INE Chiapas.</p>
    </body></html>
    """

    cand = NewsCandidate(
        title="Elecciones en Chiapas",
        url="https://eluniversal.com.mx/estados/elecciones-chiapas",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2024-06-02",
        snippet="Elecciones en Chiapas y casillas instaladas",
        provider="google_news",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=article_html)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    # Test 1: extract_posts=False (default behavior)
    docs_default = fetch_corpus([cand], zone_names=["Chiapas"], client=client, extract_posts=False)
    assert len(docs_default) == 1
    assert docs_default[0].from_page is True
    assert docs_default[0].posts == []

    # Test 2: extract_posts=True -> extracts posts
    docs_extracted = fetch_corpus([cand], zone_names=["Chiapas"], client=client, extract_posts=True)
    assert len(docs_extracted) == 1
    assert docs_extracted[0].from_page is True
    assert len(docs_extracted[0].posts) == 1
    post = docs_extracted[0].posts[0]
    assert post.platform == "x"
    assert post.url == "https://x.com/alertas_chiapas/status/1789000111222333444"
    assert post.handle == "@alertas_chiapas"
    assert post.source_url == "https://eluniversal.com.mx/estados/elecciones-chiapas"
    assert post.source_outlet == "El Universal"


def test_fetch_corpus_empty_zone_names_allowed():
    """fetch_corpus accepts zone_names=[] without prioritizing by zone."""
    cand1 = NewsCandidate(
        title="Nota nacional sobre credencialización",
        url="https://reforma.com/nacional/credencial",
        domain="reforma.com",
        outlet="Reforma",
        published="2024-06-03",
        snippet="El padrón electoral y lista nominal del INE.",
        provider="google_news",
    )

    html1 = "<html><body><p>El padrón electoral avanza en todo el país sin incidentes.</p></body></html>"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=html1)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    docs = fetch_corpus([cand1], zone_names=[], client=client, extract_posts=False)
    assert len(docs) == 1
    assert docs[0].id == "s1"
    assert docs[0].from_page is True
    assert "padrón electoral" in docs[0].text
