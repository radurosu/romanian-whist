#!/usr/bin/env node
// test_optimize.mjs — Self-optimizing AI parameter tuner
// Runs batches of games, tunes bias per style for bottom 3 players each batch.
// Usage: node test_optimize.mjs [--batch 500] [--batches 20]

// ─── Config ───
const argv = process.argv.slice(2);
let BATCH_SIZE = 500;
let NUM_BATCHES = 20;
let NUM_PLAYERS = 4;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--batch')   BATCH_SIZE  = parseInt(argv[++i]);
  if (argv[i] === '--batches') NUM_BATCHES = parseInt(argv[++i]);
  if (argv[i] === '--players') NUM_PLAYERS = parseInt(argv[++i]);
}

// ─── Tunable params — per player, not per style ───
// Lower sims for speed — 10k games gives enough statistical volume
const SIMS = {
  void:      { bidSims: 12, playSims: 8 },
  tempo:     { bidSims: 10, playSims: 6 },
  sniper:    { bidSims: 12, playSims: 8 },
  precision: { bidSims: 12, playSims: 8 },
};

const PLAYERS = {
  'Viktor': { style: 'void',      noise: 0.12, bias: 0.35 },
  'Sasha':  { style: 'tempo',     noise: 0.15, bias: 0.15 },
  'Sniper': { style: 'sniper',    noise: 0.12, bias: 0.30 },
  'Katya':  { style: 'precision', noise: 0.10, bias: 0.40 },
  'Tempo2': { style: 'tempo',     noise: 0.18, bias: 0.15 },
};
const ALL_PLAYERS = ['Viktor', 'Sasha', 'Sniper', 'Katya', 'Tempo2'];
// TEAM is randomized per game — defined in playGame()

// ─── Constants ───
const ALL_RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const SUITS = ['spades','hearts','diamonds','clubs'];
const RANK_VALUE = {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};

// ─── Utilities ───
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cardKey(c) { return c.rank + c.suit; }
function pickLowest(cards) { return cards.reduce((b,c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b); }
function pickHighest(cards) { return cards.reduce((b,c) => RANK_VALUE[c.rank] > RANK_VALUE[b.rank] ? c : b); }

function computeRoundSequence(n) {
  const max = 8, seq = [];
  for (let i = 0; i < n; i++) seq.push(1);
  for (let c = 2; c < max; c++) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(max);
  for (let c = max-1; c >= 2; c--) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(1);
  return seq;
}

function buildDeck(n) {
  const ranks = ALL_RANKS.slice(0, n * 2);
  const deck = [];
  for (const suit of SUITS) for (const rank of ranks) deck.push({rank, suit});
  return shuffle(deck);
}

function cardBeats(c, best, ledSuit, trump) {
  if (c.suit === best.suit) return RANK_VALUE[c.rank] > RANK_VALUE[best.rank];
  if (trump && c.suit === trump && best.suit !== trump) return true;
  return false;
}

function getLegalMoves(hand, ledSuit, trump) {
  if (!ledSuit) return hand.slice();
  const follow = hand.filter(c => c.suit === ledSuit);
  if (follow.length > 0) return follow;
  if (trump) { const t = hand.filter(c => c.suit === trump); if (t.length > 0) return t; }
  return hand.slice();
}

function getCardsStillOut(G, hand) {
  const known = new Set([...hand, ...G.playedCards, ...(G.trumpCard ? [G.trumpCard] : [])].map(cardKey));
  return G.fullDeck.filter(c => !known.has(cardKey(c)));
}

// ─── PIMC Engine ───
function simPlayOut(hands, bids, tricksWon, trump, leader, n) {
  const h = hands.map(h => h.slice());
  const tw = tricksWon.slice();
  let ld = leader;
  for (let t = 0; t < h[0].length; t++) {
    if (h[ld].length === 0) break;
    const trick = [];
    let cur = ld;
    for (let p = 0; p < n; p++) {
      if (h[cur].length === 0) { cur = (cur+1)%n; continue; }
      const ls = trick.length > 0 ? trick[0].card.suit : null;
      let legal = h[cur];
      if (ls) {
        const f = legal.filter(c => c.suit === ls);
        if (f.length > 0) legal = f;
        else if (trump) { const t2 = legal.filter(c => c.suit === trump); if (t2.length > 0) legal = t2; }
      }
      const need = tw[cur] < (bids[cur] || 0);
      let card;
      if (need) {
        if (trick.length > 0) {
          const ls2 = trick[0].card.suit;
          const curBest = trick.reduce((b,t) => cardBeats(t.card, b.card, ls2, trump) ? t : b);
          const winners = legal.filter(c => cardBeats(c, curBest.card, ls2, trump));
          card = winners.length > 0 ? pickLowest(winners) : pickLowest(legal);
        } else { card = pickHighest(legal); }
      } else { card = pickLowest(legal); }
      h[cur] = h[cur].filter(c => !(c.rank === card.rank && c.suit === card.suit));
      trick.push({player: cur, card});
      cur = (cur+1)%n;
    }
    if (trick.length === 0) break;
    const ls = trick[0].card.suit;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) if (cardBeats(trick[i].card, best.card, ls, trump)) best = trick[i];
    tw[best.player]++;
    ld = best.player;
  }
  return tw;
}

