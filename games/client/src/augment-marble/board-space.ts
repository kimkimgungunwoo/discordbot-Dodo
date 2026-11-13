export interface MotionRect {x:number;y:number;w:number;h:number}
/** Store motion in SVG units; resolve the current board position on every frame. */
export function boardSpace(root:HTMLElement){
 const bounds=()=>root.querySelector<SVGSVGElement>('.m-board-svg')!.getBoundingClientRect();
 return {
  local(r:DOMRect):MotionRect{const b=bounds(),s=b.width/908;return{x:(r.x-b.x)/s,y:(r.y-b.y)/s,w:r.width/s,h:r.height/s}},
  viewport(r:MotionRect):MotionRect{const b=bounds(),s=b.width/908;return{x:b.x+r.x*s,y:b.y+r.y*s,w:r.w*s,h:r.h*s}}
 };
}
