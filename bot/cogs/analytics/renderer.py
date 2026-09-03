"""HTML 템플릿 → Playwright → PNG 렌더러 (서버 통계 카드)."""

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
_env.filters["intfmt"] = lambda v: f"{int(v):,}"


def format_duration(seconds: int) -> str:
    h, rem = divmod(int(seconds), 3600)
    m = rem // 60
    return f"{h}시간 {m}분" if h else f"{m}분"


async def _render(template_name: str, ctx: dict, width: int = 1400) -> io.BytesIO:
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


async def render_overview_card(
    *, kind: str, guild_name: str, guild_icon: str,
    total_label: str, active_count: int, avg_label: str, rows: list[dict],
) -> io.BytesIO:
    ctx = {
        "kind": kind,
        "title": "채팅 전체 통계" if kind == "chat" else "통화 전체 통계",
        "icon": "💬" if kind == "chat" else "🎙️",
        "guild_name": guild_name,
        "guild_icon": guild_icon,
        "total_label": total_label,
        "active_count": active_count,
        "avg_label": avg_label,
        "rows": rows,
    }
    return await _render("overview.html", ctx, width=1400)


async def render_user_stat_card(
    *, name: str, avatar: str, message_count: int,
    message_rank: int | None, message_total_users: int,
    voice_seconds: int, voice_rank: int | None, voice_total_users: int,
    session_count: int,
) -> io.BytesIO:
    ctx = {
        "name": name, "avatar": avatar,
        "message_count": message_count,
        "message_rank": message_rank, "message_total_users": message_total_users,
        "voice_label": format_duration(voice_seconds),
        "voice_rank": voice_rank, "voice_total_users": voice_total_users,
        "session_count": session_count,
    }
    return await _render("user_stat.html", ctx, width=1200)


async def render_server_overall_card(
    *, guild_name: str, guild_icon: str, member_count: int,
    chat_total_label: str, chat_active_count: int,
    voice_total_label: str, voice_active_count: int,
    top_chat: list[tuple], top_voice: list[tuple],
) -> io.BytesIO:
    ctx = {
        "guild_name": guild_name, "guild_icon": guild_icon, "member_count": member_count,
        "chat_total_label": chat_total_label, "chat_active_count": chat_active_count,
        "voice_total_label": voice_total_label, "voice_active_count": voice_active_count,
        "top_chat": top_chat, "top_voice": top_voice,
    }
    return await _render("server_overall.html", ctx, width=1600)
