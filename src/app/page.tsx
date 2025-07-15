'use client'

import React, { useEffect, useState, useRef } from 'react'
import { sendTelegramMessage } from './telegram';

function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0')
}

function getSymbolFromExpiryStrike(ticker: string, expiry: string, strike: number): string {
  const dateKey = expiry.replace(/-/g, '').slice(2)
  return `O:${ticker}${dateKey}C${formatStrike(strike)}`
}

interface OptionEntry {
  label: string
  price: number
  strike: number
  expiry: string
  symbol: string
}

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  currentCallPrice: number
  earlier: OptionEntry[]
  future: OptionEntry[]
  invalid?: boolean
}

function getThirdFriday(year: number, monthIndex: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, monthIndex, day)
    if (date.getMonth() !== monthIndex) break
    if (date.getDay() === 5) {
      count++
      if (count === 3) {
        const yyyy = date.getFullYear()
        const mm = String(date.getMonth() + 1).padStart(2, '0')
        const dd = String(date.getDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}`
      }
    }
  }
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-15`
}

const MemoizedTickerCard = React.memo(({ item, prices, isFattibile, setPendingRoll, selected, setSelected, showDropdowns, setShowDropdowns, alertsEnabled, setAlertsEnabled, sentAlerts, chain, updateCurrentCall, handleRollaClick, shiftExpiryByMonth, getSymbolFromExpiryStrike, getThirdFriday, data, setData, setChain }: {
  item: OptionData,
  prices: Record<string, Record<string, { bid: number; ask: number; last_trade_price: number; symbol: string }>>,
  isFattibile: (opt: OptionEntry, item: OptionData) => boolean,
  setPendingRoll: React.Dispatch<React.SetStateAction<{ ticker: string, opt: OptionEntry } | null>>,
  selected: { [ticker: string]: { year: string, month: string, strike: number | null } },
  setSelected: React.Dispatch<React.SetStateAction<{ [ticker: string]: { year: string, month: string, strike: number | null } }>>,
  showDropdowns: { [ticker: string]: boolean },
  setShowDropdowns: React.Dispatch<React.SetStateAction<{ [ticker: string]: boolean }>>,
  alertsEnabled: { [ticker: string]: boolean },
  setAlertsEnabled: React.Dispatch<React.SetStateAction<{ [ticker: string]: boolean }>>,
  sentAlerts: React.MutableRefObject<{ [ticker: string]: { [level: number]: boolean } }>,
  chain: Record<string, Record<string, Record<string, number[]>>>,
  updateCurrentCall: (ticker: string) => Promise<void>,
  handleRollaClick: (ticker: string, opt: OptionEntry) => Promise<void>,
  shiftExpiryByMonth: (ticker: string, opt: OptionEntry, direction: 'next' | 'prev', type: 'future' | 'earlier') => OptionEntry | null,
  getSymbolFromExpiryStrike: (ticker: string, expiry: string, strike: number) => string,
  getThirdFriday: (year: number, monthIndex: number) => string,
  data: OptionData[],
  setData: React.Dispatch<React.SetStateAction<OptionData[]>>,
  setChain: React.Dispatch<React.SetStateAction<Record<string, Record<string, Record<string, number[]>>>>>
}) => {
  const deltaPct = ((item.strike - item.spot) / item.spot) * 100
  const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'
  const ticker = item.ticker
  const sel = selected[ticker] || { year: '', month: '', strike: null }
  const showDropdown = showDropdowns[ticker] || false
  const tickerChain = chain[ticker] || {}

  const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
  const tickerPrices = prices[item.ticker] || {}
  const ask = tickerPrices[currentSymbol]?.ask ?? 0
  const last_trade_price = tickerPrices[currentSymbol]?.last_trade_price ?? 0
  const priceToShow = ask > 0 ? ask : (last_trade_price > 0 ? last_trade_price : item.currentCallPrice)

  return (
    <div className="bg-zinc-900 border border-red-500 shadow-md rounded-lg p-3">
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-base font-bold text-red-500">{item.ticker}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAlertsEnabled(prev => {
                const next = { ...prev, [ticker]: !prev[ticker] }
                if (next[ticker]) {
                  const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
                  const newSent: { [level: number]: boolean } = {}
                  const levels = [4, 3, 2, 1]
                  for (const level of levels) {
                    if (delta >= level) newSent[level] = true
                  }
                  sentAlerts.current[ticker] = newSent
                  sendTelegramMessage(`🔔 ALERT ATTIVATI – Ticker: ${item.ticker}`)
                } else {
                  sentAlerts.current[ticker] = {}
                  sendTelegramMessage(`🔕 ALERT DISATTIVATI – Ticker: ${item.ticker}`)
                }
                return next
              })
            }}
            title={alertsEnabled[ticker] ? 'Disattiva alert' : 'Attiva alert'}
            className={`px-1 py-0.5 rounded text-sm ${alertsEnabled[ticker] ? 'bg-green-600 hover:bg-green-700' : 'bg-zinc-700 hover:bg-zinc-600'} text-white`}
          >
            {alertsEnabled[ticker] ? '🔔' : '🔕'}
          </button>
          <button
            onClick={() => setShowDropdowns(prev => ({ ...prev, [ticker]: !showDropdown }))}
            className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded"
          >
            🔄 UPDATE CURRENT CALL
          </button>

          <button
            onClick={async () => {
              console.log(`Manual reload chain for ${ticker}`);
              try {
                const res = await fetch(`/api/chain?ticker=${ticker}`);
                if (res.ok) {
                  const json = await res.json();
                  setChain(prev => ({ ...prev, [ticker]: json }));
                  console.log(`Reloaded for ${ticker}: years - ${Object.keys(json).join(', ')}`);
                } else {
                  console.error(`Reload error for ${ticker}: ${res.status}`);
                }
              } catch (err) {
                console.error(`Reload exception for ${ticker}:`, err);
              }
            }}
            className="bg-yellow-700 hover:bg-yellow-800 text-white text-xs font-medium px-2 py-1 rounded"
          >
            Ricarica Chain
          </button>
        </div>
      </div>
      {showDropdown && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          <select
            value={sel.year}
            onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
            className="bg-zinc-800 text-white p-1"
          >
            <option value="">Anno</option>
            {Object.keys(tickerChain).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {Object.keys(tickerChain).length === 0 && (
            <div className="col-span-3 text-red-500 text-xs mt-1">
              Nessuna scadenza disponibile. Verifica console per errori o se il ticker ha opzioni (es. usa 'AMZN' per Amazon). Prova a rimuovere e riaggiungere il ticker.
            </div>
          )}
          <select
            value={sel.month}
            onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
            className="bg-zinc-800 text-white p-1"
            disabled={!sel.year}
          >
            <option value="">Mese</option>
            {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={sel.strike ?? ''}
            onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
            className="bg-zinc-800 text-white p-1"
            disabled={!sel.month}
          >
            <option value="">Strike</option>
            {sel.year && sel.month && (tickerChain[sel.year]?.[sel.month] || []).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => updateCurrentCall(ticker)}
            className="col-span-3 mt-1 bg-green-700 hover:bg-green-800 text-white text-xs font-medium px-2 py-1 rounded"
          >
            ✔️ Conferma nuova CALL
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 mb-2">
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Spot</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{item.spot.toFixed(2)}</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Strike</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{item.strike.toFixed(2)}</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Scadenza</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{item.expiry}</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Δ% Strike/Spot</div>
        <div className={`p-1 transition-all duration-300 ${deltaColor} ${deltaPct < 4 ? 'font-bold animate-pulse text-red-400' : ''}`}>
          {deltaPct < 4 ? '⚠️ ' : ''}{deltaPct.toFixed(2)}% </div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Prezzo Call attuale</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{priceToShow.toFixed(2)}</div>
      </div>
      <div className="mb-1 font-semibold bg-gray-800 text-orange-500 text-center rounded py-0.5">Future</div>
      {item.future.map((opt, i) => {
        const optPriceData = tickerPrices[opt.symbol]
        const bid = tickerPrices[opt.symbol]?.bid ?? 0
        const last_trade_price_opt = tickerPrices[opt.symbol]?.last_trade_price ?? 0
        const optPrice = bid > 0 ? bid : last_trade_price_opt
        const delta = optPriceData ? ((optPrice - priceToShow) / item.spot) * 100 : 0
        const deltaColor_opt = delta >= 0 ? 'text-green-400' : 'text-red-400'
        const deltaSign = delta >= 0 ? '+' : ''

        return (
          <div key={i} className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1">
              {isFattibile(opt, item) && (
                <span className="text-green-400" title="Fattibile: strike ≥ spot + 4%, prezzo ≥ 90% del prezzo call attuale">🟢</span>
              )}
              <span title={opt.expiry}>
                {opt.label} - {optPrice.toFixed(2)} /
                {optPriceData && (
                  <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor_opt}`}>
                    {deltaSign}{delta.toFixed(2)}%
                  </span>
                )}
              </span>
            </span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setPendingRoll({ ticker: item.ticker, opt })}
                className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold px-2 py-0.5 rounded"
                title="Aggiorna la call attuale con questa opzione"
              >
                ROLLA
              </button>
              <button
                title="Strike Up"
                className="bg-green-700 hover:bg-green-800 text-white text-xs px-1 rounded"
                onClick={() => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const nextStrike = chainStrikes.find((s: number) => s > opt.strike)
                  if (!nextStrike) return

                  const updatedOpt = {
                    ...opt,
                    strike: nextStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                    symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].future[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                🔼
              </button>
              <button
                title="Strike Down"
                className="bg-red-700 hover:bg-red-800 text-white text-xs px-1 rounded"
                onClick={() => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const prevStrike = [...chainStrikes].reverse().find((s: number) => s < opt.strike)
                  if (!prevStrike) return

                  const updatedOpt = {
                    ...opt,
                    strike: prevStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                    symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].future[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                🔽
              </button>
              <button
                title="Month Back"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={() => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', 'earlier')
                  if (!shift) return

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].future[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                ◀️
              </button>
              <button
                title="Month Forward"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={() => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'next', 'future')
                  if (!shift) return

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].future[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                ▶️
              </button>
            </div>
          </div>
        )
      })}
      <div className="mb-1 font-semibold bg-gray-800 text-orange-500 text-center rounded py-0.5">Earlier</div>
      {item.earlier.map((opt, i) => {
        const optPriceData = tickerPrices[opt.symbol]
        const bid = tickerPrices[opt.symbol]?.bid ?? 0
        const last_trade_price_opt = tickerPrices[opt.symbol]?.last_trade_price ?? 0
        const optPrice = bid > 0 ? bid : last_trade_price_opt
        const delta = optPriceData ? ((optPrice - priceToShow) / item.spot) * 100 : 0
        const deltaColor_opt = delta >= 0 ? 'text-green-400' : 'text-red-400'
        const deltaSign = delta >= 0 ? '+' : ''

        return (
          <div key={i} className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1">
              {isFattibile(opt, item) && (
                <span className="text-green-400" title="Fattibile: strike ≥ spot + 4%, prezzo ≥ 90% del prezzo call attuale">🟢</span>
              )}
              <span title={opt.expiry}>
                {opt.label} - {optPrice.toFixed(2)} /
                {optPriceData && (
                  <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor_opt}`}>
                    {deltaSign}{delta.toFixed(2)}%
                  </span>
                )}
              </span>
            </span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setPendingRoll({ ticker: item.ticker, opt })}
                className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold px-2 py-0.5 rounded"
                title="Aggiorna la call attuale con questa opzione"
              >
                ROLLA
              </button>
              <button
                title="Strike Up"
                className="bg-green-700 hover:bg-green-800 text-white text-xs px-1 rounded"
                onClick={() => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const nextStrike = chainStrikes.find((s: number) => s > opt.strike)
                  if (!nextStrike) return

                  const updatedOpt = {
                    ...opt,
                    strike: nextStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                    symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].earlier[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                🔼
              </button>
              <button
                title="Strike Down"
                className="bg-red-700 hover:bg-red-800 text-white text-xs px-1 rounded"
                onClick={() => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const prevStrike = [...chainStrikes].reverse().find((s: number) => s < opt.strike)
                  if (!prevStrike) return

                  const updatedOpt = {
                    ...opt,
                    strike: prevStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                    symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].earlier[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                🔽
              </button>
              <button
                title="Month Back"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={() => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', 'earlier')
                  if (!shift) return

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].earlier[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                ◀️
              </button>
              <button
                title="Month Forward"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={() => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'next', 'future')
                  if (!shift) return

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  }

                  const updatedData = [...data]
                  const itemIdx = updatedData.findIndex(d => d.ticker === item.ticker)
                  updatedData[itemIdx].earlier[i] = updatedOpt
                  setData(updatedData)
                }}
              >
                ▶️
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
});

// FINE MEMORIZEDTICKER (BUG FLICKERING)

export default function Page(): JSX.Element {
  const [tickers, setTickers] = useState<string[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, Record<string, number[]>>>>({})
  const [prices, setPrices] = useState<Record<string, Record<string, { bid: number; ask: number; last_trade_price: number; symbol: string }>>>({})
  const [selected, setSelected] = useState<{ [ticker: string]: { year: string, month: string, strike: number | null } }>({})
  const [showDropdowns, setShowDropdowns] = useState<{ [ticker: string]: boolean }>({})
  const sentAlerts = useRef<{ [ticker: string]: { [level: number]: boolean } }>({})
  const [alertsEnabled, setAlertsEnabled] = useState<{ [ticker: string]: boolean }>({})
  const [pendingRoll, setPendingRoll] = useState<{ ticker: string, opt: OptionEntry } | null>(null)

  const fetchTickers = async () => {
    try {
      const res = await fetch('/api/tickers')
      const json = await res.json()
      setTickers(json)
    } catch (err) {
      console.error('Errore fetch tickers', err)
    }
  };

  const fetchData = async () => {
    try {
      const res = await fetch('/api/options')
      const json = await res.json()
      if (Array.isArray(json)) setData(json)
    } catch (err) {
      console.error('Errore fetch /api/options', err)
    }
  }

  const fetchChain = async () => {
    try {
      const chains: Record<string, Record<string, Record<string, number[]>>> = {}
      console.log('Starting fetchChain - current tickers:', tickers); // Debug iniziale
      for (const t of tickers) {
        console.log(`Fetching chain for ${t}`);
        try {
          const res = await fetch(`/api/chain?ticker=${t}`);
          if (!res.ok) {
            console.error(`Error fetching chain for ${t}: status ${res.status} - ${await res.text()}`);
            chains[t] = {}; // Fallback empty to show UI message
            continue;
          }
          const json = await res.json();
          chains[t] = json;
          console.log(`Chain loaded for ${t}: years available - ${Object.keys(json).join(', ') || 'NONE'}`);
          if (Object.keys(json).length === 0) {
            console.warn(`No chain data for ${t} - verify ticker has OPRA options on Polygon`);
          }
        } catch (err) {
          console.error(`Exception during chain fetch for ${t}:`, err);
          chains[t] = {};
        }
      }
      setChain(chains);
      console.log('fetchChain completed - full chain state:', chains); // Debug finale
    } catch (err) {
      console.error('Global error in fetchChain:', err);
    }
  };

  useEffect(() => {
    if (tickers.length > 0) {
      fetchChain();
    }
  }, [tickers]); // Ri-chiama fetchChain ogni volta che tickers cambia (load/add/remove)

  const fetchPrices = async () => {
    try {
      let symbols: string[] = [];
      data.forEach(item => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
        if (currentSymbol) symbols.push(currentSymbol); // Skip if empty
        item.earlier.forEach(opt => {
          if (opt.symbol) symbols.push(opt.symbol);
        });
        item.future.forEach(opt => {
          if (opt.symbol) symbols.push(opt.symbol);
        });
      });

      // Filter unique and non-empty
      symbols = [...new Set(symbols.filter(s => s && typeof s === 'string' && s.trim() !== ''))];

      if (!symbols.length) {
        console.warn('⚠️ No valid symbols found for prices fetch!');
        return;
      }

      console.log('🎯 Valid symbols requested:', symbols); // Debug for Vercel/console

      const url = `/api/full-prices?symbols=${encodeURIComponent(symbols.join(','))}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Error fetching prices: ${res.status} - ${await res.text()}`);
        return;
      }
      const json = await res.json();
      console.log('📥 Prices response:', json);

      const grouped: Record<string, Record<string, { bid: number; ask: number; last_trade_price: number; symbol: string }>> = {};
      for (const [symbol, val] of Object.entries(json)) {
        const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
        if (!match) continue;
        const ticker = match[1];
        if (!grouped[ticker]) grouped[ticker] = {};
        grouped[ticker][symbol] = {
          bid: (val as any)?.bid ?? 0,
          ask: (val as any)?.ask ?? 0,
          last_trade_price: (val as any)?.last_trade_price ?? 0,
          symbol
        };
      }

      setPrices(grouped);
      console.log('✅ Prices updated:', grouped);
    } catch (err) {
      console.error('Errore fetch /api/full-prices:', err);
    }
  };

  function shiftExpiryByMonth(
    ticker: string,
    opt: OptionEntry,
    direction: 'next' | 'prev',
    type: 'future' | 'earlier'
  ): OptionEntry | null {
    const tickerChain = chain[ticker] || {}
    const [yearStr, monthStr] = opt.expiry.split('-')
    let year = Number(yearStr)
    let monthIdx = Number(monthStr) - 1
    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    let attempts = 0
    const maxAttempts = 60

    while (attempts < maxAttempts) {
      attempts++
      if (direction === 'next') {
        monthIdx++
        if (monthIdx > 11) {
          monthIdx = 0
          year++
        }
      } else {
        monthIdx--
        if (monthIdx < 0) {
          monthIdx = 11
          year--
        }
      }

      const monthName = monthNames[monthIdx]
      const yearKey = year.toString()
      if (!tickerChain[yearKey] || !tickerChain[yearKey][monthName]) continue

      const strikes = tickerChain[yearKey][monthName]
      if (strikes.length === 0) continue

      const strike = opt.strike
      let targetStrike: number | undefined

      if (type === 'future') {
        // Preferisci > strike, poi esatto, poi max disponibile
        targetStrike = strikes.find((s: number) => s > strike) ||
          strikes.find((s: number) => s === strike) ||
          strikes[strikes.length - 1]
      } else {
        // Preferisci < strike (dal max descending), poi esatto, poi min disponibile
        targetStrike = [...strikes].reverse().find((s: number) => s < strike) ||
          strikes.find((s: number) => s === strike) ||
          strikes[0]
      }

      // Se dopo fallback non c'è (impossibile se strikes>0), continua
      if (!targetStrike) continue

      const expiry = getThirdFriday(year, monthIdx)
      const symbol = getSymbolFromExpiryStrike(ticker, expiry, targetStrike)
      const price = prices[ticker]?.[symbol]?.bid ?? 0

      return {
        label: `${monthName} ${String(year).slice(2)} C${targetStrike}`,
        symbol,
        expiry,
        strike: targetStrike,
        price,
      }
    }

    // Alert solo se davvero nessuna scadenza con strikes trovata
    alert(`Nessuna scadenza ${direction === 'next' ? 'successiva' : 'precedente'} disponibile per ${ticker}.`);
    return null
  }

  const updateCurrentCall = async (ticker: string) => {
    const sel = selected[ticker] || { year: '', month: '', strike: null }
    if (!sel.year || !sel.month || !sel.strike) return

    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const monthIndex = monthNames.indexOf(sel.month)
    if (monthIndex === -1) return

    const expiryDate = getThirdFriday(Number(sel.year), monthIndex)

    const updatedData = data.map(item => {
      if (item.ticker !== ticker) return item

      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, expiryDate, sel.strike!)
      const currentCallPrice = prices[item.ticker]?.[currentSymbol]?.ask ?? 0
      let future: OptionEntry[] = []
      let earlier: OptionEntry[] = []

      const tickerChain = chain[item.ticker] || {}

      // Future: Collect up to 2 future months
      let monthIdx = monthIndex
      let year = Number(sel.year)
      const allFutureMonths: { monthIdx: number, year: number }[] = []
      let attempts = 0
      const maxAttempts = 60 // Limite per sicurezza
      while (allFutureMonths.length < 2 && attempts < maxAttempts) {
        attempts++
        monthIdx++
        if (monthIdx >= 12) {
          monthIdx = 0
          year++
        }
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || []
        if (fStrikeList.length > 0) {
          allFutureMonths.push({ monthIdx, year });
        }
      }
      for (let i = 0; i < Math.min(2, allFutureMonths.length); i++) {
        const { monthIdx, year } = allFutureMonths[i]
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || []
        let fStrike = fStrikeList.find((s: number) => s > sel.strike!)
        if (!fStrike && fStrikeList.length > 0) {
          fStrike = fStrikeList[fStrikeList.length - 1]; // Fallback all'ultima disponibile
        }
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          if (symbol && symbol.trim() !== '') {
            const price = prices[item.ticker]?.[symbol]?.bid ?? 0
            future.push({
              label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
              symbol,
              strike: fStrike,
              price,
              expiry
            })
          } else {
            console.warn(`Invalid symbol generated for future of ${ticker}: ${symbol}`);
          }
        }
      }

      // Earlier: Collect up to 2 earlier months
      monthIdx = monthIndex
      year = Number(sel.year)
      const allEarlierMonths: { monthIdx: number, year: number }[] = []
      attempts = 0 // Reset attempts
      while (allEarlierMonths.length < 2 && attempts < maxAttempts) {
        attempts++
        monthIdx--
        if (monthIdx < 0) {
          monthIdx = 11
          year--
        }
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        if (eStrikeList.length > 0) {
          allEarlierMonths.push({ monthIdx, year });
        }
      }
      allEarlierMonths.reverse(); // Da più recente a vecchia per prendere le 2 più vicine
      for (let i = 0; i < Math.min(2, allEarlierMonths.length); i++) {
        const { monthIdx, year } = allEarlierMonths[i]
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        let eStrike = [...eStrikeList].reverse().find((s: number) => s < sel.strike!)
        if (!eStrike && eStrikeList.length > 0) {
          eStrike = eStrikeList[0]; // Fallback alla prima disponibile
        }
        if (eStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike)
          if (symbol && symbol.trim() !== '') {
            const price = prices[item.ticker]?.[symbol]?.bid ?? 0
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`,
              symbol,
              strike: eStrike,
              price,
              expiry
            })
          } else {
            console.warn(`Invalid symbol generated for earlier of ${ticker}: ${symbol}`);
          }
        }
      }

      // Fallback if incomplete (per chain limitata)
      if (future.length < 2 || earlier.length < 2) {
        console.warn(`Incomplete future/earlier for ${ticker} after update - added ${future.length} future, ${earlier.length} earlier`);
        alert(`Update parziale per ${ticker}: Chain limitata su Polygon (solo ${future.length} future e ${earlier.length} earlier trovate). Prova altro expiry/strike.`);
        while (future.length < 2) future.push({ label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' });
        while (earlier.length < 2) earlier.push({ label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' });
      }

      return {
        ...item,
        strike: sel.strike!,
        expiry: expiryDate,
        currentCallPrice,
        future,
        earlier,
        invalid: false
      }
    })

    setData(updatedData)
    setSelected(prev => ({ ...prev, [ticker]: { year: '', month: '', strike: null } }))
    setShowDropdowns(prev => ({ ...prev, [ticker]: false }))

    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, sel.strike!)
    const currentCallPrice = prices[ticker]?.[currentSymbol]?.ask ?? 0

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        strike: sel.strike,
        expiry: expiryDate,
        currentCallPrice,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase per', ticker)
    }
  }

  const handleRollaClick = async (ticker: string, opt: OptionEntry) => {
    const [yearStr, monthStr] = opt.expiry.split('-')
    const selectedYear = yearStr
    const selectedMonthIndex = Number(monthStr) - 1
    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const selectedMonth = monthNames[selectedMonthIndex]
    const selectedStrike = opt.strike
    const expiryDate = getThirdFriday(Number(selectedYear), selectedMonthIndex)

    const updatedData = data.map(item => {
      if (item.ticker !== ticker) return item

      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, expiryDate, selectedStrike)
      const currentCallPrice = prices[item.ticker]?.[currentSymbol]?.ask ?? 0
      let future: OptionEntry[] = []
      let earlier: OptionEntry[] = []

      const tickerChain = chain[item.ticker] || {}

      // Future: Collect up to 2 future months
      let monthIdx = selectedMonthIndex
      let year = Number(selectedYear)
      const allFutureMonths: { monthIdx: number, year: number }[] = []
      let attempts = 0
      const maxAttempts = 60
      while (allFutureMonths.length < 2 && attempts < maxAttempts) {
        attempts++
        monthIdx++
        if (monthIdx >= 12) {
          year++
          monthIdx = 0
        }
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || []
        if (fStrikeList.length > 0) {
          allFutureMonths.push({ monthIdx, year });
        }
      }
      for (let i = 0; i < Math.min(2, allFutureMonths.length); i++) {
        const { monthIdx, year } = allFutureMonths[i]
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || []
        let fStrike = fStrikeList.find((s: number) => s > selectedStrike)
        if (!fStrike && fStrikeList.length > 0) {
          fStrike = fStrikeList[fStrikeList.length - 1];
        }
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          if (symbol && symbol.trim() !== '') {
            const price = prices[item.ticker]?.[symbol]?.bid ?? 0
            future.push({
              label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
              symbol,
              strike: fStrike,
              price,
              expiry
            })
          } else {
            console.warn(`Invalid symbol generated for future of ${ticker}: ${symbol}`);
          }
        }
      }

      // Earlier: Collect up to 2 earlier months
      monthIdx = selectedMonthIndex
      year = Number(selectedYear)
      const allEarlierMonths: { monthIdx: number, year: number }[] = []
      attempts = 0 // Reset
      while (allEarlierMonths.length < 2 && attempts < maxAttempts) {
        attempts++
        monthIdx--
        if (monthIdx < 0) {
          year--
          monthIdx = 11
        }
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        if (eStrikeList.length > 0) {
          allEarlierMonths.push({ monthIdx, year });
        }
      }
      allEarlierMonths.reverse();
      for (let i = 0; i < Math.min(2, allEarlierMonths.length); i++) {
        const { monthIdx, year } = allEarlierMonths[i]
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        let eStrike = [...eStrikeList].reverse().find((s: number) => s < selectedStrike)
        if (!eStrike && eStrikeList.length > 0) {
          eStrike = eStrikeList[0];
        }
        if (eStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike)
          if (symbol && symbol.trim() !== '') {
            const price = prices[item.ticker]?.[symbol]?.bid ?? 0
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`,
              symbol,
              strike: eStrike,
              price,
              expiry
            })
          } else {
            console.warn(`Invalid symbol generated for earlier of ${ticker}: ${symbol}`);
          }
        }
      }

      // Fallback if incomplete
      if (future.length < 2 || earlier.length < 2) {
        console.warn(`Incomplete future/earlier for ${ticker} after roll - added ${future.length} future, ${earlier.length} earlier`);
        alert(`Roll parziale per ${ticker}: Chain limitata su Polygon (solo ${future.length} future e ${earlier.length} earlier trovate). Prova altro option.`);
        while (future.length < 2) future.push({ label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' });
        while (earlier.length < 2) earlier.push({ label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' });
      }

      return {
        ...item,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice,
        future,
        earlier,
        invalid: false
      }
    })

    setData(updatedData)

    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, selectedStrike)
    const currentCallPrice = prices[ticker]?.[currentSymbol]?.ask ?? 0

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase per', ticker)
    }
  }

  useEffect(() => {
    fetchTickers()
    fetchData()
  }, []);

  const addTicker = async () => {
    if (!newTicker) return;
    try {
      const res = await fetch('/api/add-ticker', { method: 'POST', body: JSON.stringify({ ticker: newTicker }) });
      if (res.ok) {
        console.log(`Added ${newTicker} - refreshing tickers/data`);
        await fetchTickers(); // Aggiorna tickers → triggera useEffect per chain
        await fetchData(); // Data dopo chain
        setNewTicker('');
      }
    } catch (err) {
      console.error('Errore add ticker', err);
    }
  };

  const removeTicker = async (ticker: string) => {
    try {
      const res = await fetch('/api/remove-ticker', { method: 'POST', body: JSON.stringify({ ticker }) });
      if (res.ok) {
        console.log(`Removed ${ticker} - refreshing tickers/data`);
        await fetchTickers(); // Triggera useEffect per chain
        await fetchData();
        // Pulizia stati...
      }
    } catch (err) {
      console.error('Errore remove ticker', err);
    }
  };

  useEffect(() => {
    if (data.length > 0) {
      fetchPrices()
    }
  }, [data]);

  useEffect(() => {
    if (data.length === 0) return
    const interval = setInterval(() => {
      fetchPrices()
    }, 1000)
    return () => clearInterval(interval)
  }, [data]);

  useEffect(() => {
    data.forEach(item => {
      if (!alertsEnabled[item.ticker]) return
      const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
      const levels = [4, 3, 2, 1]
      if (!sentAlerts.current[item.ticker]) sentAlerts.current[item.ticker] = {}
      for (const level of levels) {
        if (delta < level && !sentAlerts.current[item.ticker][level]) {
          sentAlerts.current[item.ticker][level] = true
          const alertMessage = `⚠️ ALERT ${level}% – ${item.ticker}\nStrike: ${item.strike}\nSpot: ${item.spot}\nDelta: ${delta.toFixed(2)}%`
          sendTelegramMessage(alertMessage);
        }
      }
    })
  }, [data, alertsEnabled])

  const isFattibile = (opt: OptionEntry, item: OptionData) => {
    const tickerPrices = prices[item.ticker] || {}
    const optPriceData = tickerPrices[opt.symbol]
    if (!optPriceData) return false
    const optPrice = optPriceData.bid
    return (
      item.spot < opt.strike &&
      opt.strike >= item.spot * 1.04 &&
      optPrice >= item.currentCallPrice * 0.9
    )
  }

  return (
    <>
      {pendingRoll && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 text-white rounded-lg p-4 shadow-xl w-full max-w-xs">
            <div className="text-lg font-semibold mb-3 text-center">⚠️ Sei sicuro di voler rollare?</div>
            <div className="text-sm text-center mb-4 text-zinc-400">{pendingRoll.opt.label} - {pendingRoll.opt.expiry}</div>
            <div className="flex justify-between gap-3">
              <button
                onClick={() => setPendingRoll(null)}
                className="flex-1 bg-red-700 hover:bg-red-800 text-white py-1 rounded"
              >
                ❌ No
              </button>
              <button
                onClick={async () => {
                  await handleRollaClick(pendingRoll.ticker, pendingRoll.opt)
                  setPendingRoll(null)
                }}
                className="flex-1 bg-green-700 hover:bg-green-800 text-white py-1 rounded"
              >
                ✅ Sì
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-black text-white p-2 flex flex-col gap-4 text-sm leading-tight">
        <div className="p-2 bg-zinc-900 rounded mb-2">
          <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())} placeholder="Aggiungi ticker (es. AAPL)" className="bg-zinc-800 text-white p-1" />
          <button onClick={addTicker} className="bg-green-700 text-white px-2 py-1 rounded ml-2">Aggiungi</button>
          <div className="mt-2">
            Tickers attuali: {tickers.map(t => <span key={t} className="mr-2">{t} <button onClick={() => removeTicker(t)} className="text-red-500">X</button></span>)}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((item: OptionData, index: number) => {
            if (item.invalid) {
              const ticker = item.ticker
              const sel = selected[ticker] || { year: '', month: '', strike: null }
              const showDropdown = showDropdowns[ticker] || false
              const tickerChain = chain[ticker] || {}
              return (
                <div key={index} className="bg-red-800 text-white rounded-lg p-4 shadow-md flex flex-col gap-2">
                  <div className="font-bold text-lg">⚠️ Errore caricamento CALL per {ticker}</div>
                  <div>La call corrente salvata su Supabase non è più disponibile o ha dati errati.</div>
                  <button
                    onClick={() => setShowDropdowns(prev => ({ ...prev, [ticker]: true }))}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-1 px-2 rounded w-fit"
                  >
                    📂 Seleziona nuova call
                  </button>
                  {showDropdown && (
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={sel.year}
                        onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
                        className="bg-zinc-800 text-white p-1"
                      >
                        <option value="">Anno</option>
                        {Object.keys(tickerChain).map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      {Object.keys(tickerChain).length === 0 && (
                        <div className="col-span-3 text-red-500 text-xs mt-1">
                          Nessuna scadenza disponibile. Verifica console per errori o se il ticker ha opzioni (es. usa 'AMZN' per Amazon). Prova a rimuovere e riaggiungere il ticker.
                        </div>
                      )}
                      <select
                        value={sel.month}
                        onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
                        className="bg-zinc-800 text-white p-1"
                        disabled={!sel.year}
                      >
                        <option value="">Mese</option>
                        {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={sel.strike ?? ''}
                        onChange={e => setSelected(prev => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
                        className="bg-zinc-800 text-white p-1"
                        disabled={!sel.month}
                      >
                        <option value="">Strike</option>
                        {sel.year && sel.month && (tickerChain[sel.year]?.[sel.month] || []).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => updateCurrentCall(ticker)}
                        className="col-span-3 mt-1 bg-green-700 hover:bg-green-800 text-white text-xs font-medium px-2 py-1 rounded"
                      >
                        ✔️ Conferma nuova CALL
                      </button>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <MemoizedTickerCard
                key={index}
                item={item}
                prices={prices}
                isFattibile={isFattibile}
                setPendingRoll={setPendingRoll}
                selected={selected}
                setSelected={setSelected}
                showDropdowns={showDropdowns}
                setShowDropdowns={setShowDropdowns}
                alertsEnabled={alertsEnabled}
                setAlertsEnabled={setAlertsEnabled}
                sentAlerts={sentAlerts}
                chain={chain}
                updateCurrentCall={updateCurrentCall}
                handleRollaClick={handleRollaClick}
                shiftExpiryByMonth={shiftExpiryByMonth}
                getSymbolFromExpiryStrike={getSymbolFromExpiryStrike}
                getThirdFriday={getThirdFriday}
                data={data}
                setData={setData}
                setChain={setChain}
              />
            )
          })}
        </div>      </div>
    </>
  )
}