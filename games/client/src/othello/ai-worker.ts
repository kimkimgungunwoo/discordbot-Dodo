import { chooseMove, type BoardState, type Difficulty } from "../../../shared/othello";

self.onmessage = (event: MessageEvent<{ state: BoardState; difficulty: Difficulty }>) => {
  const move = chooseMove(event.data.state, event.data.difficulty, Math.random, {
    onProgress: move => self.postMessage({ type: "progress", move }),
  });
  self.postMessage({ type: "result", move });
};
