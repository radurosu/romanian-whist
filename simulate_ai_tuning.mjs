#!/usr/bin/env node

const ALL_RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const SUITS = ['spades','hearts','diamonds','clubs'];
const RANK_VALUE = {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};

const BUILTIN_PERSONALITIES = {
  Nigel:    { bidBias: -0.30, noise: 0.15, style: 'conservative' },
  Margaret: { bidBias:  0.00, noise: 0.08, style: 'analyst' },
  Clive:    { bidBias:  0.40, noise: 0.25, style: 'gambler' },
  Rupert:   { bidBias:  0.00, noise: 0.20, style: 'spoiler' },
  Beatrice: { bidBias: -0.10, noise: 0.18, style: 'opportunist' },
};

const EXPERIMENTAL_PERSONALITIES = {
  Ada:      { bidBias: -0.05, noise: 0.05, style: 'analyst' },
  Victor:   { bidBias:  0.15, noise: 0.10, style: 'opportunist' },
  Elena:    { bidBias: -0.15, noise: 0.12, style: 'spoiler' },
};

const BASE_WEIGHTS = {
  trump: { A: 0.92, K: 0.75, Q: 0.45, J: 0.30, mid: 0.15, low: 0.05, long: 0.05 },
  nonTrump: {
    aceWithTrump: 0.70,
    aceNoTrump: 0.85,
    kingBase: 0.35,
    kingWithAce: 0.12,
    kingShort: 0.05,
    queenBase: 0.15,
    queenProtected: 0.08,
    queenLoose: -0.05,
    jack: 0.05,
  },
  shape: { voidBonus: 0.25, singletonBonus: 0.10 },
  noTrumpMultiplier: 1.15,
  reliabilityFloor: 0.50,
  reliabilitySlope: 0.12,
  competitionSlope: 0.08,
  oneCard: {
    scaleFloor: 0.65,
    scaleSlope: 0.10,
    trumpA: 0.97,
    trumpK: 0.88,
    trumpQ: 0.74,
    trumpJ: 0.60,
    trumpMid: 0.48,
    trumpLow: 0.32,
    noTrumpA: 0.94,
    noTrumpK: 0.64,
    noTrumpQ: 0.38,
    noTrumpJ: 0.19,
    noTrumpLow: 0.07,
    offTrumpA: 0.62,
    offTrumpK: 0.30,
    offTrumpQ: 0.14,
    offTrumpLow: 0.05,
  },
  play: {
    sureWinnerTrumpRisk: 0.56,
    highPlayerDuckThreshold: 5,
    speculativeAceOnlyPlayers: 5,
    blockWhenExact: true,
    analystBlock: false,
    opportunistMode: false,
  },
};

