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

export default function Page() {
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, number[]>>>({})
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

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

  const updateCurrentCall = async () => {
    if (!selectedYear || !selectedMonth || !selectedStrike) return

    const label = `${selectedMonth} ${selectedYear.slice(2)} C${selectedStrike}`
function getThirdFriday(year: number, monthIndex: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, monthIndex, day)
    if (d.getMonth() !== monthIndex) break
    if (d.getDay() === 5) {
      count++
      if (count === 3) {
        return d.toISOString().slice(0, 10)
      }
    }
  }
  return '' // fallback
}

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
        if (monthIndex >= 12) {
          year++
          if (!chain[year]) break
          monthIndex = 0
        }
        const futureMonth = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][monthIndex]
        const fStrikeList = chain[year]?.[futureMonth] || []
        const fStrike = fStrikeList.find(s => s > selectedStrike!)
        if (fStrike) {
          future.push({
            label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
            strike: fStrike,
            price: 0,
            expiry: `${year}-${(monthIndex+1).toString().padStart(2,'0')}-20`
          })
          futureCount++
        }
      }

      let earlierCount = 0
      monthIndex = currentMonthIndex
      year = Number(selectedYear)

      while (earlierCount < 2) {
        monthIndex--
        if (monthIndex < 0) {
          year--
          if (!chain[year]) break
          monthIndex = 11
        }
        const earlierMonth = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][monthIndex]
        const eStrikeList = chain[year]?.[earlierMonth] || []
        const eStrike = [...eStrikeList].reverse().find(s => s < selectedStrike!)
        if (eStrike) {
          earlier.push({
            label: `${earlierMonth} ${String(year).slice(2)} C${eStrike}`,
            strike: eStrike,
            price: 0,
            expiry: `${year}-${(monthIndex+1).toString().padStart(2,'0')}-20`
          })
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

    const confirmRes = await fetch('/api/update-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: data[0].ticker,
        strike: selectedStrike,
        expiry: expiryDate,
        currentCallPrice: data[0].currentCallPrice * (selectedStrike! / data[0].strike)
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
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded"
                >
                  🔄 UPDATE CURRENT CALL
                </button>
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
                <div className="p-1 bg-blue-700">{item.currentCallPrice.toFixed(2)}</div>
              </div>

              <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Future</div>
              {item.future.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1">
                    {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                    <span title={opt.expiry}>{opt.label} - {opt.price.toFixed(2)}</span>
                  </span>
                </div>
              ))}

              <div className="mt-2 mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Earlier</div>
              {item.earlier.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1">
                    {isFattibile(opt, item) && <span className="text-green-400">🟢</span>}
                    <span title={opt.expiry}>{opt.label} - {opt.price.toFixed(2)}</span>
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
