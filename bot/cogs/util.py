from discord.ext import commands
from google import genai
from dotenv import load_dotenv
import os
import asyncio
import discord
import datetime

from bot.cogs.control import category_embed

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
MAX_CHAT = 30

GEMINI_DISABLED = False  # 임시 차단 — 재활성화하려면 False로 변경
GEMINI_DISABLED_MSG = "🚧 AI 챗봇 기능은 현재 일시적으로 사용할 수 없습니다."
GENERATING_MSG = "🔍 생성 중입니다..."

load_dotenv(ENV_PATH)
apiKey = os.getenv("GEMINI_API_KEY")
gemini_prompt=os.getenv("gemini_prompt")
chatbot_prompt = os.getenv("chatbot_prompt")

MODEL_NAME = "gemini-3.5-flash-lite"
client = genai.Client(api_key=apiKey)

async def alarm(channel, target_time):
    now = datetime.datetime.now()
    wait = (target_time - now).total_seconds()

    if wait <= 0:
        await channel.send("이미 지난 시간이다")
        return

    await asyncio.sleep(wait)
    await channel.send("알람 울림")

async def _archive_thread(thread: discord.Thread):
    try:
        await thread.edit(archived=True)
    except Exception:
        return
    try:
        await thread.edit(locked=True)
    except Exception:
        pass


async def _end_session(thread: discord.Thread, state: dict[int, dict], chats: dict[int, object]):
    st = state.get(thread.id)
    if st is not None:
        st["active"] = False
        st["remaining"] = 0
        state[thread.id] = st
    chats.pop(thread.id, None)
    try:
        await thread.send("대화가 종료됩니다")
    except Exception:
        pass
    await _archive_thread(thread)


class GeminiStopView(discord.ui.View):
    def __init__(self, thread: discord.Thread, state: dict[int, dict], chats: dict[int, object]):
        super().__init__(timeout=None)
        self.thread = thread
        self.state = state
        self.chats = chats

    def _get_state(self) -> dict:
        return self.state.get(
            self.thread.id,
            {"active": False, "owner_id": None, "remaining": 0},
        )

    async def _check_thread_and_owner(self, interaction: discord.Interaction) -> bool:
        if interaction.channel.id != self.thread.id:
            await interaction.response.send_message(
                "이 버튼은 이 스레드 안에서만 사용할 수 있습니다.",
                ephemeral=True,
            )
            return False

        st = self._get_state()

        if not st["active"]:
            await interaction.response.send_message(
                "이 대화는 이미 종료되었습니다.",
                ephemeral=True,
            )
            return False

        if interaction.user.id != st["owner_id"]:
            await interaction.response.send_message(
                "이 세션은 생성한 사람만 종료할 수 있습니다.",
                ephemeral=True,
            )
            return False

        return True

    @discord.ui.button(
        label="그만",
        style=discord.ButtonStyle.danger,
        custom_id="stop_button",
    )
    async def stop_button(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ):
        if not await self._check_thread_and_owner(interaction):
            return

        st = self._get_state()
        st["active"] = False
        st["remaining"] = 0
        self.state[self.thread.id] = st

        self.chats.pop(self.thread.id, None)

        await interaction.response.send_message("대화가 종료됩니다")
        await _archive_thread(self.thread)


class AIQuestionModal(discord.ui.Modal, title="AI에게 질문"):
    question = discord.ui.TextInput(
        label="질문",
        style=discord.TextStyle.paragraph,
        placeholder="무엇이든 물어보세요",
        max_length=2000,
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        full_message = gemini_prompt + self.question.value
        try:
            response = await client.aio.models.generate_content(model=MODEL_NAME, contents=full_message)
            answer = response.text
        except Exception:
            answer = "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
        await interaction.followup.send(f"**Q. {self.question.value}**\n\n{answer}")


class AIQuestionPromptView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=60)

    @discord.ui.button(label="✍️ 질문 입력", style=discord.ButtonStyle.primary)
    async def prompt(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(AIQuestionModal())


class Util(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.state: dict[int, dict] = {}
        self.chats: dict[int, object] = {}

    @commands.group(name="AI", aliases=["ai"], invoke_without_command=True)
    async def ai_group(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("ai"), mention_author=False)

    @ai_group.command(name="질문")
    async def ai_question(self, ctx: commands.Context):
        if GEMINI_DISABLED:
            await ctx.reply(GEMINI_DISABLED_MSG, mention_author=False)
            return
        await ctx.reply(
            "버튼을 눌러 질문을 입력하세요:",
            view=AIQuestionPromptView(),
            mention_author=False,
        )

    @ai_group.command(name="대화")
    async def ai_chat(self, ctx: commands.Context):
        if GEMINI_DISABLED:
            await ctx.reply(GEMINI_DISABLED_MSG, mention_author=False)
            return
        chat = client.aio.chats.create(model=MODEL_NAME)
        await chat.send_message(chatbot_prompt)

        thread = await ctx.channel.create_thread(
            name=f"{ctx.author.name}-gemini-chat",
            type=discord.ChannelType.public_thread,
            auto_archive_duration=60,
        )

        self.state[thread.id] = {
            "active": True,
            "owner_id": ctx.author.id,
            "remaining": MAX_CHAT,
        }
        self.chats[thread.id] = chat

        await thread.send(
            f"{ctx.author.mention} Gemini 채팅 세션이 시작되었습니다.\n"
            f"남은 대화: {MAX_CHAT}회\n"
            f"'그만' 버튼을 누르면 언제든 종료할 수 있습니다."
        )

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return

        channel = message.channel
        if not isinstance(channel, discord.Thread):
            return

        st = self.state.get(channel.id)
        if st is None:
            return

        if not st["active"]:
            return

        if message.author.id != st["owner_id"]:
            return

        if st["remaining"] <= 0:
            return

        if GEMINI_DISABLED:
            await channel.send(GEMINI_DISABLED_MSG)
            await _end_session(channel, self.state, self.chats)
            return

        chat = self.chats.get(channel.id)
        if chat is None:
            await channel.send("내부 오류: chat 세션이 없습니다.")
            return

        try:
            response = await chat.send_message(message.content)
            answer = response.text
        except Exception:
            await channel.send("오류가 발생했습니다. 대화를 종료합니다.")
            await _end_session(channel, self.state, self.chats)
            return

        st["remaining"] -= 1
        remaining = st["remaining"]
        self.state[channel.id] = st

        view = GeminiStopView(channel, self.state, self.chats)
        await channel.send(
            content=f"{answer}\n\n남은 대화: {remaining}회",
            view=view,
        )

        if remaining == 0:
            await _end_session(channel, self.state, self.chats)

    



async def setup(bot):
    await bot.add_cog(Util(bot))
