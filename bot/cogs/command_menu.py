from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import discord


MenuCallback = Callable[[discord.Interaction], Awaitable[None]]


@dataclass(frozen=True)
class MenuItem:
    label: str
    value: str
    callback: MenuCallback
    description: str | None = None
    emoji: str | None = None


class _CommandSelect(discord.ui.Select):
    def __init__(self, items: list[MenuItem], placeholder: str):
        self.items_by_value = {item.value: item for item in items}
        super().__init__(placeholder=placeholder, min_values=1, max_values=1, options=[
            discord.SelectOption(label=item.label, value=item.value, description=item.description, emoji=item.emoji)
            for item in items
        ])

    async def callback(self, interaction: discord.Interaction):
        await self.items_by_value[self.values[0]].callback(interaction)


class CommandMenuView(discord.ui.View):
    def __init__(self, owner_id: int, items: list[MenuItem], *, placeholder="메뉴를 선택하세요", timeout=120):
        super().__init__(timeout=timeout)
        self.owner_id = owner_id
        self.message = None
        self.add_item(_CommandSelect(items, placeholder))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id == self.owner_id:
            return True
        await interaction.response.send_message("명령어를 입력한 사람만 사용할 수 있습니다.", ephemeral=True)
        return False

    async def on_timeout(self):
        for child in self.children:
            child.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass
