export interface VoteStatus { matchId: string; votes: string[]; required: number; delivered: boolean }
/** Shared UI state for multi-seat rematches. Bots never vote. */
export class RematchVoting {
  matchId = ''; userId: string | null = null; votes: string[] = []; required = 0;
  delivered = false; finished = false; pending = false; error = '';
  constructor(private roomId: string, private token: string, private changed: () => void) {}
  configure(matchId: string, userId: string | null, humans: number, finished: boolean, delivered: boolean) {
    if (matchId !== this.matchId) { this.matchId = matchId; this.votes = []; this.pending = false; this.error = ''; }
    this.userId = userId; this.required = humans; this.finished = finished; this.delivered = delivered;
  }
  get voted() { return this.userId !== null && this.votes.includes(this.userId); }
  get canVote() { return this.finished && this.userId !== null && !this.pending && (!this.voted || !!this.error); }
  get label() { return this.userId === null ? '관전 중' : this.pending ? '재시작 준비 중…' : this.error ? '재시작 다시 시도' : this.voted ? '투표 완료' : '재시작 투표'; }
  get status() { return this.error || `재시작 투표 ${this.votes.length}/${this.required} · ${!this.delivered ? '결과 저장 중' : '사람 참가자 전원이 동의하면 시작합니다.'}`; }
  receive(status: VoteStatus) {
    if (status.matchId !== this.matchId) return;
    this.votes = [...status.votes]; this.required = status.required; this.delivered = status.delivered; this.changed();
    this.resume();
  }
  saved() { this.delivered = true; this.changed(); this.resume(); }
  private resume() { if (this.finished && this.delivered && this.voted && this.votes.length === this.required && !this.pending && !this.error) void this.vote(true); }
  async vote(resume = false) {
    if ((!resume && !this.canVote) || this.pending || !this.finished || this.userId === null) return;
    const match = this.matchId; this.pending = true; this.error = ''; this.changed();
    try {
      const response = await fetch('/api/rematch', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + this.token },
        body: JSON.stringify({ roomId: this.roomId, matchId: match }), signal: AbortSignal.timeout(15000) });
      const body = await response.json(); if (this.matchId !== match) return;
      if (!response.ok) throw new Error(body.error ?? '재시작하지 못했습니다. 다시 시도해주세요.');
      if (response.status === 202) { this.pending = false; if (Array.isArray(body.voters)) this.votes = body.voters; else if (!this.voted) this.votes.push(this.userId); }
      // 200: keep the button disabled until MATCH_REPLACED/new state arrives.
    } catch (error) { if (this.matchId !== match) return; this.pending = false; this.error = (error as Error).message; }
    if (this.matchId === match) { this.changed(); if (!this.error && !this.pending && this.delivered) this.resume(); }
  }
}
