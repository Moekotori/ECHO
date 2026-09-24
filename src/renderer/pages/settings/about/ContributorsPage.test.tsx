import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContributorsPage } from './ContributorsPage';
import { contributorIds } from './contributors';

describe('ContributorsPage', () => {
  it('renders display-only contributor IDs and returns to About', () => {
    const onBack = vi.fn();
    render(<ContributorsPage locale="zh-CN" onBack={onBack} />);

    expect(screen.getByRole('heading', { name: '贡献者' })).toBeTruthy();
    expect(screen.getByText(`${contributorIds.length} 位贡献者`)).toBeTruthy();
    for (const id of contributorIds) {
      expect(screen.getByText(id)).toBeTruthy();
    }
    expect(screen.queryByRole('link')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '返回关于' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps contributor IDs unique and ASCII-only', () => {
    expect(new Set(contributorIds).size).toBe(contributorIds.length);
    expect(contributorIds.every((id) => /^[\x20-\x7E]+$/.test(id))).toBe(true);
  });
});

