declare const BUILD_UPDATE_KEYS: readonly string[];

/**
 * Public Ed25519 keys in PEM format that verify the update feed, injected at build time
 * from `app/build/keys`. Empty in builds without keys, which therefore never update.
 */
export const updateKeys: readonly string[] = BUILD_UPDATE_KEYS;
