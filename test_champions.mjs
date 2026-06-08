#!/usr/bin/env node
// test_champions.mjs — Champion AI builder v2
// Trains 5 hardcore players vs weak + medium opponents
// Tunes bias AND aggression per player every batch
// Usage: node test_champions.mjs [--batch 1000] [--batches 50]

const argv = process.argv.slice(2);
let BATCH_SIZE  = 1000;
let NUM_BATCHES = 50;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--batch')   BATCH_SIZE  = parseInt(argv[++i]);
  if (argv[i] === '--batches') NUM_BATCHES = parseInt(argv[++i]);
}

// ─── Constants ───
const ALL_RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const SUITS     = ['spades','hearts','diamonds','clubs'];
const RV        = {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};

// ─── Champion profiles — bias & aggr are tuned each batch ───
const CHAMPS = {
  Viktor: { style:'void',      noise:0.10, bias:0.31, aggr:1.00, spite:0.7, bidSims:22, playSims:16 },
  Sasha:  { style:'tempo',     noise:0.12, bias:0.15, aggr:1.10, spite:0.5, bidSims:20, playSims:14 },
  Sniper: { style:'sniper',    noise:0.08, bias:0.21, aggr:1.00, spite:0.9, bidSims:22, playSims:16 },
  Katya:  { style:'precision', noise:0.08, bias:0.30, aggr:0.90, spite:0.6, bidSims:22, playSims:16 },
  Tempo2: { style:'tempo',     noise:0.15, bias:0.14, aggr:1.20, spite:0.3, bidSims:18, playSims:12 },
};

// Weak: pure weight-based, bad card play
// Medium: PIMC with very few sims (like a casual player)
const OPPONENTS = {
  Weak1:  { tier:'weak',   noise:0.28 },
  Weak2:  { tier:'weak',   noise:0.32 },
  Med1:   { tier:'medium', noise:0.15, bidSims:6, playSims:4 },
  Med2:   { tier:'medium', noise:0.18, bidSims:6, playSims:4 },
};

const CHAMP_NAMES = Object.keys(CHAMPS);
const OPP_NAMES   = Object.keys(OPPONENTS);
const ALL_NAMES   = [...CHAMP_NAMES, ...OPP_NAMES];

// ─── Utils ───
function shuffle(a) {
  const b = a.slice();
  for (let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}
  return b;
}
const cardKey  = c => c.rank+c.suit;
const lowest   = cs => cs.reduce((b,c)=>RV[c.rank]<RV[b.rank]?c:b);
const highest  = cs => cs.reduce((b,c)=>RV[c.rank]>RV[b.rank]?c:b);
const suitOf   = (hand,s) => hand.filter(c=>c.suit===s);

function roundSeq(n) {
  const seq=[], max=8;
  for(let i=0;i<n;i++) seq.push(1);
  for(let c=2;c<max;c++) seq.push(c);
  for(let i=0;i<n;i++) seq.push(max);
  for(let c=max-1;c>=2;c--) seq.push(c);
  for(let i=0;i<n;i++) seq.push(1);
  return seq;
}

function buildDeck(n) {
  const ranks=ALL_RANKS.slice(0,n*2), deck=[];
  for(const s of SUITS) for(const r of ranks) deck.push({rank:r,suit:s});
  return shuffle(deck);
}

function beats(c,best,ls,trump) {
  if(c.suit===best.suit) return RV[c.rank]>RV[best.rank];
  if(trump&&c.suit===trump&&best.suit!==trump) return true;
  return false;
}

function legal(hand,ls,trump) {
  if(!ls) return hand.slice();
  const f=hand.filter(c=>c.suit===ls); if(f.length) return f;
  if(trump){const t=hand.filter(c=>c.suit===trump);if(t.length) return t;}
  return hand.slice();
}

function unknown(G, hand) {
  const k=new Set([...hand,...G.played,...(G.trumpCard?[G.trumpCard]:[])].map(cardKey));
  return G.fullDeck.filter(c=>!k.has(cardKey(c)));
}

