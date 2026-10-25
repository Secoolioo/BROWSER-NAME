/**
 * Checks the commits of a pull request: one author per pull request and
 * no trailers in any commit message. Merge commits are ignored because
 * squash merging discards them.
 *
 * Usage: `node tools/ci/check-commits.ts <base-sha> <head-sha>`
 */
import { execFileSync } from 'node:child_process';

/** A commit as read from `git log`. */
interface CommitInfo {
  readonly sha: string;
  readonly authorEmail: string;
  readonly parents: number;
  readonly message: string;
}

const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';

/**
 * Reads the commits between two revisions.
 * @param base - Base revision (exclusive).
 * @param head - Head revision (inclusive).
 */
function readCommits(base: string, head: string): CommitInfo[] {
  const format = ['%H', '%ae', '%P', '%B'].join(FIELD_SEPARATOR) + RECORD_SEPARATOR;
  const output = execFileSync('git', ['log', `--format=${format}`, `${base}..${head}`], {
    encoding: 'utf8',
  });
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha = '', authorEmail = '', parents = '', message = ''] =
        record.split(FIELD_SEPARATOR);
      return {
        sha,
        authorEmail: authorEmail.toLowerCase(),
        parents: parents.split(' ').filter(Boolean).length,
        message,
      };
    });
}

/**
 * Returns the trailers git finds in a commit message.
 * @param message - The full commit message.
 */
function trailersOf(message: string): string[] {
  const output = execFileSync('git', ['interpret-trailers', '--parse'], {
    input: message,
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line.trim().length > 0);
}

function main(): number {
  const [base, head] = process.argv.slice(2);
  if (base === undefined || head === undefined) {
    console.error('Usage: node tools/ci/check-commits.ts <base-sha> <head-sha>');
    return 2;
  }
  const commits = readCommits(base, head).filter((commit) => commit.parents < 2);
  const problems: string[] = [];

  const authors = new Set(commits.map((commit) => commit.authorEmail));
  if (authors.size > 1) {
    problems.push(`Commits come from ${authors.size} authors; one pull request needs one author.`);
  }
  for (const commit of commits) {
    const trailers = trailersOf(commit.message);
    if (trailers.length > 0) {
      problems.push(`${commit.sha.slice(0, 12)} has trailers: ${trailers.join('; ')}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`✖ ${problem}`);
    }
    return 1;
  }
  console.log(`✔ ${commits.length} commit(s) checked`);
  return 0;
}

process.exitCode = main();
