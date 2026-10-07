import { randomInt } from 'node:crypto';
import { RelayRoom } from './volleyball-room.js';
import { freshBoard, shoot, step, remaining, timeoutShot, TURN_LIMIT_MS, TOSS_MS, type Shot, type Difficulty } from '../../shared/alkkagi.js';
import { computeShot } from './alkkagi-ai.js';
import type { Definition, Peer } from './protocol.js';
export class AlkkagiRoom extends RelayRoom {
  state = freshBoard();
  readonly blackSide: 'left' | 'right' = randomInt(2) ? 'left' : 'right';
  startsAt: number | null = null;
  turnDeadline: number | null = null;
  private clock?: ReturnType<typeof setInterval>;
  private turnTimer?: ReturnType<typeof setTimeout>;
  private cpuTimer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private generation = 0;
  private names = new Map<string,string>();
  constructor(definition: Definition) { super(definition); }
  get turnSide() { return this.state.turn === 1 ? this.blackSide : this.blackSide === 'left' ? 'right' : 'left'; }
  snapshot() {
    return {type:'ALKKAGI_STATE',now:Date.now(),matchId:this.matchId,room:this.definition,state:this.state,blackSide:this.blackSide,
      startsAt:this.startsAt,turnDeadline:this.turnDeadline,ready:this.ready(),result:this.result,delivered:this.delivered,spectators:this.spectators(),
      players:{left:this.names.get(this.definition.hostId) ?? '1P',right:this.definition.p2Id ? this.names.get(this.definition.p2Id) ?? '2P' : '도도봇'}};
  }
  presence() { this.broadcast(this.snapshot()); }
  join(peer: Peer) {
    if ([...this.peers].some(p => p.id === peer.id)) throw new Error('이미 다른 창에서 접속 중입니다.');
    if (this.role(peer.id) === 'spectator' && this.spectators().length >= 50) throw new Error('관전 인원이 가득 찼습니다.');
    this.peers.add(peer); this.names.set(peer.id,peer.name);
    peer.send({type:'ALKKAGI_JOIN',role:this.role(peer.id)});
    if (this.ready() && this.startsAt === null) this.startsAt = Date.now()+TOSS_MS;
    if (!this.result && !this.clock) {
      let ticks = 0;
      this.clock = setInterval(() => {
        if (!this.state.moving || this.result) return;
        this.state = step(this.state); this.lastActivity = Date.now();
        if (!this.state.moving) { this.finish(); this.schedule(); this.presence(); }
        else if (++ticks % 3 === 0) this.presence();
      },1000/60); this.clock.unref();
    }
    this.schedule(); this.presence();
  }
  leave(peer: Peer) { this.peers.delete(peer); if (this.role(peer.id) !== 'spectator') { this.cancelTurn(); this.schedule(); } this.presence(); }
  connectionStatus() { if (!this.result) this.broadcast({type:'ALKKAGI_CONNECTION',ready:this.ready()}); }
  fire(peer: Peer, message: any) {
    if (message.matchId !== this.matchId || message.revision !== this.state.revision) return peer.send({type:'SHOT_REJECTED',message:'보드가 변경되었습니다. 다시 조준해주세요.'});
    if (this.result || !this.ready() || this.startsAt === null || Date.now() < this.startsAt || this.role(peer.id) !== this.turnSide) return peer.send({type:'SHOT_REJECTED',message:'지금은 내 차례가 아닙니다.'});
    try { this.commit(message.shot); } catch (error) { peer.send({type:'SHOT_REJECTED',message:(error as Error).message}); }
  }
  private commit(shot: Shot) { this.state = shoot(this.state,shot); this.lastActivity = Date.now(); this.cancelTurn(); this.presence(); }
  private finish() {
    if (!this.state.winner && !this.state.draw) return;
    const winnerSide = this.state.draw ? 'draw' : this.state.winner === 1 ? this.blackSide : this.blackSide === 'left' ? 'right' : 'left';
    this.result = {roomId:this.definition.roomId,matchId:this.matchId,winnerSide,
      winnerId:winnerSide === 'left' ? this.definition.hostId : winnerSide === 'right' ? this.definition.p2Id : null,
      score:{left:remaining(this.state,this.blackSide === 'left' ? 1 : 2),right:remaining(this.state,this.blackSide === 'left' ? 2 : 1)},moveCount:this.state.revision};
    this.finishedAt = Date.now(); this.dispose();
  }
  private schedule() {
    if (this.result || this.state.moving || !this.ready() || this.startsAt === null || this.turnTimer || this.cpuTimer || this.controller) return;
    const wait = Math.max(0,this.startsAt-Date.now());
    if (this.definition.mode === 'CPU' && this.turnSide === 'right') {
      this.cpuTimer = setTimeout(() => {
        this.cpuTimer = undefined; const state = this.state, generation = this.generation;
        this.controller = new AbortController();
        void computeShot(state,(this.definition.difficulty ?? 'normal') as Difficulty,this.controller.signal).then(shot => {
          if (generation !== this.generation || state !== this.state || !this.ready() || this.result) return;
          this.controller = undefined; this.commit(shot);
        }).catch(() => {
          if (generation !== this.generation || state !== this.state || !this.ready() || this.result) return;
          this.controller = undefined; this.commit(timeoutShot(state));
        });
      },wait+500); this.cpuTimer.unref();
    } else {
      this.turnDeadline = Date.now()+wait+TURN_LIMIT_MS;
      this.turnTimer = setTimeout(() => { this.turnTimer = undefined; if (this.ready() && !this.result) this.commit(timeoutShot(this.state)); },wait+TURN_LIMIT_MS); this.turnTimer.unref();
    }
  }
  private cancelTurn() {
    this.generation++; this.controller?.abort(); this.controller = undefined;
    if (this.turnTimer) clearTimeout(this.turnTimer); this.turnTimer = undefined;
    if (this.cpuTimer) clearTimeout(this.cpuTimer); this.cpuTimer = undefined; this.turnDeadline = null;
  }
  input(_peer: Peer, _message: any) {}
  report(_peer: Peer, _message: any) {}
  abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  dispose() { this.cancelTurn(); if (this.clock) clearInterval(this.clock); this.clock = undefined; }
}
