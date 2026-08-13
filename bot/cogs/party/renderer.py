"""HTML 템플릿 → Playwright → PNG 렌더러 (파티 목록 카드)."""

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


async def _render(template_name: str, ctx: dict, width: int = 920) -> io.BytesIO:
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


async def render_party_list_card(sorted_parties: list[tuple[str, dict]]) -> io.BytesIO:
    rows = [
        {
            "index": idx,
            "title": party["title"],
            "host_name": party.get("host_name", "알 수 없음"),
            "time_str": party["target_time"].strftime("%Y-%m-%d %H:%M"),
            "member_count": len(party["members"]),
        }
        for idx, (_party_id, party) in enumerate(sorted_parties, start=1)
    ]
    return await _render("party_list.html", {"rows": rows})
