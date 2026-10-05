CREATE TABLE IF NOT EXISTS dodo_player (
    player_id BIGSERIAL PRIMARY KEY,
    discord_user_id BIGINT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_played_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dodo_game (
    game_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS dodo_ruleset (
    ruleset_id BIGSERIAL PRIMARY KEY,
    game_code TEXT NOT NULL REFERENCES dodo_game(game_code),
    version TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_code, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS dodo_one_active_ruleset
ON dodo_ruleset(game_code) WHERE active;

CREATE TABLE IF NOT EXISTS dodo_match (
    match_id TEXT PRIMARY KEY,
    ruleset_id BIGINT NOT NULL REFERENCES dodo_ruleset(ruleset_id),
    guild_id BIGINT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('SOLO', 'CPU', 'PVP')),
    difficulty TEXT,
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'ABORTED')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dodo_match_participant (
    participant_id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    player_id BIGINT REFERENCES dodo_player(player_id),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('USER', 'CPU')),
    seat TEXT NOT NULL CHECK (seat IN ('LEFT', 'RIGHT', 'SOLO')),
    outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'DRAW', 'SCORE', 'ABORTED')),
    score BIGINT,
    UNIQUE (match_id, seat),
    CHECK ((actor_type = 'USER' AND player_id IS NOT NULL) OR (actor_type = 'CPU' AND player_id IS NULL))
);

CREATE TABLE IF NOT EXISTS arrow_dodge_match (
    match_id TEXT PRIMARY KEY REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    survival_ms BIGINT NOT NULL CHECK (survival_ms >= 0)
);

CREATE TABLE IF NOT EXISTS volleyball_match (
    match_id TEXT PRIMARY KEY REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    left_score SMALLINT NOT NULL,
    right_score SMALLINT NOT NULL
);

CREATE TABLE IF NOT EXISTS omok_match (
    match_id TEXT PRIMARY KEY REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    result_type TEXT NOT NULL CHECK (result_type IN ('LEFT_WIN', 'RIGHT_WIN', 'DRAW')),
    move_count SMALLINT
);

CREATE TABLE IF NOT EXISTS dodo_player_stat (
    player_id BIGINT NOT NULL REFERENCES dodo_player(player_id) ON DELETE CASCADE,
    ruleset_id BIGINT NOT NULL REFERENCES dodo_ruleset(ruleset_id),
    mode TEXT NOT NULL,
    difficulty_key TEXT NOT NULL DEFAULT '',
    scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL', 'GUILD')),
    scope_id BIGINT NOT NULL DEFAULT 0,
    plays INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    best_score BIGINT,
    total_score BIGINT NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, ruleset_id, mode, difficulty_key, scope_type, scope_id)
);

-- 초기 개발 스키마의 중복 game_code 열을 제거한다. 게임은 ruleset을 통해 결정된다.
ALTER TABLE dodo_player_stat DROP COLUMN IF EXISTS game_code;
DROP INDEX IF EXISTS dodo_stats_player;
DROP INDEX IF EXISTS dodo_stats_score_rank;
DROP INDEX IF EXISTS dodo_stats_rating_rank;
CREATE INDEX IF NOT EXISTS dodo_stats_player ON dodo_player_stat(player_id, ruleset_id, mode);
CREATE INDEX IF NOT EXISTS dodo_stats_score_rank ON dodo_player_stat(ruleset_id, mode, difficulty_key, scope_type, scope_id, best_score DESC);
CREATE INDEX IF NOT EXISTS dodo_stats_rating_rank ON dodo_player_stat(ruleset_id, mode, difficulty_key, scope_type, scope_id, rating DESC);

INSERT INTO dodo_game(game_code, name) VALUES
    ('arrow_dodge', '화살피하기'), ('volleyball', '배구'), ('omok', '오목')
ON CONFLICT (game_code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO dodo_ruleset(game_code, version) VALUES
    ('arrow_dodge', 'arrow-dodge-v1'), ('volleyball', 'volleyball-v1'), ('omok', 'omok-v1')
ON CONFLICT (game_code, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS rock_run_match (
    match_id TEXT PRIMARY KEY REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100000),
    stage SMALLINT NOT NULL CHECK (stage BETWEEN 1 AND 6),
    cleared BOOLEAN NOT NULL,
    elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0)
);
ALTER TABLE rock_run_match DROP CONSTRAINT IF EXISTS rock_run_match_score_check;
ALTER TABLE rock_run_match ALTER COLUMN score TYPE BIGINT;
ALTER TABLE rock_run_match ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE rock_run_match DROP CONSTRAINT IF EXISTS rock_run_match_run_mode_check;
ALTER TABLE rock_run_match ADD CONSTRAINT rock_run_match_run_mode_check CHECK (run_mode IN ('normal', 'endless'));
UPDATE dodo_player_stat s SET difficulty_key='normal'
FROM dodo_ruleset r
WHERE s.ruleset_id=r.ruleset_id AND r.game_code='rock_run' AND s.mode='SOLO' AND s.difficulty_key='';
INSERT INTO dodo_game(game_code,name) VALUES ('rock_run','바위달리기') ON CONFLICT DO NOTHING;
INSERT INTO dodo_ruleset(game_code,version) VALUES ('rock_run','rock-run-v1') ON CONFLICT DO NOTHING;

-- Preserve legacy seat names while admitting four-seat games.
ALTER TABLE dodo_match_participant DROP CONSTRAINT IF EXISTS dodo_match_participant_seat_check;
ALTER TABLE dodo_match_participant ADD CONSTRAINT dodo_match_participant_seat_check
    CHECK (seat IN ('LEFT', 'RIGHT', 'SOLO', 'P1', 'P2', 'P3', 'P4'));
ALTER TABLE dodo_match_participant ADD COLUMN IF NOT EXISTS bot_difficulty TEXT;
CREATE TABLE IF NOT EXISTS rummikub_match (
    match_id TEXT PRIMARY KEY REFERENCES dodo_match(match_id) ON DELETE CASCADE,
    winner_seat SMALLINT CHECK (winner_seat BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS dodo_stats_total_rank ON dodo_player_stat
    (ruleset_id, mode, difficulty_key, scope_type, scope_id, total_score DESC);
CREATE INDEX IF NOT EXISTS dodo_participant_history ON dodo_match_participant(player_id, match_id);
INSERT INTO dodo_game(game_code,name) VALUES ('rummikub','루미큐브') ON CONFLICT DO NOTHING;
INSERT INTO dodo_ruleset(game_code,version)
    SELECT 'rummikub','rummikub-points-v1'
    WHERE NOT EXISTS (SELECT 1 FROM dodo_ruleset WHERE game_code='rummikub')
ON CONFLICT DO NOTHING;