// ─── Improved simPlayOut ───
// Position-aware: 2nd hand low, last hand decisive
// Suit establishment: run long suits
// Trump conservation: don't ruff prematurely
function simPlayOut(hands, bids, tw, trump, leader, n, spiteTarget) {
  const h = hands.map(h=>h.slice());
  const tricksWon = tw.slice();
  let ld = leader;

  for (let t=0; t<h[0].length; t++) {
    if (!h[ld]?.length) break;
    const trick=[];
    let cur=ld;

    for (let p=0; p<n; p++) {
      if (!h[cur]?.length) { cur=(cur+1)%n; continue; }
      const ls    = trick.length>0 ? trick[0].card.suit : null;
      const pos   = trick.length;   // 0=lead, n-1=last
      const isLast = pos===n-1;
      let leg = h[cur];
      if (ls) {
        const f=leg.filter(c=>c.suit===ls); if(f.length) leg=f;
        else if(trump){const tt=leg.filter(c=>c.suit===trump);if(tt.length) leg=tt;}
      }

      const need = tricksWon[cur] < (bids[cur]||0);
      const made = !need && tricksWon[cur] >= (bids[cur]||0);
      const curBest = trick.length>0 ? trick.reduce((b,t)=>beats(t.card,b.card,ls,trump)?t:b) : null;
      const myWinners = curBest ? leg.filter(c=>beats(c,curBest.card,ls,trump)) : leg.slice();

      let card;

      if (!ls) {
        // ── Leading ──
        if (need) {
          // Lead Ace if available (cash winners)
          const aces = leg.filter(c=>c.rank==='A');
          if (aces.length) { card=aces[0]; }
          else {
            // Lead from longest suit to establish (non-trump preferred)
            let bestSuit=null, bestLen=0;
            for (const s of SUITS) {
              if (s===trump) continue;
              const len=suitOf(leg,s).length;
              if (len>bestLen) { bestLen=len; bestSuit=s; }
            }
            if (bestSuit && bestLen>=3) {
              const inSuit=suitOf(leg,bestSuit);
              card = highest(inSuit); // lead high from long suit
            } else {
              // Lead shortest non-trump to create void
              let shortSuit=null, shortLen=99;
              for (const s of SUITS) {
                if (s===trump) continue;
                const len=suitOf(leg,s).length;
                if (len>0&&len<shortLen){shortLen=len;shortSuit=s;}
              }
              card = shortSuit ? lowest(suitOf(leg,shortSuit)) : lowest(leg);
            }
          }
        } else if (made && spiteTarget!==undefined) {
          // Lead lowest to avoid giving spiteTarget easy wins
          card = lowest(leg);
        } else {
          card = lowest(leg);
        }
      } else {
        // ── Following ──
        if (need) {
          if (myWinners.length) {
            if (isLast) {
              card = lowest(myWinners); // cheapest winner when last
            } else {
              // Not last: only win if we have a good winner; otherwise duck and save
              const goodWinners = myWinners.filter(c=>RV[c.rank]>=10||c.suit===trump);
              card = goodWinners.length ? lowest(goodWinners) : lowest(leg);
            }
          } else {
            // Can't win: if void in led suit and have trumps, ruff only if last or only trump
            const trumpsInHand = leg.filter(c=>c.suit===trump);
            const alreadyTrumped = trick.some(t=>t.card.suit===trump);
            if (trumpsInHand.length && leg[0].suit===trump) {
              // Forced to play trump since it's the only legal option
              card = isLast ? lowest(myWinners.length?myWinners:trumpsInHand) : lowest(trumpsInHand);
            } else {
              card = lowest(leg); // dump lowest
            }
          }
        } else if (made && spiteTarget!==undefined && curBest?.player===spiteTarget && myWinners.length) {
          // Spite: beat spiteTarget if they're currently winning and we can
          card = lowest(myWinners);
        } else {
          // Don't need tricks: play lowest that won't accidentally win
          const nonWinners = leg.filter(c=>!beats(c,curBest?.card||leg[0],ls,trump));
          card = nonWinners.length ? lowest(nonWinners) : lowest(leg);
        }
      }

      h[cur] = h[cur].filter(c=>!(c.rank===card.rank&&c.suit===card.suit));
      trick.push({player:cur,card});
      cur=(cur+1)%n;
    }

    if (!trick.length) break;
    const ls2=trick[0].card.suit;
    let best=trick[0];
    for(let i=1;i<trick.length;i++) if(beats(trick[i].card,best.card,ls2,trump)) best=trick[i];
    tricksWon[best.player]++;
    ld=best.player;
  }
  return tricksWon;
}

