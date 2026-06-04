import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Code2, Download, Eye, FolderOpen, LockKeyhole, PackagePlus, Play, Power, RefreshCw, ScrollText, ShieldCheck, TerminalSquare, Upload } from 'lucide-react';
import { pluginPanelBridgeActions, pluginPanelBridgeChannel, pluginPanelBridgeVersion, pluginPermissionDescriptors } from '../../shared/types/plugins';
import type {
  PluginCreateExampleKind,
  PluginLogEntry,
  PluginPanelBridgeAction,
  PluginPanelBridgeRequest,
  PluginPanelBridgeResponse,
  PluginPermission,
  PluginSettingsPatch,
  PluginSummary,
} from '../../shared/types/plugins';
import { EmptyState } from '../components/ui/EmptyState';
import { getPluginsBridge } from '../utils/echoBridge';

const permissionRiskLabels = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
} as const;

const permissionAvailabilityLabels = {
  active: '已开放',
  reserved: '预留',
  limited: '受限',
} as const;

const exampleLabels: Array<{ kind: PluginCreateExampleKind; label: string; description: string }> = [
  { kind: 'playback-panel', label: '播放状态面板', description: '监听播放状态，带一个可编辑面板。' },
  { kind: 'command-tool', label: '命令工具', description: '注册一个手动执行的工具命令。' },
  { kind: 'library-script', label: '曲库脚本', description: '读取曲库摘要，适合整理类脚本起步。' },
  { kind: 'source-provider', label: '自定义音源', description: '返回搜索候选，并在用户触发时解析音频 URL。' },
  { kind: 'theme-preset', label: '主题预设', description: '贡献可导入的高自定义主题参数。' },
];

const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error || '插件操作失败'));

const fileUrlFromPath = (path: string): string => `file:///${path.replace(/\\/gu, '/')}`;

const getPermissionLabel = (permission: PluginPermission): string => pluginPermissionDescriptors[permission]?.label ?? permission;

const formatPermissionForConfirm = (permission: PluginPermission): string => {
  const descriptor = pluginPermissionDescriptors[permission];
  return descriptor
    ? `- ${descriptor.label}（${permissionRiskLabels[descriptor.risk]}，${permissionAvailabilityLabels[descriptor.availability]}）：${descriptor.description}`
    : `- ${permission}`;
};

const formatPluginTime = (value: string | null): string => (value ? new Date(value).toLocaleString() : '暂无');

const pluginPanelActionSet = new Set<PluginPanelBridgeAction>(pluginPanelBridgeActions);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizePanelRequest = (value: unknown): PluginPanelBridgeRequest | null => {
  if (!isRecord(value) || value.channel !== pluginPanelBridgeChannel || value.type !== 'request') {
    return null;
  }
  if (
    typeof value.requestId !== 'string' ||
    typeof value.pluginId !== 'string' ||
    typeof value.action !== 'string' ||
    !pluginPanelActionSet.has(value.action as PluginPanelBridgeAction)
  ) {
    return null;
  }

  return {
    channel: pluginPanelBridgeChannel,
    version: typeof value.version === 'number' ? value.version : undefined,
    type: 'request',
    requestId: value.requestId,
    pluginId: value.pluginId,
    action: value.action as PluginPanelBridgeAction,
    payload: value.payload,
  };
};

const postPanelResponse = (target: Window, response: PluginPanelBridgeResponse): void => {
  target.postMessage(response, '*');
};

const StatusPill = ({ plugin }: { plugin: PluginSummary }): JSX.Element => {
  const label = plugin.disabledByHost ? '已隔离' : plugin.error ? '异常' : plugin.status === 'running' ? '运行中' : plugin.enabled ? '已启用' : '未启用';
  return <span className="plugin-status-pill" data-status={plugin.disabledByHost ? 'isolated' : plugin.error ? 'error' : plugin.status}>{label}</span>;
};

