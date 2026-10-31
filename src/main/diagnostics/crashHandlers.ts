import { app, BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { getCrashReportService } from './CrashReportService';
import { showCrashRecoveryDialog } from './CrashRecoveryDialog';
import { recordMainRuntimeIssue } from './DevConsoleService';
import { sanitizeLogPayload } from './Logger';
import { recoverClosedHelperPipe, type RuntimeSelfHealSource } from './RuntimeSelfHeal';

const errorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }

  return typeof value === 'string' ? value : JSON.stringify(sanitizeLogPayload(value));
};

const errorStack = (value: unknown): string | undefined => (value instanceof Error ? value.stack : undefined);

const safeRead = <T>(reader: () => T, fallback: T): T => {
  try {
    return reader();
  } catch {
    return fallback;
  }
};

const webContentsInfo = (webContents: WebContents): unknown => ({
  id: safeRead(() => webContents.id, -1),
  url: safeRead(() => webContents.getURL(), 'unavailable'),
  title: safeRead(() => webContents.getTitle(), 'unavailable'),
  isDestroyed: safeRead(() => webContents.isDestroyed(), true),
});

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const compactCrashDetails = (value: unknown): string => {
  try {
    return JSON.stringify(sanitizeLogPayload(value), null, 2);
  } catch {
    return 'Crash details are unavailable.';
  }
};

