"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ensureUser } from "./firebase";
import type { OnlineGame } from "./game";
import { RoomError, type Room, type RoomsApi, type Seat } from "./rooms";

export interface LobbyOptions<Settings> {
  /** Token color for each seat. */
  seatColors: readonly string[];
  /** The host's controls for the game's settings (e.g. a target score). */
  settingsControl?(props: {
    settings: Settings;
    seats: Seat[];
    disabled: boolean;
    onChange(patch: Partial<Settings>): void;
  }): ReactNode;
  /** What other players see about the settings while they wait, e.g. "First to $100,000." */
  settingsSummary?(settings: Settings): ReactNode;
}

/**
 * An online room for any game: connects, shows the shared lobby, then hands over to the
 * game's own online screen once the host starts.
 */
export default function OnlineRoom<S, A, Settings extends Record<string, unknown>>({
  game,
  rooms,
  code,
  name,
  lobby,
  renderGame,
  onQuit,
}: {
  game: OnlineGame<S, Settings>;
  rooms: RoomsApi<S, A, Settings>;
  code: string;
  /** This player's name, used when they join. */
  name: string;
  lobby: LobbyOptions<Settings>;
  renderGame(props: { room: Room<S, A, Settings>; uid: string; onQuit: () => void }): ReactNode;
  onQuit: () => void;
}) {
  const [uid, setUid] = useState<string | null>(null);
  const [room, setRoom] = useState<Room<S, A, Settings> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    ensureUser()
      .then((user) => {
        if (cancelled) return;
        setUid(user.uid);
        stop = rooms.watchRoom(code, setRoom, (e) => setError(e.message));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't connect."));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [code, rooms]);

  if (error) return <Notice title="Something went wrong" text={error} onQuit={onQuit} />;
  if (!uid || room === undefined) return <Notice title={`Room ${code}`} text="Connecting…" onQuit={onQuit} />;
  if (room === null) return <Notice title={`Room ${code}`} text="There's no room with that code." onQuit={onQuit} />;

  if (room.status === "lobby")
    return <Lobby game={game} rooms={rooms} room={room} uid={uid} name={name} options={lobby} onQuit={onQuit} />;
  return <>{renderGame({ room, uid, onQuit })}</>;
}

function Notice({ title, text, onQuit }: { title: string; text: string; onQuit: () => void }) {
  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">{title}</h1>
        <p className="muted">{text}</p>
        <button className="btn" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    </main>
  );
}

function Lobby<S, A, Settings extends Record<string, unknown>>({
  game,
  rooms,
  room,
  uid,
  name,
  options,
  onQuit,
}: {
  game: OnlineGame<S, Settings>;
  rooms: RoomsApi<S, A, Settings>;
  room: Room<S, A, Settings>;
  uid: string;
  name: string;
  options: LobbyOptions<Settings>;
  onQuit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState(name);
  const [copied, setCopied] = useState(false);
  const isHost = room.hostUid === uid;
  const seated = room.memberUids.includes(uid);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/${game.id}?room=${room.code}`;
  const full = room.seats.length >= game.maxPlayers;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof RoomError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  /** The phone's share sheet (Messages, WhatsApp, …); copies the link where there isn't one. */
  const share = async () => {
    if (!canShare) return copy();
    try {
      await navigator.share({ title: game.name, text: `Join my ${game.name} game (room ${room.code})`, url: link });
    } catch (e) {
      // Closing the share sheet isn't an error worth acting on; anything else, copy instead.
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
    }
  };

  const bots = room.seats.filter((s) => s.isBot).length;

  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-logo">{game.name}</h1>
        <div className="room-code">
          <span className="muted small">Room code</span>
          <b>{room.code}</b>
        </div>
        <div className="btn-row">
          {canShare && (
            <button className="btn btn-primary" onClick={share}>
              Share invite
            </button>
          )}
          <button className="btn" onClick={copy}>
            {copied ? "Link copied!" : "Copy link"}
          </button>
        </div>

        <h2 className="lobby-heading">Players</h2>
        <ul className="lobby-seats">
          {room.seats.map((s, i) => (
            <li key={i}>
              <span className="token token-static" style={{ background: options.seatColors[i] }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="lobby-name">
                {s.name}
                {s.isBot && <span className="tag">BOT</span>}
                {s.uid === room.hostUid && <span className="tag">HOST</span>}
                {s.uid === uid && <span className="muted small"> (you)</span>}
              </span>
              {isHost && s.uid !== uid && (
                <button
                  className="link small"
                  disabled={busy}
                  aria-label={`Remove ${s.name}`}
                  onClick={() =>
                    run(() => rooms.editLobby(room.code, (r) => ({ seats: r.seats.filter((_, j) => j !== i) })))
                  }
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>

        {!seated && (
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => rooms.joinRoom(room.code, uid, joinName.trim() || "Player"));
            }}
          >
            <input
              value={joinName}
              maxLength={16}
              onChange={(e) => setJoinName(e.target.value)}
              aria-label="Your name"
            />
            <button className="btn btn-primary" disabled={busy || full}>
              {full ? "Room is full" : "Join game"}
            </button>
          </form>
        )}

        {isHost ? (
          <>
            {!full && (
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    rooms.editLobby(room.code, (r) => ({
                      seats: [...r.seats, { uid: null, name: `Bot ${bots + 1}`, isBot: true }],
                    })),
                  )
                }
              >
                + Add bot
              </button>
            )}
            {options.settingsControl?.({
              settings: room.settings,
              seats: room.seats,
              disabled: busy,
              onChange: (patch) => run(() => rooms.editLobby(room.code, () => ({ settings: patch }))),
            })}
            <button
              className="btn btn-primary btn-big"
              disabled={busy || room.seats.length < game.minPlayers}
              onClick={() => run(() => rooms.startGame(room.code))}
            >
              {room.seats.length < game.minPlayers ? "Waiting for players…" : "Start game"}
            </button>
          </>
        ) : (
          seated && <p className="muted">{options.settingsSummary?.(room.settings)} Waiting for the host to start…</p>
        )}

        {error && <p className="hint bad">{error}</p>}

        <div className="btn-row">
          {seated && !isHost && (
            <button
              className="link small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await rooms.editLobby(room.code, (r) => ({ seats: r.seats.filter((s) => s.uid !== uid) }));
                  onQuit();
                })
              }
            >
              Leave room
            </button>
          )}
          <button className="link small" onClick={onQuit}>
            Back to menu
          </button>
        </div>
      </div>
    </main>
  );
}
