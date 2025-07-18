export function getThirdFriday(year: number, month: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, month - 1, day)
    if (date.getMonth() !== month - 1) break
    if (date.getDay() === 5) {
      count++
      if (count === 3) return date.toISOString().split('T')[0]
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-15` // fallback
}

export function normalizeExpiry(expiry: string): string {
  if (/^\d{4}-\d{2}$/.test(expiry)) {
    const [year, month] = expiry.split('-').map(Number)
    return getThirdFriday(year, month)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return expiry
  }
  return expiry
}

export function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0');
}

export function getSymbolFromExpiryStrike(ticker: string, expiry: string, strike: number): string {
  const dateKey = expiry.replace(/-/g, '').slice(2);
  return `O:${ticker}${dateKey}C${formatStrike(strike)}`;
}

export function isFattibile(opt: OptionEntry, item: OptionData, prices: PricesData) {
  const tickerPrices = prices[item.ticker] || {};
  const optPriceData = tickerPrices[opt.symbol];
  const optBid = optPriceData?.bid ?? opt.bid ?? 0;
  const optLast = optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0;
  const liveOptPrice = optBid > 0 ? optBid : optLast;
  if (liveOptPrice <= 0) return false;

  const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
  const currentData = tickerPrices[currentSymbol] ?? { ask: item.current_ask ?? 0, last_trade_price: item.current_last_trade_price ?? 0 };
  const currentAsk = currentData.ask ?? 0;
  const currentLast = currentData.last_trade_price ?? 0;
  const liveCurrentPrice = currentAsk > 0 ? currentAsk : currentLast;
  if (liveCurrentPrice <= 0) return false;

  return (
    item.spot < opt.strike &&
    opt.strike >= item.spot * 1.04 &&
    liveOptPrice >= liveCurrentPrice * 1.00
  );
}

// Assumi di aggiungere anche le interfacce se non presenti
export interface OptionEntry {
  label: string;
  bid: number;
  ask: number;
  last_trade_price: number;
  strike: number;
  expiry: string;
  symbol: string;
}

export interface OptionData {
  ticker: string;
  spot: number;
  strike: number;
  expiry: string;
  current_bid: number;
  current_ask: number;
  current_last_trade_price: number;
  earlier: OptionEntry[];
  future: OptionEntry[];
  invalid?: boolean;
}

export interface PricesData {
  [ticker: string]: {
    [symbol: string]: { bid: number; ask: number; last_trade_price: number };
  };
}