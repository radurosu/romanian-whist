#!/usr/bin/env node
// test_gemini.mjs — Run games with LLM AI vs algo players, report results
// Usage: node test_gemini.mjs --games 3

import { readFileSync } from 'fs';

// ─── Config ───
const argv = process.argv.slice(2);
let LLM_KEY = null;
let NUM_GAMES = 3;
let NUM_PLAYERS = 4;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--key') LLM_KEY = argv[++i];
  else if (argv[i] === '--games') NUM_GAMES = parseInt(argv[++i]);
  else if (argv[i] === '--players') NUM_PLAYERS = parseInt(argv[++i]);
}
// Auto-load from secretary
if (!LLM_KEY) {
  try {
    const env = readFileSync('../secretary/keys.env', 'utf8');
    const m = env.match(/GROK_API_KEY=(.+)/);
    if (m) LLM_KEY = m[1].trim();
  } catch(e) {}
}
if (!LLM_KEY) { console.error('No Grok key found. Add GROK_API_KEY to ../secretary/keys.env'); process.exit(1); }

const LLM_MODEL = 'grok-3-mini';
const LLM_BASE_URL = 'https://api.x.ai/v1/chat/completions';

// ─── Constants ───
const ALL_RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const SUITS = ['spades','hearts','diamonds','clubs'];
const RANK_VALUE = {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
const RANK_NAMES = {A:'Ace',K:'King',Q:'Queen',J:'Jack','10':'10','9':'9','8':'8','7':'7','6':'6','5':'5','4':'4','3':'3','2':'2'};
const SUIT_NAMES = {spades:'Spades',hearts:'Hearts',diamonds:'Diamonds',clubs:'Clubs'};

const PLAYERS = {
  'Viktor': { style: 'void',      noise: 0.12 },
  'Sasha':  { style: 'tempo',     noise: 0.15 },
  'Sniper': { style: 'sniper',    noise: 0.12 },
  'Katya':  { style: 'precision', noise: 0.10 },
  'Gemini': { style: 'gemini',    noise: 0 },
};

const TEAM = ['Gemini', 'Viktor', 'Sasha', 'Katya']; // Gemini always included

// ─── Rate limiting ───
let lastLLMCall = 0;
const LLM_INTERVAL = 1000; // 1s between calls — Grok is generous
const LLM_MAX_RETRIES = 3;

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
function cardToText(c) { return `${RANK_NAMES[c.rank]} of ${SUIT_NAMES[c.suit]}`; }
function pickLowest(cards) { return cards.reduce((b,c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b); }
function pickHighest(cards) { return cards.reduce((b,c) => RANK_VALUE[c.rank] > RANK_VALUE[b.rank] ? c : b); }

function suitCards(hand, suit) { return hand.filter(c => c.suit === suit).sort((a,b) => RANK_VALUE[b.rank]-RANK_VALUE[a.rank]); }
function suitLen(hand, suit) { return hand.filter(c => c.suit === suit).length; }
function shortestNonTrump(hand, trump) {
  let best = null, bestLen = 99;
  for (const s of SUITS) {
    if (s === trump) continue;
    const l = suitLen(hand, s);
    if (l > 0 && l < bestLen) { bestLen = l; best = s; }
  }
  return best;
}

function computeRoundSequence(n) {
  const max = 8, seq = [];
  for (let i = 0; i < n; i++) seq.push(1);
  for (let c = 2; c < max; c++) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(max);
  for (let c = max-1; c >= 2; c--) seq.push(c);
  for (let i = 0; i < n; i++) seq.push(1);
  return seq;
}

function buildDeck(numPlayers) {
  const ranks = ALL_RANKS.slice(0, numPlayers * 2);
  const deck = [];
  for (const suit of SUITS) for (const rank of ranks) deck.push({rank, suit});
  return shuffle(deck);
}

function cardBeats(c, best, ledSuit, trumpSuit) {
  if (c.suit === best.suit) return RANK_VALUE[c.rank] > RANK_VALUE[best.rank];
  if (trumpSuit && c.suit === trumpSuit && best.suit !== trumpSuit) return true;
  return false;
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

function getCardsStillOut(G, hand) {
  const known = new Set();
  for (const c of hand) known.add(cardKey(c));
  for (const c of G.playedCards) known.add(cardKey(c));
  if (G.trumpCard) known.add(cardKey(G.trumpCard));
  return G.fullDeck.filter(c => !known.has(cardKey(c)));
}

function isHighestRemaining(G, card, hand) {
  return !getCardsStillOut(G, hand).some(c => c.suit === card.suit && RANK_VALUE[c.rank] > RANK_VALUE[card.rank]);
}

// ─── PIMC Engine ───
function simPlayOut(hands, bids, tricksWon, trumpSuit, leader, numPlayers) {
  const h = hands.map(hand => hand.slice());
  const tw = tricksWon.slice();
  let ld = leader;
  for (let t = 0; t < h[0].length; t++) {
    if (h[ld].length === 0) break;
    const trick = [];
    let cur = ld;
    for (let p = 0; p < numPlayers; p++) {
      if (h[cur].length === 0) { cur = (cur+1)%numPlayers; continue; }
      const ledSuit = trick.length > 0 ? trick[0].card.suit : null;
      let legal = h[cur];
      if (ledSuit) {
        const follow = legal.filter(c => c.suit === ledSuit);
        if (follow.length > 0) legal = follow;
        else if (trumpSuit) {
          const trumps = legal.filter(c => c.suit === trumpSuit);
          if (trumps.length > 0) legal = trumps;
        }
      }
      const need = tw[cur] < (bids[cur] || 0);
      let card;
      if (need) {
        if (trick.length > 0) {
          const ls = trick[0].card.suit;
          const curBest = trick.reduce((b,t) => cardBeats(t.card, b.card, ls, trumpSuit) ? t : b);
          const winners = legal.filter(c => cardBeats(c, curBest.card, ls, trumpSuit));
          card = winners.length > 0 ? pickLowest(winners) : pickLowest(legal);
        } else {
          card = pickHighest(legal);
        }
      } else {
        card = pickLowest(legal);
      }
      h[cur] = h[cur].filter(c => !(c.rank === card.rank && c.suit === card.suit));
      trick.push({player: cur, card});
      cur = (cur+1)%numPlayers;
    }
    if (trick.length === 0) break;
    const ls = trick[0].card.suit;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) if (cardBeats(trick[i].card, best.card, ls, trumpSuit)) best = trick[i];
    tw[best.player]++;
    ld = best.player;
  }
  return tw;
}

function sampleOpponentHands(G, myHand, playerIndex) {
  const unknown = getCardsStillOut(G, myHand);
  const shuffled = unknown.slice().sort((a,b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank] + (Math.random()-0.5)*5);
  const oppList = [];
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === playerIndex) continue;
    oppList.push({idx: i, bid: G.bids[i]||0, need: G.hands[i].length, hand: []});
  }
  oppList.sort((a,b) => b.bid - a.bid);
  let ci = 0;
  const maxRounds = Math.max(...oppList.map(o=>o.need));
  for (let r = 0; r < maxRounds; r++) {
    for (const opp of oppList) {
      if (opp.hand.length >= opp.need) continue;
      if (ci >= shuffled.length) break;
      const card = shuffled[ci];
      if (G.knownVoids[opp.idx] && G.knownVoids[opp.idx][card.suit]) {
        for (let j = ci+1; j < shuffled.length; j++) {
          if (!G.knownVoids[opp.idx][shuffled[j].suit]) {
            [shuffled[ci], shuffled[j]] = [shuffled[j], shuffled[ci]]; break;
          }
        }
      }
      opp.hand.push(shuffled[ci++]);
    }
  }
  const result = {};
  for (const opp of oppList) result[opp.idx] = opp.hand;
  return result;
}

