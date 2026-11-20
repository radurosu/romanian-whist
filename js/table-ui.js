// Alternative presentation only. All decisions and transitions use game-engine.js.
const renderClassicTable = renderAll;
renderAll = function () {
  renderClassicTable();
  if (!G.roundSequence) return;
  const round = G.currentRoundIndex, bid = G.bids[ME], won = G.tricksWon[ME];
  const left = bid === null ? null : bid - won;
  const note = bid === null ? t('Bid exactly the tricks you will take.')
    : left > 0 ? t('You need {n} more.', { n: nOf(left, 'trick', 'tricks', 'mână', 'mâini') })
    : left === 0 ? (LANG === 'ro' ? 'Ținta e atinsă. Evită alte mâini.' : 'Right on target. Try to take no more.')
    : (LANG === 'ro' ? 'Ai depășit licitația. Evită alte mâini.' : 'Over your bid. Try to avoid more tricks.');
  document.getElementById('round-guide').innerHTML = `<span class="eyebrow">${LANG === 'ro' ? 'LA MASĂ' : 'AT THE TABLE'}</span>
    <div class="round-heading">${t('Round {n}', { n: round + 1 })} <small>/ ${G.roundSequence.length}</small></div>${eightCardRoundHTML()}
    <div class="round-track" aria-hidden="true">${G.roundSequence.map((_, i) => `<i class="${i < round ? 'done' : i === round ? 'now' : ''}"></i>`).join('')}</div>
    <div class="target-box"><span class="eyebrow">${LANG === 'ro' ? 'MÂINI / LICITAȚIE' : 'TRICKS / YOUR BID'}</span>
    <div class="target-value">${won} <span>/ ${bid === null ? '–' : bid}</span></div><p>${note}</p></div>`;
  document.getElementById('rail-scoring').textContent = scoringLine();
};
Object.assign(RO, {
  'Take a seat.': 'Ia loc la masă.',
  'Table settings & opponents': 'Setări și adversari',
  '← Original table': '← Masa originală',
  'How to play': 'Cum se joacă',
  'Score sheet ↗': 'Tabela de scor ↗',
  'Your stats ↗': 'Statisticile tale ↗'
});
I18N_ROOTS.push('#table-rail');
translateStatic();

function toggleTableRail() {
  setTableRailCollapsed(!document.getElementById('game-screen').classList.contains('rail-collapsed'));
}
function setTableRailCollapsed(collapsed) {
  document.getElementById('game-screen').classList.toggle('rail-collapsed', collapsed);
  const button = document.getElementById('rail-toggle');
  button.textContent = collapsed ? '›' : '‹';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', t(collapsed ? 'Expand sidebar' : 'Collapse sidebar'));
  button.title = t(collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  try { localStorage.setItem('wist-rail-collapsed', collapsed ? '1' : '0'); } catch (e) {}
}
Object.assign(RO, { 'Expand sidebar': 'Deschide panoul lateral', 'Collapse sidebar': 'Închide panoul lateral' });
try { setTableRailCollapsed(localStorage.getItem('wist-rail-collapsed') === '1'); } catch (e) {}
