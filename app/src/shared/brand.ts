/**
 * Product names and identifiers. They come from `brand.json` at the repository root and
 * are injected at build time, so renaming the product is a change of one file.
 */
export interface Brand {
  /** Display name, such as `Lampo`. */
  readonly productName: string;
  /** Lowercase name for files, packages and paths, such as `lampo`. */
  readonly slug: string;
  /** Reverse-DNS application id, also the macOS bundle id. */
  readonly appId: string;
  /** GitHub repository, `owner/name`. */
  readonly repository: string;
  /** Website URL with a trailing slash. */
  readonly website: string;
  readonly tagline: string;
}

declare const BUILD_BRAND: Brand;

/** The product's names and identifiers. */
export const brand: Brand = BUILD_BRAND;
