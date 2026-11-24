// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view
// with the model's own inputs and the protocol's farm plan, and the live-token
// set the board excludes. No network: every byte shown is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watch: false, growth: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so page and board agree.
  function impliedOf(r, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var age = r.age_days === null || r.age_days === undefined ? m.unknown_age_days : r.age_days;
    var mm = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var br = 1 + Math.min(Math.max((r.chains || []).length - 1, 0), m.breadth_max_chains) * m.breadth_per_chain;
    return Math.max(1, Math.round(r.tvl_usd * DATA.base_multiple * gm * mm * br));
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  // Farm plan: the same derivation main.ts writes to board.json — category,
  // chains, TVL and age decide the action, the capital, the hold and every
  // cost and time. No protocol name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; return 50; }
  function holdFor(a) { if (a === null || a === undefined) return 30; if (a < 180) return 60; if (a < 365) return 45; return 30; }
  function gasFor(ch) { return /ethereum|bitcoin|solana/i.test(ch) ? { tx: 'about $8 of gas', wk: 'about $5 of gas a week' } : { tx: 'about $1 of gas', wk: 'under $1 of gas a week' }; }
  function actionFor(p, cap, ch) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (/lend|cdp|collateral/.test(c)) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + ch + ', then borrow a small amount against it and repay it.';
    if (/dex|yield|leveraged farm|liquidity manager/.test(c)) return 'Provide $' + cap + ' of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.';
    if (/bridge/.test(c)) return 'Bridge $' + cap + ' of USDC to ' + ch + ' through ' + n + ', then use the bridged funds inside its app.';
    if (/staking|restak/.test(c)) return 'Stake $' + cap + " of the chain's staking asset through " + n + ' and keep the receipt token.';
    if (/perpetual|derivative|options/.test(c)) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ', open one small hedged trade, then close it.';
    if (/prediction/.test(c)) return 'Fund $' + cap + ' and place one market position on ' + n + ', then settle it.';
    if (/curator|allocator|risk/.test(c)) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + ch + ' and keep the shares for the full hold.';
    if (/stable/.test(c)) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + ch + ' and hold it.';
    if (/rwa/.test(c)) return 'Mint $' + cap + " of the protocol's yield-bearing asset on " + ch + ' and hold it.';
    if (/insurance/.test(c)) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + ch + ' and keep the policy open.';
    if (/farm/.test(c)) return 'Deposit $' + cap + " into " + n + "'s main farm on " + ch + ' and harvest once a week.';
    if (/chain/.test(c)) return 'Move $' + cap + ' of USDC onto ' + n + ' and use one of its native apps each week.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + ch + ' and keep the position open.';
  }
  function secondFor(p) {
    var c = (p.category || '').toLowerCase();
    if (/lend|cdp|collateral/.test(c)) return 'a borrow, a repayment or a fresh supply';
    if (/dex|yield|leveraged farm|liquidity manager/.test(c)) return 'a swap, a deposit or a rebalance';
    if (/bridge/.test(c)) return 'a bridge, a swap or a deposit';
    if (/staking|restak/.test(c)) return 'a top-up stake, a claim or a vote';
    if (/perpetual|derivative|options/.test(c)) return 'a trade, a deposit or a withdrawal';
    if (/prediction/.test(c)) return 'a market position or a settlement';
    if (/curator|allocator|risk/.test(c)) return 'a deposit, a vote or a rebalance';
    if (/rwa|stable/.test(c)) return 'a mint, a redemption or a deposit';
    return 'a deposit, a swap, a vote or a claim';
  }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; if (t.length > 600) t = t.slice(0, 596) + '...'; return t; }
  function farmSteps(p) {
    var ch = chainOf(p), cap = capitalFor(p), hold = holdFor(p.age_days), gas = gasFor(ch);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, cap, ch), cost: '$' + cap + ' of capital and ' + gas.tx, time: '15 minutes to set up' },
      { text: 'Do one qualifying action each week, such as ' + secondFor(p) + ', so the wallet shows repeated use.', cost: gas.wk, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: "Once a month, open the protocol's own points or rewards page from its own site and check the wallet's standing.", cost: 'no fee to check', time: '10 minutes a month' },
      { text: 'Never pay anyone to claim, never connect the wallet to a link from a chat or a search ad, and unwind in small steps if the position turns against you.', cost: 'nothing; a scam costs the whole position', time: '5 minutes to check each link' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var ps = new URLSearchParams(h);
    if (ps.get('q')) state.q = ps.get('q');
    if (ps.get('category')) state.category = ps.get('category');
    if (ps.get('chain')) state.chain = ps.get('chain');
    if (ps.get('watch')) state.watch = ps.get('watch') === '1';
    if (ps.get('growth')) state.growth = ps.get('growth');
    if (ps.get('tab')) state.tab = ps.get('tab');
    if (ps.get('p')) state.selected = ps.get('p');
  }
  function writeHash() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.category !== 'all') ps.set('category', state.category);
    if (state.chain !== 'all') ps.set('chain', state.chain);
    if (state.watch) ps.set('watch', '1');
    if (state.growth !== 'all') ps.set('growth', state.growth);
    if (state.tab !== 'pre-token') ps.set('tab', state.tab);
    if (state.selected) ps.set('p', state.selected);
    var next = ps.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.growth === 'up' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'dot' }), el('b', { text: 'Token Radar' }), el('span', { text: 'Pre-token · implied value' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })));
  }
  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what a launch would be worth' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) + ' pre-token protocols' }), ' below that floor, so the board covers all ', el('b', { text: String(DATA.board_size) + ' rankable pre-token protocols' }), ' in the snapshot. Implied value is a model, not a promise — and never a claim that a token will launch.')),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Base multiple (live median)' }), el('b', { text: DATA.base_multiple.toFixed(4) + 'x TVL' })),
        el('div', { class: 'stat' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) + ' · ' + top.name : 'n/a' })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))));
  }
  function spotlight() {
    var top = DATA.rows.slice(0, 10);
    return el('section', { class: 'spot' },
      el('h2', { text: 'The top ten' }),
      el('p', { class: 'sub', text: 'The ten largest implied launches. Select any card — or any board row — for its model breakdown and farm plan.' }),
      el('div', { class: 'cards' }, top.map(function (r) {
        return el('button', { type: 'button', class: 'card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rk', text: '#' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'v', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 's', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) }));
      })));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var gro = el('select', { id: 'growth', 'aria-label': 'Filter by 7-day growth' },
      el('option', { value: 'all', text: 'Any 7d move' }),
      el('option', { value: 'up', text: 'Growing (7d up)', selected: state.growth === 'up' ? 'selected' : null }),
      el('option', { value: 'down', text: 'Falling (7d down)', selected: state.growth === 'down' ? 'selected' : null }));
    gro.addEventListener('change', function () { state.growth = gro.value; writeHash(); render(); });
    var watch = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, onchange: function (e) { state.watch = e.target.checked; writeHash(); render(); } }), 'Watchlist only');
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('label', { for: 'growth', text: '7-day growth' }), gro),
      watch,
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filtered().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or growth filter to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.growth = 'all'; state.watch = false; writeHash(); render(); } })));
    }
    var max = 1; list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'imp' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, r.on_watchlist ? el('span', { class: 'badge', text: 'watchlist' }) : el('span', { class: 'sub', text: 'early' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'),
          sortHeader('age', 'Age'), sortHeader('chains', 'Chains'), sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'List' }))),
        tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl + 'x' })));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their median market-cap-per-TVL sets the board\u2019s base multiple.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
        tbody)));
  }
  function modelPanel() {
    var m = DATA.model;
    var cats = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; cats[c] = (cats[c] || 0) + 1; });
    var topCats = Object.keys(cats).map(function (c) { return [c, cats[c]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    var maxC = topCats.length ? topCats[0][1] : 1;
    return el('div', { class: 'two' },
      el('section', { class: 'panel box' },
        el('h2', { text: 'How implied value is computed' }),
        el('p', { class: 'sub', text: 'One function of the snapshot figures scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
        el('div', { class: 'formula' },
          'implied = round( tvl_usd x ' + DATA.base_multiple.toFixed(4) + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.01 x min(chains - 1, 10)) )'),
        el('div', null,
          el('div', { class: 'mrow' }, el('span', { text: 'Base multiple: median mcap / TVL of live protocols' }), el('b', { text: DATA.base_multiple.toFixed(4) + 'x (' + DATA.comparables_n + ' comparables)' })),
          el('div', { class: 'mrow' }, el('span', { text: 'Growth: 7-day TVL change, clamped, weight ' + m.growth_weight }), el('b', { text: m.growth_floor + '% to +' + m.growth_cap + '%' })),
          el('div', { class: 'mrow' }, el('span', { text: 'Maturity: days since first listed, unknown counts as ' + m.unknown_age_days + 'd' }), el('b', { text: m.maturity_floor + ' to 1.00' })),
          el('div', { class: 'mrow' }, el('span', { text: 'Breadth: one extra chain adds 1%, at most 10%' }), el('b', { text: '1.00 to 1.10' })))),
      el('section', { class: 'panel box' },
        el('h2', { text: 'Where the board sits' }),
        el('p', { class: 'sub', text: 'Pre-token protocols by category. Risk curators and RWA dominate the watchlist; the early radar spreads wider.' }),
        topCats.map(function (c) {
          return el('div', { class: 'catbar' },
            el('span', { text: c[0] }),
            el('div', { class: 'tr' }, el('i', { style: 'width:' + Math.max(3, Math.round((c[1] / maxC) * 100)) + '%' })),
            el('span', { class: 'n', text: String(c[1]) }));
        }),
        el('p', { class: 'sub', text: 'A protocol is called pre-token only because its DefiLlama record carries no token. That record is not proof: a protocol on this board may still have a token its record does not carry.' })));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'dhead' },
      el('div', null,
        el('span', { class: 'rk', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'unknown') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple (live median mcap / TVL)' }), el('b', { text: row.base_multiple.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token on record' }), el('b', { text: fmtAge(row.age_days) + ' → x' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { text: 'x' + row.breadth_multiplier })),
        el('div', { class: 'tot' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board — the data would be stale.') + ' An estimate, not a price, and no prediction that a token launches.' })));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Farm plan — seven steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        return el('li', null, el('b', { text: at >= 0 ? s.slice(0, at) : s }), el('span', { class: 'cost', text: at >= 0 ? s.slice(at + 1) : '' }));
      }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'note' },
      el('b', { text: 'Read this before farming: ' }),
      'every value here comes from one sealed DefiLlama snapshot dated ' + DATA.as_of + '. A protocol “records no token” when its record carries none — that is not proof it has none. Never pay to claim an airdrop, and never trust a link that did not come from the protocol\u2019s own site.'));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
