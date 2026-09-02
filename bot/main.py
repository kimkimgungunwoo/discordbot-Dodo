from bot.core.bot import create_bot
from dotenv import load_dotenv
import asyncio
import os
import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("discord").setLevel(logging.WARNING)
logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)

load_dotenv()
token = os.getenv("token")

from scripts.init_dynamodb import main as init_dynamodb
asyncio.run(init_dynamodb())

bot = create_bot()
bot.run(token)
