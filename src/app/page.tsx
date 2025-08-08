'use client'

import React, { useEffect, useState, useRef, useCallback, Fragment } from 'react'
import { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from './telegram';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '../lib/supabaseClient'; // Usa solo questo singleton
import debounce from 'lodash/debounce'; // Importazione corretta

// --- FUNZIONE HELPER CRUCIALE PER RISOLVERE L'ERRORE 401 ---
// Questa funzione esegue fetch includendo automaticamente il token di autenticazione Supabase.
const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
  try {
    // 1. Ottieni la sessione corrente (Supabase gestisce automaticamente il refresh del token se necessario)
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session) {
      console.error('Nessuna sessione attiva per authenticatedFetch:', error);
      // Simula una risposta 401 se non c'è sessione.
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // 2. Prepara gli header
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);

    // Assicurati che Content-Type sia impostato se si invia un body JSON (comune per POST/PUT)
    if (!headers.has('Content-Type')) {
      if (options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }
    }

    console.log('[AUTH-FETCH] Calling', url, 'at', new Date().toISOString());
    return fetch(url, {
      ...options,
      headers,
    });

  } catch (err) {
    console.error('Errore durante authenticatedFetch:', err);
    // Gestisci errori imprevisti durante la preparazione della fetch
    return new Response(JSON.stringify({ error: 'Internal Client Error' }), { status: 500 });
  }
};
// -------------------------------------------------------------

function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0')
}

// Funzione Pura
function getSymbolFromExpiryStrike(ticker: string, expiry: string, strike: number): string {
  if (!expiry || !ticker || strike <= 0) return ''; // Safeguard
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

// Funzione Pura
function getThirdFriday(year: number, monthIndex: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, monthIndex - 1, day)  // -1 per mese 0-11
    if (date.getMonth() !== monthIndex - 1) break
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
  // Fallback approssimativo
  return `${year}-${String(monthIndex).padStart(2, '0')}-15`
}


function isMarketOpen(): boolean {
  try {
    const now = new Date();

    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'America/New_York', // Fuso orario di riferimento per i mercati USA
      weekday: 'long',
      hour: 'numeric',
      hour12: false,
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);

    let day = '';
    let hour = -1;

    for (const part of parts) {
      if (part.type === 'weekday') day = part.value;
      // Gestione robusta dell'ora, considerando che '24' può essere restituito
      if (part.type === 'hour') hour = part.value === '24' ? 0 : parseInt(part.value, 10);
    }

    if (day === '' || hour === -1) return false;

    // Controlla se è un giorno feriale
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const isWeekday = weekdays.includes(day);

    // Controlla se l'ora rientra nel pre-market e nella sessione regolare (9:00 AM - 4:00 PM ET)
    // hour < 16 significa "fino alle 15:59"
    const isMarketHours = hour >= 5 && hour < 16;

    return isWeekday && isMarketHours;

  } catch (error) {
    console.error("Errore nel determinare l'orario di mercato:", error);
    return false; // In caso di errore, meglio non fare chiamate API
  }
}

type PricesType = Record<string, Record<string, { bid: number; ask: number; last_trade_price: number; symbol: string }>>;

// Definizione dei Props per MemoizedTickerCard
interface TickerCardProps {
  item: OptionData;
  prices: PricesType;
  setPrices: React.Dispatch<React.SetStateAction<PricesType>>;
  isFattibile: (opt: OptionEntry, item: OptionData) => boolean;
  setPendingRoll: React.Dispatch<React.SetStateAction<{ ticker: string, opt: OptionEntry } | null>>;
  selected: { [ticker: string]: { year: string, month: string, strike: number | null } };
  setSelected: React.Dispatch<React.SetStateAction<{ [ticker: string]: { year: string, month: string, strike: number | null } }>>;
  showDropdowns: { [ticker: string]: boolean };
  setShowDropdowns: React.Dispatch<React.SetStateAction<{ [ticker: string]: boolean }>>;
  alertsEnabled: { [ticker: string]: boolean };
  setAlertsEnabled: React.Dispatch<React.SetStateAction<{ [ticker: string]: boolean }>>;
  sentAlerts: React.MutableRefObject<{ [ticker: string]: { [level: string]: boolean } }>;
  chain: Record<string, Record<string, Record<string, number[]>>>;
  updateCurrentCall: (ticker: string) => Promise<void>;
  shiftExpiryByMonth: (ticker: string, opt: OptionEntry, direction: 'next' | 'prev', type: 'future' | 'earlier') => OptionEntry | null;
  data: OptionData[];
  setData: React.Dispatch<React.SetStateAction<OptionData[]>>;
  setChain: React.Dispatch<React.SetStateAction<Record<string, Record<string, Record<string, number[]>>>>>;
  spots: Record<string, { price: number; change_percent: number }>;
  supabaseClient: SupabaseClient<any, "public", any>;
}