const VARIANTS = {
  baseline: BASE_WEIGHTS,
  measuredRisk: mergeWeights(BASE_WEIGHTS, {
    nonTrump: { aceWithTrump: 0.62, kingBase: 0.30, queenBase: 0.12, queenProtected: 0.06 },
    shape: { voidBonus: 0.20, singletonBonus: 0.08 },
    competitionSlope: 0.07,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.68 },
  }),
  trumpShape: mergeWeights(BASE_WEIGHTS, {
    trump: { K: 0.78, Q: 0.50, J: 0.34, mid: 0.18, long: 0.08 },
    shape: { voidBonus: 0.30, singletonBonus: 0.13 },
    nonTrump: { aceWithTrump: 0.64 },
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.64 },
  }),
  cautiousBid: mergeWeights(BASE_WEIGHTS, {
    nonTrump: { aceWithTrump: 0.58, aceNoTrump: 0.82, kingBase: 0.27, queenBase: 0.10, jack: 0.03 },
    shape: { voidBonus: 0.18, singletonBonus: 0.06 },
    competitionSlope: 0.09,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.72 },
  }),
  flatterCompetition: mergeWeights(BASE_WEIGHTS, {
    competitionSlope: 0.055,
    reliabilitySlope: 0.10,
    shape: { voidBonus: 0.22 },
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.64 },
  }),
  strongerNoTrump: mergeWeights(BASE_WEIGHTS, {
    noTrumpMultiplier: 1.24,
    nonTrump: { aceNoTrump: 0.90, kingBase: 0.38, queenBase: 0.17 },
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.64 },
  }),
  tunedA: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.94, K: 0.79, Q: 0.52, J: 0.34, mid: 0.17, low: 0.04, long: 0.07 },
    nonTrump: {
      aceWithTrump: 0.61,
      aceNoTrump: 0.88,
      kingBase: 0.31,
      kingWithAce: 0.10,
      kingShort: 0.03,
      queenBase: 0.11,
      queenProtected: 0.06,
      jack: 0.03,
    },
    shape: { voidBonus: 0.22, singletonBonus: 0.08 },
    noTrumpMultiplier: 1.20,
    reliabilityFloor: 0.52,
    reliabilitySlope: 0.10,
    competitionSlope: 0.065,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.66 },
  }),
  tunedB: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.95, K: 0.80, Q: 0.54, J: 0.36, mid: 0.18, low: 0.04, long: 0.06 },
    nonTrump: {
      aceWithTrump: 0.57,
      aceNoTrump: 0.89,
      kingBase: 0.28,
      kingWithAce: 0.10,
      kingShort: 0.03,
      queenBase: 0.10,
      queenProtected: 0.06,
      queenLoose: -0.06,
      jack: 0.03,
    },
    shape: { voidBonus: 0.20, singletonBonus: 0.07 },
    noTrumpMultiplier: 1.22,
    reliabilityFloor: 0.54,
    reliabilitySlope: 0.09,
    competitionSlope: 0.06,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.70 },
  }),
  // ─── Round 2 tuning: explore around tunedB ───
  tunedC: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.94, K: 0.78, Q: 0.50, J: 0.33, mid: 0.16, low: 0.03, long: 0.05 },
    nonTrump: {
      aceWithTrump: 0.54, aceNoTrump: 0.87, kingBase: 0.26, kingWithAce: 0.09,
      kingShort: 0.02, queenBase: 0.09, queenProtected: 0.05, queenLoose: -0.07, jack: 0.02,
    },
    shape: { voidBonus: 0.22, singletonBonus: 0.08 },
    noTrumpMultiplier: 1.20, reliabilityFloor: 0.56, reliabilitySlope: 0.08,
    competitionSlope: 0.07,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.68 },
  }),
  tunedD: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.96, K: 0.82, Q: 0.52, J: 0.34, mid: 0.17, low: 0.04, long: 0.06 },
    nonTrump: {
      aceWithTrump: 0.55, aceNoTrump: 0.90, kingBase: 0.30, kingWithAce: 0.11,
      kingShort: 0.03, queenBase: 0.11, queenProtected: 0.07, queenLoose: -0.05, jack: 0.03,
    },
    shape: { voidBonus: 0.18, singletonBonus: 0.06 },
    noTrumpMultiplier: 1.24, reliabilityFloor: 0.52, reliabilitySlope: 0.10,
    competitionSlope: 0.065,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.72 },
  }),
  tunedE: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.95, K: 0.79, Q: 0.51, J: 0.34, mid: 0.16, low: 0.03, long: 0.05 },
    nonTrump: {
      aceWithTrump: 0.53, aceNoTrump: 0.88, kingBase: 0.27, kingWithAce: 0.10,
      kingShort: 0.02, queenBase: 0.08, queenProtected: 0.05, queenLoose: -0.08, jack: 0.02,
    },
    shape: { voidBonus: 0.24, singletonBonus: 0.09 },
    noTrumpMultiplier: 1.18, reliabilityFloor: 0.55, reliabilitySlope: 0.085,
    competitionSlope: 0.075,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.66 },
  }),
  tunedF: mergeWeights(BASE_WEIGHTS, {
    trump: { A: 0.95, K: 0.80, Q: 0.53, J: 0.35, mid: 0.17, low: 0.04, long: 0.06 },
    nonTrump: {
      aceWithTrump: 0.56, aceNoTrump: 0.88, kingBase: 0.27, kingWithAce: 0.10,
      kingShort: 0.03, queenBase: 0.09, queenProtected: 0.06, queenLoose: -0.07, jack: 0.02,
    },
    shape: { voidBonus: 0.21, singletonBonus: 0.07 },
    noTrumpMultiplier: 1.21, reliabilityFloor: 0.55, reliabilitySlope: 0.09,
    competitionSlope: 0.065,
    play: { analystBlock: true, opportunistMode: true, sureWinnerTrumpRisk: 0.69 },
  }),
};

