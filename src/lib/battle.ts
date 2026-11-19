/**
 * Quiz battle (pure, unit tested in tests/unit/battle.test.ts): friends answer the same multiple-choice questions
 * at the same time; faster right answers score more. The host's browser runs the game and does the scoring;
 * everyone else only sends answers and shows what the host sends.
 */

export const SECS = 20;
export const COUNTS = [5, 10, 15] as const;

export interface Player {
  id: string;
  name: string;
  score: number;
  /** the latest question's answer: chosen option, right or not, points won */
  last?: { k: number; right: boolean; pts: number } | null;
}

export type BattleMsg =
  | { t: "hello"; name: string }
  | { t: "lobby"; players: Player[]; topic: string; n: number; you?: string }
  | { t: "q"; i: number; id: string; left: number }
  | { t: "ans"; i: number; k: number }
  | { t: "reveal"; i: number; a: number; players: Player[] }
  | { t: "end"; players: Player[] }
  | { t: "bye" };

/** A right answer is worth 500 points, plus up to 500 more for answering quickly. */
export function score(right: boolean, msLeft: number, total = SECS * 1000): number {
  if (!right) return 0;
  return 500 + Math.round(500 * Math.max(0, Math.min(1, msLeft / total)));
}

/** Highest score first; ties keep the order they joined in. */
export function standings(players: Player[]): Player[] {
  return players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score || a.i - b.i).map((x) => x.p);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

function readPlayers(v: unknown): Player[] | null {
  if (!Array.isArray(v) || v.length > 12) return null;
  const out: Player[] = [];
  for (const p of v) {
    if (!isObj(p)) return null;
    const id = str(p.id, 40), name = str(p.name, 40), sc = int(p.score, 0, 1_000_000);
    if (id == null || name == null || sc == null) return null;
    const last = isObj(p.last) && int(p.last.k, -1, 9) != null && typeof p.last.right === "boolean" && int(p.last.pts, 0, 1000) != null
      ? { k: p.last.k as number, right: p.last.right, pts: p.last.pts as number } : null;
    out.push({ id, name, score: sc, last });
  }
  return out;
}

/** Checks a message from another browser; anything malformed is ignored (returns null). */
export function readBattleMsg(raw: unknown): BattleMsg | null {
  if (!isObj(raw) || typeof raw.t !== "string") return null;
  switch (raw.t) {
    case "hello": {
      const name = str(raw.name, 40);
      return name ? { t: "hello", name } : null;
    }
    case "lobby": {
      const players = readPlayers(raw.players), topic = str(raw.topic, 120), n = int(raw.n, 1, 50);
      const you = str(raw.you, 40);
      return players && topic != null && n != null ? { t: "lobby", players, topic, n, ...(you ? { you } : {}) } : null;
    }
    case "q": {
      const i = int(raw.i, 0, 49), id = str(raw.id, 120), left = int(raw.left, 0, SECS * 1000);
      return i != null && id && left != null ? { t: "q", i, id, left } : null;
    }
    case "ans": {
      const i = int(raw.i, 0, 49), k = int(raw.k, 0, 9);
      return i != null && k != null ? { t: "ans", i, k } : null;
    }
    case "reveal": {
      const i = int(raw.i, 0, 49), a = int(raw.a, 0, 9), players = readPlayers(raw.players);
      return i != null && a != null && players ? { t: "reveal", i, a, players } : null;
    }
    case "end": {
      const players = readPlayers(raw.players);
      return players ? { t: "end", players } : null;
    }
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
}
