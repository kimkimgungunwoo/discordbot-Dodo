import { COLORS, COUNTDOWN_TICKS, FUSE_TICKS, GHOST_TICKS, HEIGHT, WIDTH, cell, ghost, type State } from '../../../shared/bomb-battle';
import { dodoProfile, dodoSprite } from '../common/sprites';
const TILE = 48, MARGIN = 24;
const profiles = COLORS.map(dodoProfile);
const running = COLORS.map(color => [dodoSprite(color, "run", 0), dodoSprite(color, "run", 1)]);
const stunned = COLORS.map(color => dodoSprite(color, "lose"));
const INK = '#303b36';
export function draw(ctx: CanvasRenderingContext2D, s: State, own: number, started: boolean, fraction = 0, positions?: { x: number; y: number }[]) {
  ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#f1eedf'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save(); ctx.translate(MARGIN, MARGIN);
  const rect = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const px = x * TILE, py = y * TILE, wall = s.board[cell(x, y)];
    rect(['#e9e9d7', '#e2e5d0', '#e6e7d4', '#dce2cb'][s.tiles?.[cell(x,y)] ?? (x+y)%2], px, py, TILE, TILE);
    rect('#d6dcc4', px, py + TILE - 1, TILE, 1);
    if (wall === 1 && !s.rocks?.some(r => x>=r.x && x<r.x+r.size && y>=r.y && y<r.y+r.size)) {
      rect('#667361', px + 1, py + 5, TILE - 2, TILE - 5); rect(INK, px + 1, py + 1, TILE - 2, TILE - 7);
      rect('#a4ad94', px + 3, py + 3, TILE - 6, TILE - 12); rect('#bbc2ab', px + 5, py + 5, TILE - 10, 4);
      rect('#85927b', px + 3, py + 22, TILE - 6, 2); rect('#85927b', px + 23, py + 3, 2, 19); rect('#85927b', px + 13, py + 24, 2, 13);
    } else if (wall === 2) {
      rect('#303b3630', px + 5, py + 9, 39, 37); rect('#73583e', px + 4, py + 3, 40, 39);
      rect('#ba9060', px + 7, py + 6, 34, 32); rect('#d5b382', px + 9, py + 8, 30, 4);
      rect('#967047', px + 9, py + 22, 30, 2); rect('#73583e', px + 10, py + 7, 3, 30); rect('#73583e', px + 34, py + 7, 3, 30);
      for (let i = 0; i < 6; i++) rect('#d5b382', px + 14 + i * 3, py + 13 + i * 3, 5, 5);
    }
  }
  for (const rock of s.rocks ?? []) {
    if (s.board[cell(rock.x, rock.y)] !== 1) continue;
    const x=rock.x*TILE, y=rock.y*TILE, size=rock.size*TILE;
    rect('#303b3628',x+5,y+9,size-8,size-10);
    rect(INK,x+3,y+12,size-6,size-17); rect(INK,x+10,y+3,size-20,size-6);
    rect('#89967f',x+6,y+14,size-12,size-22); rect('#a4ad94',x+12,y+6,size-24,size-15);
    rect('#c2c8b2',x+14,y+8,size-30,5); rect('#6c7b64',x+size-18,y+18,8,size-27);
    rect('#78866e',x+size*.4,y+size*.45,size*.3,3);
  }
  for (const item of s.items) {
    const x = item.at % WIDTH * TILE, y = Math.floor(item.at / WIDTH) * TILE;
    const bob = Math.sin((s.tick + fraction) / 12 + item.at) * 2;
    rect('#303b3620', x + 13, y + 37, 23, 4);
    rect(INK, x + 11, y + 10 + bob, 27, 26); rect(item.kind === 'bomb' ? '#e2c68c' : '#edb38c', x + 13, y + 12 + bob, 23, 22);
    if (item.kind === 'bomb') { rect(INK, x + 18, y + 18 + bob, 13, 13); rect('#f9f5e6', x + 20, y + 20 + bob, 3, 3); rect('#8c7349', x + 26, y + 14 + bob, 3, 5); }
    else { rect('#b65c36', x + 20, y + 17 + bob, 10, 14); rect('#b65c36', x + 23, y + 14 + bob, 5, 6); rect('#ffe4a1', x + 23, y + 22 + bob, 5, 8); }
    ctx.fillStyle = INK; ctx.font = 'bold 12px monospace'; ctx.fillText('+', x + 30, y + 33 + bob);
  }
  for (const b of s.bombs) {
    const x = b.x * TILE, y = b.y * TILE, life = Math.max(0, b.explodesAt - s.tick), pulse = life < 24 && Math.floor(s.tick / 3) % 2;
    rect('#303b3625', x + 10, y + 38, 31, 6); rect(INK, x + 12, y + 15, 24, 24); rect(INK, x + 9, y + 21, 30, 13);
    rect(pulse ? '#a75b42' : '#59665d', x + 14, y + 17, 20, 19); rect('#c7ccba', x + 15, y + 18, 6, 5);
    rect(COLORS[b.owner], x + 14, y + 31, 20, 4); rect('#94734e', x + 27, y + 10, 4, 7); rect('#edbb62', x + 30, y + 7, 5, 5);
    rect('#303b3640', x + 10, y + 42, 28, 3); rect(COLORS[b.owner], x + 10, y + 42, Math.max(0, life / FUSE_TICKS) * 28, 3);
  }
  for (const f of s.flames) {
    const x = f.at % WIDTH * TILE, y = Math.floor(f.at / WIDTH) * TILE;
    rect('#d18152', x + 2, y + 7, 44, 34); rect('#d18152', x + 7, y + 2, 34, 44);
    rect('#efbe66', x + 5, y + 12, 38, 24); rect('#efbe66', x + 12, y + 5, 24, 38);
    rect('#fff0b4', x + 15, y + 10, 18, 28); rect('#fff0b4', x + 10, y + 17, 28, 14);
  }
  s.players.forEach((p, i) => {
    const amount = Math.hypot(p.x-p.fromX,p.y-p.fromY)>1e-6 ? 0 : 1;
    const position = positions?.[i];
    const x = (position?.x ?? p.x) * TILE + TILE / 2, y = (position?.y ?? p.y) * TILE + TILE / 2;
    const isGhost = ghost(s, p), elapsed = p.eliminatedAt === null ? 0 : s.tick - p.eliminatedAt;
    ctx.save(); ctx.translate(x, y);
    if (p.alive) { rect('#303b3620', -16, 13, 32, 6);  }
    if (isGhost) {
      ctx.globalAlpha = .45; ctx.translate(0, Math.sin(s.tick / 13 + i) * 3 - 6);

    } else if (!p.alive) ctx.rotate(Math.min(1, elapsed / 12) * Math.PI);
    else if (amount < 1) ctx.translate(0, Math.floor(s.tick / 3) % 2 ? -2 : 0);
    if (p.direction === 4) ctx.scale(-1, 1);
    ctx.drawImage(isGhost ? profiles[i] : !p.alive ? stunned[i] : amount < 1 ? running[i][Math.floor(s.tick / 3) % 2] : profiles[i], -20, -16, 40, 32); ctx.restore();
    if (!p.alive && !isGhost) {
      ctx.fillStyle = '#b58845'; ctx.font = 'bold 13px monospace';
      for (let star = 0; star < 3; star++) { const a = s.tick / 10 + star * Math.PI * 2 / 3; ctx.fillText('*', x + Math.cos(a) * 17 - 4, y - 18 + Math.sin(a) * 5); }
      ctx.fillStyle = INK; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${Math.ceil((GHOST_TICKS - elapsed) / 60)}초`, x, y + 31); ctx.textAlign = 'left';
    }
    if (i === own && (p.alive || isGhost)) {
      const top=y-38+Math.sin((s.tick+fraction)/10)*2;
      ctx.fillStyle=INK; ctx.beginPath(); ctx.moveTo(x-8,top); ctx.lineTo(x+8,top); ctx.lineTo(x,top+10); ctx.closePath(); ctx.fill();
      ctx.fillStyle=COLORS[i]; ctx.beginPath(); ctx.moveTo(x-5,top+2); ctx.lineTo(x+5,top+2); ctx.lineTo(x,top+8); ctx.closePath(); ctx.fill();
    }
    if (p.alive) { ctx.fillStyle = COLORS[i]; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${i + 1}P`, x, y - 22); ctx.textAlign = 'left'; }
  });
  if (!started || s.phase === 'countdown') {
    rect('#f3efdfaa', 0, 0, WIDTH * TILE, HEIGHT * TILE);
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.font = 'bold 50px monospace'; ctx.fillText(started ? String(Math.max(1, Math.ceil((COUNTDOWN_TICKS - s.tick) / 60))) : 'READY', WIDTH * TILE / 2, HEIGHT * TILE / 2);
    ctx.font = '14px sans-serif'; ctx.fillText(started ? '방향키로 이동 · Space로 폭탄 설치' : '참가자 접속을 기다리고 있어요', WIDTH * TILE / 2, HEIGHT * TILE / 2 + 34); ctx.textAlign = 'left';
  }
  ctx.restore();
}
export const CANVAS_WIDTH = WIDTH * TILE + MARGIN * 2, CANVAS_HEIGHT = HEIGHT * TILE + MARGIN * 2;
