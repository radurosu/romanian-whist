// Replay the shared engine directly; no DOM shims or copied page source.
importScripts('game-engine.js');
self.onmessage = ({ data: { deals, seq, names, mode, runs } }) => {
  for (let k = 0; k < runs; k++) self.postMessage(replayDeals(deals, seq, names, mode));
};
