import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from bot.cogs.game import Game, LobbyView
from bot.cogs.game.bomb_battle import verify_result
from bot.cogs.game.registry import GAMES


class BombLobbyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cog = Game(MagicMock())
        self.cog.secret = 'test-only-' * 4
        self.cog.server_url = 'http://activity-server:3001'
        self.cog.public_url = 'https://activity.example.test'
        self.cog.edit_room = AsyncMock()
        self.cog.stats.record_match = AsyncMock(return_value=True)
        self.cog.http = MagicMock()
        self.cog.http.close = AsyncMock()
        self.cog.http.post.return_value.__aenter__ = AsyncMock(return_value=AsyncMock(status=201))
        self.ctx = SimpleNamespace(guild=SimpleNamespace(id=10), author=SimpleNamespace(id=1, display_name='Host'), channel=SimpleNamespace(id=20), send=AsyncMock(return_value=SimpleNamespace(id=30)))
        self.room = await self.cog.select_mode(self.ctx, game='bomb_battle')

    async def asyncTearDown(self):
        await self.cog.cog_unload()

    async def action(self, name, user_id=1):
        event = SimpleNamespace(guild_id=10, user=SimpleNamespace(id=user_id, display_name=f'User {user_id}'), response=SimpleNamespace(defer=AsyncMock()), followup=SimpleNamespace(send=AsyncMock()), message=AsyncMock())
        await self.cog.action(self.room['roomId'], name, event)
        return event

    async def test_four_levels_host_bot_controls_and_four_seat_handoff(self):
        self.assertEqual(list(GAMES['bomb_battle'].difficulty_labels), ['easy','normal','hard','extreme'])
        view = LobbyView(self.cog, self.room['roomId'])
        self.assertEqual(len(view.children), 10)
        await self.action('start'); self.cog.http.post.assert_not_called()
        await self.action('bot_extreme', 2); self.assertEqual(len(self.room['seats']),1)
        await self.action('join',2); await self.action('bot_extreme'); await self.action('bot_easy'); await self.action('join',3)
        self.assertEqual(len(self.room['seats']),4)
        await self.action('start')
        payload=self.cog.http.post.call_args.kwargs['json']
        self.assertEqual(payload['game'],'bomb_battle'); self.assertEqual(payload['seats'][2]['bot'],'extreme')
        playing=LobbyView(self.cog,self.room['roomId'],True)
        self.assertEqual(len(playing.children),3); self.assertIn('/bomb-battle?room=',next(c.url for c in playing.children if c.url))
        await self.action('bot_remove'); self.assertEqual(len(self.room['seats']),4)

    async def test_bot_buttons_route_and_failed_edit_rolls_back(self):
        view=LobbyView(self.cog,self.room['roomId'])
        event=SimpleNamespace(guild_id=10,user=SimpleNamespace(id=1,display_name='Host'),response=SimpleNamespace(defer=AsyncMock()),followup=SimpleNamespace(send=AsyncMock()),message=AsyncMock())
        for label in ('쉬움','보통','어려움'):
            button=next(c for c in view.children if c.label==label+' 봇 추가');self.assertLessEqual(len(button.custom_id),100);await button.callback(event)
        self.assertEqual([s.get('bot') for s in self.room['seats']], [None,'easy','normal','hard'])
        self.cog.edit_room.return_value=False; await self.action('bot_remove'); self.assertEqual(len(self.room['seats']),4)
        self.cog.edit_room.return_value=None;await self.action('bot_remove');self.assertEqual(len(self.room['seats']),3)

    async def test_latest_notice_replaces_only_same_users_previous_notice(self):
        first = await self.action('bot_easy')
        first_message = first.followup.send.return_value
        second = await self.action('bot_hard')
        second_message = second.followup.send.return_value
        first_message.delete.assert_awaited_once()
        second_message.delete.assert_not_awaited()
        other = await self.action('join', 2)
        second_message.delete.assert_not_awaited()
        await self.action('start')
        second_message.delete.assert_awaited_once()
        other.followup.send.return_value.delete.assert_not_awaited()

    async def test_bot_winner_and_draw_result_validation_return_to_lobby(self):
        await self.action('bot_extreme');await self.action('start')
        payload={'roomId':self.room['roomId'],'matchId':self.room['matchId'],'winnerId':None,'winnerSeat':1,'seatScores':[0,1],'score':{'left':0,'right':1},'elapsedMs':1500}
        self.assertIn('2P',verify_result(payload,self.room))
        for patch in ({'winnerSeat':True},{'winnerId':'1'},{'seatScores':[1,1]},{'elapsedMs':120001},{'winnerSide':'draw'}):
            self.assertIsNone(verify_result({**payload,**patch},self.room))
        draw={**payload,'winnerSeat':None,'winnerSide':'draw','seatScores':[0,0],'score':{'left':0,'right':0}}
        self.assertIn('무승부',verify_result(draw,self.room))
        request=SimpleNamespace(headers={'Authorization':'Bearer '+self.cog.secret},json=AsyncMock(return_value=payload))
        self.assertEqual((await self.cog.game_result(request)).status,200)
        self.assertEqual(self.room['status'],'WAITING');self.assertEqual(len(self.room['seats']),2)
        self.cog.stats.record_match.assert_awaited_once_with(self.room,payload)

if __name__=='__main__':unittest.main()
