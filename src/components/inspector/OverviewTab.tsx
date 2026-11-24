import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  ImageScalingMode,
  OverviewLinkedEntity,
  OverviewPerk,
  OverviewSocket,
  OverviewSocketCategory,
  OverviewSocketPlug,
} from '../../types/manifest';
import { bungieAssetUrl } from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import { BungieIcon } from '../BungieIcon';
import { Skeleton } from '../../ui/Skeleton';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClarityLogoMark,
  ExternalLinkIcon,
} from '../../ui/Icons';
import { getTierColorVar } from '../../ui/rarity';
import { ClearSearchInput } from '../../ui/ClearSearchInput';
import { activateOnMiddleClick, preventMiddleClickAutoScroll } from '../middleClick';
import styles from './InspectorTabs.module.scss';

const LazyImageLightbox = lazy(() =>
  import('./ImageLightbox').then((module) => ({ default: module.ImageLightbox })),
);

export type NavigateRef = (ref: DefinitionRef, inNewTab?: boolean) => void;

export interface OverviewTabProps {
  detail: DefinitionDetailPayload;
  loadingFull: boolean;
  clarityEntry: ClarityDescriptionEntry | null;
  clarityLoading: boolean;
  showClarity: boolean;
  imageScaling: ImageScalingMode;
  onNavigateRef: NavigateRef;
  onCopy: (text: string, label: string) => void;
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
  openInNewTabLabel?: string;
  children: ReactNode;
}

/**
 * Every definition link opens in place on a plain click and in a new inspector
 * tab on Ctrl/Cmd+Click or middle-click. Rows can additionally expose an
 * explicit new-tab action for touch users.
 */
function RefButton({
  ref,
  className,
  title,
  onNavigate,
  openInNewTabLabel,
  children,
}: RefButtonProps): ReactNode {
  const mainButton = (
    <button
      type="button"
      className={className}
      title={title}
      onClick={(event: MouseEvent<HTMLButtonElement>) =>
        onNavigate(ref, event.ctrlKey || event.metaKey)
      }
      onMouseDown={preventMiddleClickAutoScroll}
      onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
        activateOnMiddleClick(event, () => onNavigate(ref, true));
      }}
    >
      {children}
    </button>
  );

  if (!openInNewTabLabel) {
    return mainButton;
  }

  return (
    <div className={styles.refActionRow}>
      {mainButton}
      <button
        type="button"
        className={styles.openInNewTabBtn}
        aria-label={`Open ${openInNewTabLabel} in new tab`}
        title={`Open ${openInNewTabLabel} in new tab`}
        onClick={() => onNavigate(ref, true)}
        onMouseDown={preventMiddleClickAutoScroll}
        onAuxClick={(event) => activateOnMiddleClick(event, () => onNavigate(ref, true))}
      >
        <ExternalLinkIcon size={14} />
      </button>
    </div>
  );
}

function tierStyle(tierType?: number): { color: string } | undefined {
  const color = getTierColorVar(tierType);
  return color ? { color } : undefined;
}

/**
 * Stable navigation callback so memoized sections (Sockets/pools) are not
 * invalidated by a fresh parent arrow function on every render.
 */
function useStableNavigate(navigate: NavigateRef): NavigateRef {
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  return useCallback(
    (ref: DefinitionRef, inNewTab?: boolean) => navigateRef.current(ref, inNewTab),
    [],
  );
}

