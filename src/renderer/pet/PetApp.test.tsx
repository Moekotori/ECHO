// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PetApp } from './PetApp';

const controlMainWindow = vi.fn().mockResolvedValue(undefined);
const moveTo = vi.fn().mockResolvedValue(undefined);
const petState = {
  visible: true,
  bounds: { x: 400, y: 300, width: 196, height: 196 },
  settings: { petEnabled: true, petBounds: { x: 400, y: 300, width: 196, height: 196 }, petScalePercent: 100 },
};

describe('PetApp', () => {
  beforeEach(() => {
    controlMainWindow.mockClear();
    moveTo.mockClear();
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        playback: { controlMainWindow },
        pet: {
          getState: vi.fn().mockResolvedValue(petState),
          hide: vi.fn().mockResolvedValue(undefined),
          moveTo,
          onStateChanged: vi.fn(() => () => undefined),
          resetBounds: vi.fn().mockResolvedValue(undefined),
          setScale: vi.fn().mockResolvedValue(petState),
        },
      },
    });
  });

  afterEach(() => cleanup());

  it('uses the character widgets to switch tracks', async () => {
    render(<PetApp />);

    fireEvent.click(screen.getByRole('button', { name: '上一首' }));
    await waitFor(() => expect(controlMainWindow).toHaveBeenCalledWith({ type: 'previous' }));

    fireEvent.click(screen.getByRole('button', { name: '下一首' }));
    await waitFor(() => expect(controlMainWindow).toHaveBeenCalledWith({ type: 'next' }));
  });

  it('stays still by default and starts the gif when the character is clicked', async () => {
    render(<PetApp />);

    expect(screen.getByAltText('ECHO 像素宠物').getAttribute('src')).toContain('echo-pet-idle.png');
    fireEvent.click(screen.getByRole('button', { name: 'ECHO 像素宠物' }));

    await waitFor(() => {
      expect(screen.getByAltText('ECHO 像素宠物').getAttribute('src')).toContain('echo-pet.gif');
    });
  });

  it('drags the pet from the character body without triggering a track action', async () => {
    render(<PetApp />);
    const characterButton = screen.getByRole('button', { name: 'ECHO 像素宠物' });
    await waitFor(() => expect(window.echo.pet.getState).toHaveBeenCalled());

    fireEvent.pointerDown(characterButton, { button: 0, pointerId: 7, screenX: 100, screenY: 80 });
    fireEvent.pointerMove(characterButton, { pointerId: 7, screenX: 124, screenY: 111 });
    fireEvent.pointerUp(characterButton, { pointerId: 7, screenX: 124, screenY: 111 });

    await waitFor(() => expect(moveTo).toHaveBeenLastCalledWith({ x: 424, y: 331 }));
    expect(controlMainWindow).not.toHaveBeenCalled();
  });
});
