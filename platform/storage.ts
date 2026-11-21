/**
 * localStorage that never throws (private mode, blocked storage, server rendering).
 * Keys are namespaced: `board-games:` for site-wide settings, `<game id>:` for a game's own.
 */

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the value just isn't remembered */
  }
}

/** The player's display name, shared by every game. */
export const NAME_KEY = "board-games:name";
/** Where the name lived before the site hosted more than one game. */
const LEGACY_NAME_KEY = "stock-market:name";

export function readName(): string {
  return readStorage(NAME_KEY) ?? readStorage(LEGACY_NAME_KEY) ?? "";
}

export function writeName(name: string) {
  writeStorage(NAME_KEY, name);
}
