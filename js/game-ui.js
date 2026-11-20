// Shared browser UI: rendering, input, sound, translation, persistence and setup.
// ─── Firebase (for game log persistence) ───
// DB rules require auth != null on gameLogs, so sign in anonymously up front.
let fbDb = null, fbAuthReady = null;
try {
  firebase.initializeApp({
    apiKey: "AIzaSyBHSb_-IbgjkcFWmdA2WkfuXg-Zl691khQ",
    databaseURL: "https://rowhist26-default-rtdb.firebaseio.com",
    projectId: "rowhist26",
  });
  fbDb = firebase.database();
  fbAuthReady = firebase.auth().signInAnonymously()
    .catch(e => console.warn('Firebase anonymous auth failed, logs will be local only', e));
} catch(e) { console.warn('Firebase init failed, logs will be local only', e); }

const I18N_ROOTS = ["#setup-screen"];
// ─── Language ───
// English is the source text and the lookup key; RO holds the Romanian. t()
// looks a string up and fills its {slots}. The start screens switch EN/RO; the
// choice is remembered on this device, and a first visit follows the
// browser's language. Static page text is translated in place from the same
// table (translateStatic), everything rendered later goes through t().
let LANG = 'en';
try { LANG = localStorage.getItem('wist-lang') || (/^ro\b/i.test(navigator.language || '') ? 'ro' : 'en'); } catch (e) {}
function t(en, vars) {
  const s = LANG === 'ro' && RO[en] != null ? RO[en] : en;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m) : s;
}
// "1 card", "3 cards"; "1 carte", "3 cărți", "20 de cărți"
function nOf(n, en1, enN, ro1, roN) {
  if (LANG !== 'ro') return `${n} ${n === 1 ? en1 : enN}`;
  return `${n} ${n === 1 ? ro1 : (n % 100 >= 20 || (n && n % 100 === 0) ? 'de ' : '') + roN}`;
}
function dec(x) { return LANG === 'ro' ? String(x).replace('.', ',') : String(x); }
const RANK_NAMES_RO = { A: 'As', K: 'Rege', Q: 'Damă', J: 'Valet' };
const SUIT_NAMES_RO = { spades: 'pică', hearts: 'cupă', diamonds: 'caro', clubs: 'treflă' };
const enText = new WeakMap(), enAttrs = new WeakMap();
function translateNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      if (!enText.has(node)) enText.set(node, node.nodeValue);
      const en = enText.get(node), key = en.trim();
      if (key) node.nodeValue = en.replace(key, t(key));
    } else if (node.nodeType === 1 && !node.hasAttribute('data-no-i18n')) {
      const saved = enAttrs.get(node) || {};
      for (const a of ['placeholder', 'aria-label', 'title']) {
        if (!(a in saved) && node.hasAttribute(a)) saved[a] = node.getAttribute(a);
        if (a in saved) node.setAttribute(a, t(saved[a]));
      }
      enAttrs.set(node, saved);
      translateNode(node);
    }
  }
}
let enTitle = null;
function translateStatic() {
  document.documentElement.lang = LANG;
  if (enTitle === null) enTitle = document.title;
  document.title = t(enTitle);
  for (const sel of I18N_ROOTS) { const root = document.querySelector(sel); if (root) translateNode(root); }
  document.querySelectorAll('.lang-switch button').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === LANG);
    b.setAttribute('aria-pressed', String(b.dataset.lang === LANG));
  });
}
function setLang(lang) {
  LANG = lang === 'ro' ? 'ro' : 'en';
  try { localStorage.setItem('wist-lang', LANG); } catch (e) {}
  translateStatic();
  onLangChange();
}
const RO = {
  "You": "Tu",
  "bidding…": "licitează…",
  "No bid yet": "Încă n-a licitat",
  "bid": "licitat",
  "bid {bid}": "licitat {bid}",
  "bid {bid}, took {won}": "licitat {bid}, luat {won}",
  "Bids placed so far, out of the tricks this round": "Licitat până acum, din mâinile acestei runde",
  "Overbid by {n}: someone has to miss": "Licitat peste cu {n}: cineva trebuie să cadă",
  "Underbid by {n}: tricks are up for grabs": "Licitat sub cu {n}: rămân mâini de luat",
  "Round {n}": "Runda {n}",
  "Bids": "Licitat",
  "Geometric": "Geometric",
  "Turn sound on": "Pornește sunetul",
  "Mute": "Oprește sunetul",
  "Sound off": "Sunet oprit",
  "Sound on": "Sunet pornit",
  "Score sheet": "Foaia de scor",
  "Sheet": "Foaia",
  "Chat": "Chat",
  "End": "Termină",
  "End the game for everyone": "Termină jocul pentru toți",
  "Standings": "Clasament",
  "Gemini is offline; a built-in player stands in": "Gemini nu răspunde; joacă în locul lui un jucător din aplicație",
  "Jev is offline; a built-in player stands in": "Jev nu răspunde; joacă în locul lui un jucător din aplicație",
  "Dealer": "Împarte",
  "Last trick": "Ultima mână",
  "Trump card: {card}": "Atu: {card}",
  "Trump": "Atu",
  "No<br>trump": "Fără<br>atu",
  ", cannot be played now": ", nu se poate juca acum",
  "You deal": "Tu împarți",
  "Only one bid is allowed: {bid}. Bidding it.": "O singură licitație e permisă: {bid}. Se licitează automat.",
  "{n}, not allowed": "{n}, nepermis",
  "Bid {n}": "Licitează {n}",
  "{list}. Total {sum} of {cpp}.": "{list}. Total {sum} din {cpp}.",
  "You bid first. {n} to take.": "Licitezi primul. {n} de luat.",
  "You can't bid {f}: the total would be {cpp}.": "Nu poți licita {f}: totalul ar fi {cpp}.",
  "Your bid": "Licitația ta",
  "Hint": "Sugestie",
  "{who} is bidding": "{who} licitează",
  "You take the trick": "Tu iei mâna",
  "{who} takes the trick": "{who} ia mâna",
  "Only one card can be played. Playing it.": "O singură carte se poate juca. Se joacă automat.",
  "Your cards here are interchangeable. Playing the {card}.": "Cărțile tale de aici sunt echivalente. Se joacă {card}.",
  "Your lead": "Tu deschizi",
  "Your turn: follow {suit}": "Rândul tău: răspunzi la {suit}",
  "No {led} left: you must trump {trump}": "Nu mai ai {led}: trebuie să tai cu atu {trump}",
  "No {led} left: play any card": "Nu mai ai {led}: joci orice carte",
  "{who} to play": "Joacă {who}",
  "Geometric scoring: a made bid B scores 5 + B(B+1)/2; missing by d costs d(d+1)/2.": "Punctaj geometric: o licitație B făcută aduce 5 + B(B+1)/2; o greșeală de d mâini costă d(d+1)/2.",
  "Classic scoring: a made bid scores 5 + the bid; a miss costs 1 point per trick off.": "Punctaj clasic: o licitație făcută aduce 5 + licitația; când cazi, pierzi 1 punct pentru fiecare mână în plus sau în minus.",
  "Geometric scoring: made bid B scores 5 + B(B+1)/2, missing by d costs d(d+1)/2.": "Punctaj geometric: licitația B făcută aduce 5 + B(B+1)/2, o greșeală de d mâini costă d(d+1)/2.",
  "Classic scoring: made bid scores 5 + the bid, a miss costs 1 per trick off.": "Punctaj clasic: licitația făcută aduce 5 + licitația, o greșeală costă 1 punct pe mână.",
  "Cards dealt": "Cărți împărțite",
  "tricks taken / bid": "mâini luate / licitate",
  "How the tricks went": "Cum au mers mâinile",
  ", led": ", a deschis",
  "trump {s}": "atu {s}",
  "high {s}": "cea mai mare {s}",
  "Trump: {s}": "Atu: {s}",
  "No trump this round": "Fără atu în această rundă",
  "led": "a deschis",
  "{who} trumped with {card}": "{who} a tăiat cu {card}",
  "{who} won: highest {s}": "{who} a luat: cea mai mare {s}",
  "{who} won: highest {s}, nobody trumped": "{who} a luat: cea mai mare {s}, nimeni n-a tăiat",
  "You took none, as bid: {pts}.": "N-ai luat nicio mână, cum ai licitat: {pts}.",
  "You made {bid}: {pts}.": "Ai făcut {bid}: {pts}.",
  "You took {won} on a bid of {bid}: {pts}.": "Ai luat {won} la licitația {bid}: {pts}.",
  "Everyone else made theirs.": "Toți ceilalți și-au făcut licitația.",
  "Missed: {list}.": "Au căzut: {list}.",
  "You can no longer finish first, even with perfect rounds from here.": "Nu mai poți ieși pe primul loc, nici cu runde perfecte de aici încolo.",
  "No human player can finish first any more, even with perfect rounds from here.": "Niciun jucător om nu mai poate ieși primul, nici cu runde perfecte de aici încolo.",
  "You have clinched first place. Nobody can catch up, even with perfect rounds from here.": "Ți-ai asigurat locul întâi. Nimeni nu te mai poate prinde, nici cu runde perfecte de aici încolo.",
  "{name} has clinched first place. Nobody can catch up, even with perfect rounds from here.": "{name} și-a asigurat locul întâi. Nimeni nu mai poate prinde din urmă, nici cu runde perfecte de aici încolo.",
  "{s} trump": "atu {s}",
  "no trump": "fără atu",
  "See final scores": "Vezi scorul final",
  "Play on": "Joacă mai departe",
  "End game": "Termină jocul",
  "Next round": "Runda următoare",
  "Waiting for the host to show final scores…": "Așteptăm ca gazda să arate scorul final…",
  "Waiting for the host to deal…": "Așteptăm ca gazda să împartă…",
  "Bid check:": "Verificarea licitației:",
  "The engine bids {pick} too.": "Și motorul licitează {pick}.",
  "The engine bids {pick}; your {bid} gives up about {pts} points.": "Motorul licitează {pick}; cu {bid} pierzi cam {pts} puncte.",
  "The engine slightly prefers {pick}; your {bid} is within a point.": "Motorul preferă puțin {pick}; {bid} e la mai puțin de un punct.",
  "bid {b}: {v}": "licitat {b}: {v}",
  "Expected points for each bid, as the engine saw your hand when you bid": "Punctele așteptate pentru fiecare licitație, așa cum vedea motorul cărțile tale când ai licitat",
  "{flagged} of your {bids} were over a point behind the engine's pick; about {pts} points in all.": "{flagged} din cele {bids} au fost cu peste un punct sub alegerea motorului; cam {pts} puncte în total.",
  "1 of your {bids} was over a point behind the engine's pick; about {pts} points in all.": "Una din cele {bids} a fost cu peste un punct sub alegerea motorului; cam {pts} puncte în total.",
  "All {bids} were within a point of the engine's pick.": "Toate cele {bids} au fost la mai puțin de un punct de alegerea motorului.",
  "{n} no trump": "{n} fără atu",
  "Your turn": "Rândul tău",
  "Listening in Romanian (una, două, gata). Tap here for English.": "Ascult în română (una, două, gata). Atinge aici pentru engleză.",
  "Listening in English (one, two, next). Tap here for Romanian.": "Ascult în engleză (one, two, next). Atinge aici pentru română.",
  "The microphone is blocked for this site. Allow it in the site settings (the icon left of the address), then tap 🎤 again.": "Microfonul e blocat pentru acest site. Permite-l din setările site-ului (iconița din stânga adresei), apoi apasă din nou 🎤.",
  "This browser has speech recognition turned off. On a Mac with Safari, turn on Dictation in System Settings → Keyboard. Chrome works too.": "Recunoașterea vocală e oprită în acest browser. Pe Mac cu Safari, pornește Dictarea din Setări sistem → Tastatură. Merge și în Chrome.",
  "Can't reach the speech service (Google's in Chrome). Check the connection, VPN or firewall; Brave and Arc don't include one.": "Nu pot ajunge la serviciul de recunoaștere vocală (al Google în Chrome). Verifică conexiunea, VPN-ul sau firewall-ul; Brave și Arc nu au unul.",
  "No microphone found.": "Nu am găsit niciun microfon.",
  "Voice bidding stopped ({code}).": "Licitarea vocală s-a oprit ({code}).",
  "Listening. Say your bid on your turn, or “next” for the next round.": "Ascult. Spune-ți licitația când e rândul tău, sau „gata” pentru runda următoare.",
  "Bid by voice": "Licitează cu vocea",
  "Voice bidding: on": "Licitare vocală: pornită",
  "Voice bidding: off": "Licitare vocală: oprită",
  "Voice bidding: on — say a number on your turn": "Licitare vocală pornită — spune un număr când e rândul tău",
  "Resign": "Abandonează",
  "Resign this game? It counts as a loss.": "Abandonezi jocul? Se pune ca pierdere.",
  "You resigned": "Ai abandonat",
  "Resign? A bot takes your seat and the game goes on without you.": "Abandonezi? Un bot îți ia locul și jocul continuă fără tine.",
  "You resigned. A bot plays your seat for the rest of the game.": "Ai abandonat. Un bot joacă în locul tău până la final.",
  "Play check:": "Verificarea jocului:",
  "Play check": "Verificarea jocului",
  "after {cards}": "după {cards}",
  "leading": "la deschidere",
  "Trick {n}, {when}: you {card}, Katya {pick}, worth about {pts} more.": "Mâna {n}, {when}: tu {card}, Katya {pick}, cam {pts} în plus.",
  "Katya would have played like you in all {choices}, or within half a point.": "Katya ar fi jucat ca tine în toate cele {choices}, sau la mai puțin de jumătate de punct.",
  "Katya would play differently at {k} of your {choices}, worth about {pts} points.": "Katya ar fi jucat altfel la {k} din {choices}, cam {pts} puncte.",
  "Katya would play differently at {k} of your {choices} this game, worth about {pts} points.": "Katya ar fi jucat altfel la {k} din {choices} în acest joc, cam {pts} puncte.",
  "Katya would have played like you in all {choices} this game, or within half a point.": "Katya ar fi jucat ca tine în toate cele {choices} din acest joc, sau la mai puțin de jumătate de punct.",
  "Over {choices} in {games}, Katya would have played differently at {share} of them, worth about {pergame} points a game.": "În {choices} din {games}, Katya ar fi jucat altfel la {share} dintre ele, cam {pergame} puncte pe joc.",
  " and ": " și ",
  "{names} tie at {n}": "{names}: egalitate la {n}",
  "A shared win.": "O victorie împărțită.",
  "You finish with {n}.": "Termini cu {n}.",
  "You win with {n}": "Câștigi cu {n}",
  "{name} is next with {n}.": "Urmează {name} cu {n}.",
  "{name} wins with {n}": "Câștigă {name} cu {n}",
  "You finish {place} with {n}.": "Termini pe locul {place} cu {n}.",
  "Final standings": "Clasament final",
  "Your stats": "Statisticile tale",
  "Play again": "Încă un joc",
  "Download game logs": "Descarcă jurnalele jocurilor",
  "Back to the table": "Înapoi la masă",
  "Loading…": "Se încarcă…",
  "No games recorded yet.": "Niciun joc înregistrat încă.",
  "Error downloading logs.": "Eroare la descărcarea jurnalelor.",
  "Resume round {r} of {n}": "Continuă runda {r} din {n}",
  "Try {card}.": "Încearcă {card}.",
  "Tap it to play, or pick another card.": "Atinge-o ca s-o joci sau alege altă carte.",
  "This is the highest {suit} left — a sure winner. Lead it now to secure a trick.": "E cea mai mare carte de {suit} rămasă — câștigă sigur. Deschide cu ea ca să-ți asiguri o mână.",
  "Highest remaining in its suit — a sure trick. No higher card is out there.": "Cea mai mare rămasă în culoarea ei — o mână sigură. Nu mai e nicio carte mai mare.",
  "You hold Ace-King of {suit}. Lead the Ace to cash it safely while you control the suit.": "Ai as-rege de {suit}. Deschide cu asul ca să-l încasezi sigur cât controlezi culoarea.",
  "You need {n} more. Lead your strongest card to try to win.": "Îți mai trebuie {n}. Deschide cu cea mai tare carte ca să încerci să iei.",
  "You've made your bid. Lead low to avoid winning: {card} is your safest lead.": "Ți-ai făcut licitația. Deschide mic ca să nu iei: {card} e deschiderea cea mai sigură.",
  "You've made your bid. Lead your lowest card to minimise the chance of winning.": "Ți-ai făcut licitația. Deschide cu cea mai mică carte, ca să ai cele mai mici șanse să iei.",
  "You're last to play. {card} is the cheapest card that beats {name}'s {top}.": "Joci ultimul. {card} e cea mai mică carte care bate {top} jucat de {name}.",
  "This is the highest remaining in its suit — it can't be beaten. Play it to secure the trick.": "E cea mai mare rămasă în culoarea ei — nu poate fi bătută. Joac-o ca să iei mâna.",
  "You need tricks and {n} can beat {name}. Play high to hold the lead.": "Ai nevoie de mâini și {n} pot bate ce a jucat {name}. Joacă mare ca să rămâi în față.",
  "You can't beat {name}'s {top}. Dump your lowest card ({card}) to save better cards.": "Nu poți bate {top} jucat de {name}. Aruncă cea mai mică carte ({card}) ca să-ți păstrezi cărțile bune.",
  "You've made your bid — don't win this! Play {card} (the highest card that still loses) to shed a dangerous card.": "Ți-ai făcut licitația — nu lua mâna asta! Joacă {card} (cea mai mare carte care tot pierde) ca să scapi de o carte periculoasă.",
  "You're forced to win here. Play your lowest to minimise damage.": "Aici ești obligat să iei. Joacă cea mai mică, ca să limitezi paguba.",
  "You have too many tricks. Play low and try to lose.": "Ai prea multe mâini. Joacă mic și încearcă să pierzi.",
  "{card} is a high trump — near-certain trick": "{card} e atu mare — mână aproape sigură",
  "{card} is a mid trump — likely trick": "{card} e atu mijlociu — mână probabilă",
  "{card} is an Ace — strong winner": "{card} e as — carte puternică",
  "{card} backed by Ace — solid": "{card} cu asul alături — solid",
  "{card} without Ace — may lose to it": "{card} fără as — poate pierde în fața lui",
  "{card} is a high trump": "{card} e atu mare",
  "{card} is a mid trump": "{card} e atu mijlociu",
  "{card} is an Ace": "{card} e as",
  "{card} backed by Ace": "{card} cu asul alături",
  "{card} without Ace": "{card} fără as",
  "Void in {suit} — can trump in": "Nu ai {suit} — poți tăia cu atu",
  "(adjusted to avoid forbidden bid)": "(ajustat ca să evite licitația interzisă)",
  "Suggested bid:": "Licitație sugerată:",
  "A weak hand. Bid low.": "Cărți slabe. Licitează mic.",
  "Luck or skill? Replaying your cards with {bot} in your seat… {progress}": "Noroc sau pricepere? Rejucăm cărțile tale cu {bot} pe locul tău… {progress}",
  "Your cards": "Cărțile tale",
  "Your play": "Jocul tău",
  "{bot} averaged {avg} with them; the table {table}": "{bot} a făcut în medie {avg} cu ele; masa, {table}",
  "you {you} vs {bot}'s {avg}; one game swings ±{spread}": "tu {you}, {bot} {avg}; un singur joc variază cu ±{spread}",
  "{bot} gained most on you in round {list}.": "{bot} a câștigat cel mai mult față de tine în runda {list}.",
  "{bot} gained most on you in rounds {list}.": "{bot} a câștigat cel mai mult față de tine în rundele {list}.",
  "{deal}: you {you}, {bot} {botpts}": "{deal}: tu {you}, {bot} {botpts}",
  "{games} on this device.": "{games} pe acest dispozitiv.",
  "All": "Toate",
  "Solo": "Singur",
  "Online": "Online",
  "Both": "Ambele",
  "Classic": "Clasic",
  "classic": "clasic",
  "geometric": "geometric",
  "No games match these filters yet.": "Niciun joc nu se potrivește acestor filtre.",
  "No finished games on this device yet. Your record starts with the next game you finish.": "Niciun joc terminat pe acest dispozitiv. Istoricul tău începe cu următorul joc pe care îl termini.",
  "Games": "Jocuri",
  "Won": "Câștigate",
  "{games}; fair share {fair}": "{games}; media așteptată {fair}",
  "Place": "Locul",
  "average, of {n} players": "în medie, din {n} jucători",
  "Last game": "Ultimul joc",
  "Last {n} games": "Ultimele {n} jocuri",
  "{place} of {n}, {score} points, {mode}": "{place} din {n}, {score} puncte, {mode}",
  "Your place in each game, newest on the right.": "Locul tău în fiecare joc, cel mai recent în dreapta.",
  "Bids by hand size": "Licitații după numărul de cărți",
  "Cards": "Cărți",
  "Rounds": "Runde",
  "Made": "Făcute",
  "Took − bid": "Luat − licitat",
  "Points": "Puncte",
  "<b>Bold</b>: you. Grey: the bots in the same games. Took − bid above zero means you take more tricks than you bid.": "<b>Îngroșat</b>: tu. Gri: boții din aceleași jocuri. Luat − licitat peste zero înseamnă că iei mai multe mâini decât licitezi.",
  "Bidding last": "Ultimul la licitație",
  "When you deal and bid last, with one total ruled out, you make {a} of your bids (bots {b}). From other seats: {c} (bots {d}).": "Când împarți și licitezi ultimul, cu un total interzis, îți faci {a} din licitații (boții {b}). De pe celelalte locuri: {c} (boții {d}).",
  "Bid check": "Verificarea licitației",
  "Over {bids} in {games}, your bids average {avg} points behind the engine's pick ({pergame} a game). {flagged} of bids were more than a point behind.": "În {bids} din {games}, licitațiile tale sunt în medie cu {avg} puncte sub alegerea motorului ({pergame} pe joc). {flagged} dintre licitații au fost cu peste un punct sub.",
  "Luck vs skill": "Noroc sau pricepere",
  "Over {games} with a bot in your seat: your cards averaged {cards} a game against the table, your play {play} a game against the bot{se}.": "În {games} cu un bot pe locul tău: cărțile tale au adus în medie {cards} pe joc față de masă, jocul tău {play} pe joc față de bot{se}.",
  " (± {se}, one standard error)": " (± {se}, o eroare standard)",
  "A single game swings about ±10 points, so give this a few more games before reading much into it.": "Un singur joc variază cu aproximativ ±10 puncte, așa că mai joacă câteva până să tragi concluzii.",
  "Play above zero means you score more than a strong bot would with your exact cards.": "Joc peste zero înseamnă că faci mai multe puncte decât ar face un bot puternic cu exact cărțile tale.",
  "Against each player": "Față de fiecare jucător",
  "Player": "Jucător",
  "You ahead": "Tu înainte",
  "Margin": "Diferență",
  "(person)": "(om)",
  "You ahead: games where you finished above them. Margin: your score minus theirs, per game.": "Tu înainte: jocurile în care ai terminat peste ei. Diferență: scorul tău minus al lor, pe joc.",
  "Back": "Înapoi",
  "Language": "Limba",
  "Romanian Whist": "Whist românesc",
  "Romanian Whist — Online": "Whist românesc — online",
  "Bid exactly the tricks you will take. Hands grow from one card to eight, then back.": "Licitezi exact câte mâini vei lua. Se joacă de la o carte la opt, apoi înapoi.",
  "How many at the table?": "Câți sunteți la masă?",
  "3 players": "3 jucători",
  "4 players": "4 jucători",
  "5 players": "5 jucători",
  "6 players": "6 jucători",
  "Players, you included. Pick a number to deal.": "Jucători, cu tine cu tot. Alege un număr și se împart cărțile.",
  "takes a free seat": "ocupă un loc liber",
  "Bid-conditioned Monte Carlo player, tournament tuned.": "Jucător Monte Carlo care ține cont de licitații, reglat în turnee.",
  "Monte Carlo player with exact endgame search.": "Jucător Monte Carlo cu calcul exact la final.",
  "plays with your API key": "joacă cu cheia ta API",
  "Gemini API key": "Cheia API Gemini",
  "The key stays in this browser.": "Cheia rămâne în acest browser.",
  "(TypeSafe) takes a seat": "(TypeSafe) ocupă un loc",
  "Runs through the local proxy. If the API is down, a Monte Carlo player stands in.": "Merge prin proxy-ul local. Dacă API-ul nu răspunde, joacă în loc un jucător Monte Carlo.",
  "Geometric scoring": "Punctaj geometric",
  "Made bid B scores 5 + B(B+1)/2. Missing by d costs d(d+1)/2.": "Licitația B făcută aduce 5 + B(B+1)/2. O greșeală de d mâini costă d(d+1)/2.",
  "Fast play": "Joc rapid",
  "Makes your forced moves for you: the only allowed bid, the only playable card, and interchangeable cards like 9-8-7 of a suit.": "Face în locul tău mutările forțate: singura licitație permisă, singura carte care se poate juca și cărțile echivalente, ca 9-8-7 din aceeași culoare.",
  "Play online with friends": "Joacă online cu prietenii",
  "Play online": "Joacă online",
  "Open a table and send the link to friends. The computer takes any seat nobody fills.": "Deschide o masă și trimite linkul prietenilor. Calculatorul ia locurile pe care nu le ocupă nimeni.",
  "Your name": "Numele tău",
  "Name": "Nume",
  "Players, you included.": "Jucători, cu tine cu tot.",
  "Open the table": "Deschide masa",
  "Play solo instead": "Joacă singur",
  "Table": "Masa",
  "Send this link to the people you want at the table.": "Trimite linkul celor pe care îi vrei la masă.",
  "Invite link": "Link de invitație",
  "Copy link": "Copiază linkul",
  "Copied!": "Copiat!",
  "Open seats go to the computer when you start.": "Locurile libere le ia calculatorul când începi.",
  "Start the game": "Începe jocul",
  "Join table": "Intră la masa",
  "Romanian Whist: bid exactly the tricks you will take.": "Whist românesc: licitezi exact câte mâini vei lua.",
  "Join the table": "Intră la masă",
  "Play online instead": "Joacă online",
  "Table chat": "Chatul mesei",
  "Write to the table": "Scrie la masă",
  "Send": "Trimite",
  "open": "liber",
  "host": "gazdă",
  "joined": "a intrat",
  "waiting": "așteaptă",
  "Enter your name to join.": "Scrie-ți numele ca să intri.",
  "Connecting…": "Se conectează…",
  "No table with this code. Check the link.": "Nu există nicio masă cu acest cod. Verifică linkul.",
  "This game has already started.": "Jocul a început deja.",
  "Every seat is taken.": "Toate locurile sunt ocupate.",
  "You are in. Waiting for the host to start.": "Ești la masă. Așteptăm ca gazda să înceapă.",
  "That game has already started. Open your own table below.": "Jocul acela a început deja. Deschide-ți propria masă mai jos.",
  "Game over": "Joc încheiat",
  "The host ended the game.": "Gazda a încheiat jocul.",
  "Back to the menu": "Înapoi la meniu",
  "End the game for everyone at the table?": "Închei jocul pentru toată lumea de la masă?",
  "Game over. Thanks for playing.": "Joc încheiat. Mulțumim că ai jucat.",
  "New table": "Masă nouă",
  "Rematch": "Revanșă",
  "Deal now": "Împarte acum",
  "Leave the table": "Pleacă de la masă",
  "Rematch coming…": "Vine revanșa…",
  "Rematch: waiting for {names}. Deal now and a bot takes the seat of anyone not back.": "Revanșă: îi așteptăm pe {names}. Dacă împarți acum, un bot ia locul celor care nu s-au întors.",
  "{host} started a rematch: same seats and scoring. Dealing as soon as everyone is back.": "{host} a pornit o revanșă: aceleași locuri, același punctaj. Se împarte imediat ce s-au întors toți.",
  "The host": "Gazda",
  "Rematch dealt": "Revanșa a început",
  "You were away when the rematch was dealt, so a bot took your seat.": "Nu erai aici când s-a împărțit revanșa, așa că un bot ți-a luat locul.",
};
translateStatic();

