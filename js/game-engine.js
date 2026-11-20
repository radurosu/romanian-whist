// Shared game state, rules, AI, recording and analysis. No DOM or storage access.
// Hosts install presentation effects; the replay worker uses the default no-ops.
const gameOptions = globalThis;
const gameEffects = {
  sfxDeal: () => {},
  sfxBid: () => {},
  sfxCardPlay: () => {},
  sfxAutoPlay: () => {},
  sfxTrickWin: () => {},
  sfxRoundEnd: () => {},
  renderAll: () => {},
  showRoundResult: () => {},
  checkAutoBid: () => {},
  trickWinReason: () => {},
};
function configureGameEffects(effects) { Object.assign(gameEffects, effects); }

const ALL_RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const SUITS = ['spades','hearts','diamonds','clubs'];
const RANK_VALUE = {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
const SUIT_SYMBOL = {spades:'\u2660', hearts:'\u2665', diamonds:'\u2666', clubs:'\u2663'};
const SUIT_COLOR = {spades:'black', hearts:'red', diamonds:'red', clubs:'black'};
const ALL_OPPONENTS = ['Codex','Grok','Viktor','Sasha','Sniper','Katya','Spite'];

// Codex AI — tuned in test_codex.mjs against the frozen champion field.
const CODEX_CFG = {
  oneCardSims: 512,
  oneCardThreshold: 0.44,
  bidSims: 72,
  playSims: 72,
  posteriorSigma: 1.2,
  matchWeight: 0.25,
  spiteBonus: 2.0,
  strengthScale: {
    3:{1:1.06,2:0.86,3:0.92,4:1.00,5:1.09,6:1.17,7:1.13,8:1.30},
    4:{1:0.80,2:0.88,3:0.89,4:1.03,5:1.10,6:1.16,7:1.19,8:1.50},
    5:{1:0.78,2:0.91,3:0.87,4:1.07,5:1.11,6:1.16,7:1.21,8:1.64},
    6:{1:0.79,2:0.88,3:0.85,4:1.07,5:1.14,6:1.24,7:1.28,8:2.01},
  },
};

// Grok AI. Kappa is points per bid level added inside the PIMC value, before
// the argmax — an additive nudge after rounding never moved the bid. Seeded
// from the arena fit of this same playout. Pushing it further overbid.
const GROK_CFG = {
  bidSims: 72,
  playSims: 72,
  kappa: {
    linear:    { 2: 1.73, 3: 1.97, 4: 1.69, 5: 1.49, 6: 1.33, 7: 0.67, 8: 0.65 },
    geometric: { 2: 1.63, 3: 1.90, 4: 1.84, 5: 1.53, 6: 1.25, 7: 0.03, 8: -0.15 },
  },
  oneCardThreshold: 0.44,
  endgameMaxCards: 2,
  endgameSamples: 48,
  spiteBonus: 2.0,
};

// Named players v2 (Viktor, Sasha, Sniper, Katya, Tempo2). Bids: PIMC with a
// per-hand-size lean (kappa: points per bid level added to the simulated value,
// calibrated in the arena so bids land on the tricks actually taken), forced
// last bids decided by simulated value, Codex's one-card solver. Play: Grok's
// in-trick opponent model and exact endgame. `lean` keeps each personality.
const NAMED_CFG = {
  kappa: {   // arena-calibrated: 1,200 games per mode vs Codex/Grok/named
    linear:    { 2: 1.73, 3: 1.97, 4: 1.69, 5: 1.49, 6: 1.33, 7: 0.67, 8: 0.65 },
    geometric: { 2: 1.63, 3: 1.90, 4: 1.84, 5: 1.53, 6: 1.25, 7: 0.03, 8: -0.15 },
  },
  lean: { void: 0, tempo: 0, sniper: 0, precision: 0 },
  oneCardThreshold: 0.44,
};

function pickOpponents(count) {
  const includeCodex = gameOptions._includeCodex !== false;
  const includeGrok = gameOptions._includeGrok !== false;
  const pool = ALL_OPPONENTS.filter(n =>
    (includeCodex || n !== 'Codex') && (includeGrok || n !== 'Grok')
  );
  const forced = [];
  if (includeCodex) forced.push('Codex');
  if (gameOptions._includeJev && jevConfigured()) forced.push('Jev');
  if (gameOptions._geminiApiKey) forced.push('Gemini');
  if (includeGrok) forced.push('Grok');
  const rest = pool.filter(n => !forced.includes(n)).sort(() => Math.random() - 0.5);
  const picks = [...forced, ...rest];
  const seen = new Set();
  const out = [];
  for (const n of picks) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= count) break;
  }
  while (out.length < count) {
    const extra = rest.find(n => !seen.has(n));
    if (!extra) break;
    seen.add(extra);
    out.push(extra);
  }
  return out;
}

// Will be set dynamically in startGame
let PLAYER_NAMES_MAP = {
  3: ['You','Viktor','Sasha'],
  4: ['You','Viktor','Sasha','Sniper'],
  5: ['You','Viktor','Sasha','Sniper','Katya'],
  6: ['You','Viktor','Sasha','Sniper','Katya','Tempo2']
};

/*
 * ═══════════════════════════════════════════════════════════════════
 *  AI PLAYERS — Tournament-tested strategies
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Ranked by tournament win rate (500+ games each matchup):
 *
 *  VIKTOR 🐉 — "The Void Master" (53.6% win rate in tournament)
 *    Bidding : Counts trumps + voids aggressively. Void with trumps
 *              = guaranteed ruffing tricks. Short suits valued high.
 *    Play    : Actively empties short non-trump suits to create voids.
 *              Then trumps in on opponents' leads. Card counting for
 *              master detection. When ducking, sheds from longest suit.
 *    Why:      Creating voids is the single strongest strategy. Once
 *              void in a suit, every opponent lead in that suit is a
 *              free trick via trumping.
 *
 *  SASHA ⚡ — "The Tempo Player" (42.0% win rate)
 *    Bidding : Slightly aggressive. Values trump length and aces high.
 *              Willing to bid one more than safe estimate.
 *    Play    : Leads trump early to strip opponents' trumps, then
 *              cashes aces in clear suits. Forces the pace rather
 *              than reacting. Plays highest beater when following.
 *    Why:      Stripping opponents' trumps removes their ruffing
 *              ability, making your high cards safe to cash.
 *
 *  KATYA 🎯 — "The Precision Player" (37.6% win rate)
 *    Bidding : Accurate hand evaluation with AK combo detection,
 *              protected honor assessment, void/singleton bonuses.
 *    Play    : Textbook. Cashes masters from shortest suits first.
 *              Cheapest winner when last to play. Sheds highest
 *              losers when ducking. Card counting throughout.
 *    Why:      Solid fundamentals. Rarely overbids. Consistent
 *              but doesn't create the explosive plays Void/Tempo do.
 *
 *  SNIPER 🎯 — "The Bid Sniper" (27.6% win rate)
 *    Bidding : Ultra-precise. Counts protected honors (AK = boost,
 *              naked Q = discount). Very low noise — trusts the math.
 *    Play    : Counts sure winners exactly. Cashes only what's needed,
 *              then ducks. Voids short suits when speculating.
 *
 *  SPITE 😈 — plays to hurt the leaders (replaced Tempo2, a Sasha copy)
 *    Scores every simulated outcome as its own points minus a share of
 *    each opponent's, weighted by how far ahead of it they are. Goes
 *    after big contracts and the leader, even at some cost to itself.
 *
 *  GROK 🜲 — Kappa PIMC + true endgame (≤2 cards)
 *    Bidding : per-hand-size lean inside the simulated value, so a
 *              fraction of a trick can change the bid. Last bid by EV.
 *              One-card solver. No additive geometric bump.
 *    Play    : High-sim PIMC mid-hand; exact tree search endgame.
 *
 *  CODEX ⌘ — Bid-conditioned imperfect-information search
 *    Bidding : Position-aware one-card solver; importance-weighted PIMC.
 *    Play    : Constrained hidden-hand worlds plus late-match pressure.
 *    Eval    : 84.14 avg / 28.0% wins vs Grok's 82.64 / 21.2% (300 games).
 *
 *  JEV ∵ — TypeSafe System One (live API)
 *    Bidding / play: Choice over valid bids / legal cards. No search.
 *    Falls back to PIMC if the proxy/API is down.
 *
 * ═══════════════════════════════════════════════════════════════════
 */
const PLAYERS = {
  'Codex':  { style: 'codex',     face: '⌘', noise: 0 },
  'Grok':   { style: 'grok',      face: '🜲', noise: 0.06 },
  'Viktor': { style: 'void',      face: '🐉', noise: 0.10, v2: true },
  'Sasha':  { style: 'tempo',     face: '⚡', noise: 0.12, v2: true },
  'Sniper': { style: 'sniper',    face: '🎯', noise: 0.08, v2: true },
  'Katya':  { style: 'precision', face: '🦊', noise: 0.08, v2: true },
  'Tempo2': { style: 'tempo',     face: '🔥', noise: 0.15, v2: true }, // retired; resumes old saves
  'Spite':  { style: 'spite',     face: '😈', noise: 0.08, v2: true },
  'Gemini': { style: 'gemini',    face: '🤖', noise: 0 },
  'Jev':    { style: 'jev',       face: '∵', noise: 0 },
};

function getFace(name) {
  return (PLAYERS[name] || {}).face || '🃏';
}

function getPlayer(playerIndex) {
  const name = G.playerNames[playerIndex];
  return PLAYERS[name] || PLAYERS['Katya'];
}

function getStyle(playerIndex) {
  return getPlayer(playerIndex).style;
}

// ─── Gemini AI Player ───
const RANK_NAMES = {A:'Ace',K:'King',Q:'Queen',J:'Jack','10':'10','9':'9','8':'8','7':'7','6':'6','5':'5','4':'4','3':'3','2':'2'};
const SUIT_NAMES = {spades:'Spades',hearts:'Hearts',diamonds:'Diamonds',clubs:'Clubs'};

function cardToText(card) {
  return `${RANK_NAMES[card.rank]} of ${SUIT_NAMES[card.suit]}`;
}

function textToCard(text, legalMoves) {
  const t = text.toLowerCase();
  const rankMap = {ace:'A',king:'K',queen:'Q',jack:'J','10':'10','9':'9','8':'8','7':'7','6':'6','5':'5','4':'4','3':'3','2':'2'};
  const suitMap = {spades:'spades',hearts:'hearts',diamonds:'diamonds',clubs:'clubs',spade:'spades',heart:'hearts',diamond:'diamonds',club:'clubs'};
  for (const card of legalMoves) {
    const rname = RANK_NAMES[card.rank].toLowerCase();
    const sname = SUIT_NAMES[card.suit].toLowerCase();
    if (t.includes(rname) && (t.includes(sname) || t.includes(sname.slice(0,-1)))) return card;
  }
  // fallback: try rank only if unique
  for (const card of legalMoves) {
    const rname = RANK_NAMES[card.rank].toLowerCase();
    if (t.includes(rname)) {
      const matches = legalMoves.filter(c => RANK_NAMES[c.rank].toLowerCase() === rname);
      if (matches.length === 1) return matches[0];
    }
  }
  return null;
}

async function callGeminiAPI(prompt) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gameOptions._geminiApiKey}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{parts: [{text: prompt}]}],
          generationConfig: {temperature: 0.3, maxOutputTokens: 150}
        })
      }
    );
    clearTimeout(timeoutId);
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch(e) {
    console.warn('Gemini API error:', e);
    return null;
  }
}

function buildGeminiBidPrompt(playerIndex) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const trumpName = G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump';
  const trumpCardText = G.trumpCard ? `${RANK_NAMES[G.trumpCard.rank]} of ${trumpName} (this card is face-up and REMOVED from play — the next highest ${trumpName} in your hand is the top trump)` : 'none (no trump this round)';
  const bidderPos = G.bids.filter(b => b !== null).length + 1;
  const isLast = bidderPos === G.numPlayers;
  const alreadyBid = G.bids.map((b,i) => b !== null ? `  - ${G.playerNames[i]}: bid ${b}` : null).filter(Boolean).join('\n') || '  (you are first to bid)';
  const forbiddenNote = isLast ? `\nIMPORTANT: You are the last bidder. You CANNOT bid ${cpp - G.bids.filter(b=>b!==null).reduce((a,b)=>a+b,0)} (would make total equal cards per player).` : '';

  return `You are playing Romanian Whist, a trick-taking card game.

RULES:
- Players MUST follow the led suit if possible.
- If you cannot follow suit, you MUST play trump if you have any.
- Only if you have neither led suit nor trump can you play freely.
- Scoring: ${G.scoringMode === 'geometric'
    ? 'GEOMETRIC. Make your bid B = 5 + B(B+1)/2 points (bid 0 made = 5; 1=6; 2=8; 3=11; 4=15; 5=20). Miss by d tricks = -d(d+1)/2 (off by 1=-1; 2=-3; 3=-6; 4=-10). Bigger made bids pay far more, but big misses hurt far more — bid the most tricks you can reliably make.'
    : 'exact bid = 5 + bid points. Miss = -|tricks_won - bid|. Bid 0 and make it = 5 points.'}

GAME STATE:
- Players: ${G.numPlayers} | Trump: ${trumpName} | Trump card: ${trumpCardText}
- Cards per player this round: ${cpp}
- You are bidder ${bidderPos} of ${G.numPlayers}
- Round ${G.currentRoundIndex + 1} of ${G.roundSequence.length}

MATCH STANDINGS (cumulative score):
${G.scores.map((s,i) => `  - ${G.playerNames[i]}: ${s}`).join('\n')}

BIDS SO FAR:
${alreadyBid}${forbiddenNote}

YOUR HAND:
${hand.map(cardToText).join(', ')}

STRATEGIC GUIDANCE:
- The trump card shown is OUT OF PLAY — your next-highest trump is the top trump.
- Count likely winners: Aces win. Kings win when the Ace is gone or out of play. Queens need A and K gone.
- Suit length matters: A-K-x-x-x in one suit can produce 4-5 tricks by running the suit. Scattered honors produce fewer.
- Void suits (0 cards) with trumps = ruffing tricks (~0.5 extra tricks each). Singletons become voids after one lead.
- Distribution: if you hold 5 of a suit, opponents share only 3 — your small cards may become winners.
- Position: bidding early = lean conservative. Bidding later = exploit gaps.
- If total bids running high, not everyone can make it — be cautious. If low, tricks are unclaimed.

Valid bid range: 0 to ${cpp}.
Respond with ONLY a single integer (your bid). Nothing else.`;
}

