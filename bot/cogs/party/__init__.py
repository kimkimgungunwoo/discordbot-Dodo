from discord.ext import commands
from typing import Optional
import discord
import asyncio
import datetime
import uuid

from bot.cogs.control import category_embed
from bot.cogs.party.renderer import render_party_list_card
from bot.cogs.party.views import PartyView, PartyCreatePromptView, PartyListView


class Party(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.parties: dict[str, dict] = {}
        self.party_tasks: dict[str, asyncio.Task] = {}

    async def cog_unload(self):
        """Cog가 내려갈 때(핫리로드 포함) 대기 중이던 파티를 전부 정리한다.
        안 그러면 옛 인스턴스의 알림 태스크(_party_alarm)가 백그라운드에 그대로 남아
        새 인스턴스(파티 목록이 텅 빈)와 따로 노는 상태가 된다 — 음악 큐에서 겪은 것과 같은 문제."""
        for task in self.party_tasks.values():
            task.cancel()
        self.party_tasks.clear()
        self.parties.clear()

    async def finalize_party(
        self,
        channel: discord.abc.Messageable,
        creator: discord.Member,
        target_time: datetime.datetime,
        title: str,
        invitees: list,
        everyone: bool = False,
    ) -> discord.Message:
        party_id = str(uuid.uuid4())

        self.parties[party_id] = {
            "title": title,
            "target_time": target_time,
            "channel_id": channel.id,
            "members": {creator.id},  # 파티장은 자동으로 참가 상태로 시작
            "message_id": None,
            "host_id": creator.id,
            "host_name": creator.display_name,
        }

        mention_parts = ["@everyone"] if everyone else []
        for m in invitees:
            if isinstance(m, discord.Role):
                if m.is_default():
                    if not everyone:
                        mention_parts.append("@everyone")
                else:
                    mention_parts.append(m.mention)
            else:
                mention_parts.append(m.mention)
        mention_text = " ".join(mention_parts)

        view = PartyView(self, party_id)
        content = (f"{mention_text}\n" if mention_text else "") + (
            f"🎉 **파티 생성됨**\n"
            f"파티장: **{creator.display_name}**\n"
            f"제목: **{title}**\n"
            f"시간: **{target_time.strftime('%Y-%m-%d %H:%M')}**\n"
            f"아래 버튼으로 참여하세요."
        )

        message = await channel.send(content=content, view=view)

        self.parties[party_id]["message_id"] = message.id
        self.party_tasks[party_id] = asyncio.create_task(self._party_alarm(party_id))
        return message

    async def _party_alarm(self, party_id: str):
        party = self.parties.get(party_id)
        if party is None:
            return

        wait_seconds = (party["target_time"] - datetime.datetime.now()).total_seconds()
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)

        try:
            party = self.parties.get(party_id)
            if party is None:
                return

            channel = self.bot.get_channel(party["channel_id"])
            if channel is None:
                return

            members = party["members"]
            mention_text = " ".join(f"<@{user_id}>" for user_id in members) or "참여자가 없습니다."

            await channel.send(
                f"{mention_text}\n📢 **{party['title']} 파티 시간입니다!**"
            )
        except Exception as e:
            print(f"[Party] '{party_id}' 파티 알림 전송 실패: {e}")
        finally:
            # 알림 전송 성공/실패와 무관하게 시간이 지난 파티는 항상 정리한다 —
            # 안 그러면 채널 삭제/권한 문제 등으로 send가 실패했을 때 파티가 영원히 안 지워짐.
            self.parties.pop(party_id, None)
            self.party_tasks.pop(party_id, None)

    def _find_party_id_by_index(self, index: int) -> Optional[str]:
        sorted_items = sorted(
            self.parties.items(),
            key=lambda item: item[1]["target_time"]
        )

        if index < 1 or index > len(sorted_items):
            return None

        party_id, _ = sorted_items[index - 1]
        return party_id

    @commands.group(name="파티", invoke_without_command=True)
    async def party(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("party"), mention_author=False)

    @party.command(name="생성")
    async def create_party(self, ctx: commands.Context):
        """버튼을 눌러 파티 생성 입력창을 띄웁니다."""
        await ctx.reply(
            "아래 버튼을 눌러 파티 정보를 입력하세요:",
            view=PartyCreatePromptView(self),
            mention_author=False,
        )

    @party.command(name="목록")
    async def party_list(self, ctx: commands.Context):
        """등록된 파티 목록을 카드로 보여줍니다."""
        if not self.parties:
            await ctx.reply("현재 등록된 파티가 없습니다.", mention_author=False)
            return

        sorted_parties = sorted(self.parties.items(), key=lambda item: item[1]["target_time"])
        async with ctx.typing():
            img = await render_party_list_card(sorted_parties)
        await ctx.reply(
            file=discord.File(img, "parties.png"),
            view=PartyListView(self, sorted_parties),
            mention_author=False,
        )

    @party.command(name="삭제")
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

    @party.command(name="멤버")
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