const PermissionList = ({ plugin }: { plugin: PluginSummary }): JSX.Element => (
  <div className="plugin-permissions">
    {plugin.permissions.length === 0 ? (
      <span>无需额外权限</span>
    ) : (
      plugin.permissions.map((permission) => {
        const descriptor = pluginPermissionDescriptors[permission];
        const trusted = plugin.trustedPermissions.includes(permission);
        return (
          <span key={permission} data-risk={descriptor?.risk ?? 'medium'} title={descriptor?.description ?? permission}>
            {getPermissionLabel(permission)}
            <em>{descriptor ? permissionAvailabilityLabels[descriptor.availability] : trusted ? '已信任' : '未信任'} · {trusted ? '已信任' : '未信任'}</em>
          </span>
        );
      })
    )}
  </div>
);

const SecurityOverview = ({ plugin }: { plugin: PluginSummary }): JSX.Element => {
  const highRiskCount = plugin.security.highRiskPermissions.length;
  const reservedCount = plugin.security.reservedPermissions.length;
  const limitedCount = plugin.security.limitedPermissions.length;
  return (
    <section className="plugin-security-panel">
      <header>
        <ShieldCheck size={17} />
        <strong>安全边界</strong>
      </header>
      <div className="plugin-security-grid">
        <span>
          <LockKeyhole size={16} />
          {plugin.security.trustedPermissionCount}/{plugin.security.requestedPermissionCount} 权限已信任
        </span>
        <span data-risk={highRiskCount > 0 ? 'high' : 'low'}>
          <AlertTriangle size={16} />
          {highRiskCount > 0 ? `${highRiskCount} 个高风险权限` : '无高风险权限'}
        </span>
        <span data-risk={reservedCount > 0 ? 'medium' : 'low'}>
          <LockKeyhole size={16} />
          {reservedCount > 0 ? `${reservedCount} 个预留权限` : '无预留权限'}
        </span>
        <span data-risk={limitedCount > 0 ? 'medium' : 'low'}>
          <ShieldCheck size={16} />
          {limitedCount > 0 ? `${limitedCount} 个受限权限` : '无受限权限'}
        </span>
        <span>
          <Eye size={16} />
          {plugin.security.sandboxedPanel ? '面板沙盒隔离' : '无面板脚本'}
        </span>
        <span>
          <TerminalSquare size={16} />
          {plugin.security.commandCount} 个命令
        </span>
        <span>
          <Code2 size={16} />
          {plugin.security.metadataProviderCount} 个元数据 provider
        </span>
        <span>
          <Code2 size={16} />
          {plugin.security.sourceProviderCount} 个音源 provider
        </span>
        <span>
          <Code2 size={16} />
          API v{plugin.apiVersion}{plugin.compatibility.minEchoVersion ? ` / min ${plugin.compatibility.minEchoVersion}` : ''}
        </span>
        <span data-risk={plugin.security.networkEnabled ? 'high' : 'low'}>
          <LockKeyhole size={16} />
          {plugin.security.networkEnabled ? 'Network API enabled' : 'Network API off'}
        </span>
        <span>
          <Code2 size={16} />
          {plugin.security.lyricsProviderCount} lyrics / {plugin.security.coverProviderCount} cover providers
        </span>
        <span>
          <Code2 size={16} />
          {plugin.security.themePresetCount} theme presets
        </span>
        <span>
          <Code2 size={16} />
          {plugin.security.settingCount} plugin settings
        </span>
      </div>
      <PermissionList plugin={plugin} />
    </section>
  );
};

const ActivityOverview = ({ plugin }: { plugin: PluginSummary }): JSX.Element => (
  <section className="plugin-activity-panel">
    <header>
      <Activity size={17} />
      <strong>这个插件干了什么</strong>
    </header>
    <div className="plugin-activity-grid">
      <span>
        <strong>{plugin.activity.commandRunCount}</strong>
        命令执行
        <em>{formatPluginTime(plugin.activity.lastCommandAt)}</em>
      </span>
      <span>
        <strong>{plugin.activity.eventDispatchCount}</strong>
        事件接收
        <em>{formatPluginTime(plugin.activity.lastEventAt)}</em>
      </span>
      <span>
        <strong>{plugin.activity.storageWriteCount}</strong>
        插件存储写入
        <em>{formatPluginTime(plugin.activity.lastStorageWriteAt)}</em>
      </span>
      <span>
        <strong>{plugin.activity.settingsWriteCount}</strong>
        设置写入
        <em>{formatPluginTime(plugin.activity.lastSettingsWriteAt)}</em>
      </span>
      <span data-risk={plugin.activity.errorCount > 0 ? 'high' : 'low'}>
        <strong>{plugin.activity.errorCount}</strong>
        错误
        <em>{formatPluginTime(plugin.activity.lastErrorAt)}</em>
      </span>
    </div>
  </section>
);