function mergeWeights(base, patch) {
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = {...out[key], ...value};
    } else {
      out[key] = value;
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = {games: 300, seed: 12345, players: [3,4,5,6], experimental: false, variants: Object.keys(VARIANTS)};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--games') args.games = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--players') args.players = argv[++i].split(',').map(Number);
    else if (arg === '--experimental') args.experimental = true;
    else if (arg === '--variants') args.variants = argv[++i].split(',');
    else if (arg === '--help') {
      console.log('Usage: node simulate_ai_tuning.mjs [--games 300] [--seed 12345] [--players 3,4,5,6] [--experimental] [--variants baseline,tunedA]');
      process.exit(0);
    }
  }
  return args;
}

function rngFromSeed(seed) {
  let x = seed >>> 0;
  return function rng() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickPlayerNames(numPlayers, experimental = false) {
  if (experimental && numPlayers === 6) return ['Ada','Nigel','Victor','Margaret','Elena','Clive'];
  if (numPlayers === 5) return ['Nigel','Margaret','Rupert','Clive','Beatrice'];
  if (numPlayers === 6) return ['Nigel','Beatrice','Margaret','Rupert','Clive','Margaret'];
  if (numPlayers === 4) return ['Nigel','Margaret','Rupert','Clive'];
  return ['Nigel','Margaret','Clive'];
}

function getPersonality(name, experimental = false) {
  return {...BUILTIN_PERSONALITIES, ...(experimental ? EXPERIMENTAL_PERSONALITIES : {})}[name] || BUILTIN_PERSONALITIES.Margaret;
}

function computeRoundSequence(n) {
  const max = 8;
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(1);
  for (let c = 2; c < max; c++) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(max);
  for (let c = max - 1; c >= 2; c--) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(1);
  return seq;
}

function buildDeck(numPlayers, rng) {
  const ranks = ALL_RANKS.slice(0, numPlayers * 2);
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of ranks) deck.push({rank, suit});
  }
  return shuffle(deck, rng);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardKey(card) {
  return card.rank + card.suit;
}

function getCardsStillOut(G, hand) {
  const known = new Set();
  for (const c of hand) known.add(cardKey(c));
  for (const c of G.playedCards) known.add(cardKey(c));
  if (G.trumpCard) known.add(cardKey(G.trumpCard));
  return G.fullDeck.filter(c => !known.has(cardKey(c)));
}

function isHighestRemaining(G, card, hand) {
  const out = getCardsStillOut(G, hand);
  return !out.some(c => c.suit === card.suit && RANK_VALUE[c.rank] > RANK_VALUE[card.rank]);
}

function suitVoidRisk(G, suit, hand) {
  const out = getCardsStillOut(G, hand);
  const cardsStillOutInSuit = out.filter(c => c.suit === suit).length;
  const unknownCards = out.length || 1;
  const playersLeft = Math.max(0, G.numPlayers - 1 - G.currentTrick.length);
  const missingShare = 1 - cardsStillOutInSuit / unknownCards;
  return 1 - Math.pow(1 - missingShare, playersLeft);
}

function isLikelyWinner(G, card, hand, weights) {
  if (!isHighestRemaining(G, card, hand)) return false;
  if (!G.trumpSuit || card.suit === G.trumpSuit) return true;
  if (G.currentTrick.length === G.numPlayers - 1) return true;
  return suitVoidRisk(G, card.suit, hand) < weights.play.sureWinnerTrumpRisk;
}

function compute1CardWinProb(card, numPlayers, trumpSuit, weights) {
  const val = RANK_VALUE[card.rank];
  const isTrump = trumpSuit && card.suit === trumpSuit;
  const w = weights.oneCard;
  const scale = Math.max(w.scaleFloor, 1.0 - (numPlayers - 3) * w.scaleSlope);

  if (isTrump) {
    if (val === 14) return w.trumpA;
    if (val === 13) return w.trumpK * scale;
    if (val === 12) return w.trumpQ * scale;
    if (val === 11) return w.trumpJ * scale;
    if (val >= 9) return w.trumpMid * scale;
    return w.trumpLow * scale;
  }
  if (!trumpSuit) {
    if (val === 14) return w.noTrumpA * scale;
    if (val === 13) return w.noTrumpK * scale;
    if (val === 12) return w.noTrumpQ * scale;
    if (val === 11) return w.noTrumpJ * scale;
    return w.noTrumpLow * scale;
  }
  if (val === 14) return w.offTrumpA * scale;
  if (val === 13) return w.offTrumpK * scale;
  if (val === 12) return w.offTrumpQ * scale;
  return w.offTrumpLow * scale;
}