function pimcBid(G, playerIndex, numSims) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const scores = {};
  for (let b = 0; b <= cpp; b++) scores[b] = 0;
  for (let sim = 0; sim < numSims; sim++) {
    const oppHands = sampleOpponentHands(G, hand, playerIndex);
    const allHands = [];
    for (let i = 0; i < G.numPlayers; i++) allHands.push(i === playerIndex ? hand.slice() : (oppHands[i]||[]));
    for (let bid = 0; bid <= cpp; bid++) {
      const bids = G.bids.slice();
      bids[playerIndex] = bid;
      for (let i = 0; i < G.numPlayers; i++) if (bids[i] === null) bids[i] = Math.round(allHands[i].length / G.numPlayers);
      const tw = new Array(G.numPlayers).fill(0);
      const leader = (G.dealerIndex+1) % G.numPlayers;
      const result = simPlayOut(allHands.map(h=>h.slice()), bids, tw, G.trumpSuit, leader, G.numPlayers);
      const myTricks = result[playerIndex];
      scores[bid] += myTricks === bid ? 5 + bid : -Math.abs(myTricks - bid);
    }
  }
  let bestBid = 0, bestScore = -Infinity;
  for (let b = 0; b <= cpp; b++) if (scores[b] > bestScore) { bestScore = scores[b]; bestBid = b; }
  return bestBid;
}

