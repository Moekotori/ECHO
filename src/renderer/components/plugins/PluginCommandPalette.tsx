import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Play, Search, TerminalSquare, X } from 'lucide-react';
import type { PluginCommand, PluginSummary } from '../../../shared/types/plugins';
import { useOptionalI18n } from '../../i18n/I18nProvider';
import { getPluginsBridge } from '../../utils/echoBridge';
import { formatUserFacingError } from '../../utils/userFacingError';

type PluginCommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
};

type PaletteCommand = PluginCommand & {
  pluginName: string;
};

const textByLocale = {
  'zh-CN': {
    title: '插件命令',
    description: '运行已启用插件提供的全局命令',
    search: '搜索插件或命令',
    empty: '没有可运行的全局插件命令',
    loading: '正在读取插件命令…',
    running: '正在运行…',
    result: '命令结果',
    noResult: '命令已完成',
    close: '关闭插件命令',
  },
  'zh-TW': {
    title: '外掛命令',
    description: '執行已啟用外掛提供的全域命令',
    search: '搜尋外掛或命令',
    empty: '沒有可執行的全域外掛命令',
    loading: '正在讀取外掛命令…',
    running: '正在執行…',
    result: '命令結果',
    noResult: '命令已完成',
    close: '關閉外掛命令',
  },
  en: {
    title: 'Plugin commands',
    description: 'Run global commands contributed by enabled plugins',
    search: 'Search plugins or commands',
    empty: 'No global plugin commands are available',
    loading: 'Loading plugin commands…',
    running: 'Running…',
    result: 'Command result',
    noResult: 'Command completed',
    close: 'Close plugin commands',
  },
} as const;

const isChineseTraditional = (locale: string): boolean => locale === 'zh-TW';
const paletteText = (locale: string) =>
  locale === 'zh-CN'
    ? textByLocale['zh-CN']
    : isChineseTraditional(locale)
      ? textByLocale['zh-TW']
      : textByLocale.en;

const toPaletteCommands = (plugins: PluginSummary[]): PaletteCommand[] =>
  plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.disabledByHost || plugin.status === 'error') {
      return [];
    }
    const contextualCommandIds = new Set(
      (plugin.contributes.trackContextMenus ?? []).map((item) => item.commandId),
    );
    return plugin.commands
      .filter((command) => !contextualCommandIds.has(command.id))
      .map((command) => ({ ...command, pluginName: plugin.name }));
  });

const formatResult = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const PluginCommandPalette = ({
  isOpen,
  onClose,
}: PluginCommandPaletteProps): JSX.Element | null => {
  const i18n = useOptionalI18n();
  const copy = paletteText(i18n?.locale ?? 'zh-CN');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const pluginsApi = getPluginsBridge();
    setQuery('');
    setResult(null);
    setError(null);
    setLoading(true);
    void pluginsApi?.list()
      .then((response) => setPlugins(response.plugins))
      .catch((loadError) => {
        setPlugins([]);
        setError(formatUserFacingError(loadError, { context: 'plugins', fallback: '无法读取插件命令。' }));
      })
      .finally(() => setLoading(false));
    const focusHandle = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(focusHandle);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const commands = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return toPaletteCommands(plugins).filter((command) => {
      if (!normalizedQuery) {
        return true;
      }
      return [
        command.title,
        command.description,
        command.id,
        command.pluginName,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [plugins, query]);

  const runCommand = (command: PaletteCommand): void => {
    const pluginsApi = getPluginsBridge();
    if (!pluginsApi) {
      return;
    }
    const commandKey = `${command.pluginId}:${command.id}`;
    setRunningKey(commandKey);
    setResult(null);
    setError(null);
    void pluginsApi.runCommand({ pluginId: command.pluginId, commandId: command.id })
      .then((value) => {
        setResult({
          title: `${command.pluginName} · ${command.title}`,
          value: formatResult(value),
        });
        window.dispatchEvent(new Event('plugins:changed'));
      })
      .catch((runError) => {
        setError(formatUserFacingError(runError, { context: 'plugins', fallback: '插件命令运行失败。' }));
      })
      .finally(() => setRunningKey(null));
  };

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="plugin-command-palette" role="presentation">
      <button className="plugin-command-palette__scrim" type="button" aria-label={copy.close} onClick={onClose} />
      <section className="plugin-command-palette__dialog" role="dialog" aria-modal="true" aria-label={copy.title}>
        <header>
          <span className="plugin-command-palette__icon"><TerminalSquare size={20} /></span>
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
          <button type="button" aria-label={copy.close} title={copy.close} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="plugin-command-palette__search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder={copy.search}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Ctrl Shift P</kbd>
        </label>

        <div className="plugin-command-palette__list">
          {loading ? <p className="plugin-command-palette__empty">{copy.loading}</p> : null}
          {!loading && commands.length === 0 ? <p className="plugin-command-palette__empty">{copy.empty}</p> : null}
          {commands.map((command) => {
            const commandKey = `${command.pluginId}:${command.id}`;
            const isRunning = runningKey === commandKey;
            return (
              <button
                key={commandKey}
                type="button"
                disabled={runningKey !== null}
                onClick={() => runCommand(command)}
              >
                <span>
                  <strong>{command.title}</strong>
                  <small>{command.pluginName}{command.description ? ` · ${command.description}` : ''}</small>
                </span>
                <span className="plugin-command-palette__run">
                  <Play size={15} />
                  {isRunning ? copy.running : command.id}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="plugin-command-palette__error" role="alert">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        ) : null}
        {result ? (
          <section className="plugin-command-palette__result">
            <strong>{copy.result}</strong>
            <span>{result.title}</span>
            <pre>{result.value || copy.noResult}</pre>
          </section>
        ) : null}
      </section>
    </div>,
    document.body,
  );
};