// ─── Sound Engine (Web Audio API synth) ───
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
// Mute: remembered per device; every sound goes through playTone/playNoise
let soundMuted = false;
try { soundMuted = localStorage.getItem('wist-muted') === '1'; } catch (e) {}
function toggleMute() {
  soundMuted = !soundMuted;
  try { localStorage.setItem('wist-muted', soundMuted ? '1' : '0'); } catch (e) {}
  if (audioCtx) (soundMuted ? audioCtx.suspend() : audioCtx.resume()).catch(() => {});
  if (G && G.roundSequence) renderTopBar();
}
function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx({ latencyHint: 'balanced' });
}

// Every sound goes through one limiter, so overlapping sounds can't clip
let audioOutNode = null;
function audioOut() {
  if (!audioOutNode) {
    audioOutNode = audioCtx.createDynamicsCompressor();
    audioOutNode.threshold.value = -10; audioOutNode.knee.value = 6; audioOutNode.ratio.value = 12;
    audioOutNode.attack.value = 0.002; audioOutNode.release.value = 0.12;
    audioOutNode.connect(audioCtx.destination);
  }
  return audioOutNode;
}
function playTone(freq, duration, type = 'sine', vol = 0.15, detune = 0, at = 0) {
  if (soundMuted) return;
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const t = audioCtx.currentTime + at;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(audioOut());
  osc.start(t);
  osc.stop(t + duration);
}

// Filtered noise — real card texture (broadband, not pure tones).
// filterFreqEnd: optional sweep for air/swoosh (Hz at end of envelope).
function playNoise(duration, vol, filterType, filterFreq, q = 0.8, filterFreqEnd = null, at = 0) {
  if (soundMuted) return;
  ensureAudio();
  const sr = audioCtx.sampleRate;
  const len = Math.max(1, Math.floor(sr * duration));
  const buf = audioCtx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  // Slightly pink-leaning noise (less harsh than pure white)
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = white * 0.55 + last * 0.45;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filt = audioCtx.createBiquadFilter();
  filt.type = filterType;
  filt.Q.value = q;
  const t = audioCtx.currentTime + at;
  filt.frequency.setValueAtTime(filterFreq, t);
  if (filterFreqEnd != null) {
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreqEnd), t + duration);
  }
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filt); filt.connect(gain); gain.connect(audioOut());
  src.start(t);
  src.stop(t + duration);
}

// Card in flight: air swoosh (noise filter falls) → paper snap → table body
function sfxCardSwoosh(vol = 1) {
  // Air: bright → dull over ~70ms
  playNoise(0.07, 0.14 * vol, 'bandpass', 4200 + Math.random() * 800, 0.55, 900 + Math.random() * 300);
  playNoise(0.055, 0.09 * vol, 'highpass', 2800, 0.5, 700);
}

function sfxCardSnap(vol = 1, at = 0) {
  playNoise(0.038, 0.28 * vol, 'highpass', 2000 + Math.random() * 600, 0.8, null, at);
  playNoise(0.028, 0.20 * vol, 'bandpass', 2800 + Math.random() * 800, 0.75, null, at);
}

function sfxCardTable(vol = 1, at = 0) {
  // Soft felt/wood thud
  playNoise(0.05, 0.12 * vol, 'lowpass', 280 + Math.random() * 80, 0.6, null, at);
  playTone(110 + Math.random() * 30, 0.06, 'sine', 0.04 * vol, 0, at);
}

// One card played: swoosh → snap → table (variants for soft vs hard drop)
function sfxCardFlick(vol = 1) {
  const hard = Math.random() > 0.45;
  const v = hard ? vol : vol * 0.82;
  sfxCardSwoosh(v * (hard ? 1 : 0.85));
  const snapAt = hard ? 28 : 38;
  // on the audio clock, so a busy page can't stretch the gaps
  sfxCardSnap(v, snapAt / 1000);
  sfxCardTable(v * (hard ? 1.05 : 0.9), (snapAt + (hard ? 8 : 12)) / 1000);
}

function sfxCardPlay() {
  sfxCardFlick(1);
}

// Dealing: riffle of short flicks (no full swoosh — too heavy for a riffle)
function sfxDeal(count = 8) {
  const n = Math.min(Math.max(count, 5), 14);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const delay = t;
    setTimeout(() => {
      playNoise(0.028, 0.18, 'highpass', 2300 + Math.random() * 900);
      playNoise(0.022, 0.12, 'bandpass', 3000 + Math.random() * 1000, 0.6);
    }, delay);
    t += Math.max(34, 64 - i * 2) + Math.random() * 12;
  }
}
function sfxBid() {
  playNoise(0.025, 0.14, 'bandpass', 1500, 1.2);
  playTone(440, 0.05, 'sine', 0.05);
}

