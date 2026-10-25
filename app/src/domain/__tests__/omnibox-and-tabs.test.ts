import { describe, expect, it, vi } from 'vitest';
import { resolveOmniboxInput } from '../navigation/omnibox.ts';
import { TabService, type TabViewPort } from '../tabs/tab-service.ts';

const template = 'https://search.example/?q=%s';

describe('resolveOmniboxInput', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  sub.example.co.uk/path?q=1 ', 'https://sub.example.co.uk/path?q=1'],
    ['localhost:3000', 'http://localhost:3000'],
    ['192.168.1.10/admin', 'http://192.168.1.10/admin'],
    ['[::1]:8080', 'http://[::1]:8080'],
    ['https://example.com/a b'.replace(' ', '%20'), 'https://example.com/a%20b'],
    ['about:blank', 'about:blank'],
    ['app://settings/#tabs.position', 'app://settings/#tabs.position'],
  ])('opens %s as a URL', (input, url) => {
    expect(resolveOmniboxInput(input, template)).toEqual({ kind: 'url', url });
  });

  it.each([
    ['how fast is astela', 'how%20fast%20is%20astela'],
    ['javascript:alert(1)', 'javascript%3Aalert(1)'],
    ['data:text/html,hi', 'data%3Atext%2Fhtml%2Chi'],
    ['singleword', 'singleword'],
    ['https://exa mple.com', 'https%3A%2F%2Fexa%20mple.com'],
    ['3.14', '3.14'],
    ['C++ templates', 'C%2B%2B%20templates'],
  ])('searches for %s', (input, encoded) => {
    expect(resolveOmniboxInput(input, template)).toEqual({
      kind: 'search',
      query: input.trim(),
      url: `https://search.example/?q=${encoded}`,
    });
  });

  it('ignores blank input', () => {
    expect(resolveOmniboxInput('   ', template)).toBeUndefined();
  });

  it('treats host:port as a host, not as a scheme', () => {
    expect(resolveOmniboxInput('example.com:8443/x', template)).toEqual({
      kind: 'url',
      url: 'https://example.com:8443/x',
    });
  });
});

class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  create(id: string, url: string): void {
    this.log.push(`create ${id} ${url}`);
  }
  show(id: string): void {
    this.log.push(`show ${id}`);
  }
  destroy(id: string): void {
    this.log.push(`destroy ${id}`);
  }
  load(id: string, url: string): void {
    this.log.push(`load ${id} ${url}`);
  }
  run(id: string, action: string): void {
    this.log.push(`${action} ${id}`);
  }
}

describe('TabService', () => {
  it('opens tabs after the active one and activates them', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/', { activate: false });
    tabs.activate(a);
    const c = tabs.open();
    expect(tabs.all.map((t) => t.id)).toEqual([a, c, b]);
    expect(tabs.active?.id).toBe(c);
    expect(views.log).toEqual([
      `create ${a} https://a.example/`,
      `show ${a}`,
      `create ${b} https://b.example/`,
      `create ${c} about:blank`,
      `show ${c}`,
    ]);
  });

  it('activates the right neighbour on close, then the left one, and keeps one tab', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    const c = tabs.open('https://c.example/');
    tabs.activate(b);
    tabs.close(b);
    expect(tabs.active?.id).toBe(c);
    tabs.close(c);
    expect(tabs.active?.id).toBe(a);
    tabs.close(a);
    expect(tabs.all).toHaveLength(1);
    expect(tabs.active?.url).toBe('about:blank');
  });

  it('closes inactive tabs without changing the active one', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    tabs.close(a);
    expect(tabs.active?.id).toBe(b);
  });

  it('reopens closed tabs in reverse order and keeps at most 25', () => {
    const tabs = new TabService(new FakeViews(), 'about:blank');
    for (let i = 0; i < 30; i += 1) {
      tabs.close(tabs.open(`https://${i}.example/`));
    }
    const reopened: string[] = [];
    for (let id = tabs.reopenClosed(); id !== undefined; id = tabs.reopenClosed()) {
      reopened.push(tabs.all.find((t) => t.id === id)?.url ?? '');
    }
    expect(reopened).toHaveLength(25);
    expect(reopened[0]).toBe('https://29.example/');
    expect(reopened.at(-1)).toBe('https://5.example/');
  });

  it('forwards navigation and actions and applies view updates', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const id = tabs.open();
    const listener = vi.fn();
    tabs.onDidChange(listener);
    tabs.navigate(id, 'https://example.com/');
    tabs.run(id, 'reload');
    tabs.update(id, { title: 'Example', loading: false });
    tabs.update(id, { title: 'Example' });
    tabs.update('t999', { title: 'x' });
    expect(views.log.slice(-2)).toEqual([`load ${id} https://example.com/`, `reload ${id}`]);
    expect(tabs.active).toMatchObject({ title: 'Example', loading: false });
    expect(listener).toHaveBeenCalledOnce();
    expect(() => tabs.activate('t999')).toThrow('Unknown tab t999');
  });

  it('destroys every view on dispose', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open();
    const b = tabs.open();
    tabs.dispose();
    expect(views.log.filter((l) => l.startsWith('destroy'))).toEqual([
      `destroy ${a}`,
      `destroy ${b}`,
    ]);
  });
});
