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
try:
    asyncio.run(init_dynamodb())
except Exception:
    logging.exception("init_dynamodb failed, starting bot anyway")

bot = create_bot()
bot.run(token)