function isLastBidder(G) {
  return G.bids.filter(b => b !== null).length === G.numPlayers - 1;
}

function computeAIBid(G, playerIndex, weights, rng, experimental) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const personality = getPersonality(G.playerNames[playerIndex], experimental);
  let estimate = 0;

  if (cpp === 1) {
    const pWin = compute1CardWinProb(hand[0], G.numPlayers, G.trumpSuit, weights);
    const noise = (rng() - 0.5) * personality.noise * 0.5;
    let bid = Math.round(Math.max(0, Math.min(1, pWin + noise)));
    if (isLastBidder(G)) {
      const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
      if (sum + bid === cpp) bid = bid > 0 ? 0 : 1;
    }
    return bid;
  }

  const suitCounts = {};
  const suitCards = {};
  for (const s of SUITS) { suitCounts[s] = 0; suitCards[s] = []; }
  for (const c of hand) { suitCounts[c.suit]++; suitCards[c.suit].push(c); }
  for (const s of SUITS) suitCards[s].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);

  const reliability = Math.max(weights.reliabilityFloor, 1.0 - (G.numPlayers - 3) * weights.reliabilitySlope);

  for (const suit of SUITS) {
    const cards = suitCards[suit];
    if (cards.length === 0) continue;
    const isTrump = G.trumpSuit && suit === G.trumpSuit;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const val = RANK_VALUE[card.rank];

      if (isTrump) {
        if (val === 14) estimate += weights.trump.A;
        else if (val === 13) estimate += weights.trump.K;
        else if (val === 12) estimate += weights.trump.Q;
        else if (val === 11) estimate += weights.trump.J;
        else if (val >= 9) estimate += weights.trump.mid;
        else estimate += weights.trump.low;
        if (cards.length > 2 && i >= 2) estimate += weights.trump.long;
      } else {
        const hasAce = cards.some(c => c.rank === 'A');
        const hasKing = cards.some(c => c.rank === 'K');

        if (val === 14) {
          estimate += (G.trumpSuit ? weights.nonTrump.aceWithTrump : weights.nonTrump.aceNoTrump) * reliability;
        } else if (val === 13) {
          const boost = hasAce ? weights.nonTrump.kingWithAce : (cards.length <= 2 ? weights.nonTrump.kingShort : 0);
          estimate += (weights.nonTrump.kingBase + boost) * reliability;
        } else if (val === 12) {
          const boost = (hasAce || hasKing) ? weights.nonTrump.queenProtected : weights.nonTrump.queenLoose;
          estimate += Math.max(0, weights.nonTrump.queenBase + boost) * reliability;
        } else if (val === 11) {
          estimate += weights.nonTrump.jack * reliability;
        }
      }
    }
  }

  if (G.trumpSuit && suitCounts[G.trumpSuit] > 0) {
    const trumpCount = suitCounts[G.trumpSuit];
    for (const s of SUITS) {
      if (s === G.trumpSuit) continue;
      if (suitCounts[s] === 0) estimate += weights.shape.voidBonus * Math.min(trumpCount, 2);
      else if (suitCounts[s] === 1 && cpp >= 3) estimate += weights.shape.singletonBonus * Math.min(trumpCount, 1);
    }
  }

  if (!G.trumpSuit) estimate *= weights.noTrumpMultiplier;

  estimate += personality.bidBias;

  if (personality.style === 'spoiler') {
    const otherBids = G.bids.filter(b => b !== null);
    if (otherBids.length > 0) {
      const avgOtherBid = otherBids.reduce((a, b) => a + b, 0) / otherBids.length;
      const fairShare = cpp / G.numPlayers;
      if (avgOtherBid > fairShare) estimate -= 0.4;
      else estimate += 0.3;
    }
  }
  if (personality.style === 'opportunist') {
    const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
    const remaining = G.numPlayers - G.bids.filter(b => b !== null).length;
    const expectedTable = cpp * 0.92;
    if (remaining > 0 && sum > expectedTable) estimate -= 0.20;
    else if (remaining > 0 && sum < expectedTable * 0.65) estimate += 0.15;
  }

  const bidPosition = G.bids.filter(b => b !== null).length;
  const positionNoise = bidPosition === 0 ? 0.35 : bidPosition <= 1 ? 0.25 : 0.15;
  const noise = (rng() - 0.5) * Math.min(positionNoise, personality.noise * 2) * (cpp <= 2 ? 1.5 : 1.0);
  estimate += noise;

  estimate *= 1.0 - (G.numPlayers - 2) * weights.competitionSlope;

  let bid = Math.round(estimate);
  bid = Math.max(0, Math.min(bid, cpp));

  if (isLastBidder(G)) {
    const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
    if (sum + bid === cpp) {
      const lower = bid - 1;
      const upper = bid + 1;
      if (lower >= 0 && upper <= cpp) bid = Math.abs(estimate - lower) < Math.abs(estimate - upper) ? lower : upper;
      else if (lower >= 0) bid = lower;
      else bid = upper;
      bid = Math.max(0, Math.min(cpp, bid));
    }
  }
  return bid;
}

