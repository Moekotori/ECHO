import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

const upstreamRemote = process.env.ECHO_UPSTREAM_REMOTE || 'origin';
const forkRemote = process.env.ECHO_FORK_REMOTE || 'fork';
const upstreamBranch = process.env.ECHO_UPSTREAM_BRANCH || 'main';
const forkBranch = process.env.ECHO_FORK_BRANCH || 'main';

const upstreamRef = `${upstreamRemote}/${upstreamBranch}`;
const forkRef = `${forkRemote}/${forkBranch}`;

const runGit = (args, { inherit = false, allowFailure = false } = {}) => {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim();
    const suffix = stderr ? `\n${stderr}` : '';
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}${suffix}`);
  }

  return result;
};

const ensureRemote = (remoteName) => {
  runGit(['remote', 'get-url', remoteName]);
};

const hasRemoteRef = (remoteName, branchName) => {
  const ref = `refs/remotes/${remoteName}/${branchName}`;
  return runGit(['show-ref', '--verify', '--quiet', ref], { allowFailure: true }).status === 0;
};

const revListCounts = () => {
  const result = runGit(['rev-list', '--left-right', '--count', `${upstreamRef}...${forkRef}`]);
  const [leftText, rightText] = result.stdout.trim().split(/\s+/);
  const left = Number.parseInt(leftText, 10);
  const right = Number.parseInt(rightText, 10);

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error(`Unable to parse rev-list counts: ${result.stdout.trim()}`);
  }

  return { left, right };
};

ensureRemote(upstreamRemote);
ensureRemote(forkRemote);

console.log(`[sync:fork-base] Fetching ${upstreamRemote} ${upstreamBranch}.`);
runGit(['fetch', upstreamRemote, upstreamBranch], { inherit: true });

console.log(`[sync:fork-base] Fetching ${forkRemote} ${forkBranch}.`);
runGit(['fetch', forkRemote, forkBranch], { inherit: true });

if (!hasRemoteRef(forkRemote, forkBranch)) {
  throw new Error(`[sync:fork-base] ${forkRef} was not found after fetch.`);
}

let { left, right } = revListCounts();
console.log(`[sync:fork-base] ${upstreamRef}...${forkRef} ${left} ${right}`);

if (right > 0) {
  throw new Error(
    `[sync:fork-base] ${forkRef} has ${right} commit(s) not in ${upstreamRef}; refusing to overwrite fork base.`,
  );
}

if (left > 0) {
  console.log(`[sync:fork-base] Fast-forwarding ${forkRef} to ${upstreamRef}.`);
  runGit(['push', forkRemote, `refs/remotes/${upstreamRef}:refs/heads/${forkBranch}`], { inherit: true });
  runGit(['fetch', forkRemote, forkBranch], { inherit: true });
  ({ left, right } = revListCounts());
  console.log(`[sync:fork-base] ${upstreamRef}...${forkRef} ${left} ${right}`);
}

if (left !== 0 || right !== 0) {
  throw new Error(`[sync:fork-base] ${forkRef} is still not synchronized with ${upstreamRef}.`);
}

console.log(`[sync:fork-base] ${forkRef} is synchronized with ${upstreamRef}.`);
