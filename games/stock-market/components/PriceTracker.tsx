"use client";

import type { CSSProperties } from "react";
import { FALLERS, MARKET_MAX, MARKET_MIN, RISERS, STOCKS, priceAt, type StockId } from "../stocks";

const LEVELS = Array.from({ length: MARKET_MAX - MARKET_MIN + 1 }, (_, i) => MARKET_MIN + i);

const nameCell = (id: StockId) => (
  <div key={id} className="tracker-name" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
    {STOCKS[id].short}
  </div>
);

const priceRow = (id: StockId) => (
  <div key={id} className="tracker-row" style={{ background: STOCKS[id].color, color: STOCKS[id].ink }}>
    {LEVELS.map((l) => (
      <div key={l} className="tracker-cell">
        {priceAt(id, l)}
      </div>
    ))}
  </div>
);

/**
 * Risers above the slider row, fallers below it (as on the board).
 * A strip of prices (one column per market level) that slides under a fixed
 * slider, like the physical tracker in the middle of the board.
 */
export default function PriceTracker({ market, delta }: { market: number; delta: number | null }) {
  // --pos: the current column's centre, in columns from the strip's left edge. The strip is
  // centred on it but clamped to the window's edges (no empty space near level 0 or 50);
  // the slider frame follows the column.
  const offset = { "--pos": market - MARKET_MIN + 0.5, "--cols": LEVELS.length } as CSSProperties;
  return (
    <div className="tracker" aria-label={`Stock price tracker, market level ${market}`}>
      <div className="tracker-names">
        {RISERS.map(nameCell)}
        <div className="tracker-head">MARKET</div>
        {FALLERS.map(nameCell)}
      </div>
      <div className="tracker-window" style={offset}>
        <div className="tracker-strip">
          {RISERS.map(priceRow)}
          <div className="tracker-row tracker-levels">
            {LEVELS.map((l) => (
              <div key={l} className="tracker-cell">
                {l}
              </div>
            ))}
          </div>
          {FALLERS.map(priceRow)}
        </div>
        <div className="tracker-slider" />
      </div>
      <div className="tracker-status">
        <span>
          Market level <b>{market}</b>
        </span>
        {delta !== null && delta !== 0 && (
          <span key={`${market}-${delta}`} className={`delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
            {delta > 0 ? `▲ UP ${delta}` : `▼ DOWN ${-delta}`}
          </span>
        )}
        <span className="gauge" aria-hidden>
          <span
            className="gauge-fill"
            style={{ left: `${((market - MARKET_MIN) / (MARKET_MAX - MARKET_MIN)) * 100}%` }}
          />
        </span>
      </div>
    </div>
  );
}