function getLegalMoves(hand, ledSuit, trumpSuit) {
  if (!ledSuit) return hand.slice();
  const follow = hand.filter(c => c.suit === ledSuit);
  if (follow.length > 0) return follow;
  if (trumpSuit) {
    const trumps = hand.filter(c => c.suit === trumpSuit);
    if (trumps.length > 0) return trumps;
  }
  return hand.slice();
}

function cardBeats(G, card, current, ledSuit) {
  if (card.suit === G.trumpSuit && current.suit !== G.trumpSuit) return true;
  if (card.suit === G.trumpSuit && current.suit === G.trumpSuit) return RANK_VALUE[card.rank] > RANK_VALUE[current.rank];
  if (card.suit === ledSuit && current.suit === ledSuit) return RANK_VALUE[card.rank] > RANK_VALUE[current.rank];
  if (card.suit !== G.trumpSuit && current.suit === G.trumpSuit) return false;
  return false;
}

function currentWinner(G) {
  const ledSuit = G.currentTrick[0].card.suit;
  let winner = G.currentTrick[0];
  for (let i = 1; i < G.currentTrick.length; i++) {
    if (cardBeats(G, G.currentTrick[i].card, winner.card, ledSuit)) winner = G.currentTrick[i];
  }
  return winner;
}

function pickHighest(cards) {
  return cards.reduce((best, c) => RANK_VALUE[c.rank] > RANK_VALUE[best.rank] ? c : best);
}

function pickLowest(cards) {
  return cards.reduce((best, c) => RANK_VALUE[c.rank] < RANK_VALUE[best.rank] ? c : best);
}

function opponentCloseToBid(G, playerIndex) {
  return G.bids.some((b, i) => i !== playerIndex && b !== null && b > 0 && G.tricksWon[i] === b - 1);
}