// ─── PIMC ───
function sampleOpp(G, myHand, pi) {
  const unk = unknown(G,myHand).sort(()=>Math.random()-0.5);
  const opps=[];
  for(let i=0;i<G.n;i++){if(i!==pi)opps.push({idx:i,need:G.hands[i].length,hand:[]});}
  let ci=0;
  const maxN=Math.max(...opps.map(o=>o.need));
  for(let r=0;r<maxN;r++) for(const o of opps){
    if(o.hand.length>=o.need||ci>=unk.length)continue;
    if(G.voids[o.idx]?.[unk[ci].suit]){
      for(let j=ci+1;j<unk.length;j++){
        if(!G.voids[o.idx]?.[unk[j].suit]){[unk[ci],unk[j]]=[unk[j],unk[ci]];break;}
      }
    }
    o.hand.push(unk[ci++]);
  }
  const res={};
  for(const o of opps)res[o.idx]=o.hand;
  return res;
}

function spiteTarget(bids,tw,me) {
  let tgt=-1,minGap=Infinity;
  for(let i=0;i<bids.length;i++){
    if(i===me||bids[i]===null)continue;
    const gap=(bids[i]||0)-tw[i];
    if(gap>0&&gap<minGap){minGap=gap;tgt=i;}
  }
  return tgt>=0?tgt:undefined;
}

function pimcBid(G, pi, sims) {
  const hand=G.hands[pi], cpp=G.cpp;
  const scores=new Array(cpp+1).fill(0);
  for(let s=0;s<sims;s++){
    const opp=sampleOpp(G,hand,pi);
    const allH=Array.from({length:G.n},(_,i)=>i===pi?hand.slice():(opp[i]||[]));
    for(let bid=0;bid<=cpp;bid++){
      const bids=G.bids.map((b,i)=>b!==null?b:Math.round(allH[i].length/G.n));
      bids[pi]=bid;
      const tw=new Array(G.n).fill(0);
      const res=simPlayOut(allH.map(h=>h.slice()),bids,tw,G.trump,(G.dealer+1)%G.n,G.n,undefined);
      scores[bid]+=res[pi]===bid?5+bid:-Math.abs(res[pi]-bid);
    }
  }
  let best=0;
  for(let b=1;b<=cpp;b++) if(scores[b]>scores[best])best=b;
  return best;
}

function pimcCard(G, pi, legalMoves, sims) {
  if(legalMoves.length===1)return legalMoves[0];
  const hand=G.hands[pi];
  const scores={};
  for(const c of legalMoves)scores[cardKey(c)]=0;
  const made = G.tw[pi]>=(G.bids[pi]||0);
  const spite = made?spiteTarget(G.bids,G.tw,pi):undefined;

  for(let s=0;s<sims;s++){
    const opp=sampleOpp(G,hand,pi);
    for(const card of legalMoves){
      const allH=Array.from({length:G.n},(_,i)=>
        i===pi?hand.filter(c=>!(c.rank===card.rank&&c.suit===card.suit)):(opp[i]||[]));
      const tw=G.tw.slice();
      const trick2=[...G.trick,{player:pi,card}];
      let ldr=G.trickLeader;

      if(trick2.length===G.n){
        const ls=trick2[0].card.suit; let b=trick2[0];
        for(let i=1;i<trick2.length;i++)if(beats(trick2[i].card,b.card,ls,G.trump))b=trick2[i];
        tw[b.player]++;ldr=b.player;
      } else {
        let cur=(pi+1)%G.n,ct=trick2.slice();
        for(let p=ct.length;p<G.n;p++){
          if(!allH[cur]?.length){cur=(cur+1)%G.n;continue;}
          const ls=ct[0].card.suit;
          let leg=allH[cur];
          const f=leg.filter(c=>c.suit===ls);if(f.length)leg=f;
          else if(G.trump){const tt=leg.filter(c=>c.suit===G.trump);if(tt.length)leg=tt;}
          const curB=ct.reduce((b,t)=>beats(t.card,b.card,ls,G.trump)?t:b);
          const wins=leg.filter(c=>beats(c,curB.card,ls,G.trump));
          const needT=tw[cur]<(G.bids[cur]||0);
          const pick=needT?(wins.length?lowest(wins):lowest(leg)):lowest(leg);
          allH[cur]=allH[cur].filter(c=>!(c.rank===pick.rank&&c.suit===pick.suit));
          ct.push({player:cur,card:pick});cur=(cur+1)%G.n;
        }
        const ls=ct[0].card.suit;let b=ct[0];
        for(let i=1;i<ct.length;i++)if(beats(ct[i].card,b.card,ls,G.trump))b=ct[i];
        tw[b.player]++;ldr=b.player;
      }

      const res=simPlayOut(allH,G.bids,tw,G.trump,ldr,G.n,spite);
      let sc=res[pi]===G.bids[pi]?5+G.bids[pi]:-Math.abs(res[pi]-G.bids[pi]);
      // Spite bonus: reward for setting the biggest threat
      if(spite!==undefined&&res[spite]!==G.bids[spite])sc+=2.0;
      scores[cardKey(card)]+=sc;
    }
  }
  let best=legalMoves[0],bestSc=-Infinity;
  for(const c of legalMoves)if(scores[cardKey(c)]>bestSc){bestSc=scores[cardKey(c)];best=c;}
  return best;
}

