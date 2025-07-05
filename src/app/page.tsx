'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

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

const supabase = createClient(
  'https://nzduzobajwbufsfieujm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56ZHV6b2JhandidWZzZmlldWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE3MDQwNTksImV4cCI6MjA2NzI4MDA1OX0.c4A5ipwx5AXzuCPH7Au8Czr_nrh4hLwerFwU51HlkTs'
)

export default function Page() {
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, number[]>>>({})
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)

  const monthNames = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC']

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

  const handleSelect = async (expiry: string, strike: number) => {
    const [year, month] = expiry.split('-')
    const label = `${monthNames[parseInt(month)-1]} ${year.slice(2)} C${strike}`
    const future: OptionEntry[] = []
    const earlier: OptionEntry[] = []
    const currentMonthIndex = monthNames.indexOf(monthNames[parseInt(month)-1])

    let fCount = 0
    let fYear = parseInt(year)
    let fMonthIndex = currentMonthIndex
    while (fCount < 2) {
      fMonthIndex++
      if (fMonthIndex > 11) {
        fYear++
        fMonthIndex = 0
      }
      const fMonth = monthNames[fMonthIndex]
      const fStrikeList = chain[fYear]?.[fMonth] || []
      const fStrike = fStrikeList.find(s => s > strike)
      if (fStrike) {
        future.push({
          label: `${fMonth} ${String(fYear).slice(2)} C${fStrike}`,
          strike: fStrike,
          price: 0,
          expiry: `${fYear}-${(fMonthIndex+1).toString().padStart(2,'0')}-20`
        })
        fCount++
      }
    }

    let eCount = 0
    let eYear = parseInt(year)
    let eMonthIndex = currentMonthIndex
    while (eCount < 2) {
      eMonthIndex--
      if (eMonthIndex < 0) {
        eYear--
        eMonthIndex = 11
      }
      const eMonth = monthNames[eMonthIndex]
      const eStrikeList = chain[eYear]?.[eMonth] || []
      const eStrike = [...eStrikeList].reverse().find(s => s < strike)
      if (eStrike) {
        earlier.push({
          label: `${eMonth} ${String(eYear).slice(2)} C${eStrike}`,
          strike: eStrike,
          price: 0,
          expiry: `${eYear}-${(eMonthIndex+1).toString().padStart(2,'0')}-20`
        })
        eCount++
      }
    }

    await supabase.from('positions').delete().neq('id', 0)
    await supabase.from('positions').insert({
      ticker: 'NVDA',
      strike,
      expiry
    })

    const updated = data.map(d => ({
      ...d,
      strike,
      expiry,
      currentCallPrice: d.currentCallPrice * (strike / d.strike),
      future,
      earlier
    }))

    setData(updated)
    setSelectedExpiry(expiry)
    setSelectedStrike(strike)
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
        <span className={color}>/ {sign}{diffPct.toFixed(1)}%</span>
      </>
    )
  }

  const isFattibile = (opt: OptionEntry, item: OptionData) =>
    item.spot < opt.strike &&
    opt.strike >= item.spot * 1.04 &&
    opt.price >= item.currentCallPrice * 0.9

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <h1 className="text-xl font-bold mb-6">📅 Seleziona Opzione CALL</h1>
      <div className="overflow-x-auto space-y-8 mb-10">
        {Object.entries(chain).map(([year, months]) => (
          <div key={year}>
            <div className="text-lg font-semibold text-zinc-300 mb-2">Anno {year}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Object.entries(months).map(([month, strikes]) => (
                <div key={month} className="border border-zinc-700 rounded-lg shadow-md">
                  <div className="bg-zinc-800 text-white px-3 py-2 font-semibold text-center rounded-t-lg">
                    {month}
                  </div>
                  <div className="divide-y divide-zinc-700">
                    {strikes.map(strike => {
                      const expiry = `${year}-${(monthNames.indexOf(month)+1).toString().padStart(2,'0')}`
                      const isSelected = selectedExpiry === expiry && selectedStrike === strike
                      return (
                        <button
                          key={strike}
                          onClick={() => handleSelect(expiry, strike)}
                          className={`w-full px-4 py-2 text-sm hover:bg-zinc-700 transition-colors duration-150 ${isSelected ? 'bg-green-600 text-white font-bold' : 'text-white'}`}
                        >
                          CALL {strike}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((item, index) => {
          const deltaPct = ((item.strike - item.spot) / item.spot) * 100
          const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'

          return (
            <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-lg font-bold text-red-400 mb-2">{item.ticker}</h2>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="font-bold">Spot</div>
                <div>{item.spot.toFixed(2)}</div>
                <div className="font-bold">Strike</div>
                <div>{item.strike.toFixed(2)}</div>
                <div className="font-bold">Scadenza</div>
                <div>{item.expiry}</div>
                <div className="font-bold">Δ% Strike/Spot</div>
                <div className={deltaColor}>{deltaPct.toFixed(2)}%</div>
                <div className="font-bold">Prezzo Call attuale</div>
                <div>{item.currentCallPrice.toFixed(2)}</div>
              </div>

              <div className="mt-4">
                <div className="font-semibold bg-orange-500 text-white text-center py-1 rounded">Future</div>
                {item.future.map((opt, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1">
                    <span className="flex items-center gap-1">
                      {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                      <span title={opt.expiry}>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <div className="font-semibold bg-orange-500 text-white text-center py-1 rounded">Earlier</div>
                {item.earlier.map((opt, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1">
                    <span className="flex items-center gap-1">
                      {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                      <span title={opt.expiry}>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
