// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditableContextMenu } from './EditableContextMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EditableContextMenu', () => {
  it('opens a themed edit menu for editable inputs', () => {
    render(
      <>
        <input aria-label="Search" defaultValue="hello" />
        <EditableContextMenu />
      </>,
    );

    const input = screen.getByLabelText('Search') as HTMLInputElement;
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 40, clientY: 32 });

    expect(screen.getByRole('menu', { name: '文本编辑菜单' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '复制' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: '全选' }).hasAttribute('disabled')).toBe(false);
  });

  it('ignores non-editable targets', () => {
    render(
      <>
        <div>Plain area</div>
        <EditableContextMenu />
      </>,
    );

    fireEvent.contextMenu(screen.getByText('Plain area'), { clientX: 40, clientY: 32 });

    expect(screen.queryByRole('menu', { name: '文本编辑菜单' })).toBeNull();
  });

  it('deletes only the selected input text', () => {
    render(
      <>
        <input aria-label="Search" defaultValue="hello world" />
        <EditableContextMenu />
      </>,
    );

    const input = screen.getByLabelText('Search') as HTMLInputElement;
    input.setSelectionRange(5, 11);
    fireEvent.contextMenu(input, { clientX: 40, clientY: 32 });
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));

    expect(input.value).toBe('hello');
  });
});
