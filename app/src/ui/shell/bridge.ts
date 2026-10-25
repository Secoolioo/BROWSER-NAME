import type { RequestOf, ResponseOf } from '../../shared/ipc/contract.ts';
import type {
  ActivateTab,
  CloseTab,
  GetShellState,
  NavigateTab,
  OpenTab,
  ReopenClosedTab,
  SetShellInsets,
  ShellState,
  TabAction,
} from '../../shared/ipc/shell-contracts.ts';

interface Requests {
  'shell.getState': typeof GetShellState;
  'tabs.open': typeof OpenTab;
  'tabs.activate': typeof ActivateTab;
  'tabs.close': typeof CloseTab;
  'tabs.reopenClosed': typeof ReopenClosedTab;
  'tabs.navigate': typeof NavigateTab;
  'tabs.action': typeof TabAction;
  'shell.setInsets': typeof SetShellInsets;
}

interface Events {
  'shell.stateChanged': ShellState;
  'shell.command': 'omnibox.focus';
}

/** The API that the shell's preload script exposes. */
interface PreloadBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    readonly bridge: PreloadBridge;
  }
}

/** Typed access to the browser process from the shell. */
export class ShellBridge {
  private readonly raw: PreloadBridge;

  /** @param raw - The preload bridge, `window.bridge`. */
  constructor(raw: PreloadBridge) {
    this.raw = raw;
  }

  /**
   * Calls a request channel.
   * @param channel - The channel.
   * @param request - The request; the browser process validates it again.
   */
  invoke<K extends keyof Requests>(
    channel: K,
    request: RequestOf<Requests[K]>,
  ): Promise<ResponseOf<Requests[K]>> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser process validates every response against the contract
    return this.raw.invoke(channel, request) as Promise<ResponseOf<Requests[K]>>;
  }

  /**
   * Listens to an event channel.
   * @param channel - The channel.
   * @param listener - Receives each payload.
   * @returns A function that removes the listener.
   */
  on<K extends keyof Events>(channel: K, listener: (payload: Events[K]) => void): () => void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser process only publishes payloads of the event contract
    return this.raw.on(channel, (payload) => listener(payload as Events[K]));
  }
}