function itemRef(hash: number, label?: string, icon?: string): DefinitionRef {
  return {
    table: 'DestinyInventoryItemDefinition',
    hash,
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
  };
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
  const visible = useMemo(
    () =>
      needle.length === 0
        ? plugs
        : plugs.filter(
            (plug) =>
              plug.name.toLowerCase().includes(needle) ||
              plug.itemTypeDisplayName.toLowerCase().includes(needle),
          ),
    [plugs, needle],
  );

  return (
    <div className={styles.socketPool}>
      {plugs.length > FILTERED_POOL_PLUG_COUNT ? (
        <ClearSearchInput
          className={styles.poolFilter}
          wrapperClassName={styles.poolFilterField}
          value={filter}
          onValueChange={setFilter}
          placeholder={`Filter ${plugs.length} plugs…`}
          aria-label={`Filter ${plugs.length} plugs`}
          clearLabel="Clear plug filter"
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
              ref={itemRef(plug.hash, plug.name, plug.icon)}
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
            ref={itemRef(primaryPlug.hash, primaryPlug.name, primaryPlug.icon)}
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

const SocketsSection = memo(function SocketsSection({
  categories,
  onNavigate,
}: SocketsSectionProps): ReactNode {
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
                    label: category.name || undefined,
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
});

interface SandboxPerksSectionProps {
  perks: OverviewPerk[];
  onNavigate: NavigateRef;
}

function SandboxPerksSection({ perks, onNavigate }: SandboxPerksSectionProps): ReactNode {
  const [open, setOpen] = useState(perks.length <= 8);
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const visible =
    needle.length === 0
      ? perks
      : perks.filter(
          (perk) =>
            perk.name.toLowerCase().includes(needle) ||
            perk.description.toLowerCase().includes(needle) ||
            String(perk.perkHash).includes(needle),
        );

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.collapsibleToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} Sandbox perks (${perks.length})`}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className={styles.collapsibleTitle}>Sandbox perks</span>
        <span className={styles.collapsibleCount}>({perks.length})</span>
      </button>
      {open ? (
        <div className={styles.collapsibleContent}>
          {perks.length > FILTERED_POOL_PLUG_COUNT ? (
            <ClearSearchInput
              className={styles.poolFilter}
              wrapperClassName={styles.poolFilterField}
              value={filter}
              onValueChange={setFilter}
              placeholder={`Filter ${perks.length} perks…`}
              aria-label={`Filter ${perks.length} perks`}
              clearLabel="Clear perk filter"
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}
          {visible.length === 0 ? (
            <p className={styles.poolEmpty}>No perks match “{filter.trim()}”.</p>
          ) : (
            <div className={styles.entityList}>
              {visible.map((perk) => (
                <RefButton
                  key={perk.perkHash}
                  ref={{
                    table: 'DestinySandboxPerkDefinition',
                    hash: perk.perkHash,
                    label: perk.name || undefined,
                    icon: perk.icon,
                  }}
                  className={styles.entityRow}
                  onNavigate={onNavigate}
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
          )}
        </div>
      ) : null}
    </section>
  );
}

interface LinkedDefinitionsSectionProps {
  linkedEntities: OverviewLinkedEntity[];
  onNavigate: NavigateRef;
}

function LinkedDefinitionsSection({
  linkedEntities,
  onNavigate,
}: LinkedDefinitionsSectionProps): ReactNode {
  const [open, setOpen] = useState(linkedEntities.length <= FILTERED_POOL_PLUG_COUNT);
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const visible =
    needle.length === 0
      ? linkedEntities
      : linkedEntities.filter((entity) =>
          [
            entity.name,
            entity.relation,
            entity.subtitle,
            getShortTableName(entity.table),
            String(entity.hash),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        );

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.collapsibleToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} Linked definitions (${linkedEntities.length})`}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className={styles.collapsibleTitle}>Linked definitions</span>
        <span className={styles.collapsibleCount}>({linkedEntities.length})</span>
      </button>
      {open ? (
        <div className={styles.collapsibleContent}>
          {linkedEntities.length > FILTERED_POOL_PLUG_COUNT ? (
            <ClearSearchInput
              className={styles.poolFilter}
              wrapperClassName={styles.poolFilterField}
              value={filter}
              onValueChange={setFilter}
              placeholder={`Filter ${linkedEntities.length} definitions…`}
              aria-label={`Filter ${linkedEntities.length} definitions`}
              clearLabel="Clear definition filter"
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}
          {visible.length === 0 ? (
            <p className={styles.poolEmpty}>No definitions match “{filter.trim()}”.</p>
          ) : (
            <div className={styles.entityList}>
              {visible.map((entity, idx) => (
                <RefButton
                  key={`${entity.table}-${entity.hash}-${idx}`}
                  ref={{
                    table: entity.table,
                    hash: entity.hash,
                    label: entity.name || undefined,
                    icon: entity.icon,
                  }}
                  className={styles.entityRow}
                  onNavigate={onNavigate}
                  openInNewTabLabel={
                    entity.name || `${getShortTableName(entity.table)} ${entity.hash}`
                  }
                >
                  <BungieIcon icon={entity.icon} size={28} />
                  <span className={styles.entityText}>
                    <span className={styles.entityName}>
                      {entity.name || `${getShortTableName(entity.table)} ${entity.hash}`}
                    </span>
                    <span className={styles.entitySub}>
                      {entity.relation} · {entity.subtitle || getShortTableName(entity.table)}
                    </span>
                  </span>
                  <span className={styles.entityHash}>{entity.hash}</span>
                </RefButton>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export const OverviewTab = memo(function OverviewTab({
  detail,
  loadingFull,
  clarityEntry,
  clarityLoading,
  showClarity,
  imageScaling,
  onNavigateRef,
  onCopy,
  onLoadFullItem,
}: OverviewTabProps): ReactNode {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const handleNavigateRef = useStableNavigate(onNavigateRef);
  const overview = detail.overview;
  type OverviewWithParentArtifact = NonNullable<DefinitionDetailPayload['overview']> & {
    parentArtifact?: { hash: number; name: string; icon?: string };
  };
  const parentArtifact = (overview as OverviewWithParentArtifact | undefined)?.parentArtifact;
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
    Boolean(parentArtifact) ||
    Boolean(overview?.linkedEntities?.length) ||
    Boolean(clarityEntry);

  return (
    <div className={styles.scrollBody} data-inspector-scroll="true">
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
        <button
          type="button"
          className={styles.screenshotBlock}
          onClick={() => setLightbox(overview.screenshot ?? null)}
          title="Open screenshot full size"
          aria-label="Open screenshot full size"
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            font: 'inherit',
            cursor: 'zoom-in',
          }}
        >
          <img
            src={bungieAssetUrl(overview.screenshot)}
            alt=""
            className={styles.heroScreenshot}
            loading="lazy"
            decoding="async"
          />
        </button>
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

      {overview &&
        (overview.tierName ||
          overview.damageType ||
          overview.className ||
          overview.ammoType ||
          parentArtifact ||
          overview.categories?.length) && (
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
                      label: overview.damageType.name || undefined,
                      icon: overview.damageType.icon,
                    }}
                    className={styles.inlineLink}
                    onNavigate={handleNavigateRef}
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
            {parentArtifact ? (
              <>
                <dt>Artifact</dt>
                <dd>
                  <RefButton
                    ref={{
                      table: 'DestinyInventoryItemDefinition',
                      hash: parentArtifact.hash,
                      label: parentArtifact.name,
                      icon: parentArtifact.icon,
                    }}
                    className={styles.entityRow}
                    onNavigate={handleNavigateRef}
                  >
                    <BungieIcon icon={parentArtifact.icon} size={18} />
                    <span className={styles.entityName}>{parentArtifact.name}</span>
                  </RefButton>
                </dd>
              </>
            ) : null}
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
                      ref={{
                        table: 'DestinyItemCategoryDefinition',
                        hash: cat.hash,
                        label: cat.name || undefined,
                      }}
                      className={styles.inlineLink}
                      onNavigate={handleNavigateRef}
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
          <h3 className={styles.sectionTitle}>
            <ClarityLogoMark
              size={14}
              style={{ marginRight: '0.375rem', verticalAlign: '-0.1875rem' }}
            />
            Clarity community notes
          </h3>
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
                    ref={{
                      table: 'DestinyStatDefinition',
                      hash: stat.statHash,
                      label: stat.name || undefined,
                    }}
                    className={styles.statName}
                    title={stat.description}
                    onNavigate={handleNavigateRef}
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
          key={`sockets:${detail.table}:${detail.hash}`}
          categories={overview.socketCategories}
          onNavigate={handleNavigateRef}
        />
      )}

      {overview?.perks && overview.perks.length > 0 && (
        <SandboxPerksSection
          key={`perks:${detail.table}:${detail.hash}`}
          perks={overview.perks}
          onNavigate={handleNavigateRef}
        />
      )}

      {overview?.collectible && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Collectible</h3>
          <RefButton
            ref={{
              table: 'DestinyCollectibleDefinition',
              hash: overview.collectible.hash,
              label: overview.collectible.name || undefined,
            }}
            className={styles.entityRow}
            onNavigate={handleNavigateRef}
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
              ref={{
                table: 'DestinyLoreDefinition',
                hash: overview.lore.loreHash,
                label: overview.lore.name || undefined,
              }}
              className={styles.inlineLink}
              onNavigate={handleNavigateRef}
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
        <LinkedDefinitionsSection
          key={`linked:${detail.table}:${detail.hash}`}
          linkedEntities={overview.linkedEntities}
          onNavigate={handleNavigateRef}
        />
      )}

      {!hasContent && !detail.isLite && (
        <div className={styles.emptyState}>
          No structured overview fields for this definition type. Inspect the Pretty JSON
          tab for raw fields.
        </div>
      )}
      {lightbox && (
        <Suspense fallback={null}>
          <LazyImageLightbox
            url={bungieAssetUrl(lightbox)}
            path={lightbox}
            defaultScaling={imageScaling}
            onClose={() => setLightbox(null)}
            onCopy={onCopy}
          />
        </Suspense>
      )}
    </div>
  );
});
