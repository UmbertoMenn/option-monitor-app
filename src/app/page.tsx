// src/app/page.tsx

'use client'

import React from 'react'

const mockData = [
  {
    ticker: 'NVDA',
    spot: 157.25,
    strike: 165,
    expiry: 'OCT 25',
    currentCallPrice: 11.2,
    earlier: [
      { label: 'Sep25 C160', price: 11.53, strike: 160 },
      { label: 'Sep25 C155', price: 14.2, strike: 155 },
    ],
    future: [
      { label: 'Nov25 C170', price: 12.05, strike: 170 },
      { label: 'Dec25 C175', price: 11.9, strike: 175 },
    ],
  },
  // Altri titoli qui...
]

export default function Page() {
  return (
    <main className="min-h-screen bg-black text-white p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {mockData.map((item, index) => {
        const deltaPct = ((item.strike - item.spot) / item.spot) * 100
        const deltaColor = deltaPct < 4 ? 'text-red-500' : 'text-green-500'
        const boxColor = 'bg-sky-500 text-white'

        const isFattibile = (opt: any) =>
          item.spot < opt.strike &&
          opt.strike >= item.spot * 1.04 &&
          opt.price >= item.currentCallPrice * 0.9

        return (
          <div key={index} className="bg-zinc-900 border border-zinc-800 shadow-xl rounded-xl p-4">
            <h2 className="text-xl font-bold mb-2 text-red-500">{item.ticker}</h2>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className={`p-2 ${boxColor}`}>Spot</div>
              <div className={`p-2 ${boxColor}`}>{item.spot.toFixed(2)}</div>

              <div className={`p-2 ${boxColor}`}>Strike</div>
              <div className={`p-2 ${boxColor}`}>{item.strike.toFixed(2)}</div>

              <div className={`p-2 ${boxColor}`}>Scadenza</div>
              <div className={`p-2 ${boxColor}`}>{item.expiry}</div>

              <div className="p-2 bg-sky-500 text-white">Δ% Strike/Spot</div>
              <div className={`p-2 ${deltaColor}`}>{deltaPct.toFixed(2)}%</div>

              <div className="p-2 bg-sky-500 text-white">Prezzo Call attuale</div>
              <div className="p-2 bg-sky-500 text-white">{item.currentCallPrice.toFixed(2)}</div>
            </div>

            <div className="mb-2 font-bold text-blue-400">Future</div>
            {item.future.map((opt, i) => (
              <div key={i} className="flex items-center justify-between mb-1">
                <span className={isFattibile(opt) ? 'text-green-400' : 'text-white'}>
                  {isFattibile(opt) && '🟢'} {opt.label} - {opt.price.toFixed(2)}
                </span>
                <div className="flex items-center gap-2">
                  <button className="bg-sky-400 text-white px-2 py-1 rounded text-sm">ROLLA</button>

                  <div className="flex flex-col items-center self-center">
                    <div className="text-xs text-white text-center leading-none mb-0.5">S</div>
                    <div className="flex gap-0.5">
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↑</button>
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↓</button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center self-center">
                    <div className="text-xs text-white text-center leading-none mb-0.5">M</div>
                    <div className="flex gap-0.5">
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↑</button>
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↓</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="mt-4 mb-2 font-bold text-blue-400">Earlier</div>
            {item.earlier.map((opt, i) => (
              <div key={i} className="flex items-center justify-between mb-1">
                <span className={isFattibile(opt) ? 'text-green-400' : 'text-white'}>
                  {isFattibile(opt) && '🟢'} {opt.label} - {opt.price.toFixed(2)}
                </span>
                <div className="flex items-center gap-2">
                  <button className="bg-sky-400 text-white px-2 py-1 rounded text-sm">ROLLA</button>

                  <div className="flex flex-col items-center self-center">
                    <div className="text-xs text-white text-center leading-none mb-0.5">S</div>
                    <div className="flex gap-0.5">
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↑</button>
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↓</button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center self-center">
                    <div className="text-xs text-white text-center leading-none mb-0.5">M</div>
                    <div className="flex gap-0.5">
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↑</button>
                      <button className="bg-zinc-800 text-white px-1 py-1 rounded text-sm">↓</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </main>
  )
}
