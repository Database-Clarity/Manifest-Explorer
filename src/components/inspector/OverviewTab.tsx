import { useState, type MouseEvent, type ReactNode } from 'react';
import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  OverviewSocket,
  OverviewSocketCategory,
  OverviewSocketPlug,
} from '../../types/manifest';
import { bungieAssetUrl } from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import { BungieIcon } from '../BungieIcon';
import { Skeleton } from '../../ui/Skeleton';
import { ChevronDownIcon, ChevronRightIcon } from '../../ui/Icons';
import { getTierColorVar } from '../../ui/rarity';
import styles from './InspectorTabs.module.scss';

export type NavigateRef = (ref: DefinitionRef, inNewTab?: boolean) => void;

export interface OverviewTabProps {
  detail: DefinitionDetailPayload;
  loadingFull: boolean;
  clarityEntry: ClarityDescriptionEntry | null;
  clarityLoading: boolean;
  showClarity: boolean;
  onNavigateRef: NavigateRef;
  onLoadFullItem: () => void;
}

const ELEMENT_TOKEN_BY_ENUM: Record<number, string> = {
  1: 'var(--el-kinetic)',
  2: 'var(--el-arc)',
  3: 'var(--el-solar)',
  4: 'var(--el-void)',
  6: 'var(--el-stasis)',
  7: 'var(--el-strand)',
};

/** Categories that are core to combat stay open even when their pools are large. */
const CORE_SOCKET_CATEGORY_PATTERN =
  /intrinsic|trait|masterwork|weapon perks?|armor perks?|armor mods?|weapon mods?|abilities|aspects|fragments|subclass/i;

const LARGE_CATEGORY_PLUG_COUNT = 40;
const LARGE_SOCKET_PLUG_COUNT = 6;
const FILTERED_POOL_PLUG_COUNT = 10;
const DEFAULT_ICON_SIZE = 28;

interface RefButtonProps {
  ref: DefinitionRef;
  className: string | undefined;
  title?: string;
  onNavigate: NavigateRef;
  children: ReactNode;
}

/**
 * Every definition link opens in place on a plain click and in a new inspector
 * tab on Ctrl/Cmd+Click or middle-click.
 */
function RefButton({ ref, className, title, onNavigate, children }: RefButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={(event: MouseEvent<HTMLButtonElement>) =>
        onNavigate(ref, event.ctrlKey || event.metaKey)
      }
      onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (event.button !== 1) {
          return;
        }
        event.preventDefault();
        onNavigate(ref, true);
      }}
    >
      {children}
    </button>
  );
}

function tierStyle(tierType?: number): { color: string } | undefined {
  const color = getTierColorVar(tierType);
  return color ? { color } : undefined;
}

function itemRef(hash: number): DefinitionRef {
  return { table: 'DestinyInventoryItemDefinition', hash };
}

function totalPlugs(category: OverviewSocketCategory): number {
  return category.sockets.reduce((sum, socket) => sum + socket.plugs.length, 0);
}

function categoryStartsExpanded(category: OverviewSocketCategory): boolean {
  if (CORE_SOCKET_CATEGORY_PATTERN.test(category.name)) {
    return true;
  }
  return totalPlugs(category) <= LARGE_CATEGORY_PLUG_COUNT;
}

interface PlugPoolProps {
  plugs: OverviewSocketPlug[];
  onNavigate: NavigateRef;
}

