import { TICK_RATE, type State } from '../../../shared/bomb-battle';

/** Remote players render one snapshot behind; local prediction is never delayed. */
export class Presentation {
  private frames: { state: State; at: number }[] = [];
  private match = '';
  receive(state: State, match: string, now: number) {
    if(match!==this.match || (this.frames.length && state.tick<this.frames.at(-1)!.state.tick)) this.frames=[];
    this.match=match;
    if(this.frames.at(-1)?.state.tick===state.tick) return;
    this.frames.push({state,at:now});
    if(this.frames.length>12)this.frames.shift();
  }
  sample(state: State, own: number, now: number) {
    const positions=state.players.map(p=>({x:p.x,y:p.y}));
    const last=this.frames.at(-1);if(!last)return positions;
    const target=last.state.tick + Math.max(0,now-last.at)*TICK_RATE/1000-4;
    let a=this.frames[0],b=a;
    for(const frame of this.frames){if(frame.state.tick<=target)a=frame;if(frame.state.tick>=target){b=frame;break;}b=frame;}
    const alpha=b.state.tick===a.state.tick?1:Math.max(0,Math.min(1,(target-a.state.tick)/(b.state.tick-a.state.tick)));
    return positions.map((p,i)=>{
      if(i===own || !state.players[i].alive)return p;
      const before=a.state.players[i],after=b.state.players[i];
      if(!before || !after || before.alive!==after.alive || Math.hypot(after.x-before.x,after.y-before.y)>2)return p;
      return {x:before.x+(after.x-before.x)*alpha,y:before.y+(after.y-before.y)*alpha};
    });
  }
}
