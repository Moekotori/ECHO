import { useEffect, useMemo, useRef } from 'react';
import {
  pluginEventNames,
  pluginPanelBridgeActions,
  pluginPanelBridgeChannel,
  pluginPanelBridgeVersion,
} from '../../../shared/types/plugins';
import type {
  PluginEventName,
  PluginPanelBridgeAction,
  PluginPanelBridgeEvent,
  PluginPanelBridgeRequest,
  PluginPanelBridgeResponse,
  PluginPermission,
  PluginSummary,
} from '../../../shared/types/plugins';
import { getPluginsBridge } from '../../utils/echoBridge';
import { formatUserFacingError } from '../../utils/userFacingError';
import {
  isPluginPanelHostAction,
  runPluginPanelHostAction,
} from './pluginPanelHostBridge';

type PluginPanelFrameProps = {
  plugin: PluginSummary;
  panelPath: string;
  title: string;
  className?: string;
  onCommandComplete?: () => void | Promise<void>;
};

const pluginPanelActionSet = new Set<PluginPanelBridgeAction>(pluginPanelBridgeActions);
const pluginEventSet = new Set<PluginEventName>(pluginEventNames);
const pluginEventPermissions: Record<PluginEventName, PluginPermission> = {
  'playback:status': 'playback:read',
  'library:changed': 'library:read',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const pluginPanelFileUrl = (path: string): string =>
  `file:///${path.replace(/\\/gu, '/')}`;

export const resolvePluginPanelPath = (
  plugin: Pick<PluginSummary, 'directory' | 'panel'>,
  contributionPath?: string,
): string | null => {
  if (!contributionPath) {
    return plugin.panel;
  }
  const directory = plugin.directory.replace(/[\\/]+$/u, '');
  return `${directory}/${contributionPath}`;
};

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

const postPanelMessage = (
  target: Window,
  message: PluginPanelBridgeResponse | PluginPanelBridgeEvent,
): void => {
  target.postMessage(message, '*');
};

const requestedEventName = (payload: unknown): PluginEventName => {
  const eventName = isRecord(payload) && typeof payload.eventName === 'string'
    ? payload.eventName
    : '';
  if (!pluginEventSet.has(eventName as PluginEventName)) {
    throw new Error(`plugin_event_not_supported:${eventName}`);
  }
  return eventName as PluginEventName;
};

export const PluginPanelFrame = ({
  plugin,
  panelPath,
  title,
  className,
  onCommandComplete,
}: PluginPanelFrameProps): JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const subscriptionsRef = useRef(new Set<PluginEventName>());
  const pluginsApi = useMemo(() => getPluginsBridge(), []);

  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    const postEvent = (eventName: PluginEventName, payload: unknown): void => {
      if (!subscriptions.has(eventName)) {
        return;
      }
      const target = frameRef.current?.contentWindow;
      if (!target) {
        return;
      }
      postPanelMessage(target, {
        channel: pluginPanelBridgeChannel,
        version: pluginPanelBridgeVersion,
        type: 'event',
        pluginId: plugin.id,
        eventName,
        payload,
      });
    };

    const unsubscribeAudio = window.echo?.audio?.onStatus?.((status) => {
      postEvent('playback:status', status);
    });
    const handleLibraryChanged = (event: Event): void => {
      postEvent('library:changed', event instanceof CustomEvent ? event.detail : null);
    };
    window.addEventListener('library:changed', handleLibraryChanged);
    return () => {
      unsubscribeAudio?.();
      window.removeEventListener('library:changed', handleLibraryChanged);
      subscriptions.clear();
    };
  }, [plugin.id]);

  useEffect(() => {
    if (!pluginsApi) {
      return undefined;
    }

    const handlePanelMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) {
        return;
      }
      const request = normalizePanelRequest(event.data);
      if (!request || request.pluginId !== plugin.id) {
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
            result = plugin;
          } else if (request.action === 'plugin:getLogs') {
            result = await pluginsApi.getLogs(plugin.id);
          } else if (request.action === 'plugin:runCommand') {
            const payload = isRecord(request.payload) ? request.payload : {};
            const commandId = typeof payload.commandId === 'string' ? payload.commandId.trim() : '';
            if (!commandId) {
              throw new Error('plugin_panel_command_id_required');
            }
            result = await pluginsApi.runCommand({
              pluginId: plugin.id,
              commandId,
              args: Array.isArray(payload.args) ? payload.args : undefined,
            });
            await onCommandComplete?.();
          } else if (request.action === 'plugin:subscribe') {
            const eventName = requestedEventName(request.payload);
            const requiredPermission = pluginEventPermissions[eventName];
            if (!plugin.trustedPermissions.includes(requiredPermission)) {
              throw new Error(`plugin_permission_denied:${requiredPermission}`);
            }
            subscriptionsRef.current.add(eventName);
            result = { eventName, subscribed: true };
          } else if (request.action === 'plugin:unsubscribe') {
            const eventName = requestedEventName(request.payload);
            subscriptionsRef.current.delete(eventName);
            result = { eventName, subscribed: false };
          } else if (isPluginPanelHostAction(request.action)) {
            result = await runPluginPanelHostAction({
              action: request.action,
              payload: request.payload,
              plugin,
              pluginsApi,
            });
          }

          postPanelMessage(sourceWindow, {
            channel: pluginPanelBridgeChannel,
            version: pluginPanelBridgeVersion,
            type: 'response',
            requestId: request.requestId,
            pluginId: plugin.id,
            ok: true,
            result,
          });
        } catch (error) {
          postPanelMessage(sourceWindow, {
            channel: pluginPanelBridgeChannel,
            version: pluginPanelBridgeVersion,
            type: 'response',
            requestId: request.requestId,
            pluginId: plugin.id,
            ok: false,
            error: formatUserFacingError(error, { context: 'plugins', fallback: '插件面板请求失败。' }),
          });
        }
      };

      void respond();
    };

    window.addEventListener('message', handlePanelMessage);
    return () => window.removeEventListener('message', handlePanelMessage);
  }, [onCommandComplete, plugin, pluginsApi]);

  return (
    <iframe
      ref={frameRef}
      className={className}
      key={`${plugin.id}:${panelPath}`}
      title={title}
      sandbox="allow-scripts"
      src={pluginPanelFileUrl(panelPath)}
    />
  );
};
