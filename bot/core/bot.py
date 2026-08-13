import discord
from discord.ext import commands
from watchfiles import awatch
from pathlib import Path

COGS = [
    "bot.cogs.basic",
    "bot.cogs.util",
    "bot.cogs.game",
    "bot.cogs.party",
    "bot.cogs.music",
    "bot.cogs.control",
    "bot.cogs.user",
    "bot.cogs.gamble",
    "bot.cogs.riot",
]

COGS_DIR = Path(__file__).parent.parent / "cogs"


class MyBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix="!", intents=intents, help_command=None)

    async def setup_hook(self):
        for ext in COGS:
            await self.load_extension(ext)
        self.loop.create_task(self._hot_reload())

    async def on_command_error(self, ctx: commands.Context, error: commands.CommandError):
        if isinstance(error, (commands.CommandNotFound, commands.CheckFailure)):
            return
        if isinstance(error, (commands.MissingRequiredArgument, commands.BadArgument, commands.TooManyArguments)):
            top = ctx.command.root_parent
            guide = f"`!{top.name}`" if top else "`!help`"
            await ctx.reply(f"❌ 명령어 형식이 올바르지 않습니다. {guide} 로 사용법을 확인하세요.", mention_author=False)
            return
        print(f"[CommandError] {ctx.command}: {error!r}")
        await ctx.reply("⚠️ 명령어 실행 중 오류가 발생했습니다.", mention_author=False)

    async def _hot_reload(self):
        async for changes in awatch(COGS_DIR):
            exts = set()
            for _, path in changes:
                p = Path(path)
                if p.suffix != ".py" or p.name.startswith("_"):
                    continue
                try:
                    rel = p.relative_to(COGS_DIR)
                except ValueError:
                    continue
                # 최상위 파일(game.py)이든 서브패키지 내부 파일(riot/renderer.py)이든
                # 항상 실제 로드된 확장자인 최상위 이름(bot.cogs.game / bot.cogs.riot)으로 귀결시킨다.
                top = rel.parts[0]
                ext = f"bot.cogs.{Path(top).stem}"
                if ext in self.extensions:
                    exts.add(ext)
            for ext in exts:
                try:
                    await self.reload_extension(ext)
                    print(f"[HotReload] {ext} reloaded")
                except Exception as e:
                    print(f"[HotReload] {ext} failed: {e}")


def create_bot():
    return MyBot()
