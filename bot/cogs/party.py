from discord.ext import commands
from typing import Optional
import discord
import asyncio
import datetime
import uuid


class PartyView(discord.ui.View):
    def __init__(self, cog, party_id: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.party_id = party_id

    @discord.ui.button(
        label="참여",
        style=discord.ButtonStyle.success,
    )
    async def join_button(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ):
        party = self.cog.parties.get(self.party_id)

        if party is None:
            await interaction.response.send_message(
                "이미 종료되었거나 삭제된 파티입니다.",
                ephemeral=True,
            )
            return

        if datetime.datetime.now() >= party["target_time"]:
            await interaction.response.send_message(
                "이미 시간이 지난 파티입니다.",
                ephemeral=True,
            )
            return

        party["members"].add(interaction.user.id)

        await interaction.response.send_message(
            f"'{party['title']}' 참여 완료",
            ephemeral=True,
        )

    @discord.ui.button(
        label="참여 취소",
        style=discord.ButtonStyle.danger,
    )
    async def cancel_button(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ):
        party = self.cog.parties.get(self.party_id)

        if party is None:
            await interaction.response.send_message(
                "이미 종료되었거나 삭제된 파티입니다.",
                ephemeral=True,
            )
            return

        if interaction.user.id in party["members"]:
            party["members"].remove(interaction.user.id)
            await interaction.response.send_message(
                f"'{party['title']}' 참여 취소 완료",
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            "참여 중이 아닙니다.",
            ephemeral=True,
        )


class Party(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.parties: dict[str, dict] = {}
        self.party_tasks: dict[str, asyncio.Task] = {}

    async def _party_alarm(self, party_id: str):
        party = self.parties.get(party_id)
        if party is None:
            return

        now = datetime.datetime.now()
        wait_seconds = (party["target_time"] - now).total_seconds()

        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)

        party = self.parties.get(party_id)
        if party is None:
            return

        channel = self.bot.get_channel(party["channel_id"])
        if channel is None:
            self.parties.pop(party_id, None)
            self.party_tasks.pop(party_id, None)
            return

        members = party["members"]
        mention_text = " ".join(f"<@{user_id}>" for user_id in members)

        if not mention_text:
            mention_text = "참여자가 없습니다."

        await channel.send(
            f"{mention_text}\n📢 **{party['title']} 파티 시간입니다!**"
        )

        self.parties.pop(party_id, None)
        self.party_tasks.pop(party_id, None)

    def _make_party_list_text(self) -> str:
        if not self.parties:
            return "현재 등록된 파티가 없습니다."

        lines = ["현재 파티 목록"]
        sorted_items = sorted(
            self.parties.items(),
            key=lambda item: item[1]["target_time"]
        )

        for index, (party_id, party) in enumerate(sorted_items, start=1):
            target_time = party["target_time"].strftime("%Y-%m-%d %H:%M")
            member_count = len(party["members"])
            lines.append(
                f"{index}. [{party_id[:8]}] {party['title']} | {target_time} | 참여 {member_count}명"
            )

        return "\n".join(lines)

    def _find_party_id_by_index(self, index: int) -> Optional[str]:
        sorted_items = sorted(
            self.parties.items(),
            key=lambda item: item[1]["target_time"]
        )

        if index < 1 or index > len(sorted_items):
            return None

        party_id, _ = sorted_items[index - 1]
        return party_id

    @commands.command(name="party")
    async def create_party(
        self,
        ctx: commands.Context,
        time_str: str,
        *,
        title: str,
    ):
        try:
            year, month, day, hour, minute = map(int, time_str.split("/"))
            target_time = datetime.datetime(year, month, day, hour, minute)
        except Exception:
            await ctx.send("시간 형식은 YYYY/MM/DD/HH/MM 입니다.")
            return

        if target_time <= datetime.datetime.now():
            await ctx.send("현재보다 미래 시간만 설정할 수 있습니다.")
            return

        party_id = str(uuid.uuid4())

        self.parties[party_id] = {
            "title": title,
            "target_time": target_time,
            "channel_id": ctx.channel.id,
            "members": set(),
            "message_id": None,
        }

        view = PartyView(self, party_id)

        message = await ctx.send(
            f"🎉 **파티 생성됨**\n"
            f"번호: **{party_id[:8]}**\n"
            f"제목: **{title}**\n"
            f"시간: **{target_time.strftime('%Y-%m-%d %H:%M')}**\n"
            f"아래 버튼으로 참여하세요.",
            view=view,
        )

        self.parties[party_id]["message_id"] = message.id
        self.party_tasks[party_id] = asyncio.create_task(
            self._party_alarm(party_id)
        )

    @commands.command(name="partylist")
    async def party_list(self, ctx: commands.Context):
        await ctx.send(self._make_party_list_text())

    @commands.command(name="partydel")
    async def delete_party(self, ctx: commands.Context, index: int):
        party_id = self._find_party_id_by_index(index)

        if party_id is None:
            await ctx.send("해당 번호의 파티가 없습니다.")
            return

        party = self.parties.pop(party_id, None)
        task = self.party_tasks.pop(party_id, None)

        if task is not None:
            task.cancel()

        if party is None:
            await ctx.send("이미 삭제되었거나 존재하지 않는 파티입니다.")
            return

        await ctx.send(f"파티 삭제 완료: **{party['title']}**")

    @commands.command(name="partymembers")
    async def party_members(self, ctx: commands.Context, index: int):
        party_id = self._find_party_id_by_index(index)

        if party_id is None:
            await ctx.send("해당 번호의 파티가 없습니다.")
            return

        party = self.parties[party_id]
        members = party["members"]

        if not members:
            await ctx.send(f"**{party['title']}** 참여자는 아직 없습니다.")
            return

        mention_text = " ".join(f"<@{user_id}>" for user_id in members)
        await ctx.send(f"**{party['title']}** 참여자:\n{mention_text}")


async def setup(bot):
    await bot.add_cog(Party(bot))