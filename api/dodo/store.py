from __future__ import annotations

import datetime
import logging
import os
from pathlib import Path

try:
    import asyncpg
except ImportError:  # 로컬 단위 테스트는 PostgreSQL 없이도 기존 기능을 실행한다.
    asyncpg = None

log = logging.getLogger(__name__)


class DodoStorageError(RuntimeError):
    pass


class DodoGameStore:
    def __init__(self, url: str | None = None):
        self.url = url if url is not None else os.getenv("DODO_DATABASE_URL", "")
        self.pool = None

    @property
    def configured(self) -> bool:
        return bool(self.url)

    @property
    def ready(self) -> bool:
        return self.pool is not None

    async def open(self):
        if not self.configured:
            log.warning("DODO_DATABASE_URL이 없어 도도새게임 전적 저장을 비활성화합니다.")
            return
        if asyncpg is None:
            raise DodoStorageError("asyncpg가 설치되지 않았습니다.")
        try:
            self.pool = await asyncpg.create_pool(self.url, min_size=1, max_size=8, command_timeout=8)
            schema = (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8")
            async with self.pool.acquire() as connection:
                await connection.execute(schema)
        except Exception as error:
            if self.pool:
                await self.pool.close()
            self.pool = None
            raise DodoStorageError("도도새게임 전적 DB를 초기화하지 못했습니다.") from error

    async def close(self):
        if self.pool:
            await self.pool.close()
            self.pool = None

    async def _player(self, connection, discord_user_id: int) -> int:
        return await connection.fetchval(
            """INSERT INTO dodo_player(discord_user_id, last_played_at) VALUES($1, now())
               ON CONFLICT(discord_user_id) DO UPDATE SET last_played_at = now()
               RETURNING player_id""", discord_user_id,
        )

    @staticmethod
    def _outcome(user_id: int, winner_id: str | None, draw: bool, score_only: bool) -> str:
        if score_only:
            return "SCORE"
        if draw:
            return "DRAW"
        return "WIN" if winner_id == str(user_id) else "LOSS"

    async def record_match(self, room: dict, payload: dict) -> bool:
        """검증이 끝난 결과를 한 번만 저장한다. 이미 저장된 match_id면 False를 반환한다."""
        if not self.configured:
            return False
        if not self.pool:
            raise DodoStorageError("도도새게임 전적 DB가 연결되지 않았습니다.")
        game = room.get("game", "volleyball")
        mode = room["mode"]
        aborted = bool(payload.get("aborted"))
        winner_id = payload.get("winnerId")
        draw = payload.get("winnerSide") == "draw"
        started_at = room.get("startedAt") or datetime.datetime.now(datetime.UTC)
        difficulty = room.get("runMode", "normal") if game == "rock_run" else room.get("difficulty") if mode == "CPU" else None
        users = [("LEFT" if mode != "SOLO" else "SOLO", int(room["hostId"]))]
        if room.get("p2Id"):
            users.append(("RIGHT", int(room["p2Id"])))
        if game == "rummikub":
            users = [(f"P{i + 1}", int(seat["userId"])) for i, seat in enumerate(room["seats"]) if not seat.get("bot")]

        try:
            async with self.pool.acquire() as connection, connection.transaction():
                ruleset_id = await connection.fetchval(
                    "SELECT ruleset_id FROM dodo_ruleset WHERE game_code=$1 AND active ORDER BY ruleset_id DESC LIMIT 1", game,
                )
                inserted = await connection.fetchval(
                    """INSERT INTO dodo_match(match_id, ruleset_id, guild_id, mode, difficulty, status, started_at)
                       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(match_id) DO NOTHING RETURNING match_id""",
                    payload["matchId"], ruleset_id, int(room["guildId"]), mode, difficulty,
                    "ABORTED" if aborted else "COMPLETED", started_at,
                )
                if not inserted:
                    return False

                player_ids: dict[int, int] = {}
                participant_ids: dict[str, int] = {}
                for seat, user_id in users:
                    player_id = await self._player(connection, user_id)
                    player_ids[user_id] = player_id
                    score = self._score_for(game, seat, payload)
                    outcome = "ABORTED" if aborted else self._outcome(user_id, winner_id, draw, game in ("arrow_dodge", "rock_run", "rummikub"))
                    participant_ids[seat] = await connection.fetchval(
                        """INSERT INTO dodo_match_participant(match_id, player_id, actor_type, seat, outcome, score)
                           VALUES($1,$2,'USER',$3,$4,$5) RETURNING participant_id""",
                        inserted, player_id, seat, outcome, score,
                    )
                if game == "rummikub":
                    for i, seat in enumerate(room["seats"]):
                        if not seat.get("bot"):
                            continue
                        await connection.execute(
                            """INSERT INTO dodo_match_participant(match_id,actor_type,seat,outcome,score,bot_difficulty)
                               VALUES($1,'CPU',$2,$3,$4,$5)""",
                            inserted, f"P{i + 1}", "ABORTED" if aborted else "SCORE",
                            self._score_for(game, f"P{i + 1}", payload), seat["bot"],
                        )
                elif mode == "CPU":
                    seat = "RIGHT"
                    outcome = "ABORTED" if aborted else "DRAW" if draw else "WIN" if winner_id is None else "LOSS"
                    participant_ids[seat] = await connection.fetchval(
                        """INSERT INTO dodo_match_participant(match_id, actor_type, seat, outcome, score)
                           VALUES($1,'CPU',$2,$3,$4) RETURNING participant_id""",
                        inserted, seat, outcome, self._score_for(game, seat, payload),
                    )

                if not aborted:
                    await self._insert_detail(connection, game, inserted, payload)
                    await self._update_all_stats(connection, room, payload, ruleset_id, player_ids)
                return True
        except DodoStorageError:
            raise
        except Exception as error:
            raise DodoStorageError("도도새게임 결과를 저장하지 못했습니다.") from error

    @staticmethod
    def _score_for(game: str, seat: str, payload: dict) -> int | None:
        if game == "rummikub":
            scores = payload.get("seatScores")
            return scores[int(seat[1:]) - 1] if scores else None
        if game == "arrow_dodge":
            return int(payload.get("survivalMs", 0))
        score = payload.get("score") or {}
        return score.get("left" if seat in ("LEFT", "SOLO") else "right")

    async def _insert_detail(self, connection, game: str, match_id: str, payload: dict):
        if game == "rummikub":
            await connection.execute("INSERT INTO rummikub_match(match_id,winner_seat) VALUES($1,$2)", match_id, payload.get("winnerSeat"))
        elif game == "arrow_dodge":
            await connection.execute("INSERT INTO arrow_dodge_match VALUES($1,$2)", match_id, payload["survivalMs"])
        elif game == "rock_run":
            await connection.execute("INSERT INTO rock_run_match(match_id, score, stage, cleared, elapsed_ms, run_mode) VALUES($1,$2,$3,$4,$5,$6)",
                                     match_id, payload["score"]["left"], payload["stage"], payload["cleared"], payload["elapsedMs"], payload.get("runMode", "normal"))
        elif game == "volleyball":
            score = payload["score"]
            await connection.execute("INSERT INTO volleyball_match VALUES($1,$2,$3)", match_id, score["left"], score["right"])
        elif game == "othello":
            await connection.execute(
                "INSERT INTO othello_match(match_id,left_score,right_score,move_count) VALUES($1,$2,$3,$4)",
                match_id, payload["score"]["left"], payload["score"]["right"], payload["moveCount"],
            )
        elif game == "omok":
            side = payload["winnerSide"]
            result_type = "DRAW" if side == "draw" else f"{side.upper()}_WIN"
            await connection.execute(
                "INSERT INTO omok_match(match_id,result_type,move_count) VALUES($1,$2,$3)",
                match_id, result_type, payload.get("moveCount"),
            )

    async def _rating(self, connection, player_id: int, ruleset_id: int, mode: str, difficulty: str,
                      scope_type: str, scope_id: int) -> int:
        value = await connection.fetchval(
            """SELECT rating FROM dodo_player_stat WHERE player_id=$1 AND ruleset_id=$2 AND mode=$3
               AND difficulty_key=$4 AND scope_type=$5 AND scope_id=$6""",
            player_id, ruleset_id, mode, difficulty, scope_type, scope_id,
        )
        return int(value or 1000)

    async def _update_all_stats(self, connection, room: dict, payload: dict, ruleset_id: int,
                                player_ids: dict[int, int]):
        game, mode = room.get("game", "volleyball"), room["mode"]
        difficulty = room.get("runMode", "normal") if game == "rock_run" else room.get("difficulty", "") if mode == "CPU" else ""
        winner_id, draw = payload.get("winnerId"), payload.get("winnerSide") == "draw"
        scopes = [("GLOBAL", 0), ("GUILD", int(room["guildId"]))]
        for scope_type, scope_id in scopes:
            deltas = {uid: 0 for uid in player_ids}
            if game != "rummikub" and mode == "PVP" and len(player_ids) == 2:
                left_uid, right_uid = int(room["hostId"]), int(room["p2Id"])
                left_rating = await self._rating(connection, player_ids[left_uid], ruleset_id, mode, difficulty, scope_type, scope_id)
                right_rating = await self._rating(connection, player_ids[right_uid], ruleset_id, mode, difficulty, scope_type, scope_id)
                actual_left = .5 if draw else 1.0 if winner_id == str(left_uid) else 0.0
                expected_left = 1 / (1 + 10 ** ((right_rating - left_rating) / 400))
                delta = round(32 * (actual_left - expected_left))
                deltas[left_uid], deltas[right_uid] = delta, -delta
            for user_id, player_id in player_ids.items():
                outcome = self._outcome(user_id, winner_id, draw, game in ("arrow_dodge", "rock_run", "rummikub"))
                seat = "LEFT" if user_id == int(room["hostId"]) else "RIGHT"
                if game == "rummikub":
                    seat = next(f"P{i + 1}" for i, s in enumerate(room["seats"]) if str(s.get("userId")) == str(user_id))
                score = self._score_for(game, seat, payload)
                await connection.execute(
                    """INSERT INTO dodo_player_stat(
                           player_id,ruleset_id,mode,difficulty_key,scope_type,scope_id,
                           plays,wins,losses,draws,best_score,total_score,rating,current_streak,best_streak)
                       VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,1000+$12,$13,$13)
                       ON CONFLICT(player_id,ruleset_id,mode,difficulty_key,scope_type,scope_id) DO UPDATE SET
                           plays=dodo_player_stat.plays+1,
                           wins=dodo_player_stat.wins+EXCLUDED.wins,
                           losses=dodo_player_stat.losses+EXCLUDED.losses,
                           draws=dodo_player_stat.draws+EXCLUDED.draws,
                           best_score=CASE WHEN EXCLUDED.best_score IS NULL THEN dodo_player_stat.best_score
                               ELSE GREATEST(COALESCE(dodo_player_stat.best_score,EXCLUDED.best_score),EXCLUDED.best_score) END,
                           total_score=dodo_player_stat.total_score+EXCLUDED.total_score,
                           rating=dodo_player_stat.rating+$12,
                           current_streak=CASE WHEN $7=1 THEN dodo_player_stat.current_streak+1 ELSE 0 END,
                           best_streak=GREATEST(dodo_player_stat.best_streak,
                               CASE WHEN $7=1 THEN dodo_player_stat.current_streak+1 ELSE dodo_player_stat.best_streak END),
                           updated_at=now()""",
                    player_id, ruleset_id, mode, difficulty, scope_type, scope_id,
                    1 if outcome == "WIN" else 0, 1 if outcome == "LOSS" else 0, 1 if outcome == "DRAW" else 0,
                    score if game in ("arrow_dodge", "rock_run") else None, score or 0, deltas[user_id], 1 if outcome == "WIN" else 0,
                )

    async def player_stats(self, discord_user_id: int, game: str, mode: str, difficulty: str = "") -> dict | None:
        if not self.pool:
            return None
        async with self.pool.acquire() as connection:
            row = await connection.fetchrow(
                """SELECT s.* FROM dodo_player_stat s JOIN dodo_player p USING(player_id)
                   JOIN dodo_ruleset r USING(ruleset_id)
                   WHERE p.discord_user_id=$1 AND r.game_code=$2 AND s.mode=$3 AND s.difficulty_key=$4
                     AND s.scope_type='GLOBAL' AND r.active""",
                discord_user_id, game, mode, difficulty if mode == "CPU" or game == "rock_run" else "",
            )
            return dict(row) if row else None

    async def leaderboard(self, game: str, mode: str, scope_type: str, scope_id: int,
                          difficulty: str = "", limit: int = 10) -> list[dict]:
        if not self.pool:
            return []
        order = "total_score DESC, p.discord_user_id ASC" if game == "rummikub" else "best_score DESC NULLS LAST, plays ASC" if game in ("arrow_dodge", "rock_run") else \
            "rating DESC, wins DESC" if mode == "PVP" else "wins DESC, losses ASC"
        query = f"""SELECT p.discord_user_id,s.plays,s.wins,s.losses,s.draws,s.best_score,s.rating,s.total_score
                    FROM dodo_player_stat s JOIN dodo_player p USING(player_id)
                    JOIN dodo_ruleset r USING(ruleset_id)
                    WHERE r.game_code=$1 AND s.mode=$2 AND s.difficulty_key=$3
                      AND s.scope_type=$4 AND s.scope_id=$5 AND r.active
                    ORDER BY {order} LIMIT $6"""
        async with self.pool.acquire() as connection:
            return [dict(row) for row in await connection.fetch(
                query, game, mode, difficulty if mode == "CPU" or game == "rock_run" else "", scope_type, scope_id, limit,
            )]

    async def rummikub_history(self, discord_user_id: int) -> list[dict]:
        if not self.pool:
            return []
        async with self.pool.acquire() as connection:
            rows = await connection.fetch(
                """SELECT m.ended_at, mp.score, m.guild_id,
                          (SELECT count(*) FROM dodo_match_participant a WHERE a.match_id=m.match_id AND a.actor_type='USER') AS humans,
                          (SELECT count(*) FROM dodo_match_participant a WHERE a.match_id=m.match_id AND a.actor_type='CPU') AS bots
                   FROM dodo_match_participant mp JOIN dodo_player p USING(player_id)
                   JOIN dodo_match m USING(match_id) JOIN dodo_ruleset r USING(ruleset_id)
                   WHERE p.discord_user_id=$1 AND r.game_code='rummikub' AND r.active AND m.status='COMPLETED'
                   ORDER BY m.ended_at DESC, m.match_id DESC LIMIT 10""", discord_user_id,
            )
            return [dict(row) for row in rows]
