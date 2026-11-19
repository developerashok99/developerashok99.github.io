/**
 * Connections between friends' browsers, shared by watch together (src/client/together.ts) and the quiz battle
 * (src/client/battle.ts). One browser hosts a room under a short code; the others connect to it.
 *
 * Real rooms use WebRTC data channels (PeerJS; its free public server only introduces the browsers). Tests swap in
 * a BroadcastChannel (`window.__mlsTogetherTransport = "local"`), so two tabs can play both roles offline.
 */
declare global {
  interface Window {
    __mlsTogetherTransport?: "local";
  }
}

export interface Link {
  send(m: unknown): void;
  close(): void;
  onmsg?: (data: unknown) => void;
  onclose?: () => void;
}
export type Problem = "taken" | "not-found" | "network" | "failed";
export interface Handlers {
  ready(): void;
  link(l: Link): void;
  problem(p: Problem): void;
}
export interface Transport {
  host(code: string, h: Handlers): void;
  join(code: string, h: Handlers): void;
  destroy(): void;
}
export type RoomKind = "watch" | "quiz";

/** The connection for a kind of room; each kind has its own ids, so a quiz code never reaches a watch room. */
export function makeTransport(kind: RoomKind): Transport {
  return window.__mlsTogetherTransport === "local"
    ? localTransport(kind === "watch" ? "mls-together" : `mls-${kind}`)
    : peerTransport((code) => `mls-${kind}-${code.toLowerCase()}`);
}

/** Real rooms: WebRTC data channels, with PeerJS's public server for the introduction. */
function peerTransport(peerId: (code: string) => string): Transport {
  let peer: import("peerjs").Peer | null = null;
  let gone = false;
  const wrap = (conn: import("peerjs").DataConnection): Link => {
    let closed = false;
    const link: Link = { send: (m) => conn.open && void conn.send(m), close: () => conn.close() };
    const end = () => {
      if (closed) return;
      closed = true;
      link.onclose?.();
    };
    conn.on("data", (d) => link.onmsg?.(d));
    conn.on("close", end);
    conn.on("error", end);
    conn.on("iceStateChanged", (s) => (s === "failed" || s === "closed") && end());
    return link;
  };
  const kind = (type: string): Problem =>
    type === "unavailable-id" ? "taken" : type === "peer-unavailable" ? "not-found" : ["network", "server-error", "socket-error", "socket-closed"].includes(type) ? "network" : "failed";
  const create = async (id: string | undefined, h: Handlers) => {
    const { Peer } = await import("peerjs");
    if (gone) return null;
    const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    peer = p;
    p.on("error", (e) => h.problem(kind(e.type)));
    // losing the introduction server doesn't drop friends already connected; reconnect so new ones can join
    p.on("disconnected", () => !gone && !p.destroyed && p.reconnect());
    return p;
  };
  return {
    host(code, h) {
      void create(peerId(code), h).then((p) => {
        if (!p) return;
        p.on("open", () => h.ready());
        p.on("connection", (conn) => conn.on("open", () => h.link(wrap(conn))));
      });
    },
    join(code, h) {
      void create(undefined, h).then((p) => {
        if (!p) return;
        p.on("open", () => {
          const conn = p.connect(peerId(code), { reliable: true });
          const timer = setTimeout(() => !conn.open && h.problem("failed"), 20_000);
          conn.on("open", () => {
            clearTimeout(timer);
            h.ready();
            h.link(wrap(conn));
          });
        });
      });
    },
    destroy() {
      gone = true;
      peer?.destroy();
    },
  };
}

/** Test rooms: every tab of this browser on one BroadcastChannel; messages carry sender and receiver ids. */
function localTransport(channel: string): Transport {
  const me = Math.random().toString(36).slice(2);
  let ch: BroadcastChannel | null = null;
  const links = new Map<string, Link>();
  const linkTo = (other: string): Link => {
    const l: Link = { send: (m) => ch?.postMessage({ k: "msg", from: me, to: other, m }), close: () => ch?.postMessage({ k: "close", from: me, to: other }) };
    links.set(other, l);
    return l;
  };
  const listen = (h: Handlers, hosting: boolean) => {
    ch!.onmessage = (e) => {
      const d = e.data as { k: string; from: string; to?: string; m?: unknown };
      if (d.to && d.to !== me) return;
      if (d.k === "join" && hosting) {
        ch!.postMessage({ k: "welcome", from: me, to: d.from });
        h.link(linkTo(d.from));
      } else if (d.k === "welcome" && !hosting && !links.size) {
        h.ready();
        h.link(linkTo(d.from));
      } else if (d.k === "msg") links.get(d.from)?.onmsg?.(d.m);
      else if (d.k === "close") {
        const l = links.get(d.from);
        links.delete(d.from);
        l?.onclose?.();
      }
    };
  };
  return {
    host(code, h) {
      ch = new BroadcastChannel(`${channel}-${code}`);
      listen(h, true);
      setTimeout(() => h.ready());
    },
    join(code, h) {
      ch = new BroadcastChannel(`${channel}-${code}`);
      listen(h, false);
      ch.postMessage({ k: "join", from: me });
      setTimeout(() => !links.size && h.problem("not-found"), 3000);
    },
    destroy() {
      links.forEach((l) => l.close());
      links.clear();
      ch?.close();
      ch = null;
    },
  };
}
