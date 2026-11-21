"use client";

import { useState } from "react";
import { authErrorMessage, ensureUser, signInWithGoogle, signOutUser, useFirebaseUser } from "./firebase";
import { CODE_LENGTH, normalizeCode } from "./rooms";

/** Keep the room code in the address bar so the page can be refreshed or shared. */
export function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

/** The room code in the address bar (from an invite link), if any. */
export function roomFromUrl(): string | null {
  return normalizeCode(new URLSearchParams(window.location.search).get("room") ?? "") || null;
}

/**
 * The "Online" panel on a game's start screen: your name, create a room, join one by
 * code, and the account line (guest or Google). Works for any game.
 */
export default function OnlineStart({
  createRoom,
  name,
  setName,
  lastRoom,
  onOpenRoom,
}: {
  createRoom: (uid: string, name: string) => Promise<string>;
  name: string;
  setName: (n: string) => void;
  lastRoom: string | null;
  onOpenRoom: (code: string) => void;
}) {
  const user = useFirebaseUser();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const playerName = name.trim() || "Player";
  const googleName = user && !user.isAnonymous ? (user.displayName ?? user.email ?? "your Google account") : null;

  return (
    <section className="online-start">
      <label className="setup-row">
        <span className="home-label">Your name</span>
        <input value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const u = await ensureUser();
              onOpenRoom(await createRoom(u.uid, playerName));
            })
          }
        >
          Create a room
        </button>
      </div>

      <form
        className="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          const c = normalizeCode(code);
          if (c.length === CODE_LENGTH) onOpenRoom(c);
          else setError(`Room codes are ${CODE_LENGTH} letters and numbers.`);
        }}
      >
        <input
          value={code}
          placeholder="Room code"
          aria-label="Room code"
          autoCapitalize="characters"
          onChange={(e) => setCode(normalizeCode(e.target.value))}
        />
        <button className="btn" disabled={busy}>
          Join
        </button>
      </form>

      {lastRoom && (
        <button className="link small" onClick={() => onOpenRoom(lastRoom)}>
          Back to room {lastRoom}
        </button>
      )}

      <p className="account small muted">
        {googleName ? (
          <>
            Signed in as <b>{googleName}</b> ·{" "}
            <button className="link small" disabled={busy} onClick={() => run(signOutUser)}>
              Sign out
            </button>
          </>
        ) : (
          <>
            Playing as a guest on this device ·{" "}
            <button
              className="link small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const u = await signInWithGoogle();
                  if (!name.trim() && u.displayName) setName(u.displayName.split(" ")[0].slice(0, 16));
                })
              }
            >
              Sign in with Google
            </button>
          </>
        )}
      </p>

      {error && <p className="hint bad">{error}</p>}
    </section>
  );
}