function pimcChooseCard(G, playerIndex, legalMoves, numSims) {
  if (legalMoves.length === 1) return legalMoves[0];
  const hand = G.hands[playerIndex];
  const scores = {};
  for (const c of legalMoves) scores[cardKey(c)] = 0;
  for (let sim = 0; sim < numSims; sim++) {
    const oppHands = sampleOpponentHands(G, hand, playerIndex);
    for (const card of legalMoves) {
      const allHands = [];
      for (let i = 0; i < G.numPlayers; i++) {
        if (i === playerIndex) allHands.push(hand.filter(c => !(c.rank===card.rank && c.suit===card.suit)));
        else allHands.push(oppHands[i]||[]);
      }
      const tw = G.tricksWon.slice();
      const trickSoFar = G.currentTrick.slice();
      trickSoFar.push({playerIndex, card});
      let leader = G.trickLeaderIndex;
      if (trickSoFar.length === G.numPlayers) {
        const ls = trickSoFar[0].card.suit;
        let best = trickSoFar[0];
        for (let i = 1; i < trickSoFar.length; i++) if (cardBeats(trickSoFar[i].card, best.card, ls, G.trumpSuit)) best = trickSoFar[i];
        tw[best.playerIndex]++; leader = best.playerIndex;
        const result = simPlayOut(allHands, G.bids, tw, G.trumpSuit, leader, G.numPlayers);
        const myScore = result[playerIndex]===G.bids[playerIndex] ? 5+G.bids[playerIndex] : -Math.abs(result[playerIndex]-G.bids[playerIndex]);
        scores[cardKey(card)] += myScore;
      } else {
        // Complete trick with simple greedy
        let cur = (playerIndex+1) % G.numPlayers;
        let curTrick = trickSoFar.slice();
        for (let p = curTrick.length; p < G.numPlayers; p++) {
          if (!allHands[cur] || allHands[cur].length === 0) { cur=(cur+1)%G.numPlayers; continue; }
          const ls = curTrick[0].card.suit;
          let legal = allHands[cur];
          const follow = legal.filter(c => c.suit === ls);
          if (follow.length > 0) legal = follow;
          else if (G.trumpSuit) { const t = legal.filter(c => c.suit===G.trumpSuit); if (t.length>0) legal=t; }
          const needMore = tw[cur] < (G.bids[cur]||0);
          const pick = needMore ? pickHighest(legal) : pickLowest(legal);
          allHands[cur] = allHands[cur].filter(c => !(c.rank===pick.rank && c.suit===pick.suit));
          curTrick.push({playerIndex: cur, card: pick});
          cur = (cur+1)%G.numPlayers;
        }
        const ls = curTrick[0].card.suit;
        let best = curTrick[0];
        for (let i = 1; i < curTrick.length; i++) if (cardBeats(curTrick[i].card, best.card, ls, G.trumpSuit)) best = curTrick[i];
        tw[best.playerIndex]++; leader = best.playerIndex;
        const result = simPlayOut(allHands, G.bids, tw, G.trumpSuit, leader, G.numPlayers);
        const myScore = result[playerIndex]===G.bids[playerIndex] ? 5+G.bids[playerIndex] : -Math.abs(result[playerIndex]-G.bids[playerIndex]);
        scores[cardKey(card)] += myScore;
      }
    }
  }
  let bestCard = legalMoves[0], bestScore = -Infinity;
  for (const c of legalMoves) if (scores[cardKey(c)] > bestScore) { bestScore = scores[cardKey(c)]; bestCard = c; }
  return bestCard;
}