function buildGeminiPlayPrompt(playerIndex, legalMoves, ledSuit) {
  const hand = G.hands[playerIndex];
  const bid = G.bids[playerIndex];
  const won = G.tricksWon[playerIndex];
  const need = bid - won;
  const cpp = G.cardsPerPlayer;
  const trumpName = G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump';
  const trumpCardText = G.trumpCard ? `${RANK_NAMES[G.trumpCard.rank]} of ${trumpName} (removed from play)` : 'none';
  const trickPos = G.currentTrick.length;
  const posNames = ['leading','2nd','3rd','4th','5th','6th'];
  const posText = posNames[trickPos] || `${trickPos+1}th`;
  const isLast = trickPos === G.numPlayers - 1;

  const currentTrickText = G.currentTrick.length === 0 ? '(you are leading — no cards played yet)' :
    G.currentTrick.map(e => `  ${G.playerNames[e.playerIndex]}: ${cardToText(e.card)}`).join('\n');

  const playersStatus = G.bids.map((b,i) => {
    if (b === null) return null;
    const w = G.tricksWon[i];
    const n = b - w;
    const state = n > 0 ? `needs ${n} more` : n === 0 ? 'DONE (will try to lose)' : `OVER (made ${w}, bid ${b})`;
    return `  - ${G.playerNames[i]}: bid ${b}, won ${w} — ${state} | match score ${G.scores[i]}`;
  }).filter(Boolean).join('\n');

  // Attributed trick-by-trick history for THIS round (who led, who played what, who won).
  // Lets the model infer voids, who holds control, and each player's tendencies.
  const trickHistoryText = (G.trickHistory && G.trickHistory.length) ?
    G.trickHistory.map((t, ti) => {
      const leader = G.playerNames[t.leaderIndex != null ? t.leaderIndex : t.entries[0].playerIndex];
      const plays = t.entries.map(e => `${G.playerNames[e.playerIndex]} ${cardToText(e.card)}`).join(', ');
      const winner = G.playerNames[t.winnerIndex];
      return `  Trick ${ti+1} (led by ${leader}): ${plays} → won by ${winner}`;
    }).join('\n') : '  (no completed tricks yet this round)';

  // Voids observed this round: a player who failed to follow a led suit is void in it.
  const voidNotes = [];
  if (G.trickHistory) {
    const voids = {};
    for (const t of G.trickHistory) {
      const ls = t.entries[0].card.suit;
      for (const e of t.entries) {
        if (e.card.suit !== ls) { (voids[e.playerIndex] = voids[e.playerIndex] || new Set()).add(ls); }
      }
    }
    for (const pi in voids) voidNotes.push(`  - ${G.playerNames[pi]} is VOID in ${[...voids[pi]].map(s=>SUIT_NAMES[s]).join(', ')}`);
  }
  const voidText = voidNotes.length ? voidNotes.join('\n') : '  (none observed yet)';

  const legalList = legalMoves.map((c,i) => `  ${i+1}. ${cardToText(c)}`).join('\n');

  return `You are playing Romanian Whist, a trick-taking card game.

RULES:
- Players MUST follow the led suit if possible.
- If you cannot follow suit, you MUST play trump if you have any.
- Only if you have neither led suit nor trump can you play freely.
- Highest card of led suit wins, unless trumped — highest trump wins.

GAME STATE:
- Players: ${G.numPlayers} | Trump: ${trumpName} | Trump card: ${trumpCardText}
- Round: ${G.currentRoundIndex + 1} of ${G.roundSequence.length} | Cards per player: ${cpp}

PLAYER STATUS:
${playersStatus}

YOU (${G.playerNames[playerIndex]}): bid ${bid}, won ${won} — ${need > 0 ? `need ${need} more trick${need>1?'s':''}` : need === 0 ? 'DONE, avoid winning' : 'OVER bid, minimize damage'}

TRICK HISTORY THIS ROUND (perfect memory — who led, who played what, who won):
${trickHistoryText}

VOIDS OBSERVED (a player who didn't follow the led suit has none of it left):
${voidText}

CURRENT TRICK (${posText} to play${isLast ? ' — LAST position, perfect information' : ''}):
${currentTrickText}${ledSuit ? `\n  Led suit: ${SUIT_NAMES[ledSuit]}` : ''}

YOUR LEGAL MOVES:
${legalList}

STRATEGIC GUIDANCE:
- CONTROL: winning a trick means you choose the next suit — major advantage.
- CARD PROTECTION: don't play K when A is still unplayed and someone ahead might hold it. Duck and save it.
- FINESSING: holding A-Q in a suit, leading low toward Q can win both tricks if K is to your left.
- SUIT ESTABLISHMENT: 5+ cards with top honors — lead repeatedly, small cards become winners.
- SACRIFICE: lose a trick deliberately to gain better position or force a favorable lead.
- TRUMP MANAGEMENT: don't trump eagerly if you need trump for protection later.
- DEFENSIVE: when bid is made, play lowest cards — extra tricks cost points.
- COUNTING: use TRICK HISTORY above. If A♠ is gone, your K♠ is the master.
- VOIDS: exploit VOIDS OBSERVED — leading a suit an opponent is void in lets them ruff (if they hold trump) or discard; lead voids only when it helps you.
- READING PLAYERS: trick history shows tendencies — who leads trumps, who ducks, who hoards honors. Use it.
- STANDINGS: match score shows who leads the game. A trailing opponent who is DONE may still spoil; the leader is the one to set when you can.
- POSITION: last to play = perfect information — use cheapest winner, dump safely.
- OPPONENTS: DONE players dump low and aren't competing. Players needing tricks are threats.

Respond with ONLY the card to play as "RANK of SUIT" (e.g. "Ace of Spades"). Nothing else.`;
}

let _geminiMode = 'algo'; // 'api' or 'algo' — tracks last Gemini decision source
let _geminiLastCallTime = 0;
const GEMINI_MIN_INTERVAL = 5000; // 5s between calls = max 12/min, safely under 15 RPM

async function callGeminiRateLimited(prompt) {
  const now = Date.now();
  const wait = GEMINI_MIN_INTERVAL - (now - _geminiLastCallTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _geminiLastCallTime = Date.now();
  return callGeminiAPI(prompt);
}

async function geminiComputeBid(playerIndex) {
  const cpp = G.cardsPerPlayer;
  if (cpp <= 2) {
    _geminiMode = 'algo';
    if (cpp === 1) {
      const hand = G.hands[playerIndex];
      const player = PLAYERS['Gemini'];
      let est = compute1CardWinProb(hand[0], G.numPlayers, G.trumpSuit);
      est += (Math.random() - 0.5) * 0.1;
      return constrainBid(Math.max(0, Math.min(1, Math.round(est))), est, cpp);
    }
    return constrainBid(pimcBid(playerIndex, 80), pimcBid(playerIndex, 80), cpp);
  }
  const prompt = buildGeminiBidPrompt(playerIndex);
  const response = await callGeminiRateLimited(prompt);
  if (response !== null) {
    const match = response.match(/\d+/);
    if (match) {
      const bid = parseInt(match[0]);
      if (bid >= 0 && bid <= cpp) {
        _geminiMode = 'api';
        return constrainBid(bid, bid, cpp);
      }
    }
  }
  // Fallback to PIMC
  _geminiMode = 'algo';
  console.warn('Gemini bid fallback to PIMC');
  const bid = pimcBid(playerIndex, 80);
  return constrainBid(bid, bid, cpp);
}

async function geminiChooseCard(playerIndex, legalMoves, ledSuit) {
  if (legalMoves.length === 1) { _geminiMode = 'algo'; return legalMoves[0]; }
  const cpp = G.cardsPerPlayer;
  if (cpp <= 2) {
    _geminiMode = 'algo';
    return pimcChooseCard(playerIndex, legalMoves, 80);
  }
  const prompt = buildGeminiPlayPrompt(playerIndex, legalMoves, ledSuit);
  const response = await callGeminiRateLimited(prompt);
  if (response !== null) {
    const card = textToCard(response, legalMoves);
    if (card) {
      _geminiMode = 'api';
      return card;
    }
  }
  // Fallback to PIMC
  _geminiMode = 'algo';
  console.warn('Gemini play fallback to PIMC, response was:', response);
  return pimcChooseCard(playerIndex, legalMoves, 80);
}

// ─── Jev (TypeSafe System One) ───
// Browser never talks to api.typesafe.ai (no CORS). Only the local proxy.
const TYPESAFE_MODEL = 'jev-latest';
let _jevMode = 'pimc'; // 'jev-api' | 'pimc' | 'auto'

function jevOnProxyOrigin() {
  return (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && location.port === '8787';
}

function jevConfigured() {
  return !!(gameOptions._typesafeEndpoint || jevOnProxyOrigin());
}

function jevUrl() {
  if (gameOptions._typesafeEndpoint) return gameOptions._typesafeEndpoint;
  if (jevOnProxyOrigin()) return '/v1/systemone';
  return null;
}

function cardId(card) {
  return card.rank + '_' + card.suit;
}

function jevScoringBlurb() {
  return G.scoringMode === 'geometric'
    ? 'Geometric: make bid B = 5 + B(B+1)/2 points. Miss by d = -d(d+1)/2. Bigger made bids pay more; big misses hurt more.'
    : 'Linear: make bid B = 5+B points. Miss by d = -d. Exact contract — extra tricks are as bad as missing.';
}

function jevPlayerRow(i) {
  const bid = G.bids[i];
  const won = G.tricksWon[i];
  let status = 'not yet bid';
  if (bid !== null) {
    const n = bid - won;
    status = n > 0 ? `needs ${n} more` : n === 0 ? 'DONE — will try to lose extra tricks' : `OVER — made ${won}, bid ${bid}`;
  }
  const voids = G.knownVoids && G.knownVoids[i]
    ? Object.keys(G.knownVoids[i]).filter(s => G.knownVoids[i][s])
    : [];
  return {
    name: G.playerNames[i],
    isMe: false,
    bid,
    tricksWon: won,
    status,
    matchScore: G.scores[i],
    voids: voids.map(s => SUIT_NAMES[s] || s),
  };
}

function buildJevBidState(playerIndex, validBids, forbidden) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const bidderPos = G.bids.filter(b => b !== null).length + 1;
  return {
    game: 'Romanian Whist',
    rules: {
      followSuit: 'Must follow the led suit if possible.',
      voidMustTrump: 'If void in led suit, MUST play trump if you have any.',
      lastBidder: 'The last bidder cannot make the sum of bids equal the number of tricks this round.',
      scoring: jevScoringBlurb(),
      trumpCardOutOfPlay: 'The face-up trump card is removed from the deck and cannot be played. The next-highest trump in hand is the top trump.',
    },
    round: {
      index: G.currentRoundIndex + 1,
      of: G.roundSequence.length,
      cardsPerPlayer: cpp,
      trumpSuit: G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump',
      trumpCard: G.trumpCard ? `${cardToText(G.trumpCard)} (OUT OF PLAY)` : 'none (no trump this round)',
    },
    me: {
      name: G.playerNames[playerIndex],
      bidderPosition: bidderPos,
      of: G.numPlayers,
      isLastBidder: bidderPos === G.numPlayers,
      hand: hand.map(cardToText),
    },
    bidsSoFar: G.bids.map((b, i) => b === null ? null : { name: G.playerNames[i], bid: b }).filter(Boolean),
    forbiddenBid: forbidden,
    validBids,
    standings: G.scores.map((s, i) => ({ name: G.playerNames[i], score: s })),
  };
}

function describeJevCard(card, playerIndex, ledSuit) {
  const bits = [cardToText(card)];
  if (G.trumpSuit && card.suit === G.trumpSuit) bits.push('trump');
  if (ledSuit && card.suit === ledSuit) bits.push('follows led suit');
  else if (ledSuit) bits.push('does not follow');
  if (isHighestRemaining(card, G.hands[playerIndex])) bits.push('master of this suit among remaining cards');
  if (G.currentTrick.length > 0) {
    const win = currentWinner();
    bits.push(cardBeats(card, win.card, ledSuit) ? 'beats current winner' : 'loses to current winner');
  }
  return bits.join(' — ');
}

function buildJevPlayState(playerIndex, legalMoves, ledSuit) {
  const bid = G.bids[playerIndex];
  const won = G.tricksWon[playerIndex];
  const need = bid - won;
  const trickPos = G.currentTrick.length;
  const posNames = ['leading', '2nd', '3rd', '4th', '5th', '6th'];
  const goal = need > 0 ? `need ${need} more trick${need > 1 ? 's' : ''}` : need === 0 ? 'DONE, avoid winning extra tricks' : 'OVER bid, minimize further damage';
  const history = (G.trickHistory || []).map((t, ti) => {
    const leader = G.playerNames[t.leaderIndex != null ? t.leaderIndex : t.entries[0].playerIndex];
    const plays = t.entries.map(e => `${G.playerNames[e.playerIndex]} ${cardToText(e.card)}`).join(', ');
    return `Trick ${ti + 1} (led by ${leader}): ${plays} → won by ${G.playerNames[t.winnerIndex]}`;
  });
  const table = G.bids.map((_, i) => {
    const row = jevPlayerRow(i);
    row.isMe = i === playerIndex;
    return row;
  });
  return {
    game: 'Romanian Whist',
    rules: {
      followSuit: 'Must follow the led suit if possible.',
      voidMustTrump: 'If void in led suit, MUST play trump if you have any.',
      win: 'Highest card of led suit wins unless trumped — highest trump wins.',
      scoring: jevScoringBlurb(),
      trumpCardOutOfPlay: 'The face-up trump card is out of play.',
    },
    round: {
      index: G.currentRoundIndex + 1,
      of: G.roundSequence.length,
      cardsPerPlayer: G.cardsPerPlayer,
      trumpSuit: G.trumpSuit ? SUIT_NAMES[G.trumpSuit] : 'No Trump',
      trumpCard: G.trumpCard ? `${cardToText(G.trumpCard)} (OUT OF PLAY)` : 'none',
    },
    me: {
      name: G.playerNames[playerIndex],
      hand: G.hands[playerIndex].map(cardToText),
      bid,
      tricksWon: won,
      goal,
    },
    table,
    trickHistory: history,
    currentTrick: {
      position: posNames[trickPos] || `${trickPos + 1}th`,
      isLast: trickPos === G.numPlayers - 1,
      ledSuit: ledSuit ? SUIT_NAMES[ledSuit] : null,
      plays: G.currentTrick.map(e => ({ name: G.playerNames[e.playerIndex], card: cardToText(e.card) })),
    },
  };
}


// ─── Jev rich state: the features our PIMC bots use implicitly ───
// (deck composition, unseen cards, masters, trumps out, fair share, opponent
// track record). Same shape as test_jev.mjs --rich so evals stay comparable.
function jevDeckInfo() {
  const ranks = ALL_RANKS.slice(0, G.numPlayers * 2);
  return {
    totalCards: G.numPlayers * 8,
    ranksInDeck: `${ranks.join(', ')} (${ranks.length} ranks per suit; ${ranks[ranks.length - 1]} is the LOWEST card in this deck)`,
    playersCount: G.numPlayers,
  };
}

function jevBySuit(cards) {
  const out = {};
  for (const s of SUITS) {
    const cs = cards.filter(c => c.suit === s).sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
    if (cs.length) out[SUIT_NAMES[s]] = cs.map(c => c.rank).join(' ');
  }
  return out;
}

function jevHandFeatures(playerIndex) {
  const hand = G.hands[playerIndex];
  const out = getCardsStillOut(hand);
  const trumps = G.trumpSuit ? hand.filter(c => c.suit === G.trumpSuit) : [];
  let masters = 0, probable = 0;
  const voids = [];
  for (const s of SUITS) {
    const mine = hand.filter(c => c.suit === s).sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
    const outS = out.filter(c => c.suit === s);
    if (!mine.length) {
      if (G.trumpSuit && s !== G.trumpSuit && trumps.length) voids.push(SUIT_NAMES[s]);
      continue;
    }
    let k = 0;
    for (const c of mine) { if (!outS.some(o => RANK_VALUE[o.rank] > RANK_VALUE[c.rank])) k++; else break; }
    masters += k;
    for (const c of mine.slice(k)) {
      if (outS.filter(o => RANK_VALUE[o.rank] > RANK_VALUE[c.rank]).length === 1) probable++;
    }
  }
  return {
    sureWinners: masters,
    probableWinners: probable,
    trumpsInHand: trumps.length,
    trumpsStillUnseen: G.trumpSuit ? out.filter(c => c.suit === G.trumpSuit).length : 0,
    voidSuitsWithTrumpsToRuff: voids,
    fairShareOfTricks: +(G.cardsPerPlayer / G.numPlayers).toFixed(2),
    handBySuit: jevBySuit(hand),
    unseenCardsBySuit: jevBySuit(out),
    unseenCount: out.length,
  };
}

function jevOpponentHistory() {
  const rows = [];
  for (let i = 0; i < G.numPlayers; i++) {
    const s = G.opponentStats && G.opponentStats[i];
    if (!s || !s.bids) continue;
    rows.push({
      name: G.playerNames[i],
      roundsBid: s.bids,
      madeRate: +(s.made / s.bids).toFixed(2),
      avgOverUnder: +(((s.wonSum || 0) - (s.bidSum || 0)) / s.bids).toFixed(2),
    });
  }
  return rows;
}

function enrichJevBidState(playerIndex, st) {
  st.deck = jevDeckInfo();
  st.analysis = jevHandFeatures(playerIndex);
  const placed = G.bids.filter(b => b !== null);
  const sum = placed.reduce((a, b) => a + b, 0);
  st.bidding = {
    sumOfBidsSoFar: sum,
    tricksAvailable: G.cardsPerPlayer,
    tricksNotYetClaimed: G.cardsPerPlayer - sum,
    note: 'Total bids above tricks available means someone will fail; below means tricks are up for grabs.',
  };
  st.opponentTrackRecord = jevOpponentHistory();
  return st;
}

function enrichJevPlayState(playerIndex, st) {
  st.deck = jevDeckInfo();
  st.analysis = jevHandFeatures(playerIndex);
  const played = (G.trickHistory || []).length;
  st.round.tricksPlayed = played;
  st.round.tricksRemaining = G.cardsPerPlayer - played;
  const need = G.bids[playerIndex] - G.tricksWon[playerIndex];
  st.me.tricksStillNeeded = need;
  st.me.mustWinEveryRemainingTrick = need > 0 && need === G.cardsPerPlayer - played;
  st.me.mustLoseEveryRemainingTrick = need <= 0;
  st.opponentTrackRecord = jevOpponentHistory();
  return st;
}

async function callJevAPI(state, questions) {
  const url = jevUrl();
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ state, model: TYPESAFE_MODEL, questions }),
    });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      console.warn('Jev API', resp.status, err.slice(0, 300));
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Jev API error', e);
    return null;
  }
}