function sampleOpponentHands(G, myHand, pi) {
  const unknown = getCardsStillOut(G, myHand);
  const shuffled = unknown.slice().sort(() => Math.random() - 0.5);
  const oppList = [];
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === pi) continue;
    oppList.push({idx: i, need: G.hands[i].length, hand: []});
  }
  let ci = 0;
  const maxN = Math.max(...oppList.map(o => o.need));
  for (let r = 0; r < maxN; r++) {
    for (const opp of oppList) {
      if (opp.hand.length >= opp.need || ci >= shuffled.length) continue;
      if (G.knownVoids[opp.idx]?.[shuffled[ci].suit]) {
        for (let j = ci+1; j < shuffled.length; j++) {
          if (!G.knownVoids[opp.idx]?.[shuffled[j].suit]) { [shuffled[ci], shuffled[j]] = [shuffled[j], shuffled[ci]]; break; }
        }
      }
      opp.hand.push(shuffled[ci++]);
    }
  }
  const result = {};
  for (const opp of oppList) result[opp.idx] = opp.hand;
  return result;
}

function pimcBid(G, pi, numSims) {
  const hand = G.hands[pi];
  const cpp = G.cardsPerPlayer;
  const scores = new Array(cpp+1).fill(0);
  for (let sim = 0; sim < numSims; sim++) {
    const opp = sampleOpponentHands(G, hand, pi);
    const allH = Array.from({length: G.numPlayers}, (_,i) => i === pi ? hand.slice() : (opp[i]||[]));
    for (let bid = 0; bid <= cpp; bid++) {
      const bids = G.bids.map((b,i) => b !== null ? b : Math.round(allH[i].length / G.numPlayers));
      bids[pi] = bid;
      const tw = new Array(G.numPlayers).fill(0);
      const res = simPlayOut(allH.map(h=>h.slice()), bids, tw, G.trumpSuit, (G.dealerIndex+1)%G.numPlayers, G.numPlayers);
      scores[bid] += res[pi] === bid ? 5 + bid : -Math.abs(res[pi] - bid);
    }
  }
  let best = 0;
  for (let b = 1; b <= cpp; b++) if (scores[b] > scores[best]) best = b;
  return best;
}