// ─── 1-card probability ───
function compute1CardWinProb(card, numPlayers, trumpSuit) {
  const val = RANK_VALUE[card.rank];
  const isTrump = trumpSuit && card.suit === trumpSuit;
  const ranksPerSuit = numPlayers * 2;
  const usedRanks = ALL_RANKS.slice(0, ranksPerSuit);
  const deckSize = ranksPerSuit * 4;
  const higherInSuit = usedRanks.filter(r => RANK_VALUE[r] > val).length;
  const numTrumps = trumpSuit ? ranksPerSuit : 0;
  const numHigherTrumps = (trumpSuit && !isTrump) ? numTrumps : 0;
  const total = deckSize - 1;
  const dangerous = higherInSuit + numHigherTrumps;
  const p = Math.pow(Math.max(0, total - dangerous) / total, numPlayers - 1);
  return p;
}

// ─── constrainBid ───
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

// ─── bidAwarenessAdj ───
function bidAwarenessAdj(G, est) {
  const cpp = G.cardsPerPlayer;
  const otherBids = G.bids.filter(b => b !== null);
  if (otherBids.length === 0) return est;
  const bidSum = otherBids.reduce((a,b)=>a+b,0);
  const fair = cpp / G.numPlayers;
  const avgOther = bidSum / otherBids.length;
  if (avgOther > fair * 1.2) est -= 0.3 + (avgOther - fair * 1.2) * 0.2;
  else if (avgOther < fair * 0.8) est += 0.2 + (fair * 0.8 - avgOther) * 0.15;
  return est;
}

// ─── AI Bidding ───
function computeAIBid(G, playerIndex) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const name = G.playerNames[playerIndex];
  const player = PLAYERS[name] || PLAYERS['Katya'];
  const style = player.style;
  const comp = Math.max(0.6, 1.0 - (G.numPlayers - 2) * 0.08);
  let estimate = 0;

  if (cpp === 1) {
    estimate = compute1CardWinProb(hand[0], G.numPlayers, G.trumpSuit);
    estimate += (Math.random()-0.5) * player.noise;
    return constrainBid(G, Math.max(0, Math.min(1, Math.round(estimate))), estimate, cpp);
  }

  const sims = style === 'tempo' ? 50 : 80;
  const biasMap = {void: 0.35, tempo: 0.15, sniper: 0.3, precision: 0.4};
  const bias = biasMap[style] || 0;
  let bid = pimcBid(G, playerIndex, sims) + bias * Math.min(1, cpp / 4);
  bid = bidAwarenessAdj(G, bid);
  bid = Math.max(0, Math.min(cpp, Math.round(bid)));
  return constrainBid(G, bid, bid, cpp);
}

// ─── AI Card Play ───
function chooseAICard(G, playerIndex, legalMoves, ledSuit) {
  if (legalMoves.length === 1) return legalMoves[0];
  const name = G.playerNames[playerIndex];
  const style = (PLAYERS[name]||{}).style || 'precision';
  const sims = style === 'void' ? 80 : style === 'tempo' ? 40 : 60;
  return pimcChooseCard(G, playerIndex, legalMoves, sims);
}

