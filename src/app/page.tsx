// VERSIONE COMPLETA page.tsx con ROLLA, FRECCE, Δ%, PALLINO VERDE RIPRISTINATI

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

export default function Page() {
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, number[]>>>({})
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const fetchData = async () => {
    const res = await fetch('/api/options')
    const json = await res.json()
    if (Array.isArray(json)) setData(json)
  }

  const fetchChain = async () => {
    const res = await fetch('/api/chain')
    const json = await res.json()
    setChain(json)
  }

  const updateCurrentCall = async () => {
    if (!selectedYear || !selectedMonth || !selectedStrike) return
    const expiryDate = getThirdFriday(Number(selectedYear), ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'].indexOf(selectedMonth))

    const updatedData = data.map(item => {
      const currentMonthIndex = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'].indexOf(selectedMonth)
      const future: OptionEntry[] = []
      const earlier: OptionEntry[] = []
      let futureCount = 0
      let monthIndex = currentMonthIndex
      let year = Number(selectedYear)

      while (futureCount < 2) {
        monthIndex++
        if (monthIndex >= 12) { year++; monthIndex = 0 }
        const futureMonth = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][monthIndex]
        const fStrike = chain[year]?.[futureMonth]?.find(s => s > selectedStrike!)
        if (fStrike) {
          future.push({ label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`, strike: fStrike, price: 0, expiry: `${year}-${String(monthIndex + 1).padStart(2, '0')}-20` })
          futureCount++
        }
      }

      let earlierCount = 0
      monthIndex = currentMonthIndex
      year = Number(selectedYear)
      while (earlierCount < 2) {
        monthIndex--
        if (monthIndex < 0) { year--; monthIndex = 11 }
        const earlierMonth = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][monthIndex]
        const eStrike = [...(chain[year]?.[earlierMonth] || [])].reverse().find(s => s < selectedStrike!)
        if (eStrike) {
          earlier.push({ label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`, strike: eStrike, price: 0, expiry: `${year}-${String(monthIndex + 1).padStart(2, '0')}-20` })
          earlierCount++
        }
      }

      return {
        ...item,
        strike: selectedStrike!,
        expiry: expiryDate,
        currentCallPrice: item.currentCallPrice * (selectedStrike! / item.strike),
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

    await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: data[0].ticker,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice: data[0].currentCallPrice * (selectedStrike! / data[0].strike)
      })
    })
  }

  useEffect(() => { fetchData(); fetchChain() }, [])

  const isFattibile = (opt: OptionEntry, item: OptionData) =>
    item.spot < opt.strike &&
    opt.strike >= item.spot * 1.04 &&
    opt.price >= item.currentCallPrice * 0.9

  const renderControls = (opt: OptionEntry) => (
    <div className="flex items-center gap-1 ml-2">
      <button className="text-green-400" title="ROLLA su questa posizione">ROLLA</button>
      <div className="flex flex-col gap-0">
        <button className="text-green-400" title="Month Up">→</button>
        <button className="text-red-400" title="Month Down">←</button>
      </div>
      <div className="flex gap-1">
        <button className="text-green-400" title="Strike Up">🔼</button>
        <button className="text-red-400" title="Strike Down">🔽</button>
      </div>
    </div>
  )

  const renderDelta = (opt: OptionEntry, item: OptionData) => {
    const delta = ((opt.price - item.currentCallPrice) / item.spot) * 100
    return <span className="text-xs text-yellow-400 ml-1" title="Delta rispetto a call attuale, diviso per spot">({delta.toFixed(2)}%)</span>
  }

  return (
    <div className="min-h-screen bg-black text-white p-2 flex flex-col gap-4 text-sm leading-tight">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.map((item, index) => (
          <div key={index} className="bg-zinc-900 border border-zinc-800 shadow-md rounded-lg p-3">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-base font-bold text-red-500">{item.ticker}</h2>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded"
              >🔄 UPDATE CURRENT CALL</button>
            </div>

            <div className="grid grid-cols-2 gap-1 mb-2">
              <div className="p-1 bg-blue-700 font-bold">Spot</div>
              <div className="p-1 bg-blue-700">{item.spot.toFixed(2)}</div>
              <div className="p-1 bg-blue-700 font-bold">Strike</div>
              <div className="p-1 bg-blue-700">{item.strike.toFixed(2)}</div>
              <div className="p-1 bg-blue-700 font-bold">Scadenza</div>
              <div className="p-1 bg-blue-700">{item.expiry}</div>
              <div className="p-1 bg-blue-700 font-bold">Prezzo Call attuale</div>
              <div className="p-1 bg-blue-700">{item.currentCallPrice.toFixed(2)}</div>
            </div>

            <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Future</div>
            {item.future.map((opt, i) => (
              <div key={i} className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1">
                  {isFattibile(opt, item) && <span className="text-green-400" title="Opzione fattibile: OTM >4% e bid ≥90% del prezzo attuale">🟢</span>}
                  <span title={opt.expiry}>{opt.label} - {opt.price.toFixed(2)}</span>
                  {renderDelta(opt, item)}
                </span>
                {renderControls(opt)}
              </div>
            ))}

            <div className="mt-2 mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Earlier</div>
            {item.earlier.map((opt, i) => (
              <div key={i} className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1">
                  {isFattibile(opt, item) && <span className="text-green-400" title="Opzione fattibile: OTM >4% e bid ≥90% del prezzo attuale">🟢</span>}
                  <span title={opt.expiry}>{opt.label} - {opt.price.toFixed(2)}</span>
                  {renderDelta(opt, item)}
                </span>
                {renderControls(opt)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
