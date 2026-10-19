import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowLeft, ChevronRight, FolderPlus, LayoutGrid, ListTree, Music2, Search, Star } from 'lucide-react';
import type { LibraryFolderNode, LibraryFolderOverview } from '../../../shared/types/library';
import './folder-wall.css';

export type FolderWallTarget = {
  folderId: string;
  path: string;
  name: string;
  rootName: string;
  rootPath: string;
  importProfile?: LibraryFolderOverview['importProfile'];
  trackCount: number;
  childFolderCount: number;
  totalDuration: number;
  totalSizeBytes: number;
  coverThumbs: string[];
};
export type FolderWallLocation = { trail: FolderWallTarget[] };
const viewKey = 'echo-next.folders.view';
const keyFor = (item: FolderWallTarget): string => `${item.folderId}::${item.path}`;
const pageSize = 60;

export const useFolderWallPreference = (): [boolean, (value: boolean) => void] => {
  const [wall, setWall] = useState(() => {
    try { return localStorage.getItem(viewKey) !== 'tree'; } catch { return true; }
  });
  return [wall, (value) => {
    setWall(value);
    try { localStorage.setItem(viewKey, value ? 'wall' : 'tree'); } catch { /* Optional view preference. */ }
  }];
};

export const FolderViewSwitch = ({ wall, onChange }: { wall: boolean; onChange: (wall: boolean) => void }): JSX.Element => (
  <div className="folder-wall-view-switch" role="group" aria-label="文件夹视图">
    <button type="button" aria-label="文件夹墙" aria-pressed={wall} onClick={() => onChange(true)}><LayoutGrid size={16} /><span>文件夹墙</span></button>
    <button type="button" aria-label="目录树" aria-pressed={!wall} onClick={() => onChange(false)}><ListTree size={16} /><span>目录树</span></button>
  </div>
);

type Props = {
  roots: LibraryFolderOverview[];
  location: FolderWallLocation;
  onLocationChange: (location: FolderWallLocation) => void;
  childrenByParent: Record<string, LibraryFolderNode[]>;
  loadingChildren: Record<string, boolean>;
  loading: boolean;
  pinned: FolderWallTarget[];
  loadChildren: (folderId: string, path: string) => Promise<void>;
  onSelect: (target: FolderWallTarget) => void;
  onOpen: (target: FolderWallTarget) => void;
  onContextMenu: (event: MouseEvent, target: FolderWallTarget) => void;
  onAdd: () => void;
};

