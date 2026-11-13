import type { Game } from "../../../shared/augment-marble";
import type { AbilityEvent } from "../../../shared/augment-marble-runtime";

export type SoundCue = "click" | "ready" | "start" | "turn" | "roll" | "dice" | "double" | "hop" | "land" | "buy" | "build" | "landmark" | "takeover" | "income" | "payment" | "transfer" | "salary" | "augment" | "reroll" | "event-positive" | "event-neutral" | "event-negative" | "kick" | "trap" | "drain" | "revive" | "buff" | "flight" | "portal" | "wall" | "quake" | "island" | "bankrupt" | "victory" | "error";
export function abilitySound(e: AbilityEvent): SoundCue | null {
  if (e.ability === "dice" || e.visual === "dice") return null;
  if (["vladimir", "mosquito", "exploit"].includes(e.ability)) return "drain";
  return ({steal:"drain",kick:"kick",trip:"kick",poison:"trap",trap:"trap",income:"income",revive:"revive",buff:"buff"} as const)[e.visual] ?? "buff";
}
/** Committed changes only. Presence updates and reconnect baselines never produce cues. */
export function stateSounds(previous: Game, next: Game): SoundCue[] {
  const cues = new Set<SoundCue>();
  next.properties.forEach((p,i) => {
    const before = previous.properties[i];
    if (p.owner !== null && p.owner !== before.owner) cues.add(before.owner === null ? "buy" : "takeover");
    if (p.buildings > before.buildings) cues.add("build");
    if (p.landmark && !before.landmark) cues.add("landmark");
  });
  if (next.players.some((p,i) => p.rest > previous.players[i].rest)) cues.add("island");
  if (next.players.some((p,i) => p.bankrupt && !previous.players[i].bankrupt)) cues.add("bankrupt");
  if (next.phase === "finished" && previous.phase !== "finished") cues.add("victory");
  else if (next.turnId !== previous.turnId) cues.add("turn");
  next.augments?.players.forEach((p,i) => {
    const before=previous.augments?.players[i];
    if (before && p.owned.some(id => !before.owned.includes(id))) cues.add("augment");
    if (before?.offer && p.offer?.id === before.offer.id && p.offer.cards.some((card,j) => card !== before.offer!.cards[j])) cues.add("reroll");
  });
  return [...cues];
}

