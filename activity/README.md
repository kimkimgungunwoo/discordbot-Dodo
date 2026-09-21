# Dodo Volley Activity 연결

## 실행 설정

루트 `.env`에 아래 값을 설정한다. Discord 앱 ID/Secret은 **봇과 동일한 앱**의 Developer Portal 값이다. Secret은 프런트엔드에 전달하지 않는다.

```dotenv
ACTIVITY_SERVER_URL=http://localhost:3001
BOT_INTERNAL_URL=http://host.docker.internal:3002
BOT_INTERNAL_HOST=0.0.0.0
BOT_INTERNAL_PORT=3002
ACTIVITY_INTERNAL_SECRET=<봇과 서버가 공유하는 32자 이상의 무작위 비밀값>
DISCORD_CLIENT_ID=<Discord application ID>
DISCORD_CLIENT_SECRET=<Discord OAuth2 client secret>
```

이번 구현에서 로컬 `.env`에 내부 통신 주소와 무작위 공유 키를 추가했다. 비어 있는 Discord 자격 증명은 직접 채워야 한다. 운영에서 봇도 컨테이너라면 `ACTIVITY_SERVER_URL=http://activity-server:3001`, `BOT_INTERNAL_URL=http://<봇 서비스명>:3002`로 바꾼다. 내부 API는 공용 프록시에 노출하지 않는다.

```sh
docker compose up -d activity-client activity-server
python -m bot.main
```

`http://localhost:5173`은 기존 CPU 연습 모드다. 실제 온라인 모드는 Discord Activity iframe의 `frame_id`가 있을 때만 자동 선택된다. `?mode=online`은 SDK 초기화를 강제로 요청하는 진단 옵션이지 브라우저용 인증 우회가 아니다.

Discord Developer Portal에서 Activities를 활성화하고 URL Mapping을 설정해야 한다. Activity의 동일 출처 `/`는 클라이언트, `/api/*`와 `/ws`는 activity-server로 전달한다. 로컬 Vite에는 이 프록시가 이미 있으며 Docker에서는 `ACTIVITY_PROXY_TARGET=http://activity-server:3001`을 사용한다. 외부 개발 도메인에 대한 Vite 허용 호스트 설정과 HTTPS 터널/운영 프록시 구성은 별도다. `/internal/*`는 공개 경로에 포함하지 않는다. OAuth 승인 범위는 `identify`, `guilds.members.read`다.

## 사용자 흐름

1. 서버 채팅에서 `!게임 배구`를 입력하면 **봇전 / 대결** 선택 버튼이 뜬다. 명령어 작성자만 선택할 수 있으며 메뉴는 3분 후 만료된다.
2. **봇전**은 **쉬움 / 보통 / 어려움 / 극한** 중 하나를 선택하면 바로 세션을 생성한다. 방 메시지의 **Activity 열기**로 입장한다. 다른 사용자는 관전만 가능하다.
3. **대결**은 기존 참가/참가 취소/관전/게임 시작/방 닫기 대기방을 만든다. 상대가 참가해야 방장이 시작할 수 있다.
4. Activity에서 Discord 인증 후 방 목록에서 참가하거나 관전할 경기를 선택한다. 본인 경기 자동 연결로 다른 방 관전이 막히지 않도록 항상 선택 화면을 표시한다. PVP는 두 플레이어가 접속해야 진행된다.
5. 결과는 봇 메시지에 표시하고 대기방으로 돌아간다. 같은 방에서 다시 시작하거나 Activity 재대결 버튼을 사용할 수 있다. 봇전은 같은 난이도를 유지한다.

### 봇전 난이도

- 쉬움: 주기적인 반응 지연과 큰 위치 오차, 기본 리시브 위주.
- 보통: 기존 AI 그대로. 난이도가 없는 이전 CPU 세션도 보통으로 처리한다.
- 어려움: 실제 공 물리로 벽/천장/네트 반사를 예측하고 16틱 행동 후보를 비교한다.
- 극한: 24틱 행동 후보와 상하 스파이크·긴급 다이빙을 비교해 수비 및 상대 위치에 따른 공격을 선택한다.

모든 난이도는 같은 플레이어 물리를 사용한다. AI 판단은 상태와 게임 틱만 사용하며 관전/재접속/화면 예측에서도 동일하게 재현된다. `cd activity/client && node tests/ai-benchmark.mjs`로 기존 보통 AI 상대 좌우·서브 교대 비교를 실행할 수 있다. 이는 제한된 자동 비교이며 사람 상대 체감 난이도는 플레이 테스트로 조정한다.

## 프로토콜과 동기화