function chooseAICard(G, playerIndex, legalMoves, ledSuit, weights, experimental) {
  if (legalMoves.length === 1) return legalMoves[0];

  const personality = getPersonality(G.playerNames[playerIndex], experimental);
  const bid = G.bids[playerIndex];
  const won = G.tricksWon[playerIndex];
  const needMore = won < bid;
  const hasExact = won === bid;
  const stillNeeded = bid - won;
  const hand = G.hands[playerIndex];
  const shouldBlock = personality.style === 'spoiler'
    ? G.bids.some((b, i) => i !== playerIndex && b !== null && G.tricksWon[i] >= b - 1 && b > 0)
    : (hasExact || (weights.play.analystBlock && personality.style === 'analyst')) && opponentCloseToBid(G, playerIndex);

  if (G.currentTrick.length === 0) {
    if (needMore) {
      const trumpCards = G.trumpSuit ? legalMoves.filter(c => c.suit === G.trumpSuit) : [];
      const nonTrump = legalMoves.filter(c => c.suit !== G.trumpSuit);
      const likelyWinners = legalMoves.filter(c => isLikelyWinner(G, c, hand, weights));

      if (personality.style === 'conservative') {
        if (likelyWinners.length > 0) {
          const ntWinners = likelyWinners.filter(c => c.suit !== G.trumpSuit);
          return ntWinners.length > 0 ? ntWinners[0] : likelyWinners[0];
        }
        return pickLowest(nonTrump.length > 0 ? nonTrump : legalMoves);
      }

      if (personality.style === 'gambler') {
        if (trumpCards.length > 0 && stillNeeded >= 1 && (G.numPlayers <= 4 || trumpCards.length >= 2)) return pickHighest(trumpCards);
        return pickHighest(legalMoves);
      }

      if (personality.style === 'opportunist' && weights.play.opportunistMode) {
        if (likelyWinners.length > 0 && stillNeeded <= likelyWinners.length) return pickLowest(likelyWinners);
        if (trumpCards.length >= 2 && stillNeeded >= 2) return pickHighest(trumpCards);
      }

      if (likelyWinners.length > 0) {
        const bySuitLen = likelyWinners.sort((a, b) => {
          const aLen = hand.filter(h => h.suit === a.suit).length;
          const bLen = hand.filter(h => h.suit === b.suit).length;
          return aLen - bLen;
        });
        const ntWinners = bySuitLen.filter(c => c.suit !== G.trumpSuit);
        if (ntWinners.length > 0) return ntWinners[0];
        return bySuitLen[0];
      }

      if (trumpCards.length >= 2 && stillNeeded >= 2) return pickHighest(trumpCards);

      for (const s of SUITS) {
        if (s === G.trumpSuit) continue;
        const sCards = nonTrump.filter(c => c.suit === s).sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
        if (sCards.length >= 2 && sCards[0].rank === 'A') return sCards[0];
      }

      if (nonTrump.length > 0) {
        if (G.numPlayers >= weights.play.speculativeAceOnlyPlayers) {
          const aces = nonTrump.filter(c => c.rank === 'A');
          if (aces.length > 0) return aces[0];
          return pickLowest(nonTrump);
        }
        return pickHighest(nonTrump);
      }
      return pickHighest(legalMoves);
    }

    if (personality.style === 'spoiler' && shouldBlock) {
      const suitPlayCount = {};
      for (const s of SUITS) suitPlayCount[s] = G.playedCards.filter(c => c.suit === s).length;
      const nonTrump = legalMoves.filter(c => c.suit !== G.trumpSuit);
      if (nonTrump.length > 0) {
        nonTrump.sort((a, b) => suitPlayCount[b.suit] - suitPlayCount[a.suit]);
        return pickLowest(nonTrump.filter(c => c.suit === nonTrump[0].suit));
      }
    }

    const nonTrump = legalMoves.filter(c => c.suit !== G.trumpSuit);
    if (nonTrump.length > 0) {
      const suitLen = {};
      for (const c of nonTrump) suitLen[c.suit] = (suitLen[c.suit] || 0) + 1;
      let longestSuit = null, maxLen = 0;
      for (const [s, len] of Object.entries(suitLen)) {
        if (len > maxLen) { maxLen = len; longestSuit = s; }
      }
      return pickLowest(nonTrump.filter(c => c.suit === longestSuit));
    }
    return pickLowest(legalMoves);
  }

  const winEntry = currentWinner(G);
  const winCard = winEntry.card;
  const beaters = legalMoves.filter(c => cardBeats(G, c, winCard, ledSuit));
  const losers = legalMoves.filter(c => !cardBeats(G, c, winCard, ledSuit));
  const isLast = G.currentTrick.length === G.numPlayers - 1;
  const playersLeft = G.numPlayers - 1 - G.currentTrick.length;

  if (shouldBlock && losers.length > 0 && winEntry.playerIndex !== playerIndex) {
    const winnerBid = G.bids[winEntry.playerIndex];
    if (winnerBid > 0 && G.tricksWon[winEntry.playerIndex] === winnerBid - 1) {
      if (beaters.length > 0) return pickLowest(beaters);
    }
  }

  if (needMore) {
    if (beaters.length > 0) {
      if (isLast) return pickLowest(beaters);

      if (personality.style === 'conservative') {
        const sureBeaters = beaters.filter(c => isLikelyWinner(G, c, hand, weights));
        if (sureBeaters.length > 0) return pickLowest(sureBeaters);
        return pickLowest(beaters);
      }

      if (personality.style === 'gambler') return pickHighest(beaters);

      if (personality.style === 'opportunist' && weights.play.opportunistMode) {
        const likely = beaters.filter(c => isLikelyWinner(G, c, hand, weights));
        if (likely.length > 0) return pickLowest(likely);
        if (playersLeft >= 2) return pickLowest(losers.length > 0 ? losers : legalMoves);
      }

      if (playersLeft <= 1) {
        const cheapest = pickLowest(beaters);
        if (isLikelyWinner(G, cheapest, hand, weights)) return cheapest;
        const sorted = beaters.sort((a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);
        return sorted[Math.min(1, sorted.length - 1)];
      }
      const likelyBeaters = beaters.filter(c => isLikelyWinner(G, c, hand, weights));
      if (likelyBeaters.length > 0) return pickLowest(likelyBeaters);
      if (G.numPlayers >= weights.play.highPlayerDuckThreshold && playersLeft >= 2) {
        const ntLosers = legalMoves.filter(c => c.suit !== G.trumpSuit);
        return pickLowest(ntLosers.length > 0 ? ntLosers : legalMoves);
      }
      return pickHighest(beaters);
    }
    const ntLosers = legalMoves.filter(c => c.suit !== G.trumpSuit);
    if (ntLosers.length > 0) return pickLowest(ntLosers);
    return pickLowest(legalMoves);
  }

  if (hasExact) {
    if (losers.length > 0) return pickHighest(losers);
    return pickLowest(legalMoves);
  }

  if (losers.length > 0) return pickLowest(losers);
  return pickLowest(legalMoves);
}

function playOneGame(numPlayers, weights, seed, experimental) {
  const rng = rngFromSeed(seed);
  const names = pickPlayerNames(numPlayers, experimental);
  const G = {
    numPlayers,
    playerNames: names,
    roundSequence: computeRoundSequence(numPlayers),
    dealerIndex: 0,
    scores: new Array(numPlayers).fill(0),
  };
  const metrics = names.map(name => ({name, bids: 0, exact: 0, absError: 0, over: 0, under: 0, score: 0}));

  for (let roundIndex = 0; roundIndex < G.roundSequence.length; roundIndex++) {
    G.currentRoundIndex = roundIndex;
    G.cardsPerPlayer = G.roundSequence[roundIndex];
    G.bids = new Array(numPlayers).fill(null);
    G.currentTrick = [];
    G.tricksWon = new Array(numPlayers).fill(0);
    G.trickLeaderIndex = (G.dealerIndex + 1) % numPlayers;
    G.playedCards = [];

    const deck = buildDeck(numPlayers, rng);
    G.fullDeck = deck.slice();
    G.hands = Array.from({length: numPlayers}, () => []);
    for (let i = 0; i < G.cardsPerPlayer; i++) {
      for (let p = 0; p < numPlayers; p++) G.hands[p].push(deck[i * numPlayers + p]);
    }
    const totalDealt = G.cardsPerPlayer * numPlayers;
    const deckSize = numPlayers * 8;
    if (totalDealt < deckSize) {
      G.trumpCard = deck[totalDealt];
      G.trumpSuit = G.trumpCard.suit;
    } else {
      G.trumpCard = null;
      G.trumpSuit = null;
    }

    let bidder = (G.dealerIndex + 1) % numPlayers;
    for (let k = 0; k < numPlayers; k++) {
      G.bids[bidder] = computeAIBid(G, bidder, weights, rng, experimental);
      bidder = (bidder + 1) % numPlayers;
    }

    for (let trick = 0; trick < G.cardsPerPlayer; trick++) {
      G.currentTrick = [];
      let player = G.trickLeaderIndex;
      for (let k = 0; k < numPlayers; k++) {
        const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
        const legal = getLegalMoves(G.hands[player], ledSuit, G.trumpSuit);
        const card = chooseAICard(G, player, legal, ledSuit, weights, experimental);
        const idx = G.hands[player].findIndex(c => c.rank === card.rank && c.suit === card.suit);
        G.hands[player].splice(idx, 1);
        G.currentTrick.push({playerIndex: player, card});
        G.playedCards.push(card);
        player = (player + 1) % numPlayers;
      }
      const winner = currentWinner(G);
      G.tricksWon[winner.playerIndex]++;
      G.trickLeaderIndex = winner.playerIndex;
    }

    for (let p = 0; p < numPlayers; p++) {
      const bid = G.bids[p];
      const won = G.tricksWon[p];
      const err = won - bid;
      const roundScore = won === bid ? 5 + bid : -Math.abs(err);
      G.scores[p] += roundScore;
      metrics[p].bids++;
      metrics[p].exact += won === bid ? 1 : 0;
      metrics[p].absError += Math.abs(err);
      metrics[p].over += err > 0 ? 1 : 0;
      metrics[p].under += err < 0 ? 1 : 0;
      metrics[p].score += roundScore;
    }
    G.dealerIndex = (G.dealerIndex + 1) % numPlayers;
  }
  return metrics;
}

function emptyAggregate() {
  return {score: 0, bids: 0, exact: 0, absError: 0, over: 0, under: 0, byName: new Map()};
}

function addMetrics(agg, metrics) {
  for (const m of metrics) {
    agg.score += m.score;
    agg.bids += m.bids;
    agg.exact += m.exact;
    agg.absError += m.absError;
    agg.over += m.over;
    agg.under += m.under;
    const byName = agg.byName.get(m.name) || {score: 0, bids: 0, exact: 0, absError: 0};
    byName.score += m.score;
    byName.bids += m.bids;
    byName.exact += m.exact;
    byName.absError += m.absError;
    agg.byName.set(m.name, byName);
  }
}

function scoreAggregate(agg) {
  const avgScore = agg.score / agg.bids;
  const exactRate = agg.exact / agg.bids;
  const mae = agg.absError / agg.bids;
  return avgScore + exactRate * 3 - mae * 1.25;
}

function runVariant(name, weights, args) {
  const agg = emptyAggregate();
  const byPlayers = new Map();
  for (const numPlayers of args.players) {
    const pAgg = emptyAggregate();
    for (let game = 0; game < args.games; game++) {
      const seed = args.seed + game * 7919 + numPlayers * 104729;
      const metrics = playOneGame(numPlayers, weights, seed, args.experimental);
      addMetrics(agg, metrics);
      addMetrics(pAgg, metrics);
    }
    byPlayers.set(numPlayers, pAgg);
  }
  return {name, agg, byPlayers, objective: scoreAggregate(agg)};
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtAgg(agg) {
  const roundsPerPlayer = agg.bids;
  return {
    avgScorePerRound: agg.score / roundsPerPlayer,
    exactRate: agg.exact / roundsPerPlayer,
    bidMAE: agg.absError / roundsPerPlayer,
    overRate: agg.over / roundsPerPlayer,
    underRate: agg.under / roundsPerPlayer,
  };
}

function printResult(result, args) {
  const m = fmtAgg(result.agg);
  console.log(`${result.name.padEnd(18)} objective=${result.objective.toFixed(4)} score/r=${m.avgScorePerRound.toFixed(3)} exact=${pct(m.exactRate)} mae=${m.bidMAE.toFixed(3)} over=${pct(m.overRate)} under=${pct(m.underRate)}`);
  for (const [numPlayers, agg] of result.byPlayers.entries()) {
    const p = fmtAgg(agg);
    console.log(`  ${numPlayers}p score/r=${p.avgScorePerRound.toFixed(3)} exact=${pct(p.exactRate)} mae=${p.bidMAE.toFixed(3)} over=${pct(p.overRate)} under=${pct(p.underRate)}`);
  }
  if (args.experimental) {
    const rows = [...result.agg.byName.entries()].map(([name, a]) => {
      const v = fmtAgg(a);
      return `${name}:${v.avgScorePerRound.toFixed(2)}/${pct(v.exactRate)}`;
    });
    console.log(`  players ${rows.join('  ')}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`Simulating ${args.games} games per player count, seed=${args.seed}, players=${args.players.join(',')}, experimental=${args.experimental}`);
  const results = [];
  for (const variantName of args.variants) {
    const weights = VARIANTS[variantName];
    if (!weights) {
      console.error(`Unknown variant: ${variantName}`);
      process.exitCode = 2;
      return;
    }
    results.push(runVariant(variantName, weights, args));
  }
  results.sort((a, b) => b.objective - a.objective);
  for (const result of results) printResult(result, args);
  const best = results[0];
  console.log(`\nBest variant: ${best.name}`);
  console.log(JSON.stringify(VARIANTS[best.name], null, 2));
}

main();
