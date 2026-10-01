def verify_result(payload: dict, room: dict) -> str | None:
    score = payload.get('score')
    run_mode = room.get('runMode', 'normal')
    if payload.get('runMode', 'normal') != run_mode or not isinstance(score, dict) or type(score.get('left')) is not int:
        return None
    if payload.get('winnerId') != str(room['hostId']):
        return None
    stage, elapsed, cleared = payload.get('stage'), payload.get('elapsedMs'), payload.get('cleared')
    max_elapsed = 2_147_483_647 if run_mode == 'endless' else 260000
    if type(stage) is not int or not 1 <= stage <= 6 or type(elapsed) is not int or not 0 <= elapsed <= max_elapsed or type(cleared) is not bool:
        return None
    if run_mode == 'endless':
        if stage != 4 or cleared or score['left'] != elapsed:
            return None
        return f"게임 종료 · <@{room['hostId']}> {elapsed / 1000:.2f}초 생존"
    if not 0 <= score['left'] <= 100000 or cleared and stage != 6:
        return None
    return f"{'완주 성공' if cleared else '게임 종료'} · <@{room['hostId']}> {score['left']:,}점 · {stage}단계"
