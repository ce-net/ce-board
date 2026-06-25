/**
 * Real SDK adapter: wraps a live `CeClient` into the narrow ports the app's core logic
 * depends on. This is the ONLY module that imports @ce-net/sdk for the data path, so the
 * rest of the app (and all unit tests) stays SDK-agnostic and runs with no node.
 */

import { CeClient, bytesToUtf8, Amount, connectNode } from "@ce-net/sdk";
import type { MeshLike, MeshFrame, DataLike } from "./service.ts";

/**
 * Human label for "where the node lives", shown in the footer. The transport is the
 * mesh-native, SAME-ORIGIN rail ({@link connectNode}: the in-tab `window.__ceNode`
 * bridge if present, else the same-origin `/ce` reverse proxy), so the strict CSP
 * (`connect-src 'self'`) holds and ce-board never reaches an off-origin host.
 */
export const DEFAULT_NODE_URL = "same-origin /ce";

export interface Identity {
  nodeId: string;
}

/** This node's spendable credit balance, for the status bar. */
export interface NodeMoney {
  free: Amount;
  total: Amount;
}

/**
 * Construct a client against the local node. With no `baseUrl` (the default), this uses
 * the mesh-native, same-origin transport via {@link connectNode}. A non-empty `baseUrl`
 * is an explicit override pointing at a specific node's HTTP+SSE API.
 */
export function makeClient(baseUrl?: string): CeClient {
  if (!baseUrl) return connectNode();
  return new CeClient({ baseUrl });
}

/** Liveness probe used before connecting. */
export async function nodeHealthy(client: CeClient): Promise<boolean> {
  return client.health();
}

/** Fetch this node's identity (its node id == the user's board identity). */
export async function fetchIdentity(client: CeClient): Promise<Identity> {
  const status = await client.getStatus();
  return { nodeId: status.nodeId };
}

/** Fetch the node's balance for the footer (best-effort; never throws into the UI). */
export async function fetchMoney(client: CeClient): Promise<NodeMoney | null> {
  try {
    const b = await client.wallet.balance();
    return { free: b.free, total: b.total };
  } catch {
    return null;
  }
}

/** Adapt `CeClient.mesh` to the {@link MeshLike} port. */
export function meshAdapter(client: CeClient): MeshLike {
  return {
    subscribe: (topic) => client.mesh.subscribe(topic),
    publish: (topic, payload) => client.mesh.publish(topic, payload),
    async *streamMessages(opts) {
      for await (const m of client.mesh.streamMessages(opts)) {
        const frame: MeshFrame = {
          from: m.from,
          topic: m.topic,
          text: safeUtf8(m.payload()),
          receivedAt: m.receivedAt,
        };
        yield frame;
      }
    },
  };
}

/** Adapt `CeClient.data` to the {@link DataLike} port (CE object store). */
export function dataAdapter(client: CeClient): DataLike {
  return {
    putObject: (bytes) => client.data.putObject(bytes),
    getObject: (cid) => client.data.getObject(cid),
  };
}

function safeUtf8(bytes: Uint8Array): string {
  try {
    return bytesToUtf8(bytes);
  } catch {
    return "";
  }
}