const createRendererCrashRecoveryHtml = (message: string, details: unknown): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ECHO 崩溃保护</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      background: #eef2ef;
      color: #18212f;
    }
    * {
      box-sizing: border-box;
    }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      overflow: auto;
      padding: 24px;
      background-color: #eef2ef;
      background-image:
        linear-gradient(rgba(16, 24, 40, 0.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16, 24, 40, 0.045) 1px, transparent 1px);
      background-size: 36px 36px;
    }
    main {
      width: min(940px, 100%);
      padding: 28px;
      border: 1px solid rgba(24, 33, 47, 0.12);
      border-radius: 8px;
      background: #fbfcf8;
      box-shadow: 0 24px 70px rgba(24, 33, 47, 0.18);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(24, 33, 47, 0.1);
    }
    .eyebrow {
      margin: 0;
      color: #176c66;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .chip {
      border: 1px solid rgba(23, 108, 102, 0.18);
      border-radius: 999px;
      padding: 6px 10px;
      color: #176c66;
      background: #e7f2ed;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .body {
      display: grid;
      grid-template-columns: minmax(72px, 112px) minmax(0, 1fr);
      gap: 28px;
      margin-top: 26px;
    }
    .rail {
      min-height: 178px;
      display: grid;
      place-items: center;
      align-content: center;
      gap: 10px;
      border-radius: 8px;
      background: #1d2633;
      color: #fff7e3;
      box-shadow: inset 0 -6px 0 #e2aa3b;
    }
    .rail-code {
      font-size: 34px;
      font-weight: 900;
      line-height: 1;
    }
    .rail-text {
      color: #f0cf8b;
      font-size: 13px;
      font-weight: 800;
    }
    h1 {
      margin: 0;
      color: #111827;
      font-size: 42px;
      line-height: 1.16;
      font-weight: 900;
    }
    .lead {
      max-width: 660px;
      margin: 16px 0 0;
      color: #4b5563;
      font-size: 15px;
      line-height: 1.8;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }
    button {
      min-height: 44px;
      border: 1px solid rgba(24, 33, 47, 0.14);
      border-radius: 8px;
      padding: 0 18px;
      color: #1f2937;
      background: #ffffff;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(24, 33, 47, 0.08);
      transition: transform 140ms ease, opacity 140ms ease, box-shadow 140ms ease;
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(24, 33, 47, 0.12);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none;
    }
    button.primary {
      border-color: #176c66;
      color: #ffffff;
      background: #176c66;
    }
    button.danger {
      border-color: #b42318;
      color: #ffffff;
      background: #b42318;
    }
    .status {
      min-height: 22px;
      margin-top: 18px;
      color: #9a3412;
      font-size: 14px;
      font-weight: 700;
      word-break: break-word;
    }
    details {
      margin-top: 18px;
      color: #374151;
    }
    summary {
      cursor: pointer;
      font-weight: 900;
    }
    pre {
      max-height: 180px;
      overflow: auto;
      margin: 14px 0 0;
      padding: 14px;
      border: 1px solid rgba(24, 33, 47, 0.1);
      border-radius: 8px;
      background: #111827;
      color: #e5e7eb;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media (max-width: 620px) {
      body {
        padding: 14px;
      }
      main {
        padding: 20px;
      }
      .body {
        grid-template-columns: 1fr;
        gap: 18px;
      }
      .rail {
        min-height: 72px;
        grid-template-columns: auto auto;
      }
      h1 {
        font-size: 32px;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <p class="eyebrow">ECHO Recovery</p>
      <span class="chip">渲染保护页</span>
    </div>
    <div class="body">
      <aside class="rail" aria-hidden="true">
        <span class="rail-code">UI</span>
        <span class="rail-text">已接管</span>
      </aside>
      <section>
        <h1>渲染界面崩了，但 ECHO 还在。</h1>
        <p class="lead">保护页已经接管当前窗口。可以先导出诊断和查看报告，也可以打开诊断目录、重启应用，或者直接关闭 ECHO。</p>
        <div class="actions">
          <button class="primary" data-action="export">导出日志</button>
          <button data-action="report">打开报告</button>
          <button data-action="folder">诊断目录</button>
          <button data-action="restart">重启 ECHO</button>
          <button class="danger" data-action="quit">关闭 ECHO</button>
        </div>
      </section>
    </div>
    <div class="status" role="status"></div>
    <details>
      <summary>崩溃摘要</summary>
      <pre>${escapeHtml(message)}</pre>
      <pre>${escapeHtml(compactCrashDetails(details))}</pre>
    </details>
  </main>
  <script>
    const status = document.querySelector('.status');
    const setStatus = (message) => {
      status.textContent = message;
    };
    const run = async (button, action) => {
      if (!window.echo) {
        setStatus('桌面桥不可用，请手动重启或关闭 ECHO。');
        return;
      }
      button.disabled = true;
      try {
        const result = await action(window.echo);
        if (result) {
          setStatus(result);
        }
      } catch (error) {
        setStatus(error && error.message ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    };
    document.querySelector('[data-action="export"]').addEventListener('click', (event) => {
      run(event.currentTarget, async (bridge) => {
        if (!bridge.diagnostics) {
          return '诊断桥不可用，请手动重启 ECHO。';
        }
        const outputPath = await bridge.diagnostics.exportDiagnosticsZip();
        return outputPath ? '已导出: ' + outputPath : '已取消导出。';
      });
    });
    document.querySelector('[data-action="report"]').addEventListener('click', (event) => {
      run(event.currentTarget, async (bridge) => {
        if (!bridge.diagnostics) {
          return '诊断桥不可用，请手动重启 ECHO。';
        }
        const outputPath = await bridge.diagnostics.openCrashReport();
        return outputPath ? '已打开: ' + outputPath : '未找到崩溃报告。';
      });
    });
    document.querySelector('[data-action="folder"]').addEventListener('click', (event) => {
      run(event.currentTarget, async (bridge) => {
        if (!bridge.diagnostics) {
          return '诊断桥不可用，请手动重启 ECHO。';
        }
        const outputPath = await bridge.diagnostics.openDiagnosticsFolder();
        return outputPath ? '已打开诊断目录: ' + outputPath : '未找到诊断目录。';
      });
    });
    document.querySelector('[data-action="restart"]').addEventListener('click', (event) => {
      run(event.currentTarget, async (bridge) => {
        if (!bridge.diagnostics) {
          return '诊断桥不可用，请手动重启 ECHO。';
        }
        await bridge.diagnostics.relaunchApp();
        return '正在重启 ECHO...';
      });
    });
    document.querySelector('[data-action="quit"]').addEventListener('click', (event) => {
      run(event.currentTarget, async (bridge) => {
        if (!bridge.app || !bridge.app.quit) {
          return '应用控制桥不可用，请手动关闭 ECHO。';
        }
        await bridge.app.quit();
        return '正在关闭 ECHO...';
      });
    });
  </script>
</body>
</html>`;

export const isClosedPipeWriteError = (error: Error): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  if (
    code === 'EPIPE' ||
    code === 'EOF' ||
    code === 'ECANCELED' ||
    code === 'ERR_STREAM_DESTROYED' ||
    code === 'ERR_STREAM_WRITE_AFTER_END'
  ) {
    return true;
  }

  return /^(?:write\s+)?(?:EOF|EPIPE|ECANCELED)$/iu.test(error.message.trim()) ||
    /write after end|stream (?:has been|was) destroyed|cannot call write after a stream was destroyed/iu.test(error.message);
};

export const isCleanProcessGoneReason = (reason: string | undefined): boolean => reason === 'clean-exit';

const logHandlerFailure = (phase: string, error: unknown): void => {
  try {
    getCrashReportService().getLogger()?.error('crash', 'crash handler failed', {
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    console.error('[crash] crash handler failed', phase, error);
  }
};

const logRecoverableMainIssue = (message: string, payload?: unknown): void => {
  try {
    getCrashReportService().getLogger()?.warn('main', message, payload);
  } catch {
    console.warn(message, payload ?? '');
  }
};

const reportCrashSafely = (record: Parameters<ReturnType<typeof getCrashReportService>['reportCrash']>[0]): void => {
  try {
    getCrashReportService().reportCrash(record);
  } catch (error) {
    logHandlerFailure('reportCrash', error);
  }
};

const showCrashRecoveryDialogSafely = (reason: 'main' | 'renderer', message: string): void => {
  try {
    void showCrashRecoveryDialog(reason, message);
  } catch (error) {
    logHandlerFailure('showCrashRecoveryDialog', error);
  }
};

const recoverClosedPipeWriteSafely = (source: RuntimeSelfHealSource, error: Error): void => {
  try {
    void recoverClosedHelperPipe(source, error).catch((recoveryError) => {
      logHandlerFailure('recoverClosedHelperPipe', recoveryError);
    });
  } catch (recoveryError) {
    logHandlerFailure('recoverClosedHelperPipe', recoveryError);
  }
};

const showRendererCrashRecoveryPageSafely = (
  webContents: WebContents,
  message: string,
  details: unknown,
): boolean => {
  const window = BrowserWindow.fromWebContents(webContents);

  if (!window || window.isDestroyed()) {
    return false;
  }

  try {
    if (!window.isVisible()) {
      window.show();
    }

    const html = createRendererCrashRecoveryHtml(message, details);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
      logHandlerFailure('loadRendererCrashRecoveryPage', error);
      showCrashRecoveryDialogSafely('renderer', message);
    });
    return true;
  } catch (error) {
    logHandlerFailure('showRendererCrashRecoveryPage', error);
    return false;
  }
};

export const registerCrashHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    if (isClosedPipeWriteError(error)) {
      logRecoverableMainIssue('ignored closed helper pipe write', {
        message: error.message,
        code: (error as NodeJS.ErrnoException).code ?? null,
      });
      recoverClosedPipeWriteSafely('uncaughtException', error);
      return;
    }

    reportCrashSafely({
      type: 'uncaughtException',
      message: error.message,
      stack: error.stack,
    });
    recordMainRuntimeIssue('uncaughtException', error.message, {
      stack: error.stack,
    });
    showCrashRecoveryDialogSafely('main', error.message);
  });

  process.on('unhandledRejection', (reason) => {
    if (reason instanceof Error && isClosedPipeWriteError(reason)) {
      logRecoverableMainIssue('ignored closed helper pipe rejection', {
        message: reason.message,
        code: (reason as NodeJS.ErrnoException).code ?? null,
      });
      recoverClosedPipeWriteSafely('unhandledRejection', reason);
      return;
    }

    reportCrashSafely({
      type: 'unhandledRejection',
      message: errorMessage(reason),
      stack: errorStack(reason),
      reason: errorMessage(reason),
    });
    recordMainRuntimeIssue('unhandledRejection', errorMessage(reason), {
      stack: errorStack(reason),
    });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    if (isCleanProcessGoneReason(details.reason)) {
      logRecoverableMainIssue('ignored clean renderer process exit', {
        details,
      });
      return;
    }

    const message = `Renderer process gone: ${details.reason}`;
    reportCrashSafely({
      type: 'render-process-gone',
      message,
      reason: details.reason,
      exitCode: details.exitCode,
      details: {
        webContents: webContentsInfo(webContents),
        details,
      },
    });
    recordMainRuntimeIssue('render-process-gone', message, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    if (!showRendererCrashRecoveryPageSafely(webContents, message, details)) {
      showCrashRecoveryDialogSafely('renderer', message);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    if (isCleanProcessGoneReason(details.reason)) {
      logRecoverableMainIssue('ignored clean child process exit', {
        details,
      });
      return;
    }

    reportCrashSafely({
      type: 'child-process-gone',
      message: `Child process gone: ${details.type}`,
      reason: details.reason,
      exitCode: details.exitCode,
      details,
    });
    recordMainRuntimeIssue('child-process-gone', `Child process gone: ${details.type}`, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
};
