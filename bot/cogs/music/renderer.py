"""HTML 템플릿 → Playwright → PNG 렌더러 (음악 대기열 카드)."""

import io
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.async_api import async_playwright

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_RIOT_TEMPLATES_DIR = Path(__file__).parent.parent / "riot" / "templates"  # _tokens.html 재사용

_env = Environment(
    loader=FileSystemLoader([str(_TEMPLATES_DIR), str(_RIOT_TEMPLATES_DIR)]),
    autoescape=select_autoescape(["html"]),
)


async def _render(template_name: str, ctx: dict, width: int = 900) -> io.BytesIO:
    html = _env.get_template(template_name).render(**ctx)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page(
                viewport={"width": width, "height": 1200},
                device_scale_factor=3,
            )
            await page.set_content(html, wait_until="networkidle")
            png = await page.locator("#card").screenshot()
        finally:
            await browser.close()
    return io.BytesIO(png)


UPCOMING_COUNT = 4


async def render_queue_card(current, queue: list) -> io.BytesIO:
    return await _render("queue.html", {
        "current": current,
        "upcoming": queue[:UPCOMING_COUNT],
        "remaining": max(len(queue) - UPCOMING_COUNT, 0),
    })


async def render_playlist_card(meta: dict, current, queue: list) -> io.BytesIO:
    played = meta["total"] - len(queue) - (1 if current else 0)
    return await _render("playlist.html", {
        "meta": meta,
        "current": current,
        "upcoming": queue[:UPCOMING_COUNT],
        "remaining": max(len(queue) - UPCOMING_COUNT, 0),
        "played": max(played, 0),
    })
