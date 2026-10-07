import { chooseShot } from '../../../shared/alkkagi';
self.onmessage = event => {
  const shot = chooseShot(event.data.state,event.data.difficulty,Math.random,{onProgress:shot => self.postMessage({type:'progress',shot})});
  self.postMessage({type:'result',shot});
};
