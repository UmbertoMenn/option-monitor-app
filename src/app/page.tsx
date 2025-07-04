// src/app/page.tsx

'use client'

import React, { useEffect, useState } from 'react'

interface OptionEntry {
  label: string
  price: number
  strike: number
  expiry: string
}

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  currentCallPrice: number
  earlier: OptionEntry[]
  future: OptionEntry[]
}

export default function Page() {
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, number[]>>>({})
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/options')
      const json = await res.json()
      if (Array.isArray(json)) setData(json)
    } catch (err) {
      console.error('Errore fetch /api/options')
    }
  }

  const fetchChain = async () => {
    try {
      const res = await fetch('/api/chain')
      const json = await res.json()
      setChain(json)
    } catch (err) {
      console.error('Errore fetch /api/chain')
    }
  }

  const updateCurrentCall = () => {
    if (!selectedYear || !selectedMonth || !selectedStrike) return
    const label = `${selectedMonth} ${selectedYear.slice(2)} C${selectedStrike}`
    const expiryDate = new Date(`${selectedYear}-${(
      ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'].indexOf(selectedMonth)+1
    ).toString().padStart(2,'0')}-20`) // solo label visivo

    const updated = data.map(d => ({
      ...d,
      strike: selectedStrike,
      expiry: expiryDate.toISOString().slice(0, 10),
      currentCallPrice: d.currentCallPrice * (selectedStrike / d.strike), // mock di prezzo
      future: [],
      earlier: []
    }))
    setData(updated)
  }

  useEffect(() => {
    fetchData()
    fetchChain()
  }, [])

  const renderPriceWithDelta = (price: number, currentCallPrice: number, spot: number) => {
    const diffPct = ((price - currentCallPrice) / spot) * 100
    const color = diffPct >= 0 ? 'text-green-400' : 'text-red-400'
    const sign = diffPct >= 0 ? '+' : ''
    return (
      <>
        {price.toFixed(2)}{' '}
        <span className={color}>
          / {sign}{diffPct.toFixed(1)}%
        </span>
      </>
    )
  }

  const isFattibile = (opt: OptionEntry, item: OptionData) =>
    item.spot < opt.strike &&
    opt.strike >= item.spot * 1.04 &&
    opt.price >= item.currentCallPrice * 0.9

  return (
    <div className="min-h-screen bg-black text-white p-2 flex flex-col gap-4 text-sm leading-tight">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.map((item, index) => {
          const deltaPct = ((item.strike - item.spot) / item.spot) * 100
          const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'

          return (
            <div key={index} className="bg-zinc-900 border border-zinc-800 shadow-md rounded-lg p-3">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-base font-bold text-red-500">{item.ticker}</h2>
              </div>

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
                <div className="p-1 bg-blue-700">{item.currentCallPrice.toFixed(2)}</div>
              </div>

              <div className="mb-2">
                <label className="text-xs">Anno:</label>
                <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="ml-2 bg-zinc-800 text-white">
                  <option value="">--</option>
                  {Object.keys(chain).map(y => <option key={y}>{y}</option>)}
                </select>

                <label className="text-xs ml-2">Mese:</label>
                <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="ml-2 bg-zinc-800 text-white">
                  <option value="">--</option>
                  {selectedYear && Object.keys(chain[selectedYear] || {}).map(m => <option key={m}>{m}</option>)}
                </select>

                <label className="text-xs ml-2">Strike:</label>
                <select value={selectedStrike ?? ''} onChange={e => setSelectedStrike(Number(e.target.value))} className="ml-2 bg-zinc-800 text-white">
                  <option value="">--</option>
                  {selectedYear && selectedMonth && (chain[selectedYear]?.[selectedMonth] || []).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={updateCurrentCall}
                className="w-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded mb-2"
              >
                🔄 UPDATE CURRENT CALL
              </button>

              <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Future</div>
              {item.future.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1">
                    {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                    <span title={opt.expiry}>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                  </span>
                </div>
              ))}

              <div className="mt-2 mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Earlier</div>
              {item.earlier.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1">
                    {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                    <span title={opt.expiry}>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