- 봇 ↔ 서버 내부 요청은 공유 Bearer 키로 인증한다. 방 생성은 같은 방/같은 명단에 대해 멱등 처리한다. 응답 유실 시 참가자를 고정한 채 같은 시작 버튼으로 재시도할 수 있다.
- SDK authorize → 서버 OAuth 코드 교환 → SDK authenticate → WS `AUTH {roomId, token}`. 서버가 Discord `/oauth2/@me`, `/users/@me`, 길드 멤버 API로 앱/사용자/길드를 확인한다. 클라이언트가 보내는 userId는 사용하지 않는다.
- `GAME_START`는 seed, 60Hz, 고정 명단/역할을 전달한다. `INPUT {tick,seq,input}`을 즉시 중계하고, 양쪽 입력이 갖춰진 연속 tick은 `FRAME`으로 확정한다. 경기 판정은 확정 프레임으로 진행하고 화면은 미리 전송한 입력으로 예측한다. CPU 방은 host 입력만 중계하고 각 클라이언트가 같은 난이도의 AI를 실행한다.
- 6 tick 입력 버퍼(약 100ms)를 사용한다. 입력이 없으면 시간을 건너뛰지 않고 멈춘다. 화면 크기/렌더링 속도는 물리에 영향을 주지 않지만 느린 연결이나 백그라운드 플레이어는 전체 경기를 지연시킬 수 있다. 화면 예측은 매번 확정 상태에서 다시 계산한다.
- 전체 입력 로그를 메모리에 보관한다. 중도 관전/재접속 시 동일 seed부터 빠르게 재생하고 과거 사운드는 생략한다. 재접속 시 미확정 입력을 다시 제출한다. 플레이어 중복 창 접속은 거부한다.
- 최대 200개 방, 방당 52개 접속, 72,000 tick 로그 한도다. 입력 진행이 5분 없으면 중단한다. WAITING Bot Room도 5분에 자동 종료한다.
- PVP 결과는 양쪽의 종료 tick/점수가 일치해야 확정한다. CPU 결과는 host가 보고한다. 콜백 실패 시 5초 간격으로 재시도한다. 종료 방은 재대결을 위해 잠시 유지하며 같은 방 ID를 새 seed로 재사용한다.
- 서버는 물리를 전혀 실행하지 않는다. 따라서 클라이언트 조작을 막는 권위 서버가 아니며, 주기적 체크섬/host snapshot 강제 동기화는 미구현이다. 결과 불일치는 중단 처리한다.
- 방/로그/종료 ID는 메모리 전용이다. 서버 재시작 시 유실된다. Cog unload는 타이머/View/HTTP 서버를 정리한다. 봇 reload 후 이전 로비는 복원되지 않으며 이미 시작한 서버 경기는 종료/만료 시 정리된다.

## 검증

```sh
docker compose exec -T activity-client npm test
docker compose exec -T activity-client npm run build
docker compose exec -T activity-server npm test
docker compose exec -T activity-server npm run build
discordvenv/bin/python -m unittest bot.cogs.dodovolley.test_lobby
```

서버 네트워크 테스트는 실제 HTTP/WebSocket을 사용하되 Discord API와 봇 결과 수신만 mock 처리한다. 클라이언트 테스트는 기존 물리 18개와 PVP/관전 동일 상태, 끊김 후 재전송, CPU 로그 재생을 검증한다. 실제 Discord 계정 2개로 OAuth/Activity 실행과 PVP 체감 지연을 확인하는 최종 검증은 앱 자격 증명 및 URL Mapping 설정 후 별도로 필요하다.


## 경기 수명주기와 관전

- 각 경기는 `roomId`와 별도의 `matchId`를 사용한다. 봇은 지난 경기 결과 재전송을 무시한다.
- Activity 재대결은 `/internal/game-rematches`로 봇에 요청한다. 봇의 동일 로비 잠금 안에서 명단·방 종료·만료를 확인하고 다음 경기를 생성한다. 따라서 봇과 Activity 서버를 같은 버전으로 갱신해야 한다.
- 종료 후에도 WebSocket을 유지한다. 재대결 생성 시 `MATCH_REPLACED`, 방 삭제·만료 시 `ROOM_CLOSED`를 알린다. 종료된 방에 재접속하면 기록과 최종 결과를 재전송한다.
- 관전자는 최대 50명이며 선수 두 자리는 별도로 확보한다. 같은 계정의 중복 접속은 거부한다. 관전자 입력과 결과 제출은 무시한다.
- 연결 또는 입력이 멈춘 플레이어를 화면에 표시하고, 5분간 진행이 없으면 경기를 중단한다. 결과 전송 실패는 5초 간격으로 재시도하며 완료 전에는 재대결을 비활성화한다.
- 메모리 상태는 프로세스 재시작 시 복원하지 않는다. 운영 배포 구성과 영속 저장은 별도 작업이다.
