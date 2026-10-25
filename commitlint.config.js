/**
 * Commit message rules: Conventional Commits, no trailers.
 * Breaking changes are marked with `!` in the header.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-empty': [2, 'always'],
    'scope-case': [2, 'always', 'kebab-case'],
  },
};