/** Cover-led folder browser, adapted from ECHO's FolderWall; never scans media itself. */
export const FolderWall = ({ roots, location, onLocationChange, childrenByParent, loadingChildren, loading, pinned, loadChildren, onSelect, onOpen, onContextMenu, onAdd }: Props): JSX.Element => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [page, setPage] = useState(0);
  const current = location.trail.at(-1);
  const root = current ? roots.find((item) => item.id === current.folderId) : undefined;
  const parentKey = current ? keyFor(current) : '';
  const busy = current ? Boolean(loadingChildren[parentKey]) : loading;
  const entries = useMemo((): FolderWallTarget[] => {
    const items = current && root
      ? (childrenByParent[parentKey] ?? []).map((node) => ({ ...node, rootName: root.name, rootPath: root.path, importProfile: root.importProfile }))
      : roots.map((item) => ({ ...item, folderId: item.id, rootName: item.name, rootPath: item.path }));
    const term = query.trim().toLocaleLowerCase();
    return items.filter((item) => !term || item.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => sort === 'count' ? b.trackCount - a.trackCount || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : 0);
  }, [childrenByParent, current, parentKey, query, root, roots, sort]);
  const lastPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
  const visiblePage = Math.min(page, lastPage);
  useEffect(() => { setQuery(''); setPage(0); }, [parentKey]);
  useEffect(() => {
    if (!loading && current && !root) onLocationChange({ trail: [] });
  }, [current, loading, onLocationChange, root]);

  const navigate = (trail: FolderWallTarget[]): void => {
    onLocationChange({ trail });
    const target = trail.at(-1);
    if (target) {
      onSelect(target);
      void loadChildren(target.folderId, target.path);
    }
  };
  const open = (target: FolderWallTarget): void => {
    if (target.childFolderCount > 0) navigate([...location.trail, target]);
    else onOpen(target);
  };

  return <section className="folder-wall" aria-label="文件夹墙">
    <div className="folder-wall-toolbar">
      <nav className="folder-wall-breadcrumbs" aria-label="文件夹墙路径">
        {current ? <button type="button" aria-label="上级文件夹" onClick={() => navigate(location.trail.slice(0, -1))}><ArrowLeft size={16} /></button> : null}
        <button type="button" aria-current={!current ? 'location' : undefined} onClick={() => navigate([])}>全部文件夹</button>
        {location.trail.map((item, index) => <span key={keyFor(item)}><ChevronRight size={12} /><button type="button" aria-current={index === location.trail.length - 1 ? 'location' : undefined} title={item.path} onClick={() => navigate(location.trail.slice(0, index + 1))}>{item.name}</button></span>)}
      </nav>
      <label className="folder-wall-search"><Search size={16} /><input type="search" aria-label="查找文件夹" placeholder="查找文件夹" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      <select className="folder-wall-sort" aria-label="文件夹排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}>
        <option value="default">原有顺序</option><option value="name">名称 A–Z</option><option value="count">歌曲最多</option>
      </select>
    </div>
    {pinned.length > 0 && !current ? <div className="folder-wall-pins" aria-label="固定文件夹">{pinned.filter((item) => roots.some((folder) => folder.id === item.folderId)).map((item) => <button type="button" key={keyFor(item)} title={item.path} onClick={() => onOpen(item)}><Star size={13} fill="currentColor" />{item.name}</button>)}</div> : null}
    {current ? <div className="folder-wall-current"><div><h2>{current.name}</h2><p>{current.trackCount} 首歌曲 · {current.childFolderCount} 个子文件夹</p></div><button type="button" className="secondary-action" onClick={() => onOpen(current)}><Music2 size={16} />查看歌曲</button></div> : null}
    <div className="folder-wall-result" role="status">{busy ? '正在读取文件夹…' : `${entries.length} 个文件夹`}</div>
    {!busy && entries.length === 0 ? <div className="folder-wall-empty"><Music2 size={32} strokeWidth={1} /><strong>{query ? '没有匹配的文件夹' : current ? '没有子文件夹' : '添加你的音乐文件夹'}</strong><p>{query ? '试试其他文件夹名称。' : current ? '点击查看歌曲，浏览这个目录中的音乐。' : '导入后，封面和子目录会显示在这里。'}</p>{query ? <button type="button" className="secondary-action" onClick={() => setQuery('')}>清除搜索</button> : !current ? <button type="button" className="primary-action" onClick={onAdd}><FolderPlus size={16} />添加文件夹</button> : null}</div> : null}
    <div className="folder-wall-grid">
      {entries.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map((item) => {
        const covers = [...new Set(item.coverThumbs.filter(Boolean))].slice(0, 3);
        return <article className="folder-wall-card" key={keyFor(item)} onContextMenu={(event) => onContextMenu(event, item)}>
          <button className="folder-wall-open" type="button" aria-label={`打开文件夹 ${item.name}`} title={item.path} onClick={() => open(item)}>
            <span className="folder-wall-art" aria-hidden="true">
              {covers.slice(1).reverse().map((src, index, back) => <span className="folder-wall-cover folder-wall-cover--back" data-layer={back.length - index} key={src}><img src={src} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /></span>)}
              <span className="folder-wall-cover folder-wall-cover--main"><Music2 size={36} strokeWidth={1} />{covers[0] ? <img key={covers[0]} src={covers[0]} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : null}</span>
            </span>
            <strong>{item.name}</strong><span className="folder-wall-meta">{item.trackCount} 首{item.childFolderCount > 0 ? ` · ${item.childFolderCount} 个子文件夹` : ''}</span>
          </button>
          <button type="button" className="folder-wall-songs" aria-label={`查看歌曲 · ${item.name}`} title="查看歌曲" onClick={() => onOpen(item)}><Music2 size={16} /></button>
        </article>;
      })}
    </div>
    {lastPage > 0 ? <nav className="folder-wall-pagination" aria-label="文件夹分页"><button type="button" className="tool-button" aria-label="上一页" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}><ArrowLeft size={16} /></button><span>{visiblePage + 1} / {lastPage + 1}</span><button type="button" className="tool-button" aria-label="下一页" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={16} /></button></nav> : null}
  </section>;
};
