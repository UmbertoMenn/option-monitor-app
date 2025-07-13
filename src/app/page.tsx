'use client'

import React, { useEffect, useState, useRef } from 'react'
import { sendTelegramMessage } from './telegram'

/** Converte uno strike (es. 170) in "00170000" per OPRA */
function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0')
}

/** Genera il ticker OPRA da ticker, expiry "YYYY-MM-DD" e strike */
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
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-15` // fallback
}

export default function Page(): JSX.Element {
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, number[]>>>({})
  const [prices, setPrices] = useState<Record<string, Record<string, { bid: number; ask: number; symbol: string }>>>({})
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const sentAlerts = useRef<{ [level: number]: boolean }>({})
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const [pendingRoll, setPendingRoll] = useState<OptionEntry | null>(null)

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
      const res = await fetch('/api/chain')
      const json = await res.json()
      setChain(json)
    } catch (err) {
      console.error('Errore fetch /api/chain', err)
    }
  }

  const fetchPrices = async () => {
    try {
      const symbols: string[] = []
      data.forEach(item => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
        symbols.push(currentSymbol)
        item.earlier.forEach(opt => symbols.push(opt.symbol))
        item.future.forEach(opt => symbols.push(opt.symbol))
      })

      if (!symbols.length) {
        console.warn('⚠️ Nessun simbolo trovato!')
        return
      }

      console.log('🎯 Simboli richiesti:', symbols)
      const url = `/api/full-prices?symbols=${encodeURIComponent(symbols.join(','))}`
      const res = await fetch(url)
      const json = await res.json()
      console.log('📥 Risposta /api/full-prices:', json)

      const grouped: Record<string, Record<string, { bid: number; ask: number; symbol: string }>> = {}
      for (const [symbol, val] of Object.entries(json)) {
        const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol)
        if (!match) {
          console.warn('❌ Simbolo non valido:', symbol)
          continue
        }
        const ticker = match[1]
        if (!grouped[ticker]) grouped[ticker] = {}
        grouped[ticker][symbol] = {
          bid: (val as any)?.bid ?? 0,
          ask: (val as any)?.ask ?? 0,
          symbol
        }
      }

      setPrices(grouped)
      console.log('✅ンク Prezzi aggiornati:', grouped)
    } catch (err) {
      console.error('Errore fetch /api/full-prices', err)
    }
  }

  function shiftExpiryByMonth(
    ticker: string,
    opt: OptionEntry,
    direction: 'next' | 'prev',
    chain: Record<string, Record<string, number[]>>,
    type: 'future' | 'earlier'
  ): OptionEntry | null {
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
          if (!chain[year.toString()]) break
        }
      } else {
        monthIdx--
        if (monthIdx < 0) {
          monthIdx = 11
          year--
          if (!chain[year.toString()]) break
        }
      }

      const monthName = monthNames[monthIdx]
      const yearKey = year.toString()
      if (!chain[yearKey] || !chain[yearKey][monthName]) continue

      const strikes = chain[yearKey][monthName]
      const strike = opt.strike
      const targetStrike = type === 'future'
        ? strikes.find(s => s > strike)
        : [...strikes].reverse().find(s => s < strike)

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
    return null
  }

  const updateCurrentCall = async () => {
    if (!selectedYear || !selectedMonth || !selectedStrike) return

    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const monthIndex = monthNames.indexOf(selectedMonth)
    if (monthIndex === -1) return

    const expiryDate = getThirdFriday(Number(selectedYear), monthIndex)
    const updatedData = data.map(item => {
      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, expiryDate, selectedStrike)
      const currentCallPrice = prices[item.ticker]?.[currentSymbol]?.ask ?? 0
      const future: OptionEntry[] = []
      const earlier: OptionEntry[] = []

      let futureCount = 0
      let monthIdx = monthIndex
      let year = Number(selectedYear)

      while (futureCount < 2) {
        monthIdx++
        if (monthIdx >= 12) {
          year++
          if (!chain[year.toString()]) break
          monthIdx = 0
        }
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = chain[year.toString()]?.[futureMonth] || []
        const fStrike = fStrikeList.find(s => s > selectedStrike)
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          const price = prices[item.ticker]?.[symbol]?.bid ?? 0
          future.push({
            label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
            symbol,
            strike: fStrike,
            price,
            expiry
          })
          futureCount++
        }
      }

      let earlierCount = 0
      monthIdx = monthIndex
      year = Number(selectedYear)

      while (earlierCount < 2) {
        monthIdx--
        if (monthIdx < 0) {
          year--
          if (!chain[year.toString()]) break
          monthIdx = 11
        }
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = chain[year.toString()]?.[earlierMonth] || []
        const eStrike = [...eStrikeList].reverse().find(s => s < selectedStrike)
        if (eStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike)
          const price = prices[item.ticker]?.[symbol]?.bid ?? 0
          earlier.push({
            label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`,
            symbol,
            strike: eStrike,
            price,
            expiry
          })
          earlierCount++
        }
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
    setSelectedYear('')
    setSelectedMonth('')
    setSelectedStrike(null)
    setShowDropdown(false)

    const mainTicker = data[0].ticker
    const currentSymbol = getSymbolFromExpiryStrike(mainTicker, expiryDate, selectedStrike)
    const currentCallPrice = prices[mainTicker]?.[currentSymbol]?.ask ?? 0

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: mainTicker,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase')
    }
  }

  const handleRollaClick = async (opt: OptionEntry) => {
    const [yearStr, monthStr] = opt.expiry.split('-')
    const selectedYear = yearStr
    const selectedMonthIndex = Number(monthStr) - 1
    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const selectedMonth = monthNames[selectedMonthIndex]
    const selectedStrike = opt.strike
    const expiryDate = getThirdFriday(Number(selectedYear), selectedMonthIndex)

    const updatedData = data.map(item => {
      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, expiryDate, selectedStrike)
      const currentCallPrice = prices[item.ticker]?.[currentSymbol]?.ask ?? 0
      const future: OptionEntry[] = []
      const earlier: OptionEntry[] = []

      let futureCount = 0
      let monthIdx = selectedMonthIndex
      let year = Number(selectedYear)

      while (futureCount < 2) {
        monthIdx++
        if (monthIdx >= 12) {
          year++
          if (!chain[year.toString()]) break
          monthIdx = 0
        }
        const futureMonth = monthNames[monthIdx]
        const fStrikeList = chain[year.toString()]?.[futureMonth] || []
        const fStrike = fStrikeList.find(s => s > selectedStrike)
        if (fStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, fStrike)
          const price = prices[item.ticker]?.[symbol]?.bid ?? 0
          future.push({
            label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
            symbol,
            strike: fStrike,
            price,
            expiry
          })
          futureCount++
        }
      }

      let earlierCount = 0
      monthIdx = selectedMonthIndex
      year = Number(selectedYear)

      while (earlierCount < 2) {
        monthIdx--
        if (monthIdx < 0) {
          year--
          if (!chain[year.toString()]) break
          monthIdx = 11
        }
        const earlierMonth = monthNames[monthIdx]
        const eStrikeList = chain[year.toString()]?.[earlierMonth] || []
        const eStrike = [...eStrikeList].reverse().find(s => s < selectedStrike)
        if (eStrike) {
          const expiry = getThirdFriday(year, monthIdx)
          const symbol = getSymbolFromExpiryStrike(item.ticker, expiry, eStrike)
          const price = prices[item.ticker]?.[symbol]?.bid ?? 0
          earlier.push({
            label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`,
            symbol,
            strike: eStrike,
            price,
            expiry
          })
          earlierCount++
        }
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
    const mainTicker = data[0].ticker
    const currentSymbol = getSymbolFromExpiryStrike(mainTicker, expiryDate, selectedStrike)
    const currentCallPrice = prices[mainTicker]?.[currentSymbol]?.ask ?? 0

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: mainTicker,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice,
      })
    })
    const confirmJson = await confirmRes.json()
    if (!confirmJson.success) {
      console.error('Errore salvataggio su Supabase')
    }
  }

  useEffect(() => {
    fetchData()
    fetchChain()
  }, [])

  useEffect(() => {
    if (data.length > 0) {
      fetchPrices()
    }
  }, [data])

  useEffect(() => {
    if (data.length === 0) return
    const interval = setInterval(() => {
      fetchPrices()
    }, 1000)
    return () => clearInterval(interval)
  }, [data])

  useEffect(() => {
    if (!alertsEnabled || !data.length) return
    const item = data[0]
    const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
    const levels = [4, 3, 2, 1]
    for (const level of levels) {
      if (delta < level && !sentAlerts.current[level]) {
        sentAlerts.current[level] = true
        sendTelegramMessage(`⚠️ ALERT ${level}% – ${item.ticker}\nStrike: ${item.strike}\nSpot: ${item.spot}\nDelta: ${delta.toFixed(2)}%`)
      }
    }
  }, [data, alertsEnabled])

  useEffect(() => {
    setData(prev =>
      prev.map(item => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
        const tickerPrices = prices[item.ticker] || {}
        const currentCallPrice = tickerPrices[currentSymbol]?.bid ?? item.currentCallPrice
        const updatedEarlier = item.earlier.map(opt => ({
          ...opt,
          price: tickerPrices[opt.symbol]?.bid ?? opt.price
        }))
        const updatedFuture = item.future.map(opt => ({
          ...opt,
          price: tickerPrices[opt.symbol]?.bid ?? opt.price
        }))
        return {
          ...item,
          currentCallPrice,
          earlier: updatedEarlier,
          future: updatedFuture
        }
      })
    )
  }, [prices])

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
            <div className="text-sm text-center mb-4 text-zinc-400">{pendingRoll.label} - {pendingRoll.expiry}</div>
            <div className="flex justify-between gap-3">
              <button
                onClick={() => setPendingRoll(null)}
                className="flex-1 bg-red-700 hover:bg-red-800 text-white py-1 rounded"
              >
                ❌ No
              </button>
              <button
                onClick={async () => {
                  await handleRollaClick(pendingRoll)
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((item: OptionData, index: number) => {
            const deltaPct = ((item.strike - item.spot) / item.spot) * 100
            const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'

            if (item.invalid) {
              return (
                <div key={index} className="bg-red-800 text-white rounded-lg p-4 shadow-md flex flex-col gap-2">
                  <div className="font-bold text-lg">⚠️ Errore caricamento CALL</div>
                  <div>La call corrente salvata su Supabase non è più disponibile o ha dati errati.</div>
                  <button
                    onClick={() => setShowDropdown(true)}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-1 px-2 rounded w-fit"
                  >
                    📂 Seleziona nuova call
                  </button>
                  {showDropdown && (
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={selectedYear}
                        onChange={e => {
                          setSelectedYear(e.target.value)
                          setSelectedMonth('')
                          setSelectedStrike(null)
                        }}
                        className="bg-zinc-800 text-white p-1"
                      >
                        <option value="">Anno</option>
                        {Object.keys(chain).map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <select
                        value={selectedMonth}
                        onChange={e => {
                          setSelectedMonth(e.target.value)
                          setSelectedStrike(null)
                        }}
                        className="bg-zinc-800 text-white p-1"
                        disabled={!selectedYear}
                      >
                        <option value="">Mese</option>
                        {selectedYear && Object.keys(chain[selectedYear] || {}).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={selectedStrike ?? ''}
                        onChange={e => setSelectedStrike(Number(e.target.value))}
                        className="bg-zinc-800 text-white p-1"
                        disabled={!selectedMonth}
                      >
                        <option value="">Strike</option>
                        {selectedYear && selectedMonth && (chain[selectedYear]?.[selectedMonth] || []).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={updateCurrentCall}
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
              <div key={index} className="bg-zinc-900 border border-zinc-800 shadow-md rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <h2 className="text-base font-bold text-red-500">{item.ticker}</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setAlertsEnabled(prev => {
                          const next = !prev
                          if (next) {
                            const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
                            const newSent: { [level: number]: boolean } = {}
                            const levels = [4, 3, 2, 1]
                            for (const level of levels) {
                              if (delta >= level) newSent[level] = true
                            }
                            sentAlerts.current = newSent
                            sendTelegramMessage(`🔔 ALERT ATTIVATI – Spot: ${item.spot}, Strike: ${item.strike}`)
                          } else {
                            sentAlerts.current = {}
                            sendTelegramMessage(`🔕 ALERT DISATTIVATI`)
                          }
                          return next
                        })
                      }}
                      title={alertsEnabled ? 'Disattiva alert' : 'Attiva alert'}
                      className={`px-1 py-0.5 rounded text-sm ${alertsEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-zinc-700 hover:bg-zinc-600'} text-white`}
                    >
                      {alertsEnabled ? '🔔' : '🔕'}
                    </button>
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded"
                    >
                      🔄 UPDATE CURRENT CALL
                    </button>
                  </div>
                </div>
                {showDropdown && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <select
                      value={selectedYear}
                      onChange={e => {
                        setSelectedYear(e.target.value)
                        setSelectedMonth('')
                        setSelectedStrike(null)
                      }}
                      className="bg-zinc-800 text-white p-1"
                    >
                      <option value="">Anno</option>
                      {Object.keys(chain).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select
                      value={selectedMonth}
                      onChange={e => {
                        setSelectedMonth(e.target.value)
                        setSelectedStrike(null)
                      }}
                      className="bg-zinc-800 text-white p-1"
                      disabled={!selectedYear}
                    >
                      <option value="">Mese</option>
                      {selectedYear && Object.keys(chain[selectedYear] || {}).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      value={selectedStrike ?? ''}
                      onChange={e => setSelectedStrike(Number(e.target.value))}
                      className="bg-zinc-800 text-white p-1"
                      disabled={!selectedMonth}
                    >
                      <option value="">Strike</option>
                      {selectedYear && selectedMonth && (chain[selectedYear]?.[selectedMonth] || []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={updateCurrentCall}
                      className="col-span-3 mt-1 bg-green-700 hover:bg-green-800 text-white text-xs font-medium px-2 py-1 rounded"
                    >
                      ✔️ Conferma nuova CALL
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1 mb-2">
                  <div className="p-1 bg-blue-700 font-bold">Spot</div>
                  <div className="p-1 bg-blue-700">{item.spot.toFixed(2)}</div>
                  <div className="p-1 bg-blue-700 font-bold">Strike</div>
                  <div className="p-1 bg-blue-700">{item.strike.toFixed(2)}</div>
                  <div className="p-1 bg-blue-700 font-bold">Scadenza</div>
                  <div className="p-1 bg-blue-700">{item.expiry}</div>
                  <div className="p-1 bg-blue-700 font-bold">Δ% Strike/Spot</div>
                  <div className={`p-1 ${deltaColor}`}>{deltaPct.toFixed(2)}%</div>
                  <div className="p-1 bg-blue-700 font-bold">Prezzo Call attuale</div>
                  {(() => {
                    const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
                    const ask = prices[item.ticker]?.[currentSymbol]?.ask
                    const priceToShow = ask ?? item.currentCallPrice
                    return <div className="p-1 bg-blue-700">{priceToShow.toFixed(2)}</div>
                  })()}
                </div>
                <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Future</div>
                {item.future.map((opt, i) => {
                  const tickerPrices = prices[item.ticker] || {}
                  const optPriceData = tickerPrices[opt.symbol]
                  const optPrice = optPriceData?.bid ?? opt.price
                  const delta = optPriceData ? ((optPrice - item.currentCallPrice) / item.spot) * 100 : 0
                  const deltaColor = delta >= 0 ? 'text-green-400' : 'text-red-400'
                  const deltaSign = delta >= 0 ? '+' : ''

                  return (
                    <div key={i} className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        {isFattibile(opt, item) && (
                          <span className="text-green-400" title="Fattibile: strike ≥ spot + 4%, prezzo ≥ 90% del prezzo call attuale">🟢</span>
                        )}
                        <span title={opt.expiry}>
                          {opt.label} - {optPriceData ? optPrice.toFixed(2) : 'NO DATA'} /
                          {optPriceData && (
                            <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor}`}>
                              {deltaSign}{delta.toFixed(2)}%
                            </span>
                          )}
                        </span>
                      </span>
                      <div className="flex gap-1 items-center">
                        <button
                          onClick={() => setPendingRoll(opt)}
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
                            const chainStrikes = chain[year]?.[monthNames[monthIndex]] || []
                            const nextStrike = chainStrikes.find(s => s > opt.strike)
                            if (!nextStrike) return

                            const updatedOpt = {
                              ...opt,
                              strike: nextStrike,
                              label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                              symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                            }

                            const updatedData = [...data]
                            updatedData[index].future[i] = updatedOpt
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
                            const chainStrikes = chain[year]?.[monthNames[monthIndex]] || []
                            const prevStrike = [...chainStrikes].reverse().find(s => s < opt.strike)
                            if (!prevStrike) return

                            const updatedOpt = {
                              ...opt,
                              strike: prevStrike,
                              label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                              symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                            }

                            const updatedData = [...data]
                            updatedData[index].future[i] = updatedOpt
                            setData(updatedData)
                          }}
                        >
                          🔽
                        </button>
                        <button
                          title="Month Back"
                          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                          onClick={() => {
                            const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', chain, 'earlier')
                            if (!shift) return

                            const updatedOpt = {
                              ...opt,
                              ...shift,
                              symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                            }

                            const updatedData = [...data]
                            updatedData[index].future[i] = updatedOpt
                            setData(updatedData)
                          }}
                        >
                          ◀️
                        </button>
                        <button
                          title="Month Forward"
                          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                          onClick={() => {
                            const shift = shiftExpiryByMonth(item.ticker, opt, 'next', chain, 'future')
                            if (!shift) return

                            const updatedOpt = {
                              ...opt,
                              ...shift,
                              symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                            }

                            const updatedData = [...data]
                            updatedData[index].future[i] = updatedOpt
                            setData(updatedData)
                          }}
                        >
                          ▶️
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Earlier</div>
                {item.earlier.map((opt, i) => {
                  const tickerPrices = prices[item.ticker] || {}
                  const optPriceData = tickerPrices[opt.symbol]
                  const optPrice = optPriceData?.bid ?? opt.price
                  const delta = optPriceData ? ((optPrice - item.currentCallPrice) / item.spot) * 100 : 0
                  const deltaColor = delta >= 0 ? 'text-green-400' : 'text-red-400'
                  const deltaSign = delta >= 0 ? '+' : ''

                  return (
                    <div key={i} className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1">
                        {isFattibile(opt, item) && (
                          <span className="text-green-400" title="Fattibile: strike ≥ spot + 4%, prezzo ≥ 90% del prezzo call attuale">🟢</span>
                        )}
                        <span title={opt.expiry}>
                          {opt.label} - {optPriceData ? optPrice.toFixed(2) : 'NO DATA'} /
                          {optPriceData && (
                            <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor}`}>
                              {deltaSign}{delta.toFixed(2)}%
                            </span>
                          )}
                        </span>
                      </span>
                      <div className="flex gap-1 items-center">
                        <button
                          onClick={() => setPendingRoll(opt)}
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
                            const chainStrikes = chain[year]?.[monthNames[monthIndex]] || []
                            const nextStrike = chainStrikes.find(s => s > opt.strike)
                            if (!nextStrike) return

                            const updatedOpt = {
                              ...opt,
                              strike: nextStrike,
                              label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                              symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, nextStrike)
                            }

                            const updatedData = [...data]
                            updatedData[index].earlier[i] = updatedOpt
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
                            const chainStrikes = chain[year]?.[monthNames[monthIndex]] || []
                            const prevStrike = [...chainStrikes].reverse().find(s => s < opt.strike)
                            if (!prevStrike) return

                            const updatedOpt = {
                              ...opt,
                              strike: prevStrike,
                              label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                              symbol: getSymbolFromExpiryStrike(item.ticker, opt.expiry, prevStrike)
                            }

                            const updatedData = [...data]
                            updatedData[index].earlier[i] = updatedOpt
                            setData(updatedData)
                          }}
                        >
                          🔽
                        </button>
                        <button
                          title="Month Back"
                          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                          onClick={() => {
                            const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', chain, 'earlier')
                            if (!shift) return

                            const updatedOpt = {
                              ...opt,
                              ...shift,
                              symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                            }

                            const updatedData = [...data]
                            updatedData[index].earlier[i] = updatedOpt
                            setData(updatedData)
                          }}
                        >
                          ◀️
                        </button>
                        <button
                          title="Month Forward"
                          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                          onClick={() => {
                            const shift = shiftExpiryByMonth(item.ticker, opt, 'next', chain, 'future')
                            if (!shift) return

                            const updatedOpt = {
                              ...opt,
                              ...shift,
                              symbol: getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)
                            }

                            const updatedData = [...data]
                            updatedData[index].earlier[i] = updatedOpt
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
          })}
        </div>
      </div>
    </>
  )
}