function pimcChooseCard(G, pi, legalMoves, numSims) {
  if (legalMoves.length === 1) return legalMoves[0];
  const hand = G.hands[pi];
  const scores = {};
  for (const c of legalMoves) scores[cardKey(c)] = 0;
  for (let sim = 0; sim < numSims; sim++) {
    const opp = sampleOpponentHands(G, hand, pi);
    for (const card of legalMoves) {
      const allH = Array.from({length: G.numPlayers}, (_,i) =>
        i === pi ? hand.filter(c => !(c.rank===card.rank && c.suit===card.suit)) : (opp[i]||[]));
      const tw = G.tricksWon.slice();
      const trickSoFar = [...G.currentTrick, {playerIndex: pi, card}];
      let leader = G.trickLeaderIndex;
      if (trickSoFar.length === G.numPlayers) {
        const ls = trickSoFar[0].card.suit;
        let b = trickSoFar[0];
        for (let i = 1; i < trickSoFar.length; i++) if (cardBeats(trickSoFar[i].card, b.card, ls, G.trumpSuit)) b = trickSoFar[i];
        tw[b.playerIndex]++; leader = b.playerIndex;
      } else {
        let cur = (pi+1)%G.numPlayers, ct = trickSoFar.slice();
        for (let p = ct.length; p < G.numPlayers; p++) {
          if (!allH[cur]?.length) { cur=(cur+1)%G.numPlayers; continue; }
          const ls = ct[0].card.suit;
          let legal = allH[cur];
          const f = legal.filter(c => c.suit === ls); if (f.length) legal = f;
          else if (G.trumpSuit) { const t2 = legal.filter(c => c.suit===G.trumpSuit); if (t2.length) legal=t2; }
          const pick = tw[cur] < (G.bids[cur]||0) ? pickHighest(legal) : pickLowest(legal);
          allH[cur] = allH[cur].filter(c => !(c.rank===pick.rank && c.suit===pick.suit));
          ct.push({playerIndex: cur, card: pick}); cur=(cur+1)%G.numPlayers;
        }
        const ls = ct[0].card.suit;
        let b = ct[0];
        for (let i = 1; i < ct.length; i++) if (cardBeats(ct[i].card, b.card, ls, G.trumpSuit)) b = ct[i];
        tw[b.playerIndex]++; leader = b.playerIndex;
      }
      const res = simPlayOut(allH, G.bids, tw, G.trumpSuit, leader, G.numPlayers);
      scores[cardKey(card)] += res[pi]===G.bids[pi] ? 5+G.bids[pi] : -Math.abs(res[pi]-G.bids[pi]);
    }
  }
  let bestCard = legalMoves[0], bestScore = -Infinity;
  for (const c of legalMoves) if (scores[cardKey(c)] > bestScore) { bestScore = scores[cardKey(c)]; bestCard = c; }
  return bestCard;
}

function compute1CardWinProb(card, n, trump) {
  const val = RANK_VALUE[card.rank];
  const rps = n * 2;
  const used = ALL_RANKS.slice(0, rps);
  const higher = used.filter(r => RANK_VALUE[r] > val).length;
  const higherTrumps = (trump && card.suit !== trump) ? rps : 0;
  const total = rps * 4 - 1;
  const dangerous = higher + higherTrumps;
  return Math.pow(Math.max(0, total - dangerous) / total, n - 1);
}

function constrainBid(G, bid, est, cpp) {
  if (G.bids.filter(b => b !== null).length < G.numPlayers - 1) return bid;
  const sum = G.bids.reduce((a,b) => a + (b??0), 0);
  if (sum + bid === cpp) {
    const lo = bid-1, hi = bid+1;
    if (lo >= 0 && hi <= cpp) bid = Math.abs(est-lo) < Math.abs(est-hi) ? lo : hi;
    else if (lo >= 0) bid = lo;
    else bid = hi;
    bid = Math.max(0, Math.min(cpp, bid));
  }
  return bid;
}

function bidAwarenessAdj(G, est) {
  const cpp = G.cardsPerPlayer;
  const others = G.bids.filter(b => b !== null);
  if (others.length === 0) return est;
  const avgOther = others.reduce((a,b)=>a+b,0) / others.length;
  const fair = cpp / G.numPlayers;
  if (avgOther > fair * 1.2) est -= 0.3 + (avgOther - fair * 1.2) * 0.2;
  else if (avgOther < fair * 0.8) est += 0.2 + (fair * 0.8 - avgOther) * 0.15;
  return est;
}

