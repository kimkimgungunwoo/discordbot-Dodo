import discord


class UserPickSelect(discord.ui.Select):
    def __init__(self, cog, entries: list[tuple[int, str, int]]):
        self.cog = cog
        options = [
            discord.SelectOption(
                label=f"{i}. {name}", description=f"메시지 {count:,}개", value=str(uid),
            )
            for i, (uid, name, count) in enumerate(entries, 1)
        ][:25]
        super().__init__(placeholder="통계를 확인할 유저를 선택하세요", options=options)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer()
        await self.cog.show_user_stat(interaction, int(self.values[0]))


class UserPickView(discord.ui.View):
    def __init__(self, cog, entries: list[tuple[int, str, int]]):
        super().__init__(timeout=300)
        self.add_item(UserPickSelect(cog, entries))
