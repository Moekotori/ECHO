import { Code2, ShieldCheck } from 'lucide-react';
import type { PluginPanelContribution, PluginSummary } from '../../../shared/types/plugins';
import { PluginPanelFrame, resolvePluginPanelPath } from './PluginPanelFrame';

type PluginPanelPageProps = {
  plugin: PluginSummary;
  panel: PluginPanelContribution;
};

export const PluginPanelPage = ({ plugin, panel }: PluginPanelPageProps): JSX.Element => {
  const panelPath = resolvePluginPanelPath(plugin, panel.path);

  if (!panelPath) {
    return (
      <div className="page-stack plugin-panel-page">
        <div className="plugin-panel-page__empty">
          <Code2 size={28} />
          <strong>{panel.title}</strong>
          <span>插件没有提供可加载的面板文件。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack plugin-panel-page">
      <header className="plain-page-header plugin-panel-page__header">
        <div>
          <span className="page-kicker">PLUGIN PANEL</span>
          <h1>{panel.title}</h1>
          <p>{plugin.name} · v{plugin.version}</p>
        </div>
        <span className="plugin-panel-page__sandbox">
          <ShieldCheck size={15} />
          沙箱面板
        </span>
      </header>
      <section className="plugin-panel-page__surface">
        <PluginPanelFrame
          plugin={plugin}
          panelPath={panelPath}
          title={`${plugin.name} · ${panel.title}`}
          className="plugin-panel-page__frame"
        />
      </section>
    </div>
  );
};
