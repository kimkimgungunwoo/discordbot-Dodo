from bot.core.bot import create_bot
from dotenv import load_dotenv
import asyncio
import os
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logging.getLogger("discord").setLevel(logging.INFO)
logging.getLogger("discord.http").setLevel(logging.WARNING)
logging.getLogger("discord.gateway").setLevel(logging.INFO)
logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("aiobotocore").setLevel(logging.WARNING)
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("aioboto3").setLevel(logging.WARNING)
logging.getLogger("wavelink").setLevel(logging.WARNING)

load_dotenv()
token = os.getenv("token")

from scripts.init_dynamodb import main as init_dynamodb
try:
    asyncio.run(init_dynamodb())
except Exception:
    logging.exception("init_dynamodb failed, starting bot anyway")

bot = create_bot()
bot.run(token)
