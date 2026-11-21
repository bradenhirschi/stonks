"use client";

import { useState, type ReactNode } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
/** Zoom added per pixel of wheel movement (a mouse-wheel notch is ~100px ≈ +0.3x). */
const WHEEL_SENSITIVITY = 0.003;

/**
 * Zoom and pan the board by scaling it (react-zoom-pan-pinch): the board is never re-laid
 * out, so nothing shifts when a gesture ends, and browsers re-render the text sharply once
 * the scale settles.
 *
 * - Phones: pinch to zoom; one finger pans once zoomed in (at 1x it scrolls the page).
 * - Desktop: mouse wheel or trackpad pinch zooms at the cursor; trackpad two-finger
 *   scrolling and click-drag pan.
 * - Double-tap / double-click toggles zoom; +, − and Fit buttons in the corner.
 */
export default function ZoomableBoard({ children }: { children: ReactNode }) {
  const [zoomed, setZoomed] = useState(false);
  const [atMax, setAtMax] = useState(false);

  return (
    <div className="board-zoom">
      <TransformWrapper
        minScale={MIN_ZOOM}
        maxScale={MAX_ZOOM}
        limitToBounds
        centerZoomedOut
        // At 1x let one finger scroll the page instead of trying to pan the board.
        panning={{ disabled: !zoomed, velocityDisabled: false }}
        trackPadPanning={{ disabled: !zoomed }}
        // Zoom in proportion to how far the wheel/trackpad moved, not a fixed step per event:
        // trackpad pinches send many tiny events, which otherwise jump straight to max zoom.
        smooth
        wheel={{ step: WHEEL_SENSITIVITY }}
        pinch={{ step: 5 }}
        doubleClick={{ mode: zoomed ? "reset" : "zoomIn", step: 0.8, animationTime: 250 }}
        zoomAnimation={{ size: 0.1, animationTime: 200 }}
        onTransform={(_ref, { scale }) => {
          const z = scale > MIN_ZOOM + 0.01;
          const m = scale >= MAX_ZOOM - 0.01;
          if (z !== zoomed) setZoomed(z);
          if (m !== atMax) setAtMax(m);
        }}
      >
        <TransformComponent
          wrapperClass={`board-viewport ${zoomed ? "zoomed" : ""}`}
          wrapperStyle={{ width: "100%", height: "auto", aspectRatio: "1" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          <div className="board-wrap">{children}</div>
        </TransformComponent>
        <ZoomControls zoomed={zoomed} atMax={atMax} />
      </TransformWrapper>
    </div>
  );
}

function ZoomControls({ zoomed, atMax }: { zoomed: boolean; atMax: boolean }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="zoom-controls" role="group" aria-label="Board zoom">
      <button onClick={() => zoomIn(0.5, 200)} disabled={atMax} aria-label="Zoom in">
        +
      </button>
      <button onClick={() => zoomOut(0.5, 200)} disabled={!zoomed} aria-label="Zoom out">
        −
      </button>
      <button onClick={() => resetTransform(250)} disabled={!zoomed} aria-label="Fit board" title="Fit board">
        {/* The "full screen" corners icon, drawn inline so it looks the same on every device. */}
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
      </button>
    </div>
  );
}