// Trick win: cards scraped together into a stack (not an arcade arpeggio)
function sfxTrickWin() {
  // Soft gather whoosh
  playNoise(0.09, 0.11, 'bandpass', 1800, 0.5, 500);
  // Two quick paper scrapes as the pile is squared
  setTimeout(() => {
    playNoise(0.04, 0.16, 'highpass', 1600 + Math.random() * 400);
    playNoise(0.035, 0.10, 'lowpass', 400, 0.7);
  }, 45);
  setTimeout(() => {
    playNoise(0.035, 0.14, 'bandpass', 2200 + Math.random() * 500, 0.8);
    playTone(160 + Math.random() * 20, 0.07, 'sine', 0.035);
  }, 95);
  // Final settle on table
  setTimeout(() => {
    playNoise(0.06, 0.10, 'lowpass', 220, 0.5);
  }, 140);
}

function sfxRoundEnd() {
  // Longer rustle / settle, not a scale
  playNoise(0.14, 0.10, 'bandpass', 1400, 0.45, 350);
  setTimeout(() => playNoise(0.08, 0.12, 'highpass', 1800), 60);
  setTimeout(() => playNoise(0.10, 0.09, 'lowpass', 300), 120);
  setTimeout(() => playTone(330, 0.12, 'triangle', 0.05), 160);
}
function sfxGameOver() {
  const notes = [392, 523, 659, 784, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => {
      playTone(n, 0.25, 'triangle', 0.08);
      playTone(n * 1.005, 0.25, 'sine', 0.05);
    }, i * 120);
  });
}
function sfxForbidden() {
  // Soft muted slap
  playNoise(0.05, 0.14, 'lowpass', 500, 0.8);
  playTone(180, 0.1, 'sine', 0.06);
  setTimeout(() => playTone(140, 0.12, 'sine', 0.05), 90);
}
function sfxAutoPlay() {
  // Quiet card play, not a ding
  sfxCardFlick(0.45);
}

// ─── Constants ───
function logGameEnd() {
  if (!G.gameLog) return;
  G.gameLog.finalScores = {};
  for (let i = 0; i < G.numPlayers; i++) {
    G.gameLog.finalScores[i] = { name: G.playerNames[i], score: G.scores[i] };
  }
  const winner = G.scores.indexOf(Math.max(...G.scores));
  G.gameLog.winner = G.playerNames[winner];
  G.gameLog.winnerScore = G.scores[winner];
  G.gameLog.mode = 'solo';
  G.gameLog.bidCheck = bidCheckTotals();
  G.gameLog.playCheck = playCheckTotals();
  statsAdd(statsRecordFromGame(ME, false, G.playerNames.map((_, i) => i).filter(i => i !== ME)));

  // Save to localStorage
  try {
    const logs = JSON.parse(localStorage.getItem('wist-game-logs') || '[]');
    logs.push(G.gameLog);
    while (logs.length > 50) logs.shift();
    localStorage.setItem('wist-game-logs', JSON.stringify(logs));
  } catch(e) {}
  // Save to Firebase (wait for anonymous auth — rules deny unauthenticated writes)
  if (fbDb) {
    const key = G.gameLog.timestamp.replace(/[:.]/g, '-');
    const log = G.gameLog;
    (fbAuthReady || Promise.resolve())
      .then(() => fbDb.ref(`gameLogs/${key}`).set(log))
      .catch(e => console.warn('Firebase log save failed', e));
  }
}