function computeAIBid(G, pi) {
  const name = G.playerNames[pi];
  const player = PLAYERS[name];
  const style = player.style;
  const cpp = G.cardsPerPlayer;

  if (cpp === 1) {
    let est = compute1CardWinProb(G.hands[pi][0], G.numPlayers, G.trumpSuit);
    est += (Math.random()-0.5) * player.noise;
    return constrainBid(G, Math.max(0, Math.min(1, Math.round(est))), est, cpp);
  }

  let bid = pimcBid(G, pi, SIMS[style].bidSims) + player.bias * Math.min(1, cpp / 4);
  bid = bidAwarenessAdj(G, bid);
  bid = Math.max(0, Math.min(cpp, Math.round(bid)));
  return constrainBid(G, bid, bid, cpp);
}

function chooseAICard(G, pi, legal) {
  if (legal.length === 1) return legal[0];
  const style = PLAYERS[G.playerNames[pi]].style;
  return pimcChooseCard(G, pi, legal, SIMS[style].playSims);
}

// ─── Single game ───
function playGame() {
  // Pick random game size (3, 4, or 5) and random players
  const numP = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
  const names = shuffle(ALL_PLAYERS).slice(0, numP);
  const roundSeq = computeRoundSequence(numP);
  const scores = new Array(numP).fill(0);
  const stats = names.map(() => ({exact:0, over:0, under:0, total:0}));
  let dealer = 0;

  for (let ri = 0; ri < roundSeq.length; ri++) {
    const cpp = roundSeq[ri];
    const bids = new Array(numP).fill(null);
    const tricksWon = new Array(numP).fill(0);
    const deck = buildDeck(numP);
    const hands = Array.from({length: numP}, () => []);
    for (let i = 0; i < cpp; i++) for (let p = 0; p < numP; p++) hands[p].push(deck[i*numP+p]);
    const totalDealt = cpp * numP;
    const trumpCard = totalDealt < deck.length ? deck[totalDealt] : null;
    const trumpSuit = trumpCard?.suit || null;
    const knownVoids = Array.from({length: numP}, () => ({}));
    const playedCards = [];

    const G = {
      numPlayers: numP, playerNames: names, cardsPerPlayer: cpp,
      bids, tricksWon, hands, trumpCard, trumpSuit,
      fullDeck: deck.slice(), knownVoids, playedCards,
      dealerIndex: dealer, currentTrick: [], trickLeaderIndex: (dealer+1)%numP,
      currentRoundIndex: ri,
    };

    // Bidding
    let bidder = (dealer+1) % numP;
    for (let i = 0; i < numP; i++) {
      bids[bidder] = computeAIBid(G, bidder);
      bidder = (bidder+1) % numP;
    }

    // Playing tricks
    let leader = (dealer+1) % numP;
    for (let trick = 0; trick < cpp; trick++) {
      G.currentTrick = [];
      G.trickLeaderIndex = leader;
      let cur = leader;
      for (let p = 0; p < numP; p++) {
        const pi = (cur + p) % numP;
        const ls = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
        const legal = getLegalMoves(hands[pi], ls, trumpSuit);
        const card = chooseAICard(G, pi, legal);
        G.currentTrick.push({playerIndex: pi, card});
        hands[pi] = hands[pi].filter(c => !(c.rank===card.rank && c.suit===card.suit));
        playedCards.push(card);
        if (ls && card.suit !== ls) knownVoids[pi][ls] = true;
      }
      // Resolve trick
      const ls = G.currentTrick[0].card.suit;
      let best = G.currentTrick[0];
      for (let i = 1; i < G.currentTrick.length; i++)
        if (cardBeats(G.currentTrick[i].card, best.card, ls, trumpSuit)) best = G.currentTrick[i];
      tricksWon[best.playerIndex]++;
      leader = best.playerIndex;
    }

    // Score
    for (let p = 0; p < numP; p++) {
      const b = bids[p], w = tricksWon[p];
      const pts = b === w ? 5 + b : -Math.abs(b - w);
      scores[p] += pts;
      stats[p].total++;
      if (w === b) stats[p].exact++;
      else if (w > b) stats[p].over++;
      else stats[p].under++;
    }

    dealer = (dealer+1) % numP;
  }

  return { names, scores, stats };
}