// ─── Bid helpers ───
function prob1(card,n,trump){
  const val=RV[card.rank],rps=n*2;
  const higher=ALL_RANKS.slice(0,rps).filter(r=>RV[r]>val).length;
  const hTrumps=(trump&&card.suit!==trump)?rps:0;
  const total=rps*4-1,danger=higher+hTrumps;
  return Math.pow(Math.max(0,total-danger)/total,n-1);
}

function constrainBid(G,bid,est){
  if(G.bids.filter(b=>b!==null).length<G.n-1)return bid;
  const sum=G.bids.reduce((a,b)=>a+(b??0),0);
  if(sum+bid===G.cpp){
    const lo=bid-1,hi=bid+1;
    if(lo>=0&&hi<=G.cpp)bid=Math.abs(est-lo)<Math.abs(est-hi)?lo:hi;
    else if(lo>=0)bid=lo; else bid=hi;
    bid=Math.max(0,Math.min(G.cpp,bid));
  }
  return bid;
}

function awarenessAdj(G,est){
  const others=G.bids.filter(b=>b!==null);
  if(!others.length)return est;
  const avg=others.reduce((a,b)=>a+b,0)/others.length;
  const fair=G.cpp/G.n;
  if(avg>fair*1.2)est-=0.3+(avg-fair*1.2)*0.2;
  else if(avg<fair*0.8)est+=0.2+(fair*0.8-avg)*0.15;
  return est;
}

// ─── Bidding per tier ───
function champBid(G,pi){
  const name=G.names[pi],p=CHAMPS[name],cpp=G.cpp;
  if(cpp===1){
    let est=prob1(G.hands[pi][0],G.n,G.trump)+(Math.random()-0.5)*p.noise;
    return constrainBid(G,Math.max(0,Math.min(1,Math.round(est))),est);
  }
  let bid=pimcBid(G,pi,p.bidSims)+p.bias*Math.min(1,cpp/4);
  bid=awarenessAdj(G,bid)*p.aggr;
  bid=Math.max(0,Math.min(cpp,Math.round(bid)));
  return constrainBid(G,bid,bid);
}

function weakBid(G,pi){
  const p=OPPONENTS[G.names[pi]],cpp=G.cpp,hand=G.hands[pi],trump=G.trump;
  let est=0;
  for(const c of hand){
    if(c.rank==='A')est+=0.85;else if(c.rank==='K')est+=0.55;
    else if(c.rank==='Q')est+=0.30;else if(c.rank==='J')est+=0.15;
    if(trump&&c.suit===trump)est+=0.20;
  }
  est+=(Math.random()-0.5)*p.noise*cpp;
  return constrainBid(G,Math.max(0,Math.min(cpp,Math.round(est))),est);
}

function medBid(G,pi){
  const p=OPPONENTS[G.names[pi]],cpp=G.cpp;
  if(cpp===1){
    let est=prob1(G.hands[pi][0],G.n,G.trump)+(Math.random()-0.5)*p.noise;
    return constrainBid(G,Math.max(0,Math.min(1,Math.round(est))),est);
  }
  let bid=pimcBid(G,pi,p.bidSims)+(Math.random()-0.5)*p.noise;
  bid=awarenessAdj(G,bid);
  bid=Math.max(0,Math.min(cpp,Math.round(bid)));
  return constrainBid(G,bid,bid);
}