function jevFallbackBid(playerIndex) {
  const prev = G.playerNames[playerIndex];
  G.playerNames[playerIndex] = 'Grok';
  try { return computeAIBid(playerIndex); }
  finally { G.playerNames[playerIndex] = prev; }
}

function jevFallbackCard(playerIndex, legalMoves, ledSuit) {
  const prev = G.playerNames[playerIndex];
  G.playerNames[playerIndex] = 'Grok';
  try { return chooseAICard(playerIndex, legalMoves, ledSuit); }
  finally { G.playerNames[playerIndex] = prev; }
}

function noteJevSource(playerIndex, source) {
  _jevMode = source;
  if (!G.decisionSource) G.decisionSource = {};
  G.decisionSource[playerIndex] = source;
}

async function jevComputeBid(playerIndex) {
  const cpp = G.cardsPerPlayer;
  const { valid, forbidden } = getValidBids(cpp, G.bids, isLastBidder());
  const criteria = {};
  for (const b of valid) {
    criteria[String(b)] = b === 0 ? 'Bid zero tricks (nil)' : `Bid exactly ${b} trick${b === 1 ? '' : 's'}`;
  }
  const data = await callJevAPI(enrichJevBidState(playerIndex, buildJevBidState(playerIndex, valid, forbidden)), {
    bid: {
      type: 'choice',
      instructions: 'Choose the bid that maximizes my expected round score. Hit the bid exactly. Never pick a forbidden last-bidder value. If last to bid, use already-placed bids. Prefer a bid I can actually make over an ambitious one.',
      criteria,
    },
  });
  const choice = data && data.answers && data.answers.bid && data.answers.bid.choice;
  const bid = parseInt(choice, 10);
  if (Number.isInteger(bid) && valid.includes(bid)) {
    noteJevSource(playerIndex, 'jev-api');
    console.log('Jev bid', bid, data.answers.bid.probabilities, 'conf', data.answers.bid.confidence);
    return constrainBid(bid, bid, cpp);
  }
  noteJevSource(playerIndex, 'pimc');
  console.warn('Jev bid fallback to Grok PIMC', choice);
  return jevFallbackBid(playerIndex);
}

async function jevChooseCard(playerIndex, legalMoves, ledSuit) {
  if (legalMoves.length === 1) { noteJevSource(playerIndex, 'auto'); return legalMoves[0]; }
  const criteria = {};
  for (const c of legalMoves) criteria[cardId(c)] = describeJevCard(c, playerIndex, ledSuit);
  const data = await callJevAPI(enrichJevPlayState(playerIndex, buildJevPlayState(playerIndex, legalMoves, ledSuit)), {
    card: {
      type: 'choice',
      instructions: 'Which legal card should I play to maximize my expected round score? If I still need tricks, win when it is cheap and likely. If I have already made my bid, dump a loser and do not take extras. Last to play: use perfect information — cheapest winner or safest dump.',
      criteria,
    },
  });
  const choice = data && data.answers && data.answers.card && data.answers.card.choice;
  const card = legalMoves.find(c => cardId(c) === choice);
  if (card) {
    noteJevSource(playerIndex, 'jev-api');
    console.log('Jev play', choice, data.answers.card.probabilities, 'conf', data.answers.card.confidence);
    return card;
  }
  noteJevSource(playerIndex, 'pimc');
  console.warn('Jev play fallback to Grok PIMC', choice);
  return jevFallbackCard(playerIndex, legalMoves, ledSuit);
}

// ─── Game State ───
let G = {};
let autoPlayTimer = null;

// Round scoring. Linear (classic): made = 5+bid, miss = -|diff|.
// Geometric: made = 5 + bid(bid+1)/2, miss = -diff(diff+1)/2 (triangular both ways).
// Reads the active mode off G so every call site (tally, PIMC bid-eval, card-eval, log) stays consistent.
function scoreRound(taken, bid, mode) {
  const m = mode || (G && G.scoringMode) || 'linear';
  const tri = n => n * (n + 1) / 2;
  if (m === 'geometric') {
    return taken === bid ? 5 + tri(bid) : -tri(Math.abs(taken - bid));
  }
  return taken === bid ? 5 + bid : -Math.abs(taken - bid);
}

function initState(numPlayers) {
  const seq = computeRoundSequence(numPlayers).map(c => gameOptions._forceCards || c);
  G = {
    numPlayers,
    scoringMode: gameOptions._scoringMode || 'linear',
    playerNames: PLAYER_NAMES_MAP[numPlayers],
    roundSequence: seq,
    currentRoundIndex: 0,
    dealerIndex: 0,
    cardsPerPlayer: 0,
    trumpCard: null,
    trumpSuit: null,
    bids: new Array(numPlayers).fill(null),
    currentBidderIndex: 0,
    biddingComplete: false,
    hands: Array.from({length: numPlayers}, () => []),
    currentTrick: [],
    trickLeaderIndex: 0,
    tricksWon: new Array(numPlayers).fill(0),
    scores: new Array(numPlayers).fill(0),
    roundHistory: [],
    phase: 'dealing',
    trickWinnerIndex: -1,
    playedCards: [],       // all cards played this round (for card counting)
    fullDeck: [],          // all cards in the deck this round
    knownVoids: {},        // {playerIndex: {suit: true}} — opponents shown void
    opponentStats: {},     // {playerIndex: {bids, made}} — cross-round tracking
    gameLog: null,         // full game recording
    bidChecks: {},         // {roundIndex: {pick, behind, bid}} — your bids vs the engine
    playChecks: {},        // {roundIndex: [{trick, before, card, pick, val}]} — your cards vs Katya
    trickHistory: []       // trick-by-trick log for round summary
  };
}

// ─── Game Recording ───
function initGameLog() {
  G.gameLog = {
    timestamp: new Date().toISOString(),
    numPlayers: G.numPlayers,
    scoringMode: G.scoringMode || 'linear',
    players: G.playerNames.slice(),
    rounds: [],
    _currentRound: null,
  };
}

function logRoundStart() {
  G.gameLog._currentRound = {
    roundIdx: G.currentRoundIndex,
    dealer: G.dealerIndex,
    cardsPerPlayer: G.cardsPerPlayer,
    trump: G.trumpCard ? G.trumpCard.rank + G.trumpCard.suit : null,
    trumpSuit: G.trumpSuit,
    hands: {},
    bids: {},
    tricks: [],
    _currentTrick: [],
  };
  for (let i = 0; i < G.numPlayers; i++) {
    G.gameLog._currentRound.hands[i] = G.hands[i].map(c => c.rank + c.suit);
  }
}

function logDecisionSource(playerIndex) {
  const style = getStyle(playerIndex);
  if (style === 'jev') return _jevMode;
  if (style === 'gemini') return _geminiMode === 'api' ? 'gemini-api' : 'algo';
  if (playerIndex === 0) return 'human';
  return style || 'algo';
}

function logBid(playerIndex, bid) {
  if (!G.gameLog || !G.gameLog._currentRound) return;
  G.gameLog._currentRound.bids[playerIndex] = bid;
  const sources = G.gameLog._currentRound.bidSources || (G.gameLog._currentRound.bidSources = {});
  sources[playerIndex] = logDecisionSource(playerIndex);
}

function logPlay(playerIndex, card) {
  if (!G.gameLog || !G.gameLog._currentRound) return;
  const r = G.gameLog._currentRound;
  r._currentTrick.push({
    player: playerIndex,
    name: G.playerNames[playerIndex],
    card: card.rank + card.suit,
    trickPosition: r._currentTrick.length,
    bid: G.bids[playerIndex],
    tricksWon: G.tricksWon[playerIndex],
    tricksNeeded: G.bids[playerIndex] - G.tricksWon[playerIndex],
    source: logDecisionSource(playerIndex),
  });
}

function logTrickEnd(winnerIndex) {
  if (!G.gameLog || !G.gameLog._currentRound) return;
  const r = G.gameLog._currentRound;
  r.tricks.push({
    plays: r._currentTrick.slice(),
    winner: winnerIndex,
    winnerName: G.playerNames[winnerIndex],
  });
  r._currentTrick = [];
}

