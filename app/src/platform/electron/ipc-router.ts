import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as v from 'valibot';
import { toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { EventContract, RequestContract } from '../../shared/ipc/contract.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { IpcGate } from './ipc-gate.ts';

/** Context passed to a request handler. */
export interface IpcContext {
  /** The `WebContents` that sent the request. */
  readonly sender: WebContents;
}

/**
 * Connects request contracts to handlers in the browser process. Every request passes the
 * {@link IpcGate} first; refused requests are dropped and logged, and the renderer only
 * learns that the request failed.
 */
export class IpcRouter {
  private readonly gate: IpcGate;
  private readonly logger: Logger;

  /**
   * @param gate - Sender, capability, schema and rate checks.
   * @param logger - Receives refused requests and handler errors.
   */
  constructor(gate: IpcGate, logger: Logger) {
    this.gate = gate;
    this.logger = logger.child('ipc');
  }

  /**
   * Handles a request channel.
   * @param contract - The channel's contract.
   * @param handler - Produces the response; its result is checked against the contract.
   * @returns A disposable that removes the handler.
   */
  handle<Req, Res>(
    contract: RequestContract<Req, Res>,
    handler: (request: Req, context: IpcContext) => Res | Promise<Res>,
  ): Disposable {
    ipcMain.handle(contract.channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const frame = event.senderFrame;
      const checked = this.gate.check(
        contract,
        {
          viewId: event.sender.id,
          frameUrl: frame?.url ?? '',
          isMainFrame: frame !== null && frame === event.sender.mainFrame,
        },
        payload,
      );
      if (!checked.ok) {
        this.logger.warn('Refused IPC request', {
          channel: contract.channel,
          reason: checked.error,
        });
        throw new Error('Request refused');
      }
      try {
        const response = await handler(checked.value, { sender: event.sender });
        return v.parse(contract.response, response);
      } catch (error) {
        this.logger.error(`IPC handler failed: ${contract.channel}`, error);
        throw new Error('Request failed', { cause: error });
      }
    });
    return toDisposable(() => ipcMain.removeHandler(contract.channel));
  }

  /**
   * Sends an event to a view if it has the contract's capability.
   * @param contract - The event's contract.
   * @param target - Receiving view.
   * @param payload - The event payload.
   */
  publish<T>(contract: EventContract<T>, target: WebContents, payload: T): void {
    if (!target.isDestroyed() && this.gate.mayReceive(target.id, contract.capability)) {
      target.send(contract.channel, payload);
    }
  }
}