function downloadGameLogs() {
  if (fbDb) {
    const btn = document.getElementById('download-btn');
    if (btn) btn.textContent = t('Loading…');
    (fbAuthReady || Promise.resolve())
      .then(() => fbDb.ref('gameLogs').orderByChild('timestamp').once('value'))
      .then(snap => {
      const logs = [];
      snap.forEach(c => { const v = c.val(); if (v && v.timestamp) logs.push(v); });
      if (btn) btn.textContent = t('Download game logs');
      if (!logs.length) { alert(t('No games recorded yet.')); return; }
      const blob = new Blob([JSON.stringify(logs, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whist-games-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => {
      if (btn) btn.textContent = t('Download game logs');
      downloadLocalLogs();
    });
  } else {
    downloadLocalLogs();
  }
}

function downloadLocalLogs() {
  try {
    const logs = JSON.parse(localStorage.getItem('wist-game-logs') || '[]');
    if (logs.length === 0) { alert(t('No games recorded yet.')); return; }
    const blob = new Blob([JSON.stringify(logs, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whist-games-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert(t('Error downloading logs.')); }
}

function onCodexToggle() {
  const on = document.getElementById('codex-toggle').checked;
  window._includeCodex = on;
  localStorage.setItem('wist-include-codex', on ? '1' : '0');
  const hint = document.getElementById('codex-hint');
  if (hint) hint.style.opacity = on ? '1' : '0.55';
}

function applyCodexSetting() {
  const toggle = document.getElementById('codex-toggle');
  if (toggle) {
    window._includeCodex = !!toggle.checked;
    localStorage.setItem('wist-include-codex', toggle.checked ? '1' : '0');
  } else if (window._includeCodex === undefined) {
    window._includeCodex = true;
  }
}

function onGrokToggle() {
  const on = document.getElementById('grok-toggle').checked;
  window._includeGrok = on;
  localStorage.setItem('wist-include-grok', on ? '1' : '0');
  const hint = document.getElementById('grok-hint');
  if (hint) hint.style.opacity = on ? '1' : '0.55';
}

function applyGrokSetting() {
  const toggle = document.getElementById('grok-toggle');
  if (toggle) {
    window._includeGrok = !!toggle.checked;
    localStorage.setItem('wist-include-grok', toggle.checked ? '1' : '0');
  } else if (window._includeGrok === undefined) {
    window._includeGrok = true; // default on
  }
}

function onGeminiToggle() {
  const on = document.getElementById('gemini-toggle').checked;
  const keyInput = document.getElementById('gemini-key');
  const hint = document.getElementById('gemini-hint');
  keyInput.style.display = on ? 'block' : 'none';
  hint.style.display = on ? 'block' : 'none';
  if (on) {
    keyInput.value = keyInput.value || localStorage.getItem('wist-gemini-key') || '';
    keyInput.focus();
  }
}

// Read the Gemini toggle/key from the setup screen and set the flag for pickOpponents
function applyGeminiSetting() {
  const toggle = document.getElementById('gemini-toggle');
  if (toggle && toggle.checked) {
    const key = (document.getElementById('gemini-key').value || '').trim();
    if (key) {
      window._geminiApiKey = key;
      localStorage.setItem('wist-gemini-key', key);
      return;
    }
  }
  // toggle off and no URL-provided key → no AI player
  if (toggle && !toggle.checked) window._geminiApiKey = null;
}

function onJevToggle() {
  const on = document.getElementById('jev-toggle').checked;
  const hint = document.getElementById('jev-hint');
  if (hint) hint.style.display = on ? 'block' : 'none';
  window._includeJev = on;
  localStorage.setItem('wist-include-jev', on ? '1' : '0');
}

function applyJevSetting() {
  const toggle = document.getElementById('jev-toggle');
  window._includeJev = toggle ? !!toggle.checked : window._includeJev !== false;
}

function onScoringToggle() {
  const on = document.getElementById('geometric-toggle').checked;
  document.getElementById('geometric-hint').style.display = on ? 'block' : 'none';
}

// Read the geometric-scoring toggle and set the active mode for initState
function applyScoringSetting() {
  const toggle = document.getElementById('geometric-toggle');
  const on = !!(toggle && toggle.checked);
  window._scoringMode = on ? 'geometric' : 'linear';
  localStorage.setItem('wist-scoring-mode', window._scoringMode);
}

function startGame(numPlayers) {
  ensureAudio();
  applyCodexSetting();
  applyGrokSetting();
  applyGeminiSetting();
  applyJevSetting();
  applyScoringSetting();
  // Randomize opponents each game
  const opponents = pickOpponents(numPlayers - 1);
  PLAYER_NAMES_MAP[numPlayers] = ['You', ...opponents];
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('game-screen').classList.add('active');
  initState(numPlayers);
  G.showWinChances = !!document.getElementById('win-chances-toggle')?.checked;
  initGameLog();
  startRound();
}

function getSuggestion() {
  if (G.phase !== 'playing' || currentPlayerToAct() !== 0) return null;
  const hand = G.hands[0];
  const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
  const legal = getLegalMoves(hand, ledSuit, G.trumpSuit);
  if (legal.length <= 1) return null;

  const bid = G.bids[0];
  const won = G.tricksWon[0];
  const needMore = won < bid;
  const hasExact = won === bid;
  const stillNeeded = bid - won;

  // LEADING
  if (G.currentTrick.length === 0) {
    if (needMore) {
      const sureWinners = legal.filter(c => isHighestRemaining(c, hand));
      const nonTrump = legal.filter(c => c.suit !== G.trumpSuit);
      const ntWinners = sureWinners.filter(c => c.suit !== G.trumpSuit);

      if (ntWinners.length > 0) {
        return { card: ntWinners[0], reason: t('This is the highest {suit} left — a sure winner. Lead it now to secure a trick.', { suit: SUIT_SYMBOL[ntWinners[0].suit] }) };
      }
      if (sureWinners.length > 0) {
        return { card: sureWinners[0], reason: t('Highest remaining in its suit — a sure trick. No higher card is out there.') };
      }

      // AK combo
      for (const s of SUITS) {
        if (s === G.trumpSuit) continue;
        const sCards = nonTrump.filter(c => c.suit === s).sort((a,b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
        if (sCards.length >= 2 && sCards[0].rank === 'A') {
          return { card: sCards[0], reason: t('You hold Ace-King of {suit}. Lead the Ace to cash it safely while you control the suit.', { suit: SUIT_SYMBOL[s] }) };
        }
      }

      const best = pickHighest(nonTrump.length > 0 ? nonTrump : legal);
      return { card: best, reason: t('You need {n} more. Lead your strongest card to try to win.', { n: nOf(stillNeeded, 'trick', 'tricks', 'mână', 'mâini') }) };
    } else {
      // Has enough — duck
      const nonTrump = legal.filter(c => c.suit !== G.trumpSuit);
      if (nonTrump.length > 0) {
        const low = pickLowest(nonTrump);
        return { card: low, reason: t("You've made your bid. Lead low to avoid winning: {card} is your safest lead.", { card: cardShort(low) }) };
      }
      return { card: pickLowest(legal), reason: t("You've made your bid. Lead your lowest card to minimise the chance of winning.") };
    }
  }

  // FOLLOWING
  const winEntry = currentWinner();
  const winCard = winEntry.card;
  const winnerName = G.playerNames[winEntry.playerIndex];
  const beaters = legal.filter(c => cardBeats(c, winCard, ledSuit));
  const losers = legal.filter(c => !cardBeats(c, winCard, ledSuit));
  const isLast = G.currentTrick.length === G.numPlayers - 1;

  if (needMore) {
    if (beaters.length > 0) {
      if (isLast) {
        const cheap = pickLowest(beaters);
        return { card: cheap, reason: t("You're last to play. {card} is the cheapest card that beats {name}'s {top}.", { card: cardShort(cheap), name: escHTML(winnerName), top: cardShort(winCard) }) };
      }
      const sure = beaters.filter(c => isHighestRemaining(c, hand));
      if (sure.length > 0) {
        return { card: pickLowest(sure), reason: t("This is the highest remaining in its suit — it can't be beaten. Play it to secure the trick.") };
      }
      return { card: pickHighest(beaters), reason: t('You need tricks and {n} can beat {name}. Play high to hold the lead.', { n: nOf(beaters.length, 'card', 'cards', 'carte', 'cărți'), name: escHTML(winnerName) }) };
    }
    const dump = pickLowest(legal);
    return { card: dump, reason: t("You can't beat {name}'s {top}. Dump your lowest card ({card}) to save better cards.", { name: escHTML(winnerName), top: cardShort(winCard), card: cardShort(dump) }) };
  }

  if (hasExact) {
    if (losers.length > 0) {
      const hi = pickHighest(losers);
      return { card: hi, reason: t("You've made your bid — don't win this! Play {card} (the highest card that still loses) to shed a dangerous card.", { card: cardShort(hi) }) };
    }
    return { card: pickLowest(legal), reason: t("You're forced to win here. Play your lowest to minimise damage.") };
  }

  // Over-bid
  const low = pickLowest(losers.length > 0 ? losers : legal);
  return { card: low, reason: t('You have too many tricks. Play low and try to lose.') };
}

let suggestionVisible = false;

function toggleSuggestion() {
  const box = document.getElementById('suggestion-box');
  if (box) {
    box.remove();
    suggestionVisible = false;
    // Remove suggested highlight
    document.querySelectorAll('.card.suggested').forEach(el => el.classList.remove('suggested'));
    return;
  }
  const suggestion = getSuggestion();
  if (!suggestion) return;

  suggestionVisible = true;
  const sym = SUIT_SYMBOL[suggestion.card.suit];
  const html = `<div id="suggestion-box">
    <span class="suggestion-card">${t('Try {card}.', { card: suggestion.card.rank + sym })}</span> ${suggestion.reason}
    <div class="suggestion-reason">${t('Tap it to play, or pick another card.')}</div>
  </div>`;
  document.getElementById('me-area').insertAdjacentHTML('beforeend', html);

  // Highlight the suggested card
  document.querySelectorAll('#hand-area .card').forEach(el => {
    if (el.dataset.rank === suggestion.card.rank && el.dataset.suit === suggestion.card.suit) {
      el.classList.add('suggested');
    }
  });
}

function trickWinReason(entries, winnerIdx, trumpSuit) {
  const ledSuit = entries[0].card.suit;
  const winCard = entries.find(e => e.playerIndex === winnerIdx).card;
  if (trumpSuit && winCard.suit === trumpSuit && ledSuit !== trumpSuit) return t('trump {s}', { s: SUIT_SYMBOL[trumpSuit] });
  return t('high {s}', { s: SUIT_SYMBOL[ledSuit] });
}

function setFastPlay(on) {
  window._fastPlay = !!on;
  try { localStorage.setItem('wist-fast-play', on ? '1' : '0'); } catch (e) {}
  document.querySelectorAll('.fast-toggle').forEach(el => { el.checked = !!on; });
}
function checkAutoBid() {
  if (autoBidTimer || G.phase !== 'bidding' || G.currentBidderIndex !== 0) return;
  scheduleBidCheck();
  const bid = autoBidChoice();
  if (bid === null) return;
  autoBidTimer = setTimeout(() => {
    autoBidTimer = null;
    if (G.phase === 'bidding' && G.currentBidderIndex === 0) humanBid(bid);
  }, 500);
}

// ─── Rendering ───
// The table is a round table seen from your chair: you sit at the bottom
// (270°), the next player in turn order to your left, and so on clockwise.
// Each seat gets a unit vector (ux, uy) from the table centre; CSS places the
// seat on an ellipse along it and pulls the seat's trick card back toward the
// centre, so cards never sit on their own seat at any screen size.

function escHTML(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function seatGeom(p) {
  const n = G.numPlayers;
  const a = (270 - ((p - ME + n) % n) * 360 / n) * Math.PI / 180;
  const f = v => Math.round(v * 1000) / 1000 || 0;
  return { ux: f(Math.cos(a)), uy: f(-Math.sin(a)) };
}

function playerLabel(p) { return p === ME ? t('You') : escHTML(G.playerNames[p]); }
function faceOf(p) { return p === ME ? '🐺' : getFace(G.playerNames[p]); }
function suitTxt(s) { return `<span class="suit ${SUIT_COLOR[s]}">${SUIT_SYMBOL[s]}</span>`; }
function cardName(card) {
  return LANG === 'ro' ? `${RANK_NAMES_RO[card.rank] || card.rank} de ${SUIT_NAMES_RO[card.suit]}` : `${RANK_NAMES[card.rank]} of ${SUIT_NAMES[card.suit]}`;
}
function cardShort(card) { return card.rank + SUIT_SYMBOL[card.suit]; }

// Stable small tilt per card so a trick looks tossed onto the table, not gridded
function cardTilt(card) {
  let h = 0;
  for (const ch of card.rank + card.suit) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 9) - 4) * 1.2;
}

function isActive(p) {
  return (G.phase === 'bidding' && G.currentBidderIndex === p) ||
         (G.phase === 'playing' && currentPlayerToAct() === p);
}

// A player's bid as a number. Once play starts, pips show progress:
// filled = taken, hollow = still needed, red = over the bid.
function bidHTML(p) {
  const bid = G.bids[p];
  if (bid === null || bid === undefined) {
    if (p !== ME && G.phase === 'bidding' && G.currentBidderIndex === p) return `<span class="bid thinking">${t('bidding…')}</span>`;
    return `<span class="bid none" title="${t('No bid yet')}"><small>${t('bid')}</small><b>–</b></span>`;
  }
  const won = G.biddingComplete ? G.tricksWon[p] : 0;
  const state = !G.biddingComplete ? '' : won === bid ? 'made' : won > bid ? 'bust' : '';
  const count = G.biddingComplete ? Math.max(bid, won) : 0;
  let pips = '';
  for (let i = 0; i < count; i++) {
    pips += `<i class="pip ${i < Math.min(won, bid) ? 'won' : i < bid ? '' : 'over'}"></i>`;
  }
  const label = G.biddingComplete ? t('bid {bid}, took {won}', { bid, won }) : t('bid {bid}', { bid });
  return `<span class="bid ${state}" title="${label}" aria-label="${label}"><small>${t('bid')}</small><b>${bid}</b>`
    + (pips ? `<span class="pips${count > 5 ? ' dense' : ''}">${pips}</span>` : '') + '</span>';
}

function cardHTML(card, extra = '', tag = 'div', attrs = '') {
  const sym = SUIT_SYMBOL[card.suit];
  return `<${tag} class="card ${SUIT_COLOR[card.suit]} ${extra}" data-rank="${card.rank}" data-suit="${card.suit}" ${attrs}>`
    + `<span class="corner tl"><span class="rank">${card.rank}</span><span class="suit-sym">${sym}</span></span>`
    + `<span class="center-pip">${sym}</span>`
    + `<span class="corner br"><span class="rank">${card.rank}</span><span class="suit-sym">${sym}</span></span>`
    + `</${tag}>`;
}

// ─── Play from the keyboard ───
// On your turn ←/→ step through the cards you may play (Home/End jump to
// the ends) and Enter or Space plays the one picked; the first arrow press
// picks a card without playing it. Ignored while typing or with a sheet open.
let kbdCard = null;
function markKbdCard() {
  let any = false;
  document.querySelectorAll('#hand-area .card').forEach(el => {
    const on = el.dataset.rank + el.dataset.suit === kbdCard && el.classList.contains('playable');
    el.classList.toggle('kbd-sel', on);
    any = any || on;
  });
  document.getElementById('hand-area')?.classList.toggle('has-kbd', any);
}
document.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const me = ME;
  if (!G || G.phase !== 'playing' || currentPlayerToAct() !== me || G.currentTrick.length >= G.numPlayers || document.querySelector('.overlay')) return;
  const hand = G.hands[me] || [];
  const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
  const legal = getLegalMoves(hand, led, G.trumpSuit);
  const cards = hand.filter(c => legal.some(l => l.rank === c.rank && l.suit === c.suit));   // in hand order
  if (!cards.length) return;
  e.preventDefault();
  let i = cards.findIndex(c => c.rank + c.suit === kbdCard);
  if (e.key === 'Enter' || e.key === ' ') {
    if (i >= 0) { const c = cards[i]; kbdCard = null; humanPlayCard(c.rank, c.suit); return; }
    i = 0;
  } else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = cards.length - 1;
  else if (i < 0) i = e.key === 'ArrowLeft' ? cards.length - 1 : 0;
  else i = (i + (e.key === 'ArrowLeft' ? -1 : 1) + cards.length) % cards.length;
  kbdCard = cards[i].rank + cards[i].suit;
  markKbdCard();
});

// On your bidding turn the arrows step through the allowed bids the same way
// (the forbidden one is skipped) and Enter or Space places the picked bid.
let kbdBid = null;
function markKbdBid() {
  document.querySelectorAll('#action-bar .bid-btn').forEach((el, i) => el.classList.toggle('kbd-sel', i === kbdBid));
}
document.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (!G || G.phase !== 'bidding' || G.currentBidderIndex !== ME || document.querySelector('.overlay')) return;
  const { valid } = getValidBids(G.cardsPerPlayer, G.bids, isLastBidder());
  if (!valid.length) return;
  e.preventDefault();
  let i = valid.indexOf(kbdBid);
  if (e.key === 'Enter' || e.key === ' ') {
    if (i >= 0) { const bid = valid[i]; kbdBid = null; humanBid(bid); return; }
    i = 0;
  } else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = valid.length - 1;
  else {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    i = i < 0 ? (back ? valid.length - 1 : 0) : (i + (back ? -1 : 1) + valid.length) % valid.length;
  }
  kbdBid = valid[i];
  markKbdBid();
});

// ─── Bid by voice ───
// The browser's own speech recognition (Chrome, Edge, Safari; no library).
// While the mic is on, a number heard on your bidding turn places that bid,
// in English or Romanian ("two", "doi", "2"); a forbidden one buzzes. Chrome
// and Safari send the audio to Google / Apple to transcribe it.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_WORDS = {
  zero: 0, oh: 0, nil: 0, none: 0, nothing: 0, nimic: 0, niciuna: 0, nicio: 0, niciunul: 0,
  one: 1, won: 1, unu: 1, una: 1, un: 1, unul: 1,
  two: 2, to: 2, too: 2, doi: 2, doua: 2, 'două': 2,
  three: 3, tree: 3, free: 3, trei: 3,
  four: 4, for: 4, fore: 4, patru: 4,
  five: 5, cinci: 5,
  six: 6, sase: 6, 'șase': 6, 'şase': 6,
  seven: 7, sapte: 7, 'șapte': 7, 'şapte': 7,
  eight: 8, ate: 8, opt: 8,
};
let voice = null, voiceOn = false;
// The last number in what was heard ("I bid two" -> 2), or null
function voiceNumber(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\d]+/gu) || [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (/^\d$/.test(w)) return +w;
    if (w in VOICE_WORDS) return VOICE_WORDS[w];
  }
  return null;
}
// "next" on the round sheet deals the next round (or shows the final scores);
// on a sheet that offers to end the game it means Play on, never End game
const VOICE_NEXT = /(?<!\p{L})(next|nexts|text|necks|nest|deal|continue|go on|gata|urm[aă]toarea|mai departe|[iî]mparte|continu[aă]|hai)(?!\p{L})/iu;
function voiceNext(text) {
  const ov = document.getElementById('round-overlay');
  if (!ov || document.querySelectorAll('.overlay').length > 1 || !VOICE_NEXT.test(text)) return false;
  const btn = ov.querySelector('button[onclick="nextRound()"]') || ov.querySelector('.sheet-foot .btn-ink[onclick="showGameOver()"]');
  if (!btn) return false;   // a guest online: the host deals
  btn.click();
  return true;
}
function voiceHeard(text) {
  if (voiceNext(text)) return true;
  if (!G || G.phase !== 'bidding' || G.currentBidderIndex !== ME || document.querySelector('.overlay')) return false;
  const bid = voiceNumber(text);
  if (bid === null || bid > G.cardsPerPlayer) return false;
  if (getValidBids(G.cardsPerPlayer, G.bids, isLastBidder()).valid.includes(bid)) { humanBid(bid); return true; }
  sfxForbidden();
  const btn = document.querySelectorAll('#action-bar .bid-btn')[bid];
  if (btn) { btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope'); }
  return true;
}
// A short note under your hand: what the mic is doing, or why it can't
function voiceNote(msg, bad) {
  document.getElementById('voice-note')?.remove();
  if (!msg) return;
  document.getElementById('me-area').insertAdjacentHTML('beforeend', `<div id="voice-note" class="${bad ? 'bad' : ''}" role="status">🎤 ${msg}</div>`);
  if (!bad) setTimeout(() => { const n = document.getElementById('voice-note'); if (n && n.textContent.includes(msg)) n.remove(); }, 3500);
}
const VOICE_ERRORS = {
  'not-allowed': 'The microphone is blocked for this site. Allow it in the site settings (the icon left of the address), then tap 🎤 again.',
  'service-not-allowed': 'This browser has speech recognition turned off. On a Mac with Safari, turn on Dictation in System Settings → Keyboard. Chrome works too.',
  'network': 'Can\'t reach the speech service (Google\'s in Chrome). Check the connection, VPN or firewall; Brave and Arc don\'t include one.',
  'audio-capture': 'No microphone found.',
};
function voiceFail(code) {
  voiceOn = false;
  if (voice) { voice.onend = null; try { voice.abort(); } catch (e) {} voice = null; }
  voiceNote(t(VOICE_ERRORS[code] || 'Voice bidding stopped ({code}).', { code }), true);
  renderTopBar();
}
// Started straight from the tap: Safari only allows it there, and starting
// is what brings up the microphone prompt
function toggleVoice() {
  if (!SpeechRec) return;
  if (voiceOn) { voiceOn = false; if (voice) { voice.onend = null; voice.abort(); voice = null; } voiceNote(''); renderTopBar(); return; }
  startVoice();
}
// The listening language is its own choice (you may play in English and say
// numbers in Romanian): remembered on this device, Romanian by default when
// the game or the browser is Romanian. Tap the note to switch.
function voiceLang() {
  let v = null;
  try { v = localStorage.getItem('wist-voice-lang'); } catch (e) {}
  return v || (LANG === 'ro' || (navigator.languages || []).some(l => /^ro\b/i.test(l)) ? 'ro' : 'en');
}
function voiceLangNote() {
  const ro = voiceLang() === 'ro';
  voiceNote(t(ro ? 'Listening in Romanian (una, două, gata). Tap here for English.' : 'Listening in English (one, two, next). Tap here for Romanian.'));
  const n = document.getElementById('voice-note');
  if (n) { n.style.cursor = 'pointer'; n.onclick = switchVoiceLang; }
}
function switchVoiceLang() {
  try { localStorage.setItem('wist-voice-lang', voiceLang() === 'ro' ? 'en' : 'ro'); } catch (e) {}
  if (voice) { voice.lang = voiceLang() === 'ro' ? 'ro-RO' : 'en-US'; voice.abort(); }   // restarts in the new language
  voiceLangNote();
}
function startVoice() {
  voiceOn = !voiceOn;
  if (voiceOn) {
    voice = new SpeechRec();
    voice.lang = voiceLang() === 'ro' ? 'ro-RO' : 'en-US';
    voice.continuous = true;
    voice.interimResults = true;
    let used = -1, told = false, netFails = 0;   // a phrase acts once, even as its interim versions keep coming
    voice.onresult = e => {
      netFails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (i <= used) continue;
        const r = e.results[i];
        // a bare number acts at once; a longer phrase waits for its final form
        const text = r[0].transcript;
        if ((r.isFinal || (text.trim().split(/\s+/).length === 1 && (voiceNumber(text) !== null || VOICE_NEXT.test(text)))) && voiceHeard(text)) used = i;
      }
    };
    // browsers stop after silence; restart (a second later after a network hiccup)
    voice.onend = () => { if (voiceOn) setTimeout(() => { if (voiceOn && voice) try { voice.start(); } catch (e) {} }, netFails ? 1000 : 0); };
    voice.onstart = () => {
      used = -1;   // each session (browsers restart them after silence) numbers its phrases from 0
      if (!told) { told = true; voiceLangNote(); }
    };
    voice.onerror = e => {
      // Chrome's speech service drops now and then: retry quietly, give up after three in a row
      if (e.error === 'network' && ++netFails < 3) return;
      if (VOICE_ERRORS[e.error]) voiceFail(e.error);   // no-speech / aborted: just restart
    };
    try { voice.start(); } catch (e) { voiceFail('start'); return; }
  } else if (voice) { voice.onend = null; voice.abort(); voice = null; }
  renderTopBar();
}

// ─── Bid from the keyboard ───
// On your bidding turn a digit key (top row or keypad) places that bid; a bid
// that isn't allowed buzzes and shakes its button instead. Ignored while
// typing (chat) or while a sheet is open.
document.addEventListener('keydown', e => {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code) || /^([0-9])$/.exec(e.key);   // keypad works with NumLock off too
  if (e.ctrlKey || e.metaKey || e.altKey || !m) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (!G || G.phase !== 'bidding' || G.currentBidderIndex !== ME || document.querySelector('.overlay')) return;
  const bid = +m[1];
  if (bid > G.cardsPerPlayer) return;
  e.preventDefault();
  if (getValidBids(G.cardsPerPlayer, G.bids, isLastBidder()).valid.includes(bid)) { humanBid(bid); return; }
  sfxForbidden();
  const btn = document.querySelectorAll('#action-bar .bid-btn')[bid];
  if (btn) { btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope'); }
});

// ─── Your turn ───
// Players miss their turn when they look away, so the moment it becomes
// yours: a short chime, a buzz on phones, a pulsing action bar and the tab
// title says so. Still waiting 15 s later: one more chime. Moves the game makes
// for you (fast play) don't ring.
let turnCueKey = '', turnReminder = null;
function sfxYourTurn() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  playTone(660, 0.12, 'sine', 0.09);
  setTimeout(() => playTone(880, 0.16, 'sine', 0.09), 120);
}
function cueMyTurn() {
  const me = ME;
  let mine = false;
  if (G.phase === 'bidding' && G.currentBidderIndex === me) mine = autoBidChoice() === null;
  else if (G.phase === 'playing' && G.currentTrick.length < G.numPlayers && currentPlayerToAct() === me && (G.hands[me] || []).length) {
    const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
    mine = !autoPlayChoice(getLegalMoves(G.hands[me], led, G.trumpSuit), G.hands[me]);
  }
  const key = mine ? [G.gameLog && G.gameLog.timestamp, G.currentRoundIndex, G.phase, (G.trickHistory || []).length, G.currentTrick.length].join('|') : '';
  if (key === turnCueKey) return;
  turnCueKey = key;
  document.body.classList.toggle('my-turn', mine);
  if (enTitle !== null) document.title = (mine ? '● ' + t('Your turn') + ' — ' : '') + t(enTitle);
  clearTimeout(turnReminder);
  if (!mine) return;
  sfxYourTurn();
  if (navigator.vibrate) navigator.vibrate(120);
  turnReminder = setTimeout(() => {
    if (turnCueKey !== key) return;
    sfxYourTurn();
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  }, 15000);
}

function renderAll() {
  if (!G || !G.numPlayers || !G.roundSequence) return;
  renderTopBar();
  renderSeats();
  renderCenter();
  renderHand();
  renderActionBar();
  if (G.phase !== 'bidding' || G.currentBidderIndex !== ME) kbdBid = null;
  cueMyTurn();
}

function renderTopBar() {
  const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
  const cpp = G.cardsPerPlayer;
  const cls = !G.biddingComplete ? '' : sum > cpp ? 'over' : 'under';
  const title = !G.biddingComplete ? t('Bids placed so far, out of the tricks this round')
    : sum > cpp ? t('Overbid by {n}: someone has to miss', { n: sum - cpp })
    : t('Underbid by {n}: tricks are up for grabs', { n: cpp - sum });
  document.getElementById('topbar').innerHTML = '<div class="tb-row">'
    + `<span class="tb-round">${t('Round {n}', { n: G.currentRoundIndex + 1 })}<small>/${G.roundSequence.length}</small></span>`
    + eightCardRoundHTML()
    + `<span class="tb-stat" title="${title}"><span class="tb-lbl">${t('Bids')} </span><b class="${cls}">${sum}</b>/${cpp}</span>`
    + (G.scoringMode === 'geometric' ? `<span class="tb-mode">${t('Geometric')}</span>` : '')
    + '<span class="tb-spacer"></span>'
    + (SpeechRec ? `<button class="tb-btn icon voice${voiceOn ? ' on' : ''}" onclick="toggleVoice()" aria-pressed="${voiceOn}" aria-label="${t(voiceOn ? 'Voice bidding: on' : 'Voice bidding: off')}" title="${t(voiceOn ? 'Voice bidding: on — say a number on your turn' : 'Bid by voice')}">🎤</button>` : '')
    + `<button class="tb-btn icon" onclick="toggleMute()" aria-label="${t(soundMuted ? 'Turn sound on' : 'Mute')}" title="${t(soundMuted ? 'Sound off' : 'Sound on')}">${soundMuted ? '🔇' : '🔊'}</button>`
    + `<button class="tb-btn icon" onclick="resignGame()" aria-label="${t('Resign')}" title="${t('Resign')}">🏳</button>`
    + `<button class="tb-btn" onclick="showHistory()" title="${t('Score sheet')}">${t('Sheet')}</button>`
    + '</div>' + standingsHTML();
}