function logRoundEnd() {
  if (!G.gameLog || !G.gameLog._currentRound) return;
  const r = G.gameLog._currentRound;
  r.results = {};
  for (let i = 0; i < G.numPlayers; i++) {
    r.results[i] = {
      name: G.playerNames[i],
      bid: G.bids[i],
      won: G.tricksWon[i],
      made: G.tricksWon[i] === G.bids[i],
      score: scoreRound(G.tricksWon[i], G.bids[i]),
      cumulative: G.scores[i],
    };
  }
  const pc = playChecks()[G.currentRoundIndex];
  if (pc && pc.length) r.playCheck = { choices: pc.length, flagged: playCheckFlagged(pc).length };
  G.gameLog.rounds.push(r);
  G.gameLog._currentRound = null;
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

function buildDeck(numPlayers) {
  const ranksPerSuit = numPlayers * 2;
  const ranks = ALL_RANKS.slice(0, ranksPerSuit);
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push({rank, suit});
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// ─── Game Flow ───
function startRound() {
  clearAutoPlay();
  const cpp = gameOptions._forceCards || G.roundSequence[G.currentRoundIndex];
  G.cardsPerPlayer = cpp;
  G.bids = new Array(G.numPlayers).fill(null);
  G.biddingComplete = false;
  G.currentTrick = [];
  G.tricksWon = new Array(G.numPlayers).fill(0);

  const deck = buildDeck(G.numPlayers);
  G.fullDeck = deck.slice();
  G.playedCards = [];
  G.trickHistory = [];
  G.lastTrick = null;
  // Reset void tracking each round
  G.knownVoids = {};
  for (let i = 0; i < G.numPlayers; i++) G.knownVoids[i] = {};
  // Initialize opponent stats if first round
  if (!G.opponentStats || Object.keys(G.opponentStats).length === 0) {
    G.opponentStats = {};
    for (let i = 0; i < G.numPlayers; i++) G.opponentStats[i] = {bids: 0, made: 0};
  }
  G.hands = Array.from({length: G.numPlayers}, () => []);
  for (let i = 0; i < cpp; i++) {
    for (let p = 0; p < G.numPlayers; p++) {
      G.hands[p].push(deck[i * G.numPlayers + p]);
    }
  }
  sortHand(G.hands[0]);
  gameEffects.sfxDeal(cpp);

  const totalDealt = cpp * G.numPlayers;
  const deckSize = G.numPlayers * 8;
  if (totalDealt < deckSize) {
    G.trumpCard = deck[totalDealt];
    G.trumpSuit = G.trumpCard.suit;
  } else {
    G.trumpCard = null;
    G.trumpSuit = null;
  }

  G.currentBidderIndex = (G.dealerIndex + 1) % G.numPlayers;
  G.phase = 'bidding';
  logRoundStart();
  gameEffects.renderAll();
  if (G.currentBidderIndex !== 0) {
    setTimeout(processAIBid, 600);
  } else gameEffects.checkAutoBid();
}

function sortHand(hand) {
  // Group by suit (ranks high→low within each), then order the suit groups so
  // adjacent groups alternate color when possible — no red suit next to a red,
  // no black next to a black. Interleave by color, leading with the larger pile
  // so any unavoidable same-color leftover lands at the end.
  const bySuit = {};
  for (const c of hand) (bySuit[c.suit] || (bySuit[c.suit] = [])).push(c);
  for (const s in bySuit) bySuit[s].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
  const blacks = ['spades', 'clubs'].filter(s => bySuit[s]);
  const reds = ['hearts', 'diamonds'].filter(s => bySuit[s]);
  let a = blacks, b = reds;
  if (b.length > a.length) [a, b] = [b, a];
  const order = [];
  for (let i = 0; i < a.length; i++) { order.push(a[i]); if (i < b.length) order.push(b[i]); }
  hand.length = 0;
  for (const s of order) for (const c of bySuit[s]) hand.push(c);
}

// ─── Bidding ───
function getValidBids(cardsPerPlayer, existingBids, last) {
  const all = [];
  for (let i = 0; i <= cardsPerPlayer; i++) all.push(i);
  if (!last) return {valid: all, forbidden: null};
  const sum = existingBids.reduce((a, b) => a + (b ?? 0), 0);
  const forbidden = cardsPerPlayer - sum;
  return {
    valid: all.filter(b => b !== forbidden),
    forbidden: (forbidden >= 0 && forbidden <= cardsPerPlayer) ? forbidden : null
  };
}

function isLastBidder() {
  return G.bids.filter(b => b !== null).length === G.numPlayers - 1;
}

function placeBid(playerIndex, bid) {
  G.bids[playerIndex] = bid;
  logBid(playerIndex, bid);
  gameEffects.sfxBid();
  if (G.bids.filter(b => b !== null).length === G.numPlayers) {
    G.biddingComplete = true;
    G.trickLeaderIndex = (G.dealerIndex + 1) % G.numPlayers;
    G.phase = 'playing';
    gameEffects.renderAll();
    scheduleNextPlay();
    return;
  }
  G.currentBidderIndex = nextPlayer(playerIndex);
  gameEffects.renderAll();
  if (G.currentBidderIndex !== 0) {
    setTimeout(processAIBid, 600);
  } else gameEffects.checkAutoBid();
}

function nextPlayer(p) {
  return (p + 1) % G.numPlayers;
}

function processAIBid() {
  if (G.phase !== 'bidding') return;
  const p = G.currentBidderIndex;
  if (p === 0) return;
  const style = getStyle(p);
  const apply = bid => {
    if (G.phase !== 'bidding' || G.currentBidderIndex !== p) return;
    placeBid(p, bid);
  };
  if (style === 'gemini') geminiComputeBid(p).then(apply);
  else if (style === 'jev') jevComputeBid(p).then(apply);
  else placeBid(p, computeAIBid(p));
}

// ═══════════════════════════════════════════════════════════════════
//  SHARED AI INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════

// ─── Card Counting ───
function getCardsStillOut(hand) {
  const known = new Set();
  for (const c of hand) known.add(c.rank + c.suit);
  for (const c of G.playedCards) known.add(c.rank + c.suit);
  if (G.trumpCard) known.add(G.trumpCard.rank + G.trumpCard.suit);
  return G.fullDeck.filter(c => !known.has(c.rank + c.suit));
}

function isHighestRemaining(card, hand) {
  const out = getCardsStillOut(hand);
  return !out.some(c => c.suit === card.suit && RANK_VALUE[c.rank] > RANK_VALUE[card.rank]);
}

// ─── Suit helpers ───
function suitCards(hand, suit) {
  return hand.filter(c => c.suit === suit).sort((a,b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
}
function suitLen(hand, suit) {
  return hand.filter(c => c.suit === suit).length;
}
function shortestNonTrumpSuit(hand) {
  let best = null, bestLen = 99;
  for (const s of SUITS) {
    if (s === G.trumpSuit) continue;
    const len = suitLen(hand, s);
    if (len > 0 && len < bestLen) { bestLen = len; best = s; }
  }
  return best;
}
function longestNonTrumpSuit(hand) {
  let best = null, bestLen = 0;
  for (const s of SUITS) {
    if (s === G.trumpSuit) continue;
    const len = suitLen(hand, s);
    if (len > bestLen) { bestLen = len; best = s; }
  }
  return best;
}

// ─── Opponent bid status ───
function oppStatus() {
  const opps = [];
  for (let i = 0; i < G.numPlayers; i++) {
    const bid = G.bids[i]; if (bid === null) continue;
    const won = G.tricksWon[i];
    const rem = G.hands[i].length;
    const needed = bid - won;
    opps.push({
      idx: i, bid, won, needed, rem,
      isExact: needed === 0,
      isDesperate: needed > 0 && needed === rem,
      isBlown: needed < 0 || needed > rem,
      canMake: needed >= 0 && needed <= rem,
    });
  }
  return opps;
}

// ─── Per-Suit Status (called once per decision) ───
function getSuitStatus(hand) {
  const out = getCardsStillOut(hand);
  const status = {};
  for (const s of SUITS) {
    const inHand = hand.filter(c => c.suit === s).sort((a,b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
    const played = G.playedCards.filter(c => c.suit === s);
    const remaining = out.filter(c => c.suit === s);
    const myHighest = inHand[0] || null;
    const highestOut = remaining.length > 0
      ? remaining.reduce((best, c) => RANK_VALUE[c.rank] > RANK_VALUE[best.rank] ? c : best)
      : null;
    status[s] = {
      inHand,
      played,
      remaining,                    // unknown cards of this suit still out
      totalInDeck: G.numPlayers * 2, // 8 per suit in 4p
      myHighest,
      highestOut,
      isMaster: myHighest && !highestOut || (myHighest && highestOut && RANK_VALUE[myHighest.rank] > RANK_VALUE[highestOut.rank]),
      numHigherOut: myHighest ? remaining.filter(c => RANK_VALUE[c.rank] > RANK_VALUE[myHighest.rank]).length : 0,
      isVoid: inHand.length === 0,
      isSingleton: inHand.length === 1,
      hasAce: inHand.some(c => c.rank === 'A'),
      hasKing: inHand.some(c => c.rank === 'K'),
      hasQueen: inHand.some(c => c.rank === 'Q'),
      hasAK: inHand.some(c => c.rank === 'A') && inHand.some(c => c.rank === 'K'),
      hasKQ: inHand.some(c => c.rank === 'K') && inHand.some(c => c.rank === 'Q'),
    };
  }
  status.trumpsRemaining = G.trumpSuit ? status[G.trumpSuit].remaining.length : 0;
  return status;
}

// ─── Probability Engine ───

// P(card wins the trick) considering position, remaining cards, known voids
function cardWinProbability(card, hand, trickPos, ledSuit) {
  const ss = getSuitStatus(hand);
  const numPlayers = G.numPlayers;

  // Last to play: perfect info — can we beat what's on the table?
  if (trickPos === numPlayers - 1 && G.currentTrick.length > 0) {
    const winner = currentWinner();
    return cardBeats(card, winner.card, ledSuit) ? 1.0 : 0.0;
  }

  // Leading (trickPos === 0): estimate P(no one beats this card)
  if (trickPos === 0 || !ledSuit) {
    const suit = card.suit;
    const higherOut = ss[suit].remaining.filter(c => RANK_VALUE[c.rank] > RANK_VALUE[card.rank]).length;
    const totalOut = ss[suit].remaining.length;
    const playersToAct = numPlayers - 1;

    if (higherOut === 0 && (!G.trumpSuit || suit === G.trumpSuit || ss.trumpsRemaining === 0)) {
      return 1.0; // Master card, no trump threat
    }

    // P(no single opponent has a higher card)
    // Each opponent's chance of having a specific card ≈ cardsInHand / totalUnknown
    const totalUnknown = getCardsStillOut(hand).length;
    const opponentHandSize = hand.length; // approx same for all

    // P(a specific higher card is held by at least one opponent) ≈ 1 - (1 - handSize/totalUnknown)^playersToAct
    // P(none have ANY higher card) = product over each higher card of P(no one has it)
    let pNoHigher = 1.0;
    for (let i = 0; i < higherOut; i++) {
      const pOneHasIt = 1 - Math.pow(1 - opponentHandSize / Math.max(1, totalUnknown), playersToAct);
      pNoHigher *= (1 - pOneHasIt);
    }

    // Adjust for trump threat on non-trump leads
    if (G.trumpSuit && suit !== G.trumpSuit) {
      // Check known voids — if any opponent is void in this suit, they'll trump
      let pTrumped = 0;
      for (let i = 0; i < numPlayers; i++) {
        if (G.knownVoids[i] && G.knownVoids[i][suit] && ss.trumpsRemaining > 0) {
          pTrumped = Math.min(1, pTrumped + 0.3); // each known-void opponent adds risk
        }
      }
      // Also estimate trumping from unknown voids based on suit depletion
      const suitCardsDealt = ss[suit].totalInDeck;
      const suitCardsGone = ss[suit].played.length + ss[suit].inHand.length;
      if (suitCardsGone > suitCardsDealt * 0.6) {
        pTrumped = Math.min(1, pTrumped + 0.15); // suit is running out, trumping likely
      }
      pNoHigher *= (1 - pTrumped);
    }

    return Math.max(0, Math.min(1, pNoHigher));
  }

  // Following (trickPos 1-2): can we beat the current winner?
  if (G.currentTrick.length > 0) {
    const winner = currentWinner();
    if (!cardBeats(card, winner.card, ledSuit)) return 0.0;

    // We can beat it, but can someone after us beat us?
    const playersLeft = numPlayers - 1 - trickPos;
    if (playersLeft === 0) return 1.0; // we're last

    // How many cards out there beat ours?
    const effectiveSuit = card.suit === G.trumpSuit ? G.trumpSuit : ledSuit;
    const higherOut = getCardsStillOut(hand).filter(c => cardBeats(c, card, ledSuit)).length;
    const totalUnknown = getCardsStillOut(hand).length;
    const oppHandSize = hand.length;

    let pHolds = 1.0;
    for (let i = 0; i < higherOut; i++) {
      const pOneHas = 1 - Math.pow(1 - oppHandSize / Math.max(1, totalUnknown), playersLeft);
      pHolds *= (1 - pOneHas);
    }
    return Math.max(0, Math.min(1, pHolds));
  }

  return 0.5; // fallback
}

// Expected value of playing a card given our bid target
function evaluatePlay(card, hand, bid, won, trickPos, ledSuit) {
  const pWin = cardWinProbability(card, hand, trickPos, ledSuit);
  const needed = bid - won;
  const remaining = hand.length;
  const ss = getSuitStatus(hand);

  let ev = 0;

  if (needed > 0) {
    // Need tricks: winning is good
    ev = pWin * 1.0 - (1 - pWin) * 0.1;
    // Bonus for sure winners: prefer to cash guaranteed tricks early
    if (pWin > 0.95) ev += 0.3;
    // If desperate (need every remaining trick): strongly prefer high P(win)
    if (needed >= remaining) ev += pWin * 0.5;
  } else if (needed === 0) {
    // Exact: winning is bad, losing is good
    ev = (1 - pWin) * 1.0 - pWin * 1.5;
    // Bonus for shedding dangerous cards — high-value losers are good
    if (pWin < 0.1) ev += RANK_VALUE[card.rank] / 14 * 0.3; // shed high cards safely
  } else {
    // Over-bid: strongly avoid winning
    ev = -pWin * 2.0;
  }

  // Positional bonus: voiding a suit enables future trumping
  if (G.trumpSuit && card.suit !== G.trumpSuit) {
    const suitLen = ss[card.suit].inHand.length;
    if (suitLen === 1 && needed > 0 && ss[G.trumpSuit].inHand.length > 0) {
      ev += 0.2; // playing last card in suit creates a useful void
    }
  }

  return ev;
}

// Rank all legal plays by expected value
function rankPlays(legalMoves, hand, bid, won, trickPos, ledSuit) {
  return legalMoves.map(card => ({
    card,
    ev: evaluatePlay(card, hand, bid, won, trickPos, ledSuit),
    pWin: cardWinProbability(card, hand, trickPos, ledSuit),
  })).sort((a, b) => b.ev - a.ev);
}

// ─── Opponent Analysis ───
function analyzeOpponents(playerIndex) {
  const opponents = [];
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === playerIndex) continue;
    const bid = G.bids[i];
    if (bid === null) { opponents.push({idx: i, bid: null}); continue; }
    const won = G.tricksWon[i];
    const remaining = G.hands[i].length;
    const needed = bid - won;
    const stats = G.opponentStats[i];
    opponents.push({
      idx: i, bid, won, needed, remaining,
      canMakeBid: needed >= 0 && needed <= remaining,
      isBlown: needed < 0 || needed > remaining,
      isExact: needed === 0,                           // will duck everything
      isDesperate: needed > 0 && needed === remaining,  // must win all remaining
      voids: G.knownVoids[i] || {},
      bidAccuracy: stats && stats.bids >= 3 ? stats.made / stats.bids : 0.5,
    });
  }
  return opponents;
}

// ─── 1-Card Round Win Probability (from index2.html) ───
// Exact 1-card win probability using hypergeometric formula:
// P(win when leading) = C(pool - beaters, K) / C(pool, K)
// where pool = deck - 1, K = opponents, beaters = cards that beat ours
function compute1CardWinProb(card, numPlayers, trumpSuit) {
  const val = RANK_VALUE[card.rank];
  const isTrump = trumpSuit && card.suit === trumpSuit;
  const ranksPerSuit = numPlayers * 2;
  const usedRanks = ALL_RANKS.slice(0, ranksPerSuit);
  const deckSize = ranksPerSuit * 4;
  const pool = deckSize - 1; // all cards except ours
  const K = numPlayers - 1;  // opponents

  // Count cards in pool that beat ours (when we lead our suit)
  let beaters = 0;
  for (const s of SUITS) {
    for (const r of usedRanks) {
      if (s === card.suit && r === card.rank) continue; // skip our card
      const v = RANK_VALUE[r];
      if (trumpSuit) {
        if (s === trumpSuit && card.suit !== trumpSuit) { beaters++; continue; }
        if (s !== trumpSuit && card.suit === trumpSuit) continue;
        if (s === trumpSuit && card.suit === trumpSuit && v > val) { beaters++; continue; }
      }
      // Same suit, higher rank
      if (s === card.suit && v > val) beaters++;
    }
  }

  // P(none of K opponents has a beater) = C(pool-beaters, K) / C(pool, K)
  if (pool - beaters < K) return 0;
  return _comb(pool - beaters, K) / _comb(pool, K);
}

// Binomial coefficient C(n, k)
function _comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

// ─── Multi-trick Planner (skill >= 5: Boris+) ───
function planTricks(hand, bid, tricksWon) {
  const needed = bid - tricksWon;
  const sureWinners = hand.filter(c => isHighestRemaining(c, hand));
  const sureLosers = hand.filter(c => !sureWinners.includes(c));

  if (needed <= 0) return { strategy: 'duck', sureWinners, sureLosers };
  if (needed <= sureWinners.length) return { strategy: 'cash-then-duck', sureWinners, sureLosers };
  if (needed > hand.length) return { strategy: 'desperate', sureWinners, sureLosers };
  return { strategy: 'speculate', sureWinners, sureLosers, deficit: needed - sureWinners.length };
}

// ═══════════════════════════════════════════════════════════════════
//  PIMC ENGINE — Perfect Information Monte Carlo
// ═══════════════════════════════════════════════════════════════════

// Fast play-out: simulate remaining tricks with position-aware rules.
// Position-aware: 2nd-hand low, last-hand decisive, suit establishment, trump conservation.
// spiteTarget: if defined, player index whose tricks we want to deny when already made.
function simPlayOut(hands, bids, tricksWon, trumpSuit, leader, numPlayers, spiteTarget) {
  const h = hands.map(hand => hand.slice());
  const tw = tricksWon.slice();
  let ld = leader;

  const maxTricks = Math.max(...h.map(hh => hh.length));
  for (let t = 0; t < maxTricks; t++) {
    if (!h[ld] || h[ld].length === 0) break;
    const trick = [];
    let cur = ld;

    for (let p = 0; p < numPlayers; p++) {
      if (!h[cur] || h[cur].length === 0) { cur = (cur + 1) % numPlayers; continue; }
      const ls = trick.length > 0 ? trick[0].card.suit : null;
      const pos = trick.length;
      const isLast = pos === numPlayers - 1;

      // Legal moves
      let legal = h[cur];
      if (ls) {
        const follow = legal.filter(c => c.suit === ls);
        if (follow.length > 0) legal = follow;
        else if (trumpSuit) {
          const trumps = legal.filter(c => c.suit === trumpSuit);
          if (trumps.length > 0) legal = trumps;
        }
      }

      const need = tw[cur] < (bids[cur] || 0);
      const made = !need;
      const curBest = trick.length > 0
        ? trick.reduce((b, t) => cardBeats(t.card, b.card, ls) ? t : b)
        : null;
      const myWinners = curBest
        ? legal.filter(c => cardBeats(c, curBest.card, ls))
        : legal.slice();

      let card;
      if (!ls) {
        // ── Leading ──
        if (need) {
          // Cash aces first
          const aces = legal.filter(c => c.rank === 'A');
          if (aces.length) {
            card = aces[0];
          } else {
            // Lead from longest non-trump suit to establish
            let bestSuit = null, bestLen = 0;
            for (const s of SUITS) {
              if (s === trumpSuit) continue;
              const len = legal.filter(c => c.suit === s).length;
              if (len > bestLen) { bestLen = len; bestSuit = s; }
            }
            if (bestSuit && bestLen >= 3) {
              const inSuit = legal.filter(c => c.suit === bestSuit);
              card = inSuit.reduce((b, c) => RANK_VALUE[c.rank] > RANK_VALUE[b.rank] ? c : b);
            } else {
              // Lead shortest non-trump to create void
              let shortSuit = null, shortLen = 99;
              for (const s of SUITS) {
                if (s === trumpSuit) continue;
                const len = legal.filter(c => c.suit === s).length;
                if (len > 0 && len < shortLen) { shortLen = len; shortSuit = s; }
              }
              const pool = shortSuit ? legal.filter(c => c.suit === shortSuit) : legal;
              card = pool.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
            }
          }
        } else {
          card = legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
        }
      } else {
        // ── Following ──
        if (need) {
          if (myWinners.length > 0) {
            if (isLast) {
              // Cheapest winner when last
              card = myWinners.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
            } else {
              // Not last: only win with a good winner (rank>=10 or trump), else duck
              const goodWinners = myWinners.filter(c => RANK_VALUE[c.rank] >= 10 || c.suit === trumpSuit);
              if (goodWinners.length > 0) {
                card = goodWinners.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
              } else {
                card = legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
              }
            }
          } else {
            // Can't win — dump lowest
            card = legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
          }
        } else if (made && spiteTarget !== undefined && curBest && curBest.player === spiteTarget && myWinners.length > 0) {
          // Spite: beat spiteTarget if they're currently winning and we can
          card = myWinners.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
        } else {
          // Don't need tricks: play lowest non-winner
          const nonWinners = curBest
            ? legal.filter(c => !cardBeats(c, curBest.card, ls))
            : legal;
          const pool = nonWinners.length > 0 ? nonWinners : legal;
          card = pool.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
        }
      }

      h[cur] = h[cur].filter(c => !(c.rank === card.rank && c.suit === card.suit));
      trick.push({player: cur, card});
      cur = (cur + 1) % numPlayers;
    }

    if (trick.length === 0) break;
    const ls2 = trick[0].card.suit;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) {
      if (cardBeats(trick[i].card, best.card, ls2)) best = trick[i];
    }
    tw[best.player]++;
    ld = best.player;
  }

  return tw;
}

// Score a simulation result: my score minus weighted best opponent score
function simScore(playerIndex, tricksWon, bids) {
  const myBid = bids[playerIndex];
  const myWon = tricksWon[playerIndex];
  let myScore = scoreRound(myWon, myBid);

  let bestOpp = -Infinity;
  for (let i = 0; i < bids.length; i++) {
    if (i === playerIndex || bids[i] === null) continue;
    const oppScore = scoreRound(tricksWon[i], bids[i]);
    bestOpp = Math.max(bestOpp, oppScore);
  }

  return myScore - 0.3 * (bestOpp > -Infinity ? bestOpp : 0);
}

// Find the opponent closest to making their bid (the most dangerous threat)
function findSpiteTarget(playerIndex) {
  let tgt = -1, minGap = Infinity;
  for (let i = 0; i < G.bids.length; i++) {
    if (i === playerIndex || G.bids[i] === null) continue;
    const gap = (G.bids[i] || 0) - G.tricksWon[i];
    if (gap > 0 && gap < minGap) { minGap = gap; tgt = i; }
  }
  return tgt >= 0 ? tgt : undefined;
}

// Sample opponent hands from unknown cards, weighted by their bids
function sampleOpponentHands(myHand, playerIndex) {
  const unknown = getCardsStillOut(myHand);
  const np = G.numPlayers;
  const cardsNeeded = G.hands.map(h => h.length); // cards per opponent

  // Weighted shuffle: high bidders get strong cards
  const shuffled = unknown.slice();
  // Sort by strength with randomized bid-weighting
  shuffled.sort((a, b) => {
    const sa = RANK_VALUE[a.rank] + Math.random() * 5;
    const sb = RANK_VALUE[b.rank] + Math.random() * 5;
    return sb - sa; // strongest first
  });

  // Deal cards: give stronger cards to higher bidders
  const oppHands = {};
  const oppList = [];
  for (let i = 0; i < np; i++) {
    if (i === playerIndex) continue;
    oppHands[i] = [];
    const bid = G.bids[i] || 0;
    oppList.push({idx: i, bid, need: cardsNeeded[i]});
  }

  // Sort opponents by bid (highest first = gets first pick of strong cards)
  oppList.sort((a, b) => b.bid - a.bid);

  // Round-robin deal from the shuffled deck
  let cardIdx = 0;
  let round = 0;
  const maxRounds = Math.max(...oppList.map(o => o.need));
  for (let r = 0; r < maxRounds; r++) {
    for (const opp of oppList) {
      if (oppHands[opp.idx].length >= opp.need) continue;
      if (cardIdx >= shuffled.length) break;

      // Check known voids — don't give this card to a void opponent
      const card = shuffled[cardIdx];
      if (G.knownVoids[opp.idx] && G.knownVoids[opp.idx][card.suit]) {
        // Find a non-void card to swap with
        let swapped = false;
        for (let j = cardIdx + 1; j < shuffled.length; j++) {
          if (!G.knownVoids[opp.idx] || !G.knownVoids[opp.idx][shuffled[j].suit]) {
            [shuffled[cardIdx], shuffled[j]] = [shuffled[j], shuffled[cardIdx]];
            swapped = true;
            break;
          }
        }
        if (!swapped && cardIdx < shuffled.length) {
          // Can't avoid void — just deal it anyway
        }
      }

      oppHands[opp.idx].push(shuffled[cardIdx]);
      cardIdx++;
    }
  }

  return oppHands;
}

// Codex samples legal hidden hands uniformly, then weights each world by how
// well its remaining strength explains the bids already seen.
function codexEstimateHandTricks(hand) {
  let estimate = 0;
  const trumpCount = G.trumpSuit ? hand.filter(c => c.suit === G.trumpSuit).length : 0;
  for (const suit of SUITS) {
    const cards = hand.filter(c => c.suit === suit);
    if (!cards.length) continue;
    const ranks = new Set(cards.map(c => c.rank));
    const isTrump = suit === G.trumpSuit;
    for (const card of cards) {
      if (isTrump) estimate += ({A:0.96,K:0.82,Q:0.64,J:0.48,'10':0.34,'9':0.23}[card.rank] || 0.13);
      else if (card.rank === 'A') estimate += G.trumpSuit ? 0.82 : 0.93;
      else if (card.rank === 'K') estimate += (ranks.has('A') ? 0.55 : 0.34) * (G.trumpSuit ? 0.82 : 1);
      else if (card.rank === 'Q') estimate += (ranks.has('A') || ranks.has('K') ? 0.28 : 0.10) * (G.trumpSuit ? 0.82 : 1);
      else if (card.rank === 'J') estimate += (ranks.has('A') && ranks.has('K') ? 0.14 : 0.04) * (G.trumpSuit ? 0.82 : 1);
    }
    if (isTrump && cards.length > 1) estimate += 0.08 * (cards.length - 1);
  }
  if (G.trumpSuit && trumpCount) {
    for (const suit of SUITS) {
      if (suit === G.trumpSuit) continue;
      const len = hand.filter(c => c.suit === suit).length;
      if (len === 0) estimate += 0.24 * Math.min(trumpCount, 2);
      else if (len === 1 && hand.length >= 3) estimate += 0.08;
    }
  }
  const comp = Math.max(0.62, 1 - (G.numPlayers - 2) * 0.08);
  const scale = CODEX_CFG.strengthScale[G.numPlayers]?.[G.cardsPerPlayer] || 1;
  return estimate * comp * scale;
}

function codexSampleOpponentHands(myHand, playerIndex) {
  const remaining = getCardsStillOut(myHand);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const opponents = [];
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === playerIndex) continue;
    const voidCount = Object.values(G.knownVoids[i] || {}).filter(Boolean).length;
    opponents.push({idx:i, need:G.hands[i].length, voidCount, hand:[]});
  }
  opponents.sort((a,b) => b.voidCount - a.voidCount || Math.random() - 0.5);
  for (const opponent of opponents) {
    for (let slot = 0; slot < opponent.need; slot++) {
      const allowed = [];
      for (let i = 0; i < remaining.length; i++) {
        if (!G.knownVoids[opponent.idx]?.[remaining[i].suit]) allowed.push(i);
      }
      if (!allowed.length) return sampleOpponentHands(myHand, playerIndex);
      const pick = allowed[Math.floor(Math.random() * allowed.length)];
      opponent.hand.push(remaining[pick]);
      remaining.splice(pick, 1);
    }
  }
  const hands = {};
  for (const opponent of opponents) hands[opponent.idx] = opponent.hand;
  return hands;
}

function codexSampleWorld(myHand, playerIndex) {
  const hands = codexSampleOpponentHands(myHand, playerIndex);
  let logWeight = 0;
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === playerIndex || G.bids[i] === null) continue;
    const expected = (G.tricksWon[i] || 0) + codexEstimateHandTricks(hands[i] || []);
    const sigma = CODEX_CFG.posteriorSigma * (i === G.dealerIndex ? 1.35 : 1);
    const diff = expected - G.bids[i];
    logWeight -= diff * diff / (2 * sigma * sigma);
  }
  return {hands, weight:Math.exp(Math.max(-9, logWeight))};
}

