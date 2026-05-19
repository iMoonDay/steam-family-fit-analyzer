import type { GameContextMenuState, MoreMenuState, ResultGameRow } from "../../appTypes";

export function ResultMoreMenu({
  state,
  showAppId,
  onToggleAppId,
  onReloadCovers,
  onSaveListPoster,
  onCopyList,
  onCopyNames,
  onCopyReport
}: {
  state: MoreMenuState;
  showAppId: boolean;
  onToggleAppId: () => void;
  onReloadCovers: () => void;
  onSaveListPoster: () => void;
  onCopyList: () => void;
  onCopyNames: () => void;
  onCopyReport: () => void;
}) {
  return (
    <div
      className="context-menu result-more-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onCopyList}>
        复制列表
      </button>
      <button type="button" role="menuitem" onClick={onCopyNames}>
        复制游戏名
      </button>
      <button type="button" role="menuitem" onClick={onCopyReport}>
        复制报告
      </button>
      <button type="button" role="menuitem" onClick={onSaveListPoster}>
        保存封面图
      </button>
      <button type="button" role="menuitem" onClick={onReloadCovers}>
        重载封面
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showAppId}
        className="menu-switch-item"
        onClick={onToggleAppId}
      >
        <span>显示 AppID</span>
        <span className={`menu-switch ${showAppId ? "is-on" : ""}`} aria-hidden="true">
          <span />
        </span>
      </button>
    </div>
  );
}

export function GameContextMenu({
  state,
  onOpenWebpage,
  onRefreshCover
}: {
  state: GameContextMenuState;
  onOpenWebpage: (game: ResultGameRow) => void;
  onRefreshCover: (game: ResultGameRow) => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => onOpenWebpage(state.game)}>
        打开网页
      </button>
      <button type="button" role="menuitem" onClick={() => onRefreshCover(state.game)}>
        刷新封面
      </button>
    </div>
  );
}
