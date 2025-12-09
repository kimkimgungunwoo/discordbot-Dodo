from discord.ext import commands

class Basic(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="안녕", aliases=["hi", "하이", "안녕하세요"])
    async def hello(self, ctx):
        await ctx.reply("안녕하세요", mention_author=False)


async def setup(bot):
    await bot.add_cog(Basic(bot))
