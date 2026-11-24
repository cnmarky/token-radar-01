// Token Radar — model radar-2.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks every
// protocol the snapshot lets the radar rank: the watchlist (40 protocols at or
// above the $50M floor) plus every other protocol that passes the house's own
// exclusion rule — 198 rows in this snapshot. A row must record no token (no
// market cap, no CoinGecko id, no symbol) and must not be a wrapped, staked or
// bridged product of a token that already trades: its category is not Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its
// name carries no whole word wrapped, staked or staking, does not begin with
// an exchange's name, and does not end in a version marker. That is what
// keeps WBTC, Binance staked ETH, USDT0 and the exchange bridges off the
// board: each is a wrapped or staked product of a token that already trades,
// not a protocol still waiting on a launch of its own. Live-token protocols
// are never ranked: they are set aside with their market caps, and they do a
// second job — they calibrate the model.
//
// Implied value is one function of the snapshot's own figures, the same for
// every row, no protocol name ever special-cased:
//
//   baseMultiple = median(mcap_usd / tvl_usd) over live protocols that carry
//                  both figures, clipped to [0.10, 0.50]. In this snapshot
//                  the median is about 0.20: the market's own answer to what
//                  a dollar of TVL is worth as token value, read off the
//                  protocols that already trade instead of asserted.
//   base         = tvl_usd x baseMultiple
//   growthMult   = 1 + clamp(change_7d, -50, 80) / 100 x 0.60
//                  (a 7-day TVL move, capped so one spike cannot win the
//                  board; a fall hurts, a rise helps, both bounded)
//   maturityMult = 0.60 + min(age_days, 1095) / 1095 x 0.40
//                  (age_days = days since DefiLlama first listed the
//                  protocol; unknown age counts as 365 days. Longer with no
//                  token means a longer track record behind the launch.)
//   breadthMult  = 1 + 0.01 x min(max(chains - 1, 0), 10)
//                  (deployed on more chains: a wider user base; at most +10%)
//   implied      = max(1, round(base x growthMult x maturityMult x breadthMult))
//
// The dashboard recomputes every row from the same figures and shows the
// four multipliers, so a reader can check the board's number by hand.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 80,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.01,
  breadth_max_chains: 10,
  multiple_floor: 0.1,
  multiple_cap: 0.5,
};

export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  base_multiple: number;
  comparables_n: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The base multiple, read off the snapshot itself: the median market-cap-per-
 * TVL among live protocols that carry both figures, clipped to the model's
 * floor and cap. No number is asserted; the market's own comparables set it.
 */
export function baseMultiple(snapshot: Snapshot, model: ModelConstants = MODEL): { multiple: number; n: number } {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return { multiple: 0.2, n: 0 };
  const mid = ratios.length >> 1;
  const median = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, median)), n: ratios.length };
}

/** The four multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  base: number,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that mark a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a product's name must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades — the house's own
 * exclusion rule, applied to the snapshot's ten fields.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))
  );
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiple } = baseMultiple(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  // A watchlist slug whose record is missing cannot be scored; the gate's
  // coverage row is checked in boardIssue and the run refuses instead.
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: multiple,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on the protocol's first chain: dear on the big L1s, cheap elsewhere. */
function gasFor(chain: string): { tx: string; weekly: string } {
  const dear = /ethereum|bitcoin|solana/i.test(chain);
  return dear
    ? { tx: 'about $8 of gas', weekly: 'about $5 of gas a week' }
    : { tx: 'about $1 of gas', weekly: 'under $1 of gas a week' };
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged trade, then close it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full hold.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and harvest once a week.`;
  if (c.includes('chain')) return `Move $${capital} of USDC onto ${name} and use one of its native apps each week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different qualifying action for the weekly step. */
function secondActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a borrow, a repayment or a fresh supply';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return 'a swap, a deposit or a rebalance';
  if (c.includes('bridge')) return 'a bridge, a swap or a deposit';
  if (c.includes('staking') || c.includes('restak')) return 'a top-up stake, a claim or a vote';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'a trade, a deposit or a withdrawal';
  if (c.includes('prediction')) return 'a market position or a settlement';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'a deposit, a vote or a rebalance';
  if (c.includes('rwa') || c.includes('stable')) return 'a mint, a redemption or a deposit';
  return 'a deposit, a swap, a vote or a claim';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const second = secondActionFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas.tx}`, time: '15 minutes to set up' },
    {
      text: `Do one qualifying action each week, such as ${second}, so the wallet shows repeated use.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a month, open the protocol's own points or rewards page from its own site and check the wallet's standing.`,
      cost: 'no fee to check',
      time: '10 minutes a month',
    },
    {
      text: `Never pay anyone to claim, never connect the wallet to a link from a chat or a search ad, and unwind in small steps if the position turns against you.`,
      cost: 'nothing; a scam costs the whole position',
      time: '5 minutes to check each link',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watch: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: watch.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { multiple, n } = baseMultiple(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    base_multiple: multiple,
    comparables_n: n,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watch)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
