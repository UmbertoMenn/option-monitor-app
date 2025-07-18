'use client'

import React, { useEffect, useState, useRef, useCallback, Fragment } from 'react'
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
  bid: number
  ask: number
  last_trade_price: number
  strike: number
  expiry: string
  symbol: string
}

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  current_bid: number
  current_ask: number
  current_last_trade_price: number
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

type PricesType = Record<string, Record<string, { bid: number; ask: number; last_trade_price: number; symbol: string }>>;

const MemoizedTickerCard = React.memo(({ item, prices, setPrices, isFattibile, setPendingRoll, selected, setSelected, showDropdowns, setShowDropdowns, alertsEnabled, setAlertsEnabled, sentAlerts, chain, updateCurrentCall, handleRollaClick, shiftExpiryByMonth, getSymbolFromExpiryStrike, getThirdFriday, data, setData, setChain, spots }: {
  item: OptionData,
  prices: PricesType,
  setPrices: React.Dispatch<React.SetStateAction<PricesType>>,
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
  setChain: React.Dispatch<React.SetStateAction<Record<string, Record<string, Record<string, number[]>>>>>,
  spots: Record<string, { price: number; changePercent: number }>
}) => {
  const deltaPct = item.spot > 0 ? ((item.strike - item.spot) / item.spot) * 100 : 0;
  const deltaColor = deltaPct < 4 ? 'font-bold text-red-400' : 'font-bold text-green-400';
  let highlightClass = '';
  let icon = '';

  // Calcola se esiste almeno una earlier fattibile
  const hasFattibileEarlier = item.earlier.some(opt => isFattibile(opt, item));

  if (deltaPct < 4) {
    highlightClass = 'font-bold animate-pulse text-red-400';
    icon = '⚠️ ';
  } else if (hasFattibileEarlier) {
    highlightClass = 'font-bold animate-pulse text-green-400';
    icon = '⚠️ ';
  }

  const ticker = item.ticker
  const sel = selected[ticker] || { year: '', month: '', strike: null }
  const showDropdown = showDropdowns[ticker] || false
  const tickerChain = chain[ticker] || {}

  const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
  const tickerPrices = prices[item.ticker] || {}
  const currentData = tickerPrices[currentSymbol] ?? { bid: item.current_bid ?? 0, ask: item.current_ask ?? 0, last_trade_price: item.current_last_trade_price ?? 0 }
  const currentBidToShow = currentData.bid ?? 0
  const currentAskToShow = (currentData.ask ?? 0) > 0 ? (currentData.ask ?? 0) : (currentData.last_trade_price ?? 0)
  console.log(`[${item.ticker}] Current Symbol: ${currentSymbol}, Bid: ${currentBidToShow}, Ask: ${currentAskToShow}, Last: ${currentData.last_trade_price ?? 0}`);
  const spotData = spots[ticker] || { price: 0, changePercent: 0 };
  const changePercent = spotData.changePercent;
  const changeColor = changePercent >= 0 ? 'text-green-300' : 'text-red-300';
  const changeSign = changePercent >= 0 ? '+' : '';

  return (
    <div className="bg-zinc-900 border border-red-500 shadow-md rounded-lg p-3">
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-base font-bold text-red-400">{item.ticker}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAlertsEnabled((prev: { [ticker: string]: boolean }) => {
                const next = { ...prev, [ticker]: !prev[ticker] };
                fetch('/api/alerts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ticker, enabled: next[ticker] }),
                }).catch(err => console.error('Errore update alert:', err));
                if (next[ticker]) {
                  const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
                  const newSent: { [level: number]: boolean } = {}
                  const levels = [4, 3, 2, 1]
                  for (const level of levels) {
                    if (delta >= level) newSent[level] = true
                  }
                  const highLevels = [7, 8, 9, 10]
                  for (const level of highLevels) {
                    if (delta <= level) newSent[level] = true
                  }
                  sentAlerts.current[ticker] = newSent
                  //sendTelegramMessage(`🔔 ALERT ATTIVATI – Ticker: ${item.ticker}`)
                } else {
                  sentAlerts.current[ticker] = {}
                  //sendTelegramMessage(`🔕 ALERT DISATTIVATI – Ticker: ${item.ticker}`)
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
            onClick={() => setShowDropdowns((prev: { [ticker: string]: boolean }) => ({ ...prev, [ticker]: !showDropdown }))}
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
                  setChain((prev: Record<string, Record<string, Record<string, number[]>>>) => ({ ...prev, [ticker]: json }));
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
            onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
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
            onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
            className="bg-zinc-800 text-white p-1"
            disabled={!sel.year}
          >
            <option value="">Mese</option>
            {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={sel.strike ?? ''}
            onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
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
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">
          {item.spot.toFixed(2)}
          <span className={`ml-2 ${changeColor}`}>
            ({changeSign}{changePercent.toFixed(2)}%)
          </span>
        </div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Strike</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{item.strike.toFixed(2)}</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Scadenza</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300">{item.expiry}</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Δ% Strike/Spot</div>
        <div className={`p-1 transition-all duration-300 ${deltaColor} ${highlightClass}`}>
          {icon}{deltaPct.toFixed(2)}%
        </div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] font-bold">Prezzo Call attuale</div>
        <div className="p-1 bg-[rgba(70,120,240,0.8)] transition-all duration-300 border border-zinc-800 rounded">
          {(currentBidToShow ?? 0).toFixed(2)} / {(currentAskToShow ?? 0).toFixed(2)}
        </div>
      </div>
      <div className="mb-1 font-semibold bg-gray-800 text-orange-500 text-center rounded py-0.5">Future</div>
      {item.future.map((opt, i) => {
        const optPriceData = tickerPrices[opt.symbol]
        const optBid = (optPriceData?.bid ?? opt.bid ?? 0) > 0 ? (optPriceData?.bid ?? opt.bid ?? 0) : (optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0)
        const optAsk = optPriceData?.ask ?? opt.ask ?? 0
        const delta = item.spot > 0 ? ((optBid - currentAskToShow) / item.spot) * 100 : 0;
        const deltaColor_opt = delta >= 0 ? 'text-green-400' : 'text-red-400'
        const deltaSign = delta >= 0 ? '+' : ''

        return (
          <div key={i} className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1">
              <span title={opt.expiry}>
                <span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{opt.label}</span><span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{optBid.toFixed(2)} / {optAsk.toFixed(2)}</span>
                {optPriceData && (
                  <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor_opt}`}>
                    {deltaSign}{delta.toFixed(2)}%
                  </span>
                )}
                {isFattibile(opt, item) && (
                  <span className={isFattibile(opt, item) ? "text-green-400" : "text-transparent"} title={isFattibile(opt, item) ? "Fattibile: strike ≥ spot + 4%, prezzo ≥ prezzo call attuale" : ""}>🟢</span>)}
              </span>
            </span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setPendingRoll({ ticker: item.ticker, opt })}
                className="bg-[rgba(70,120,240,0.8)] hover:bg-[rgba(70,120,240,1)] text-white text-xs font-bold px-2 py-0.5 rounded"
                title="Aggiorna la call attuale con questa opzione"
              >
                ROLLA
              </button>
              <button
                title="Strike Up"
                className="bg-green-700 hover:bg-green-800 text-white text-xs px-1 rounded"
                onClick={async () => { // Rendi async
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const nextStrike = chainStrikes.find((s: number) => s > opt.strike)
                  if (!nextStrike) return

                  // Pre-fetch prezzo per nuovo simbolo
                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    strike: nextStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newFuture = [...d.future];
                    newFuture[i] = updatedOpt;
                    return { ...d, future: newFuture };
                  });
                  setData(updatedData)

                  fetch('/api/save-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ticker: item.ticker,
                      future: updatedData.find(d => d.ticker === item.ticker)?.future || [],
                      earlier: updatedData.find(d => d.ticker === item.ticker)?.earlier || []
                    })
                  }).catch(err => console.error('Errore salvataggio stato:', err));
                }}
              >
                🔼
              </button>
              <button
                title="Strike Down"
                className="bg-red-700 hover:bg-red-800 text-white text-xs px-1 rounded"
                onClick={async () => { // Rendi async
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const prevStrike = [...chainStrikes].reverse().find((s: number) => s < opt.strike)
                  if (!prevStrike) return

                  // Pre-fetch
                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    strike: prevStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newFuture = [...d.future];
                    newFuture[i] = updatedOpt;
                    return { ...d, future: newFuture };
                  });
                  setData(updatedData)

                  fetch('/api/save-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ticker: item.ticker,
                      future: updatedData.find(d => d.ticker === item.ticker)?.future || [],
                      earlier: updatedData.find(d => d.ticker === item.ticker)?.earlier || []
                    })
                  }).catch(err => console.error('Errore salvataggio stato:', err));
                }}
              >
                🔽
              </button>
              <button
                title="Month Back"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={async () => { // Rendi async
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', 'earlier')
                  if (!shift) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newFuture = [...d.future];
                    newFuture[i] = updatedOpt;
                    return { ...d, future: newFuture };
                  });
                  setData(updatedData)

                  fetch('/api/save-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ticker: item.ticker,
                      future: updatedData.find(d => d.ticker === item.ticker)?.future || [],
                      earlier: updatedData.find(d => d.ticker === item.ticker)?.earlier || []
                    })
                  }).catch(err => console.error('Errore salvataggio stato:', err));
                }}
              >
                ◀️
              </button>
              <button
                title="Month Forward"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={async () => { // Rendi async
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'next', 'future')
                  if (!shift) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newFuture = [...d.future];
                    newFuture[i] = updatedOpt;
                    return { ...d, future: newFuture };
                  });
                  setData(updatedData)

                  fetch('/api/save-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ticker: item.ticker,
                      future: updatedData.find(d => d.ticker === item.ticker)?.future || [],
                      earlier: updatedData.find(d => d.ticker === item.ticker)?.earlier || []
                    })
                  }).catch(err => console.error('Errore salvataggio stato:', err));
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
        const optBid = (optPriceData?.bid ?? opt.bid ?? 0) > 0 ? (optPriceData?.bid ?? opt.bid ?? 0) : (optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0)
        const optAsk = optPriceData?.ask ?? opt.ask ?? 0
        const delta = item.spot > 0 ? ((optBid - currentAskToShow) / item.spot) * 100 : 0;
        const deltaColor_opt = delta >= 0 ? 'text-green-400' : 'text-red-400'
        const deltaSign = delta >= 0 ? '+' : ''

        return (
          <div key={i} className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1">
              <span title={opt.expiry}>
                <span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{opt.label}</span><span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{optBid.toFixed(2)} / {optAsk.toFixed(2)}</span>
                {optPriceData && (
                  <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor_opt}`}>
                    {deltaSign}{delta.toFixed(2)}%
                  </span>
                )}
                {isFattibile(opt, item) && (
                  <span className={isFattibile(opt, item) ? "text-green-400" : "text-transparent"} title={isFattibile(opt, item) ? "Fattibile: strike ≥ spot + 4%, prezzo ≥ prezzo call attuale" : ""}>🟢</span>)}
              </span>
            </span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setPendingRoll({ ticker: item.ticker, opt })}
                className="bg-[rgba(70,120,240,0.8)] hover:bg-[rgba(70,120,240,1)] text-white text-xs font-bold px-2 py-0.5 rounded"
                title="Aggiorna la call attuale con questa opzione"
              >
                ROLLA
              </button>
              <button
                title="Strike Up"
                className="bg-green-700 hover:bg-green-800 text-white text-xs px-1 rounded"
                onClick={async () => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const nextStrike = chainStrikes.find((s: number) => s > opt.strike)
                  if (!nextStrike) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    strike: nextStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newEarlier = [...d.earlier];
                    newEarlier[i] = updatedOpt;
                    return { ...d, earlier: newEarlier };
                  });
                  setData(updatedData)
                }}
              >
                🔼
              </button>
              <button
                title="Strike Down"
                className="bg-red-700 hover:bg-red-800 text-white text-xs px-1 rounded"
                onClick={async () => {
                  const [year, month] = opt.expiry.split('-')
                  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
                  const monthIndex = Number(month) - 1
                  const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || []
                  const prevStrike = [...chainStrikes].reverse().find((s: number) => s < opt.strike)
                  if (!prevStrike) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    strike: prevStrike,
                    label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newEarlier = [...d.earlier];
                    newEarlier[i] = updatedOpt;
                    return { ...d, earlier: newEarlier };
                  });
                  setData(updatedData)
                }}
              >
                🔽
              </button>
              <button
                title="Month Back"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={async () => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', 'earlier')
                  if (!shift) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newEarlier = [...d.earlier];
                    newEarlier[i] = updatedOpt;
                    return { ...d, earlier: newEarlier };
                  });
                  setData(updatedData)
                }}
              >
                ◀️
              </button>
              <button
                title="Month Forward"
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                onClick={async () => {
                  const shift = shiftExpiryByMonth(item.ticker, opt, 'next', 'future')
                  if (!shift) return

                  const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                  const res = await fetch(`/api/full-prices?symbols=${newSymbol}`)
                  let newData = { bid: 0, ask: 0, last_trade_price: 0 }
                  if (res.ok) {
                    const json = await res.json()
                    newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 }
                    setPrices((prev: PricesType) => ({
                      ...prev,
                      [item.ticker]: { ...prev[item.ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
                    }))
                  }

                  const updatedOpt = {
                    ...opt,
                    ...shift,
                    symbol: newSymbol,
                    bid: newData.bid,
                    ask: newData.ask,
                    last_trade_price: newData.last_trade_price
                  }

                  const updatedData = data.map((d, idx) => {
                    if (d.ticker !== item.ticker) return d;
                    const newEarlier = [...d.earlier];
                    newEarlier[i] = updatedOpt;
                    return { ...d, earlier: newEarlier };
                  });
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
  const [prices, setPrices] = useState<PricesType>({})
  const [spots, setSpots] = useState<Record<string, { price: number; changePercent: number }>>({});
  const [selected, setSelected] = useState<{ [ticker: string]: { year: string, month: string, strike: number | null } }>({})
  const [showDropdowns, setShowDropdowns] = useState<{ [ticker: string]: boolean }>({})
  const sentAlerts = useRef<{ [ticker: string]: { [level: string]: boolean } }>({});
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

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const json = await res.json();
        setAlertsEnabled(json);
      }
    } catch (err) {
      console.error('Errore fetch alerts:', err);
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
        if (!item) return; // Safeguard per item undefined
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

      const grouped: PricesType = {};
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

      console.log('Updated prices for current calls:', Object.keys(grouped).map(t => {
        const currentItem = data.find(d => d.ticker === t);
        if (!currentItem) return `${t}: N/A`;
        const symbol = getSymbolFromExpiryStrike(t, currentItem.expiry, currentItem.strike);
        return `${t}: ${grouped[t]?.[symbol]?.last_trade_price ?? 0}`;
      }).join(', '));

      const tickersStr = data.map(item => item.ticker).join(',');
      const spotRes = await fetch(`/api/spots?tickers=${tickersStr}`);
      if (spotRes.ok) {
        const newSpots = await spotRes.json();
        setSpots(newSpots);
      } console.log('✅ Prices updated:', grouped);
    } catch (err) {
      console.error('Errore fetch /api/full-prices:', err);
    }
  };

  const shiftExpiryByMonth = useCallback((ticker: string, opt: OptionEntry, direction: 'next' | 'prev', type: 'future' | 'earlier'): OptionEntry | null => {
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
        targetStrike = strikes.find((s: number) => s > strike) ||
          strikes.find((s: number) => s === strike) ||
          strikes[strikes.length - 1]
      } else {
        targetStrike = [...strikes].reverse().find((s: number) => s < strike) ||
          strikes.find((s: number) => s === strike) ||
          strikes[0]
      }

      if (!targetStrike) continue

      const expiry = getThirdFriday(year, monthIdx)
      const symbol = getSymbolFromExpiryStrike(ticker, expiry, targetStrike)
      const optPrices = prices[ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }

      return {
        label: `${monthName} ${String(year).slice(2)} C${targetStrike}`,
        symbol,
        expiry,
        strike: targetStrike,
        bid: optPrices.bid,
        ask: optPrices.ask,
        last_trade_price: optPrices.last_trade_price
      }
    }

    alert(`Nessuna scadenza ${direction === 'next' ? 'successiva' : 'precedente'} disponibile per ${ticker}.`);
    return null
  }, [chain, prices, getThirdFriday, getSymbolFromExpiryStrike]);

  const updateCurrentCall = useCallback(async (ticker: string) => {
    const sel = selected[ticker] || { year: '', month: '', strike: null }
    if (!sel.year || !sel.month || !sel.strike) return

    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const monthIndex = monthNames.indexOf(sel.month)
    if (monthIndex === -1) return

    const expiryDate = getThirdFriday(Number(sel.year), monthIndex)

    const updatedData = data.map(item => {
      if (item.ticker !== ticker) return item

      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, expiryDate, sel.strike!)
      const currentPrices = prices[item.ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
      const current_bid = currentPrices.bid
      const current_ask = currentPrices.ask
      const current_last_trade_price = currentPrices.last_trade_price
      let future: OptionEntry[] = []
      let earlier: OptionEntry[] = []

      const tickerChain = chain[item.ticker] || {}

      let monthIdx = monthIndex
      let year = Number(sel.year)
      let strikeRef = sel.strike!
      const allFutureMonths: { monthIdx: number, year: number }[] = []
      let attempts = 0
      const maxAttempts = 60
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
        let fStrike = fStrikeList.find((s: number) => s > strikeRef) ||
          fStrikeList.find((s: number) => s === strikeRef) ||
          fStrikeList[fStrikeList.length - 1]
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            future.push({
              label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
              symbol,
              strike: fStrike,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
            strikeRef = fStrike
          } else {
            console.warn(`Invalid symbol generated for future of ${ticker}: ${symbol}`);
          }
        }
      }

      monthIdx = monthIndex
      year = Number(sel.year)
      strikeRef = sel.strike!
      const allEarlierMonths: { monthIdx: number, year: number }[] = []
      attempts = 0
      while (allEarlierMonths.length < 1 && attempts < maxAttempts) {
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
      if (allEarlierMonths.length > 0) {
        const { monthIdx, year } = allEarlierMonths[0]
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        let eStrike1 = [...eStrikeList].reverse().find((s: number) => s < strikeRef) ||
          eStrikeList.find((s: number) => s === strikeRef) ||
          eStrikeList[0]
        if (eStrike1) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike1)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike1}`,
              symbol,
              strike: eStrike1,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
            strikeRef = eStrike1
          }
        }
        let eStrike2 = [...eStrikeList].reverse().find((s: number) => s < strikeRef) ||
          eStrikeList.find((s: number) => s === strikeRef) ||
          eStrikeList[0]
        if (eStrike2 && eStrike2 !== eStrike1) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike2)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike2}`,
              symbol,
              strike: eStrike2,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
          }
        }
      }
      while (future.length < 2) future.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });
      while (earlier.length < 2) earlier.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });

      return {
        ...item,
        strike: sel.strike!,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
        future,
        earlier,
        invalid: false
      }
    })

    setData(updatedData)
    setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { year: '', month: '', strike: null } }))
    setShowDropdowns((prev: { [ticker: string]: boolean }) => ({ ...prev, [ticker]: false }))

    fetch('/api/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        future: updatedData.find(d => d.ticker === ticker)?.future || [],
        earlier: updatedData.find(d => d.ticker === ticker)?.earlier || []
      })
    }).catch(err => console.error('Errore salvataggio stato:', err));

    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, sel.strike!)
    const currentPrices = prices[ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
    const current_bid = currentPrices.bid
    const current_ask = currentPrices.ask
    const current_last_trade_price = currentPrices.last_trade_price

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        strike: sel.strike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase per', ticker)
    }
  }, [selected, data, prices, chain, getSymbolFromExpiryStrike, getThirdFriday, setData, setSelected, setShowDropdowns]);

  const handleRollaClick = useCallback(async (ticker: string, opt: OptionEntry) => {
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
      const currentPrices = prices[item.ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
      const current_bid = currentPrices.bid
      const current_ask = currentPrices.ask
      const current_last_trade_price = currentPrices.last_trade_price
      let future: OptionEntry[] = []
      let earlier: OptionEntry[] = []

      const tickerChain = chain[item.ticker] || {}

      let monthIdx = selectedMonthIndex
      let year = Number(selectedYear)
      let strikeRef = selectedStrike
      const allFutureMonths: { monthIdx: number, year: number }[] = []
      let attempts = 0
      const maxAttempts = 60
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
        let fStrike = fStrikeList.find((s: number) => s > strikeRef) ||
          fStrikeList.find((s: number) => s === strikeRef) ||
          fStrikeList[fStrikeList.length - 1]
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            future.push({
              label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
              symbol,
              strike: fStrike,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
            strikeRef = fStrike
          } else {
            console.warn(`Invalid symbol generated for future of ${ticker}: ${symbol}`);
          }
        }
      }

      monthIdx = selectedMonthIndex
      year = Number(selectedYear)
      strikeRef = selectedStrike
      const allEarlierMonths: { monthIdx: number, year: number }[] = []
      attempts = 0
      while (allEarlierMonths.length < 1 && attempts < maxAttempts) {
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
      if (allEarlierMonths.length > 0) {
        const { monthIdx, year } = allEarlierMonths[0]
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || []
        let eStrike1 = [...eStrikeList].reverse().find((s: number) => s < strikeRef) ||
          eStrikeList.find((s: number) => s === strikeRef) ||
          eStrikeList[0]
        if (eStrike1) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike1)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike1}`,
              symbol,
              strike: eStrike1,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
            strikeRef = eStrike1
          }
        }
        let eStrike2 = [...eStrikeList].reverse().find((s: number) => s < strikeRef) ||
          eStrikeList.find((s: number) => s === strikeRef) ||
          eStrikeList[0]
        if (eStrike2 && eStrike2 !== eStrike1) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike2)
          if (symbol && symbol.trim() !== '') {
            const optPrices = prices[item.ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike2}`,
              symbol,
              strike: eStrike2,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            })
          }
        }
      }
      while (future.length < 2) future.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });
      while (earlier.length < 2) earlier.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });

      return {
        ...item,
        strike: selectedStrike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
        future,
        earlier,
        invalid: false
      }
    })

    setData(updatedData)

    fetch('/api/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        future: updatedData.find(d => d.ticker === ticker)?.future || [],
        earlier: updatedData.find(d => d.ticker === ticker)?.earlier || []
      })
    }).catch(err => console.error('Errore salvataggio stato:', err));

    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, selectedStrike)
    const currentPrices = prices[ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
    const current_bid = currentPrices.bid
    const current_ask = currentPrices.ask
    const current_last_trade_price = currentPrices.last_trade_price

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        strike: selectedStrike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase per', ticker)
    }
  }, [data, prices, chain, getSymbolFromExpiryStrike, getThirdFriday, setData]);

  useEffect(() => {
    fetchTickers()
    fetchData()
    fetchAlerts()
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

  /*
  useEffect(() => {
    if (data.length > 0) {
      fetchPrices()
    }
  }, [data]);
*/

  useEffect(() => {

    if (data.length === 0) return
    const interval = setInterval(() => {
      fetchPrices()
    }, 500)
    return () => clearInterval(interval)
  }, [data]);

  useEffect(() => {
    setData((prev: OptionData[]) => prev.map(item => ({ ...item, spot: (spots[item.ticker]?.price > 0 ? spots[item.ticker].price : item.spot) })));
  }, [spots]);

  useEffect(() => {
    data.forEach(item => {
      if (!alertsEnabled[item.ticker]) return;
      if (item.spot <= 0) return;
      const delta = ((item.strike - item.spot) / item.spot) * 100;
      const tickerPrices = prices[item.ticker] || {};
      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
      const ask = tickerPrices[currentSymbol]?.ask ?? item.current_ask ?? 0;
      const last_trade_price = tickerPrices[currentSymbol]?.last_trade_price ?? item.current_last_trade_price ?? 0;
      const currentPrice = ask > 0 ? ask : (last_trade_price > 0 ? last_trade_price : 0);
      const [currYear, currMonth] = item.expiry.split('-');
      const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
      const currMonthIndex = Number(currMonth) - 1;
      const currMonthName = monthNames[currMonthIndex];
      const currentLabel = `${currMonthName} ${currYear.slice(2)} C${item.strike}`;
      const levels = [4, 3, 2, 1];
      if (!sentAlerts.current[item.ticker]) sentAlerts.current[item.ticker] = {};

      // Alert per low delta (mantieni invariato)
      for (const level of levels) {
        const f1 = item.future[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '' };
        const f2 = item.future[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '' };
        const f1Bid = tickerPrices[f1.symbol]?.bid ?? f1.bid ?? 0;
        const f1Last = tickerPrices[f1.symbol]?.last_trade_price ?? f1.last_trade_price ?? 0;
        const f1Price = f1Bid > 0 ? f1Bid : f1Last;
        const f2Bid = tickerPrices[f2.symbol]?.bid ?? f2.bid ?? 0;
        const f2Last = tickerPrices[f2.symbol]?.last_trade_price ?? f2.last_trade_price ?? 0;
        const f2Price = f2Bid > 0 ? f2Bid : f2Last;
        // Add check: only send if all relevant prices are non-zero
        if (currentPrice > 0 && f1Price > 0 && f2Price > 0 && delta < level && !sentAlerts.current[item.ticker][level]) {
          sentAlerts.current[item.ticker][level] = true;
          const f1Label = f1.label.replace(/C(\d+)/, '$1 CALL');
          const f2Label = f2.label.replace(/C(\d+)/, '$1 CALL');
          const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
          const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}%\n\nStrike: ${item.strike}\nSpot: ${item.spot}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Future 1: ${f1Label} - ${f1Price.toFixed(2)}\n#Future 2: ${f2Label} - ${f2Price.toFixed(2)}`;
          sendTelegramMessage(alertMessage);
        }
      }

      // Nuovo: Alert per earlier fattibile (sostituisce high delta)
      const hasFattibileEarlier = item.earlier.some(opt => isFattibile(opt, item));
      const e1 = item.earlier[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '' };
      const e2 = item.earlier[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '' };
      const e1Bid = tickerPrices[e1.symbol]?.bid ?? e1.bid ?? 0;
      const e1Last = tickerPrices[e1.symbol]?.last_trade_price ?? e1.last_trade_price ?? 0;
      const e1Price = e1Bid > 0 ? e1Bid : e1Last;
      const e2Bid = tickerPrices[e2.symbol]?.bid ?? e2.bid ?? 0;
      const e2Last = tickerPrices[e2.symbol]?.last_trade_price ?? e2.last_trade_price ?? 0;
      const e2Price = e2Bid > 0 ? e2Bid : e2Last;
      // Add similar check for earlier alert
      if (currentPrice > 0 && e1Price > 0 && e2Price > 0 && hasFattibileEarlier && !sentAlerts.current[item.ticker]['fattibile_high']) {
        sentAlerts.current[item.ticker]['fattibile_high'] = true;
        const e1Label = e1.label.replace(/C(\d+)/, '$1 CALL');
        const e2Label = e2.label.replace(/C(\d+)/, '$1 CALL');
        const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
        const alertMessage = `🟢 ${item.ticker} – DELTA: ${delta.toFixed(2)}% (Earlier fattibile disponibile)\n\nStrike: ${item.strike}\nSpot: ${item.spot}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Earlier 1: ${e1Label} - ${e1Price.toFixed(2)}\n#Earlier 2: ${e2Label} - ${e2Price.toFixed(2)}`;
        sendTelegramMessage(alertMessage);
      }
    });
  }, [data, prices, spots, alertsEnabled]);

  useEffect(() => {
    if (Object.keys(prices).length === 0) return;  // Evita aggiornamenti prematuri se prices è vuoto
    setData((prev: OptionData[]) => prev.map(item => {
      if (!item) return item; // Safeguard per item undefined
      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
      const tickerPrices = prices[item.ticker] || {};
      const currentData = tickerPrices[currentSymbol] ?? { bid: item.current_bid ?? 0, ask: item.current_ask ?? 0, last_trade_price: item.current_last_trade_price ?? 0 };
      return {
        ...item,
        current_bid: currentData.bid,
        current_ask: currentData.ask,
        current_last_trade_price: currentData.last_trade_price
      };
    }));
  }, [prices, getSymbolFromExpiryStrike]);  // Esegui ogni volta che prices cambia


  const isFattibile = (opt: OptionEntry, item: OptionData) => {
    const tickerPrices = prices[item.ticker] || {}
    const optPriceData = tickerPrices[opt.symbol]
    const optBid = optPriceData?.bid ?? opt.bid ?? 0
    const optLast = optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0
    const liveOptPrice = optBid > 0 ? optBid : optLast
    if (liveOptPrice <= 0) return false

    const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
    const currentData = tickerPrices[currentSymbol] ?? { ask: item.current_ask ?? 0, last_trade_price: item.current_last_trade_price ?? 0 }
    const currentAsk = currentData.ask ?? 0
    const currentLast = currentData.last_trade_price ?? 0
    const liveCurrentPrice = currentAsk > 0 ? currentAsk : currentLast
    if (liveCurrentPrice <= 0) return false

    return (
      item.spot < opt.strike &&
      opt.strike >= item.spot * 1.04 &&
      liveOptPrice >= liveCurrentPrice * 1.00
    )
  }

  return (
    <Fragment>
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
                    onClick={() => setShowDropdowns((prev: { [ticker: string]: boolean }) => ({ ...prev, [ticker]: true }))}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-1 px-2 rounded w-fit"
                  >
                    📂 Seleziona nuova call
                  </button>
                  {showDropdown && (
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={sel.year}
                        onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
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
                        onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
                        className="bg-zinc-800 text-white p-1"
                        disabled={!sel.year}
                      >
                        <option value="">Mese</option>
                        {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={sel.strike ?? ''}
                        onChange={e => setSelected((prev: { [ticker: string]: { year: string, month: string, strike: number | null } }) => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
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
                setPrices={setPrices}
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
                spots={spots}
              />
            )
          })}
        </div>
      </div>
    </Fragment>
  )
}