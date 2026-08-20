'use strict';

const POLICY_URL = 'https://github.com/Moekotori/ECHO/blob/main/.github/ISSUE_POLICY.md';
const POLICY_LABEL = 'policy-closed';
const EXEMPT_LABEL = 'policy-exempt';

const STREAMING_PLATFORMS = [
  /网易云/,
  /qq\s*音乐/i,
  /酷狗音乐/,
  /酷我音乐/,
  /汽水音乐/,
  /咪咕音乐/,
  /\bspotify\b/i,
  /youtube\s*music/i,
  /\bsoundcloud\b/i,
  /\bqobuz\b/i,
  /apple\s*music/i,
  /苹果音乐/,
  /\bdeezer\b/i,
  /哔哩哔哩/,
  /\bbilibili\b/i,
];

const EXPLICIT_STREAMING_TOOLS = [
  /\byt-?dlp\b/i,
  /歌单下载/,
  /解析下载/,
];

const STREAMING_INTENT = [
  /(请|希望|想要|求)\s*支持/,
  /登录/,
  /解析/,
  /在线播放/,
  /搜歌/,
  /下载歌曲/,
  /导入\s*cookie/i,
  /cookie\s*导入/i,
  /第三方音乐平台/,
  /流媒体平台/,
];

const ABUSE_PATTERNS = [
  /垃圾软件/,
  /垃圾项目/,
  /傻逼/,
  /傻b/i,
  /智障/,
  /脑残/,
  /弱智/,
  /割韭菜/,
  /闭源骗钱/,
];

const CLOSE_COMMENTS = {
  'no-star': `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭。

**原因：没有检测到你对本仓库的公开 Star。**

请先公开 Star，再用模板重开。如果你其实已经 Star、只是隐藏了 Star 列表，在下面留一句即可，维护者会重开。

This was closed because a public star was not detected. If you already starred privately, comment here and a maintainer can reopen it.`,

  streaming: `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭。

**原因：这看起来是在反馈第三方流媒体平台能力。**

本地文件、曲库、DSP，以及用户自己的网盘 / NAS / Jellyfin 不在此列。若只是提到某平台、实际在说本地文件，请评论说明，维护者会重开。

Streaming-platform feature requests are out of scope. If this was a local-playback bug, comment and a maintainer can reopen it.`,

  nitpick: `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭。

**原因：包含明确的辱骂或人身攻击。**

有真实缺陷请换正常语气、带上复现步骤重开。若这是误判，请评论说明。

Clear abuse is not answered. If this was a false positive, comment and a maintainer can reopen it.`,
};

function hasStreamingRequest(text) {
  if (EXPLICIT_STREAMING_TOOLS.some((pattern) => pattern.test(text))) {
    return true;
  }
  const hasPlatform = STREAMING_PLATFORMS.some((pattern) => pattern.test(text));
  const hasIntent = STREAMING_INTENT.some((pattern) => pattern.test(text));
  return hasPlatform && hasIntent;
}

function hasAbuseContent(text) {
  return ABUSE_PATTERNS.some((pattern) => pattern.test(text));
}

function contentForScan(title, body) {
  const stripped = (body || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*-\s*\[[ xX]\]/.test(line))
    .join('\n');
  return `${title || ''}\n${stripped}`;
}

function classifyIssue({ title, body, starred }) {
  const scanned = contentForScan(title, body || '');
  if (hasAbuseContent(scanned)) {
    return 'nitpick';
  }
  if (hasStreamingRequest(scanned)) {
    return 'streaming';
  }
  if (starred === false) {
    return 'no-star';
  }
  return null;
}

async function hasPublicStar(github, owner, repo, username) {
  try {
    await github.request('GET /users/{username}/starred/{owner}/{repo}', {
      username,
      owner,
      repo,
    });
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

async function isPrivileged(github, owner, repo, username) {
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    return ['admin', 'maintain', 'write'].includes(data.permission);
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

async function ensureLabel(github, owner, repo) {
  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: POLICY_LABEL,
      color: 'b60205',
      description: 'Closed automatically for Issue policy violation',
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function closeForPolicy(github, owner, repo, issueNumber, reason) {
  await ensureLabel(github, owner, repo);
  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [POLICY_LABEL],
  });
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: CLOSE_COMMENTS[reason],
  });
  await github.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
    state_reason: 'not_planned',
  });
}

module.exports = async function enforceIssuePolicy({ github, context, core }) {
  const issue = context.payload.issue;
  if (!issue || context.payload.pull_request) {
    return;
  }
  if (context.payload.action && context.payload.action !== 'opened') {
    core.info(`Skip action ${context.payload.action}`);
    return;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const username = issue.user.login;
  const labels = (issue.labels || []).map((label) => label.name);

  if (issue.user.type === 'Bot') {
    core.info(`Skip bot issue from ${username}`);
    return;
  }
  if (labels.includes(EXEMPT_LABEL)) {
    core.info(`Skip ${EXEMPT_LABEL} issue #${issue.number}`);
    return;
  }
  if (issue.state === 'closed' && labels.includes(POLICY_LABEL)) {
    core.info(`Issue #${issue.number} already closed by policy`);
    return;
  }
  if (await isPrivileged(github, owner, repo, username)) {
    core.info(`Skip privileged user ${username}`);
    return;
  }

  const textReason = classifyIssue({
    title: issue.title,
    body: issue.body,
    starred: true,
  });
  const reason = textReason
    || ((await hasPublicStar(github, owner, repo, username)) ? null : 'no-star');

  if (!reason) {
    core.info(`Issue #${issue.number} passed policy checks`);
    return;
  }

  core.warning(`Closing issue #${issue.number} for ${reason}`);
  await closeForPolicy(github, owner, repo, issue.number, reason);
};

module.exports.classifyIssue = classifyIssue;
module.exports.hasStreamingRequest = hasStreamingRequest;
