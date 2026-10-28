import { isDisposable, type Disposable } from '../../shared/disposable.ts';
import type { Token, TokenTypes } from './token.ts';

/**
 * How long an instance created by the container lives.
 * - `singleton`: one instance in the container that holds the registration, shared by
 *   all child containers.
 * - `scoped`: one instance per container that resolves it (for example one per window
 *   or per module).
 * - `transient`: a new instance on every resolution.
 */
export type Lifetime = 'singleton' | 'scoped' | 'transient';

/**
 * A class that the container can construct. Its static `inject` list names the tokens
 * passed to the constructor, in order. There is no reflection and no decorator.
 *
 * @example
 * ```ts
 * class TabService {
 *   static readonly inject = [LoggerToken, ClockToken] as const;
 *   constructor(private readonly logger: Logger, private readonly clock: Clock) {}
 * }
 * ```
 */
export interface InjectableClass<
  T,
  D extends readonly Token<unknown>[] = readonly Token<unknown>[],
> {
  /** Tokens resolved and passed to the constructor, in order. */
  readonly inject: D;
  new (...args: TokenTypes<D>): T;
}

/** Describes how the container obtains the value for a token. */
export type Provider<T> =
  | { readonly useValue: T }
  | {
      /** Creates the value; it may resolve other tokens from the container. */
      readonly useFactory: (container: Container) => T;
      readonly lifetime?: Lifetime;
    }
  | { readonly useClass: InjectableClass<T>; readonly lifetime?: Lifetime };

/** Thrown for missing registrations, duplicate registrations and dependency cycles. */
export class ContainerError extends Error {
  override readonly name = 'ContainerError';
}

interface Registration {
  readonly token: Token<unknown>;
  readonly provider: Provider<unknown>;
  readonly lifetime: Lifetime;
}

/**
 * A small, typed dependency injection container with constructor injection, lifetimes
 * and child containers.
 *
 * Instances that the container creates and that implement {@link Disposable} are owned by
 * the container and disposed with it, in reverse order of creation. Values registered with
 * `useValue` stay owned by the caller.
 */
export class Container implements Disposable {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly instances = new Map<symbol, unknown>();
  private readonly owned: Disposable[] = [];
  private readonly children = new Set<Container>();
  private readonly resolving: Token<unknown>[] = [];
  private readonly parent: Container | undefined;
  private disposed = false;

  /**
   * Creates a root container. Use {@link Container.createChild} for child containers.
   * @param parent - Parent container; only used by `createChild`.
   */
  constructor(parent?: Container) {
    this.parent = parent;
  }

  /**
   * Registers a provider for a token in this container. A child may register a token that
   * a parent already provides; the child's registration then wins inside the child.
   * @param token - The token to provide.
   * @param provider - How to obtain the value.
   * @returns This container, for chaining.
   * @throws ContainerError if the token is already registered in this container.
   */
  register<T>(token: Token<T>, provider: Provider<T>): this {
    this.assertNotDisposed();
    if (this.registrations.has(token.id)) {
      throw new ContainerError(`${token.name} is already registered`);
    }
    const lifetime = 'useValue' in provider ? 'singleton' : (provider.lifetime ?? 'singleton');
    this.registrations.set(token.id, { token, provider, lifetime });
    return this;
  }

  /**
   * Registers a fixed value.
   * @param token - The token to provide.
   * @param value - The value; the container does not dispose it.
   */
  registerValue<T>(token: Token<T>, value: T): this {
    return this.register(token, { useValue: value });
  }

  /**
   * Registers a factory function.
   * @param token - The token to provide.
   * @param factory - Creates the value; receives the resolving container.
   * @param lifetime - Defaults to `singleton`.
   */
  registerFactory<T>(
    token: Token<T>,
    factory: (container: Container) => T,
    lifetime: Lifetime = 'singleton',
  ): this {
    return this.register(token, { useFactory: factory, lifetime });
  }

