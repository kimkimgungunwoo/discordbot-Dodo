import discord
from discord.ext import commands
from watchfiles import awatch
from pathlib import Path

COGS = [
    "bot.cogs.basic",
    "bot.cogs.util",
    "bot.cogs.test",
    "bot.cogs.game",
    "bot.cogs.party",
    "bot.cogs.music",
    "bot.cogs.control",
    "bot.cogs.user",
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

    async def _hot_reload(self):
        async for changes in awatch(COGS_DIR):
            for _, path in changes:
                p = Path(path)
                if p.suffix != ".py" or p.stem.startswith("_"):
                    continue
                ext = f"bot.cogs.{p.stem}"
                if ext not in self.extensions:
                    continue
                try:
                    await self.reload_extension(ext)
                    print(f"[HotReload] {ext} reloaded")
                except Exception as e:
                    print(f"[HotReload] {ext} failed: {e}")


def create_bot():
    return MyBot()
