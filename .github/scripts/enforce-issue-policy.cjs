'use strict';

const POLICY_URL = 'https://github.com/Moekotori/ECHO/blob/main/.github/ISSUE_POLICY.md';
const POLICY_LABEL = 'policy-closed';
const EXEMPT_LABEL = 'policy-exempt';

const REQUIRED_CHECKS = [
  ['我已经给本仓库点了公开可见的 Star', 'I have publicly starred this repository'],
  ['这不是流媒体或第三方音乐平台相关内容', 'This is not about streaming or third-party music platforms'],
  ['这是真实的缺陷或功能请求，不是找茬、嘲讽或发泄', 'This is a real bug or feature request, not nitpicking, mockery, or venting'],
];

const STREAMING_PATTERNS = [
  /网易云/,
  /qq\s*音乐/i,
  /酷狗/,
  /酷我/,
  /汽水音乐/,
  /咪咕/,
  /\bspotify\b/i,
  /youtube\s*music/i,
  /youtube\.com/i,
  /油管/,
  /\byt-?dlp\b/i,
  /\bytdl\b/i,
  /\bsoundcloud\b/i,
  /\btidal\b/i,
  /\bqobuz\b/i,
  /apple\s*music/i,
  /苹果音乐/,
  /\bdeezer\b/i,
  /哔哩哔哩/,
  /\bbilibili\b/i,
  /b\s*站/,
  /扫码登录/,
  /导入\s*cookie/i,
  /cookie\s*导入/i,
  /歌单下载/,
  /下载歌曲/,
  /解析下载/,
  /流媒体平台/,
  /第三方音乐平台/,
  /在线听歌平台/,
  /streaming\s+platform/i,
  /third[-\s]*party\s+music\s+platform/i,
];

const NITPICK_PATTERNS = [
  /垃圾软件/,
  /垃圾项目/,
  /辣鸡/,
  /骗子/,
  /骗钱/,
  /割韭菜/,
  /傻逼/,
  /傻b/i,
  /智障/,
  /废物/,
  /脑残/,
  /弱智/,
  /答辩/,
  /一眼\s*ai/i,
  /闭源骗钱/,
];

const CLOSE_COMMENTS = {
  'no-star': `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭并锁定。

**原因：提交前没有公开 Star 本仓库。**

请先给本仓库点公开可见的 Star，再使用「错误报告」或「功能请求」模板重新提交。隐藏 Star 列表会检查失败。补 Star 不会让本 Issue 自动重开。

This issue was closed because the author has not publicly starred the repository. Star it publicly, then open a new issue with the correct template.`,

  streaming: `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭并锁定。

**原因：流媒体 / 第三方音乐平台相关内容不会被回复。**

网易云、QQ 音乐、Spotify、YouTube、yt-dlp、Cookie / 扫码登录、歌单下载等内容请不要再开。本地文件、曲库、DSP 和用户自己的网盘 / NAS / Jellyfin 不在此列。

Streaming and third-party music-platform topics are out of scope and will not receive a reply.`,

  nitpick: `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭并锁定。

**原因：找茬、嘲讽或发泄内容不会被回复。**

有真实缺陷请换正常语气，带上复现步骤和日志重新开。对着人喷、空骂、抬杠的 Issue 会直接关掉。

Nitpicking, mockery, and venting will not receive a reply.`,

  template: `这个 Issue 已按 [Issue 规范](${POLICY_URL}) 自动关闭并锁定。

**原因：没有使用规定模板，或删改了必须勾选的规范项。**

请使用「错误报告」或「功能请求」模板，勾选全部规范确认项后重新提交。不要使用「不要用这个模板」那一项。

Use the Bug Report or Feature Request template and check every required policy box.`,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isChecked(body, label) {
  return new RegExp(`- \\[[xX]\\][^\\n]*${escapeRegExp(label)}`, 'i').test(body);
}

function hasStreamingContent(text) {
  return STREAMING_PATTERNS.some((pattern) => pattern.test(text));
}

function hasNitpickContent(text) {
  return NITPICK_PATTERNS.some((pattern) => pattern.test(text));
}

function missingPolicyChecks(body) {
  return REQUIRED_CHECKS.some((variants) => !variants.some((label) => isChecked(body, label)));
}

function usedDummyTemplate(text) {
  return /不要用这个模板/.test(text);
}

function contentForScan(title, body) {
  const stripped = (body || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*-\s*\[[ xX]\]/.test(line))
    .join('\n');
  return `${title || ''}\n${stripped}`;
}

function classifyIssue({ title, body, starred }) {
  const safeBody = body || '';
  const scanned = contentForScan(title, safeBody);
  if (hasNitpickContent(scanned)) {
    return 'nitpick';
  }
  if (hasStreamingContent(scanned)) {
    return 'streaming';
  }
  if (starred === false) {
    return 'no-star';
  }
  if (usedDummyTemplate(scanned) || missingPolicyChecks(safeBody)) {
    return 'template';
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
  try {
    await github.rest.issues.lock({
      owner,
      repo,
      issue_number: issueNumber,
      lock_reason: reason === 'nitpick' ? 'too heated' : 'off-topic',
    });
  } catch (error) {
    if (error.status !== 400 && error.status !== 403) {
      throw error;
    }
  }
}

module.exports = async function enforceIssuePolicy({ github, context, core }) {
  const issue = context.payload.issue;
  if (!issue || context.payload.pull_request) {
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