// ─── LLM API (Grok via OpenAI-compatible endpoint) ───
async function callLLMAPI(prompt, retryCount = 0) {
  const now = Date.now();
  const wait = LLM_INTERVAL - (now - lastLLMCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastLLMCall = Date.now();
  try {
    const res = await fetch(LLM_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
      })
    });
    const data = await res.json();
    if (data.error) {
      const msg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
      // Rate limit: check for retry-after
      const retryMatch = msg.match(/retry.{0,20}(\d+(?:\.\d+)?)\s*s/i);
      if ((res.status === 429 || retryMatch) && retryCount < LLM_MAX_RETRIES) {
        const waitSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 10;
        process.stdout.write(`\n  [Grok rate limit: waiting ${waitSec}s, retry ${retryCount+1}/${LLM_MAX_RETRIES}...] `);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        lastLLMCall = 0;
        return callLLMAPI(prompt, retryCount + 1);
      }
      console.warn('  Grok error (giving up):', msg.slice(0, 100));
      return null;
    }
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch(e) {
    console.warn('  Grok fetch error:', e.message);
    return null;
  }
}

function buildGeminiBidPrompt(G, playerIndex) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const trumpName = G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump';
  const trumpCardText = G.trumpCard
    ? `${RANK_NAMES[G.trumpCard.rank]} of ${trumpName} — REMOVED from play, your next-highest ${trumpName} is now top trump`
    : 'none';
  const bidderPos = G.bids.filter(b => b !== null).length + 1;
  const isLast = bidderPos === G.numPlayers;
  const alreadyBid = G.bids.map((b,i) => b !== null ? `  ${G.playerNames[i]}: bid ${b}` : null).filter(Boolean).join('\n') || '  (you bid first)';
  const forbidden = isLast ? cpp - G.bids.filter(b=>b!==null).reduce((a,b)=>a+b,0) : null;
  const forbidNote = isLast && forbidden >= 0 && forbidden <= cpp ? `\nYou CANNOT bid ${forbidden} (would make total = cards per player).` : '';

  return `Romanian Whist — Bidding Decision

RULES: Follow suit → must trump if can't follow → free only if neither.
Exact bid = 5 + bid pts. Miss = -|diff|. Bid 0 and make it = 5 pts.

Trump: ${trumpName} | Trump card: ${trumpCardText}
Cards this round: ${cpp} | Players: ${G.numPlayers}
You are bidder ${bidderPos} of ${G.numPlayers}${forbidNote}

Bids placed so far:
${alreadyBid}

Your hand: ${hand.map(cardToText).join(', ')}

Strategy:
- Aces win. Kings win when Ace is gone/out of play. Queens need A+K gone.
- Trump card is out of play — your next-highest trump is promoted to top.
- Void suits with trumps = ruffing tricks (~0.5 each). Singletons → voids after 1 trick.
- Long suits (5+ cards with top honors) can produce extra winners by running the suit.
- If others bid high, tricks are scarce — be conservative. If low, tricks available.
- Bidding later means more info — exploit gaps. Earlier means less info — lean conservative.

Respond with ONLY a single integer (your bid, 0–${cpp}). Nothing else.`;
}

