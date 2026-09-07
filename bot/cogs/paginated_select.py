import discord
from typing import Awaitable, Callable

_PER_PAGE = 5


class PaginatedSelectView(discord.ui.View):
    def __init__(
        self,
        options: list[discord.SelectOption],
        on_pick: Callable[[discord.Interaction, str], Awaitable[None]],
        *,
        placeholder: str,
        timeout: float = 120,
    ):
        super().__init__(timeout=timeout)
        self._all = options
        self._on_pick = on_pick
        self._placeholder = placeholder
        self.page = 0
        self.max_page = max((len(options) - 1) // _PER_PAGE, 0)

        self._select = discord.ui.Select(min_values=1, max_values=1, row=0)
        self._select.callback = self._picked
        self.add_item(self._select)

        if self.max_page == 0:
            self.remove_item(self._prev)
            self.remove_item(self._next)
        self._sync()

    def _sync(self):
        start = self.page * _PER_PAGE
        self._select.options = self._all[start:start + _PER_PAGE]
        if self.max_page:
            self._select.placeholder = f"{self._placeholder} ({self.page + 1}/{self.max_page + 1})"
            self._prev.disabled = self.page == 0
            self._next.disabled = self.page == self.max_page
        else:
            self._select.placeholder = self._placeholder

    async def _turn(self, interaction: discord.Interaction, delta: int):
        self.page = max(0, min(self.max_page, self.page + delta))
        self._sync()
        await interaction.response.edit_message(view=self)

    @discord.ui.button(label="◀", style=discord.ButtonStyle.secondary, row=1)
    async def _prev(self, interaction: discord.Interaction, _b: discord.ui.Button):
        await self._turn(interaction, -1)

    @discord.ui.button(label="▶", style=discord.ButtonStyle.secondary, row=1)
    async def _next(self, interaction: discord.Interaction, _b: discord.ui.Button):
        await self._turn(interaction, 1)

    async def _picked(self, interaction: discord.Interaction):
        await self._on_pick(interaction, self._select.values[0])