// ─── Card play per tier ───
function weakCard(G,pi,leg){
  const need=G.tw[pi]<(G.bids[pi]||0);
  const ls=G.trick.length>0?G.trick[0].card.suit:null;
  if(ls){
    const curB=G.trick.length>0?G.trick.reduce((b,t)=>beats(t.card,b.card,ls,G.trump)?t:b):null;
    const wins=curB?leg.filter(c=>beats(c,curB.card,ls,G.trump)):[];
    return need&&wins.length?lowest(wins):lowest(leg);
  }
  return need?highest(leg):lowest(leg);
}

function medCard(G,pi,leg){
  if(leg.length===1)return leg[0];
  const p=OPPONENTS[G.names[pi]];
  return pimcCard(G,pi,leg,p.playSims);
}

// ─── Single game ───
function playGame() {
  const n = 3+Math.floor(Math.random()*3);
  // At least 2 champions, rest split between weak/medium
  const champN = Math.max(2, Math.ceil(n*0.6));
  const oppN   = n-champN;
  const names  = shuffle([
    ...shuffle(CHAMP_NAMES).slice(0,champN),
    ...shuffle(OPP_NAMES).slice(0,oppN),
  ]);

  const seq=roundSeq(n);
  const scores=new Array(n).fill(0);
  const stats=names.map(()=>({exact:0,over:0,under:0,total:0}));
  let dealer=0;

  for(let ri=0;ri<seq.length;ri++){
    const cpp=seq[ri];
    const bids=new Array(n).fill(null);
    const tw=new Array(n).fill(0);
    const deck=buildDeck(n);
    const hands=Array.from({length:n},()=>[]);
    for(let i=0;i<cpp;i++)for(let p=0;p<n;p++)hands[p].push(deck[i*n+p]);
    const tot=cpp*n;
    const trumpCard=tot<deck.length?deck[tot]:null;
    const trump=trumpCard?.suit||null;
    const voids=Array.from({length:n},()=>({}));
    const played=[];

    const G={n,names,cpp,bids,tw,hands,trump,trumpCard,
      fullDeck:deck.slice(),voids,played,
      dealer,trick:[],trickLeader:(dealer+1)%n,ri};

    // Bidding
    let bidder=(dealer+1)%n;
    for(let i=0;i<n;i++){
      const name=names[bidder];
      if(CHAMPS[name])        bids[bidder]=champBid(G,bidder);
      else if(OPPONENTS[name]?.tier==='medium') bids[bidder]=medBid(G,bidder);
      else                    bids[bidder]=weakBid(G,bidder);
      bidder=(bidder+1)%n;
    }

    // Play
    let leader=(dealer+1)%n;
    for(let trick=0;trick<cpp;trick++){
      G.trick=[];G.trickLeader=leader;
      let cur=leader;
      for(let p=0;p<n;p++){
        const pi=(cur+p)%n;
        const ls=G.trick.length>0?G.trick[0].card.suit:null;
        const leg=legal(hands[pi],ls,trump);
        const name=names[pi];
        let card;
        if(CHAMPS[name])                          card=pimcCard(G,pi,leg,CHAMPS[name].playSims);
        else if(OPPONENTS[name]?.tier==='medium') card=medCard(G,pi,leg);
        else                                      card=weakCard(G,pi,leg);
        G.trick.push({player:pi,card});
        hands[pi]=hands[pi].filter(c=>!(c.rank===card.rank&&c.suit===card.suit));
        played.push(card);
        if(ls&&card.suit!==ls)voids[pi][ls]=true;
      }
      const ls=G.trick[0].card.suit;
      let best=G.trick[0];
      for(let i=1;i<G.trick.length;i++)if(beats(G.trick[i].card,best.card,ls,trump))best=G.trick[i];
      tw[best.player]++;leader=best.player;
    }

    for(let p=0;p<n;p++){
      const b=bids[p],w=tw[p];
      scores[p]+=b===w?5+b:-Math.abs(b-w);
      stats[p].total++;
      if(w===b)stats[p].exact++;else if(w>b)stats[p].over++;else stats[p].under++;
    }
    dealer=(dealer+1)%n;
  }
  return {names,scores,stats};
}

