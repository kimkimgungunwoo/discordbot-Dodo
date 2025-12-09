from discord.ext import commands
import google.generativeai as genai
from dotenv import load_dotenv
import os
import asyncio

BASE_DIR = os.path.dirname(os.path.dirname(__file__))  # discordbot/ 절대 경로
ENV_PATH = os.path.join(BASE_DIR, ".env")

load_dotenv(ENV_PATH)
apiKey = os.getenv("GEMINI_API_KEY")
prompt=os.getenv("gemini_prompt")
genai.configure(api_key=apiKey)
model = genai.GenerativeModel("gemini-2.5-flash-lite")


class Util(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="g", aliases=["ㅎ","gemini", "재미나이", "AI", "ai"])
    async def gemini(self, ctx, *, message):
        loop = asyncio.get_running_loop()
        message=prompt+message
        response = await loop.run_in_executor(None, model.generate_content, message)
        await ctx.reply(response.text, mention_author=False)


async def setup(bot):
    await bot.add_cog(Util(bot))