// Everyone ranked by total score; ties share a place.
function standingsHTML() {
  const order = G.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  let place = 0, prev = null;
  const rows = order.map((e, k) => {
    if (e.s !== prev) { place = k + 1; prev = e.s; }
    const cls = (e.i === ME ? ' me' : '') + (place === 1 ? ' lead' : '');
    return `<span class="st${cls}" title="${playerLabel(e.i)}: ${e.s}"><i>${place}</i><span class="st-name">${playerLabel(e.i)}</span><b>${e.s}</b></span>`;
  }).join('');
  return `<div class="standings${G.numPlayers >= 5 ? ' many' : ''}" style="--n:${G.numPlayers}" aria-label="${t('Standings')}">${rows}</div>`;
}

function renderSeats() {
  let html = '';
  for (let p = 0; p < G.numPlayers; p++) {
    if (p === ME) continue;
    const g = seatGeom(p);
    const style = getStyle(p);
    let src = '';
    if (style === 'gemini' && _geminiMode !== 'api') src = `<span class="src" title="${t('Gemini is offline; a built-in player stands in')}">⚙</span>`;
    if (style === 'jev' && G.decisionSource && G.decisionSource[p] === 'pimc') src = `<span class="src" title="${t('Jev is offline; a built-in player stands in')}">⚠</span>`;
    html += `<div class="seat${isActive(p) ? ' active' : ''}" style="--ux:${g.ux};--uy:${g.uy}">`
      + (G.dealerIndex === p ? `<span class="dealer" title="${t('Dealer')}">D</span>` : '')
      + `<div class="nm"><span class="face">${faceOf(p)}</span><span class="txt">${playerLabel(p)}</span>${src}</div>`
      + `<div class="row">${bidHTML(p)}</div>`
      + '</div>';
  }
  document.getElementById('seats').innerHTML = html;
}

let _lastPlayAnimKey = '';
function renderCenter() {
  const area = document.getElementById('trick-area');
  let entries = G.currentTrick || [];
  // Between tricks, the previous trick stays on the table, faded, until the next lead.
  const ghost = !entries.length && G.phase === 'playing' && G.lastTrick && G.lastTrick.entries && G.lastTrick.entries.length > 0;
  if (ghost) entries = G.lastTrick.entries;
  const resolving = G.phase === 'trickResult';
  const animKey = `${G.currentRoundIndex}:${(G.trickHistory || []).length}:${(G.currentTrick || []).length}`;
  const animate = !ghost && entries.length > 0 && animKey !== _lastPlayAnimKey && !resolving;
  let html = '';
  entries.forEach((e, i) => {
    const g = seatGeom(e.playerIndex);
    let cls = 'tcard';
    if (ghost) cls += ' ghost';
    else if (i === 0) cls += ' led';
    if (resolving) cls += e.playerIndex === G.trickWinnerIndex ? ' win' : ' lose';
    if (animate && i === entries.length - 1) cls += ' enter';
    const from = e.playerIndex === ME ? ';--from-y:118%' : '';
    html += `<div class="${cls}" style="--ux:${g.ux};--uy:${g.uy};--rot:${cardTilt(e.card)}deg${from}">${cardHTML(e.card, '', 'div', `aria-label="${playerLabel(e.playerIndex)}: ${cardName(e.card)}"`)}</div>`;
  });
  if (ghost) html += `<div class="ghost-cap">${t('Last trick')}</div>`;
  area.innerHTML = html;
  if (animate) _lastPlayAnimKey = animKey;

  const center = document.getElementById('table-center');
  center.innerHTML = G.trumpCard
    ? `<div class="trump-stack"><span class="card card-back small deck"></span>${cardHTML(G.trumpCard, 'small', 'div', `aria-label="${t('Trump card: {card}', { card: cardName(G.trumpCard) })}"`)}</div><div class="table-cap">${t('Trump')}</div>`
    : `<div class="no-trump">${t('No<br>trump')}</div>`;
}

function renderHand() {
  const el = document.getElementById('hand-area');
  const hand = G.hands[ME] || [];
  const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
  const myTurn = G.phase === 'playing' && currentPlayerToAct() === ME;
  const legal = myTurn ? getLegalMoves(hand, led, G.trumpSuit) : [];
  const autoCard = myTurn ? autoPlayChoice(legal, hand) : null;
  const mid = (hand.length - 1) / 2;
  el.style.setProperty('--n', Math.max(1, hand.length));
  el.innerHTML = hand.map((card, i) => {
    const ok = legal.some(c => c.rank === card.rank && c.suit === card.suit);
    let cls = myTurn ? (ok ? 'playable' : 'illegal') : '';
    if (autoCard && autoCard.rank === card.rank && autoCard.suit === card.suit) cls += ' auto-play-glow';
    const act = myTurn && ok ? `onclick="humanPlayCard('${card.rank}','${card.suit}')"` : (myTurn ? 'aria-disabled="true"' : '');
    return cardHTML(card, cls, 'button', `${act} style="--k:${(i - mid).toFixed(2)}" aria-label="${cardName(card)}${myTurn && !ok ? t(', cannot be played now') : ''}"`);
  }).join('');
  if (!myTurn) kbdCard = null;
  markKbdCard();
  renderMeStrip();
}

function renderMeStrip() {
  const el = document.getElementById('me-strip');
  el.className = isActive(ME) ? 'active' : '';
  el.innerHTML = (G.dealerIndex === ME ? `<span class="dealer" title="${t('You deal')}">D</span>` : '')
    + `<span class="nm">${faceOf(ME)} ${t('You')}</span>${bidHTML(ME)}`;
}

function renderActionBar() {
  const bar = document.getElementById('action-bar');
  if (G.phase === 'bidding' && G.currentBidderIndex === ME) {
    const cpp = G.cardsPerPlayer;
    const { valid, forbidden } = getValidBids(cpp, G.bids, isLastBidder());
    if (fastPlayOn() && valid.length === 1) {
      bar.innerHTML = `<span class="status-text you">${t('Only one bid is allowed: {bid}. Bidding it.', { bid: valid[0] })}</span>`;
      return;
    }
    const nb = cpp + 1;
    const cols = nb <= 6 ? nb : Math.ceil(nb / 2);
    let btns = '';
    for (let i = 0; i <= cpp; i++) {
      const ok = valid.includes(i);
      btns += `<button class="bid-btn${i === forbidden ? ' forbidden' : ''}" ${ok ? `onclick="humanBid(${i})"` : 'disabled'} aria-keyshortcuts="${i}" aria-label="${i === forbidden ? t('{n}, not allowed', { n: i }) : t('Bid {n}', { n: i })}">${i}</button>`;
    }
    const sum = G.bids.reduce((a, b) => a + (b ?? 0), 0);
    const placed = [];
    for (let k = 1; k <= G.numPlayers; k++) {
      const p = (G.dealerIndex + k) % G.numPlayers; // bidding starts left of the dealer
      if (p !== ME && G.bids[p] !== null) placed.push(`${playerLabel(p)} <b>${G.bids[p]}</b>`);
    }
    const others = placed.length ? t('{list}. Total {sum} of {cpp}.', { list: placed.join(', '), sum, cpp })
      : t('You bid first. {n} to take.', { n: nOf(cpp, 'trick', 'tricks', 'mână', 'mâini') });
    const warn = forbidden !== null ? `<span class="warn">${t("You can't bid {f}: the total would be {cpp}.", { f: forbidden, cpp })}</span>` : '';
    bar.innerHTML = `<div class="bid-panel"><div class="bid-head"><div class="bid-info"><span><span class="lbl">${t('Your bid')}</span><span class="muted">${others}</span></span>${warn}</div>`
      + `<button class="hint-btn" onclick="toggleBidSuggestion()">${t('Hint')}</button></div>`
      + `<div class="bid-row" style="--cols:${cols};--nb:${nb}">${btns}</div></div>`;
    markKbdBid();
  } else if (G.phase === 'bidding') {
    bar.innerHTML = `<span class="status-text">${t('{who} is bidding', { who: `<span class="who">${playerLabel(G.currentBidderIndex)}</span>` })}</span>`;
  } else if (G.phase === 'playing' && G.currentTrick.length >= G.numPlayers) {
    const w = currentWinner().playerIndex;
    bar.innerHTML = `<span class="status-text">${w === ME ? t('You take the trick') : t('{who} takes the trick', { who: `<span class="who">${playerLabel(w)}</span>` })}</span>`;
  } else if (G.phase === 'playing' && currentPlayerToAct() === ME) {
    const led = G.currentTrick.length ? G.currentTrick[0].card.suit : null;
    const hand = G.hands[ME];
    const legal = getLegalMoves(hand, led, G.trumpSuit);
    let msg;
    const autoCard = autoPlayChoice(legal, hand);
    if (legal.length === 1) msg = t('Only one card can be played. Playing it.');
    else if (autoCard) msg = t('Your cards here are interchangeable. Playing the {card}.', { card: autoCard.rank + suitTxt(autoCard.suit) });
    else if (!led) msg = t('Your lead');
    else if (hand.some(c => c.suit === led)) msg = t('Your turn: follow {suit}', { suit: suitTxt(led) });
    else if (G.trumpSuit && hand.some(c => c.suit === G.trumpSuit)) msg = t('No {led} left: you must trump {trump}', { led: suitTxt(led), trump: suitTxt(G.trumpSuit) });
    else msg = t('No {led} left: play any card', { led: suitTxt(led) });
    bar.innerHTML = `<span class="status-text you">${msg}</span>`
      + (!autoCard ? `<button class="hint-btn" onclick="toggleSuggestion()">${t('Hint')}</button>` : '');
  } else if (G.phase === 'playing') {
    bar.innerHTML = `<span class="status-text">${t('{who} to play', { who: `<span class="who">${playerLabel(currentPlayerToAct())}</span>` })}</span>`;
  } else if (G.phase === 'trickResult') {
    const w = G.trickWinnerIndex;
    bar.innerHTML = `<span class="status-text">${w === ME ? t('You take the trick') : t('{who} takes the trick', { who: `<span class="who">${playerLabel(w)}</span>` })}</span>${bidHTML(w)}`;
  } else {
    bar.innerHTML = '';
  }
}

// ─── Score sheet (round results, history, final) ───
function scoringLine() {
  return G.scoringMode === 'geometric'
    ? t('Geometric scoring: a made bid B scores 5 + B(B+1)/2; missing by d costs d(d+1)/2.')
    : t('Classic scoring: a made bid scores 5 + the bid; a miss costs 1 point per trick off.');
}

const RING_SVG = '<svg class="ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M30,5 C12,6 3,13 4,21 C6,33 30,37 55,36 C80,35 97,29 96,18 C95,8 74,3 50,4 C38,4 26,6 18,10"/></svg>';

function sheetTableHTML({ highlight = -1, final = false, winRow = false } = {}) {
  const n = G.numPlayers, hist = G.roundHistory || [];
  const lastIdx = hist.length - 1;
  const max = Math.max(...G.scores);
  let h = `<table class="score-sheet${n >= 5 ? ' wide' : ''}"><colgroup><col class="c-rc">${'<col>'.repeat(n)}</colgroup><thead><tr><th class="rc" title="${t('Cards dealt')}"></th>`;
  for (let p = 0; p < n; p++) h += `<th class="${p === ME ? 'me' : ''}" title="${p === ME ? t('You') : escHTML(G.playerNames[p])}">${playerLabel(p)}</th>`;
  h += '</tr></thead><tbody>';
  G.roundSequence.forEach((cpp, r) => {
    const row = hist[r];
    const cls = [r === highlight ? 'now' : '', !row ? 'todo' : '', final && r === lastIdx ? 'final' : ''].join(' ').trim();
    const review = row && row.trickHistory ? ` onclick="showRoundReview(${r})"` : '';
    h += `<tr class="${cls}${review ? ' rv' : ''}"${review}><td class="rc">${cpp}${cpp === 8 ? `<small class="eight-index">(${eightCardRoundPosition(r).current}/${eightCardRoundPosition(r).total})</small>` : ''}${row && row.trumpSuit ? `<span class="ts ${SUIT_COLOR[row.trumpSuit]}">${SUIT_SYMBOL[row.trumpSuit]}</span>` : ''}${row && roundFlagged(r) ? '<i class="rv-dot" aria-hidden="true"></i>' : ''}</td>`;
    for (let p = 0; p < n; p++) {
      const meCol = p === ME ? ' me-col' : '';
      if (!row) { h += `<td class="${meCol.trim()}"></td>`; continue; }
      const made = row.tricksWon[p] === row.bids[p];
      const d = row.roundScores[p];
      const ring = final && r === lastIdx && row.cumulativeScores[p] === max ? RING_SVG : '';
      h += `<td class="cell${made ? '' : ' miss'}${meCol}" style="--c:${p + 1}">`
        + `<span class="sm"><span class="wb" title="${t('tricks taken / bid')}">${row.tricksWon[p]}/${row.bids[p]}</span>`
        + (r === highlight ? `<span class="d">${d > 0 ? '+' : ''}${d}</span>` : '')
        + (p === ME ? `<span class="score-gap" title="${t('Lead over the best opponent')}">(${signed(scoreGap(row.cumulativeScores))})</span>` : '')
        + `</span><span class="tot">${row.cumulativeScores[p]}</span>${ring}</td>`;
    }
    h += '</tr>';
  });
  return h + '</tbody>' + (winRow ? winChanceRowHTML() : '') + '</table>';
}

// One row under the sheet: each player's chance of finishing first. Ties
// count as wins for everyone tied, so the row can add up to more than 100%.
function winChanceRowHTML() {
  let h = `<tfoot><tr class="win-row" title="${t('Score-based estimate from scores, remaining rounds and bidding accuracy. Ties count as wins.')}"><td class="rc">${t('win')}</td>`;
  for (let p = 0; p < G.numPlayers; p++) {
    const e = estimateWinChance(p, 1500);   // half the samples: one estimate per player
    const pct = e.certain ? (e.chance === 1 ? '100%' : '0%') : winChanceText(e).replace('≈', '');
    h += `<td class="${p === ME ? 'me-col' : ''}">${pct}</td>`;
  }
  return h + '</tr></tfoot>';
}

// Every trick of a round: the trump up top, each card with who played it,
// and why the winner won in words (trumped, or highest of the led suit).
function trickLogHTML(tricks, checks, open = false, trumpSuit = null) {
  if (!tricks || !tricks.length) return '';
  const katya = {};
  for (const x of playCheckFlagged(checks)) katya[x.trick] = x;
  const trumpLine = trumpSuit
    ? t('Trump: {s}', { s: `<span class="${SUIT_COLOR[trumpSuit]}">${SUIT_SYMBOL[trumpSuit]}</span>` })
    : t('No trump this round');
  let html = `<details class="trick-log"${open ? ' open' : ''}><summary>${t('How the tricks went')}</summary><div class="trick-log-body">`
    + `<p class="trick-log-trump">${trumpLine}</p>`;
  tricks.forEach((tr, i) => {
    html += `<div class="trick-log-row"><span class="trick-log-num">${i + 1}.</span>`;
    tr.entries.forEach((e, j) => {
      const isW = e.playerIndex === tr.winnerIndex;
      html += `<span class="tl-play${isW ? ' tl-won' : ''}"><span class="trick-log-card ${SUIT_COLOR[e.card.suit]}${isW ? ' tl-winner' : ''}">${e.card.rank}${SUIT_SYMBOL[e.card.suit]}</span>`
        + `<small>${playerLabel(e.playerIndex)}${j === 0 ? ` · ${t('led')}` : ''}</small></span>`;
    });
    if (katya[i]) html += `<span class="tl-katya" title="${escHTML(playCheckLineHTML(katya[i]).replace(/<[^>]+>/g, ''))}">Katya ${cardTxt(katya[i].pick)}</span>`;
    html += `<span class="trick-log-reason">${trickReasonText(tr, trumpSuit)}</span></div>`;
  });
  return html + '</div></details>';
}
function trickReasonText(tr, trumpSuit) {
  const led = tr.entries[0].card.suit;
  const win = tr.entries.find(e => e.playerIndex === tr.winnerIndex).card;
  const who = playerLabel(tr.winnerIndex), card = `${win.rank}${SUIT_SYMBOL[win.suit]}`;
  if (trumpSuit && win.suit === trumpSuit && led !== trumpSuit) return t('{who} trumped with {card}', { who, card });
  if (!trumpSuit || led === trumpSuit) return t('{who} won: highest {s}', { who, s: SUIT_SYMBOL[led] });
  return t('{who} won: highest {s}, nobody trumped', { who, s: SUIT_SYMBOL[led] });
}