// ─── Batch ───
function runBatch(n) {
  const ps={};
  for(const name of ALL_NAMES)ps[name]={score:0,exact:0,over:0,under:0,total:0,wins:0,games:0};
  for(let g=0;g<n;g++){
    const {names,scores,stats}=playGame();
    const mx=Math.max(...scores);
    names.forEach((name,i)=>{
      ps[name].score+=scores[i];ps[name].exact+=stats[i].exact;
      ps[name].over+=stats[i].over;ps[name].under+=stats[i].under;
      ps[name].total+=stats[i].total;ps[name].games++;
      if(scores[i]===mx)ps[name].wins++;
    });
  }
  return ps;
}

// ─── Tune bias AND aggr for ALL champions ───
function tune(ps, b) {
  const lr = Math.max(0.008, 0.06*Math.pow(0.90,b));
  for(const name of CHAMP_NAMES){
    const s=ps[name];if(!s.total)continue;
    const cal=(s.over-s.under)/s.total;
    // Tune bias: underbidding → raise, overbidding → lower
    CHAMPS[name].bias -= cal*lr;
    CHAMPS[name].bias  = Math.max(0,Math.min(2.0,CHAMPS[name].bias));
    // Tune aggr: if badly calibrated, pull aggr toward 1.0
    const badness = Math.abs(cal);
    if(badness>0.08){
      CHAMPS[name].aggr += (1.0-CHAMPS[name].aggr)*lr*2;
      CHAMPS[name].aggr  = Math.max(0.7,Math.min(1.5,CHAMPS[name].aggr));
    }
  }
  return ALL_NAMES
    .map(name=>({name,...ps[name]}))
    .sort((a,b)=>(b.score/Math.max(1,b.games))-(a.score/Math.max(1,a.games)));
}

// ─── Main ───
const TOTAL=BATCH_SIZE*NUM_BATCHES;
console.log(`\n╔══ Champion Builder v2 ══╗`);
console.log(`  ${TOTAL.toLocaleString()} games | ${NUM_BATCHES} × ${BATCH_SIZE} | random 3/4/5 player mix`);
console.log(`  Champions : ${CHAMP_NAMES.join(', ')}`);
console.log(`  Opponents : ${OPP_NAMES.join(', ')}\n`);
console.log(`${'B'.padEnd(4)} ${'Player'.padEnd(8)} ${'AvgScore'.padStart(8)} ${'Acc%'.padStart(6)} ${'Over'.padStart(6)} ${'Under'.padStart(6)} ${'Win%'.padStart(5)} ${'Bias'.padStart(6)} ${'Aggr'.padStart(5)}`);
console.log('─'.repeat(68));

const t0=Date.now();
for(let b=0;b<NUM_BATCHES;b++){
  const ps=runBatch(BATCH_SIZE);
  const ranked=tune(ps,b);
  for(const p of ranked){
    const avg=(p.score/Math.max(1,p.games)).toFixed(1);
    const acc=p.total>0?((p.exact/p.total)*100).toFixed(1):'—';
    const win=((p.wins/Math.max(1,p.games))*100).toFixed(0);
    const cp=CHAMPS[p.name];
    const bias=cp?cp.bias.toFixed(3):'  —  ';
    const aggr=cp?cp.aggr.toFixed(2):'  — ';
    const tier=OPPONENTS[p.name]?`~`:'';
    const star=ranked[0].name===p.name?' ★':'  ';
    console.log(`B${String(b+1).padStart(2)}  ${(tier+p.name).padEnd(8)} ${String(avg).padStart(8)} ${String(acc).padStart(5)}% ${String(p.over).padStart(6)} ${String(p.under).padStart(6)} ${String(win).padStart(4)}% ${bias.padStart(6)} ${aggr.padStart(4)}${star}`);
  }
  const elapsed=((Date.now()-t0)/1000).toFixed(0);
  console.log(`     [batch ${b+1}/${NUM_BATCHES} — ${elapsed}s | lr=${(Math.max(0.008,0.06*Math.pow(0.90,b))).toFixed(4)}]\n`);
}

const elapsed=((Date.now()-t0)/1000).toFixed(1);
console.log('\n╔══ FINAL CHAMPION PARAMETERS ══╗');
console.log('  Copy these into index.html CHAMPS / biasMap:\n');
for(const name of CHAMP_NAMES){
  const p=CHAMPS[name];
  console.log(`  ${name.padEnd(8)} bias=${p.bias.toFixed(4)}  aggr=${p.aggr.toFixed(3)}  spite=${p.spite}  noise=${p.noise}  (${p.style})`);
}
console.log(`\n  ${TOTAL.toLocaleString()} games in ${elapsed}s`);
