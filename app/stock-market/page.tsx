import type { Metadata } from "next";
import Home from "@/games/stock-market/components/Home";
import "@/games/stock-market/stock-market.css";

export const metadata: Metadata = {
  title: "Stock Market",
  description: "A stock market board game.",
};

export default function StockMarketPage() {
  return (
    <div className="stock-market">
      <Home />
    </div>
  );
}
