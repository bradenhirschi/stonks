import Link from "next/link";
import { GAMES } from "@/games";

/** The site's home page: pick a game. */
export default function Home() {
  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">Board Games</h1>
        <p className="muted">Play with friends online, or pass one device around.</p>
        <ul className="game-list">
          {GAMES.map((g) => (
            <li key={g.id}>
              <Link href={`/${g.id}`} className="game-tile">
                <b>{g.name}</b>
                <span className="muted">{g.tagline}</span>
                <span className="muted small">{g.players}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