function codexSimScore(playerIndex, tricksWon, bids) {
  const myRound = scoreRound(tricksWon[playerIndex], bids[playerIndex] || 0);
  const progress = G.roundSequence.length > 1
    ? G.currentRoundIndex / (G.roundSequence.length - 1) : 0;
  const pressure = CODEX_CFG.matchWeight * progress * progress;
  const myTotal = G.scores[playerIndex] + myRound;
  let bestOpponent = -Infinity;
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === playerIndex) continue;
    bestOpponent = Math.max(bestOpponent, G.scores[i] + scoreRound(tricksWon[i], bids[i] || 0));
  }
  return myRound + pressure * (myTotal - bestOpponent);
}

function codexOneCardWinProb(playerIndex) {
  const myCard = G.hands[playerIndex][0];
  const pool = getCardsStillOut(G.hands[playerIndex]);
  const leader = (G.dealerIndex + 1) % G.numPlayers;
  let weightedWins = 0, totalWeight = 0;
  for (let sim = 0; sim < CODEX_CFG.oneCardSims; sim++) {
    const cards = pool.slice();
    for (let i = 0; i < G.numPlayers - 1; i++) {
      const j = i + Math.floor(Math.random() * (cards.length - i));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const trick = [], seatCards = new Array(G.numPlayers);
    let oi = 0;
    for (let offset = 0; offset < G.numPlayers; offset++) {
      const player = (leader + offset) % G.numPlayers;
      const card = player === playerIndex ? myCard : cards[oi++];
      seatCards[player] = card;
      trick.push({playerIndex:player, card});
    }
    const ledSuit = trick[0].card.suit;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) if (cardBeats(trick[i].card, best.card, ledSuit)) best = trick[i];
    let weight = 1;
    for (let player = 0; player < G.numPlayers; player++) {
      if (player === playerIndex || G.bids[player] === null) continue;
      const profile = PLAYERS[G.playerNames[player]];
      if (!profile || profile.style === 'gemini' || profile.style === 'codex' || profile.style === 'jev') continue;
      const noise = profile.noise || 0.1;
      const estimate = compute1CardWinProb(seatCards[player], G.numPlayers, G.trumpSuit);
      const pOne = Math.max(0, Math.min(1, (estimate + noise / 2 - 0.5) / noise));
      weight *= Math.max(0.02, G.bids[player] === 1 ? pOne : 1 - pOne);
    }
    totalWeight += weight;
    if (best.playerIndex === playerIndex) weightedWins += weight;
  }
  return totalWeight > 0 ? weightedWins / totalWeight : 0;
}

// ─── Grok true endgame (≤2 cards): tree search under sampled worlds ───
// Each player selfishly maximizes own scoreRound. Depth is n×≤2 tricks.
// Spite: scores a simulated round as its own points minus a share of every
// opponent's points, weighted by how much that opponent threatens it in the
// standings (leaders and close rivals count most, players far behind barely
// count). Breaking a big contract - a geometric 5-bid is worth 20 to its owner -
// is worth giving up some of its own. Active from the first card, not only
// after making its own bid.
const SPITE_CFG = { weight: 0.5, scale: 20, min: 0.25, max: 2 };
function spiteThreat(me, i) {
  const gap = (G.scores[i] || 0) - (G.scores[me] || 0); // > 0: they are ahead of Spite
  return Math.max(SPITE_CFG.min, Math.min(SPITE_CFG.max, 1 + gap / SPITE_CFG.scale));
}
function spiteSimScore(playerIndex, tricksWon, bids) {
  let sc = scoreRound(tricksWon[playerIndex], bids[playerIndex] || 0);
  for (let i = 0; i < bids.length; i++) {
    if (i === playerIndex || bids[i] === null || bids[i] === undefined) continue;
    sc -= SPITE_CFG.weight * spiteThreat(playerIndex, i) * scoreRound(tricksWon[i], bids[i]);
  }
  return sc;
}
// Value of a finished endgame line for the searching player
function endgameValue(tw, bids, me, spite) {
  if (getStyle(me) === 'spite') return spiteSimScore(me, tw, bids);
  let sc = scoreRound(tw[me], bids[me] || 0);
  if (spite !== undefined && tw[spite] !== (bids[spite] || 0)) sc += GROK_CFG.spiteBonus;
  return sc;
}

function grokEndgameSearch(hands, bids, tw, trumpSuit, leader, numPlayers, trick, me, spite) {
  const anyLeft = hands.some(h => h.length > 0);
  if (!anyLeft && trick.length === 0) {
    return { score: endgameValue(tw, bids, me, spite), tw };
  }

  if (trick.length === numPlayers) {
    const ls = trick[0].card.suit;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) {
      if (cardBeats(trick[i].card, best.card, ls)) best = trick[i];
    }
    const tw2 = tw.slice();
    tw2[best.player]++;
    return grokEndgameSearch(hands, bids, tw2, trumpSuit, best.player, numPlayers, [], me, spite);
  }

  const cur = trick.length === 0 ? leader : (trick[trick.length - 1].player + 1) % numPlayers;
  if (!hands[cur] || hands[cur].length === 0) {
    if (trick.length === 0) {
      return grokEndgameSearch(hands, bids, tw, trumpSuit, (leader + 1) % numPlayers, numPlayers, [], me, spite);
    }
  }

  const ls = trick.length > 0 ? trick[0].card.suit : null;
  let legal = hands[cur] ? hands[cur].slice() : [];
  if (ls) {
    const follow = legal.filter(c => c.suit === ls);
    if (follow.length > 0) legal = follow;
    else if (trumpSuit) {
      const trumps = legal.filter(c => c.suit === trumpSuit);
      if (trumps.length > 0) legal = trumps;
    }
  }
  if (!legal.length) {
    return { score: endgameValue(tw, bids, me, spite), tw };
  }

  let bestScore = -Infinity;
  let bestTw = tw;
  for (const card of legal) {
    const h2 = hands.map(h => h.slice());
    const idx = h2[cur].findIndex(c => c.rank === card.rank && c.suit === card.suit);
    if (idx >= 0) h2[cur].splice(idx, 1);
    const t2 = trick.concat([{ player: cur, card }]);
    const res = grokEndgameSearch(h2, bids, tw, trumpSuit, leader, numPlayers, t2, me, spite);
    const val = cur === me ? res.score : scoreRound(res.tw[cur], bids[cur] || 0);
    if (val > bestScore) {
      bestScore = val;
      bestTw = res.tw;
    }
  }

  return { score: endgameValue(bestTw, bids, me, spite), tw: bestTw };
}

function grokEndgameChooseCard(playerIndex, legalMoves) {
  if (legalMoves.length === 1) return legalMoves[0];
  const alreadyMade = G.tricksWon[playerIndex] >= (G.bids[playerIndex] || 0);
  const spite = alreadyMade ? findSpiteTarget(playerIndex) : undefined;
  const scores = endgameCardScores(playerIndex, legalMoves, spite);

  let bestCard = legalMoves[0], bestScore = -Infinity;
  for (const c of legalMoves) {
    if (scores[c.rank + c.suit] > bestScore) {
      bestScore = scores[c.rank + c.suit];
      bestCard = c;
    }
  }
  return bestCard;
}

// Summed exact-search value of each legal card over sampled deals
function endgameCardScores(playerIndex, legalMoves, spite) {
  const hand = G.hands[playerIndex];
  const scores = {};
  for (const c of legalMoves) scores[c.rank + c.suit] = 0;

  for (let s = 0; s < GROK_CFG.endgameSamples; s++) {
    const oppHands = sampleOpponentHands(hand, playerIndex);
    for (const card of legalMoves) {
      const allHands = [];
      for (let i = 0; i < G.numPlayers; i++) {
        if (i === playerIndex) {
          allHands.push(hand.filter(c => !(c.rank === card.rank && c.suit === card.suit)));
        } else {
          allHands.push((oppHands[i] || []).slice());
        }
      }
      // Normalize current trick to {player, card}
      const trick = G.currentTrick.map(t => ({
        player: t.playerIndex !== undefined ? t.playerIndex : t.player,
        card: t.card
      }));
      trick.push({ player: playerIndex, card });
      const res = grokEndgameSearch(
        allHands, G.bids, G.tricksWon.slice(), G.trumpSuit,
        G.trickLeaderIndex, G.numPlayers, trick, playerIndex, spite
      );
      scores[card.rank + card.suit] += res.score;
    }
  }

  return scores;
}

// PIMC: choose the best card to play via simulation
function pimcChooseCard(playerIndex, legalMoves, numSims) {
  if (legalMoves.length === 1) return legalMoves[0];

  // Grok endgame: true tree search instead of more PIMC
  if ((getStyle(playerIndex) === 'grok' || getPlayer(playerIndex).v2) &&
      G.hands[playerIndex].length <= GROK_CFG.endgameMaxCards) {
    return grokEndgameChooseCard(playerIndex, legalMoves);
  }

  // Spite: when already made, target the opponent closest to making their bid
  const alreadyMade = G.tricksWon[playerIndex] >= (G.bids[playerIndex] || 0);
  const spite = alreadyMade ? findSpiteTarget(playerIndex) : undefined;
  const isGrok = getStyle(playerIndex) === 'grok';
  const isCodex = getStyle(playerIndex) === 'codex';
  const isSpite = getStyle(playerIndex) === 'spite';
  const scores = pimcCardScores(playerIndex, legalMoves, numSims, result => {
    let sc = isCodex ? codexSimScore(playerIndex, result, G.bids) : isSpite ? spiteSimScore(playerIndex, result, G.bids) : simScore(playerIndex, result, G.bids);
    if (!isSpite && spite !== undefined && result[spite] !== G.bids[spite]) {
      sc += isCodex ? CODEX_CFG.spiteBonus : (isGrok ? GROK_CFG.spiteBonus : 2.0);
    }
    return sc;
  }, spite);

  // Pick card with best average score
  let bestCard = legalMoves[0], bestScore = -Infinity;
  for (const c of legalMoves) {
    if (scores[c.rank + c.suit] > bestScore) {
      bestScore = scores[c.rank + c.suit];
      bestCard = c;
    }
  }
  return bestCard;
}

