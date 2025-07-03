// src/app/page.tsx

'use client'

import React, { useEffect, useState } from 'react'

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  currentCallPrice: number
  earlier: { label: string; price: number; strike: number }[]
  future: { label: string; price: number; strike: number }[]
}

const fallbackData: OptionData[] = [
  {
    ticker: 'NVDA',
    spot: 157.25,
    strike: 165,
    expiry: 'OCT 25',
    currentCallPrice: 11.2,
    earlier: [
      { label: 'Sep25 C160', price: 9.5, strike: 160 },
      { label: 'Sep25 C155', price: 8.8, strike: 155 },
    ],
    future: [
      { label: 'Nov25 C170', price: 12.05, strike: 170 },
      { label: 'Dec25 C175', price: 11.9, strike: 175 },
    ],
  },
]

export default function Page() {
  const [data, setData] = useState<OptionData[]>(fallbackData)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/opzioni')
      if (!res.ok) throw new Error('Network response was not ok')
      const json = await res.json()
      if (Array.isArray(json)) {
        setData(json)
      } else {
        console.warn('Unexpected API response format, using fallback')
      }
    } catch (err) {
      console.error('Errore caricamento dati, uso fallback:', err instanceof Error ? err.message : err)
      setData(fallbackData)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const renderPriceWithDelta = (price: number, currentCallPrice: number, spot: number) => {
    const diffPct = ((price - currentCallPrice) / spot) * 100
    const color = diffPct >= 0 ? 'text-green-400' : 'text-red-400'
    const sign = diffPct >= 0 ? '+' : ''
    return (
      <>
        {price.toFixed(2)}{' '}
        <span
          className={color}
          title="Premio percentuale mensile aggiuntivo/riduttivo rispetto all'opzione attuale, diviso il prezzo spot del sottostante"
        >
          / {sign}{diffPct.toFixed(1)}%
        </span>
      </>
    )
  }

  const arrowButton = (direction: 'up' | 'down', label: string) => (
    <button
      className={`px-1 py-0.5 rounded text-xs ${
        direction === 'up' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
      title={label}
    >
      {direction === 'up' ? '↑' : '↓'}
    </button>
  )

  return (
    <div className="min-h-screen bg-black text-white p-2 flex flex-col gap-4 text-sm leading-tight">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.map((item, index) => {
          const deltaPct = ((item.strike - item.spot) / item.spot) * 100
          const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'
          const boxColor = 'bg-blue-700 text-white font-bold'

          const isFattibile = (opt: any) =>
            item.spot < opt.strike &&
            opt.strike >= item.spot * 1.04 &&
            opt.price >= item.currentCallPrice * 0.9

          return (
            <div key={index} className="bg-zinc-900 border border-zinc-800 shadow-md rounded-lg p-3">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-base font-bold text-red-500">{item.ticker}</h2>
                <div className="w-1/2 flex justify-end">
                  <button
                    onClick={fetchData}
                    className="w-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2 py-1 rounded text-left"
                    title="Aggiorna manualmente i dati dell'opzione in portafoglio"
                  >
                    🔄 UPDATE POSITION
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 mb-2">
                <div className={`p-1 ${boxColor}`}>Spot</div>
                <div className={`p-1 ${boxColor}`}>{item.spot.toFixed(2)}</div>

                <div className={`p-1 ${boxColor}`}>Strike</div>
                <div className={`p-1 ${boxColor}`}>{item.strike.toFixed(2)}</div>

                <div className={`p-1 ${boxColor}`}>Scadenza</div>
                <div className={`p-1 ${boxColor}`}>{item.expiry}</div>

                <div className={`${boxColor} p-1`}>Δ% Strike/Spot</div>
                <div className={`p-1 ${deltaColor} font-bold`}>{deltaPct.toFixed(2)}%</div>

                <div className={`${boxColor} p-1`}>Prezzo Call attuale</div>
                <div className={`${boxColor} p-1`}>{item.currentCallPrice.toFixed(2)}</div>
              </div>

              <div className="mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Future</div>
              {item.future.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1 text-white">
                    {isFattibile(opt) && <span className="text-green-400">🟢</span>}
                    <span>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="bg-blue-700 text-white font-bold px-1.5 py-0.5 rounded text-xs">ROLLA</button>
                    <div className="flex gap-0.5">
                      {arrowButton('up', 'Strike up')}
                      {arrowButton('down', 'Strike down')}
                    </div>
                    <div className="flex gap-0.5">
                      {arrowButton('up', 'Month up')}
                      {arrowButton('down', 'Month down')}
                    </div>
                  </div>
                </div>
              ))}

              <div className="mt-2 mb-1 font-semibold bg-orange-500 text-white text-center rounded py-0.5">Earlier</div>
              {item.earlier.map((opt, i) => (
                <div key={i} className="flex items-center justify-between mb-0.5">
                  <span className="flex items-center gap-1 text-white">
                    {isFattibile(opt) && <span className="text-green-400">🟢</span>}
                    <span>{opt.label} - {renderPriceWithDelta(opt.price, item.currentCallPrice, item.spot)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="bg-blue-700 text-white font-bold px-1.5 py-0.5 rounded text-xs">ROLLA</button>
                    <div className="flex gap-0.5">
                      {arrowButton('up', 'Strike up')}
                      {arrowButton('down', 'Strike down')}
                    </div>
                    <div className="flex gap-0.5">
                      {arrowButton('up', 'Month up')}
                      {arrowButton('down', 'Month down')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 text-white text-sm">
        <p className="text-center text-gray-400 italic">Spazio per strumenti aggiuntivi</p>
      </div>
    </div>
  )
}