function buildGeminiPlayPrompt(G, playerIndex, legalMoves, ledSuit) {
  const hand = G.hands[playerIndex];
  const bid = G.bids[playerIndex];
  const won = G.tricksWon[playerIndex];
  const need = bid - won;
  const trumpName = G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump';
  const trumpCardText = G.trumpCard ? `${RANK_NAMES[G.trumpCard.rank]} of ${trumpName} (out of play)` : 'none';
  const trickPos = G.currentTrick.length;
  const isLast = trickPos === G.numPlayers - 1;

  const trickText = G.currentTrick.length === 0
    ? '(you are leading)'
    : G.currentTrick.map(e => `  ${G.playerNames[e.playerIndex]}: ${cardToText(e.card)}`).join('\n');

  const status = G.playerNames.map((n,i) => {
    const b = G.bids[i]; if (b === null) return null;
    const w = G.tricksWon[i];
    const nd = b - w;
    const st = nd > 0 ? `needs ${nd} more` : nd === 0 ? 'DONE (avoids tricks)' : 'OVER bid';
    return `  ${n}: bid ${b}, won ${w} — ${st}`;
  }).filter(Boolean).join('\n');

  const played = G.playedCards.length > 0 ? G.playedCards.map(cardToText).join(', ') : 'none yet';
  const legalList = legalMoves.map((c,i) => `  ${i+1}. ${cardToText(c)}`).join('\n');
  const posLabel = ['leading','2nd','3rd','4th','5th','6th'][trickPos] || `${trickPos+1}th`;

  return `Romanian Whist — Card Play Decision

RULES: Follow suit → must trump if can't follow → free only if neither.
Trump: ${trumpName} | Trump card: ${trumpCardText}
Round ${G.currentRoundIndex+1}, ${G.cardsPerPlayer} cards

Player status:
${status}

You (${G.playerNames[playerIndex]}): bid ${bid}, won ${won} — ${need > 0 ? `need ${need} more` : need === 0 ? 'DONE, avoid winning' : 'over bid, minimize damage'}

Cards played this round: ${played}

Current trick (you are ${posLabel}${isLast ? ', LAST — perfect info' : ''}):
${trickText}${ledSuit ? `\n  Led suit: ${SUIT_NAMES[ledSuit]}` : ''}

Your legal moves:
${legalList}

Strategy:
- CONTROL: winning = you choose next suit (big advantage).
- CARD PROTECTION: don't play K when A is still out and someone ahead might hold it.
- FINESSING: holding A-Q, lead low toward Q — K to your left means Q wins.
- SUIT ESTABLISHMENT: run long suits, small cards become winners when opponents exhaust.
- DEFENSIVE: if DONE, play lowest cards — extra tricks cost points.
- COUNTING: check played cards — if A♠ gone, your K♠ is master now.
- LAST position: use cheapest winner or safest dump.
- DONE players dump low, not competing. Players needing tricks are threats.

Respond with ONLY the card as "RANK of SUIT" (e.g. "Ace of Spades"). Nothing else.`;
}

function parseGeminiCard(text, legalMoves) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const card of legalMoves) {
    const rname = RANK_NAMES[card.rank].toLowerCase();
    const sname = SUIT_NAMES[card.suit].toLowerCase();
    if (t.includes(rname) && (t.includes(sname) || t.includes(sname.slice(0,-1)))) return card;
  }
  for (const card of legalMoves) {
    const rname = RANK_NAMES[card.rank].toLowerCase();
    if (t.includes(rname)) {
      const matches = legalMoves.filter(c => RANK_NAMES[c.rank].toLowerCase() === rname);
      if (matches.length === 1) return matches[0];
    }
  }
  return null;
}

async function geminiComputeBid(G, playerIndex) {
  const cpp = G.cardsPerPlayer;
  if (cpp <= 2) {
    if (cpp === 1) {
      let est = compute1CardWinProb(G.hands[playerIndex][0], G.numPlayers, G.trumpSuit);
      return constrainBid(G, Math.max(0, Math.min(1, Math.round(est))), est, cpp);
    }
    const bid = pimcBid(G, playerIndex, 80);
    return constrainBid(G, bid, bid, cpp);
  }
  const prompt = buildGeminiBidPrompt(G, playerIndex);
  const response = await callLLMAPI(prompt);
  if (response) {
    const m = response.match(/\d+/);
    if (m) {
      const bid = parseInt(m[0]);
      if (bid >= 0 && bid <= cpp) {
        return constrainBid(G, bid, bid, cpp);
      }
    }
  }
  console.warn('  Grok bid fallback to PIMC');
  const bid = pimcBid(G, playerIndex, 80);
  return constrainBid(G, bid, bid, cpp);
}

async function geminiChooseCard(G, playerIndex, legalMoves, ledSuit) {
  if (legalMoves.length === 1) return legalMoves[0];
  if (G.cardsPerPlayer <= 2) return pimcChooseCard(G, playerIndex, legalMoves, 80);
  // Only call API when leading a trick — follow-suit decisions use PIMC
  if (ledSuit !== null) return pimcChooseCard(G, playerIndex, legalMoves, 80);
  const prompt = buildGeminiPlayPrompt(G, playerIndex, legalMoves, ledSuit);
  const response = await callLLMAPI(prompt);
  if (response) {
    const card = parseGeminiCard(response, legalMoves);
    if (card) return card;
    console.warn(`  Grok card parse failed: "${response}"`);
  }
  return pimcChooseCard(G, playerIndex, legalMoves, 80);
}

