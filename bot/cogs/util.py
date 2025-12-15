from discord.ext import commands
import google.generativeai as genai
from dotenv import load_dotenv
import os
import asyncio
import discord

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
MAX_CHAT = 10

load_dotenv(ENV_PATH)
apiKey = os.getenv("GEMINI_API_KEY")
gemini_prompt=os.getenv("gemini_prompt")
chatbot_prompt = os.getenv("chatbot_prompt")

genai.configure(api_key=apiKey)
model = genai.GenerativeModel("gemini-2.5-flash-lite")


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


class Util(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.state: dict[int, dict] = {}
        self.chats: dict[int, object] = {}

    @commands.command(name="g", aliases=["ㅎ", "AI", "ai"])
    async def gemini(self, ctx, *, message):
        loop = asyncio.get_running_loop()
        full_message = gemini_prompt + message
        response = await loop.run_in_executor(None, model.generate_content, full_message)
        await ctx.reply(response.text, mention_author=False)

    @commands.command(name="c", aliases=["chat", "chatbot", "챗봇", "gemini", "ㅊ"])
    async def geminiChat(self, ctx: commands.Context):
        chat = model.start_chat(history=[])
        chat.send_message(chatbot_prompt)

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

        chat = self.chats.get(channel.id)
        if chat is None:
            await channel.send("내부 오류: chat 세션이 없습니다.")
            return

        loop = asyncio.get_running_loop()
        try:
            response = await loop.run_in_executor(None, chat.send_message, message.content)
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