function PlugPool({ plugs, onNavigate }: PlugPoolProps): ReactNode {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const visible =
    needle.length === 0
      ? plugs
      : plugs.filter(
          (plug) =>
            plug.name.toLowerCase().includes(needle) ||
            plug.itemTypeDisplayName.toLowerCase().includes(needle),
        );

  return (
    <div className={styles.socketPool}>
      {plugs.length > FILTERED_POOL_PLUG_COUNT ? (
        <input
          type="search"
          className={styles.poolFilter}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${plugs.length} plugs…`}
          aria-label={`Filter ${plugs.length} plugs`}
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}

      {visible.length === 0 ? (
        <p className={styles.poolEmpty}>No plugs match “{filter.trim()}”.</p>
      ) : (
        <div className={styles.plugGrid}>
          {visible.map((plug, index) => (
            <RefButton
              key={`${plug.hash}-${index}`}
              ref={itemRef(plug.hash)}
              className={styles.plugCell}
              title={plug.description || plug.name}
              onNavigate={onNavigate}
            >
              <BungieIcon icon={plug.icon} isEnhanced={plug.isEnhanced} size={28} />
              <span className={styles.entityText}>
                <span className={styles.entityName}>
                  {plug.name || `Item ${plug.hash}`}
                  {plug.isDefault ? <span className={styles.tagMuted}> (default)</span> : null}
                  {plug.currentlyCanRoll === false ? (
                    <span className={styles.tagMuted}> (retired)</span>
                  ) : null}
                </span>
                {plug.itemTypeDisplayName ? (
                  <span className={styles.entitySub} style={tierStyle(plug.tierType)}>
                    {plug.itemTypeDisplayName}
                  </span>
                ) : null}
              </span>
            </RefButton>
          ))}
        </div>
      )}
    </div>
  );
}

interface SocketSlotProps {
  socket: OverviewSocket;
  onNavigate: NavigateRef;
}

function SocketSlot({ socket, onNavigate }: SocketSlotProps): ReactNode {
  const [open, setOpen] = useState(socket.plugs.length <= LARGE_SOCKET_PLUG_COUNT);

  const plugs = socket.plugs;
  const primaryPlug =
    socket.singleInitialPlug ?? plugs.find((plug) => plug.isDefault) ?? plugs[0];
  const plugSetRef: DefinitionRef | null =
    socket.plugSetHash === undefined
      ? null
      : { table: 'DestinyPlugSetDefinition', hash: socket.plugSetHash };
  const plugSetLabel =
    socket.plugSetHash === undefined ? null : `PlugSet ${socket.plugSetHash}`;

  if (plugs.length <= 1) {
    return (
      <div className={styles.socketSlot}>
        {primaryPlug ? (
          <RefButton
            ref={itemRef(primaryPlug.hash)}
            className={styles.entityRow}
            title={primaryPlug.description || primaryPlug.name}
            onNavigate={onNavigate}
          >
            <BungieIcon
              icon={primaryPlug.icon}
              isEnhanced={primaryPlug.isEnhanced}
              size={DEFAULT_ICON_SIZE}
            />
            <span className={styles.entityText}>
              <span className={styles.entityName}>
                {primaryPlug.name || `Item ${primaryPlug.hash}`}
                {primaryPlug.isDefault ? (
                  <span className={styles.tagMuted}> (default)</span>
                ) : null}
                {primaryPlug.currentlyCanRoll === false ? (
                  <span className={styles.tagMuted}> (retired)</span>
                ) : null}
              </span>
              {primaryPlug.itemTypeDisplayName ? (
                <span className={styles.entitySub} style={tierStyle(primaryPlug.tierType)}>
                  {primaryPlug.itemTypeDisplayName}
                </span>
              ) : null}
            </span>
            <span className={styles.entityHash}>{primaryPlug.hash}</span>
          </RefButton>
        ) : (
          <div className={styles.socketEmptyRow}>
            <span>{socket.socketTypeName || `Socket ${socket.socketIndex}`}</span>
            {plugSetRef && plugSetLabel ? (
              <RefButton
                ref={plugSetRef}
                className={styles.inlineLink}
                onNavigate={onNavigate}
              >
                {plugSetLabel}
              </RefButton>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const slotLabel =
    primaryPlug?.name || socket.socketTypeName || `Socket ${socket.socketIndex}`;

  return (
    <div className={styles.socketSlot}>
      <div className={styles.socketSlotHeader}>
        <button
          type="button"
          className={styles.slotToggle}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          <BungieIcon
            icon={primaryPlug?.icon}
            isEnhanced={primaryPlug?.isEnhanced}
            size={24}
          />
          <span className={styles.slotLabel}>{slotLabel}</span>
          <span className={styles.slotMeta}>
            {plugs.length} plugs
            {socket.isRandomized ? (
              <span className={styles.slotTag}>Randomized</span>
            ) : null}
          </span>
        </button>
        {plugSetRef && plugSetLabel ? (
          <RefButton
            ref={plugSetRef}
            className={styles.inlineLink}
            title={`Open PlugSet ${socket.plugSetHash}`}
            onNavigate={onNavigate}
          >
            {plugSetLabel}
          </RefButton>
        ) : null}
      </div>

      {open ? <PlugPool plugs={plugs} onNavigate={onNavigate} /> : null}
    </div>
  );
}

interface SocketsSectionProps {
  categories: OverviewSocketCategory[];
  onNavigate: NavigateRef;
}

function SocketsSection({ categories, onNavigate }: SocketsSectionProps): ReactNode {
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  const isExpanded = (category: OverviewSocketCategory): boolean =>
    overrides[category.categoryHash] ?? categoryStartsExpanded(category);

  const setAll = (expanded: boolean): void => {
    const next: Record<number, boolean> = {};
    for (const category of categories) {
      next[category.categoryHash] = expanded;
    }
    setOverrides(next);
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Sockets</h3>
        <div className={styles.sectionActions}>
          <button type="button" className={styles.smallBtn} onClick={() => setAll(true)}>
            Expand all
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => setAll(false)}>
            Collapse all
          </button>
        </div>
      </div>

      <div className={styles.socketCategories}>
        {categories.map((category) => {
          const expanded = isExpanded(category);
          const socketCount = category.sockets.length;
          const plugCount = totalPlugs(category);

          return (
            <section key={category.categoryHash} className={styles.socketCategory}>
              <div className={styles.socketCatHeader}>
                <button
                  type="button"
                  className={styles.catToggle}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${category.name}`}
                  onClick={() =>
                    setOverrides((current) => ({
                      ...current,
                      [category.categoryHash]: !expanded,
                    }))
                  }
                >
                  {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                </button>
                <RefButton
                  ref={{
                    table: 'DestinySocketCategoryDefinition',
                    hash: category.categoryHash,
                  }}
                  className={styles.inlineLink}
                  onNavigate={onNavigate}
                >
                  {category.name}
                </RefButton>
                <span className={styles.socketCatCount}>
                  {socketCount} {socketCount === 1 ? 'socket' : 'sockets'} · {plugCount}{' '}
                  {plugCount === 1 ? 'plug' : 'plugs'}
                </span>
              </div>

              {expanded ? (
                <div className={styles.socketList}>
                  {category.sockets.map((socket) => (
                    <SocketSlot
                      key={`${socket.socketIndex}:${socket.plugs.length}`}
                      socket={socket}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function OverviewTab({
  detail,
  loadingFull,
  clarityEntry,
  clarityLoading,
  showClarity,
  onNavigateRef,
  onLoadFullItem,
}: OverviewTabProps): ReactNode {
  const overview = detail.overview;
  const displayProps = detail.data.displayProperties as
    | { name?: string; description?: string }
    | undefined;

  const rawTier = detail.data.tierType;
  const tierColor = getTierColorVar(typeof rawTier === 'number' ? rawTier : undefined);

  const hasContent =
    Boolean(displayProps?.description) ||
    Boolean(overview?.flavorText) ||
    Boolean(overview?.displaySource) ||
    Boolean(overview?.screenshot) ||
    Boolean(overview?.stats?.length) ||
    Boolean(overview?.socketCategories?.length) ||
    Boolean(overview?.perks?.length) ||
    Boolean(overview?.lore) ||
    Boolean(overview?.collectible) ||
    Boolean(overview?.linkedEntities?.length) ||
    Boolean(clarityEntry);

  return (
    <div className={styles.scrollBody}>
      {detail.isLite && (
        <div className={styles.noticeBanner}>
          <span>
            {loadingFull
              ? 'Loading full item definition (sockets, stats, lore)…'
              : 'Showing Lite definition. Load full item data for sockets and stats.'}
          </span>
          {!loadingFull && (
            <button type="button" className={styles.smallBtn} onClick={onLoadFullItem}>
              Load full item
            </button>
          )}
        </div>
      )}

      {overview?.screenshot && (
        <div className={styles.screenshotBlock}>
          <img
            src={bungieAssetUrl(overview.screenshot)}
            alt=""
            className={styles.heroScreenshot}
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      {(displayProps?.description || overview?.flavorText || overview?.displaySource) && (
        <section className={styles.section}>
          {displayProps?.description && (
            <p className={styles.prose}>{displayProps.description}</p>
          )}
          {overview?.flavorText && (
            <p className={styles.flavor}>{overview.flavorText}</p>
          )}
          {overview?.displaySource && (
            <p className={styles.metaLine}>
              <span className={styles.metaLabel}>Source:</span> {overview.displaySource}
            </p>
          )}
        </section>
      )}

      {(overview?.tierName ||
        overview?.damageType ||
        overview?.className ||
        overview?.ammoType ||
        overview?.categories?.length) && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Attributes</h3>
          <dl className={styles.kvGrid}>
            {overview.tierName && (
              <>
                <dt>Tier</dt>
                <dd style={tierColor ? { color: tierColor } : undefined}>
                  {overview.tierName}
                </dd>
              </>
            )}
            {overview.damageType && (
              <>
                <dt>Damage</dt>
                <dd className={styles.elementValue}>
                  <span
                    className={styles.elementDot}
                    style={{
                      backgroundColor:
                        ELEMENT_TOKEN_BY_ENUM[overview.damageType.enumValue] ??
                        'var(--text2)',
                    }}
                  />
                  <RefButton
                    ref={{
                      table: 'DestinyDamageTypeDefinition',
                      hash: overview.damageType.hash,
                    }}
                    className={styles.inlineLink}
                    onNavigate={onNavigateRef}
                  >
                    {overview.damageType.name}
                  </RefButton>
                </dd>
              </>
            )}
            {overview.ammoType && (
              <>
                <dt>Ammo</dt>
                <dd>{overview.ammoType}</dd>
              </>
            )}
            {overview.className && (
              <>
                <dt>Class</dt>
                <dd>{overview.className}</dd>
              </>
            )}
            {overview.categories && overview.categories.length > 0 && (
              <>
                <dt>Categories</dt>
                <dd className={styles.inlineList}>
                  {overview.categories.map((cat) => (
                    <RefButton
                      key={cat.hash}
                      ref={{ table: 'DestinyItemCategoryDefinition', hash: cat.hash }}
                      className={styles.inlineLink}
                      onNavigate={onNavigateRef}
                    >
                      {cat.name}
                    </RefButton>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {showClarity && (clarityLoading || clarityEntry) && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Clarity community notes</h3>
          {clarityLoading ? (
            <div className={styles.stackGap}>
              <Skeleton height="0.875rem" width="85%" />
              <Skeleton height="0.875rem" width="65%" />
            </div>
          ) : clarityEntry ? (
            <div className={styles.clarityBox}>
              {clarityEntry.lines.map((line, i) => (
                <p key={i} className={styles.clarityLine}>
                  {line}
                </p>
              ))}
              {clarityEntry.uploadedBy && (
                <div className={styles.clarityFoot}>
                  Updated by {clarityEntry.uploadedBy}
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {overview?.stats && overview.stats.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Stats</h3>
          <div className={styles.statList}>
            {overview.stats.map((stat) => {
              const pct =
                stat.maximumValue > 0
                  ? Math.max(0, Math.min(100, (stat.value / stat.maximumValue) * 100))
                  : 0;
              return (
                <div key={stat.statHash} className={styles.statRow}>
                  <RefButton
                    ref={{ table: 'DestinyStatDefinition', hash: stat.statHash }}
                    className={styles.statName}
                    title={stat.description}
                    onNavigate={onNavigateRef}
                  >
                    {stat.name}
                  </RefButton>
                  <span className={styles.statVal}>{stat.value}</span>
                  {stat.isBar ? (
                    <div className={styles.statBarTrack} aria-hidden="true">
                      <div className={styles.statBarFill} style={{ width: `${pct}%` }} />
                    </div>
                  ) : (
                    <span className={styles.statPlain} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {overview?.socketCategories && overview.socketCategories.length > 0 && (
        <SocketsSection
          key={`${detail.table}:${detail.hash}`}
          categories={overview.socketCategories}
          onNavigate={onNavigateRef}
        />
      )}

      {overview?.perks && overview.perks.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Sandbox perks</h3>
          <div className={styles.entityList}>
            {overview.perks.map((perk) => (
              <RefButton
                key={perk.perkHash}
                ref={{ table: 'DestinySandboxPerkDefinition', hash: perk.perkHash }}
                className={styles.entityRow}
                onNavigate={onNavigateRef}
              >
                <BungieIcon icon={perk.icon} size={28} />
                <span className={styles.entityText}>
                  <span className={styles.entityName}>
                    {perk.name || `Perk ${perk.perkHash}`}
                  </span>
                  {perk.description && (
                    <span className={styles.entitySub}>{perk.description}</span>
                  )}
                </span>
                <span className={styles.entityHash}>{perk.perkHash}</span>
              </RefButton>
            ))}
          </div>
        </section>
      )}

      {overview?.collectible && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Collectible</h3>
          <RefButton
            ref={{
              table: 'DestinyCollectibleDefinition',
              hash: overview.collectible.hash,
            }}
            className={styles.entityRow}
            onNavigate={onNavigateRef}
          >
            <span className={styles.entityText}>
              <span className={styles.entityName}>{overview.collectible.name}</span>
              {overview.collectible.sourceString && (
                <span className={styles.entitySub}>
                  {overview.collectible.sourceString}
                </span>
              )}
            </span>
            <span className={styles.entityHash}>{overview.collectible.hash}</span>
          </RefButton>
        </section>
      )}

      {overview?.lore && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Lore —{' '}
            <RefButton
              ref={{ table: 'DestinyLoreDefinition', hash: overview.lore.loreHash }}
              className={styles.inlineLink}
              onNavigate={onNavigateRef}
            >
              {overview.lore.name || `Lore ${overview.lore.loreHash}`}
            </RefButton>
          </h3>
          {overview.lore.subtitle && (
            <p className={styles.flavor}>{overview.lore.subtitle}</p>
          )}
          <div className={styles.loreText}>{overview.lore.description}</div>
        </section>
      )}

      {overview?.linkedEntities && overview.linkedEntities.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Linked definitions ({overview.linkedEntities.length})
          </h3>
          <div className={styles.entityList}>
            {overview.linkedEntities.map((ent, idx) => (
              <RefButton
                key={`${ent.table}-${ent.hash}-${idx}`}
                ref={{ table: ent.table, hash: ent.hash }}
                className={styles.entityRow}
                onNavigate={onNavigateRef}
              >
                <BungieIcon icon={ent.icon} size={28} />
                <span className={styles.entityText}>
                  <span className={styles.entityName}>
                    {ent.name || `${getShortTableName(ent.table)} ${ent.hash}`}
                  </span>
                  <span className={styles.entitySub}>
                    {ent.relation} · {ent.subtitle || getShortTableName(ent.table)}
                  </span>
                </span>
                <span className={styles.entityHash}>{ent.hash}</span>
              </RefButton>
            ))}
          </div>
        </section>
      )}

      {!hasContent && !detail.isLite && (
        <div className={styles.emptyState}>
          No structured overview fields for this definition type. Inspect the Pretty JSON
          tab for raw fields.
        </div>
      )}
    </div>
  );
}
