import { protocol, type Session } from 'electron';
import { appScheme, appSourceRoutes } from './app-protocol-routes.ts';

/**
 * Registers `app://` as a privileged, standard and secure scheme with a code cache. Must
 * run before the app is ready.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

/**
 * Serves the browser's own pages from the bundled renderer files. Only sessions of the
 * browser's own views get the handler; web sessions get a handler that refuses every
 * request, so web content can never load `app://` resources.
 */
export class AppProtocol {
  private readonly root: string;
  private readonly hosts: ReadonlySet<string>;

  /**
   * @param root - Directory of the bundled renderer files.
   * @param hosts - Internal hosts, such as `shell`.
   */
  constructor(root: string, hosts: ReadonlySet<string>) {
    this.root = root;
    this.hosts = hosts;
  }

  /**
   * Serves internal pages in a session of the browser's own views.
   * @param session - The internal session.
   */
  serve(session: Session): void {
    session.protocol.registerSource(appScheme, {
      routes: appSourceRoutes(this.root, this.hosts),
    });
  }

  /**
   * Refuses every `app://` request in a web session.
   * @param session - A session used by web tabs.
   */
  refuse(session: Session): void {
    session.protocol.handle(appScheme, () => new Response(null, { status: 403 }));
  }
}