// Summed simulated value of each legal card for playerIndex: sampled deals,
// the strong bots' in-trick replies, then playouts of the rest of the round,
// each scored by scoreOf(tricks taken by everyone). spite steers the playouts.
function pimcCardScores(playerIndex, legalMoves, numSims, scoreOf, spite) {
  const hand = G.hands[playerIndex];
  const scores = {};
  for (const c of legalMoves) scores[c.rank + c.suit] = 0;
  const isCodex = getStyle(playerIndex) === 'codex';
  const smartTrick = getStyle(playerIndex) === 'grok' || isCodex || !!getPlayer(playerIndex).v2;

  for (let sim = 0; sim < numSims; sim++) {
    const sampled = isCodex
      ? codexSampleWorld(hand, playerIndex)
      : {hands:sampleOpponentHands(hand, playerIndex), weight:1};
    const oppHands = sampled.hands;

    for (const card of legalMoves) {
      // Build complete hands array
      const allHands = [];
      for (let i = 0; i < G.numPlayers; i++) {
        if (i === playerIndex) {
          allHands.push(hand.filter(c => !(c.rank === card.rank && c.suit === card.suit)));
        } else {
          allHands.push(oppHands[i] || []);
        }
      }

      // Play this card into the current trick, then simulate the rest
      const tw = G.tricksWon.slice();
      const trickSoFar = G.currentTrick.slice();
      trickSoFar.push({playerIndex, card});

      let leader = G.trickLeaderIndex;

      if (trickSoFar.length === G.numPlayers) {
        // Trick complete — resolve it
        const ls = trickSoFar[0].card.suit;
        let best = trickSoFar[0];
        for (let i = 1; i < trickSoFar.length; i++) {
          if (cardBeats(trickSoFar[i].card, best.card, ls)) best = trickSoFar[i];
        }
        tw[best.playerIndex]++;
        leader = best.playerIndex;
        // Simulate remaining tricks
        const result = simPlayOut(allHands, G.bids, tw, G.trumpSuit, leader, G.numPlayers, spite);
        scores[card.rank + card.suit] += sampled.weight * scoreOf(result);
      } else {
        // Trick not complete — simulate remaining players in this trick, then rest
        const nextP = (playerIndex + 1) % G.numPlayers;

        // Complete this trick with opponent plays
        let curTrick = trickSoFar.slice();
        let cur = nextP;
        for (let p = curTrick.length; p < G.numPlayers; p++) {
          if (!allHands[cur] || allHands[cur].length === 0) { cur = (cur + 1) % G.numPlayers; continue; }
          const ls = curTrick[0].card.suit;
          let legal = allHands[cur];
          const follow = legal.filter(c => c.suit === ls);
          if (follow.length > 0) legal = follow;
          else if (G.trumpSuit) {
            const trumps = legal.filter(c => c.suit === G.trumpSuit);
            if (trumps.length > 0) legal = trumps;
          }
          const needMore = tw[cur] < (G.bids[cur] || 0);
          const isLast = curTrick.length === G.numPlayers - 1;
          let pick;
          if (smartTrick) {
            // Stronger agents model contract-aware responses within this trick.
            const curB = curTrick.reduce((b, t) => cardBeats(t.card, b.card, ls) ? t : b);
            const wins = legal.filter(c => cardBeats(c, curB.card, ls));
            if (needMore) {
              if (wins.length) {
                const good = wins.filter(c => RANK_VALUE[c.rank] >= 10 || c.suit === G.trumpSuit);
                pick = isLast
                  ? wins.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b)
                  : (good.length
                      ? good.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b)
                      : legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b));
              } else {
                pick = legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
              }
            } else {
              const losers = legal.filter(c => !cardBeats(c, curB.card, ls));
              pick = (losers.length ? losers : legal).reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
            }
          } else {
            pick = needMore
              ? legal.reduce((b, c) => RANK_VALUE[c.rank] > RANK_VALUE[b.rank] ? c : b)
              : legal.reduce((b, c) => RANK_VALUE[c.rank] < RANK_VALUE[b.rank] ? c : b);
          }
          allHands[cur] = allHands[cur].filter(c => !(c.rank === pick.rank && c.suit === pick.suit));
          curTrick.push({playerIndex: cur, card: pick});
          cur = (cur + 1) % G.numPlayers;
        }

        // Resolve this trick
        const ls = curTrick[0].card.suit;
        let best = curTrick[0];
        for (let i = 1; i < curTrick.length; i++) {
          if (cardBeats(curTrick[i].card, best.card, ls)) best = curTrick[i];
        }
        tw[best.playerIndex]++;
        leader = best.playerIndex;

        // Simulate remaining tricks
        const result = simPlayOut(allHands, G.bids, tw, G.trumpSuit, leader, G.numPlayers, spite);
        scores[card.rank + card.suit] += sampled.weight * scoreOf(result);
      }
    }
  }

  return scores;
}

// PIMC: choose the best bid via simulation
function pimcBid(playerIndex, numSims, kappa = 0) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const scores = {};
  for (let b = 0; b <= cpp; b++) scores[b] = 0;
  const isCodex = getStyle(playerIndex) === 'codex';
  let weightSum = 0;

  for (let sim = 0; sim < numSims; sim++) {
    const sampled = isCodex
      ? codexSampleWorld(hand, playerIndex)
      : {hands:sampleOpponentHands(hand, playerIndex), weight:1};
    const oppHands = sampled.hands;
    weightSum += sampled.weight;

    // Build hands array
    const allHands = [];
    for (let i = 0; i < G.numPlayers; i++) {
      if (i === playerIndex) allHands.push(hand.slice());
      else allHands.push(oppHands[i] || []);
    }

    // For each possible bid, simulate the round
    for (let bid = 0; bid <= cpp; bid++) {
      const bids = G.bids.slice();
      bids[playerIndex] = bid;
      // Fill in missing opponent bids with estimate (their cards / 4 rounded)
      for (let i = 0; i < G.numPlayers; i++) {
        if (bids[i] === null) bids[i] = Math.round(allHands[i].length / G.numPlayers);
      }

      const tw = new Array(G.numPlayers).fill(0);
      const leader = (G.dealerIndex + 1) % G.numPlayers;
      const result = simPlayOut(
        allHands.map(h => h.slice()), bids, tw, G.trumpSuit, leader, G.numPlayers
      );

      const myTricks = result[playerIndex];
      const score = scoreRound(myTricks, bid);
      scores[bid] += sampled.weight * score;
    }
  }

  // Pick the bid with the best average score (+ kappa per bid level, see NAMED_CFG)
  const ev = {};
  let bestBid = 0, bestScore = -Infinity;
  for (let b = 0; b <= cpp; b++) {
    ev[b] = weightSum > 0 ? scores[b] / weightSum : 0;
    if (ev[b] + kappa * b > bestScore) { bestScore = ev[b] + kappa * b; bestBid = b; }
  }
  pimcBid.lastEV = ev;
  return bestBid;
}

// Last bidder whose pick is the forbidden total: take the neighbour the
// simulation values more (the old rule always went up, overbidding the table).
function constrainBidEV(bid, cpp, ev, kappa) {
  if (!isLastBidder()) return bid;
  const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
  if (sum + bid !== cpp) return bid;
  const lo = bid - 1, hi = bid + 1;
  if (lo < 0) return hi;
  if (hi > cpp) return lo;
  return (ev[hi] + kappa * hi) > (ev[lo] + kappa * lo) ? hi : lo;
}

// ═══════════════════════════════════════════════════════════════════
//  AI BIDDING — strategy-specific, with PIMC for top players
// ═══════════════════════════════════════════════════════════════════
function computeAIBid(playerIndex) {
  const hand = G.hands[playerIndex];
  const cpp = G.cardsPerPlayer;
  const player = getPlayer(playerIndex);
  const style = player.style;
  const comp = Math.max(0.6, 1.0 - (G.numPlayers - 2) * 0.08);
  let estimate = 0;

  // 1-card rounds: exact probability, not a rounded guess
  if (cpp === 1) {
    if (style === 'grok') {
      estimate = codexOneCardWinProb(playerIndex);
      const bid = estimate > GROK_CFG.oneCardThreshold ? 1 : 0;
      return constrainBid(bid, estimate, cpp);
    }
    if (style === 'codex' || player.v2) {
      estimate = codexOneCardWinProb(playerIndex);
      const bid = estimate > (player.v2 ? NAMED_CFG.oneCardThreshold : CODEX_CFG.oneCardThreshold) ? 1 : 0;
      return constrainBid(bid, estimate, cpp);
    }
    estimate = compute1CardWinProb(hand[0], G.numPlayers, G.trumpSuit);
    estimate += (Math.random() - 0.5) * player.noise;
    return constrainBid(Math.max(0, Math.min(1, Math.round(estimate))), estimate, cpp);
  }

  // Bid-awareness: adjust based on what others have already bid
  function bidAwarenessAdj(est) {
    const otherBids = G.bids.filter(b => b !== null);
    if (otherBids.length === 0) return est;
    const bidSum = otherBids.reduce((a,b)=>a+b,0);
    const fair = cpp / G.numPlayers;
    const avgOther = bidSum / otherBids.length;
    if (avgOther > fair * 1.2) est -= 0.3 + (avgOther - fair * 1.2) * 0.2;
    else if (avgOther < fair * 0.8) est += 0.2 + (fair * 0.8 - avgOther) * 0.15;
    return est;
  }

  // Grok bids from the simulated value itself. A bias added onto the
  // winning integer rarely cleared 0.5, so small and mid hands stayed
  // low, and the geometric +0.6/+1.0 bump overbid every 7- and 8-card hand.
  // The forbidden last bid takes whichever neighbour the sim values more.
  if (style === 'grok' && cpp >= 2) {
    const mode = G.scoringMode === 'geometric' ? 'geometric' : 'linear';
    const k = GROK_CFG.kappa[mode][cpp] || 0;
    const bid = pimcBid(playerIndex, GROK_CFG.bidSims, k);
    return constrainBidEV(bid, cpp, pimcBid.lastEV, k);
  }

  // PIMC bidding for all main styles (multi-card rounds)
  // Bias corrects for sim playout underestimating real trick-taking
  // Bias values tuned from game data: higher = more chronic underbidder
  // PIMC bidding — bias & aggr tuned from 50k-game optimization
  if ((style === 'void' || style === 'tempo' || style === 'sniper' || style === 'precision' || style === 'spite' || style === 'codex') && cpp >= 2) {
    const sims = style === 'codex' ? CODEX_CFG.bidSims : (style === 'tempo' ? 60 : 80);
    if (style === 'codex' && G.scoringMode === 'geometric') {
      // EV already includes the geometric bonus. Adding a trick afterward
      // overbids large hands; resolve a forbidden bid by simulated value too.
      const bid = pimcBid(playerIndex, sims);
      return constrainBidEV(bid, cpp, pimcBid.lastEV, 0);
    }
    if (player.v2) {
      const k = ((player.kappa || NAMED_CFG.kappa)[G.scoringMode === 'geometric' ? 'geometric' : 'linear'][cpp] || 0) + (NAMED_CFG.lean[style] || 0);
      return constrainBidEV(pimcBid(playerIndex, sims, k), cpp, pimcBid.lastEV, k);
    }
    const biasMap = {void: 0.229, tempo: 0.020, sniper: 0.070, precision: 0.165, codex:0};
    const aggrMap = {void: 1.00,  tempo: 1.02,  sniper: 1.00,  precision: 0.98, codex:1};
    const bias = biasMap[style] || 0;
    const aggr = aggrMap[style] || 1.0;
    // Geometric scoring rewards aggression in big rounds (the tri(B) made-bonus
    // dwarfs miss risk) and mild caution in small ones. Additive per-round-size
    // schedule, tuned to maximize geo score/round (see proto_cppbias.mjs). No-op
    // in linear mode. Grok does not use this — see the kappa branch above.
    const geoBias = G.scoringMode === 'geometric'
      ? ({3:-0.2, 4:-0.2, 6:0.2, 7:0.6, 8:1.0}[cpp] || 0) : 0;
    let bid = pimcBid(playerIndex, sims) + bias * Math.min(1, cpp / 4) + geoBias;
    bid = bidAwarenessAdj(bid) * aggr;
    bid = Math.max(0, Math.min(cpp, Math.round(bid)));
    bid = constrainBid(bid, bid, cpp);
    return bid;
  }

  // ── VOID style: values trumps + voids aggressively ──
  if (style === 'void' || style === 'opportunist') {
    const trumps = G.trumpSuit ? suitCards(hand, G.trumpSuit) : [];
    // Each trump is highly valued
    for (const c of trumps) {
      estimate += {14:0.95, 13:0.85, 12:0.65, 11:0.5}[RANK_VALUE[c.rank]] || 0.2;
    }
    // Voids: each void with trumps = aggressive ruffing value
    if (G.trumpSuit) {
      for (const s of SUITS) {
        if (s === G.trumpSuit) continue;
        const len = suitLen(hand, s);
        if (len === 0 && trumps.length > 0) estimate += 0.4 * Math.min(trumps.length, 3);
        else if (len === 1 && trumps.length > 0 && cpp >= 3) estimate += 0.25;
      }
    }
    // Non-trump high cards
    for (const s of SUITS) {
      if (s === G.trumpSuit) continue;
      for (const c of suitCards(hand, s)) {
        if (c.rank === 'A') estimate += 0.5;
        else if (c.rank === 'K') estimate += 0.2;
      }
    }
  }

  // ── TEMPO style: values trump length + aces ──
  else if (style === 'tempo' || style === 'adapter') {
    for (const c of hand) {
      const isTrump = G.trumpSuit && c.suit === G.trumpSuit;
      if (isTrump) {
        estimate += {14:0.95, 13:0.85, 12:0.6, 11:0.45}[RANK_VALUE[c.rank]] || 0.15;
      } else {
        const d = G.trumpSuit ? 0.7 : 1.0;
        estimate += ({14:0.85, 13:0.45, 12:0.2, 11:0.08}[RANK_VALUE[c.rank]] || 0) * d;
      }
    }
    // Void bonus (aggressive for tempo)
    if (G.trumpSuit) {
      const tc = suitLen(hand, G.trumpSuit);
      for (const s of SUITS) {
        if (s !== G.trumpSuit && suitLen(hand, s) === 0 && tc > 0)
          estimate += 0.35 * Math.min(tc, 3);
      }
    }
    estimate += 0.15; // slight over-bid
  }

  // ── SNIPER style: ultra-precise, protected honors, AK boost, low noise ──
  else if (style === 'sniper') {
    for (const s of SUITS) {
      const sc = suitCards(hand, s);
      if (sc.length === 0) continue;
      const isTrump = G.trumpSuit && s === G.trumpSuit;
      const hasAce = sc.some(c => c.rank === 'A');
      const hasKing = sc.some(c => c.rank === 'K');
      for (const c of sc) {
        const val = RANK_VALUE[c.rank];
        if (isTrump) {
          estimate += {14:0.95, 13:0.85, 12:0.6, 11:0.4}[val] || 0.08;
          if (sc.length > 2) estimate += 0.12;
        } else {
          const d = G.trumpSuit ? 0.75 : 1.0;
          if (val === 14) estimate += 0.85 * d;
          else if (val === 13) estimate += (hasAce ? 0.5 : 0.3) * d;
          else if (val === 12) estimate += ((hasAce || hasKing) ? 0.25 : 0.08) * d;
          else if (val === 11) estimate += ((hasAce && hasKing) ? 0.12 : 0.02) * d;
        }
      }
    }
    if (G.trumpSuit) {
      const tc = suitLen(hand, G.trumpSuit);
      for (const s of SUITS) {
        if (s !== G.trumpSuit && suitLen(hand, s) === 0 && tc > 0)
          estimate += 0.3 * Math.min(tc, 2);
        else if (s !== G.trumpSuit && suitLen(hand, s) === 1 && tc > 0 && cpp >= 3)
          estimate += 0.12;
      }
    }
  }

  // ── PRECISION style: accurate with honor combos ──
  else {
    for (const s of SUITS) {
      const sc = suitCards(hand, s);
      if (sc.length === 0) continue;
      const isTrump = G.trumpSuit && s === G.trumpSuit;
      const hasAce = sc.some(c => c.rank === 'A');
      const hasKing = sc.some(c => c.rank === 'K');

      for (let i = 0; i < sc.length; i++) {
        const val = RANK_VALUE[sc[i].rank];
        if (isTrump) {
          estimate += {14:0.95, 13:0.85, 12:0.6, 11:0.4}[val] || 0.1;
          if (sc.length > 2 && i >= 2) estimate += 0.15;
        } else {
          const d = G.trumpSuit ? 0.75 : 1.0;
          if (val === 14) estimate += 0.85 * d;
          else if (val === 13) estimate += (0.4 + (hasAce ? 0.15 : 0)) * d;
          else if (val === 12) estimate += Math.max(0, 0.15 + ((hasAce||hasKing) ? 0.1 : -0.05)) * d;
          else if (val === 11) estimate += 0.05 * d;
        }
      }
    }
    // Void bonus
    if (G.trumpSuit) {
      const tc = suitLen(hand, G.trumpSuit);
      for (const s of SUITS) {
        if (s !== G.trumpSuit && suitLen(hand, s) === 0 && tc > 0)
          estimate += 0.25 * Math.min(tc, 2);
      }
    }
  }

  if (!G.trumpSuit) estimate *= 1.1;
  estimate *= comp;
  estimate = bidAwarenessAdj(estimate);
  estimate += (Math.random() - 0.5) * player.noise * (cpp <= 2 ? 2.0 : 1.0);

  let bid = Math.max(0, Math.min(cpp, Math.round(estimate)));
  return constrainBid(bid, estimate, cpp);
}

