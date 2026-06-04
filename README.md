# Discord Bot

Python으로 작성된 Discord 봇 + FastAPI 웹 서버. 음악 재생, AI 챗봇, 미니게임, 파티, 포인트 시스템을 제공합니다.

## 프로젝트 구조

```
discordbot/
├── api/
│   ├── main.py          # FastAPI 앱 진입점
│   ├── database.py      # SQLAlchemy async 엔진/세션/Base
│   ├── crud/            # DB 조작 함수
│   │   ├── user_crud.py
│   │   ├── attendance_crud.py
│   │   └── game_log_crud.py
│   ├── models/          # ORM 모델
│   │   ├── user.py
│   │   ├── attendance.py
│   │   ├── game_log.py
│   │   ├── gamble_log.py
│   │   ├── point_history.py
│   │   └── enums.py
│   ├── routers/         # APIRouter 모음
│   └── schemas/         # Pydantic 스키마
│       ├── user_schema.py
│       └── game_log_schema.py
├── alembic/             # DB 마이그레이션
│   ├── env.py
│   └── versions/
├── alembic.ini          # Alembic 설정
├── bot/
│   ├── main.py          # 진입점
│   ├── core/
│   │   └── bot.py       # MyBot 클래스, Cog 로딩
│   └── cogs/
│       ├── basic.py     # 기본 인사 명령어
│       ├── control.py   # 봇 제어 및 도움말
│       ├── game.py      # 미니게임 (참참참, 가위바위보) + 포인트
│       ├── music.py     # 유튜브 음악 재생
│       ├── party.py     # 파티 생성/관리
│       ├── user.py      # 유저 등록/정보/출석/게임기록
│       ├── util.py      # Gemini AI 챗봇
│       └── test.py      # 테스트용
├── .env                 # 환경 변수 (git 제외)
└── discordvenv/         # 가상환경 (git 제외)
```

## DB 스키마

| 테이블 | 설명 |
|--------|------|
| `user` | Discord 유저 (user_id, point, created_at) |
| `attendance` | 출석 기록 (user_id, date, point) — (user_id, date) unique |
| `game_log` | 게임 결과 기록 (user_id, game_type, result, point) |
| `gamble_log` | 도박 결과 기록 (user_id, gamble_type, point) |
| `point_history` | 포인트 변동 전체 이력 (user_id, amount, reason) |

## 환경 변수 (.env)

`.env.example`을 복사해서 `.env`로 만든 뒤 값을 채웁니다.

| 변수 | 설명 |
|------|------|
| `token` | Discord Bot 토큰 |
| `GEMINI_API_KEY` | Google Gemini API 키 |
| `gemini_prompt` | `!g` 명령어 프롬프트 |
| `chatbot_prompt` | `!c` 챗봇 세션 초기 프롬프트 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (`postgresql+asyncpg://user:pw@host:port/db`) |

## 실행

```bash
# 가상환경 활성화
source discordvenv/bin/activate

# 디스코드 봇 실행
python -m bot.main

# FastAPI 서버 실행
uvicorn api.main:app --reload

# DB 마이그레이션
alembic revision --autogenerate -m "메시지"
alembic upgrade head
```

## 명령어

### 봇 제어
| 명령어 | 설명 |
|--------|------|
| `!bot` | 현재 음성 채널에 봇 입장 |
| `!help` | 명령어 목록 (별칭: `!도움말`, `!명령어`) |

### 유저 / 포인트
| 명령어 | 설명 |
|--------|------|
| `!등록` | 유저 등록 (최초 1회, 1,000P 지급) |
| `!정보` | 내 프로필 확인 (닉네임, 포인트, 가입일) |
| `!출석` | 출석 체크 — 1일 1회, 기본 1,000P / 4% 확률로 2,000P |
| `!게임기록` | 최근 게임 5판 전적, 승률, 보유 포인트 확인 |

> `!등록` 이후 유저 기능 사용 가능. `!출석`은 하루 1회만 인정.

### 음악
| 명령어 | 설명 |
|--------|------|
| `!music <검색어>` | 유튜브 검색 후 드롭다운 선택 재생 (별칭: `!노래`, `!음악`) |
| `!musiclist` | 현재 대기열 확인 (별칭: `!노래목록`, `!음악목록`) |
| `!musiclist r` | 드롭다운으로 대기열 곡 제거 |
| `!pause` | 일시정지 / 재개 토글 (별칭: `!정지`) |
| `!skip` | 현재 곡 건너뛰기 (별칭: `!스킵`) |

### 게임
| 명령어 | 설명 |
|--------|------|
| `!game` | 미니게임 선택 드롭다운 표시 (별칭: `!게임`) |

게임 목록 (등록 유저만 포인트 반영):
- **참참참** — 봇과 방향이 다르면 승리. 승리 +100P / 패배 -100P
- **가위바위보** — 봇과 대결. 승리 +100P / 비김 ±0P / 패배 -100P
- **제비뽑기** — 승 60% (+100~+500P) / 패 40% (-100~-700P)

### 파티
| 명령어 | 설명 |
|--------|------|
| `!party <YYYY/MM/DD/HH/MM> <제목>` | 파티 생성 |
| `!partylist` | 파티 목록 확인 |
| `!partydel <번호>` | 파티 삭제 |
| `!partymembers <번호>` | 파티 멤버 확인 |

지정 시간이 되면 참여자 전원에게 멘션 알림 발송.

### AI 챗봇
| 명령어 | 설명 |
|--------|------|
| `!g <질문>` | Gemini AI에게 단발성 질문 (별칭: `!AI`, `!ai`) |
| `!c` | Gemini 멀티턴 챗봇 세션 시작 (별칭: `!chat`, `!챗봇`, `!gemini`) |

챗봇 세션은 별도 스레드에서 진행되며, 최대 10회 대화 후 자동 종료됩니다.

### 기타
| 명령어 | 설명 |
|--------|------|
| `!안녕` | 인사 (별칭: `!hi`, `!하이`, `!안녕하세요`) |

## 기술 스택

- **discord.py** — Discord API 클라이언트
- **yt-dlp** — 유튜브 오디오 스트리밍
- **FFmpeg** — 오디오 인코딩 (`libopus`: `/opt/homebrew/lib/libopus.dylib`)
- **google-generativeai** — Gemini 2.5 Flash Lite AI
- **FastAPI + Uvicorn** — 웹 API 서버
- **SQLAlchemy 2.0 (async)** — ORM
- **Alembic** — DB 마이그레이션
- **asyncpg** — async PostgreSQL 드라이버
- **python-dotenv** — 환경 변수 관리

## 아키텍처

- `commands.Bot` 서브클래스(`MyBot`)에 Cog 기반으로 기능 분리
- 모든 UI 요소는 `discord.ui.View` / `discord.ui.Select` / `discord.ui.Button` 사용
- 음악 큐는 `guild_id → list[Track]` 딕셔너리로 서버별 독립 관리
- Gemini 챗봇 세션은 `thread_id → chat` 딕셔너리로 스레드별 독립 관리
- 포인트 변동은 항상 `point_history` 테이블에 원자적으로 기록 (`_apply_point`)
- Bot Cog에서 `api.database.SessionLocal`을 직접 사용해 DB 접근
