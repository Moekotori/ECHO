// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingRow, SettingSection, SettingSubsectionTitle, ToggleButton } from './SettingsPrimitives';

afterEach(cleanup);

describe('compact settings descriptions', () => {
  it('names row toggles for screen readers while preserving explicit control names', () => {
    render(<>
      <SettingRow title="减少动画"><ToggleButton /></SettingRow>
      <SettingRow title="窗口"><ToggleButton ariaLabel="最小化到托盘" active /></SettingRow>
    </>);
    expect(screen.getByRole('button', { name: '减少动画', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: '最小化到托盘', pressed: true })).toBeTruthy();
  });
  it('reveals section, group and row descriptions only through their help buttons', () => {
    render(
      <SettingSection id="general" activeKey="general" icon={Settings} title="General" description="Section help">
        <SettingSubsectionTitle title="Startup" description="Group help" />
        <SettingRow title="Launch" description="Row help"><button>Enable</button></SettingRow>
      </SettingSection>,
    );
    for (const [title, description] of [['General', 'Section help'], ['Startup', 'Group help'], ['Launch', 'Row help']]) {
      expect(screen.queryByText(description)).toBeNull();
      const trigger = screen.getByRole('button', { name: title });
      fireEvent.focus(trigger);
      expect(screen.getByRole('tooltip').textContent).toBe(description);
      fireEvent.blur(trigger);
      expect(screen.queryByRole('tooltip')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
  });

  it('keeps destructive-action warnings and explicitly inline feedback visible', () => {
    render(<>
      <SettingSection id="danger" activeKey="danger" icon={Settings} title="Danger" description="Section warning">
        <SettingSubsectionTitle title="Reset" description="Group warning" />
        <SettingRow title="Erase" description="Deletes your library"><button>Delete</button></SettingRow>
      </SettingSection>
      <SettingRow title="GPU" description="Restart may fail" descriptionInline><button>Toggle</button></SettingRow>
      <SettingRow title="Status" description={<span role="status">Working</span>}><button>Cancel</button></SettingRow>
    </>);
    for (const description of ['Section warning', 'Group warning', 'Deletes your library', 'Restart may fail', 'Working']) {
      expect(screen.getByText(description)).toBeTruthy();
    }
    expect(document.querySelector('.setting-help-tooltip')).toBeNull();
  });
});
