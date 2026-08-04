import type { LibraryPlaylist } from '../../shared/types/library';

type PromptOption = {
  id: string;
  label: string;
  description?: string | null;
};

type ChoicePromptOptions = {
  title: string;
  message?: string;
  options: PromptOption[];
  cancelLabel?: string;
};

type TextPromptOptions = {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PromptRootMode = 'dialog' | 'menu';

type PlaylistPromptBridge = {
  getPlaylists: () => Promise<LibraryPlaylist[]>;
  createPlaylist: (input: { name: string }) => Promise<LibraryPlaylist>;
};

type PlaylistPromptOptions = {
  title?: string;
  message?: string;
  createTitle?: string;
  createMessage?: string;
};

const resolvePromptMenuPosition = (): { left: number; top: number } | null => {
  const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!anchor || anchor === document.body) {
    return null;
  }

  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const menuWidth = Math.min(300, window.innerWidth - 20);
  const menuMaxHeight = Math.min(360, window.innerHeight - 24);
  const margin = 10;
  const gap = 8;
  const left = Math.min(
    window.innerWidth - menuWidth - margin,
    Math.max(margin, rect.right - menuWidth),
  );
  const belowTop = rect.bottom + gap;
  const top = belowTop + menuMaxHeight <= window.innerHeight - margin
    ? belowTop
    : Math.max(margin, rect.top - menuMaxHeight - gap);

  return { left, top };
};

const closePrompt = (root: HTMLDivElement): void => {
  root.remove();
};

const createPromptRoot = (
  title: string,
  message?: string,
  mode: PromptRootMode = 'dialog',
): { root: HTMLDivElement; panel: HTMLDivElement } => {
  const root = document.createElement('div');
  root.className = mode === 'menu' ? 'app-prompt-root app-prompt-root--menu' : 'app-prompt-root';
  root.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = mode === 'menu' ? 'app-prompt-panel app-prompt-menu' : 'app-prompt-panel';
  panel.setAttribute('role', mode === 'menu' ? 'menu' : 'dialog');
  if (mode === 'menu') {
    const position = resolvePromptMenuPosition();
    if (position) {
      panel.style.setProperty('--app-prompt-menu-left', `${Math.round(position.left)}px`);
      panel.style.setProperty('--app-prompt-menu-top', `${Math.round(position.top)}px`);
    }
  }
  if (mode === 'dialog') {
    panel.setAttribute('aria-modal', 'true');
  }
  panel.setAttribute('aria-label', title);

  const heading = document.createElement('h2');
  heading.textContent = title;
  panel.appendChild(heading);

  if (message) {
    const copy = document.createElement('p');
    copy.textContent = message;
    panel.appendChild(copy);
  }

  root.appendChild(panel);
  document.body.appendChild(root);
  return { root, panel };
};

export const chooseAppPromptOption = ({
  title,
  message,
  options,
  cancelLabel = '取消',
}: ChoicePromptOptions): Promise<string | null> =>
  new Promise((resolve) => {
    if (options.length === 0) {
      resolve(null);
      return;
    }

    const { root, panel } = createPromptRoot(title, message, 'menu');
    const list = document.createElement('div');
    list.className = 'app-prompt-options';

    const finish = (value: string | null): void => {
      root.removeEventListener('mousedown', handleOutsidePress);
      root.removeEventListener('keydown', handleKeyDown);
      closePrompt(root);
      resolve(value);
    };

    function handleOutsidePress(event: MouseEvent): void {
      if (event.target === root) {
        finish(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    }

    root.addEventListener('mousedown', handleOutsidePress);
    root.addEventListener('keydown', handleKeyDown);

    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-prompt-option';
      button.textContent = option.label;
      button.addEventListener('click', () => finish(option.id), { once: true });
      if (option.description) {
        const small = document.createElement('small');
        small.textContent = option.description;
        button.appendChild(small);
      }
      list.appendChild(button);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'app-prompt-cancel';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', () => finish(null), { once: true });

    panel.appendChild(list);
    panel.appendChild(cancel);
    (list.querySelector('button') ?? cancel).focus();
  });

export const requestAppPromptText = ({
  title,
  message,
  placeholder = '',
  confirmLabel = '确定',
  cancelLabel = '取消',
}: TextPromptOptions): Promise<string | null> =>
  new Promise((resolve) => {
    const { root, panel } = createPromptRoot(title, message);
    const input = document.createElement('input');
    input.className = 'app-prompt-input';
    input.type = 'text';
    input.placeholder = placeholder;

    const actions = document.createElement('div');
    actions.className = 'app-prompt-actions';

    const finish = (value: string | null): void => {
      closePrompt(root);
      resolve(value);
    };

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'app-prompt-confirm';
    confirm.textContent = confirmLabel;
    confirm.addEventListener('click', () => finish(input.value), { once: true });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'app-prompt-cancel';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', () => finish(null), { once: true });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(input.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    });

    actions.append(confirm, cancel);
    panel.append(input, actions);
    input.focus();
  });

export const resolvePlaylistForTrackAdd = async (
  library: PlaylistPromptBridge,
  {
    title = '选择歌单',
    message = '选择要加入的本地歌单。',
    createTitle = '新建本地歌单',
    createMessage = '创建后会把歌曲加入这个歌单。',
  }: PlaylistPromptOptions = {},
): Promise<LibraryPlaylist | null> => {
  const playlists = (await library.getPlaylists()).filter((playlist) => playlist.sourceProvider === 'local' && playlist.kind !== 'system');
  let playlist: LibraryPlaylist | null = playlists[0] ?? null;

  if (playlists.length > 1) {
    const playlistId = await chooseAppPromptOption({
      title,
      message,
      options: playlists.map((item) => ({
        id: item.id,
        label: item.name,
        description: `${item.itemCount} 首`,
      })),
    });
    if (!playlistId) {
      return null;
    }
    playlist = playlists.find((item) => item.id === playlistId) ?? null;
  }

  if (!playlist) {
    const name = await requestAppPromptText({
      title: createTitle,
      message: createMessage,
      placeholder: '歌单名称',
    });
    const trimmedName = name?.trim();
    if (!trimmedName) {
      return null;
    }
    playlist = await library.createPlaylist({ name: trimmedName });
  }

  return playlist;
};
