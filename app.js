/* Saturday Scoreboard - data-driven renderer.
 *
 * Everything on the page derives from data/weeks.json. Nothing about a given
 * week is hardcoded here: tabs, slicers, the week->label map and the breakdown
 * rows are all built from whatever weeks appear in the feed. Adding week N is
 * a JSON write, never a markup edit.
 */
(function () {
  'use strict';

  // ---------- money / odds helpers ----------
  function americanToDecimal(o) { return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o); }
  function impliedProb(o) { return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100); }
  function toWin(o, wager) { return o > 0 ? wager * o / 100 : wager * 100 / Math.abs(o); }
  function fmtUSD(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }
  function fmtNet(n) { return (n > 0 ? '+' : '') + fmtUSD(n); }
  function fmtPct(n) { return (n * 100).toFixed(1) + '%'; }
  function fmtAmerican(n) { var r = Math.round(n); return (r > 0 ? '+' : '') + r; }
  function fmtOdds(o) { return o > 0 ? '+' + o : '−' + Math.abs(o); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Profit for a settled ticket. Push returns the stake: zero profit, not a loss.
  function ticketProfit(t) {
    if (t.result === 'Win') return toWin(t.odds, t.wager);
    if (t.result === 'Loss') return -t.wager;
    return 0; // Push or Pending
  }

  // ---------- state ----------
  var DATA = null;
  var WEEKS = [];          // sorted ascending
  var activeWeeks = {};    // week number -> bool (profitability slicer)

  // ---------- ticket rendering ----------
  function ticketHTML(t) {
    var profit = ticketProfit(t);
    var win = toWin(t.odds, t.wager);
    var status = t.result || 'Pending';
    var statusClass = status.toLowerCase();

    var plText, plClass;
    if (status === 'Win') { plText = '+' + fmtUSD(profit); plClass = 'win'; }
    else if (status === 'Loss') { plText = fmtUSD(profit); plClass = 'loss'; }
    else if (status === 'Push') { plText = fmtUSD(0); plClass = 'push'; }
    else { plText = 'Pending'; plClass = 'pending'; }

    var colors = t.colors && t.colors.length === 2 ? t.colors : ['#8a8a86', '#c9c8c2'];
    var stripe = 'linear-gradient(90deg,' + colors[0] + ' 50%,' + colors[1] + ' 50%)';

    var tierBadge = t.tier === 'lean'
      ? '<span class="tier-badge lean">Lean</span>'
      : '<span class="tier-badge bet">Bet</span>';

    var parts = [];
    parts.push('<article class="ticket" id="' + esc(t.id) + '">');
    parts.push('<div class="stripe" style="background:' + stripe + ';"></div>');
    parts.push('<div class="ticket-body">');
    parts.push('<div class="ticket-top"><div class="matchup">');
    parts.push('<span class="teams">' + esc(t.matchup) + '</span>');
    parts.push('<span class="meta">' + esc(t.venue) + (t.kickoff ? ' &middot; ' + esc(t.kickoff) : '') + '</span>');
    parts.push('</div><span class="pill ' + statusClass + '"><span class="dot"></span><span>' + esc(status) + '</span></span></div>');

    parts.push('<div class="pick-row">');
    parts.push('<span class="bettype">' + esc(t.bet_type) + '</span>');
    parts.push('<span class="pick">' + esc(t.pick) + '</span>');
    parts.push('<span class="odds mono">(' + fmtOdds(t.odds) + ')</span>');
    parts.push(tierBadge);
    parts.push('</div>');

    parts.push('<dl class="figures">');
    parts.push('<div class="figure"><dt>Wager</dt><dd class="mono">' + fmtUSD(t.wager) + '</dd></div>');
    parts.push('<div class="figure"><dt>To Win</dt><dd class="mono">' + fmtUSD(win) + '</dd></div>');
    parts.push('<div class="figure"><dt>Profit / Loss</dt><dd class="mono ' + plClass + '">' + plText + '</dd></div>');
    parts.push('</dl>');

    if (t.why) parts.push('<div class="why"><h4>Why this bet</h4><p>' + esc(t.why) + '</p></div>');
    if (t.trend) parts.push('<div class="trend"><h4>Trend check</h4><p>' + esc(t.trend) + '</p></div>');

    parts.push('</div></article>');
    return parts.join('');
  }

  function parlaySummary(p) {
    var combinedDecimal = 1, combinedProb = 1, anyLoss = false, allWin = true;
    (p.legs || []).forEach(function (leg) {
      combinedDecimal *= americanToDecimal(leg.odds);
      combinedProb *= impliedProb(leg.odds);
      var r = leg.result || 'Pending';
      if (r === 'Loss') anyLoss = true;
      if (r !== 'Win') allWin = false;
    });
    var profit = p.wager * (combinedDecimal - 1);
    var result = anyLoss ? 'Loss' : (allWin ? 'Win' : 'Pending');
    return {
      decimal: combinedDecimal, prob: combinedProb, wager: p.wager, result: result,
      profit: result === 'Win' ? profit : (result === 'Loss' ? -p.wager : 0),
      potentialProfit: profit
    };
  }

  function parlayHTML(p) {
    var s = parlaySummary(p);
    var american = s.decimal >= 2 ? (s.decimal - 1) * 100 : -100 / (s.decimal - 1);
    var parts = [];
    parts.push('<article class="parlay" id="' + esc(p.id) + '">');
    parts.push('<div class="parlay-head"><h3>' + esc(p.label || 'Parlay') + '</h3>');
    parts.push('<span class="mono">' + fmtUSD(p.wager) + ' &middot; ' + fmtAmerican(american) + '</span></div>');
    parts.push('<ol class="legs">');
    (p.legs || []).forEach(function (leg) {
      var r = leg.result || 'Pending';
      parts.push('<li class="leg"><span class="leg-pick">' + esc(leg.pick) + '</span>' +
        '<span class="odds mono">(' + fmtOdds(leg.odds) + ')</span>' +
        '<span class="leg-status pill ' + r.toLowerCase() + '">' + esc(r) + '</span></li>');
    });
    parts.push('</ol>');
    parts.push('<dl class="figures">');
    parts.push('<div class="figure"><dt>Implied</dt><dd class="mono">' + fmtPct(s.prob) + '</dd></div>');
    parts.push('<div class="figure"><dt>Payout</dt><dd class="mono">' + fmtUSD(p.wager + s.potentialProfit) + '</dd></div>');
    var rText = s.result === 'Win' ? 'Win (+' + fmtUSD(s.profit) + ')'
      : s.result === 'Loss' ? 'Loss (' + fmtUSD(s.profit) + ')' : 'Pending';
    parts.push('<div class="figure"><dt>Result</dt><dd class="mono ' + s.result.toLowerCase() + '">' + rText + '</dd></div>');
    parts.push('</dl></article>');
    return parts.join('');
  }

  // ---------- week panels ----------
  function weekPanelHTML(w) {
    var staked = 0, net = 0, pend = 0;
    (w.tickets || []).forEach(function (t) {
      staked += t.wager;
      net += ticketProfit(t);
      if (!t.result || t.result === 'Pending') pend++;
    });

    var parts = [];
    parts.push('<section class="tab-panel" id="tab-week' + w.week + '" role="tabpanel" hidden>');
    parts.push('<div class="week-header"><h2>' + esc(w.label || ('Week ' + w.week)) + '</h2>');
    parts.push('<p class="caption">' + (w.tickets || []).length + ' tickets &middot; ' + fmtUSD(staked) + ' staked' +
      (pend ? ' &middot; ' + pend + ' pending' : ' &middot; net ' + fmtNet(net)) + '</p></div>');
    (w.tickets || []).forEach(function (t) { parts.push(ticketHTML(t)); });
    (w.parlays || []).forEach(function (p) { parts.push(parlayHTML(p)); });
    parts.push('</section>');
    return parts.join('');
  }

  // ---------- profitability ----------
  function collectItems(weekFilter) {
    var items = [];
    WEEKS.forEach(function (w) {
      if (!weekFilter(w.week)) return;
      (w.tickets || []).forEach(function (t) {
        items.push({
          week: w.week, label: t.matchup, sub: t.pick + ' · ' + fmtUSD(t.wager) + ' straight',
          wager: t.wager, result: t.result || 'Pending', profit: ticketProfit(t)
        });
      });
      (w.parlays || []).forEach(function (p) {
        var s = parlaySummary(p);
        items.push({
          week: w.week, label: p.label || 'Parlay', sub: (p.legs || []).length + ' legs · ' + fmtUSD(p.wager),
          wager: s.wager, result: s.result, profit: s.profit
        });
      });
    });
    items.sort(function (a, b) { return a.week - b.week; });
    return items;
  }

  function weekTotals(items) {
    var out = {};
    items.forEach(function (it) {
      var w = out[it.week] || (out[it.week] = { n: 0, risked: 0, returned: 0, net: 0, wins: 0, losses: 0, pushes: 0, pending: 0 });
      w.n++; w.risked += it.wager;
      if (it.result === 'Win') { w.returned += it.wager + it.profit; w.net += it.profit; w.wins++; }
      else if (it.result === 'Loss') { w.net += it.profit; w.losses++; }
      else if (it.result === 'Push') { w.returned += it.wager; w.pushes++; }
      else { w.pending++; }
    });
    return out;
  }

  function fmtRecord(w) {
    var s = w.wins + '–' + w.losses;
    if (w.pushes) s += '–' + w.pushes;
    if (w.pending) s += ' (' + w.pending + ' pending)';
    return s;
  }

  function labelFor(week) {
    for (var i = 0; i < WEEKS.length; i++) if (WEEKS[i].week === week) return WEEKS[i].label || ('Week ' + week);
    return 'Week ' + week;
  }

  function buildTicketsChartSVG(items) {
    var rowH = 46, barH = 26, top = 8, left = 230, axisSpan = 340, right = left + axisSpan, headH = 40, groupGap = 14;
    if (!items.length) {
      return { svg: '<text x="20" y="30" font-family="IBM Plex Mono, monospace" font-size="12" fill="#6b6a66">No tickets in the selected week(s).</text>', height: 60 };
    }
    var maxAbs = 20;
    items.forEach(function (it) {
      maxAbs = Math.max(maxAbs, it.result === 'Pending' ? it.wager : Math.abs(it.profit));
    });
    var niceMax = Math.ceil(maxAbs / 5) * 5;
    var pxPerDollar = axisSpan / niceMax;
    var totals = weekTotals(items);
    var parts = [], y = top, lastWeek = null;

    items.forEach(function (it) {
      if (it.week !== lastWeek) {
        if (lastWeek !== null) y += groupGap;
        lastWeek = it.week;
        var wt = totals[it.week];
        var netColor = wt.net > 0 ? 'var(--win)' : (wt.net < 0 ? 'var(--loss)' : 'var(--ink-soft)');
        parts.push('<text x="16" y="' + (y + 16) + '" font-family="Oswald, sans-serif" font-size="16" font-weight="700" letter-spacing="1" fill="var(--ink)">' + esc(labelFor(it.week).toUpperCase()) + '</text>');
        parts.push('<text x="' + right + '" y="' + (y + 16) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--ink-soft)">' + esc(fmtRecord(wt)) + ' · </text>');
        parts.push('<text x="' + (right + 60) + '" y="' + (y + 16) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600" fill="' + netColor + '">' + esc(fmtNet(wt.net)) + '</text>');
        parts.push('<line x1="16" y1="' + (y + 26) + '" x2="' + (right + 60) + '" y2="' + (y + 26) + '" stroke="var(--line)" stroke-width="1"></line>');
        y += headH;
      }
      var color = it.result === 'Win' ? 'var(--win)' : (it.result === 'Loss' ? 'var(--loss)' : (it.result === 'Push' ? 'var(--ink-soft)' : 'var(--pending)'));
      var mag = it.result === 'Pending' ? it.wager : Math.abs(it.profit);
      var w = Math.max(mag * pxPerDollar, 3);
      if (it.result === 'Pending') {
        parts.push('<rect x="' + left + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + barH + '" rx="4" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="4,3"></rect>');
      } else {
        parts.push('<rect x="' + left + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + barH + '" rx="4" fill="' + color + '"></rect>');
      }
      parts.push('<text x="16" y="' + (y + 8) + '" font-family="Oswald, sans-serif" font-size="13" font-weight="600" fill="var(--ink)">' + esc(it.label.toUpperCase()) + '</text>');
      parts.push('<text x="16" y="' + (y + 22) + '" font-family="IBM Plex Mono, monospace" font-size="10" fill="var(--ink-soft)">' + esc(it.sub) + '</text>');
      var labelText = it.result === 'Pending' ? 'Pending' : (it.result === 'Push' ? 'Push' : (it.result === 'Win' ? '+' + fmtUSD(it.profit) : fmtUSD(it.profit)));
      parts.push('<text x="' + (left + w + 10).toFixed(1) + '" y="' + (y + 18) + '" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="' + color + '">' + labelText + '</text>');
      y += rowH;
    });

    var axisY = y - rowH + barH + 16;
    parts.push('<line x1="' + left + '" y1="' + axisY + '" x2="' + right + '" y2="' + axisY + '" stroke="var(--line)" stroke-width="1"></line>');
    var ticks = ['<g font-family="IBM Plex Mono, monospace" font-size="10" fill="var(--ink-soft)" text-anchor="middle">'];
    for (var k = 0; k <= 4; k++) {
      var tx = left + (axisSpan * k / 4), tv = Math.round(niceMax * k / 4);
      ticks.push('<line x1="' + tx.toFixed(1) + '" y1="' + axisY + '" x2="' + tx.toFixed(1) + '" y2="' + (axisY + 6) + '" stroke="var(--line)"></line><text x="' + tx.toFixed(1) + '" y="' + (axisY + 18) + '">$' + tv + '</text>');
    }
    ticks.push('</g>');
    parts.push(ticks.join(''));
    return { svg: parts.join(''), height: axisY + 36 };
  }

  function buildRiskedReturnedSVG(totalRisked, totalReturned, hasPending) {
    var left = 230, axisSpan = 360, right = left + axisSpan;
    var niceMax = Math.max(100, Math.ceil(Math.max(totalRisked, totalReturned) / 25) * 25);
    var px = axisSpan / niceMax;
    var color2 = totalReturned > totalRisked ? 'var(--win)' : (hasPending ? 'var(--pending)' : 'var(--loss)');
    var w1 = Math.max(totalRisked * px, 2), w2 = Math.max(totalReturned * px, 2);
    var parts = [];
    parts.push('<rect x="' + left + '" y="26" width="' + w1.toFixed(1) + '" height="32" rx="4" fill="var(--ink-soft)"></rect>');
    parts.push('<text x="16" y="46" font-family="Oswald, sans-serif" font-size="13" font-weight="600" fill="var(--ink)">TOTAL RISKED</text>');
    parts.push('<text x="' + (left + w1 + 12).toFixed(1) + '" y="46" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="var(--ink)">' + fmtUSD(totalRisked) + '</text>');
    parts.push('<rect x="' + left + '" y="106" width="' + w2.toFixed(1) + '" height="32" rx="4" fill="' + color2 + '"></rect>');
    parts.push('<text x="16" y="126" font-family="Oswald, sans-serif" font-size="13" font-weight="600" fill="var(--ink)">TOTAL RETURNED</text>');
    parts.push('<text x="' + (left + w2 + 12).toFixed(1) + '" y="126" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="' + color2 + '">' + fmtUSD(totalReturned) + '</text>');
    parts.push('<line x1="' + left + '" y1="156" x2="' + right + '" y2="156" stroke="var(--line)" stroke-width="1"></line>');
    var ticks = ['<g font-family="IBM Plex Mono, monospace" font-size="10" fill="var(--ink-soft)" text-anchor="middle">'];
    for (var k = 0; k <= 4; k++) {
      var tx = left + (axisSpan * k / 4), tv = Math.round(niceMax * k / 4);
      ticks.push('<line x1="' + tx.toFixed(1) + '" y1="156" x2="' + tx.toFixed(1) + '" y2="162" stroke="var(--line)"></line><text x="' + tx.toFixed(1) + '" y="174">$' + tv + '</text>');
    }
    ticks.push('</g>');
    parts.push(ticks.join(''));
    return parts.join('');
  }

  function renderProfitability() {
    var selected = WEEKS.filter(function (w) { return activeWeeks[w.week]; }).map(function (w) { return w.week; });
    var sumText = document.getElementById('slicer-summary-text');
    if (sumText) {
      sumText.textContent = selected.length === 0 ? 'None selected'
        : selected.length === WEEKS.length ? 'All weeks'
          : selected.map(labelFor).join(' + ');
    }

    var items = collectItems(function (wk) { return selected.indexOf(wk) !== -1; });

    // Week-by-week table always covers every week in the feed, not just selected.
    var wbEl = document.getElementById('week-breakdown');
    if (wbEl) {
      var allTotals = weekTotals(collectItems(function () { return true; }));
      var rows = '', tot = { n: 0, risked: 0, returned: 0, net: 0, wins: 0, losses: 0, pushes: 0, pending: 0 };
      WEEKS.forEach(function (w) {
        var t = allTotals[w.week];
        if (!t) return;
        Object.keys(tot).forEach(function (k) { tot[k] += t[k]; });
        var nc = t.net > 0 ? 'var(--win)' : (t.net < 0 ? 'var(--loss)' : 'var(--ink-soft)');
        rows += '<tr><th scope="row">' + esc(labelFor(w.week)) + '</th><td class="num">' + t.n + '</td><td class="num">' + fmtUSD(t.risked) +
          '</td><td class="num">' + fmtUSD(t.returned) + '</td><td class="num" style="color:' + nc + ';font-weight:600;">' + fmtNet(t.net) +
          '</td><td class="num">' + fmtRecord(t) + '</td></tr>';
      });
      var tc = tot.net > 0 ? 'var(--win)' : (tot.net < 0 ? 'var(--loss)' : 'var(--ink-soft)');
      rows += '<tr class="total-row"><th scope="row">All weeks</th><td class="num">' + tot.n + '</td><td class="num">' + fmtUSD(tot.risked) +
        '</td><td class="num">' + fmtUSD(tot.returned) + '</td><td class="num" style="color:' + tc + ';font-weight:600;">' + fmtNet(tot.net) +
        '</td><td class="num">' + fmtRecord(tot) + '</td></tr>';
      wbEl.innerHTML = rows;
    }

    var risked = 0, returned = 0, net = 0, wins = 0, losses = 0, pushes = 0, pending = 0;
    items.forEach(function (it) {
      risked += it.wager;
      if (it.result === 'Win') { returned += it.wager + it.profit; net += it.profit; wins++; }
      else if (it.result === 'Loss') { net += it.profit; losses++; }
      else if (it.result === 'Push') { returned += it.wager; pushes++; }
      else { pending++; }
    });

    var sEl = document.getElementById('pnl-summary');
    if (sEl) {
      var plClass = net < 0 ? ' loss' : (net > 0 ? ' win' : '');
      var rec = wins + '–' + losses + (pushes ? '–' + pushes : '') +
        (pending ? ' <span class="pending-note">(' + pending + ' pending)</span>' : '');
      var roi = risked > 0 ? ' <span class="pending-note">(' + (net / risked * 100).toFixed(1) + '% ROI)</span>' : '';
      sEl.innerHTML =
        '<div class="stat"><dt>Total Risked</dt><dd class="mono">' + fmtUSD(risked) + '</dd></div>' +
        '<div class="stat"><dt>Total Returned</dt><dd class="mono">' + fmtUSD(returned) + '</dd></div>' +
        '<div class="stat' + plClass + '"><dt>Net Profit / Loss</dt><dd class="mono">' + fmtNet(net) + roi + '</dd></div>' +
        '<div class="stat' + plClass + '"><dt>Record</dt><dd class="mono">' + rec + '</dd></div>';
    }

    var chart = buildTicketsChartSVG(items);
    var cEl = document.getElementById('chart-tickets');
    if (cEl) { cEl.setAttribute('viewBox', '0 0 680 ' + chart.height); cEl.innerHTML = chart.svg; }
    var capEl = document.getElementById('chart1-caption');
    if (capEl) {
      capEl.textContent = items.length
        ? 'Dollars won or lost per ticket, for the ' + items.length + ' ticket' + (items.length === 1 ? '' : 's') + ' in the selected week(s).'
        : 'Nothing selected — check a week above.';
    }
    var rrEl = document.getElementById('chart-risked');
    if (rrEl) rrEl.innerHTML = buildRiskedReturnedSVG(risked, returned, pending > 0);
  }

  // ---------- tabs ----------
  function showTab(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) { p.hidden = p.id !== id; });
    Array.prototype.forEach.call(document.querySelectorAll('#main-tabs .tab-btn'), function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
  }

  function buildTabs() {
    var nav = document.getElementById('main-tabs');
    var btns = WEEKS.map(function (w) {
      return '<button class="tab-btn" role="tab" data-tab="tab-week' + w.week + '">' + esc(w.label || ('Week ' + w.week)) + '</button>';
    });
    btns.push('<button class="tab-btn" role="tab" data-tab="tab-profitability">Profitability</button>');
    btns.push('<button class="tab-btn" role="tab" data-tab="tab-model">Model</button>');
    nav.innerHTML = btns.join('');
    Array.prototype.forEach.call(nav.querySelectorAll('.tab-btn'), function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });
  }

  function buildSlicers() {
    var box = document.getElementById('slicer-checks');
    if (!box) return;
    box.innerHTML = WEEKS.map(function (w) {
      return '<label class="slicer-item"><input type="checkbox" class="slicer-check" data-week="' + w.week + '" checked> ' +
        esc(w.label || ('Week ' + w.week)) + '</label>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.slicer-check'), function (cb) {
      cb.addEventListener('change', function () {
        activeWeeks[parseInt(cb.getAttribute('data-week'), 10)] = cb.checked;
        renderProfitability();
      });
    });
  }

  function renderModelTab() {
    var vEl = document.getElementById('model-version-line');
    if (vEl) {
      vEl.textContent = 'Model ' + (DATA.model_version || 'unknown') +
        (DATA.updated ? ' · card generated ' + new Date(DATA.updated).toLocaleString() : '');
    }
    var cEl = document.getElementById('model-changelog');
    if (cEl) {
      var log = DATA.model_changelog || [];
      cEl.innerHTML = log.length
        ? '<ul class="changelog">' + log.map(function (e) {
          return '<li><b>' + esc(e.version) + '</b> &middot; <span class="mono">' + esc(e.date) + '</span><br>' + esc(e.note) + '</li>';
        }).join('') + '</ul>'
        : '<p class="caption">No model changes recorded yet.</p>';
    }
  }

  // ---------- boot ----------
  function render() {
    WEEKS = (DATA.weeks || []).slice().sort(function (a, b) { return a.week - b.week; });
    WEEKS.forEach(function (w) { activeWeeks[w.week] = true; });

    var panels = document.getElementById('panels');
    panels.innerHTML = WEEKS.map(weekPanelHTML).join('');
    panels.appendChild(document.getElementById('tpl-profitability').content.cloneNode(true));
    panels.appendChild(document.getElementById('tpl-model').content.cloneNode(true));

    buildTabs();
    buildSlicers();
    renderProfitability();
    renderModelTab();

    var sub = document.getElementById('subtitle');
    if (sub && DATA.updated) {
      sub.textContent = 'Picks, results and profitability by week · updated ' + new Date(DATA.updated).toLocaleDateString();
    }

    // Deep link, else newest week.
    var hash = (location.hash || '').replace('#', '');
    var valid = hash && document.getElementById(hash);
    showTab(valid ? hash : (WEEKS.length ? 'tab-week' + WEEKS[WEEKS.length - 1].week : 'tab-profitability'));
  }

  fetch('data/weeks.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) { DATA = json; render(); })
    .catch(function (err) {
      var el = document.getElementById('load-msg');
      if (el) el.textContent = 'Could not load data/weeks.json — ' + err.message;
    });
})();
