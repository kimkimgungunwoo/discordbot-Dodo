import discord
from discord.ext import commands

COGS = [
    "bot.cogs.basic",
    "bot.cogs.util",
    "bot.cogs.test",
    "bot.cogs.game",
    "bot.cogs.party",
    "bot.cogs.music",
    "bot.cogs.control",
]


class MyBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix="!", intents=intents, help_command=None)

    async def setup_hook(self):
        for ext in COGS:
            await self.load_extension(ext)


def create_bot():
    return MyBot()