  /**
   * Registers a class. The type checker verifies that the class's `inject` list matches
   * its constructor parameters.
   * @param token - The token to provide.
   * @param useClass - The class to construct.
   * @param lifetime - Defaults to `singleton`.
   */
  registerClass<T, D extends readonly Token<unknown>[]>(
    token: Token<T>,
    useClass: InjectableClass<T, D>,
    lifetime: Lifetime = 'singleton',
  ): this {
    return this.register(token, { useClass: useClass as InjectableClass<T>, lifetime });
  }

  /**
   * Tells whether this container or one of its parents provides the token.
   * @param token - The token to look up.
   */
  has(token: Token<unknown>): boolean {
    return this.findRegistration(token) !== undefined;
  }

  /**
   * Returns the value for a token, creating it if needed.
   * @param token - The token to resolve.
   * @throws ContainerError if nothing provides the token, or on a dependency cycle.
   */
  resolve<T>(token: Token<T>): T {
    this.assertNotDisposed();
    const found = this.findRegistration(token);
    if (found === undefined) {
      throw new ContainerError(`Nothing provides ${this.describePath(token)}`);
    }
    const [registration, owner] = found;
    if ('useValue' in registration.provider) {
      return registration.provider.useValue as T;
    }
    // Singletons are built in the container that registered them, so they can never
    // capture scoped instances of a child.
    const context = registration.lifetime === 'singleton' ? owner : this;
    const cached = registration.lifetime !== 'transient';
    if (cached && context.instances.has(token.id)) {
      return context.instances.get(token.id) as T;
    }
    const value = context.create(registration) as T;
    if (cached) {
      context.instances.set(token.id, value);
    }
    return value;
  }

  /**
   * Like {@link Container.resolve}, but returns `undefined` when nothing provides the
   * token. Cycles and errors thrown while creating the value still propagate.
   * @param token - The token to resolve.
   */
  tryResolve<T>(token: Token<T>): T | undefined {
    return this.has(token) ? this.resolve(token) : undefined;
  }

  /**
   * Constructs a class with dependencies from this container without registering it. The
   * instance is owned by this container.
   * @param useClass - The class to construct.
   */
  instantiate<T, D extends readonly Token<unknown>[]>(useClass: InjectableClass<T, D>): T {
    this.assertNotDisposed();
    const args = useClass.inject.map((dependency) => this.resolve(dependency));
    const instance = new useClass(...(args as unknown as TokenTypes<D>));
    this.own(instance);
    return instance;
  }

  /**
   * Creates a child container. It sees all registrations of this container and can add
   * or shadow its own. Disposing this container disposes its children first.
   */
  createChild(): Container {
    this.assertNotDisposed();
    const child = new Container(this);
    this.children.add(child);
    return child;
  }

  /** Whether {@link Container.dispose} has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Disposes child containers, then every owned instance in reverse order of creation.
   * @throws AggregateError when one or more instances failed to dispose.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    const errors: unknown[] = [];
    for (const child of [...this.children].toReversed()) {
      try {
        child.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.disposed = true;
    for (const item of this.owned.splice(0).toReversed()) {
      try {
        item.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.instances.clear();
    this.parent?.children.delete(this);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Disposing the container failed');
    }
  }

  private create(registration: Registration): unknown {
    const { token, provider } = registration;
    if (this.resolving.includes(token)) {
      throw new ContainerError(`Dependency cycle: ${this.describePath(token)}`);
    }
    this.resolving.push(token);
    try {
      let value: unknown;
      if ('useFactory' in provider) {
        value = provider.useFactory(this);
      } else if ('useClass' in provider) {
        const args = provider.useClass.inject.map((dependency) => this.resolve(dependency));
        value = new provider.useClass(...args);
      }
      this.own(value);
      return value;
    } finally {
      this.resolving.pop();
    }
  }

  private own(value: unknown): void {
    if (isDisposable(value)) {
      this.owned.push(value);
    }
  }

  private findRegistration(token: Token<unknown>): [Registration, Container] | undefined {
    const registration = this.registrations.get(token.id);
    if (registration !== undefined) {
      return [registration, this];
    }
    return this.parent?.findRegistration(token);
  }

  private describePath(token: Token<unknown>): string {
    return [...this.resolving, token].map((t) => t.name).join(' -> ');
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new ContainerError('The container is disposed');
    }
  }
}
