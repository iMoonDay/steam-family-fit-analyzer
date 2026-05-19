import { memo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { ResultGameListKey, ResultGameRow } from "../../appTypes";
import { openExternalUrl } from "../../core/external";
import {
  formatPrice,
  getGameCardOwnerTags,
  getReportGameStatusLabel,
  getSteamCoverUrl
} from "../../core/report";
import { OwnerTagList, StatusTag } from "./OwnerTags";

export const GameCard = memo(function GameCard({
  game,
  listKey,
  showAppId,
  coverReloadToken,
  coverCachePath,
  onContextMenu
}: {
  game: ResultGameRow;
  listKey: ResultGameListKey;
  showAppId: boolean;
  coverReloadToken: number;
  coverCachePath: string;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  const shouldShowStatusTag = listKey === "all" && getReportGameStatusLabel(game.status) !== "-";
  const priceText = formatPrice(game.price);
  return (
    <a
      className="game-card"
      data-game-appid={game.appid}
      href={game.storeLink}
      onClick={event => {
        event.preventDefault();
        void openExternalUrl(game.storeLink);
      }}
      onContextMenu={event => onContextMenu(event, game)}
      style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadToken, coverCachePath)}")` } as CSSProperties}
      aria-label={game.name}
      title={game.name}
    >
      <span className="game-card-media">
        {shouldShowStatusTag ? <span className="game-card-status-tag"><StatusTag status={game.status} /></span> : null}
        {priceText !== "-" ? <span className="game-card-price-tag">{priceText}</span> : null}
        {showAppId ? <span className={`game-card-chip ${shouldShowStatusTag ? "has-status-tag" : ""}`}>ID {game.appid}</span> : null}
        <span className="game-card-overlay">
          <span className="game-card-title">{game.name}</span>
          <OwnerTagList owners={getGameCardOwnerTags(game, listKey)} className="game-card-owner-tags" />
        </span>
      </span>
    </a>
  );
});