const MemoizedTickerCard = React.memo((props: TickerCardProps) => {
  const {
    item, prices, setPrices, isFattibile, setPendingRoll, selected, setSelected,
    showDropdowns, setShowDropdowns, alertsEnabled, setAlertsEnabled, sentAlerts,
    chain, updateCurrentCall, shiftExpiryByMonth, data, setData, setChain, spots, supabaseClient
  } = props;

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

  // Logica di visualizzazione prezzi
  const currentBidToShow = currentData.bid ?? 0
  const currentAskToShow = (currentData.ask ?? 0) > 0 ? (currentData.ask ?? 0) : (currentData.last_trade_price ?? 0)

  // Dati Spot e variazione percentuale
  const spotData = spots[ticker] || { price: 0, change_percent: 0 };
  // Assicurati che change_percent sia un numero valido
  const change_percent = typeof spotData.change_percent === 'number' ? spotData.change_percent : 0;
  const changeColor = change_percent >= 0 ? 'text-green-300' : 'text-red-300';
  const changeSign = change_percent >= 0 ? '+' : '';

  console.log(`Ticker: ${item.ticker}, Expiry: ${item.expiry}, Item:`, item);

  return (
    <div className="bg-zinc-900 border border-red-500 shadow-md rounded-lg p-3">
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-base font-bold text-red-400">{item.ticker}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAlertsEnabled((prev: { [ticker: string]: boolean }) => {
                const next = { ...prev, [ticker]: !prev[ticker] };

                // *** CORREZIONE 401: Usa authenticatedFetch ***
                authenticatedFetch('/api/alerts', {
                  method: 'POST',
                  body: JSON.stringify({ ticker, enabled: next[ticker] }),
                }).catch(err => console.error('Errore update alert:', err));
                // ***************************************

                if (next[ticker]) {
                  const delta = Math.abs((item.strike - item.spot) / item.spot) * 100
                  const newSent: { [level: string]: boolean } = {} // Chiavi come stringhe
                  const levels = [4, 3, 2, 1]
                  for (const level of levels) {
                    if (delta >= level) newSent[level.toString()] = true
                  }
                  const highLevels = [7, 8, 9, 10]
                  for (const level of highLevels) {
                    if (delta <= level) newSent[level.toString()] = true
                  }
                  sentAlerts.current[ticker] = newSent
                } else {
                  sentAlerts.current[ticker] = {}

                  // Pulisci i record di alert inviati quando si disattivano gli alert
                  const deleteAlerts = async () => {
                    // Richiede Policy RLS su 'alerts_sent' per DELETE basata su user_id
                    const { error } = await supabaseClient
                      .from('alerts_sent')
                      .delete()
                      .eq('ticker', ticker);

                    if (error) {
                      console.error('Errore delete alerts_sent:', error);
                    }
                  };
                  deleteAlerts();
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
                // *** CORREZIONE 401: Usa authenticatedFetch ***
                const res = await authenticatedFetch(`/api/chain?ticker=${ticker}`);
                // ***************************************
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
          {/* Dropdowns Anno, Mese, Strike */}
          <select
            value={sel.year}
            onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
            className="bg-zinc-800 text-white p-1 rounded"
          >
            <option value="">Anno</option>
            {Object.keys(tickerChain).sort().map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select
            value={sel.month}
            onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
            className="bg-zinc-800 text-white p-1 rounded"
            disabled={!sel.year}
          >
            <option value="">Mese</option>
            {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            value={sel.strike ?? ''}
            onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
            className="bg-zinc-800 text-white p-1 rounded"
            disabled={!sel.month}
          >
            <option value="">Strike</option>
            {sel.year && sel.month && (tickerChain[sel.year]?.[sel.month] || []).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {Object.keys(tickerChain).length === 0 && (
            <div className="col-span-3 text-red-500 text-xs mt-1">
              Nessuna scadenza disponibile. Verifica console per errori o se il ticker ha opzioni. Prova a rimuovere e riaggiungere il ticker.
            </div>
          )}

          <button
            onClick={() => updateCurrentCall(ticker)}
            disabled={!sel.year || !sel.month || !sel.strike}
            className="col-span-3 mt-1 bg-green-700 hover:bg-green-800 disabled:bg-gray-600 text-white text-xs font-medium px-2 py-1 rounded"
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
            ({changeSign}{change_percent.toFixed(2)}%)
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

      {/* Refactoring: Unificazione sezioni Future e Earlier per ridurre duplicazione codice */}
      {['Future', 'Earlier'].map(sectionType => (
        <Fragment key={sectionType}>
          <div className="mb-1 font-semibold bg-gray-800 text-orange-500 text-center rounded py-0.5">{sectionType}</div>
          {(sectionType === 'Future' ? item.future : item.earlier).map((opt, i) => {
            const optPriceData = tickerPrices[opt.symbol]
            // Calcolo prezzo Bid (Bid o Last se Bid è 0)
            const optBid = (optPriceData?.bid ?? opt.bid ?? 0) > 0 ? (optPriceData?.bid ?? opt.bid ?? 0) : (optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0)
            const optAsk = optPriceData?.ask ?? opt.ask ?? 0

            // Calcolo Delta Premio % rispetto a Spot
            const delta = item.spot > 0 ? ((optBid - currentAskToShow) / item.spot) * 100 : 0;
            const deltaColor_opt = delta >= 0 ? 'text-green-400' : 'text-red-400'
            const deltaSign = delta >= 0 ? '+' : ''
            const fattibile = isFattibile(opt, item);

            return (
              <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-1 gap-1 sm:gap-0">
                <span className="flex items-center gap-1">
                  <span title={opt.expiry}>
                    <span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{opt.label}</span>
                    <span className="bg-zinc-800 px-2 py-1 rounded border border-red-400">{optBid.toFixed(2)} / {optAsk.toFixed(2)}</span>
                    {optPriceData && (
                      <span title="Premio aggiuntivo/riduttivo rispetto alla call attuale, diviso il prezzo spot" className={`ml-1 ${deltaColor_opt}`}>
                        {deltaSign}{delta.toFixed(2)}%
                      </span>
                    )}
                    {fattibile && (
                      <span className="text-green-400" title="Fattibile: strike ≥ spot + 4%, prezzo ≥ prezzo call attuale">🟢</span>)}
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

                  {/* Pulsanti di aggiustamento (Strike Up/Down, Month Back/Forward) */}
                  <button
                    title="Strike Up"
                    className="bg-green-700 hover:bg-green-800 text-white text-xs px-1 rounded"
                    onClick={async () => {
                      // Logica Strike Up
                      let expiry = opt.expiry;
                      let strike = opt.strike;
                      const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

                      // Gestione Fallback se l'opzione è inesistente (utilizzando helper esterno)
                      if (opt.label === 'OPZIONE INESISTENTE' || expiry === '') {
                        const fallback = findFirstAvailableExpiry(chain[item.ticker]);
                        if (!fallback) {
                          alert('Nessuna scadenza disponibile nel chain per questo ticker.');
                          return;
                        }
                        expiry = fallback.expiry;
                        strike = fallback.strikes[0]; // Inizia dal basso
                      }

                      const [year, month] = expiry.split('-');
                      const monthIndex = Number(month) - 1;
                      const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || [];
                      const nextStrike = chainStrikes.find((s: number) => s > strike);

                      if (!nextStrike) return;

                      const newSymbol = getSymbolFromExpiryStrike(item.ticker, expiry, nextStrike);

                      // *** CORREZIONE 401: Usa authenticatedFetch ***
                      const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`);
                      // ***************************************

                      let newData = await processPriceResponse(res, newSymbol, item.ticker, setPrices);

                      const updatedOpt = {
                        ...opt,
                        strike: nextStrike,
                        label: `${monthNames[monthIndex]} ${year.slice(2)} C${nextStrike}`,
                        symbol: newSymbol,
                        bid: newData.bid,
                        ask: newData.ask,
                        last_trade_price: newData.last_trade_price,
                        expiry
                      };

                      updateOptionData(item.ticker, sectionType, i, updatedOpt, setData);
                      // saveState utilizza internamente authenticatedFetch
                      saveState(item.ticker, data);
                    }}
                  >
                    🔼
                  </button>

                  <button
                    title="Strike Down"
                    className="bg-red-700 hover:bg-red-800 text-white text-xs px-1 rounded"
                    onClick={async () => {
                      // Logica Strike Down
                      let expiry = opt.expiry;
                      let strike = opt.strike;
                      const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

                      // Gestione Fallback
                      if (opt.label === 'OPZIONE INESISTENTE' || expiry === '') {
                        const fallback = findFirstAvailableExpiry(chain[item.ticker]);
                        if (!fallback) {
                          alert('Nessuna scadenza disponibile nel chain per questo ticker.');
                          return;
                        }
                        expiry = fallback.expiry;
                        strike = fallback.strikes[fallback.strikes.length - 1]; // Inizia dall'alto
                      }

                      const [year, month] = expiry.split('-');
                      const monthIndex = Number(month) - 1;
                      const chainStrikes = chain[item.ticker]?.[year]?.[monthNames[monthIndex]] || [];
                      const prevStrike = [...chainStrikes].reverse().find((s: number) => s < strike);

                      if (!prevStrike) return;

                      const newSymbol = getSymbolFromExpiryStrike(item.ticker, expiry, prevStrike);

                      // *** CORREZIONE 401: Usa authenticatedFetch ***
                      const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`);
                      // ***************************************

                      let newData = await processPriceResponse(res, newSymbol, item.ticker, setPrices);

                      const updatedOpt = {
                        ...opt,
                        strike: prevStrike,
                        label: `${monthNames[monthIndex]} ${year.slice(2)} C${prevStrike}`,
                        symbol: newSymbol,
                        bid: newData.bid,
                        ask: newData.ask,
                        last_trade_price: newData.last_trade_price,
                        expiry
                      };

                      updateOptionData(item.ticker, sectionType, i, updatedOpt, setData);
                      saveState(item.ticker, data);
                    }}
                  >
                    🔽
                  </button>
                  <button
                    title="Month Back"
                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                    onClick={async () => {
                      const shift = shiftExpiryByMonth(item.ticker, opt, 'prev', sectionType === 'Future' ? 'future' : 'earlier')
                      if (!shift) return

                      const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)

                      // *** CORREZIONE 401: Usa authenticatedFetch ***
                      const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`)
                      // ***************************************

                      let newData = await processPriceResponse(res, newSymbol, item.ticker, setPrices);

                      const updatedOpt = {
                        ...opt,
                        ...shift, // Sovrascrive label, expiry, strike
                        symbol: newSymbol,
                        bid: newData.bid,
                        ask: newData.ask,
                        last_trade_price: newData.last_trade_price
                      }

                      updateOptionData(item.ticker, sectionType, i, updatedOpt, setData);
                      saveState(item.ticker, data);
                    }}
                  >
                    ◀️
                  </button>
                  <button
                    title="Month Forward"
                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-1 rounded"
                    onClick={async () => {
                      const shift = shiftExpiryByMonth(item.ticker, opt, 'next', sectionType === 'Future' ? 'future' : 'earlier')
                      if (!shift) return

                      const newSymbol = getSymbolFromExpiryStrike(item.ticker, shift.expiry, shift.strike)

                      // *** CORREZIONE 401: Usa authenticatedFetch ***
                      const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`)
                      // ***************************************

                      let newData = await processPriceResponse(res, newSymbol, item.ticker, setPrices);

                      const updatedOpt = {
                        ...opt,
                        ...shift,
                        symbol: newSymbol,
                        bid: newData.bid,
                        ask: newData.ask,
                        last_trade_price: newData.last_trade_price
                      }

                      updateOptionData(item.ticker, sectionType, i, updatedOpt, setData);
                      saveState(item.ticker, data);
                    }}
                  >
                    ▶️
                  </button>
                </div>
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
});

// --- Funzioni Helper Esterne (per evitare ricreazioni nei render di MemoizedTickerCard) ---

// Helper per trovare la prima scadenza disponibile nella chain
const findFirstAvailableExpiry = (tickerChain: Record<string, Record<string, number[]>>) => {
  if (!tickerChain) return null;
  const years = Object.keys(tickerChain).sort();
  if (years.length === 0) return null;

  const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

  for (const year of years) {
    // Ordina i mesi correttamente
    const months = Object.keys(tickerChain[year]).sort((a, b) => monthNames.indexOf(a) - monthNames.indexOf(b));
    for (const month of months) {
      const strikes = tickerChain[year][month] || [];
      if (strikes.length > 0) {
        const monthIndex = monthNames.indexOf(month);
        const expiry = getThirdFriday(Number(year), monthIndex + 1);
        return { expiry, strikes };
      }
    }
  }
  return null;
};

// Helper per processare la risposta dei prezzi e aggiornare lo stato
const processPriceResponse = async (res: Response, symbol: string, ticker: string, setPrices: React.Dispatch<React.SetStateAction<PricesType>>) => {
  let newData = { bid: 0, ask: 0, last_trade_price: 0 };
  if (res.ok) {
    const json = await res.json();
    newData = json[symbol] || { bid: 0, ask: 0, last_trade_price: 0 };
    setPrices((prev: PricesType) => ({
      ...prev,
      [ticker]: { ...prev[ticker], [symbol]: { ...newData, symbol: symbol } }
    }));
  }
  return newData;
};

// Helper per aggiornare lo stato 'data' in modo immutabile
const updateOptionData = (ticker: string, sectionType: string, index: number, updatedOpt: OptionEntry, setData: React.Dispatch<React.SetStateAction<OptionData[]>>) => {
  setData(prevData => prevData.map(d => {
    if (d.ticker !== ticker) return d;
    if (sectionType === 'Future') {
      const newFuture = [...d.future];
      newFuture[index] = updatedOpt;
      return { ...d, future: newFuture };
    } else {
      const newEarlier = [...d.earlier];
      newEarlier[index] = updatedOpt;
      return { ...d, earlier: newEarlier };
    }
  }));
};

// Helper per salvare lo stato sul server (Usa authenticatedFetch)
const saveState = (ticker: string, currentData: OptionData[]) => {
  const itemData = currentData.find(d => d.ticker === ticker);
  if (!itemData) return;

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  authenticatedFetch('/api/save-state', {
    method: 'POST',
    body: JSON.stringify({
      ticker: ticker,
      future: itemData.future || [],
      earlier: itemData.earlier || []
    })
  }).catch(err => console.error('Errore salvataggio stato:', err));
  // ***************************************
};

// ------------------------------------------------------------------------------------


export default function Page(): JSX.Element {
  const [tickers, setTickers] = useState<string[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [data, setData] = useState<OptionData[]>([])
  const [chain, setChain] = useState<Record<string, Record<string, Record<string, number[]>>>>({})
  const [prices, setPrices] = useState<PricesType>({})
  const [spots, setSpots] = useState<Record<string, { price: number; change_percent: number }>>({});
  const [selected, setSelected] = useState<{ [ticker: string]: { year: string, month: string, strike: number | null } }>({})
  const [showDropdowns, setShowDropdowns] = useState<{ [ticker: string]: boolean }>({})
  const sentAlerts = useRef<{ [ticker: string]: { [level: string]: boolean } }>({});
  const [alertsEnabled, setAlertsEnabled] = useState<{ [ticker: string]: boolean }>({})
  const [pendingRoll, setPendingRoll] = useState<{ ticker: string, opt: OptionEntry } | null>(null)
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true); // Stato di caricamento iniziale
  const router = useRouter();

  const dataRef = useRef<OptionData[]>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const fetchTickers = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/tickers')
      if (!res.ok) {
        if (res.status === 401) {
          console.error('Sessione non valida (401) durante fetchTickers.');
          // Potrebbe essere utile forzare il logout o il refresh della sessione
        }
        throw new Error(`Errore fetch tickers: ${res.status}`);
      }
      const json = await res.json()
      setTickers(json)
    } catch (err) {
      console.error('Errore fetch tickers', err)
    }
  }, []);
  // ***************************************

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/alerts');
      if (res.ok) {
        const json = await res.json();
        setAlertsEnabled(json);
      } else if (res.status !== 401) {
        console.error('Errore fetch alerts:', res.status);
      }
    } catch (err) {
      console.error('Errore fetch alerts:', err);
    }
  }, []);
  // ***************************************

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const fetchData = useCallback(async () => {
    const now = new Date().toISOString();
    console.log(`[FETCH-DATA] Inizio fetch a ${now}`);
    try {
      const res = await authenticatedFetch('/api/options');
      if (res.ok) {
        const json = await res.json();
        console.log('Response raw da /api/options:', json);
        if (Array.isArray(json)) setData(json);
      } else if (res.status !== 401) {
        console.error('Errore fetch /api/options:', res.status);
      }
    } catch (err) {
      console.error('Errore fetch /api/options', err);
    } finally {
      console.log(`[FETCH-DATA] Fine fetch a ${now}`);
    }
  }, []);


  // ***************************************

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const fetchChain = useCallback(async () => {
    try {
      const chains: Record<string, Record<string, Record<string, number[]>>> = {}
      for (const t of tickers) {
        try {
          const res = await authenticatedFetch(`/api/chain?ticker=${t}`);
          if (!res.ok) {
            console.error(`Error fetching chain for ${t}: status ${res.status}`);
            chains[t] = {}; // Fallback vuoto
            continue;
          }
          const json = await res.json();
          chains[t] = json;
          if (Object.keys(json).length === 0) {
            console.warn(`No chain data for ${t} - verify ticker has OPRA options on Polygon`);
          }
        } catch (err) {
          console.error(`Exception during chain fetch for ${t}:`, err);
          chains[t] = {};
        }
      }
      setChain(chains);
    } catch (err) {
      console.error('Global error in fetchChain:', err);
    }
  }, [tickers]);
  // ***************************************

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const fetchPrices = useCallback(async () => {
    console.log('[FETCH-PRICES] Inizio esecuzione');
    try {
      let symbols: string[] = [];
      dataRef.current.forEach(item => {
        if (!item || item.invalid) return;

        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
        if (currentSymbol) symbols.push(currentSymbol);

        item.earlier.forEach(opt => {
          if (opt.symbol) symbols.push(opt.symbol);
        });
        item.future.forEach(opt => {
          if (opt.symbol) symbols.push(opt.symbol);
        });
      });

      // Filtra unici e non vuoti
      symbols = [...new Set(symbols.filter(s => s && s.trim() !== ''))];

      if (symbols.length === 0) {
        console.log('[FETCH-PRICES] Nessun symbol valido, skip');
        return;
      }

      const url = `/api/full-prices?symbols=${encodeURIComponent(symbols.join(','))}`;
      const res = await authenticatedFetch(url);

      if (!res.ok) {
        console.error(`Error fetching prices: ${res.status}`);
        return;
      }
      const json = await res.json();

      // Raggruppa i prezzi per ticker
      const grouped: PricesType = {};
      for (const [symbol, val] of Object.entries(json)) {
        // Regex robusta per estrarre il ticker (es. O:AAPL... -> AAPL). Supporta anche ticker con punti (es. BRK.A)
        const match = /^O:([A-Z\.]+)[\d]{6}C[\d]{8}$/.exec(symbol);
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

      // Fetch degli Spots
      const tickersList = dataRef.current.map(item => item.ticker).filter(t => t);
      if (tickersList.length > 0) {
        const tickersStr = tickersList.join(',');
        const spotRes = await authenticatedFetch(`/api/spots?tickers=${tickersStr}`);
        if (spotRes.ok) {
          const newSpots = await spotRes.json();
          setSpots(newSpots);
        } else {
          console.error('Error fetching spots:', spotRes.status);
        }
      }
    } catch (err) {
      console.error('Errore fetch /api/full-prices o /api/spots:', err);
    } finally {
      console.log('[FETCH-PRICES] Fine esecuzione');
    }
  }, []); // Rimossa dipendenza [data], usa dataRef.current
  // ***************************************

  const shiftExpiryByMonth = useCallback((ticker: string, opt: OptionEntry, direction: 'next' | 'prev', type: 'future' | 'earlier'): OptionEntry | null => {
    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
    const tickerChain = chain[ticker] || {};

    // Trova la current call per fallback
    const currentItem = data.find((item) => item.ticker === ticker);
    if (!currentItem) {
      console.error(`❌ shiftExpiryByMonth: Nessun item trovato per ticker ${ticker}`);
      return null;
    }
    const currentExpiry = currentItem.expiry;
    const currentStrike = currentItem.strike;

    let targetExpiry = opt.expiry;
    let targetStrike = opt.strike;

    // Gestione opzione inesistente o chain vuota: fallback diretto a current call
    if (opt.label === 'OPZIONE INESISTENTE' || !opt.expiry || Object.keys(tickerChain).length === 0) {
      console.warn(`⚠️ shiftExpiryByMonth: Opzione inesistente o chain vuota per ${ticker}, fallback diretto a current call ${currentExpiry} C${currentStrike}`);
      const symbol = getSymbolFromExpiryStrike(ticker, currentExpiry, currentStrike);
      const optPrices = prices[ticker]?.[symbol] ?? { bid: currentItem.current_bid, ask: currentItem.current_ask, last_trade_price: currentItem.current_last_trade_price };
      const newOption = {
        label: `${monthNames[Number(currentExpiry.split('-')[1]) - 1]} ${currentExpiry.split('-')[0].slice(2)} C${currentStrike}`,
        symbol,
        expiry: currentExpiry,
        strike: currentStrike,
        bid: optPrices.bid,
        ask: optPrices.ask,
        last_trade_price: optPrices.last_trade_price,
      };

      // Salva su Supabase
      const saveNewState = async () => {
        try {
          const updatedItem = {
            ...currentItem,
            [type]: currentItem[type].map((o: OptionEntry, index: number) =>
              index === (opt.label === currentItem[type][0].label ? 0 : 1) ? newOption : o
            ),
          };
          const res = await authenticatedFetch('/api/save-state', {
            method: 'POST',
            body: JSON.stringify({
              ticker,
              future: updatedItem.future,
              earlier: updatedItem.earlier,
            }),
          });

          if (!res.ok) {
            console.error('Errore salvataggio shift su Supabase:', res.status);
          } else {
            console.log('Salvato shift su Supabase per', ticker);
          }
        } catch (err) {
          console.error('Eccezione salvataggio shift:', err);
        }
      };
      saveNewState();

      // Aggiorna stato locale
      setData(prev => prev.map(d => d.ticker === ticker ? {
        ...d,
        [type]: d[type].map((o: OptionEntry, index: number) =>
          index === (opt.label === d[type][0].label ? 0 : 1) ? newOption : o
        ),
      } : d));

      return newOption;
    }

    const [yearStr, monthStr] = targetExpiry.split('-');
    let year = Number(yearStr);
    let monthIdx = Number(monthStr); // 1-based

    let attempts = 0;
    const maxAttempts = 60; // Cerca per massimo 5 anni

    while (attempts < maxAttempts) {
      attempts++;
      // Sposta il mese/anno
      if (direction === 'next') {
        monthIdx++;
        if (monthIdx > 12) {
          monthIdx = 1;
          year++;
        }
      } else {
        monthIdx--;
        if (monthIdx < 1) {
          monthIdx = 12;
          year--;
        }
      }

      if (year < new Date().getFullYear() - 5 || year > new Date().getFullYear() + 10) break;

      const monthName = monthNames[monthIdx - 1];
      const yearKey = year.toString();

      if (!tickerChain[yearKey] || !tickerChain[yearKey][monthName]) {
        console.log(`ℹ️ shiftExpiryByMonth: Nessuna chain per ${yearKey}/${monthName}, continuo`);
        continue;
      }

      const strikes = tickerChain[yearKey][monthName];
      if (strikes.length === 0) {
        console.log(`ℹ️ shiftExpiryByMonth: Nessun strike per ${yearKey}/${monthName}, continuo`);
        continue;
      }

      // Trova strike più vicino al currentStrike (per evitare lontani)
      let targetStrikeNew = strikes.reduce((prev, curr) => {
        return Math.abs(curr - currentStrike) < Math.abs(prev - currentStrike) ? curr : prev;
      }, strikes[0]);

      if (!targetStrikeNew) {
        console.log(`ℹ️ shiftExpiryByMonth: Nessun targetStrike valido per ${yearKey}/${monthName}, continuo`);
        continue;
      }

      // Trovata l'opzione valida
      const expiry = getThirdFriday(year, monthIdx);
      const symbol = getSymbolFromExpiryStrike(ticker, expiry, targetStrikeNew);
      const optPrices = prices[ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };
      const newOption = {
        label: `${monthName} ${String(year).slice(2)} C${targetStrikeNew}`,
        symbol,
        expiry,
        strike: targetStrikeNew,
        bid: optPrices.bid,
        ask: optPrices.ask,
        last_trade_price: optPrices.last_trade_price,
      };

      console.log(`✅ shiftExpiryByMonth: Trovata opzione valida ${monthName} ${year} C${targetStrikeNew} per ${ticker}`);

      // Salva su Supabase
      const saveNewState = async () => {
        try {
          const updatedItem = {
            ...currentItem,
            [type]: currentItem[type].map((o: OptionEntry, index: number) =>
              index === (opt.label === currentItem[type][0].label ? 0 : 1) ? newOption : o
            ),
          };
          const res = await authenticatedFetch('/api/save-state', {
            method: 'POST',
            body: JSON.stringify({
              ticker,
              future: updatedItem.future,
              earlier: updatedItem.earlier,
            }),
          });

          if (!res.ok) {
            console.error('Errore salvataggio shift su Supabase:', res.status);
          } else {
            console.log('Salvato shift su Supabase per', ticker);
          }
        } catch (err) {
          console.error('Eccezione salvataggio shift:', err);
        }
      };
      saveNewState();

      // Aggiorna stato locale
      setData(prev => prev.map(d => d.ticker === ticker ? {
        ...d,
        [type]: d[type].map((o: OptionEntry, index: number) =>
          index === (opt.label === d[type][0].label ? 0 : 1) ? newOption : o
        ),
      } : d));

      return newOption;
    }

    // Fallback finale a current call se niente trovato
    console.warn(`⚠️ shiftExpiryByMonth: Nessuna scadenza ${direction} trovata per ${ticker}, fallback a current call`);
    const symbol = getSymbolFromExpiryStrike(ticker, currentExpiry, currentStrike);
    const optPrices = prices[ticker]?.[symbol] ?? { bid: currentItem.current_bid, ask: currentItem.current_ask, last_trade_price: currentItem.current_last_trade_price };
    const newOption = {
      label: `${monthNames[Number(currentExpiry.split('-')[1]) - 1]} ${currentExpiry.split('-')[0].slice(2)} C${currentStrike}`,
      symbol,
      expiry: currentExpiry,
      strike: currentStrike,
      bid: optPrices.bid,
      ask: optPrices.ask,
      last_trade_price: optPrices.last_trade_price,
    };

    // Salva su Supabase
    const saveNewState = async () => {
      try {
        const updatedItem = {
          ...currentItem,
          [type]: currentItem[type].map((o: OptionEntry, index: number) =>
            index === (opt.label === currentItem[type][0].label ? 0 : 1) ? newOption : o
          ),
        };
        const res = await authenticatedFetch('/api/save-state', {
          method: 'POST',
          body: JSON.stringify({
            ticker,
            future: updatedItem.future,
            earlier: updatedItem.earlier,
          }),
        });

        if (!res.ok) {
          console.error('Errore salvataggio shift su Supabase:', res.status);
        } else {
          console.log('Salvato shift su Supabase per', ticker);
        }
      } catch (err) {
        console.error('Eccezione salvataggio shift:', err);
      }
    };
    saveNewState();

    // Aggiorna stato locale
    setData(prev => prev.map(d => d.ticker === ticker ? {
      ...d,
      [type]: d[type].map((o: OptionEntry, index: number) =>
        index === (opt.label === d[type][0].label ? 0 : 1) ? newOption : o
      ),
    } : d));

    return newOption;
  }, [chain, prices, data, setData]);

  // Funzione di utilità per calcolare Future/Earlier basandosi su una nuova selezione
  // Nota: Questa funzione è stata estratta da updateCurrentCall e handleRollaClick per de-duplicare la logica.
  const calculateFutureEarlier = useCallback((ticker: string, selectedYear: number, selectedMonthIndex: number, selectedStrike: number) => {
    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
    const tickerChain = chain[ticker] || {};
    let future: OptionEntry[] = [];
    let earlier: OptionEntry[] = [];

    // Calcolo FUTURE
    let monthIdx = selectedMonthIndex; // 0-based
    let year = selectedYear;
    let strikeRef = selectedStrike;
    const allFutureMonths: { monthIdx: number, year: number }[] = [];
    let attempts = 0;
    const maxAttempts = 60;

    while (allFutureMonths.length < 2 && attempts < maxAttempts) {
      attempts++;
      monthIdx++;
      if (monthIdx >= 12) {
        monthIdx = 0;
        year++;
      }
      const futureMonth = monthNames[monthIdx];
      const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || [];
      if (fStrikeList.length > 0) {
        allFutureMonths.push({ monthIdx, year });
      }
    }

    for (let i = 0; i < Math.min(2, allFutureMonths.length); i++) {
      const { monthIdx, year } = allFutureMonths[i];
      const futureMonth = monthNames[monthIdx];
      const fStrikeList = tickerChain[year.toString()]?.[futureMonth] || [];
      let fStrike = fStrikeList.find((s: number) => s > strikeRef) ||
        fStrikeList.find((s: number) => s === strikeRef) ||
        fStrikeList[fStrikeList.length - 1];

      if (fStrike) {
        const expiry = getThirdFriday(year, monthIdx + 1);
        const symbol = getSymbolFromExpiryStrike(ticker, expiry, fStrike);
        if (symbol) {
          const optPrices = prices[ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };
          future.push({
            label: `${futureMonth} ${String(year).slice(2)} C${fStrike}`,
            symbol,
            strike: fStrike,
            bid: optPrices.bid,
            ask: optPrices.ask,
            last_trade_price: optPrices.last_trade_price,
            expiry
          });
          strikeRef = fStrike;
        }
      }
    }

    // Calcolo EARLIER
    monthIdx = selectedMonthIndex;
    year = selectedYear;
    strikeRef = selectedStrike;
    const allEarlierMonths: { monthIdx: number, year: number }[] = [];
    attempts = 0;

    while (allEarlierMonths.length < 1 && attempts < maxAttempts) {
      attempts++;
      monthIdx--;
      if (monthIdx < 0) {
        monthIdx = 11;
        year--;
      }
      if (year < 2000) break; // Limite inferiore ragionevole

      const earlierMonth = monthNames[monthIdx];
      const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || [];
      if (eStrikeList.length > 0) {
        allEarlierMonths.push({ monthIdx, year });
      }
    }

    if (allEarlierMonths.length > 0) {
      const { monthIdx, year } = allEarlierMonths[0];
      const earlierMonth = monthNames[monthIdx];
      const eStrikeList = tickerChain[year.toString()]?.[earlierMonth] || [];

      let eStrike1 = [...eStrikeList].reverse().find((s: number) => s < strikeRef) ||
        eStrikeList.find((s: number) => s === strikeRef) ||
        eStrikeList[0];

      if (eStrike1) {
        const expiry = getThirdFriday(year, monthIdx + 1);
        const symbol = getSymbolFromExpiryStrike(ticker, expiry, eStrike1);
        if (symbol) {
          const optPrices = prices[ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };
          earlier.push({
            label: `${earlierMonth} ${String(year).slice(2)} C${eStrike1}`,
            symbol,
            strike: eStrike1,
            bid: optPrices.bid,
            ask: optPrices.ask,
            last_trade_price: optPrices.last_trade_price,
            expiry
          });
          strikeRef = eStrike1; // Aggiorna strikeRef per la seconda earlier
        }
      }

      // Seconda Earlier
      if (eStrike1) {
        let eStrike2 = [...eStrikeList].reverse().find((s: number) => s < strikeRef);

        // Se non trova uno strike inferiore, prende il primo disponibile se diverso dal primo
        if (!eStrike2 && eStrikeList.length > 0) {
          eStrike2 = eStrikeList[0];
        }

        if (eStrike2 && eStrike2 !== eStrike1) {
          const expiry = getThirdFriday(year, monthIdx + 1);
          const symbol = getSymbolFromExpiryStrike(ticker, expiry, eStrike2);
          if (symbol) {
            const optPrices = prices[ticker]?.[symbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };
            earlier.push({
              label: `${earlierMonth} ${String(year).slice(2)} C${eStrike2}`,
              symbol,
              strike: eStrike2,
              bid: optPrices.bid,
              ask: optPrices.ask,
              last_trade_price: optPrices.last_trade_price,
              expiry
            });
          }
        }
      }
    }

    while (future.length < 2) future.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });
    while (earlier.length < 2) earlier.push({ label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' });

    return { future, earlier };
  }, [chain, prices]);


  // Gestisce l'aggiornamento manuale tramite dropdown
  const updateCurrentCall = useCallback(async (ticker: string) => {
    const sel = selected[ticker] || { year: '', month: '', strike: null }
    if (!sel.year || !sel.month || !sel.strike) return

    const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
    const monthIndex = monthNames.indexOf(sel.month)
    if (monthIndex === -1) return

    const expiryDate = getThirdFriday(Number(sel.year), monthIndex + 1)

    // Calcola Future e Earlier
    const { future, earlier } = calculateFutureEarlier(ticker, Number(sel.year), monthIndex, sel.strike!);

    // Prezzi correnti (basati sullo stato attuale 'prices')
    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, sel.strike!)
    const currentPrices = prices[ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 }
    let current_bid = currentPrices.bid
    let current_ask = currentPrices.ask
    let current_last_trade_price = currentPrices.last_trade_price

    // Aggiorna lo stato locale (setData)
    setData(prevData => prevData.map(item => {
      if (item.ticker !== ticker) return item

      return {
        ...item,
        strike: sel.strike!,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
        future: [...future],
        earlier: [...earlier],
        invalid: false
      }
    }));

    // Pulisci selezione e chiudi dropdown
    setSelected((prev) => ({ ...prev, [ticker]: { year: '', month: '', strike: null } }))
    setShowDropdowns((prev) => ({ ...prev, [ticker]: false }))

    // Salva lo stato (save-state)
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    authenticatedFetch('/api/save-state', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        future: future,
        earlier: earlier
      })
    }).catch(err => console.error('Errore salvataggio stato:', err));
    // ***************************************


    // Fetch immediato dei prezzi per la nuova call selezionata per garantire dati freschi
    const newSymbol = currentSymbol;
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`);
    // ***************************************

    if (res.ok) {
      const json = await res.json();
      const newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 };
      setPrices((prev: PricesType) => ({
        ...prev,
        [ticker]: { ...prev[ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
      }));
      // Aggiorna i prezzi con i dati appena fetchati
      current_bid = newData.bid > 0 ? newData.bid : newData.last_trade_price;
      current_ask = newData.ask > 0 ? newData.ask : newData.last_trade_price;
      current_last_trade_price = newData.last_trade_price;

      // Aggiorna di nuovo lo stato locale con i prezzi aggiornati
      setData(prevData => prevData.map(item => {
        if (item.ticker !== ticker) return item;
        return {
          ...item,
          current_bid,
          current_ask,
          current_last_trade_price
        };
      }));
    }

    // Aggiorna la call principale su Supabase (update-call)
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    const confirmRes = await authenticatedFetch('/api/update-call', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        strike: sel.strike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
      })
    })
    // ***************************************

    if (confirmRes.ok) {
      const confirmJson = await confirmRes.json()
      if (!confirmJson.success) {
        console.error('Errore logico nel salvataggio su Supabase per', ticker)
      }
    } else {
      console.error('Errore HTTP chiamata /api/update-call', confirmRes.status);
    }

    // Pulisci alert-sent (richiede RLS Policy per DELETE)
    await supabaseClient.from('alerts_sent').delete().eq('ticker', ticker);

  }, [selected, prices, calculateFutureEarlier]);


  // Gestisce il click sul bottone ROLLA (dopo conferma modale)
  const handleRollaClick = useCallback(async (ticker: string, opt: OptionEntry) => {
    if (!opt.expiry || opt.label === 'OPZIONE INESISTENTE') {
      console.error("Tentativo di rollare su un'opzione inesistente.");
      return;
    }

    const [yearStr, monthStr] = opt.expiry.split('-')
    const selectedYear = Number(yearStr)
    const selectedMonthIndex = Number(monthStr) - 1; // 0-based per calculateFutureEarlier
    const selectedStrike = opt.strike
    const expiryDate = getThirdFriday(selectedYear, selectedMonthIndex + 1) // getThirdFriday usa 1-based

    // Calcola Future e Earlier basandosi sulla nuova opzione (opt)
    const { future, earlier } = calculateFutureEarlier(ticker, selectedYear, selectedMonthIndex, selectedStrike);

    // Prezzi correnti (basati su 'prices' o 'opt' come fallback)
    const currentSymbol = getSymbolFromExpiryStrike(ticker, expiryDate, selectedStrike)
    const currentPrices = prices[ticker]?.[currentSymbol] ?? { bid: opt.bid, ask: opt.ask, last_trade_price: opt.last_trade_price }
    let current_bid = currentPrices.bid
    let current_ask = currentPrices.ask
    let current_last_trade_price = currentPrices.last_trade_price

    // Aggiorna lo stato locale (setData)
    setData(prevData => prevData.map(item => {
      if (item.ticker !== ticker) return item

      return {
        ...item,
        strike: selectedStrike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
        future: [...future],
        earlier: [...earlier],
        invalid: false
      }
    }));

    // Salva lo stato (save-state)
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    authenticatedFetch('/api/save-state', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        future: future,
        earlier: earlier
      })
    }).catch(err => console.error('Errore salvataggio stato:', err));
    // ***************************************


    // Fetch immediato dei prezzi per la nuova call rollata
    const newSymbol = currentSymbol;
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    const res = await authenticatedFetch(`/api/full-prices?symbols=${newSymbol}`);
    // ***************************************

    if (res.ok) {
      const json = await res.json();
      const newData = json[newSymbol] || { bid: 0, ask: 0, last_trade_price: 0 };
      setPrices((prev: PricesType) => ({
        ...prev,
        [ticker]: { ...prev[ticker], [newSymbol]: { ...newData, symbol: newSymbol } }
      }));
      // Aggiorna i prezzi con i dati freschi
      current_bid = newData.bid > 0 ? newData.bid : newData.last_trade_price;
      current_ask = newData.ask > 0 ? newData.ask : newData.last_trade_price;
      current_last_trade_price = newData.last_trade_price;

      // Aggiorna di nuovo lo stato locale con i prezzi aggiornati
      setData(prevData => prevData.map(item => {
        if (item.ticker !== ticker) return item;
        return {
          ...item,
          current_bid,
          current_ask,
          current_last_trade_price
        };
      }));
    }

    // Aggiorna la call principale su Supabase (update-call)
    // *** CORREZIONE 401: Usa authenticatedFetch ***
    const confirmRes = await authenticatedFetch('/api/update-call', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        strike: selectedStrike,
        expiry: expiryDate,
        current_bid,
        current_ask,
        current_last_trade_price,
      })
    })
    // ***************************************

    if (confirmRes.ok) {
      const confirmJson = await confirmRes.json()
      if (!confirmJson.success) {
        console.error('Errore logico nel salvataggio su Supabase per', ticker)
      }
    } else {
      console.error('Errore HTTP chiamata /api/update-call', confirmRes.status);
    }

    // Pulisci alert-sent (richiede RLS Policy per DELETE)
    await supabaseClient.from('alerts_sent').delete().eq('ticker', ticker);

  }, [prices, calculateFutureEarlier]);

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const addTicker = async () => {
    if (!newTicker) return;
    const tickerToAdd = newTicker.toUpperCase().trim();
    if (tickers.includes(tickerToAdd)) {
      alert("Ticker già presente.");
      return;
    }
    try {
      const res = await authenticatedFetch('/api/add-ticker', { method: 'POST', body: JSON.stringify({ ticker: tickerToAdd }) });
      if (res.ok) {
        console.log(`Added ${tickerToAdd} - refreshing...`);
        await fetchTickers();
        await fetchData();
        setNewTicker('');
      } else {
        console.error('Errore API add-ticker:', res.status);
        alert(`Errore nell'aggiunta del ticker: ${res.statusText}`);
      }
    } catch (err) {
      console.error('Errore add ticker', err);
    }
  };
  // ***************************************

  // *** CORREZIONE 401: Usa authenticatedFetch ***
  const removeTicker = async (ticker: string) => {
    try {
      const res = await authenticatedFetch('/api/remove-ticker', { method: 'POST', body: JSON.stringify({ ticker }) });
      if (res.ok) {
        console.log(`Removed ${ticker} - refreshing...`);
        // Aggiornamento UI ottimistico
        setTickers(prev => prev.filter(t => t !== ticker));
        setData(prev => prev.filter(d => d.ticker !== ticker));
        setChain(prev => {
          const next = { ...prev };
          delete next[ticker];
          return next;
        });
      } else {
        console.error('Errore API remove-ticker:', res.status);
      }
    } catch (err) {
      console.error('Errore remove ticker', err);
    }
  };
  // ***************************************


  // --- EFFECTS ---

  // 1. Gestione Autenticazione e Sessione (Migliorato con Loading State)
  useEffect(() => {
    let isMounted = true;
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        console.log('Session from getSession:', session); // Log sessione completa per debug
        console.log('Error from getSession:', error); // Log eventuali errori da getSession
        if (isMounted) {
          if (session) {
            setUser(session.user);
          } else {
            console.log('No session found, pushing to /login'); // Log redirect
            router.push('/login');
          }
          setLoading(false); // Fine caricamento
        }
      } catch (err) {
        console.error('Exception in checkSession:', err); // Log eccezioni generali
        if (isMounted) {
          setLoading(false);
          router.push('/login');
        }
      }
    };
    checkSession();  // Chiamata qui, all'interno dell'useEffect

    // Listener per cambiamenti di stato autenticazione (login/logout)
    const { data: authListener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        if (session) {
          setUser(session.user);
        } else {
          setUser(null);
          router.push('/login');
        }
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [router]);  // Dipendenze: solo router

  // 3. Fetch Iniziale dei Dati
  useEffect(() => {
    if (!user) return;
    fetchTickers();
    fetchData(); // Senza debounce per test
    fetchAlerts();
  }, [user, fetchTickers, fetchData, fetchAlerts]);

