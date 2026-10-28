import * as v from 'valibot';
import { defineEvent, defineRequest, type RequestContract } from './contract.ts';

const TabId = v.pipe(v.string(), v.regex(/^t[0-9a-z]{1,12}$/));
const Empty = v.strictObject({});
const Done = v.null();

/** One tab as the shell displays it. */
export const TabView = v.strictObject({
  id: TabId,
  title: v.string(),
  url: v.string(),
  loading: v.boolean(),
  canGoBack: v.boolean(),
  canGoForward: v.boolean(),
});
/** One tab as the shell displays it. */
export type TabView = v.InferOutput<typeof TabView>;

/** Everything the shell renders. Sent as a whole after changes, at most once per frame. */
export const ShellState = v.strictObject({
  tabs: v.array(TabView),
  activeTabId: v.nullable(TabId),
});
/** Everything the shell renders. */
export type ShellState = v.InferOutput<typeof ShellState>;

const TabRequest = v.strictObject({ tabId: TabId });

/** Returns the current state; the shell calls it once at startup. */
export const GetShellState = defineRequest({
  channel: 'shell.getState',
  request: Empty,
  response: ShellState,
  capability: 'shell',
});

/** Opens a new tab, optionally with a URL or search input. */
export const OpenTab = defineRequest({
  channel: 'tabs.open',
  request: v.strictObject({ input: v.optional(v.pipe(v.string(), v.maxLength(8192))) }),
  response: v.strictObject({ tabId: TabId }),
  capability: 'shell',
});

/** Shows a tab. */
export const ActivateTab = defineRequest({
  channel: 'tabs.activate',
  request: TabRequest,
  response: Done,
  capability: 'shell',
});

/** Closes a tab. */
export const CloseTab = defineRequest({
  channel: 'tabs.close',
  request: TabRequest,
  response: Done,
  capability: 'shell',
});

/** Reopens the most recently closed tab. */
export const ReopenClosedTab = defineRequest({
  channel: 'tabs.reopenClosed',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/** Navigates a tab to what the user typed in the address bar. */
export const NavigateTab = defineRequest({
  channel: 'tabs.navigate',
  request: v.strictObject({
    tabId: TabId,
    input: v.pipe(v.string(), v.minLength(1), v.maxLength(8192)),
  }),
  response: Done,
  capability: 'shell',
});

/** History and loading actions of a tab. */
export const TabAction = defineRequest({
  channel: 'tabs.action',
  request: v.strictObject({
    tabId: TabId,
    action: v.picklist(['back', 'forward', 'reload', 'stop']),
  }),
  response: Done,
  capability: 'shell',
});

/** Space the shell occupies at the window edges, in CSS pixels; web content fills the rest. */
export const SetShellInsets = defineRequest({
  channel: 'shell.setInsets',
  request: v.strictObject({
    top: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    right: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    bottom: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    left: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
  }),
  response: Done,
  capability: 'shell',
  ratePerSecond: 120,
});

/** Sent to the shell when its state changed. */
export const ShellStateChanged = defineEvent({
  channel: 'shell.stateChanged',
  payload: ShellState,
  capability: 'shell',
});

/** Asks the shell to run a UI command, such as focusing the address bar after a shortcut. */
export const ShellCommand = defineEvent({
  channel: 'shell.command',
  payload: v.picklist(['omnibox.focus']),
  capability: 'shell',
});

/** Every request contract of the shell, for registration and for the preload bridge. */
export const shellRequests: readonly RequestContract<unknown, unknown>[] = [
  GetShellState,
  OpenTab,
  ActivateTab,
  CloseTab,
  ReopenClosedTab,
  NavigateTab,
  TabAction,
  SetShellInsets,
];