function constrainBid(bid, est, cpp) {
  if (!isLastBidder()) return bid;
  const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
  if (sum + bid === cpp) {
    const lo = bid - 1, hi = bid + 1;
    if (lo >= 0 && hi <= cpp) bid = Math.abs(est - lo) < Math.abs(est - hi) ? lo : hi;
    else if (lo >= 0) bid = lo;
    else bid = hi;
    bid = Math.max(0, Math.min(cpp, bid));
  }
  return bid;
}

// ─── Card Play ───
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

function playCard(playerIndex, card) {
  // One card per player per trick, whatever calls us (taps, timers, actions)
  if (G.currentTrick.length >= G.numPlayers || G.currentTrick.some(e => e.playerIndex === playerIndex)) return;
  clearAutoPlay();
  const idx = G.hands[playerIndex].findIndex(c => c.rank === card.rank && c.suit === card.suit);
  if (idx === -1) return;
  G.hands[playerIndex].splice(idx, 1);
  G.currentTrick.push({playerIndex, card});
  G.playedCards.push(card);
  logPlay(playerIndex, card);
  // Void tracking: if player didn't follow the led suit, they're void in it
  if (G.currentTrick.length > 1) {
    const ledSuit = G.currentTrick[0].card.suit;
    if (card.suit !== ledSuit) {
      G.knownVoids[playerIndex][ledSuit] = true;
    }
  }
  gameEffects.sfxCardPlay();
  gameEffects.renderAll();

  if (G.currentTrick.length === G.numPlayers) {
    setTimeout(resolveTrick, 800);
  } else {
    scheduleNextPlay();
  }
}

function scheduleNextPlay() {
  const next = currentPlayerToAct();
  if (next !== 0) {
    setTimeout(processAIPlay, 500);
  } else {
    // Human turn - check for auto-play
    checkAutoPlay();
  }
}

function currentPlayerToAct() {
  if (G.currentTrick.length === 0) return G.trickLeaderIndex;
  // A full trick is waiting to be resolved: nobody's turn. (Without this the
  // turn wrapped back to the leader, whose cards lit up and could be played
  // as an extra card in the same trick.)
  if (G.currentTrick.length >= G.numPlayers) return -1;
  return nextPlayer(G.currentTrick[G.currentTrick.length - 1].playerIndex);
}

// ─── Auto-play (single legal card) ───
function checkAutoPlay() {
  if (autoPlayTimer) return; // already scheduled
  if (G.phase !== 'playing' || currentPlayerToAct() !== 0) return;
  const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
  const card = autoPlayChoice(getLegalMoves(G.hands[0], ledSuit, G.trumpSuit), G.hands[0]);
  if (card) {
    gameEffects.renderAll(); // show the glowing card
    autoPlayTimer = setTimeout(() => {
      autoPlayTimer = null;
      gameEffects.sfxAutoPlay();
      playCard(0, card);
    }, 500);
  }
}

function clearAutoPlay() {
  if (autoPlayTimer) {
    clearTimeout(autoPlayTimer);
    autoPlayTimer = null;
  }
}

function applyAIPlay(p, card) {
  if (G.phase !== 'playing' || currentPlayerToAct() !== p) return;
  const hand = G.hands[p];
  const inHand = card && hand.some(c => c.rank === card.rank && c.suit === card.suit);
  if (!inHand) {
    const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
    const legal = getLegalMoves(hand, ledSuit, G.trumpSuit);
    if (!legal.length) return;
    card = legal.length === 1 ? legal[0] : chooseAICard(p, legal, ledSuit);
  }
  playCard(p, card);
}

function processAIPlay() {
  if (G.phase !== 'playing') return;
  const p = currentPlayerToAct();
  if (p <= 0) return;
  const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
  const legal = getLegalMoves(G.hands[p], ledSuit, G.trumpSuit);
  const style = getStyle(p);
  if (style === 'gemini') geminiChooseCard(p, legal, ledSuit).then(card => applyAIPlay(p, card));
  else if (style === 'jev') jevChooseCard(p, legal, ledSuit).then(card => applyAIPlay(p, card));
  else playCard(p, chooseAICard(p, legal, ledSuit));
}

// ═══════════════════════════════════════════════════════════════════
//  AI CARD PLAY — strategy-specific
// ═══════════════════════════════════════════════════════════════════
function chooseAICard(playerIndex, legalMoves, ledSuit) {
  if (legalMoves.length === 1) return legalMoves[0];

  const style = getStyle(playerIndex);

  // PIMC play for all main AI styles (Grok: higher sims + endgame inside pimcChooseCard)
  if (style === 'void' || style === 'tempo' || style === 'sniper' || style === 'precision' || style === 'spite' || style === 'grok' || style === 'codex') {
    const sims = style === 'codex' ? CODEX_CFG.playSims : (style === 'grok' ? GROK_CFG.playSims : (style === 'tempo' ? 40 : 80));
    return pimcChooseCard(playerIndex, legalMoves, sims);
  }
  const bid = G.bids[playerIndex];
  const won = G.tricksWon[playerIndex];
  const need = won < bid;
  const exact = won === bid;
  const stillNeeded = bid - won;
  const hand = G.hands[playerIndex];
  const trickPos = G.currentTrick.length;
  const isLast = trickPos === G.numPlayers - 1;
  const trumps = G.trumpSuit ? legalMoves.filter(c => c.suit === G.trumpSuit) : [];
  const nonTrump = legalMoves.filter(c => c.suit !== G.trumpSuit);
  const masters = legalMoves.filter(c => isHighestRemaining(c, hand));

  // ════════ LEADING ════════
  if (trickPos === 0) {
    if (need) {
      // ── VOID style: lead from shortest non-trump to create voids ──
      if (style === 'void' || style === 'opportunist') {
        const shortest = shortestNonTrumpSuit(hand);
        if (shortest && G.trumpSuit) {
          const sc = legalMoves.filter(c => c.suit === shortest);
          if (sc.length > 0 && suitLen(hand, shortest) <= 2) {
            return pickHighest(sc); // lead high from short suit to void it AND possibly win
          }
        }
        // Then cash masters
        if (masters.length > 0) {
          const ntM = masters.filter(c => c.suit !== G.trumpSuit);
          return (ntM.length > 0 ? ntM : masters)[0];
        }
        return pickHighest(nonTrump.length > 0 ? nonTrump : legalMoves);
      }

      // ── TEMPO style: lead trump early to strip opponents ──
      if (style === 'tempo' || style === 'adapter') {
        if (trumps.length >= 2 && stillNeeded >= 2) {
          return pickHighest(trumps); // strip opponents' trumps
        }
        // Cash aces
        const aces = nonTrump.filter(c => c.rank === 'A');
        if (aces.length > 0) return aces[0];
        // Then masters
        if (masters.length > 0) return masters[0];
        return pickHighest(nonTrump.length > 0 ? nonTrump : legalMoves);
      }

      // ── SNIPER style: count sure winners, cash exactly what's needed ──
      if (style === 'sniper') {
        const sureCount = masters.length;
        if (sureCount >= stillNeeded && masters.length > 0) {
          // Have enough sure winners — cash from shortest suit
          const ntM = masters.filter(c => c.suit !== G.trumpSuit);
          if (ntM.length > 0) {
            ntM.sort((a,b) => suitLen(hand, a.suit) - suitLen(hand, b.suit));
            return ntM[0];
          }
          return masters[0];
        }
        // Need to speculate — void shortest suit
        const sh = shortestNonTrumpSuit(hand);
        if (sh && G.trumpSuit && suitLen(hand, sh) <= 2) {
          const sc = legalMoves.filter(c => c.suit === sh);
          if (sc.length > 0) return pickHighest(sc);
        }
        return pickHighest(nonTrump.length > 0 ? nonTrump : legalMoves);
      }

      // ── PRECISION style: cash masters from shortest suit, then AK combos ──
      if (masters.length > 0) {
        const ntM = masters.filter(c => c.suit !== G.trumpSuit);
        if (ntM.length > 0) {
          ntM.sort((a,b) => suitLen(hand, a.suit) - suitLen(hand, b.suit));
          return ntM[0];
        }
        return masters[0];
      }
      // AK lead
      for (const s of SUITS) {
        if (s === G.trumpSuit) continue;
        const sc = suitCards(hand, s);
        if (sc.length >= 2 && sc[0].rank === 'A' && legalMoves.some(c => c.rank === 'A' && c.suit === s))
          return sc[0];
      }
      return pickHighest(nonTrump.length > 0 ? nonTrump : legalMoves);

    } else {
      // ── LEADING when done — all styles try to lose ──

      // Adapter/Opportunist: lead suit where opponent is known void (they'll trump us)
      if (style === 'adapter' || style === 'opportunist') {
        for (const s of SUITS) {
          if (s === G.trumpSuit) continue;
          const inSuit = legalMoves.filter(c => c.suit === s);
          if (inSuit.length === 0) continue;
          const someoneVoid = Object.keys(G.knownVoids).some(
            p => parseInt(p) !== playerIndex && G.knownVoids[p][s]
          );
          if (someoneVoid) return pickLowest(inSuit);
        }
      }

      // All: lead lowest from longest non-trump
      const longest = longestNonTrumpSuit(hand);
      if (longest) {
        const inSuit = legalMoves.filter(c => c.suit === longest);
        if (inSuit.length > 0) return pickLowest(inSuit);
      }
      return pickLowest(legalMoves);
    }
  }

  // ════════ FOLLOWING ════════
  const winEntry = currentWinner();
  const winCard = winEntry.card;
  const beaters = legalMoves.filter(c => cardBeats(c, winCard, ledSuit));
  const losers = legalMoves.filter(c => !cardBeats(c, winCard, ledSuit));

  if (need) {
    if (beaters.length > 0) {
      if (isLast) return pickLowest(beaters); // perfect info

      // TEMPO: always play highest beater (hold the lead aggressively)
      if (style === 'tempo') return pickHighest(beaters);

      // VOID/OPPORTUNIST/PRECISION: sure beater first, else cheapest
      const sureBeaters = beaters.filter(c => isHighestRemaining(c, hand));
      if (sureBeaters.length > 0) return pickLowest(sureBeaters);

      // 5-6 player: don't commit speculative beaters with 2+ players left
      const playersLeft = G.numPlayers - 1 - trickPos;
      if (G.numPlayers >= 5 && playersLeft >= 2 && losers.length > 0) {
        return pickLowest(losers); // duck and save the card
      }

      return pickLowest(beaters);
    }

    // Can't beat — dump strategically
    // VOID style: dump from shortest non-trump to create void faster
    if (style === 'void' || style === 'opportunist') {
      const shortest = shortestNonTrumpSuit(hand);
      if (shortest) {
        const dumpable = losers.filter(c => c.suit === shortest);
        if (dumpable.length > 0) return pickLowest(dumpable);
      }
    }
    // Others: dump lowest non-trump
    const ntLosers = losers.filter(c => c.suit !== G.trumpSuit);
    return pickLowest(ntLosers.length > 0 ? ntLosers : losers.length > 0 ? losers : legalMoves);
  }

  // ── Done or over-bid: shed highest loser ──
  if (losers.length > 0) {
    return exact ? pickHighest(losers) : pickLowest(losers);
  }
  return pickLowest(legalMoves);
}

function cardBeats(card, current, ledSuit) {
  if (card.suit === G.trumpSuit && current.suit !== G.trumpSuit) return true;
  if (card.suit === G.trumpSuit && current.suit === G.trumpSuit) {
    return RANK_VALUE[card.rank] > RANK_VALUE[current.rank];
  }
  if (card.suit === ledSuit && current.suit === ledSuit) {
    return RANK_VALUE[card.rank] > RANK_VALUE[current.rank];
  }
  if (card.suit !== G.trumpSuit && current.suit === G.trumpSuit) return false;
  return false;
}

function currentWinner() {
  const ledSuit = G.currentTrick[0].card.suit;
  let winner = G.currentTrick[0];
  for (let i = 1; i < G.currentTrick.length; i++) {
    if (cardBeats(G.currentTrick[i].card, winner.card, ledSuit)) {
      winner = G.currentTrick[i];
    }
  }
  return winner;
}

function pickHighest(cards) {
  return cards.reduce((best, c) => RANK_VALUE[c.rank] > RANK_VALUE[best.rank] ? c : best);
}
function pickLowest(cards) {
  return cards.reduce((best, c) => RANK_VALUE[c.rank] < RANK_VALUE[best.rank] ? c : best);
}

function resolveTrick() {
  if (G.phase !== 'playing' || G.currentTrick.length !== G.numPlayers) return;
  const winner = currentWinner();
  G.lastTrick = {entries: [...G.currentTrick], leaderIndex: G.trickLeaderIndex, winnerIndex: winner.playerIndex, reason: gameEffects.trickWinReason(G.currentTrick, winner.playerIndex, G.trumpSuit)};
  G.trickHistory.push(G.lastTrick);
  G.tricksWon[winner.playerIndex]++;
  G.trickLeaderIndex = winner.playerIndex;
  G.phase = 'trickResult';
  G.trickWinnerIndex = winner.playerIndex;
  logTrickEnd(winner.playerIndex);
  gameEffects.sfxTrickWin();
  gameEffects.renderAll();

  setTimeout(() => {
    if (G.resigned) return;
    G.currentTrick = [];
    if (G.hands.every(h => !h || h.length === 0)) {
      endRound();
    } else {
      G.phase = 'playing';
      gameEffects.renderAll();
      scheduleNextPlay();
    }
  }, 1100);
}

function endRound() {
  gameEffects.sfxRoundEnd();
  const roundScores = [];
  for (let p = 0; p < G.numPlayers; p++) {
    const bid = G.bids[p];
    const won = G.tricksWon[p];
    roundScores.push(scoreRound(won, bid));
    G.scores[p] += roundScores[p];
    // Track opponent bidding accuracy
    if (G.opponentStats[p]) {
      G.opponentStats[p].bids++;
      G.opponentStats[p].bidSum = (G.opponentStats[p].bidSum || 0) + bid;
      G.opponentStats[p].wonSum = (G.opponentStats[p].wonSum || 0) + won;
      if (won === bid) G.opponentStats[p].made++;
    }
  }
  logRoundEnd();
  G.roundHistory.push({
    cardsPerPlayer: G.cardsPerPlayer,
    trumpSuit: G.trumpSuit,
    bids: [...G.bids],
    tricksWon: [...G.tricksWon],
    roundScores,
    cumulativeScores: [...G.scores],
    trickHistory: G.trickHistory.map(t => ({...t, entries: [...t.entries]}))
  });
  G.phase = 'roundResult';
  gameEffects.showRoundResult(roundScores);
}

