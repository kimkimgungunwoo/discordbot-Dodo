from bot.core.bot import create_bot
from dotenv import load_dotenv
import os

load_dotenv()
token = os.getenv("token")

bot = create_bot()
bot.run(token)
