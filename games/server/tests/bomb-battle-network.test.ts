import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

test('real HTTP/WS four-seat match, no input stall, spectator, reconnect, authoritative draw callback and closure', {timeout:15000}, async()=>{
  process.env.PORT='0';process.env.DISCORD_CLIENT_ID='bomb-test';process.env.ACTIVITY_INTERNAL_SECRET=randomUUID();process.env.BOT_INTERNAL_URL='http://bot.test';
  const realFetch=globalThis.fetch, results:any[]=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('http://bot.test')){results.push(JSON.parse(String(options?.body)));return Response.json({ok:true});}
    if(!String(url).startsWith('https://discord.com/'))return realFetch(url,options);
    const id=new Headers(options?.headers).get('Authorization')!.replace('Bearer ','');
    if(String(url).endsWith('/oauth2/@me'))return Response.json({application:{id:'bomb-test'}});
    if(String(url).endsWith('/member'))return Response.json({nick:`user${id}`});
    return Response.json({id,username:`user${id}`});
  };
  const {server,shutdown}=await import('../src/index.js');const sockets:WebSocket[]=[];
  try{
    if(!server.listening)await once(server,'listening');const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;
    const definition={game:'bomb_battle',roomId:'10:1:bomb-network',matchId:'bomb-match',guildId:'10',hostId:'1',p2Id:'2',mode:'PVP',seats:[1,2,3,4].map(i=>({userId:String(i),name:`user${i}`}))};
    const headers={'content-type':'application/json',Authorization:'Bearer '+process.env.ACTIVITY_INTERNAL_SECRET};
    const create=()=>realFetch(base+'/internal/game-sessions',{method:'POST',headers,body:JSON.stringify(definition)});
    assert.equal((await create()).status,201);assert.equal((await create()).status,200);
    async function until(predicate:()=>boolean,ms=2500){const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw Error('Protocol timeout');await new Promise(r=>setTimeout(r,10));}}
    async function connect(id:string){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);sockets.push(ws);const messages:any[]=[];ws.on('message',data=>messages.push(JSON.parse(String(data))));await once(ws,'open');ws.send(JSON.stringify({type:'AUTH',token:id,roomId:definition.roomId}));await until(()=>messages.some(m=>m.type==='BOMB_STATE'));return{ws,messages,state:()=>messages.filter(m=>m.type==='BOMB_STATE').at(-1)};}
    const players=[];for(let i=1;i<=4;i++)players.push(await connect(String(i)));const observer=await connect('99');
    await until(()=>players.every(p=>p.state().started));assert.equal(observer.state().seat,-1);assert.equal(observer.state().spectators.length,1);
    await until(()=>players[0].state().state.phase==='playing',4000);assert.ok(players[0].state().state.tick>=180);
    observer.ws.send(JSON.stringify({type:'INPUT',matchId:'bomb-match',seq:1,input:{direction:2,bomb:true}}));
    const host=players[0];host.ws.send(JSON.stringify({type:'INPUT',matchId:'bomb-match',seq:1,input:{direction:0,bomb:true}}));
    await until(()=>host.state().ack===1);assert.equal(host.state().state.bombs.length,1);
    const before=host.state().state.tick;host.ws.close();await once(host.ws,'close');const reconnected=await connect('1');assert.equal(reconnected.state().seq,1);assert.ok(reconnected.state().state.tick>=before);
    reconnected.ws.send(JSON.stringify({type:'INPUT',matchId:'bomb-match',seq:1,input:{direction:0,bomb:true}}));
    for(const player of players.slice(1))player.ws.send(JSON.stringify({type:'INPUT',matchId:'bomb-match',seq:1,input:{direction:0,bomb:true}}));
    await until(()=>observer.state().state.phase==='finished');assert.equal(observer.state().state.winner,null);assert.equal(observer.state().state.players.filter((p:any)=>p.alive).length,0);
    await until(()=>results.length>0,6000);assert.equal(results[0].winnerSide,'draw');assert.deepEqual(results[0].seatScores,[0,0,0,0]);
    await until(()=>observer.messages.some(m=>m.type==='FINISHED'));
    assert.equal((await realFetch(base+'/internal/game-sessions',{method:'DELETE',headers,body:JSON.stringify({roomId:definition.roomId})})).status,200);
    await until(()=>observer.messages.some(m=>m.type==='ROOM_CLOSED'));
  }finally{for(const ws of sockets)ws.terminate();shutdown();globalThis.fetch=realFetch;}
});
