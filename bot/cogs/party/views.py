from __future__ import annotations
import datetime
import discord
from typing import TYPE_CHECKING

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

        if datetime.datetime.now() >= party["target_time"]:
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
    time_input = discord.ui.TextInput(
        label="시간 (YYYY/MM/DD/HH/MM, 24시간제)",
        placeholder="예: 2026/08/20/21/00 (오후 9시)",
        min_length=1, max_length=20,
    )
    title_input = discord.ui.TextInput(
        label="파티 제목",
        placeholder="예: 롤 내전",
        min_length=1, max_length=100,
    )

    def __init__(self, cog: "Party"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        try:
            year, month, day, hour, minute = map(int, self.time_input.value.strip().split("/"))
            target_time = datetime.datetime(year, month, day, hour, minute)
        except Exception:
            await interaction.response.send_message("시간 형식은 YYYY/MM/DD/HH/MM 입니다.", ephemeral=True)
            return

        if target_time <= datetime.datetime.now():
            await interaction.response.send_message("현재보다 미래 시간만 설정할 수 있습니다.", ephemeral=True)
            return

        # 모달은 텍스트 입력만 가능해서(디스코드 자체 제약) 사람/역할 멘션 선택은
        # 모달 제출 이후 별도 단계(진짜 유저/역할 선택 컴포넌트)에서 받는다.
        view = PartyInviteView(self.cog, interaction.user, interaction.channel_id, target_time, self.title_input.value.strip())
        await interaction.response.send_message(
            "초대할 사람이나 역할을 선택하세요 (선택 안 해도 파티는 생성됩니다):",
            view=view,
            ephemeral=True,
        )


class PartyInviteView(discord.ui.View):
    def __init__(self, cog: "Party", creator: discord.Member, channel_id: int, target_time: datetime.datetime, title: str):
        super().__init__(timeout=180)
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
        # MentionableSelect의 네이티브 피커가 @everyone을 항상 보여준다는 보장이 없어
        # 확실하게 켜고 끌 수 있는 전용 버튼을 따로 둔다.
        self.everyone = not self.everyone
        button.style = discord.ButtonStyle.success if self.everyone else discord.ButtonStyle.secondary
        button.label = "🌍 전체 태그 ✓" if self.everyone else "🌍 전체 태그(@everyone)"
        await interaction.response.edit_message(view=self)

    @discord.ui.button(label="✅ 파티 생성", style=discord.ButtonStyle.success, row=1)
    async def confirm(self, interaction: discord.Interaction, _button: discord.ui.Button):
        channel = interaction.client.get_channel(self.channel_id) or interaction.channel
        await interaction.response.defer(ephemeral=True)
        await self.cog.finalize_party(
            channel, self.creator, self.target_time, self.title, self.selected, everyone=self.everyone,
        )
        await interaction.followup.send("✅ 파티가 생성되었습니다.", ephemeral=True)
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
        if datetime.datetime.now() >= party["target_time"]:
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
