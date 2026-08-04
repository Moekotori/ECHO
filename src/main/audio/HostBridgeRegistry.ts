import type { JsonRpcBridge } from './JsonRpcBridge';

export let activeJsonRpcBridge: JsonRpcBridge | null = null;

export function getActiveJsonRpcBridge(): JsonRpcBridge | null {
  return activeJsonRpcBridge;
}

export function setActiveJsonRpcBridge(bridge: JsonRpcBridge): void {
  activeJsonRpcBridge = bridge;
}

export function clearActiveJsonRpcBridge(): void {
  activeJsonRpcBridge = null;
}

export function clearActiveJsonRpcBridgeIf(bridge: JsonRpcBridge | null): void {
  if (activeJsonRpcBridge === bridge) {
    activeJsonRpcBridge = null;
  }
}