// ─── Fast play: make the human's forced moves automatically ───
// Only exact cases that need no memory of earlier tricks: the one legal bid,
// the one playable card, or playable cards touching in rank (9-8-7). Gaps are
// never filled in from cards already played - that would be counting cards
// for the player.
let autoBidTimer = null;
function fastPlayOn() { return !!gameOptions._fastPlay; }
function interchangeable(legal) {
  if (legal.length < 2) return legal.length === 1;
  const suit = legal[0].suit;
  if (legal.some(c => c.suit !== suit)) return false;
  const ranks = legal.map(c => RANK_VALUE[c.rank]);
  return Math.max(...ranks) - Math.min(...ranks) === legal.length - 1;
}
function autoPlayChoice(legal, hand) {
  if (legal.length === 1) return legal[0];
  if (!fastPlayOn() || !interchangeable(legal)) return null;
  return legal.reduce((a, b) => RANK_VALUE[b.rank] < RANK_VALUE[a.rank] ? b : a);
}
function autoBidChoice() {
  if (!fastPlayOn()) return null;
  const { valid } = getValidBids(G.cardsPerPlayer, G.bids, isLastBidder());
  return valid.length === 1 ? valid[0] : null;
}
const ME = 0;
function roundPointsRange(cpp) {
  const tri = n => n * (n + 1) / 2;
  return G.scoringMode === 'geometric' ? { max: 5 + tri(cpp), min: -tri(cpp) } : { max: 5 + cpp, min: -cpp };
}
function remainingRange() {
  let up = 0, down = 0;
  for (const cpp of G.roundSequence.slice(G.currentRoundIndex + 1)) { const r = roundPointsRange(cpp); up += r.max; down += r.min; }
  return { up, down };
}
function canStillWin(p) {
  const { up, down } = remainingRange();
  return G.scores.every((s, i) => i === p || s + down <= G.scores[p] + up);
}
// The inverse: p finishes strictly first even missing by the most every round
// while every opponent makes the largest bid every round.
function hasClinched(p) {
  const { up, down } = remainingRange();
  return G.scores.every((s, i) => i === p || s + up < G.scores[p] + down);
}
function humanClinched() {
  return [ME].find(hasClinched) ?? -1;
}
function humansOut() {
  const humans = [ME];
  return humans.length > 0 && humans.every(h => !canStillWin(h));
}
const BID_CHECK_SIMS = 400;
let bidCheckTimer = null;
function bidChecks() { return G.bidChecks || (G.bidChecks = {}); }
function computeBidCheck() {
  const { valid } = getValidBids(G.cardsPerPlayer, G.bids, isLastBidder());
  if (valid.length < 2) return null;
  const val = engineBidValues(ME, valid);
  const pick = valid.reduce((a, b) => val[b] > val[a] ? b : a);
  return { pick, val };
}
function ensureBidCheck() {
  const r = G.currentRoundIndex, checks = bidChecks();
  if (!(r in checks)) {
    // analysis must never stand between a player and their bid
    try { checks[r] = computeBidCheck(); } catch (e) { checks[r] = null; console.warn('Bid check failed', e); }
  }
  return checks[r];
}
function scheduleBidCheck() {
  if (bidCheckTimer || G.currentRoundIndex in bidChecks()) return;
  bidCheckTimer = setTimeout(() => {   // after the bid panel has painted
    bidCheckTimer = null;
    if (G.phase === 'bidding' && G.currentBidderIndex === ME) ensureBidCheck();
  }, 80);
}
function recordBidCheck(bid) {
  const c = ensureBidCheck();
  if (!c) return;
  c.bid = bid;
  if (G.gameLog && G.gameLog._currentRound) G.gameLog._currentRound.bidCheck = { pick: c.pick, val: c.val };
}

// The engine's trick count for each bid over sampled deals (the loop pimcBid
// runs, keeping the whole distribution instead of one average).
function bidCheckHist(me, sims) {
  const hand = G.hands[me], cpp = G.cardsPerPlayer, n = G.numPlayers;
  const hist = [];
  for (let b = 0; b <= cpp; b++) hist.push(new Array(cpp + 1).fill(0));
  for (let s = 0; s < sims; s++) {
    const opp = sampleOpponentHands(hand, me);
    const all = [];
    for (let i = 0; i < n; i++) all.push(i === me ? hand.slice() : (opp[i] || []));
    for (let b = 0; b <= cpp; b++) {
      const bids = G.bids.slice();
      bids[me] = b;
      for (let i = 0; i < n; i++) if (bids[i] === null) bids[i] = Math.round(all[i].length / n);
      const tw = simPlayOut(all.map(h => h.slice()), bids, new Array(n).fill(0), G.trumpSuit, (G.dealerIndex + 1) % n, n);
      hist[b][tw[me]]++;
    }
  }
  return hist;
}
// Playouts take about a fifth of a trick fewer than real play. Shifting that
// share of each count up one trick, fitted per hand size so the picks match the
// named bots' calibrated bids (88-100% agreement), keeps every value a real
// expected score - unlike their linear lean, which makes wild overbids look cheap.
const BID_CHECK_SHIFT = {
  linear:    { 2: 0.25, 3: 0.3, 4: 0.2, 5: 0.2, 6: 0.25, 7: 0.15, 8: 0.15 },
  geometric: { 2: 0.25, 3: 0.2, 4: 0.25, 5: 0.2, 6: 0.2, 7: 0, 8: 0 },
};
function expectedScore(hist, b, shift) {
  const cpp = hist.length - 1;
  let sum = 0, count = 0;
  hist[b].forEach((c, t) => {
    if (!c) return;
    count += c;
    sum += c * ((1 - shift) * scoreRound(t, b) + shift * scoreRound(Math.min(cpp, t + 1), b));
  });
  return count ? sum / count : 0;
}
function engineBidValues(me, valid) {
  const cpp = G.cardsPerPlayer, val = {};
  if (cpp === 1) {
    const p = codexOneCardWinProb(me);   // made 1 scores 6, made 0 scores 5, a miss costs 1
    if (valid.includes(0)) val[0] = Math.round((5 - 6 * p) * 10) / 10;
    if (valid.includes(1)) val[1] = Math.round((7 * p - 1) * 10) / 10;
  } else {
    const shift = BID_CHECK_SHIFT[G.scoringMode === 'geometric' ? 'geometric' : 'linear'][cpp] || 0;
    const hist = bidCheckHist(me, BID_CHECK_SIMS);
    for (const b of valid) val[b] = Math.round(expectedScore(hist, b, shift) * 10) / 10;
  }
  return val;
}
function bidCheckBehind(c) { return Math.round((c.val[c.pick] - c.val[c.bid]) * 10) / 10; }
function bidCheckTotals() {
  const done = Object.values(bidChecks()).filter(c => c && c.bid != null);
  return { rounds: done.length, flagged: done.filter(c => bidCheckBehind(c) > 1).length,
    behind: Math.round(done.reduce((a, c) => a + bidCheckBehind(c), 0) * 10) / 10 };
}
const PLAY_CHECK_SIMS = 400, PLAY_CHECK_FLAG = 0.5;
function playChecks() { return G.playChecks || (G.playChecks = {}); }
function cardKey(c) { return c.rank + c.suit; }
function playCheckValues(me, legal) {
  const sum = {};
  let n = 0;
  if (G.hands[me].length <= GROK_CFG.endgameMaxCards) {
    while (n < PLAY_CHECK_SIMS) {
      const s = endgameCardScores(me, legal, undefined);
      for (const k in s) sum[k] = (sum[k] || 0) + s[k];
      n += GROK_CFG.endgameSamples;
    }
  } else {
    Object.assign(sum, pimcCardScores(me, legal, PLAY_CHECK_SIMS, result => scoreRound(result[me], G.bids[me]), undefined));
    n = PLAY_CHECK_SIMS;
  }
  const val = {};
  for (const c of legal) val[cardKey(c)] = Math.round(sum[cardKey(c)] / n * 10) / 10;
  return val;
}
// Keep the position as you saw it; score it after the card is on the table
function recordPlayCheck(card) {
  try { queuePlayCheck(card); } catch (e) { console.warn('Play check failed', e); }   // analysis must never stand between a player and their card
}
function queuePlayCheck(card) {
  const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
  const legal = getLegalMoves(G.hands[ME], led, G.trumpSuit);
  if (legal.length < 2 || interchangeable(legal)) return;
  const pos = JSON.parse(JSON.stringify(Object.assign({}, G, { gameLog: null, bidChecks: null, playChecks: null })));
  const game = G.gameLog && G.gameLog.timestamp, round = G.currentRoundIndex;
  const entry = { trick: G.trickHistory.length, card: { rank: card.rank, suit: card.suit },
    before: G.currentTrick.map(e => ({ p: e.playerIndex, card: { rank: e.card.rank, suit: e.card.suit } })) };
  setTimeout(() => {
    const live = G;
    G = pos;
    try { entry.val = playCheckValues(ME, legal); } catch (e) { console.warn('Play check failed', e); return; } finally { G = live; }
    if ((G.gameLog && G.gameLog.timestamp) !== game) return;
    const best = legal.reduce((a, b) => entry.val[cardKey(b)] > entry.val[cardKey(a)] ? b : a);
    entry.pick = { rank: best.rank, suit: best.suit };
    (playChecks()[round] || (playChecks()[round] = [])).push(entry);
  }, 300);   // after the card's sound, so the simulations can't stutter it
}
function playCheckLost(x) { return Math.round((x.val[cardKey(x.pick)] - x.val[cardKey(x.card)]) * 10) / 10; }
function playCheckFlagged(list) {
  return (list || []).filter(x => playCheckLost(x) >= PLAY_CHECK_FLAG).sort((a, b) => playCheckLost(b) - playCheckLost(a));
}
function playCheckTotals() {
  const all = Object.values(playChecks()).flat().filter(x => x && x.val);
  const flagged = playCheckFlagged(all);
  return { choices: all.length, flagged: flagged.length, lost: Math.round(flagged.reduce((a, x) => a + playCheckLost(x), 0) * 10) / 10 };
}
function parseCardStr(s) {
  const suit = SUITS.find(x => s.endsWith(x));
  return { rank: s.slice(0, s.length - suit.length), suit };
}
function replayDeals(deals, seq, names, scoringMode) {
  const n = names.length;
  G = { numPlayers: n, scoringMode, playerNames: names.slice(), roundSequence: seq.slice(), currentRoundIndex: 0, dealerIndex: 0,
    cardsPerPlayer: 0, trumpCard: null, trumpSuit: null, bids: new Array(n).fill(null), currentBidderIndex: 0, biddingComplete: false,
    hands: [], currentTrick: [], trickLeaderIndex: 0, tricksWon: new Array(n).fill(0), scores: new Array(n).fill(0), roundHistory: [],
    phase: 'dealing', trickWinnerIndex: -1, playedCards: [], fullDeck: buildDeck(n), knownVoids: {}, opponentStats: {},
    gameLog: null, trickHistory: [], lastTrick: null };
  for (let i = 0; i < n; i++) G.opponentStats[i] = { bids: 0, made: 0, bidSum: 0, wonSum: 0 };
  const perRound = [];
  deals.forEach((d, r) => {
    G.currentRoundIndex = d.round; G.dealerIndex = d.dealer; G.cardsPerPlayer = d.cpp;
    G.playedCards = []; G.trickHistory = []; G.lastTrick = null;
    G.knownVoids = {};
    for (let i = 0; i < n; i++) G.knownVoids[i] = {};
    G.hands = d.hands.map(h => h.map(parseCardStr));
    G.trumpCard = d.trump ? parseCardStr(d.trump) : null;
    G.trumpSuit = G.trumpCard ? G.trumpCard.suit : null;
    G.bids = new Array(n).fill(null); G.tricksWon = new Array(n).fill(0); G.biddingComplete = false; G.currentTrick = [];
    G.phase = 'bidding';
    for (let k = 0; k < n; k++) {
      const p = (G.dealerIndex + 1 + k) % n;
      G.currentBidderIndex = p;
      G.bids[p] = computeAIBid(p);
    }
    G.biddingComplete = true; G.phase = 'playing'; G.trickLeaderIndex = (G.dealerIndex + 1) % n;
    for (let t = 0; t < d.cpp; t++) {
      G.currentTrick = [];
      for (let k = 0; k < n; k++) {
        const p = (G.trickLeaderIndex + k) % n;
        const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
        const card = chooseAICard(p, getLegalMoves(G.hands[p], led, G.trumpSuit), led);
        G.hands[p].splice(G.hands[p].findIndex(c => c.rank === card.rank && c.suit === card.suit), 1);
        G.currentTrick.push({ playerIndex: p, card });
        G.playedCards.push(card);
        if (led && card.suit !== led) G.knownVoids[p][led] = true;
      }
      const w = currentWinner().playerIndex;
      G.tricksWon[w]++;
      G.lastTrick = { entries: G.currentTrick.slice(), winnerIndex: w, leaderIndex: G.trickLeaderIndex };
      G.trickHistory.push(G.lastTrick);
      G.trickLeaderIndex = w;
    }
    G.currentTrick = [];
    const pts = G.bids.map((b, p) => scoreRound(G.tricksWon[p], b));
    pts.forEach((x, p) => {
      G.scores[p] += x;
      const st = G.opponentStats[p];
      st.bids++; st.bidSum += G.bids[p]; st.wonSum += G.tricksWon[p];
      if (G.tricksWon[p] === G.bids[p]) st.made++;
    });
    G.roundHistory.push({ cardsPerPlayer: d.cpp, trumpSuit: G.trumpSuit, bids: G.bids.slice(), tricksWon: G.tricksWon.slice(),
      roundScores: pts, cumulativeScores: G.scores.slice() });
    perRound.push(pts);
  });
  return { scores: G.scores.slice(), perRound };
}
function summarizeLuck(bot, results, you, yourRounds, deals) {
  const R = results.length, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const seat = results.map(r => r.scores[ME]);
  const table = results.map(r => mean(r.scores));
  const botAvg = mean(seat), tableAvg = mean(table);
  const sd = R > 1 ? Math.sqrt(seat.reduce((a, x) => a + (x - botAvg) ** 2, 0) / (R - 1)) : 0;
  // per round: how much more the bot scored than you, averaged over replays
  const gaps = deals.map((d, k) => ({ round: d.round, cpp: d.cpp, trump: d.trump ? parseCardStr(d.trump).suit : null,
    you: yourRounds[k], bot: Math.round(mean(results.map(r => r.perRound[k][ME])) * 10) / 10 }));
  return { bot, runs: R, you, botAvg: Math.round(botAvg * 10) / 10, tableAvg: Math.round(tableAvg * 10) / 10,
    cards: Math.round((botAvg - tableAvg) * 10) / 10, play: Math.round((you - botAvg) * 10) / 10,
    spread: Math.round(Math.sqrt(sd * sd + sd * sd / R)), gaps };
}

// Position inside the eight-card block, independent of the trick being played.
function eightCardRoundPosition(round = G.currentRoundIndex) {
  const sequence = G.roundSequence;
  if (sequence[round] !== 8) return null;
  return { current: sequence.slice(0, round + 1).filter(c => c === 8).length,
    total: sequence.filter(c => c === 8).length };
}

// Signed lead over the strongest opponent (positive when you lead outright).
function scoreGap(scores, player = ME) {
  return scores[player] - Math.max(...scores.filter((_, i) => i !== player));
}

// Lightweight, explicitly approximate score model, not an AI hand evaluation.
// Simulate joint trick totals and noisy bids for remaining rounds. Bid accuracy
// is shrunk toward a 60% prior (10 rounds) using each player's finished rounds.
// Ties for first count as wins. The current unfinished round is included, but
// its cards/bids are deliberately not inspected. A private seeded RNG makes
// repeated estimates stable and never consumes gameplay's Math.random stream.
function estimateWinChance(player = ME, simulations = 3000) {
  const history = G.roundHistory || [];
  const remaining = G.roundSequence.slice(history.length);
  const scores = G.scores;
  if (!remaining.length) return { chance: scoreGap(scores, player) >= 0 ? 1 : 0, certain: true, remaining: 0 };
  const bounds = remaining.reduce((a, cpp) => {
    const hi = scoreRound(cpp, cpp), lo = scoreRound(0, cpp);
    return { hi: a.hi + hi, lo: a.lo + lo };
  }, { hi: 0, lo: 0 });
  if (scores.some((s, p) => p !== player && s + bounds.lo > scores[player] + bounds.hi))
    return { chance: 0, certain: true, remaining: remaining.length };
  if (scores.every((s, p) => p === player || s + bounds.hi <= scores[player] + bounds.lo))
    return { chance: 1, certain: true, remaining: remaining.length };
  const accuracy = scores.map((_, p) => (6 + history.filter(r => r.bids[p] === r.tricksWon[p]).length) / (10 + history.length));
  let seed = 0x7a15c0de;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let wins = 0;
  for (let trial = 0; trial < simulations; trial++) {
    const final = scores.slice();
    remaining.forEach((cpp, r) => {
      const won = scores.map(() => 0);
      for (let trick = 0; trick < cpp; trick++) won[Math.floor(random() * scores.length)]++;
      const bids = won.map((w, p) => {
        if (random() < accuracy[p]) return w;
        const distance = 1 + Math.floor(random() * Math.max(1, Math.ceil(cpp / 3)));
        let b = Math.max(0, Math.min(cpp, w + (random() < .5 ? -distance : distance)));
        if (b === w) b = w === 0 ? 1 : w - 1;
        return b;
      });
      const dealer = (history.length + r) % scores.length;
      if (bids.reduce((a, b) => a + b, 0) === cpp) bids[dealer] += bids[dealer] === cpp ? -1 : 1;
      final.forEach((_, p) => { final[p] += scoreRound(won[p], bids[p]); });
    });
    if (scoreGap(final, player) >= 0) wins++;
  }
  return { chance: wins / simulations, certain: false, remaining: remaining.length };
}
