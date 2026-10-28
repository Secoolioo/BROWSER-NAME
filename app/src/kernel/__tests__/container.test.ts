import { describe, expect, it, vi } from 'vitest';
import { Container, ContainerError } from '../di/container.ts';
import { token } from '../di/token.ts';

interface Greeter {
  greet(): string;
}
const NameToken = token<string>('Name');
const GreeterToken = token<Greeter>('Greeter');

class HelloGreeter implements Greeter {
  static readonly inject = [NameToken] as const;
  private readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return `Hello ${this.name}`;
  }
}

class Tracked {
  static readonly inject = [] as const;
  readonly dispose = vi.fn();
}
const TrackedToken = token<Tracked>('Tracked');

describe('Container', () => {
  it('resolves values, factories and classes', () => {
    const container = new Container()
      .registerValue(NameToken, 'World')
      .registerClass(GreeterToken, HelloGreeter);
    expect(container.resolve(GreeterToken).greet()).toBe('Hello World');
    const LengthToken = token<number>('Length');
    container.registerFactory(LengthToken, (c) => c.resolve(NameToken).length);
    expect(container.resolve(LengthToken)).toBe(5);
  });

  it('reuses singletons and creates transients every time', () => {
    const FreshToken = token<object>('Fresh');
    const container = new Container()
      .registerClass(TrackedToken, Tracked)
      .registerFactory(FreshToken, () => ({}), 'transient');
    expect(container.resolve(TrackedToken)).toBe(container.resolve(TrackedToken));
    expect(container.resolve(FreshToken)).not.toBe(container.resolve(FreshToken));
  });

  it('shares singletons with children and scopes scoped instances per child', () => {
    const ScopedToken = token<object>('Scoped');
    const parent = new Container()
      .registerClass(TrackedToken, Tracked)
      .registerFactory(ScopedToken, () => ({}), 'scoped');
    const a = parent.createChild();
    const b = parent.createChild();
    expect(a.resolve(TrackedToken)).toBe(b.resolve(TrackedToken));
    expect(a.resolve(ScopedToken)).not.toBe(b.resolve(ScopedToken));
    expect(a.resolve(ScopedToken)).toBe(a.resolve(ScopedToken));
  });

  it('builds singletons in the registering container so they cannot capture child services', () => {
    const parent = new Container().registerClass(GreeterToken, HelloGreeter);
    const child = parent.createChild().registerValue(NameToken, 'Child');
    expect(() => child.resolve(GreeterToken)).toThrow(/Nothing provides Greeter -> Name/);
  });

  it('lets a child shadow a parent registration', () => {
    const parent = new Container().registerValue(NameToken, 'Parent');
    const child = parent.createChild().registerValue(NameToken, 'Child');
    expect(child.resolve(NameToken)).toBe('Child');
    expect(parent.resolve(NameToken)).toBe('Parent');
  });

  it('reports missing registrations, duplicates and cycles', () => {
    const container = new Container();
    expect(() => container.resolve(NameToken)).toThrow(ContainerError);
    expect(container.tryResolve(NameToken)).toBeUndefined();
    container.registerValue(NameToken, 'x');
    expect(() => container.registerValue(NameToken, 'y')).toThrow(/already registered/);
    const A = token<unknown>('A');
    const B = token<unknown>('B');
    container.registerFactory(A, (c) => c.resolve(B));
    container.registerFactory(B, (c) => c.resolve(A));
    expect(() => container.resolve(A)).toThrow('Dependency cycle: A -> B -> A');
  });

  it('instantiates unregistered classes and owns them', () => {
    const container = new Container().registerValue(NameToken, 'You');
    expect(container.instantiate(HelloGreeter).greet()).toBe('Hello You');
    const tracked = container.instantiate(Tracked);
    container.dispose();
    expect(tracked.dispose).toHaveBeenCalledOnce();
  });

  it('disposes children first, then owned instances in reverse order, but not values', () => {
    const order: string[] = [];
    const value = { dispose: vi.fn() };
    const FirstToken = token<object>('First');
    const SecondToken = token<object>('Second');
    const parent = new Container()
      .registerValue(token<typeof value>('Value'), value)
      .registerFactory(FirstToken, () => ({ dispose: () => order.push('first') }))
      .registerFactory(SecondToken, () => ({ dispose: () => order.push('second') }));
    parent.resolve(FirstToken);
    parent.resolve(SecondToken);
    const child = parent.createChild();
    child.instantiate(
      class {
        static readonly inject = [] as const;
        dispose(): void {
          order.push('child');
        }
      },
    );
    parent.dispose();
    expect(order).toEqual(['child', 'second', 'first']);
    expect(value.dispose).not.toHaveBeenCalled();
    expect(child.isDisposed).toBe(true);
    expect(() => parent.resolve(FirstToken)).toThrow(/disposed/);
    expect(() => parent.dispose()).not.toThrow();
  });

  it('keeps disposing when an instance throws and reports the errors', () => {
    const container = new Container();
    const later = vi.fn();
    container.instantiate(
      class {
        static readonly inject = [] as const;
        dispose = later;
      },
    );
    container.instantiate(
      class {
        static readonly inject = [] as const;
        dispose(): void {
          throw new Error('boom');
        }
      },
    );
    expect(() => container.dispose()).toThrow(AggregateError);
    expect(later).toHaveBeenCalledOnce();
  });
});
