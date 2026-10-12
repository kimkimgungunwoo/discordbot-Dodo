import unittest
from api.dodo.store import DodoGameStore
from api.dodo.test_rummikub import Context, Connection

class BombStorageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store=DodoGameStore('test');self.connection=Connection()
        self.store.pool=type('Pool',(),{'acquire':lambda _:Context(self.connection)})()
        self.room={'game':'bomb_battle','mode':'PVP','hostId':'1','p2Id':'2','guildId':'10','seats':[{'userId':'1'},{'userId':None,'bot':'extreme'},{'userId':'2'},{'userId':'3'}]}
        self.payload={'matchId':'bomb-test','winnerId':None,'winnerSeat':1,'seatScores':[0,1,0,0],'elapsedMs':1500}

    async def test_all_humans_record_loss_against_bot_and_bot_win_without_two_player_rating(self):
        await self.store.record_match(self.room,self.payload)
        participants=[a for sql,a in self.connection.calls if 'INSERT INTO dodo_match_participant' in sql]
        self.assertEqual(len(participants),4)
        self.assertIn(('bomb-test',2,'P3','LOSS',0),participants)
        self.assertIn(('bomb-test','P2','WIN',1,'extreme'),participants)
        stats=[a for sql,a in self.connection.calls if 'INSERT INTO dodo_player_stat(' in sql]
        self.assertEqual(len(stats),6);self.assertTrue(all(a[6:9]==(0,1,0) and a[11]==0 for a in stats))
        self.assertTrue(any('INSERT INTO bomb_battle_match' in sql for sql,_ in self.connection.calls))
        self.assertFalse(await self.store.record_match(self.room,self.payload))

    async def test_four_human_draw_and_aborted_match(self):
        self.room['seats']=[{'userId':str(i)} for i in range(1,5)]
        self.payload.update(winnerSeat=None,winnerSide='draw',seatScores=[0,0,0,0])
        await self.store.record_match(self.room,self.payload)
        stats=[a for sql,a in self.connection.calls if 'INSERT INTO dodo_player_stat(' in sql]
        self.assertEqual(len(stats),8);self.assertTrue(all(a[6:9]==(0,0,1) for a in stats))
        self.connection.calls=[];self.payload.update(matchId='aborted',aborted=True);self.payload.pop('elapsedMs')
        await self.store.record_match(self.room,self.payload)
        self.assertFalse(any('INSERT INTO dodo_player_stat(' in sql for sql,_ in self.connection.calls))

if __name__=='__main__':unittest.main()
