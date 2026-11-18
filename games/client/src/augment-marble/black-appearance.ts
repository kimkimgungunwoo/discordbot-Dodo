import { COLORS, type Game } from '../../../shared/augment-marble';

export const pendingPaceAppearances=new Set<number>();
export const pendingBlackAppearances=new Set<number>();
export function hasCopernicus(g:Game,seat:number){return !pendingBlackAppearances.has(seat)&&!!g.black?.acquisitionResolved&&!!g.augments?.players[seat]?.owned.includes('copernicus');}
/** Derive from the current owner every render, including purchase and takeover. */
export function ownershipColors(g:Game){return COLORS.map((color,seat)=>hasCopernicus(g,seat)?'#111617':color);}
export function invertBird(source:HTMLCanvasElement){
 const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
 const ctx=canvas.getContext('2d')!;ctx.drawImage(source,0,0);const image=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<image.data.length;i+=4){if(!image.data[i+3])continue;image.data[i]=255-image.data[i];image.data[i+1]=255-image.data[i+1];image.data[i+2]=255-image.data[i+2];}
 ctx.putImageData(image,0,0);return canvas;
}
