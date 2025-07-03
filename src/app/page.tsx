'use client'

import { useState } from 'react'

export default function Home() {
  const [ticker, setTicker] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/price?ticker=${ticker}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setData({ error: 'Errore di rete' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="p-10 min-h-screen bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-blue-800">📈 Prezzo in tempo reale (Polygon.io)</h1>
      
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="border border-gray-300 p-2 w-64 rounded shadow"
          placeholder="Es: AAPL, NVDA, TSLA"
        />
        <button
          onClick={fetchData}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
        >
          Cerca
        </button>
      </div>

      {loading && <p className="text-gray-600">⏳ Caricamento...</p>}

      {data?.ticker && (
        <div className="bg-white rounded shadow p-6 max-w-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">📊 {data.ticker}</h2>
          <p><strong>Ultimo prezzo:</strong> ${data.lastPrice}</p>
          <p><strong>Bid:</strong> ${data.bid}</p>
          <p><strong>Ask:</strong> ${data.ask}</p>
          <p><strong>Volume:</strong> {data.volume}</p>
        </div>
      )}

      {data?.error && (
        <div className="text-red-600 mt-4">
          <p>❌ Errore:</p>
          <pre className="bg-red-100 p-2 rounded mt-1 text-sm overflow-x-auto">
            {typeof data.error === 'string'
              ? data.error
              : JSON.stringify(data.error, null, 2)}
          </pre>
        </div>
      )}
    </main>
  )
}
