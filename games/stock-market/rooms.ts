"use client";

import { roomsFor } from "@/platform/rooms";
import type { Action, GameState } from "./engine";
import { STOCK_MARKET, type StockMarketSettings } from "./game";

/** Stock Market's online rooms (Firestore `stockMarketRooms/{code}`). */
export const rooms = roomsFor<GameState, Action, StockMarketSettings>(STOCK_MARKET);
