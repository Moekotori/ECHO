// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PluginSummary } from '../../../shared/types/plugins';
import { PluginCommandPalette } from './PluginCommandPalette';

const plugin = {
  id: 'echo.tools',
  name: 'Toolbox',
  version: '1.0.0',
  apiVersion: 2,
  enabled: true,
  status: 'running',
  disabledByHost: false,
  error: null,
  contributes: {
    trackContextMenus: [{
      id: 'track-tool',
      title: 'Track Tool',
      commandId: 'track-tool',
    }],
  },
  commands: [
    { pluginId: 'echo.tools', id: 'global-tool', title: 'Global Tool', description: 'Run globally' },
    { pluginId: 'echo.tools', id: 'track-tool', title: 'Track Tool' },
  ],
} as PluginSummary;

const pluginsBridge = {
  list: vi.fn(async () => ({ directory: 'D:\\Echo\\plugins', plugins: [plugin] })),
  runCommand: vi.fn(async () => ({ completed: true })),
};

vi.mock('../../i18n/I18nProvider', () => ({
  useOptionalI18n: () => ({ locale: 'zh-CN' }),
}));

vi.mock('../../utils/echoBridge', () => ({
  getPluginsBridge: () => pluginsBridge,
}));

describe('PluginCommandPalette', () => {
  beforeEach(() => {
    pluginsBridge.list.mockClear();
    pluginsBridge.runCommand.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('runs global plugin commands without exposing track-context-only commands', async () => {
    render(<PluginCommandPalette isOpen onClose={vi.fn()} />);

    const globalCommand = await screen.findByRole('button', { name: /Global Tool/u });
    expect(screen.queryByRole('button', { name: /Track Tool/u })).toBeNull();

    fireEvent.click(globalCommand);

    await waitFor(() => expect(pluginsBridge.runCommand).toHaveBeenCalledWith({
      pluginId: 'echo.tools',
      commandId: 'global-tool',
    }));
    expect(await screen.findByText(/"completed": true/u)).toBeTruthy();
  });

  it('filters commands by plugin name and command title', async () => {
    render(<PluginCommandPalette isOpen onClose={vi.fn()} />);
    await screen.findByRole('button', { name: /Global Tool/u });

    fireEvent.change(screen.getByPlaceholderText('搜索插件或命令'), { target: { value: 'missing' } });
    expect(screen.queryByRole('button', { name: /Global Tool/u })).toBeNull();
    expect(screen.getByText('没有可运行的全局插件命令')).toBeTruthy();
  });
});