interface Preferences { enabled: boolean; music: boolean; volume: number }
const STORAGE_KEY="marble-sound-v1";
/** Original synthesized sound palette: no downloads, licensed samples, or network dependency. */
export class MarbleSound {
  readonly preferences: Preferences = {enabled:true,music:false,volume:.55};
  private context?: AudioContext;
  private master?: GainNode;
  private musicBus?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private voices = new Set<AudioScheduledSourceNode>();
  private recent = new Map<SoundCue,number>();
  private musicTimer?: ReturnType<typeof setInterval>;
  private bar=0;
  private active=false;
  private noiseBuffer?: AudioBuffer;
  constructor() {
    try {
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)??"null");
      if(typeof saved?.enabled==="boolean")this.preferences.enabled=saved.enabled;
      if(typeof saved?.music==="boolean")this.preferences.music=saved.music;
      if(typeof saved?.volume==="number"&&Number.isFinite(saved.volume))this.preferences.volume=Math.max(0,Math.min(1,saved.volume));
    } catch { /* Storage can be unavailable in an embedded activity. */ }
    document.addEventListener("visibilitychange",this.visibility);
  }
  private visibility=()=>{
    if(document.hidden){this.stop();void this.context?.suspend().catch(()=>{});}
    // Resuming requires a fresh interaction: never replay sounds accumulated while hidden.
  };
  async unlock() {
    if(document.hidden)return;
    try {
      if(!this.context){
        this.context=new AudioContext();
        this.compressor=this.context.createDynamicsCompressor();this.compressor.threshold.value=-14;this.compressor.ratio.value=6;this.compressor.connect(this.context.destination);
        this.master=this.context.createGain();this.master.connect(this.compressor);
        this.musicBus=this.context.createGain();this.musicBus.gain.value=.16;this.musicBus.connect(this.master);
        this.applyVolume();
      }
      if(this.context.state==="suspended")await this.context.resume();
      this.syncMusic();
    }catch{ /* Unsupported or browser-blocked audio must never block gameplay. */ }
  }
  configure(values: Partial<Preferences>) {
    Object.assign(this.preferences,values);
    this.preferences.volume=Math.max(0,Math.min(1,this.preferences.volume));
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(this.preferences));}catch{}
    if(!this.preferences.enabled)this.stop();
    this.applyVolume();this.syncMusic();
  }
  setActive(active:boolean){this.active=active;this.syncMusic();}
  private applyVolume(){if(this.context&&this.master)this.master.gain.setTargetAtTime(this.preferences.enabled?this.preferences.volume:0,this.context.currentTime,.025);}
  private tone(frequency:number,delay=0,duration=.14,level=.12,type:OscillatorType="sine",end=frequency,bus=this.master){
    const ctx=this.context;if(!ctx||!bus||this.voices.size>=48)return;
    const at=ctx.currentTime+delay,o=ctx.createOscillator(),gain=ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(Math.max(20,frequency),at);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,level),at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    o.connect(gain);gain.connect(bus);this.voices.add(o);o.onended=()=>{this.voices.delete(o);o.disconnect();gain.disconnect();};o.start(at);o.stop(at+duration+.02);
  }
  private noise(delay:number,duration:number,level:number,frequency=1800){
    const ctx=this.context;if(!ctx||!this.master||this.voices.size>=48)return;
    if(!this.noiseBuffer){this.noiseBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const data=this.noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}
    const at=ctx.currentTime+delay,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();source.buffer=this.noiseBuffer;filter.type="lowpass";filter.frequency.value=frequency;
    gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(level,at+.015);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter);filter.connect(gain);gain.connect(this.master);this.voices.add(source);source.onended=()=>{this.voices.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};source.start(at);source.stop(at+duration+.02);
  }
  private notes(notes:number[],gap=.09,duration=.22,level=.1,type:OscillatorType="sine") {notes.forEach((n,i)=>this.tone(n,i*gap,duration,level,type));}
  play(cue:SoundCue){
    if(!this.preferences.enabled||!this.preferences.volume||document.hidden||this.context?.state!=="running")return;
    const now=performance.now();if(now-(this.recent.get(cue)??-Infinity)<(cue==="hop"?90:70))return;this.recent.set(cue,now);
    switch(cue){
      case "click":this.tone(750,0,.035,.035,"triangle",540);break;
      case "ready":this.notes([440,660],.08,.16);break;
      case "start":this.notes([261.63,329.63,392,523.25],.15,.35,.12,"triangle");break;
      case "turn":this.notes([523.25,659.25],.09,.18,.075);break;
      case "roll":for(let i=0;i<9;i++){this.noise(i*.075,.045,.13,1400+i*140);this.tone(180+i*31,i*.075,.045,.055,"triangle");}break;
      case "dice":this.noise(0,.09,.18,1300);this.tone(310,0,.13,.09,"triangle",170);break;
      case "double":this.notes([523.25,659.25,783.99],.09,.22,.13,"triangle");break;
      case "hop":this.tone(360,0,.075,.065,"sine",530);break;
      case "land":this.tone(180,0,.09,.075,"sine",90);break;
      case "buy":this.notes([392,523.25,659.25],.09,.22,.12,"triangle");break;
      case "build":[0,.13,.26].forEach(d=>{this.noise(d,.06,.12,950);this.tone(140,d,.09,.11,"triangle",90);});this.tone(660,.36,.2,.09);break;
      case "landmark":this.notes([261.63,392,523.25,659.25,783.99,1046.5],.1,.42,.12,"triangle");break;
      case "takeover":this.noise(0,.12,.14,1600);this.notes([293.66,440,587.33],.12,.25,.12,"triangle");break;
      case "income":case "transfer":this.notes([1046.5,1318.5,1568],.1,.2,.085);break;
      case "payment":this.notes([783.99,659.25,523.25],.08,.16,.075);break;
      case "salary":this.notes([523.25,659.25,783.99,1046.5],.1,.25,.11,"triangle");break;
      case "augment":this.notes([392,587.33,783.99,1174.66],.09,.34,.095);break;
      case "reroll":this.tone(300,0,.25,.08,"sine",1200);this.noise(0,.2,.06,4500);break;
      case "event-positive":this.notes([523.25,659.25,783.99,1046.5],.1,.3,.1);break;
      case "event-neutral":this.notes([440,587.33,523.25],.12,.23,.09,"triangle");break;
      case "event-negative":this.notes([392,311.13,261.63],.12,.3,.1,"triangle");break;
      case "kick":this.noise(0,.13,.23,1200);this.tone(190,0,.17,.16,"sine",45);break;
      case "trap":this.noise(0,.06,.14,3700);this.notes([740,415],.12,.15,.08,"triangle");break;
      case "drain":this.tone(160,0,.6,.1,"sawtooth",430);this.tone(240,.04,.5,.065,"sine",680);this.noise(0,.38,.045,900);break;
      case "revive":this.notes([261.63,392,523.25,783.99,1046.5],.14,.45,.11);break;
      case "buff":this.notes([659.25,987.77],.1,.25,.075);break;
      case "flight":this.noise(0,.48,.09,2500);this.tone(250,0,.35,.065,"sine",850);this.tone(600,.35,.35,.06,"sine",160);break;
      case "portal":this.tone(130.81,0,.9,.1,"sine",523.25);this.tone(196,.08,.8,.08,"triangle",783.99);this.notes([1046.5,1568],.15,.2,.06);break;
      case "wall":this.noise(.24,.16,.22,1200);this.tone(120,.24,.2,.15,"sine",40);break;
      case "quake":this.noise(0,.85,.22,450);[0,.18,.37].forEach(d=>this.tone(75,d,.24,.14,"triangle",30));break;
      case "island":this.notes([392,329.63,261.63,196],.12,.23,.09,"triangle");break;
      case "bankrupt":this.notes([311.13,261.63,196,130.81],.18,.35,.12,"triangle");break;
      case "victory":this.notes([392,392,523.25,659.25,783.99,659.25,1046.5],.17,.48,.13,"triangle");break;
      case "error":this.notes([220,164.81],.1,.13,.07,"triangle");break;
    }
  }
  private syncMusic(){
    const enabled=this.active&&this.preferences.enabled&&this.preferences.music&&this.preferences.volume>0&&!document.hidden&&this.context?.state==="running";
    if(this.context&&this.musicBus)this.musicBus.gain.setTargetAtTime(enabled?.16:0,this.context.currentTime,.04);
    if(!enabled){clearInterval(this.musicTimer);this.musicTimer=undefined;return;}
    if(this.musicTimer)return;
    const tick=()=>{
      if(document.hidden)return;
      const chords=[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]],chord=chords[this.bar++%4];
      chord.forEach((n,i)=>this.tone(n,i*.12,1.6,.035,"sine",n,this.musicBus));
      for(let i=0;i<4;i++)this.tone(chord[i%3]*2,i*.48,.3,.06,"triangle",chord[i%3]*2,this.musicBus);
      this.tone(chord[0]/2,0,1.4,.07,"sine",chord[0]/2,this.musicBus);
    };tick();this.musicTimer=setInterval(tick,1920);
  }
  stop(){clearInterval(this.musicTimer);this.musicTimer=undefined;for(const node of this.voices){try{node.stop();}catch{}}this.voices.clear();this.recent.clear();}
  dispose(){this.stop();document.removeEventListener("visibilitychange",this.visibility);void this.context?.close().catch(()=>{});}
}