export const PluginsPage = (): JSX.Element => {
  const pluginsApi = getPluginsBridge();
  const panelFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginDirectory, setPluginDirectory] = useState('');
  const [logs, setLogs] = useState<PluginLogEntry[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PluginSettingsPatch>({});

  const selectedPlugin = useMemo(
    () => plugins.find((plugin) => plugin.id === selectedPluginId) ?? plugins[0] ?? null,
    [plugins, selectedPluginId],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!pluginsApi) {
      return;
    }
    const result = await pluginsApi.list();
    setPlugins(result.plugins);
    setPluginDirectory(result.directory);
    setSelectedPluginId((current) => current ?? result.plugins[0]?.id ?? null);
  }, [pluginsApi]);

  const refreshLogs = useCallback(async (pluginId?: string | null): Promise<void> => {
    if (!pluginsApi) {
      return;
    }
    setLogs(await pluginsApi.getLogs(pluginId ?? undefined));
  }, [pluginsApi]);

  useEffect(() => {
    void refresh().catch((error) => setMessage(formatError(error)));
  }, [refresh]);

  useEffect(() => {
    void refreshLogs(selectedPlugin?.id).catch(() => undefined);
  }, [refreshLogs, selectedPlugin?.id]);

  useEffect(() => {
    if (!pluginsApi || !selectedPlugin) {
      setSettingsDraft({});
      return;
    }
    setSettingsDraft(selectedPlugin.settingsValues ?? {});
    void pluginsApi.getSettings?.(selectedPlugin.id)
      .then((result) => setSettingsDraft(result.values))
      .catch(() => undefined);
  }, [pluginsApi, selectedPlugin]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string): Promise<void> => {
      try {
        setBusyAction(key);
        setMessage(null);
        await action();
        setMessage(success);
        await refresh();
        await refreshLogs(selectedPlugin?.id);
      } catch (error) {
        setMessage(formatError(error));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, refreshLogs, selectedPlugin?.id],
  );

  const handleImportPackage = (): void => {
    if (!pluginsApi) {
      return;
    }
    void (async () => {
      try {
        setBusyAction('import-package');
        setMessage(null);
        const result = await pluginsApi.importPackage();
        if (!result) {
          setMessage('已取消导入。');
          return;
        }
        setSelectedPluginId(result.pluginId);
        setMessage(`已导入插件包：${result.pluginId}`);
        await refresh();
        await refreshLogs(result.pluginId);
      } catch (error) {
        setMessage(formatError(error));
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handleExportPackage = (plugin: PluginSummary): void => {
    if (!pluginsApi) {
      return;
    }
    void (async () => {
      try {
        setBusyAction(`export:${plugin.id}`);
        setMessage(null);
        const target = await pluginsApi.exportPackage(plugin.id);
        setMessage(target ? `已导出插件包：${target}` : '已取消导出。');
        await refreshLogs(plugin.id);
      } catch (error) {
        setMessage(formatError(error));
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handleEnable = (plugin: PluginSummary): void => {
    if (!pluginsApi) {
      return;
    }
    const permissionText = plugin.permissions.length
      ? plugin.permissions.map(formatPermissionForConfirm).join('\n')
      : '无需额外权限';
    const highRiskText = plugin.security.highRiskPermissions.length > 0
      ? '\n\n包含高风险权限，请确认插件来源可信。'
      : '';
    const reservedText = plugin.security.reservedPermissions.length > 0 || plugin.security.limitedPermissions.length > 0
      ? '\n\n部分权限在 v1 只是预留或受限能力，启用不会额外开放 Node、Electron、SQLite、主界面 DOM 或音频热路径。'
      : '';
    const confirmed = window.confirm(`启用插件「${plugin.name}」？\n\n请求权限：\n${permissionText}${highRiskText}${reservedText}\n\n插件会在主进程受控沙盒和面板 iframe 沙盒中运行，连续启动失败会自动隔离。`);
    if (!confirmed) {
      return;
    }
    void runAction(
      `enable:${plugin.id}`,
      () => pluginsApi.enable({ pluginId: plugin.id, trustedPermissions: plugin.permissions }),
      `已启用 ${plugin.name}`,
    );
  };

  const handleCreateExample = (kind: PluginCreateExampleKind): void => {
    if (!pluginsApi) {
      return;
    }
    void runAction(`example:${kind}`, () => pluginsApi.createExample(kind), '已创建示例插件，可打开目录编辑。');
  };

  const handleRunCommand = (plugin: PluginSummary, commandId: string): void => {
    if (!pluginsApi) {
      return;
    }
    void runAction(
      `command:${plugin.id}:${commandId}`,
      () => pluginsApi.runCommand({ pluginId: plugin.id, commandId }),
      '命令已执行，详情可查看日志。',
    );
  };

  const handleSavePluginSettings = (plugin: PluginSummary): void => {
    if (!pluginsApi?.setSettings) {
      return;
    }
    void runAction(
      `settings:${plugin.id}`,
      async () => {
        const result = await pluginsApi.setSettings(plugin.id, settingsDraft);
        setSettingsDraft(result.values);
      },
      '插件设置已保存。',
    );
  };

  useEffect(() => {
    if (!pluginsApi || !selectedPlugin) {
      return undefined;
    }

    const handlePanelMessage = (event: MessageEvent): void => {
      if (event.source !== panelFrameRef.current?.contentWindow) {
        return;
      }

      const request = normalizePanelRequest(event.data);
      if (!request || request.pluginId !== selectedPlugin.id) {
        return;
      }

      const sourceWindow = event.source as Window | null;
      if (!sourceWindow) {
        return;
      }

      const respond = async (): Promise<void> => {
        try {
          let result: unknown;
          if (request.action === 'plugin:getSummary') {
            result = selectedPlugin;
          } else if (request.action === 'plugin:getLogs') {
            result = await pluginsApi.getLogs(selectedPlugin.id);
          } else if (request.action === 'plugin:runCommand') {
            const payload = isRecord(request.payload) ? request.payload : {};
            const commandId = typeof payload.commandId === 'string' ? payload.commandId.trim() : '';
            if (!commandId) {
              throw new Error('plugin_panel_command_id_required');
            }
            result = await pluginsApi.runCommand({
              pluginId: selectedPlugin.id,
              commandId,
              args: Array.isArray(payload.args) ? payload.args : undefined,
            });
            await refresh();
            await refreshLogs(selectedPlugin.id);
          }

          postPanelResponse(sourceWindow, {
            channel: pluginPanelBridgeChannel,
            version: pluginPanelBridgeVersion,
            type: 'response',
            requestId: request.requestId,
            pluginId: selectedPlugin.id,
            ok: true,
            result,
          });
        } catch (error) {
          postPanelResponse(sourceWindow, {
            channel: pluginPanelBridgeChannel,
            version: pluginPanelBridgeVersion,
            type: 'response',
            requestId: request.requestId,
            pluginId: selectedPlugin.id,
            ok: false,
            error: formatError(error),
          });
        }
      };

      void respond();
    };

    window.addEventListener('message', handlePanelMessage);
    return () => window.removeEventListener('message', handlePanelMessage);
  }, [pluginsApi, refresh, refreshLogs, selectedPlugin]);

  if (!pluginsApi) {
    return (
      <div className="page-stack plugins-page">
        <EmptyState icon={Code2} title="插件系统不可用" description="请在 ECHO Next 桌面端打开插件管理。" />
      </div>
    );
  }

  return (
    <div className="page-stack plugins-page">
      <header className="plain-page-header plugins-header">
        <div>
          <span className="section-kicker">本地插件</span>
          <h1>插件</h1>
          <p>插件默认关闭。启用后只通过受控 API 读取播放、曲库和设置，不会进入音频热路径。</p>
          {pluginDirectory ? <small title={pluginDirectory}>{pluginDirectory}</small> : null}
        </div>
        <div className="plugins-header-actions">
          <button className="settings-action-button" type="button" onClick={() => void pluginsApi.openDirectory()}>
            <FolderOpen size={16} />
            打开插件目录
          </button>
          <button className="settings-action-button" type="button" disabled={busyAction === 'import-package'} onClick={handleImportPackage}>
            <Upload size={16} />
            导入插件包
          </button>
          <button className="settings-action-button" type="button" disabled={busyAction === 'refresh'} onClick={() => void runAction('refresh', refresh, '插件列表已刷新。')}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="plugin-example-grid" aria-label="示例插件">
        {exampleLabels.map((example) => (
          <article className="plugin-example-card" key={example.kind}>
            <PackagePlus size={18} />
            <div>
              <strong>{example.label}</strong>
              <span>{example.description}</span>
            </div>
            <button className="settings-action-button" type="button" disabled={busyAction === `example:${example.kind}`} onClick={() => handleCreateExample(example.kind)}>
              新建
            </button>
          </article>
        ))}
      </section>

      {message ? <p className="plugins-message">{message}</p> : null}

      <main className="plugins-layout">
        <section className="plugins-list" aria-label="插件列表">
          {plugins.length === 0 ? (
            <EmptyState icon={Code2} title="还没有插件" description="新建一个示例插件，或把插件文件夹放进插件目录。" />
          ) : (
            plugins.map((plugin) => (
              <button
                className="plugin-list-item"
                type="button"
                key={plugin.id}
                data-active={selectedPlugin?.id === plugin.id}
                onClick={() => setSelectedPluginId(plugin.id)}
              >
                <span>
                  <strong>{plugin.name}</strong>
                  <em>{plugin.id}</em>
                </span>
                <StatusPill plugin={plugin} />
              </button>
            ))
          )}
        </section>

        <section className="plugin-detail" aria-label="插件详情">
          {selectedPlugin ? (
            <>
              <div className="plugin-detail-head">
                <div>
                  <h2>{selectedPlugin.name}</h2>
                  <p>{selectedPlugin.id} · v{selectedPlugin.version}</p>
                </div>
                <StatusPill plugin={selectedPlugin} />
              </div>

              {selectedPlugin.error ? <p className="plugins-message plugins-message--error">{selectedPlugin.error}</p> : null}
              {selectedPlugin.disabledByHost ? (
                <p className="plugins-message plugins-message--error">这个插件连续启动失败，ECHO 已自动隔离。修复插件文件后可手动重新启用。</p>
              ) : null}

              <SecurityOverview plugin={selectedPlugin} />
              <ActivityOverview plugin={selectedPlugin} />

              {selectedPlugin.contributes.settings && selectedPlugin.contributes.settings.length > 0 ? (
                <section className="plugin-activity-panel">
                  <header>
                    <Code2 size={17} />
                    <strong>Plugin settings</strong>
                  </header>
                  <div className="plugin-settings-list">
                    {selectedPlugin.contributes.settings.map((setting) => {
                      const value = settingsDraft[setting.id] ?? setting.defaultValue ?? (setting.type === 'boolean' ? false : '');
                      return (
                        <label className="plugin-setting-row" key={setting.id}>
                          <span>
                            <strong>{setting.title}</strong>
                            <em>{setting.description ?? setting.id}</em>
                          </span>
                          {setting.type === 'boolean' ? (
                            <input
                              type="checkbox"
                              checked={value === true}
                              onChange={(event) => setSettingsDraft((current) => ({ ...current, [setting.id]: event.target.checked }))}
                            />
                          ) : setting.type === 'select' ? (
                            <select
                              value={typeof value === 'string' ? value : ''}
                              onChange={(event) => setSettingsDraft((current) => ({ ...current, [setting.id]: event.target.value }))}
                            >
                              {(setting.options ?? []).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={setting.type === 'number' ? 'number' : setting.type === 'secret' ? 'password' : 'text'}
                              min={setting.min}
                              max={setting.max}
                              placeholder={setting.placeholder}
                              value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                              onChange={(event) => setSettingsDraft((current) => ({
                                ...current,
                                [setting.id]: setting.type === 'number' ? Number(event.target.value) : event.target.value,
                              }))}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <button className="settings-action-button" type="button" disabled={busyAction === `settings:${selectedPlugin.id}`} onClick={() => handleSavePluginSettings(selectedPlugin)}>
                    Save settings
                  </button>
                </section>
              ) : null}

              <div className="plugin-actions">
                {selectedPlugin.enabled ? (
                  <button className="settings-action-button" type="button" disabled={busyAction === `disable:${selectedPlugin.id}`} onClick={() => void runAction(`disable:${selectedPlugin.id}`, () => pluginsApi.disable(selectedPlugin.id), `已停用 ${selectedPlugin.name}`)}>
                    <Power size={16} />
                    停用
                  </button>
                ) : (
                  <button className="settings-action-button" type="button" disabled={Boolean(selectedPlugin.error && !selectedPlugin.disabledByHost) || busyAction === `enable:${selectedPlugin.id}`} onClick={() => handleEnable(selectedPlugin)}>
                    <Power size={16} />
                    启用
                  </button>
                )}
                <button className="settings-action-button" type="button" disabled={busyAction === `reload:${selectedPlugin.id}`} onClick={() => void runAction(`reload:${selectedPlugin.id}`, () => pluginsApi.reload(selectedPlugin.id), `已重载 ${selectedPlugin.name}`)}>
                  <RefreshCw size={16} />
                  重载
                </button>
                <button className="settings-action-button" type="button" onClick={() => void pluginsApi.openDirectory(selectedPlugin.id)}>
                  <FolderOpen size={16} />
                  打开目录
                </button>
                <button className="settings-action-button" type="button" disabled={busyAction === `export:${selectedPlugin.id}`} onClick={() => handleExportPackage(selectedPlugin)}>
                  <Download size={16} />
                  导出插件包
                </button>
              </div>

              <div className="plugin-command-list">
                <header>
                  <TerminalSquare size={17} />
                  <strong>命令</strong>
                </header>
                {selectedPlugin.commands.length === 0 ? (
                  <span>这个插件还没有注册命令。</span>
                ) : (
                  selectedPlugin.commands.map((command) => (
                    <button
                      className="plugin-command-row"
                      type="button"
                      key={`${command.pluginId}:${command.id}`}
                      disabled={!selectedPlugin.enabled || busyAction === `command:${selectedPlugin.id}:${command.id}`}
                      onClick={() => handleRunCommand(selectedPlugin, command.id)}
                    >
                      <Play size={15} />
                      <span>
                        <strong>{command.title}</strong>
                        <em>{command.description ?? command.id}</em>
                      </span>
                    </button>
                  ))
                )}
              </div>

              {selectedPlugin.panel ? (
                <div className="plugin-panel-preview">
                  <header>
                    <Code2 size={17} />
                    <strong>面板预览</strong>
                  </header>
                  <iframe
                    ref={panelFrameRef}
                    key={`${selectedPlugin.id}:${selectedPlugin.panel}`}
                    title={`${selectedPlugin.name} panel`}
                    sandbox="allow-scripts"
                    src={fileUrlFromPath(selectedPlugin.panel)}
                  />
                </div>
              ) : null}

              <div className="plugin-log-list">
                <header>
                  <ScrollText size={17} />
                  <strong>日志</strong>
                  <button className="settings-action-button" type="button" onClick={() => void refreshLogs(selectedPlugin.id)}>
                    刷新日志
                  </button>
                </header>
                {logs.length === 0 ? (
                  <span>暂无日志。</span>
                ) : (
                  logs.map((log) => (
                    <p key={log.id} data-level={log.level}>
                      <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
                      <strong>{log.level}</strong>
                      <span>{log.message}</span>
                    </p>
                  ))
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={Code2} title="选择插件" description="选择左侧插件查看权限、命令、日志和面板。" />
          )}
        </section>
      </main>
    </div>
  );
};