function openSheet(id, head, body, foot, closeOnBackdrop, stack = false) {
  if (stack) document.getElementById(id)?.remove();
  else removeOverlays();
  document.body.insertAdjacentHTML('beforeend',
    `<div class="overlay" id="${id}"${closeOnBackdrop ? ` onclick="if(event.target===this)${stack ? 'this.remove()' : 'removeOverlays()'}"` : ''}>`
    + `<div class="overlay-content sheet" role="dialog" aria-modal="true">`
    + `<div class="sheet-head">${head}</div><div class="sheet-scroll">${body}</div><div class="sheet-foot">${foot}</div>`
    + '</div></div>');
  const ov = document.getElementById(id);
  const sc = ov.querySelector('.sheet-scroll');
  const target = ov.querySelector('tr.now, tr.final') || [...ov.querySelectorAll('.score-sheet tbody tr:not(.todo)')].pop();
  if (sc && target) {
    const y = target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = Math.max(0, y - sc.clientHeight * 0.6);
  }
  const primary = ov.querySelector('.btn-ink');
  if (primary) primary.focus({ preventScroll: true });
  return ov;
}

function roundSummary(roundScores, bids = G.bids, tricksWon = G.tricksWon) {
  const bid = bids[ME], won = tricksWon[ME], d = roundScores[ME];
  const mine = won === bid
    ? (bid === 0 ? t('You took none, as bid: {pts}.', { pts: `<b>+${d}</b>` }) : t('You made {bid}: {pts}.', { bid, pts: `<b>+${d}</b>` }))
    : t('You took {won} on a bid of {bid}: {pts}.', { won, bid, pts: `<b class="neg">${d}</b>` });
  const missed = [];
  for (let p = 0; p < G.numPlayers; p++) if (p !== ME && tricksWon[p] !== bids[p]) missed.push(playerLabel(p));
  const others = !missed.length ? t('Everyone else made theirs.')
    : t('Missed: {list}.', { list: missed.join(', ') });
  return `${mine} ${others}`;
}

// ─── Mathematically out ───
// A player is out when even their best possible finish (making the largest
// bid every remaining round) can't reach some opponent's worst possible finish
// (missing by the most every round). Ties for first still count as a chance.

// ─── Bid check ───
// When it is your turn to bid, the engine values each legal bid for your hand
// as an expected score: the named bots' PIMC, or the exact win chance with one
// card. Nothing shows during the round; afterwards the sheet compares your bid
// with the engine's pick.
function fmtPts(x) { return dec((Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '')); }
function signed(x) { const v = fmtPts(x); return x > 0 ? '+' + v : x < 0 ? '−' + v.slice(1) : v; }
function bidCheckHTML(r) {
  const c = bidChecks()[r];
  if (!c || c.bid == null) return '';
  const lost = bidCheckBehind(c);
  const verdict = c.bid === c.pick ? t('The engine bids {pick} too.', { pick: c.pick })
    : lost > 1 ? t('The engine bids {pick}; your {bid} gives up about {pts} points.', { pick: c.pick, bid: c.bid, pts: fmtPts(lost) })
    : t('The engine slightly prefers {pick}; your {bid} is within a point.', { pick: c.pick, bid: c.bid });
  const lo = Math.min(c.pick, c.bid) - 1, hi = Math.max(c.pick, c.bid) + 1;
  const chips = Object.keys(c.val).map(Number).filter(b => b >= lo && b <= hi).sort((a, b) => a - b).map(b =>
    `<span class="${[b === c.bid ? 'you' : '', b === c.pick ? 'best' : ''].join(' ').trim()}">${t('bid {b}: {v}', { b, v: signed(c.val[b]) })}</span>`).join('');
  return `<p class="sub bid-check${lost > 1 ? ' flag' : ''}"><span class="bc-verdict">${t('Bid check:')} ${verdict}</span><span class="bc-chips" title="${t('Expected points for each bid, as the engine saw your hand when you bid')}">${chips}</span></p>`;
}
function bidCheckSummaryHTML() {
  const tot = bidCheckTotals();
  if (!tot.rounds) return '';
  const bids = nOf(tot.rounds, 'checked bid', 'checked bids', 'licitație verificată', 'licitații verificate');
  const text = tot.flagged > 1
    ? t("{flagged} of your {bids} were over a point behind the engine's pick; about {pts} points in all.", { flagged: tot.flagged, bids, pts: fmtPts(tot.behind) })
    : tot.flagged ? t("1 of your {bids} was over a point behind the engine's pick; about {pts} points in all.", { bids, pts: fmtPts(tot.behind) })
    : t("All {bids} were within a point of the engine's pick.", { bids });
  return `<p class="sub bid-check${tot.flagged ? ' flag' : ''}"><span class="bc-verdict">${t('Bid check:')} ${text}</span></p>`;
}

// ─── Play check ───
// Each card you choose from more than one legal card (interchangeable cards
// aside) is scored a moment later, from the position you chose it in: Katya's
// model of the rest of the round - her sampled deals, in-trick replies and
// playouts, exact search for the last two tricks - values every card you
// could have played, in your own round points (without her spite and
// opponent-denial terms). The round sheet lists the plays where her pick was
// worth clearly more; tap a finished round on the score sheet to review it.
function cardTxt(c) { return c.rank + suitTxt(c.suit); }
function playCheckLineHTML(x) {
  const when = x.before.length
    ? t('after {cards}', { cards: x.before.map(b => `${playerLabel(b.p)} ${cardTxt(b.card)}`).join(', ') })
    : t('leading');
  return t('Trick {n}, {when}: you {card}, Katya {pick}, worth about {pts} more.',
    { n: x.trick + 1, when, card: cardTxt(x.card), pick: cardTxt(x.pick), pts: fmtPts(playCheckLost(x)) });
}
function playCheckHTML(r) {
  const list = playChecks()[r];
  if (!list || !list.length) return '';
  const flagged = playCheckFlagged(list);
  const choices = nOf(list.length, 'card choice', 'card choices', 'alegere', 'alegeri');
  if (!flagged.length) return `<p class="sub play-check"><span class="pc-verdict">${t('Play check:')} ${t('Katya would have played like you in all {choices}, or within half a point.', { choices })}</span></p>`;
  const pts = fmtPts(flagged.reduce((a, x) => a + playCheckLost(x), 0));
  return `<div class="sub play-check flag"><span class="pc-verdict">${t('Play check:')} ${t('Katya would play differently at {k} of your {choices}, worth about {pts} points.', { k: flagged.length, choices, pts })}</span>`
    + `<ul class="pc-list">${flagged.slice(0, 3).map(x => `<li>${playCheckLineHTML(x)}</li>`).join('')}</ul></div>`;
}
function playCheckSummaryHTML() {
  const tot = playCheckTotals();
  if (!tot.choices) return '';
  const choices = nOf(tot.choices, 'card choice', 'card choices', 'alegere', 'alegeri');
  const text = tot.flagged
    ? t('Katya would play differently at {k} of your {choices} this game, worth about {pts} points.', { k: tot.flagged, choices, pts: fmtPts(tot.lost) })
    : t('Katya would have played like you in all {choices} this game, or within half a point.', { choices });
  return `<p class="sub play-check${tot.flagged ? ' flag' : ''}"><span class="pc-verdict">${t('Play check:')} ${text}</span></p>`;
}
function roundFlagged(r) {
  const c = bidChecks()[r];
  return (c && c.bid != null && bidCheckBehind(c) > 1) || playCheckFlagged(playChecks()[r]).length > 0;
}
// Any finished round, again: your result, the checks, every trick
function showRoundReview(r) {
  const h = (G.roundHistory || [])[r];
  if (!h) return;
  const trumpStr = h.trumpSuit ? t('{s} trump', { s: SUIT_SYMBOL[h.trumpSuit] }) : t('no trump');
  const head = `<h2>${t('Round {n}', { n: r + 1 })}<small>${nOf(h.cardsPerPlayer, 'card', 'cards', 'carte', 'cărți')}, ${trumpStr}</small></h2>`
    + `<p class="sub">${roundSummary(h.roundScores, h.bids, h.tricksWon)}</p>${bidCheckHTML(r)}${playCheckHTML(r)}`;
  openSheet('review-overlay', head, `<div class="review">${trickLogHTML(h.trickHistory, playChecks()[r], true, h.trumpSuit)}</div>`,
    `<span></span><button class="btn-ink" onclick="closeReview()">${t('Back')}</button>`, true, true);
}
function closeReview() { document.getElementById('review-overlay')?.remove(); }

function showRoundResult(roundScores) {
  const r = G.currentRoundIndex;
  const isLast = r + 1 >= G.roundSequence.length;
  const trumpStr = G.trumpSuit ? t('{s} trump', { s: SUIT_SYMBOL[G.trumpSuit] }) : t('no trump');
  const out = !isLast && humansOut();
  const champ = isLast || out ? -1 : humanClinched();
  const outNote = out ? `<p class="sub out-note">${t('You can no longer finish first, even with perfect rounds from here.')}</p>` : '';
  const winNote = champ >= 0 ? `<p class="sub won-note">${t('You have clinched first place. Nobody can catch up, even with perfect rounds from here.')}</p>` : '';
  const head = `<h2>${t('Round {n}', { n: r + 1 })}<small>${nOf(G.cardsPerPlayer, 'card', 'cards', 'carte', 'cărți')}, ${trumpStr}</small></h2><p class="sub">${roundSummary(roundScores)}</p>${bidCheckHTML(r)}${playCheckHTML(r)}${outNote}${winNote}`;
  const body = sheetTableHTML({ highlight: (G.roundHistory || []).length - 1, winRow: true });
  const foot = (trickLogHTML(G.trickHistory, playChecks()[r], false, G.trumpSuit) || '<span></span>') + (isLast
    ? `<button class="btn-ink" onclick="showGameOver()">${t('See final scores')}</button>`
    : out || champ >= 0
    ? `<span class="foot-links"><button onclick="nextRound()">${t('Play on')}</button><button class="btn-ink" onclick="showGameOver()">${t('End game')}</button></span>`
    : `<button class="btn-ink" onclick="nextRound()">${t('Next round')}</button>`);
  openSheet('round-overlay', head, body, foot, false);
}

function nextRound() {
  removeOverlays();
  G.currentRoundIndex++;
  G.dealerIndex = (G.dealerIndex + 1) % G.numPlayers;
  startRound();
}