// ─── Game Runner ───
async function playOneGame(gameNum) {
  const names = TEAM.slice(0, NUM_PLAYERS);
  const roundSeq = computeRoundSequence(NUM_PLAYERS);
  const G = {
    numPlayers: NUM_PLAYERS,
    playerNames: names,
    roundSequence: roundSeq,
    dealerIndex: 0,
    scores: new Array(NUM_PLAYERS).fill(0),
    currentRoundIndex: 0,
    playedCards: [],
    knownVoids: {},
  };
  for (let i = 0; i < NUM_PLAYERS; i++) G.knownVoids[i] = {};

  const metrics = names.map(n => ({name: n, bids: 0, exact: 0, over: 0, under: 0}));
  let geminiApiCalls = 0, geminiFallbacks = 0;

  console.log(`\n═══ Game ${gameNum} — ${names.join(', ')} ═══`);

  for (let roundIndex = 0; roundIndex < roundSeq.length; roundIndex++) {
    G.currentRoundIndex = roundIndex;
    G.cardsPerPlayer = roundSeq[roundIndex];
    G.bids = new Array(NUM_PLAYERS).fill(null);
    G.biddingComplete = false;
    G.currentTrick = [];
    G.tricksWon = new Array(NUM_PLAYERS).fill(0);
    G.trickLeaderIndex = (G.dealerIndex + 1) % NUM_PLAYERS;
    G.playedCards = [];
    for (let i = 0; i < NUM_PLAYERS; i++) G.knownVoids[i] = {};

    const deck = buildDeck(NUM_PLAYERS);
    G.fullDeck = deck.slice();
    G.hands = Array.from({length: NUM_PLAYERS}, () => []);
    const cpp = G.cardsPerPlayer;
    for (let i = 0; i < cpp; i++) for (let p = 0; p < NUM_PLAYERS; p++) G.hands[p].push(deck[i*NUM_PLAYERS+p]);

    const totalDealt = cpp * NUM_PLAYERS;
    G.trumpCard = totalDealt < deck.length ? deck[totalDealt] : null;
    G.trumpSuit = G.trumpCard ? G.trumpCard.suit : null;

    // Bidding
    const bidOrder = [];
    let bidder = (G.dealerIndex + 1) % NUM_PLAYERS;
    for (let i = 0; i < NUM_PLAYERS; i++) { bidOrder.push(bidder); bidder = (bidder+1)%NUM_PLAYERS; }

    for (const p of bidOrder) {
      const name = names[p];
      let bid;
      if (name === 'Gemini') {
        const prevCalls = geminiApiCalls;
        bid = await geminiComputeBid(G, p);
        // track if API was used (cpp > 2 and no fallback warning logged)
        if (cpp > 2) geminiApiCalls++;
      } else {
        bid = computeAIBid(G, p);
      }
      G.bids[p] = bid;
    }

    // Playing
    G.trickLeaderIndex = (G.dealerIndex + 1) % NUM_PLAYERS;
    for (let trick = 0; trick < cpp; trick++) {
      G.currentTrick = [];
      const ledSuit = null;
      let cur = G.trickLeaderIndex;
      let actualLedSuit = null;

      for (let p = 0; p < NUM_PLAYERS; p++) {
        const pi = (cur + p) % NUM_PLAYERS;
        const ls = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
        if (p === 0) actualLedSuit = null;
        const legal = getLegalMoves(G.hands[pi], ls, G.trumpSuit);
        let card;
        const name = names[pi];
        if (name === 'Gemini') {
          card = await geminiChooseCard(G, pi, legal, ls);
          if (cpp > 2) geminiApiCalls++;
        } else {
          card = chooseAICard(G, pi, legal, ls);
        }
        G.hands[pi] = G.hands[pi].filter(c => !(c.rank===card.rank && c.suit===card.suit));
        G.currentTrick.push({playerIndex: pi, card});
        G.playedCards.push(card);

        // Void tracking
        if (ls && card.suit !== ls) G.knownVoids[pi][ls] = true;
      }

      // Resolve trick
      const ls2 = G.currentTrick[0].card.suit;
      let best = G.currentTrick[0];
      for (let i = 1; i < G.currentTrick.length; i++) {
        if (cardBeats(G.currentTrick[i].card, best.card, ls2, G.trumpSuit)) best = G.currentTrick[i];
      }
      G.tricksWon[best.playerIndex]++;
      G.trickLeaderIndex = best.playerIndex;
    }

    // Score round
    const roundScores = [];
    for (let p = 0; p < NUM_PLAYERS; p++) {
      const bid = G.bids[p], won = G.tricksWon[p];
      const sc = won === bid ? 5 + bid : -Math.abs(won - bid);
      roundScores.push(sc);
      G.scores[p] += sc;
      metrics[p].bids++;
      const diff = won - bid;
      if (diff === 0) metrics[p].exact++;
      else if (diff > 0) metrics[p].under++;
      else metrics[p].over++;
    }

    // Print round summary
    const parts = names.map((n,i) => `${n}:${G.bids[i]}/${G.tricksWon[i]}${roundScores[i]>=0?'+':''}${roundScores[i]}`);
    const ts = G.trumpSuit ? G.trumpSuit.slice(0,3) : 'NT';
    process.stdout.write(`  R${String(roundIndex+1).padStart(2)} [${cpp}c ${ts}] ${parts.join('  ')}\n`);

    G.dealerIndex = (G.dealerIndex + 1) % NUM_PLAYERS;
  }

  console.log(`\n  ─── Results ───`);
  const sorted = names.map((n,i) => ({name: n, score: G.scores[i], ...metrics[i]})).sort((a,b) => b.score - a.score);
  for (const p of sorted) {
    const pct = (p.exact/p.bids*100).toFixed(0);
    console.log(`  ${p.name.padEnd(8)} score=${String(p.score).padStart(3)}  exact=${p.exact}/${p.bids} (${pct}%)  over=${p.over}  under=${p.under}`);
  }
  console.log(`  Winner: ${sorted[0].name} (${sorted[0].score})`);
  console.log(`  Grok API calls this game: ${geminiApiCalls}`);

  return {names, scores: G.scores.slice(), metrics};
}

