/** Every game on the site, as listed on the home page. Each lives at `/<id>`. */
export interface GameListing {
  id: string;
  name: string;
  tagline: string;
  players: string;
}

export const GAMES: GameListing[] = [
  {
    id: "stock-market",
    name: "Stock Market",
    tagline: "Buy low, sell high, and be first to $100,000.",
    players: "2–8 players",
  },
];