function ordinal(k) { return LANG === 'ro' ? String(k) : k + (['th', 'st', 'nd', 'rd'][(k % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][k % 100] || 'th'); }

function finalTitle() {
  if (G.resigned) return { title: t('You resigned'), sub: '' };
  const max = Math.max(...G.scores);
  const winners = G.scores.map((s, i) => s === max ? i : -1).filter(i => i >= 0);
  const ranked = G.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  if (winners.length > 1) {
    return { title: t('{names} tie at {n}', { names: winners.map(playerLabel).join(t(' and ')), n: max }),
      sub: winners.includes(ME) ? t('A shared win.') : t('You finish with {n}.', { n: G.scores[ME] }) };
  }
  const w = winners[0];
  const runnerUp = ranked[1];
  if (w === ME) return { title: t('You win with {n}', { n: max }), sub: t('{name} is next with {n}.', { name: playerLabel(runnerUp.i), n: runnerUp.s }) };
  const place = ranked.findIndex(x => x.i === ME) + 1;
  return { title: t('{name} wins with {n}', { name: playerLabel(w), n: max }), sub: t('You finish {place} with {n}.', { place: ordinal(place), n: G.scores[ME] }) };
}

// Final standings, best first; ties share a place
function finalRankHTML() {
  const order = G.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const top = order[0].s;
  let place = 0, prev = null;
  return `<ol class="final-rank" aria-label="${t('Final standings')}">` + order.map((e, k) => {
    if (e.s !== prev) { place = k + 1; prev = e.s; }
    const cls = [e.i === ME ? 'me' : '', place === 1 ? 'win' : ''].join(' ').trim();
    return `<li class="${cls}"><span class="pl">${place}</span><span class="nm">${playerLabel(e.i)}</span>`
      + `<span class="sc">${e.s}${place === 1 ? RING_SVG : ''}</span><span class="gap">${place === 1 ? '' : '−' + (top - e.s)}</span></li>`;
  }).join('') + '</ol>';
}

// ─── Luck vs skill ───
// After the game a bot replays your seat with the same deals - every hand,
// trump and dealer - while the other seats keep their bots. Your score minus
// the bot's is your play; the bot's score minus the table average is your
// cards. Replays vary a lot (a bot's score on the same deals swings about ±10),
// so several run in parallel workers built from this very script: the real
// engine, off the main thread.
// The yardstick is one of the strongest all-round bots, never one already at
// the table (the result would name the same bot twice).
const LUCK_BOTS = ['Katya', 'Viktor', 'Sniper', 'Sasha'], LUCK_RUNS = 8;
function luckBot() { return LUCK_BOTS.find(b => !G.playerNames.includes(b)) || LUCK_BOTS[0]; }
let luckWorkers = [];
// The deals of the game just played, from its log
function luckDeals() {
  if (!G.gameLog || !G.gameLog.rounds || !G.gameLog.rounds.length) return null;
  const n = G.numPlayers;
  return G.gameLog.rounds.map((r, k) => ({
    round: r.roundIdx ?? k, cpp: r.cardsPerPlayer, dealer: r.dealer ?? ((r.roundIdx ?? k) % n), trump: r.trump,
    hands: Array.from({ length: n }, (_, i) => r.hands[i]) }));
}
function luckWorkerURL() {
  if (typeof Worker === 'undefined') return null;
  return new URL('js/replay-worker.js', document.baseURI).href;
}
function stopLuckCheck() {
  luckWorkers.forEach(w => w.terminate());
  luckWorkers = [];
}
function startLuckCheck() {
  stopLuckCheck();
  const box = document.getElementById('luck-box');
  const deals = luckDeals();
  if (!box || !deals) { if (box) box.remove(); return; }
  if (G.gameLog.luck) { box.innerHTML = luckResultHTML(G.gameLog.luck); return; }
  let url = null;
  try { url = luckWorkerURL(); } catch (e) {}
  if (!url) { box.remove(); return; }
  const bot = luckBot();
  const names = G.playerNames.map((nm, i) => i === ME ? bot : nm === 'Jev' ? 'Grok' : nm);  // Jev's fallback is Grok
  const job = { deals, seq: G.roundSequence.slice(), names, mode: G.scoringMode || 'linear' };
  const you = G.scores[ME], yourRounds = G.roundHistory.slice(0, deals.length).map(h => h.roundScores[ME]);
  const log = G.gameLog, results = [];
  const nw = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const progress = () => { box.innerHTML = `<p class="sub luck-wait">${t('Luck or skill? Replaying your cards with {bot} in your seat… {progress}', { bot, progress: `<b>${results.length}/${LUCK_RUNS}</b>` })}</p>`; };
  progress();
  for (let w = 0; w < nw; w++) {
    const runs = Math.floor(LUCK_RUNS / nw) + (w < LUCK_RUNS % nw ? 1 : 0);
    if (!runs) continue;
    let worker;
    try { worker = new Worker(url); } catch (e) { break; }
    worker.onmessage = e => {
      results.push(e.data);
      if (results.length < LUCK_RUNS) { if (document.getElementById('luck-box') === box) progress(); return; }
      stopLuckCheck();
      log.luck = summarizeLuck(bot, results, you, yourRounds, deals);
      saveLuck(log);
      if (document.getElementById('luck-box') === box) box.innerHTML = luckResultHTML(log.luck);
    };
    worker.onerror = e => {
      console.warn('Luck replay failed', e.message);
      stopLuckCheck();
      if (document.getElementById('luck-box') === box) box.remove();
    };
    worker.postMessage(Object.assign({ runs }, job));
    luckWorkers.push(worker);
  }
  if (!luckWorkers.length) box.remove();
}
function luckResultHTML(L) {
  const num = x => `<b class="${x < 0 ? 'neg' : ''}">${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtPts(Math.abs(x))}</b>`;
  const worst = L.gaps.filter(g => g.bot - g.you >= 3).sort((a, b) => (b.bot - b.you) - (a.bot - a.you)).slice(0, 3);
  const items = worst.map(g => `<button class="lk-link" onclick="showRoundReview(${g.round})">${g.round + 1}</button> <span class="lk-r">(${t('{deal}: you {you}, {bot} {botpts}',
    { deal: g.trump ? g.cpp + SUIT_SYMBOL[g.trump] : t('{n} no trump', { n: g.cpp }), you: signed(g.you), bot: L.bot, botpts: signed(g.bot) })})</span>`);
  const rounds = worst.length ? `<p class="sub luck-rounds">${t(worst.length > 1 ? '{bot} gained most on you in rounds {list}.' : '{bot} gained most on you in round {list}.',
    { bot: L.bot, list: items.join(', ') })}</p>` : '';
  return `<div class="luck-grid">`
    + `<div class="lk"><span class="lk-label">${t('Your cards')}</span>${num(L.cards)}<span class="lk-note">${t('{bot} averaged {avg} with them; the table {table}', { bot: L.bot, avg: fmtPts(L.botAvg), table: fmtPts(L.tableAvg) })}</span></div>`
    + `<div class="lk"><span class="lk-label">${t('Your play')}</span>${num(L.play)}<span class="lk-note">${t("you {you} vs {bot}'s {avg}; one game swings ±{spread}", { you: L.you, bot: L.bot, avg: fmtPts(L.botAvg), spread: L.spread })}</span></div>`
    + `</div>${rounds}`;
}
// Keep the result with the game: in the log on this device and in the cloud copy
function saveLuck(log) {
  try {
    const logs = JSON.parse(localStorage.getItem('wist-game-logs') || '[]');
    const mine = logs.find(l => l.timestamp === log.timestamp);
    if (mine) { mine.luck = log.luck; localStorage.setItem('wist-game-logs', JSON.stringify(logs)); }
  } catch (e) {}
  const list = statsLoad(), rec = list.find(r => r.t === log.timestamp);
  if (rec) { rec.luck = statsLuck(log.luck); statsSave(list); }
  if (fbDb) {
    const key = log.timestamp.replace(/[:.]/g, '-');
    (fbAuthReady || Promise.resolve())
      .then(() => fbDb.ref(`gameLogs/${key}/luck`).set(log.luck))
      .catch(e => console.warn('Firebase luck save failed', e));
  }
}

// ─── Your stats ───
// One compact record per finished game on this device, solo and online, kept
// apart from the full logs (which keep only the last 50): places, every
// round's bids and tricks, bid checks and luck vs skill. Older solo games are
// filled in from those full logs the first time the page opens.
const STATS_KEY = 'wist-stats', STATS_MAX = 1000;
function statsLoad() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY) || '[]'); } catch (e) { return []; }
}
function statsSave(list) {
  list.sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  while (list.length > STATS_MAX) list.shift();
  for (let tries = 0; tries < 6; tries++) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(list)); return; }
    catch (e) { list.splice(0, Math.max(1, Math.ceil(list.length / 10))); }   // storage full: drop the oldest tenth
  }
}
function statsAdd(rec) {
  const list = statsLoad().filter(x => x.t !== rec.t);
  list.push(rec);
  statsSave(list);
}
function statsLuck(L) { return { bot: L.bot, cards: L.cards, play: L.play, spread: L.spread }; }
// rounds: [cards, bids, tricks taken]; the dealer of round k is seat k % n
function statsRecordFromGame(me, online, ai) {
  const rec = { t: (G.gameLog && G.gameLog.timestamp) || new Date().toISOString(), on: online ? 1 : 0,
    m: G.scoringMode === 'geometric' ? 'geometric' : 'linear', me, names: G.playerNames.slice(), ai, s: G.scores.slice(),
    r: (G.roundHistory || []).map(h => [h.cardsPerPlayer, h.bids.slice(), h.tricksWon.slice()]) };
  if (rec.r.length < G.roundSequence.length) rec.early = 1;
  if (G.resigned) rec.resigned = 1;
  const checks = bidChecks(), c = [];
  for (const k in checks) { const x = checks[k]; if (x && x.bid != null) c.push([+k, x.pick, bidCheckBehind(x)]); }
  if (c.length) rec.c = c;
  const pc = playCheckTotals();
  if (pc.choices) rec.pc = [pc.choices, pc.flagged, pc.lost];
  if (G.gameLog && G.gameLog.luck) rec.luck = statsLuck(G.gameLog.luck);
  return rec;
}
function statsFromLog(log) {
  if (!log || !log.timestamp || !log.rounds || !log.rounds.length || !log.finalScores || !log.players
    || log.players[0] !== 'You' || (log.mode && log.mode !== 'solo')) return null;
  const n = log.players.length, seats = log.players.map((_, i) => i);
  try {
    const rec = { t: log.timestamp, on: 0, m: log.scoringMode === 'geometric' ? 'geometric' : 'linear', me: 0, names: log.players.slice(),
      ai: seats.slice(1), s: seats.map(i => log.finalScores[i].score),
      r: log.rounds.map(r => [r.cardsPerPlayer, seats.map(i => r.results[i].bid), seats.map(i => r.results[i].won)]) };
    if (rec.r.length < computeRoundSequence(n).length) rec.early = 1;
    const c = log.rounds.map((r, k) => r.bidCheck ? [k, r.bidCheck.pick,
      Math.round((r.bidCheck.val[r.bidCheck.pick] - r.bidCheck.val[r.results[0].bid]) * 10) / 10] : null).filter(Boolean);
    if (c.length) rec.c = c;
    if (log.playCheck && log.playCheck.choices) rec.pc = [log.playCheck.choices, log.playCheck.flagged, log.playCheck.lost];
    if (log.luck) rec.luck = statsLuck(log.luck);
    return rec;
  } catch (e) { return null; }
}
function statsAll() {
  const list = statsLoad(), have = new Set(list.map(r => r.t));
  let added = 0;
  try {
    for (const log of JSON.parse(localStorage.getItem('wist-game-logs') || '[]')) {
      const rec = have.has(log.timestamp) ? null : statsFromLog(log);
      if (rec) { list.push(rec); have.add(rec.t); added++; }
    }
  } catch (e) {}
  if (added) statsSave(list);
  return list;
}

function statsCompute(list) {
  const acc = () => ({ n: 0, made: 0, diff: 0, pts: 0 });
  const S = { games: list.length, wins: 0, fair: 0, place: 0, seats: 0, form: [], cards: {},
    last: { you: [0, 0], bots: [0, 0] }, other: { you: [0, 0], bots: [0, 0] }, opp: {},
    bc: { games: 0, bids: 0, behind: 0, flagged: 0 }, pc: { games: 0, choices: 0, flagged: 0, lost: 0 }, luck: [] };
  for (const g of list) {
    const n = g.names.length, me = g.me, sc = g.s;
    const place = g.resigned ? n : 1 + sc.filter((x, i) => i !== me && x > sc[me]).length;   // resigning counts as last
    if (place === 1) S.wins++;
    S.fair += 1 / n; S.place += place; S.seats += n;
    S.form.push({ place, n, score: sc[me], m: g.m, t: g.t });
    const ai = new Set(g.ai);
    g.r.forEach(([cpp, bids, won], k) => {
      const row = S.cards[cpp] || (S.cards[cpp] = { you: acc(), bots: acc() });
      for (let p = 0; p < n; p++) {
        if (p !== me && !ai.has(p)) continue;
        const who = p === me ? 'you' : 'bots', a = row[who], made = won[p] === bids[p] ? 1 : 0;
        a.n++; a.made += made; a.diff += won[p] - bids[p]; a.pts += scoreRound(won[p], bids[p], g.m);
        const L = (p === k % n ? S.last : S.other)[who];   // the dealer bids last
        L[0]++; L[1] += made;
      }
    });
    for (let j = 0; j < n; j++) {
      if (j === me) continue;
      const o = S.opp[g.names[j]] || (S.opp[g.names[j]] = { n: 0, ahead: 0, margin: 0, bot: ai.has(j) });
      o.n++; if (sc[me] > sc[j]) o.ahead++; o.margin += sc[me] - sc[j];
    }
    if (g.c) { S.bc.games++; for (const [, , behind] of g.c) { S.bc.bids++; S.bc.behind += behind; if (behind > 1) S.bc.flagged++; } }
    if (g.pc) { S.pc.games++; S.pc.choices += g.pc[0]; S.pc.flagged += g.pc[1]; S.pc.lost += g.pc[2]; }
    if (g.luck) S.luck.push(g.luck);
  }
  return S;
}

let statsFilter = { where: 'all', mode: 'all' };
try { Object.assign(statsFilter, JSON.parse(localStorage.getItem('wist-stats-filter') || '{}')); } catch (e) {}
function setStatsFilter(k, v) {
  statsFilter[k] = v;
  try { localStorage.setItem('wist-stats-filter', JSON.stringify(statsFilter)); } catch (e) {}
  renderStats();
}
function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
function signedFixed(v, digits) { const s = Math.abs(v).toFixed(digits); return dec(+s === 0 ? s : (v > 0 ? '+' : '−') + s); }
function avgTxt(sum, n, digits = 1) { return n ? signedFixed(sum / n, digits) : '–'; }
function statsHTML(all) {
  const list = all.filter(g => (statsFilter.where === 'all' || (statsFilter.where === 'online') === !!g.on)
    && (statsFilter.mode === 'all' || g.m === statsFilter.mode));
  if (!list.length) return `<div class="stats"><p class="st-empty">${all.length ? t('No games match these filters yet.') : t('No finished games on this device yet. Your record starts with the next game you finish.')}</p></div>`;
  const S = statsCompute(list);
  const pair = (y, b) => `<span class="you">${y}</span><span class="bots">${b}</span>`;
  let h = '<div class="stats">';
  h += `<div class="st-big"><div><span>${t('Games')}</span><b>${S.games}</b></div>`
    + `<div><span>${t('Won')}</span><b>${pct(S.wins, S.games)}</b><small>${t('{games}; fair share {fair}', { games: nOf(S.wins, 'game', 'games', 'joc', 'jocuri'), fair: pct(S.fair, S.games) })}</small></div>`
    + `<div><span>${t('Place')}</span><b>${dec((S.place / S.games).toFixed(1))}</b><small>${t('average, of {n} players', { n: dec((S.seats / S.games).toFixed(1)) })}</small></div></div>`;
  const form = S.form.slice(-15);
  h += `<h3>${form.length === 1 ? t('Last game') : t('Last {n} games', { n: form.length })}</h3><div class="st-form">` + form.map(f =>
    `<span class="${f.place === 1 ? 'w' : ''}" title="${t('{place} of {n}, {score} points, {mode}', { place: ordinal(f.place), n: f.n, score: f.score, mode: t(f.m === 'geometric' ? 'geometric' : 'classic') })}">${f.place}</span>`).join('')
    + `</div><p class="st-note">${t('Your place in each game, newest on the right.')}</p>`;
  h += `<h3>${t('Bids by hand size')}</h3><table class="st-table"><thead><tr><th>${t('Cards')}</th><th>${t('Rounds')}</th><th>${t('Made')}</th><th>${t('Took − bid')}</th><th>${t('Points')}</th></tr></thead><tbody>`;
  for (const cpp of Object.keys(S.cards).map(Number).sort((a, b) => a - b)) {
    const { you: y, bots: b } = S.cards[cpp];
    h += `<tr><td>${cpp}</td><td>${y.n}</td><td>${pair(pct(y.made, y.n), pct(b.made, b.n))}</td>`
      + `<td>${pair(avgTxt(y.diff, y.n, 2), avgTxt(b.diff, b.n, 2))}</td><td>${pair(avgTxt(y.pts, y.n), avgTxt(b.pts, b.n))}</td></tr>`;
  }
  h += `</tbody></table><p class="st-note">${t('<b>Bold</b>: you. Grey: the bots in the same games. Took − bid above zero means you take more tricks than you bid.')}</p>`;
  h += `<h3>${t('Bidding last')}</h3><p>${t('When you deal and bid last, with one total ruled out, you make {a} of your bids (bots {b}). From other seats: {c} (bots {d}).', {
    a: `<b>${pct(S.last.you[1], S.last.you[0])}</b>`, b: pct(S.last.bots[1], S.last.bots[0]),
    c: `<b>${pct(S.other.you[1], S.other.you[0])}</b>`, d: pct(S.other.bots[1], S.other.bots[0]) })}</p>`;
  if (S.bc.bids) {
    h += `<h3>${t('Bid check')}</h3><p>${t("Over {bids} in {games}, your bids average {avg} points behind the engine's pick ({pergame} a game). {flagged} of bids were more than a point behind.", {
      bids: nOf(S.bc.bids, 'checked bid', 'checked bids', 'licitație verificată', 'licitații verificate'), games: nOf(S.bc.games, 'game', 'games', 'joc', 'jocuri'),
      avg: `<b>${fmtPts(S.bc.behind / S.bc.bids)}</b>`, pergame: `<b>${fmtPts(S.bc.behind / S.bc.games)}</b>`, flagged: pct(S.bc.flagged, S.bc.bids) })}</p>`;
  }
  if (S.pc.choices) {
    h += `<h3>${t('Play check')}</h3><p>${t('Over {choices} in {games}, Katya would have played differently at {share} of them, worth about {pergame} points a game.', {
      choices: nOf(S.pc.choices, 'card choice', 'card choices', 'alegere', 'alegeri'), games: nOf(S.pc.games, 'game', 'games', 'joc', 'jocuri'),
      share: `<b>${pct(S.pc.flagged, S.pc.choices)}</b>`, pergame: `<b>${fmtPts(S.pc.lost / S.pc.games)}</b>` })}</p>`;
  }
  if (S.luck.length) {
    const N = S.luck.length, mean = k => S.luck.reduce((a, L) => a + L[k], 0) / N;
    const play = mean('play'), sd = N > 1 ? Math.sqrt(S.luck.reduce((a, L) => a + (L.play - play) ** 2, 0) / (N - 1)) : 0;
    h += `<h3>${t('Luck vs skill')}</h3><p>${t('Over {games} with a bot in your seat: your cards averaged {cards} a game against the table, your play {play} a game against the bot{se}.', {
      games: nOf(N, 'game replayed', 'games replayed', 'joc rejucat', 'jocuri rejucate'),
      cards: `<b>${signed(Math.round(mean('cards') * 10) / 10)}</b>`, play: `<b>${signed(Math.round(play * 10) / 10)}</b>`,
      se: N > 1 ? t(' (± {se}, one standard error)', { se: fmtPts(sd / Math.sqrt(N)) }) : '' })}</p>`
      + `<p class="st-note">${N < 10 ? t('A single game swings about ±10 points, so give this a few more games before reading much into it.') : t('Play above zero means you score more than a strong bot would with your exact cards.')}</p>`;
  }
  const opp = Object.entries(S.opp).filter(([, o]) => o.n >= 2).sort((a, b) => b[1].n - a[1].n);
  if (opp.length) {
    h += `<h3>${t('Against each player')}</h3><table class="st-table"><thead><tr><th>${t('Player')}</th><th>${t('Games')}</th><th>${t('You ahead')}</th><th>${t('Margin')}</th></tr></thead><tbody>`
      + opp.map(([nm, o]) => `<tr><td>${escHTML(nm)}${o.bot ? '' : ` <small>${t('(person)')}</small>`}</td><td>${o.n}</td><td>${pct(o.ahead, o.n)}</td><td>${avgTxt(o.margin, o.n)}</td></tr>`).join('')
      + `</tbody></table><p class="st-note">${t('You ahead: games where you finished above them. Margin: your score minus theirs, per game.')}</p>`;
  }
  return h + '</div>';
}
function statsHeadHTML(all) {
  const seg = (k, opts) => `<span class="seg" role="group">` + opts.map(([v, label]) =>
    `<button class="${statsFilter[k] === v ? 'on' : ''}" aria-pressed="${statsFilter[k] === v}" onclick="setStatsFilter('${k}', '${v}')">${label}</button>`).join('') + '</span>';
  return `<h2>${t('Your stats')}</h2><p class="sub">${t('{games} on this device.', { games: nOf(all.length, 'finished game', 'finished games', 'joc terminat', 'jocuri terminate') })}</p>`
    + `<div class="st-filters">${seg('where', [['all', t('All')], ['solo', t('Solo')], ['online', t('Online')]])}${seg('mode', [['all', t('Both')], ['linear', t('Classic')], ['geometric', t('Geometric')]])}</div>`;
}
function renderStats() {
  const ov = document.getElementById('stats-overlay');
  if (!ov) return;
  const all = statsAll();
  ov.querySelector('.sheet-head').innerHTML = statsHeadHTML(all);
  ov.querySelector('.sheet-scroll').innerHTML = statsHTML(all);
}
function showStats(stack = false) {
  const all = statsAll();
  openSheet('stats-overlay', statsHeadHTML(all), statsHTML(all),
    `<span></span><button class="btn-ink" onclick="closeStats()">${t('Back')}</button>`, false, stack);
}
function closeStats() { document.getElementById('stats-overlay')?.remove(); }

