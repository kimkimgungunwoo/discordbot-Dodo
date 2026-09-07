from __future__ import annotations
import datetime
import discord
from typing import TYPE_CHECKING

from bot.cogs.party.timeutil import now_kst, format_when, WEEKDAY

if TYPE_CHECKING:
    from bot.cogs.party import Party


class PartyView(discord.ui.View):
    def __init__(self, cog: "Party", party_id: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.party_id = party_id

    @discord.ui.button(label="참여", style=discord.ButtonStyle.success)
    async def join_button(self, interaction: discord.Interaction, _button: discord.ui.Button):
        party = self.cog.parties.get(self.party_id)

        if party is None:
            await interaction.response.send_message("이미 종료되었거나 삭제된 파티입니다.", ephemeral=True)
            return

        if now_kst() >= party["target_time"]:
            await interaction.response.send_message("이미 시간이 지난 파티입니다.", ephemeral=True)
            return

        party["members"].add(interaction.user.id)
        await interaction.response.send_message(f"'{party['title']}' 참여 완료", ephemeral=True)

    @discord.ui.button(label="참여 취소", style=discord.ButtonStyle.danger)
    async def cancel_button(self, interaction: discord.Interaction, _button: discord.ui.Button):
        party = self.cog.parties.get(self.party_id)

        if party is None:
            await interaction.response.send_message("이미 종료되었거나 삭제된 파티입니다.", ephemeral=True)
            return

        if interaction.user.id in party["members"]:
            party["members"].remove(interaction.user.id)
            await interaction.response.send_message(f"'{party['title']}' 참여 취소 완료", ephemeral=True)
            return

        await interaction.response.send_message("참여 중이 아닙니다.", ephemeral=True)


class PartyCreatePromptView(discord.ui.View):
    def __init__(self, cog: "Party"):
        super().__init__(timeout=120)
        self.cog = cog

    @discord.ui.button(label="📝 파티 만들기", style=discord.ButtonStyle.primary)
    async def create(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(PartyCreateModal(self.cog))


class PartyCreateModal(discord.ui.Modal, title="파티 생성"):
    def __init__(self, cog: "Party"):
        super().__init__()
        self.cog = cog
        today = now_kst().date()

        self.title_input = discord.ui.TextInput(placeholder="예: 롤 내전", min_length=1, max_length=100)

        date_opts = []
        for i in range(25):
            d = today + datetime.timedelta(days=i)
            label = f"{d.month}월 {d.day}일 ({WEEKDAY[d.weekday()]})"
            if i == 0:
                label = "오늘 · " + label
            elif i == 1:
                label = "내일 · " + label
            date_opts.append(discord.SelectOption(label=label, value=d.isoformat(), default=(i == 0)))
        self.date_select = discord.ui.Select(options=date_opts)

        self.ampm_select = discord.ui.Select(options=[
            discord.SelectOption(label="오전", value="am"),
            discord.SelectOption(label="오후", value="pm", default=True),
        ])
        self.hour_select = discord.ui.Select(
            options=[discord.SelectOption(label=f"{h}시", value=str(h), default=(h == 9)) for h in range(1, 13)],
        )
        self.minute_input = discord.ui.TextInput(default="0", min_length=1, max_length=2)

        self.add_item(discord.ui.Label(text="파티 제목", component=self.title_input))
        self.add_item(discord.ui.Label(text="날짜", component=self.date_select))
        self.add_item(discord.ui.Label(text="오전 / 오후", component=self.ampm_select))
        self.add_item(discord.ui.Label(text="시", component=self.hour_select))
        self.add_item(discord.ui.Label(text="분 (0~59)", component=self.minute_input))

    async def on_submit(self, interaction: discord.Interaction):
        try:
            minute = int(self.minute_input.value.strip())
            if not 0 <= minute <= 59:
                raise ValueError
        except ValueError:
            await interaction.response.send_message("분은 0~59 사이 숫자로 입력하세요.", ephemeral=True)
            return

        d = datetime.date.fromisoformat(self.date_select.values[0])
        hour = int(self.hour_select.values[0]) % 12 + (12 if self.ampm_select.values[0] == "pm" else 0)
        target_time = datetime.datetime(d.year, d.month, d.day, hour, minute)
        if target_time <= now_kst():
            await interaction.response.send_message("현재보다 미래 시간만 설정할 수 있습니다.", ephemeral=True)
            return

        view = PartyInviteView(
            self.cog, interaction.user, interaction.channel_id, target_time, self.title_input.value.strip(),
        )
        await interaction.response.send_message(
            f"🕒 **{format_when(target_time)}**\n초대할 사람이나 역할을 선택하세요 (선택 안 해도 파티는 생성됩니다):",
            view=view, ephemeral=True,
        )


class PartyInviteView(discord.ui.View):
    def __init__(self, cog: "Party", creator: discord.Member, channel_id: int,
                 target_time: datetime.datetime, title: str):
        super().__init__(timeout=300)
        self.cog = cog
        self.creator = creator
        self.channel_id = channel_id
        self.target_time = target_time
        self.title = title
        self.selected: list = []
        self.everyone = False

    @discord.ui.select(
        cls=discord.ui.MentionableSelect,
        placeholder="초대할 사람/역할 선택",
        min_values=0, max_values=25,
        row=0,
    )
    async def picker(self, interaction: discord.Interaction, select: discord.ui.MentionableSelect):
        self.selected = select.values
        await interaction.response.defer()

    @discord.ui.button(label="🌍 전체 태그(@everyone)", style=discord.ButtonStyle.secondary, row=1)
    async def toggle_everyone(self, interaction: discord.Interaction, button: discord.ui.Button):
        # MentionableSelect의 네이티브 피커가 @everyone을 항상 보여준다는 보장이 없어 전용 버튼을 따로 둔다.
        self.everyone = not self.everyone
        button.style = discord.ButtonStyle.success if self.everyone else discord.ButtonStyle.secondary
        button.label = "🌍 전체 태그 ✓" if self.everyone else "🌍 전체 태그(@everyone)"
        await interaction.response.edit_message(view=self)

    @discord.ui.button(label="✅ 파티 생성", style=discord.ButtonStyle.success, row=1)
    async def confirm(self, interaction: discord.Interaction, _button: discord.ui.Button):
        if self.target_time <= now_kst():
            await interaction.response.send_message("현재보다 미래 시간만 설정할 수 있습니다.", ephemeral=True)
            return

        channel = interaction.client.get_channel(self.channel_id) or interaction.channel
        await interaction.response.defer(ephemeral=True)
        await self.cog.finalize_party(
            channel, self.creator, self.target_time, self.title, self.selected, everyone=self.everyone,
        )
        await interaction.followup.send(f"✅ {format_when(self.target_time)} 파티가 생성되었습니다.", ephemeral=True)
        self.stop()


class PartyJoinSelect(discord.ui.Select):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        self.cog = cog
        options = [
            discord.SelectOption(
                label=f"{idx}. {party['title']}"[:100],
                description=f"{party['target_time'].strftime('%Y-%m-%d %H:%M')} · 참가 {len(party['members'])}명"[:100],
                value=party_id,
            )
            for idx, (party_id, party) in enumerate(sorted_parties[:25], start=1)
        ]
        super().__init__(placeholder="참가할 파티를 선택하세요...", options=options)

    async def callback(self, interaction: discord.Interaction):
        party = self.cog.parties.get(self.values[0])
        if party is None:
            await interaction.response.send_message("이미 종료되었거나 삭제된 파티입니다.", ephemeral=True)
            return
        if now_kst() >= party["target_time"]:
            await interaction.response.send_message("이미 시간이 지난 파티입니다.", ephemeral=True)
            return
        if interaction.user.id in party["members"]:
            await interaction.response.send_message(f"이미 **{party['title']}**에 참가 중입니다.", ephemeral=True)
            return

        party["members"].add(interaction.user.id)
        await interaction.response.send_message(f"✅ **{party['title']}** 참여 완료", ephemeral=True)


class PartyJoinPickerView(discord.ui.View):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        super().__init__(timeout=120)
        self.add_item(PartyJoinSelect(cog, sorted_parties))


class PartyDeleteSelect(discord.ui.Select):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        self.cog = cog
        options = [
            discord.SelectOption(
                label=party["title"][:100],
                description=f"{format_when(party['target_time'])} · 참가 {len(party['members'])}명"[:100],
                value=party_id,
            )
            for party_id, party in sorted_parties[:25]
        ]
        super().__init__(placeholder="삭제할 파티를 선택하세요...", options=options)

    async def callback(self, interaction: discord.Interaction):
        party = self.cog.parties.pop(self.values[0], None)
        task = self.cog.party_tasks.pop(self.values[0], None)
        if task is not None:
            task.cancel()
        if party is None:
            await interaction.response.send_message("이미 삭제된 파티입니다.", ephemeral=True)
            return
        await interaction.response.send_message(f"🗑️ **{party['title']}** 파티를 삭제했습니다.", ephemeral=True)


class PartyDeletePickerView(discord.ui.View):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        super().__init__(timeout=120)
        self.add_item(PartyDeleteSelect(cog, sorted_parties))


class PartyMemberSelect(discord.ui.Select):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        self.cog = cog
        options = [
            discord.SelectOption(
                label=party["title"][:100],
                description=f"{format_when(party['target_time'])} · 참가 {len(party['members'])}명"[:100],
                value=party_id,
            )
            for party_id, party in sorted_parties[:25]
        ]
        super().__init__(placeholder="멤버를 확인할 파티를 선택하세요...", options=options)

    async def callback(self, interaction: discord.Interaction):
        party = self.cog.parties.get(self.values[0])
        if party is None:
            await interaction.response.send_message("이미 종료되었거나 삭제된 파티입니다.", ephemeral=True)
            return
        members = party["members"]
        if not members:
            await interaction.response.send_message(
                f"**{party['title']}** 참여자는 아직 없습니다.", ephemeral=True,
            )
            return
        mention_text = " ".join(f"<@{user_id}>" for user_id in members)
        await interaction.response.send_message(
            f"**{party['title']}** 참여자 ({len(members)}명):\n{mention_text}",
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )


class PartyMemberPickerView(discord.ui.View):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        super().__init__(timeout=120)
        self.add_item(PartyMemberSelect(cog, sorted_parties))


class PartyListView(discord.ui.View):
    def __init__(self, cog: "Party", sorted_parties: list[tuple[str, dict]]):
        super().__init__(timeout=180)
        self.cog = cog
        self.sorted_parties = sorted_parties

    @discord.ui.button(label="✅ 참가", style=discord.ButtonStyle.success)
    async def join(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_message(
            "참가할 파티를 선택하세요:",
            view=PartyJoinPickerView(self.cog, self.sorted_parties),
            ephemeral=True,
        )