useEffect(() => {
  if (!user || data.length === 0) return;

  let isMounted = true;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Esegui fallback se mercato chiuso solo all'init
  if (!isMarketOpen() && isMounted) {
    console.log('❌ Market is closed, using fallback last_trade_price without polling.');
    setData((prev) =>
      prev.map((item) => ({
        ...item,
        current_bid: item.current_last_trade_price,
        current_ask: item.current_last_trade_price,
        earlier: item.earlier.map((opt) => ({
          ...opt,
          bid: opt.last_trade_price,
          ask: opt.last_trade_price,
        })),
        future: item.future.map((opt) => ({
          ...opt,
          bid: opt.last_trade_price,
          ask: opt.last_trade_price,
        })),
      }))
    );
  }

  // Funzione per fetch prices (solo se aperto)
  const executeFetchPrices = () => {
    if (isMarketOpen() && isMounted) {
      console.log('[PRICES] Execute fetch at', new Date().toISOString());
      fetchPrices();
    }
  };

  // Esegui subito
  executeFetchPrices();

  // Imposta interval solo se aperto
  if (isMarketOpen()) {
    intervalRef.current = setInterval(executeFetchPrices, 5000);
  }

  return () => {
    isMounted = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
  };
}, [user, fetchPrices]); // Solo user e fetchPrices, no data per evitare loop

  // Definizione isFattibile (Memoizzata)
  const isFattibile = useCallback((opt: OptionEntry, item: OptionData) => {
    const tickerPrices = prices[item.ticker] || {}
    const optPriceData = tickerPrices[opt.symbol]

    // Prezzo live dell'opzione target (Bid o Last)
    const optBid = optPriceData?.bid ?? opt.bid ?? 0
    const optLast = optPriceData?.last_trade_price ?? opt.last_trade_price ?? 0
    const liveOptPrice = optBid > 0 ? optBid : optLast
    if (liveOptPrice <= 0) return false

    // Prezzo live della call corrente (Ask o Last)
    const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike)
    const currentData = tickerPrices[currentSymbol] ?? { ask: item.current_ask ?? 0, last_trade_price: item.current_last_trade_price ?? 0 }
    const currentAsk = currentData.ask ?? 0
    const currentLast = currentData.last_trade_price ?? 0
    const liveCurrentPrice = currentAsk > 0 ? currentAsk : currentLast
    if (liveCurrentPrice <= 0) return false

    // Logica di fattibilità
    const isStrikeAboveSpot = item.spot < opt.strike;
    const isStrikeSufficientlyHigh = opt.strike >= item.spot * 1.04; // Almeno +4% dello spot
    const isPriceSufficient = liveOptPrice >= liveCurrentPrice * 1.00; // Almeno lo stesso prezzo

    return isStrikeAboveSpot && isStrikeSufficientlyHigh && isPriceSufficient;
  }, [prices]); // Dipende solo dai prices


  // 6. Gestione degli Alert (Polling)
  useEffect(() => {
    if (!user || data.length === 0) return;
    let isMounted = true;

    const checkAlerts = async () => {
      if (!isMounted || !isMarketOpen()) return;

      try {
        // Fetch alert inviati da Supabase (Supabase SDK gestisce automaticamente il token)
        // RLS deve essere attivo sulla tabella alerts_sent per filtrare per user_id
        const { data: sentData, error } = await supabaseClient.from('alerts_sent').select('*');

        if (error) {
          console.error("Errore nel fetch degli alert inviati:", error);
          return;
        }

        // Mappa locale per controlli efficienti
        const sentAlertsLocal: Record<string, Record<string, boolean>> = (sentData || []).reduce((acc, row) => {
          if (!acc[row.ticker]) acc[row.ticker] = {};
          acc[row.ticker][row.level] = true;
          return acc;
        }, {} as Record<string, Record<string, boolean>>);

        for (const item of data) {
          if (!alertsEnabled[item.ticker] || item.spot <= 0) continue;

          const delta = ((item.strike - item.spot) / item.spot) * 100;
          const levels = [4, 3, 2, 1];

          if (!sentAlertsLocal[item.ticker]) sentAlertsLocal[item.ticker] = {};
          const tickerSent = sentAlertsLocal[item.ticker];

          // Alert Delta Basso (Pericolo)
          for (const level of levels) {
            if (delta < level && !tickerSent[level.toString()]) {
              const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}% – Rollare`;
              sendTelegramMessage(alertMessage);

              // Registra l'invio su Supabase. Assicurati che user_id sia incluso per RLS.
              await supabaseClient.from('alerts_sent').insert([{ ticker: item.ticker, level: level.toString(), user_id: user.id }]);
              tickerSent[level.toString()] = true;
            }
          }

          // Alert Fattibile Earlier (Opportunità)
          const hasFattibile = item.earlier.some(opt => isFattibile(opt, item));
          if (hasFattibile && !tickerSent['fattibile_high']) {
            const alertMessage = `🟢 ${item.ticker} – Earlier fattibile disponibile`;
            sendTelegramMessage(alertMessage);

            await supabaseClient.from('alerts_sent').insert([{ ticker: item.ticker, level: 'fattibile_high', user_id: user.id }]);
            tickerSent['fattibile_high'] = true;
          }
        }
      } catch (err) {
        console.error("Errore durante il controllo degli alert:", err);
      }
    };

    // Imposta intervallo (Aumentato a 30 secondi)
    const alertInterval = setInterval(checkAlerts, 30000);

    return () => {
      isMounted = false;
      clearInterval(alertInterval);
    };
  }, [user, data, alertsEnabled, isFattibile]); // Aggiunto isFattibile


  // 7. Sincronizzazione Prezzi/Spots nello stato 'data'
  useEffect(() => {
    // Questo effect si attiva quando 'prices' o 'spots' cambiano, aggiornando 'data'.
    if (!user) return;

    setData((prev: OptionData[]) => prev.map(item => {
      const newSpot = spots[item.ticker]?.price > 0 ? spots[item.ticker]?.price : item.spot;

      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
      const tickerPrices = prices[item.ticker] || {};
      const currentData = tickerPrices[currentSymbol];

      // Se non ci sono nuovi dati di prezzo, usa i vecchi
      const newBid = currentData?.bid ?? item.current_bid;
      const newAsk = currentData?.ask ?? item.current_ask;
      const newLast = currentData?.last_trade_price ?? item.current_last_trade_price;

      // Evita re-render se i dati non sono cambiati (ottimizzazione)
      if (item.spot === newSpot &&
        item.current_bid === newBid &&
        item.current_ask === newAsk &&
        item.current_last_trade_price === newLast) {
        return item;
      }

      return {
        ...item,
        spot: newSpot,
        current_bid: newBid,
        current_ask: newAsk,
        current_last_trade_price: newLast
      };
    }));
  }, [user, prices, spots]);


  // --- Rendering ---

  if (loading) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">Caricamento sessione...</div>;
  }

  // Questo stato non dovrebbe essere raggiunto grazie al redirect nell'useEffect, ma è un fallback sicuro
  if (!user) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">Accesso richiesto. Reindirizzamento...</div>;
  }

  return (
    <Fragment>
      {/* Modale di conferma Roll */}
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
        {/* Header con Logout */}
        <div className="flex justify-end">
          <button onClick={async () => {
            await supabaseClient.auth.signOut();
            // Il redirect è gestito dall'Auth Listener in useEffect
          }} className="bg-red-700 text-white px-4 py-2 rounded w-fit">
            Logout
          </button>
        </div>

        {/* Sezione Aggiunta Ticker */}
        <div className="p-2 bg-zinc-900 rounded mb-2">
          <input
            value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker(); }} // Aggiunto Enter key handler
            placeholder="Aggiungi ticker (es. AAPL)"
            className="bg-zinc-800 text-white p-1" />
          <button onClick={addTicker} className="bg-green-700 text-white px-2 py-1 rounded ml-2">Aggiungi</button>
          <div className="mt-2">
            Tickers attuali: {tickers.map(t => <span key={t} className="mr-2">{t} <button onClick={() => removeTicker(t)} className="text-red-500">X</button></span>)}
          </div>
        </div>

        {/* Griglia dei Ticker Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((item: OptionData, index: number) => {
            // Gestione caso Ticker Invalido/Errore
            if (item.invalid) {
              const ticker = item.ticker
              const sel = selected[ticker] || { year: '', month: '', strike: null }
              const tickerChain = chain[ticker] || {}
              return (
                <div key={`${ticker}-${index}-invalid`} className="bg-red-800 text-white rounded-lg p-4 shadow-md flex flex-col gap-2">
                  <div className="font-bold text-lg">⚠️ Errore caricamento CALL per {ticker}</div>
                  <div>La call corrente salvata su Supabase non è più disponibile o ha dati errati. Seleziona una nuova call.</div>

                  {/* Dropdown per la correzione (sempre visibile se invalido) */}
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <select
                      value={sel.year}
                      onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, year: e.target.value, month: '', strike: null } }))}
                      className="bg-zinc-800 text-white p-1"
                    >
                      <option value="">Anno</option>
                      {Object.keys(tickerChain).sort().map(y => <option key={y} value={y}>{y}</option>)}
                    </select>

                    <select
                      value={sel.month}
                      onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, month: e.target.value, strike: null } }))}
                      className="bg-zinc-800 text-white p-1"
                      disabled={!sel.year}
                    >
                      <option value="">Mese</option>
                      {sel.year && Object.keys(tickerChain[sel.year] || {}).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>

                    <select
                      value={sel.strike ?? ''}
                      onChange={e => setSelected((prev) => ({ ...prev, [ticker]: { ...sel, strike: Number(e.target.value) } }))}
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
                      disabled={!sel.year || !sel.month || !sel.strike}
                      className="col-span-3 mt-1 bg-green-700 hover:bg-green-800 disabled:bg-gray-600 text-white text-xs font-medium px-2 py-1 rounded"
                    >
                      ✔️ Conferma nuova CALL
                    </button>

                    {Object.keys(tickerChain).length === 0 && (
                      <div className="col-span-3 text-yellow-500 text-xs mt-1">
                        Nessuna scadenza disponibile. Verifica il ticker.
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            // Rendering del Ticker Card Standard
            return (
              <MemoizedTickerCard
                key={item.ticker} // Usare il ticker come chiave è più stabile dell'indice
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
                shiftExpiryByMonth={shiftExpiryByMonth}
                data={data}
                setData={setData}
                setChain={setChain}
                spots={spots}
                supabaseClient={supabaseClient}
              />
            )
          })}
        </div>
      </div>
    </Fragment>
  )
}