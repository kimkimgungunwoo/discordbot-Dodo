"""
HTML 템플릿 → Playwright → PNG 렌더러.
"""

import io
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.async_api import async_playwright

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)


def _score_color(score: int) -> str:
    if score >= 65:
        return "#3ba55c"
    if score >= 45:
        return "#faa61a"
    return "#c94d47"


def _tier_color(tier: str | None) -> str:
    return {
        "IRON": "#5b5b5b", "BRONZE": "#b87333", "SILVER": "#a8b8c0",
        "GOLD": "#e4a200", "PLATINUM": "#4fc4cf", "EMERALD": "#52b788",
        "DIAMOND": "#6e7fde", "MASTER": "#b44de4",
        "GRANDMASTER": "#e84040", "CHALLENGER": "#f4c84a",
    }.get(tier or "", "#5865f2")


_env.filters["score_color"] = _score_color
_env.filters["tier_color"]  = _tier_color
_env.filters["intfmt"]      = lambda v: f"{int(v):,}"
_env.filters["pct"]         = lambda v: f"{round(v)}%"


async def _render(template_name: str, ctx: dict, width: int = 800) -> io.BytesIO:
    html = _env.get_template(template_name).render(**ctx)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page(
                viewport={"width": width, "height": 1400},
                device_scale_factor=3,
            )
            await page.set_content(html, wait_until="networkidle")
            png = await page.locator("#card").screenshot()
        finally:
            await browser.close()
    return io.BytesIO(png)


async def render_profile_card(profile) -> io.BytesIO:
    return await _render("profile.html", {"p": profile})


async def render_match_card(
    matches, game_name: str, tag_line: str, queue_label: str, ai_comment: str | None = None
) -> io.BytesIO:
    return await _render("matches.html", {
        "matches": matches,
        "game_name": game_name,
        "tag_line": tag_line,
        "queue_label": queue_label,
        "ai_comment": ai_comment,
    }, width=1300)


async def render_stats_card(
    stats, game_name: str, tag_line: str, queue_label: str, matches=None, ai_comment: str | None = None
) -> io.BytesIO:
    return await _render("stats.html", {
        "s": stats,
        "matches": matches,
        "game_name": game_name,
        "tag_line": tag_line,
        "queue_label": queue_label,
        "ai_comment": ai_comment,
    }, width=1300)


async def render_game_analysis_card(
    detail, game_name: str, tag_line: str, queue_label: str, ai_comment: str | None = None
) -> io.BytesIO:
    return await _render("game_analysis.html", {
        "d": detail,
        "game_name": game_name,
        "tag_line": tag_line,
        "queue_label": queue_label,
        "ai_comment": ai_comment,
    }, width=1700)