// Resign: the game ends now and counts as a loss (last place in your stats)
function resignGame() {
  if (!G.roundSequence || G.phase === 'gameOver') return;
  openSheet('resign-overlay', `<h2>${t('Resign this game?')}</h2>${winChanceHTML()}`,
    `<p class="resign-note">${t('Resigning counts as a loss. You can keep playing instead.')}</p>`,
    `<button onclick="confirmResignGame()">${t('Resign')}</button><button class="btn-ink" onclick="document.getElementById('resign-overlay').remove()">${t('Keep playing')}</button>`,
    true, true);
}
function confirmResignGame() {
  if (!G.roundSequence || G.phase === 'gameOver') return;
  G.resigned = true;
  G.phase = 'gameOver';
  clearAutoPlay();
  clearTimeout(autoBidTimer); autoBidTimer = null;
  if (G.gameLog) G.gameLog.resigned = true;
  showGameOver();
}

function showGameOver() {
  removeOverlays();
  clearSavedState();
  logGameEnd();
  sfxGameOver();
  const { title } = finalTitle();
  openSheet('gameover-overlay', `<h2>${title}</h2>${finalRankHTML()}<div id="luck-box" class="luck"></div>${bidCheckSummaryHTML()}${playCheckSummaryHTML()}`,
    sheetTableHTML({ final: true }),
    `<span class="foot-links"><button onclick="showStats(true)">${t('Your stats')}</button></span><button class="btn-ink" onclick="resetGame()">${t('Play again')}</button>`, false);
  startLuckCheck();
}

function resetGame() {
  stopLuckCheck();
  removeOverlays();
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('setup-screen').style.display = '';
}

function removeOverlays() {
  document.querySelectorAll('.overlay').forEach(el => el.remove());
}

function showHistory() {
  if (!G || !G.roundSequence) return;
  openSheet('history-overlay', `<h2>${t('Score sheet')}</h2><p class="sub">${scoringLine()}</p>`,
    sheetTableHTML({ winRow: true }),
    `<div class="foot-links"><button id="download-btn" onclick="downloadGameLogs()">${t('Download game logs')}</button></div>`
    + `<button class="btn-ink" onclick="removeOverlays()">${t('Back to the table')}</button>`, true);
}

// ─── Human Actions ───
function humanBid(bid) {
  if (G.phase !== 'bidding' || G.currentBidderIndex !== 0) return;
  clearSuggestion();
  recordBidCheck(bid);
  placeBid(0, bid);
}

function humanPlayCard(rank, suit) {
  if (G.phase !== 'playing' || currentPlayerToAct() !== 0) return;
  const card = G.hands[0].find(c => c.rank === rank && c.suit === suit);
  if (!card) return;
  const ledSuit = G.currentTrick.length > 0 ? G.currentTrick[0].card.suit : null;
  const legal = getLegalMoves(G.hands[0], ledSuit, G.trumpSuit);
  if (!legal.some(c => c.rank === rank && c.suit === suit)) return;
  clearAutoPlay();
  clearSuggestion();
  recordPlayCheck(card);
  playCard(0, card);
}

function clearSuggestion() {
  const box = document.getElementById('suggestion-box');
  if (box) box.remove();
  suggestionVisible = false;
  document.querySelectorAll('.card.suggested').forEach(el => el.classList.remove('suggested'));
}

function toggleBidSuggestion() {
  const box = document.getElementById('suggestion-box');
  if (box) { box.remove(); return; }

  const hand = G.hands[0];
  const cpp = G.cardsPerPlayer;
  let estimate = 0;
  const reasons = [];

  // Evaluate hand — same logic as AI but with explanations
  const suitCards = {};
  for (const s of SUITS) suitCards[s] = [];
  for (const c of hand) suitCards[c.suit].push(c);
  for (const s of SUITS) suitCards[s].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);

  for (const suit of SUITS) {
    const cards = suitCards[suit];
    if (cards.length === 0) continue;
    const isTrump = G.trumpSuit && suit === G.trumpSuit;
    const sym = SUIT_SYMBOL[suit];

    for (const card of cards) {
      const val = RANK_VALUE[card.rank];
      if (isTrump) {
        if (val >= 13) { estimate += 0.9; reasons.push(t('{card} is a high trump — near-certain trick', { card: card.rank + sym })); }
        else if (val >= 11) { estimate += 0.5; reasons.push(t('{card} is a mid trump — likely trick', { card: card.rank + sym })); }
        else { estimate += 0.15; }
      } else {
        if (val === 14) { estimate += 0.85; reasons.push(t('{card} is an Ace — strong winner', { card: card.rank + sym })); }
        else if (val === 13) {
          const hasAce = cards.some(c => c.rank === 'A');
          const v = hasAce ? 0.6 : 0.45;
          estimate += v;
          if (hasAce) reasons.push(t('{card} backed by Ace — solid', { card: card.rank + sym }));
          else reasons.push(t('{card} without Ace — may lose to it', { card: card.rank + sym }));
        }
        else if (val === 12) {
          const protected_ = cards.some(c => RANK_VALUE[c.rank] > 12);
          estimate += protected_ ? 0.25 : 0.12;
        }
      }
    }
  }

  // Void bonus
  if (G.trumpSuit) {
    const trumpCount = (suitCards[G.trumpSuit] || []).length;
    for (const s of SUITS) {
      if (s !== G.trumpSuit && suitCards[s].length === 0 && trumpCount > 0) {
        estimate += 0.35;
        reasons.push(t('Void in {suit} — can trump in', { suit: SUIT_SYMBOL[s] }));
      }
    }
  }

  if (!G.trumpSuit) estimate *= 1.1;

  let suggestedBid = Math.round(estimate);
  suggestedBid = Math.max(0, Math.min(cpp, suggestedBid));

  // Check forbidden
  const last = isLastBidder();
  const {valid, forbidden} = getValidBids(cpp, G.bids, last);
  if (!valid.includes(suggestedBid)) {
    suggestedBid = suggestedBid > 0 ? suggestedBid - 1 : suggestedBid + 1;
    suggestedBid = Math.max(0, Math.min(cpp, suggestedBid));
    reasons.push(t('(adjusted to avoid forbidden bid)'));
  }

  const topReasons = reasons.slice(0, 4).join('. ');
  const html = `<div id="suggestion-box">
    ${t('Suggested bid:')} <span class="suggestion-card">${suggestedBid}</span>
    <div class="suggestion-reason">${topReasons || t('A weak hand. Bid low.')}</div>
  </div>`;
  document.getElementById('me-area').insertAdjacentHTML('beforeend', html);
}

// ─── LocalStorage Persistence ───
function saveState() {
  try { localStorage.setItem('wist-state', JSON.stringify(G)); } catch(e) {}
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem('wist-state');
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Only resume a game still in progress: not one whose last round is over
    if (!saved || !saved.phase || saved.phase === 'dealing' || !saved.roundSequence) return null;
    const finished = saved.phase === 'gameOver' ||
      (saved.phase === 'roundResult' && saved.currentRoundIndex + 1 >= saved.roundSequence.length);
    return finished ? null : saved;
  } catch(e) { return null; }
}

function clearSavedState() {
  try { localStorage.removeItem('wist-state'); } catch(e) {}
  const slot = document.getElementById('resume-slot');   // the Resume button drawn at load is now stale
  if (slot) slot.innerHTML = '';
}

function resumeGame() {
  const saved = loadSavedState();
  if (!saved) return;
  G = saved;
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('game-screen').classList.add('active');
  renderAll();
  // If it was an AI's turn, kick them off
  if (G.phase === 'bidding' && G.currentBidderIndex !== 0) {
    setTimeout(processAIBid, 600);
  } else if (G.phase === 'bidding') {
    checkAutoBid();
  } else if (G.phase === 'playing' && G.currentTrick.length === G.numPlayers) {
    // saved between the last card of a trick and its resolution
    setTimeout(resolveTrick, 500);
  } else if (G.phase === 'playing' && currentPlayerToAct() !== 0) {
    setTimeout(processAIPlay, 500);
  } else if (G.phase === 'playing' && currentPlayerToAct() === 0) {
    checkAutoPlay();
  } else if (G.phase === 'roundResult') {
    const last = G.roundHistory[G.roundHistory.length - 1];
    if (last) showRoundResult(last.roundScores);
  }
}

// Hook saveState into key game actions
const _origPlaceBid = placeBid;
placeBid = function(p, b) { _origPlaceBid(p, b); saveState(); };

const _origPlayCard = playCard;
playCard = function(p, c) { _origPlayCard(p, c); saveState(); };

const _origEndRound = endRound;
endRound = function() { _origEndRound(); saveState(); };

const _origResetGame = resetGame;
resetGame = function() { _origResetGame(); clearSavedState(); };

// On load: show resume button if saved state exists
window.addEventListener('DOMContentLoaded', () => {
  // Auto-start from URL parameters:
  //   ?players=6     — start with 6 players
  //   ?cards=6        — override to play only 6-card rounds
  //   ?players=4&cards=5  — 4 players, 5-card rounds only
  const params = new URLSearchParams(window.location.search);
  // Restore / URL-override scoring mode (?scoring=geometric)
  const urlScoring = params.get('scoring');
  const savedScoring = urlScoring || localStorage.getItem('wist-scoring-mode');
  if (savedScoring === 'geometric') {
    window._scoringMode = 'geometric';
    const gt = document.getElementById('geometric-toggle');
    if (gt) { gt.checked = true; onScoringToggle(); }
  }
  // Fast play preference (?fast=1 overrides)
  const urlFast = params.get('fast');
  setFastPlay(urlFast === '1' || urlFast === 'on' ? true : urlFast === '0' || urlFast === 'off' ? false : localStorage.getItem('wist-fast-play') === '1');
  // Optional AI seat preferences (default on)
  const urlCodex = params.get('codex');
  const savedCodex = localStorage.getItem('wist-include-codex');
  const includeCodex = urlCodex === '0' || urlCodex === 'off' ? false
    : urlCodex === '1' || urlCodex === 'on' ? true
    : savedCodex === null ? true : savedCodex === '1';
  window._includeCodex = includeCodex;
  const codexTg = document.getElementById('codex-toggle');
  if (codexTg) { codexTg.checked = includeCodex; onCodexToggle(); }

  const urlGrok = params.get('grok');
  const savedGrok = localStorage.getItem('wist-include-grok');
  const includeGrok = urlGrok === '0' || urlGrok === 'off' ? false
    : urlGrok === '1' || urlGrok === 'on' ? true
    : savedGrok === null ? true : savedGrok === '1';
  window._includeGrok = includeGrok;
  const grokTg = document.getElementById('grok-toggle');
  if (grokTg) { grokTg.checked = includeGrok; onGrokToggle(); }

  const geminiKey = params.get('gemini');
  if (geminiKey) window._geminiApiKey = geminiKey;
  // Restore previously-used Gemini key into the setup toggle
  const savedGeminiKey = geminiKey || localStorage.getItem('wist-gemini-key');
  if (savedGeminiKey) {
    const tg = document.getElementById('gemini-toggle');
    const ki = document.getElementById('gemini-key');
    if (tg && ki) { tg.checked = true; ki.value = savedGeminiKey; onGeminiToggle(); }
  }

  const urlJev = params.get('jev');
  const savedJevPref = localStorage.getItem('wist-include-jev');
  const includeJev = urlJev === '0' || urlJev === 'off' ? false
    : urlJev === '1' || urlJev === 'on' ? true
    : savedJevPref === null ? true : savedJevPref === '1';
  window._includeJev = includeJev && jevConfigured();
  const jevRow = document.getElementById('jev-toggle-row');
  const jevTg = document.getElementById('jev-toggle');
  if (jevRow && jevTg) {
    jevRow.style.display = jevConfigured() ? 'block' : 'none';
    jevTg.checked = window._includeJev;
    if (jevTg.checked) onJevToggle();
  }
  const autoPlayers = parseInt(params.get('players'));
  const autoCards = parseInt(params.get('cards'));
  if (autoCards >= 1 && autoCards <= 8) {
    window._forceCards = autoCards;
  }
  if (autoPlayers >= 3 && autoPlayers <= 6) {
    startGame(autoPlayers);
    return;
  }

  if (params.get('stats') === '1') showStats();
  renderResumeSlot();
});

function renderResumeSlot() {
  const saved = loadSavedState(), slot = document.getElementById('resume-slot');
  if (slot) slot.innerHTML = saved ? `<button class="btn-ink" onclick="resumeGame()">${t('Resume round {r} of {n}', { r: saved.currentRoundIndex + 1, n: saved.roundSequence.length })}</button>` : '';
}
// After a language switch: everything not rebuilt by translateStatic
function onLangChange() {
  renderResumeSlot();
  if (document.getElementById('stats-overlay')) renderStats();
  if (G && G.roundSequence && document.getElementById('game-screen').classList.contains('active')) renderAll();
}

// ─── Service Worker Registration ───
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

configureGameEffects({
  sfxDeal: (...args) => sfxDeal(...args),
  sfxBid: (...args) => sfxBid(...args),
  sfxCardPlay: (...args) => sfxCardPlay(...args),
  sfxAutoPlay: (...args) => sfxAutoPlay(...args),
  sfxTrickWin: (...args) => sfxTrickWin(...args),
  sfxRoundEnd: (...args) => sfxRoundEnd(...args),
  renderAll: (...args) => renderAll(...args),
  showRoundResult: (...args) => showRoundResult(...args),
  checkAutoBid: (...args) => checkAutoBid(...args),
  trickWinReason: (...args) => trickWinReason(...args),
});

function eightCardRoundHTML() {
  const pos = eightCardRoundPosition();
  return pos ? `<span class="eight-round">${t('8 cards · {x} of {n}', { x: pos.current, n: pos.total })}</span>` : '';
}
function winChanceText(estimate) {
  if (estimate.certain) return estimate.chance === 1 ? '100%' : '0%';
  const percent = Math.round(estimate.chance * 100);
  return percent < 1 ? '<1%' : percent > 99 ? '>99%' : `≈${percent}%`;
}
function winChanceHTML() {
  const estimate = estimateWinChance();
  return `<div class="win-chance"><b>${t('Chance of finishing first: {chance}', { chance: escHTML(winChanceText(estimate)) })}</b>
    <p>${t('Score-based estimate from scores, remaining rounds and bidding accuracy. Ties count as wins.')}</p></div>`;
}
Object.assign(RO, {
  'Resign this game?': 'Renunți la acest joc?',
  'Keep playing': 'Continuă jocul',
  'Resigning counts as a loss. You can keep playing instead.': 'Renunțarea contează ca înfrângere. Poți continua să joci.',
  'Show win chances after each round': 'Arată șansele de câștig după fiecare rundă',
  'Approximate score-based estimate, including ties for first.': 'Estimare aproximativă pe baza scorurilor, inclusiv egalitatea pe primul loc.',
  'Lead over the best opponent': 'Avans față de cel mai bun adversar',
  'Chance of finishing first: {chance}': 'Șansa de a termina pe primul loc: {chance}',
  'Score-based estimate; ties count as wins. The current hand is not evaluated.': 'Estimare pe baza scorurilor; egalitatea contează ca victorie. Mâna curentă nu este evaluată.',
  'Score-based estimate from scores, remaining rounds and bidding accuracy. Ties count as wins.': 'Estimare pe baza scorurilor, rundelor rămase și preciziei licitațiilor. Egalitatea contează ca victorie.',
  '8 cards · {x} of {n}': '8 cărți · {x} din {n}',
  'win': 'șanse'
});
translateStatic();
