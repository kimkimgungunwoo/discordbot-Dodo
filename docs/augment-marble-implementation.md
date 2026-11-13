# 증강마블 구현 구조

원본 능력 기준은 [60개 개별 카드 대조표](augment-marble-abilities.md)다. 과거 20계열 × 3등급 카탈로그는 폐기했다. 카드 이름과 효과를 등급별로 복제하지 않는다.

## 코드

- `games/shared/augment-marble-augments.ts`: 명시적으로 등록한 원본 60개 카드, 등급, 제안·리롤·선택.
- `games/shared/augment-marble-effects.ts`: 수입·지출, 월급, 할인, 강탈·페이백, 지역 도박 배율, 전환·획득 효과.
- `games/shared/augment-marble-runtime.ts`: 투척 조건·리롤·비교, 현재 상태, 라운드 설치물, 공개 연출 이벤트.
- `games/shared/augment-marble.ts`: 한 칸씩 이동, 통과 반응, 시작 공격, 대상 선택, 도착 효과, 채무·부활, 무인도 매수, 랜드마크.
- `games/client/src/augment-marble/copy.ts`: 실제 이름·설명·발동 시점. 원본에 없는 공통 계열명으로 덮어쓰지 않는다.
- `games/client/src/augment-marble/main.ts`: 카드 선택, 보유 능력, 블라디미르 대상 선택, 무인도 매수 UI.
- `games/server/src/augment-marble-room.ts`: 서버 판정, 참가자·턴·리비전 검증, 제한 시간, 상태 공개와 저장.

- `games/shared/augment-marble-events.ts`: 이벤트 33개, 복원 추첨, 선택 상태·쿠폰·지속 효과·이동 대상 큐. 세부 규칙은 [이벤트 문서](augment-marble-events.md).

## 상태와 호환성

도박 결과는 사용자·지역별로 유지한다. 따라쟁이는 사용자·턴 ID가 있는 확정 투척 이력을 사용한다. 블라디미르 대상 선택은 `ability_target` 요청이며 일반 투척과 같은 제한 시간 안에서 처리한다. 상태의 `abilities.schemaVersion`은 2다. 구형 잘못된 카탈로그의 저장 파일은 유지하되 복원하지 않는다.

## 검증과 적용 기준

`games/server/tests/augment-marble*.test.ts`로 회귀 검사한다. 실버 힘조절은 6 이하 / 6 초과, 재산은 보유 현금으로 확정했다. 미지정 수치는 기존 구현값을 우선 적용하며 능력 대조표에 기록한다. 구형 카탈로그의 경제 분석 결과를 새 능력에 적용하지 않는다.
