"""Deterministic social media link extraction and canonicalization without network.

Extracts social publication URLs from HTML (articles, embeds, blockquotes, iframes, links)
and canonicalizes them to verified post identifiers.
"""

from __future__ import annotations

from dataclasses import dataclass
import html as html_module
import re
from typing import TYPE_CHECKING
import urllib.parse

from atalaya.intel.schemas import Platform


@dataclass(frozen=True)
class ExtractedPost:
    platform: Platform  # x | facebook | tiktok | instagram | youtube | telegram
    url: str  # canonical
    handle: str | None  # "@usuario" from URL when present; None if not (e.g. numeric Facebook)
    source_url: str  # page where the link was found
    source_outlet: str | None  # outlet name of that page (if known)


def platform_of(url: str) -> Platform | None:
    """Return the social platform identifier if url belongs to a supported network, else None."""
    if not url or not isinstance(url, str):
        return None
    clean = url.strip()
    if not clean:
        return None

    if clean.startswith("plugins/") or clean.startswith("/plugins/"):
        if "post.php" in clean or "video.php" in clean:
            return "facebook"

    if "://" not in clean:
        clean = "https://" + clean

    try:
        parsed = urllib.parse.urlparse(clean)
        host = (parsed.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        return None

    if host in ("x.com", "twitter.com", "mobile.twitter.com") or host.endswith(".x.com") or host.endswith(".twitter.com"):
        return "x"
    if host in ("facebook.com", "fb.watch") or host.endswith(".facebook.com") or host.endswith(".fb.watch"):
        return "facebook"
    if host in ("tiktok.com", "vm.tiktok.com") or host.endswith(".tiktok.com"):
        return "tiktok"
    if host == "instagram.com" or host.endswith(".instagram.com"):
        return "instagram"
    if host in ("youtube.com", "youtu.be") or host.endswith(".youtube.com"):
        return "youtube"
    if host in ("t.me", "telegram.me") or host.endswith(".t.me") or host.endswith(".telegram.me"):
        return "telegram"
    return None


def canonical_post_url(url: str) -> str | None:
    """Return canonical URL ONLY if it points to a concrete publication.

    Returns None for profiles, channel pages, sharer/share intents, logins, hashtags, searches, etc.
    """
    if not url or not isinstance(url, str):
        return None
    raw = html_module.unescape(url.strip())
    if not raw:
        return None

    # Handle Facebook embed iframe / plugins (e.g. plugins/post.php?href=...)
    if "plugins/post.php" in raw or "plugins/video.php" in raw:
        try:
            target_str = raw if "://" in raw else "https://www.facebook.com/" + raw.lstrip("/")
            parsed_raw = urllib.parse.urlparse(target_str)
            qs = urllib.parse.parse_qs(parsed_raw.query)
            if "href" in qs and qs["href"]:
                decoded_target = urllib.parse.unquote(qs["href"][0])
                return canonical_post_url(decoded_target)
        except Exception:
            pass

    # Handle Twitter embed iframe (e.g. platform.twitter.com/embed/Tweet.html?id=...)
    if "platform.twitter.com" in raw:
        try:
            target_str = raw if "://" in raw else "https://" + raw
            parsed_raw = urllib.parse.urlparse(target_str)
            qs = urllib.parse.parse_qs(parsed_raw.query)
            if "id" in qs and qs["id"] and qs["id"][0].isdigit():
                return f"https://x.com/i/status/{qs['id'][0]}"
        except Exception:
            pass

    plat = platform_of(raw)
    if plat is None:
        return None

    full_url = raw
    if full_url.startswith("//"):
        full_url = "https:" + full_url
    elif "://" not in full_url:
        full_url = "https://" + full_url

    try:
        parsed = urllib.parse.urlparse(full_url)
    except Exception:
        return None

    path = parsed.path or ""
    query = urllib.parse.parse_qs(parsed.query)

    if plat == "x":
        m = re.search(r"/(?:i/web/|i/)?(?P<handle>[A-Za-z0-9_]+)/status/(?P<id>\d+)", path)
        if m:
            h = m.group("handle")
            status_id = m.group("id")
            if "/i/status/" in path or "/i/web/status/" in path or h.lower() == "i":
                return f"https://x.com/i/status/{status_id}"
            return f"https://x.com/{h}/status/{status_id}"
        m_i = re.search(r"/i/status/(?P<id>\d+)", path)
        if m_i:
            return f"https://x.com/i/status/{m_i.group('id')}"
        return None

    if plat == "facebook":
        # Discard non-post endpoints
        if re.search(r"/(?:sharer|share|dialog|plugins/like|tr|login|policies|help|privacy|business|settings)\b", path, re.I):
            return None
        if "sharer.php" in path or "share.php" in path:
            return None

        host = (parsed.hostname or "").lower()
        if "fb.watch" in host:
            code = path.strip("/").split("/")[0]
            if code and not code.startswith("?"):
                return f"https://fb.watch/{code}"
            return None

        # /watch/?v=...
        if path.rstrip("/") == "/watch" or "/watch/" in path or path == "/watch":
            if "v" in query and query["v"]:
                v_id = query["v"][0].strip()
                if v_id:
                    return f"https://www.facebook.com/watch/?v={v_id}"
            return None

        # permalink.php?story_fbid=...&id=...
        if "permalink.php" in path:
            story_fbid = (query.get("story_fbid") or query.get("fbid") or [None])[0]
            user_id = (query.get("id") or [None])[0]
            if story_fbid:
                if user_id:
                    return f"https://www.facebook.com/permalink.php?story_fbid={story_fbid}&id={user_id}"
                return f"https://www.facebook.com/permalink.php?story_fbid={story_fbid}"
            return None

        # /photo... fbid=...
        if "/photo" in path:
            fbid = (query.get("fbid") or [None])[0]
            user_id = (query.get("id") or [None])[0]
            if fbid:
                if user_id:
                    return f"https://www.facebook.com/photo.php?fbid={fbid}&id={user_id}"
                return f"https://www.facebook.com/photo.php?fbid={fbid}"
            m_photo = re.search(r"/photos/(?:[^/]+/)?(\d+)", path)
            if m_photo:
                return f"https://www.facebook.com/photo.php?fbid={m_photo.group(1)}"
            return None

        # /reel/<id>
        m_reel = re.search(r"/reel/([A-Za-z0-9_-]+)", path)
        if m_reel:
            return f"https://www.facebook.com/reel/{m_reel.group(1)}"

        # .../posts/<id>
        m_posts = re.search(r"(?:/([^/]+))?/posts/([A-Za-z0-9_.-]+)", path)
        if m_posts:
            prefix = m_posts.group(1)
            post_id = m_posts.group(2)
            if prefix and prefix not in ("posts", "p", "reel", "videos"):
                return f"https://www.facebook.com/{prefix}/posts/{post_id}"
            return f"https://www.facebook.com/posts/{post_id}"

        # .../videos/<id>
        m_videos = re.search(r"(?:/([^/]+))?/videos/([A-Za-z0-9_.-]+)", path)
        if m_videos:
            prefix = m_videos.group(1)
            video_id = m_videos.group(2)
            if prefix and prefix not in ("videos", "watch"):
                return f"https://www.facebook.com/{prefix}/videos/{video_id}"
            return f"https://www.facebook.com/watch/?v={video_id}"

        return None

    if plat == "tiktok":
        host = (parsed.hostname or "").lower()
        if "vm.tiktok.com" in host:
            code = path.strip("/").split("/")[0]
            if code:
                return f"https://vm.tiktok.com/{code}"
            return None

        m = re.search(r"/@([A-Za-z0-9_.-]+)/video/(\d+)", path)
        if m:
            h = m.group(1)
            vid = m.group(2)
            return f"https://www.tiktok.com/@{h}/video/{vid}"
        return None

    if plat == "instagram":
        m = re.search(r"/(?:[^/]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)", path)
        if m:
            kind = m.group(1).lower()
            code = m.group(2)
            return f"https://www.instagram.com/{kind}/{code}"
        return None

    if plat == "youtube":
        host = (parsed.hostname or "").lower()
        if "youtu.be" in host:
            vid = path.strip("/").split("/")[0]
            if vid:
                return f"https://www.youtube.com/watch?v={vid}"
            return None

        if path.rstrip("/") == "/watch" or "/watch/" in path or path == "/watch":
            if "v" in query and query["v"]:
                vid = query["v"][0].strip()
                if vid:
                    return f"https://www.youtube.com/watch?v={vid}"
            return None

        m_shorts = re.search(r"/shorts/([A-Za-z0-9_-]+)", path)
        if m_shorts:
            return f"https://www.youtube.com/shorts/{m_shorts.group(1)}"

        m_embed = re.search(r"/embed/([A-Za-z0-9_-]+)", path)
        if m_embed:
            return f"https://www.youtube.com/watch?v={m_embed.group(1)}"

        return None

    if plat == "telegram":
        m = re.search(r"/(?:s/)?([A-Za-z0-9_]+)/(\d+)", path)
        if m:
            canal = m.group(1)
            msg_id = m.group(2)
            if canal.lower() not in ("share", "joinchat", "c", "addstickers"):
                return f"https://t.me/{canal}/{msg_id}"
        return None

    return None


def handle_of(canonical_url: str) -> str | None:
    """Extract '@usuario' handle from a canonical URL when present; None otherwise."""
    if not canonical_url or not isinstance(canonical_url, str):
        return None
    try:
        parsed = urllib.parse.urlparse(canonical_url)
    except Exception:
        return None

    path = parsed.path or ""
    plat = platform_of(canonical_url)

    if plat == "x":
        m = re.search(r"/([A-Za-z0-9_]+)/status/\d+", path)
        if m:
            h = m.group(1)
            if h.lower() != "i":
                return f"@{h}"
        return None

    if plat == "tiktok":
        m = re.search(r"/@([A-Za-z0-9_.-]+)/video/\d+", path)
        if m:
            return f"@{m.group(1).lstrip('@')}"
        return None

    if plat == "telegram":
        m = re.search(r"/([A-Za-z0-9_]+)/\d+", path)
        if m:
            canal = m.group(1)
            if canal.lower() not in ("s", "share", "joinchat", "c"):
                return f"@{canal}"
        return None

    if plat == "facebook":
        m = re.search(r"^/([^/]+)/(?:posts|videos)/", path)
        if m:
            page = m.group(1)
            if not page.isdigit() and page.lower() not in (
                "posts", "videos", "watch", "reel", "photo", "photos",
                "profile.php", "permalink.php", "plugins", "groups", "pages", "events", "user", "sharer"
            ):
                return f"@{page}"
        return None

    if plat == "instagram":
        m = re.search(r"^/([^/]+)/(?:p|reel|tv)/", path)
        if m:
            user = m.group(1)
            if user.lower() not in ("p", "reel", "tv", "explore", "stories"):
                return f"@{user}"
        return None

    if plat == "youtube":
        m = re.search(r"/@([A-Za-z0-9_.-]+)", path)
        if m:
            return f"@{m.group(1)}"
        return None

    return None


def extract_social_posts(
    html: str,
    *,
    page_url: str,
    outlet: str | None = None,
) -> list[ExtractedPost]:
    """Extract deterministic social media publications from an HTML page.

    Searches href, src, cite, data-href, data-url, embed iframes/blockquotes, and text URLs.
    Applies canonical_post_url, deduplicates, and preserves document order.
    """
    if not html or not isinstance(html, str):
        return []

    candidates: list[tuple[int, str]] = []

    # 1. Attributes in HTML tags
    attr_pattern = re.compile(
        r'''\b(?:href|src|cite|data-href|data-url|data-instgrm-permalink)\s*=\s*(?:["']([^"']+)["']|([^\s>"']+))''',
        re.IGNORECASE,
    )
    for m in attr_pattern.finditer(html):
        val = m.group(1) or m.group(2)
        if val:
            candidates.append((m.start(), val))

    # 2. Raw URLs in text, comments, scripts
    url_pattern = re.compile(
        r'''https?://[^\s"'<>]+|'''
        r'''\b(?:x\.com|twitter\.com|facebook\.com|fb\.watch|tiktok\.com|vm\.tiktok\.com|instagram\.com|youtube\.com|youtu\.be|t\.me)/[^\s"'<>]+''',
        re.IGNORECASE,
    )
    for m in url_pattern.finditer(html):
        val = m.group(0).rstrip(').,;"\'')
        if val:
            candidates.append((m.start(), val))

    # Sort strictly by character position in document to preserve appearance order
    candidates.sort(key=lambda item: item[0])

    posts: list[ExtractedPost] = []
    seen_urls: set[str] = set()
    tweet_id_to_index: dict[str, int] = {}

    for _, raw_candidate in candidates:
        canon = canonical_post_url(raw_candidate)
        if not canon:
            continue
        plat = platform_of(canon)
        if not plat:
            continue

        # Special handling for X: if canonical has /i/status/<id>, but later or earlier we have handle
        if plat == "x":
            m_id = re.search(r"/status/(\d+)", canon)
            if m_id:
                tid = m_id.group(1)
                h = handle_of(canon)
                if tid in tweet_id_to_index:
                    existing_idx = tweet_id_to_index[tid]
                    # If existing had no handle, and this one has handle, upgrade it in place
                    if posts[existing_idx].handle is None and h is not None:
                        posts[existing_idx] = ExtractedPost(
                            platform=plat,
                            url=canon,
                            handle=h,
                            source_url=page_url,
                            source_outlet=outlet,
                        )
                    continue

        if canon in seen_urls:
            continue

        seen_urls.add(canon)
        h = handle_of(canon)
        post = ExtractedPost(
            platform=plat,
            url=canon,
            handle=h,
            source_url=page_url,
            source_outlet=outlet,
        )
        if plat == "x":
            m_id = re.search(r"/status/(\d+)", canon)
            if m_id:
                tweet_id_to_index[m_id.group(1)] = len(posts)
        posts.append(post)

    return posts