// ─── Run batch ───
function runBatch(n) {
  // Track per named player across all games they appear in
  const playerStats = {};
  for (const name of ALL_PLAYERS) playerStats[name] = {score:0, exact:0, over:0, under:0, total:0, wins:0, games:0};

  for (let g = 0; g < n; g++) {
    const {names, scores, stats} = playGame();
    const maxScore = Math.max(...scores);
    names.forEach((name, i) => {
      playerStats[name].score  += scores[i];
      playerStats[name].exact  += stats[i].exact;
      playerStats[name].over   += stats[i].over;
      playerStats[name].under  += stats[i].under;
      playerStats[name].total  += stats[i].total;
      playerStats[name].wins   += scores[i] === maxScore ? 1 : 0;
      playerStats[name].games  += 1;
    });
  }

  return playerStats;
}

// ─── Tuning step — adjust ALL players toward balanced over/under ───
function tuneBiases(playerStats, batchNum) {
  const lr = Math.max(0.015, 0.07 * Math.pow(0.88, batchNum)); // decaying LR
  const ranked = ALL_PLAYERS
    .map(name => ({ name, style: PLAYERS[name].style, ...playerStats[name] }))
    .sort((a, b) => (b.score/b.games) - (a.score/a.games));

  for (const name of ALL_PLAYERS) {
    const s = playerStats[name];
    if (s.total === 0) continue;
    // calibration > 0 = overbidding → reduce bias; < 0 = underbidding → increase bias
    const calibration = (s.over - s.under) / s.total;
    PLAYERS[name].bias -= calibration * lr;
    PLAYERS[name].bias = Math.max(0, Math.min(2.0, PLAYERS[name].bias));
  }

  return ranked;
}

// ─── Main ───
const TOTAL = BATCH_SIZE * NUM_BATCHES;
console.log(`\nOptimizer: random 4-of-5 lineups, ${BATCH_SIZE} games/batch × ${NUM_BATCHES} batches = ${TOTAL.toLocaleString()} games`);
console.log(`Players: ${ALL_PLAYERS.join(', ')}\n`);
console.log(`${'Batch'.padEnd(6)} ${'Player'.padEnd(8)} ${'AvgScore'.padStart(8)} ${'Acc%'.padStart(6)} ${'Over'.padStart(5)} ${'Under'.padStart(6)} ${'Bias'.padStart(6)}`);
console.log('─'.repeat(55));

const startTime = Date.now();

for (let b = 0; b < NUM_BATCHES; b++) {
  const playerStats = runBatch(BATCH_SIZE);
  const ranked = tuneBiases(playerStats, b);

  for (const p of ranked) {
    const avgScore = (p.score / p.games).toFixed(1);
    const acc = ((p.exact / p.total) * 100).toFixed(1);
    const bias = PLAYERS[p.name].bias.toFixed(3);
    const marker = ranked[0].name === p.name ? ' ★' : '  ';
    console.log(`B${String(b+1).padStart(2)}   ${p.name.padEnd(8)} ${String(avgScore).padStart(8)} ${String(acc).padStart(5)}% ${String(p.over).padStart(5)} ${String(p.under).padStart(6)} ${bias.padStart(6)}${marker}`);
  }
  const elapsed = ((Date.now() - startTime)/1000).toFixed(0);
  console.log(`      [batch ${b+1}/${NUM_BATCHES} done — ${elapsed}s elapsed]\n`);
}

const totalElapsed = ((Date.now() - startTime)/1000).toFixed(1);
console.log('\n═══ Final tuned parameters ═══');
for (const name of ALL_PLAYERS) {
  const p = PLAYERS[name];
  const s = SIMS[p.style];
  console.log(`  ${name.padEnd(8)} (${p.style.padEnd(10)}) bias=${p.bias.toFixed(4)}  bidSims=${s.bidSims}  playSims=${s.playSims}`);
}
console.log(`\nTotal time: ${totalElapsed}s for ${TOTAL.toLocaleString()} games`);