// ─── Main ───
async function main() {
  console.log(`\nRunning ${NUM_GAMES} game(s) with ${NUM_PLAYERS} players: ${TEAM.slice(0,NUM_PLAYERS).join(', ')}`);
  console.log(`Model: ${LLM_MODEL} | Rate limit: ${LLM_INTERVAL/1000}s between calls\n`);

  const allResults = [];
  for (let g = 1; g <= NUM_GAMES; g++) {
    const result = await playOneGame(g);
    allResults.push(result);
  }

  if (NUM_GAMES > 1) {
    console.log('\n═══ Overall Summary ═══');
    const totals = {};
    TEAM.slice(0, NUM_PLAYERS).forEach(n => totals[n] = {wins:0, totalScore:0, totalExact:0, totalBids:0, totalOver:0, totalUnder:0});
    for (const r of allResults) {
      const winner = r.names[r.scores.indexOf(Math.max(...r.scores))];
      totals[winner].wins++;
      r.names.forEach((n,i) => {
        totals[n].totalScore += r.scores[i];
        totals[n].totalExact += r.metrics[i].exact;
        totals[n].totalBids += r.metrics[i].bids;
        totals[n].totalOver += r.metrics[i].over;
        totals[n].totalUnder += r.metrics[i].under;
      });
    }
    console.log(`${'Player'.padEnd(8)} Wins  AvgScore  BidAcc%  Over  Under`);
    Object.entries(totals).sort((a,b) => b[1].wins - a[1].wins || b[1].totalScore - a[1].totalScore).forEach(([n,t]) => {
      const pct = (t.totalExact/t.totalBids*100).toFixed(0);
      const avg = (t.totalScore/NUM_GAMES).toFixed(1);
      console.log(`${n.padEnd(8)} ${String(t.wins).padStart(4)}  ${String(avg).padStart(8)}  ${String(pct).padStart(7)}  ${String(t.totalOver).padStart(4)}  ${t.totalUnder}`);
    });
  }
}

main().catch(console.error);
