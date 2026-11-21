import { useCallback, useMemo, useRef, type PointerEvent, type ReactNode } from 'react';
import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
  InspectorTab,
  ReverseReferenceResponse,
  VariantItem,
} from '../../types/manifest';
import { toSignedHash, toUnsignedHash } from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import { useCollectorStore } from '../../stores/collector';
import { useExplorerStore } from '../../stores/explorer';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DiffIcon,
  DownloadIcon,
  LinkIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
} from '../../ui/Icons';
import { Skeleton } from '../../ui/Skeleton';
import { BungieIcon } from '../BungieIcon';
import { DiffTab } from './DiffTab';
import { JsonTree } from './JsonTree';
import { OverviewTab } from './OverviewTab';
import { ReferencesTab } from './ReferencesTab';
import { VariantsTab } from './VariantsTab';
import styles from './DefinitionInspector.module.scss';

export interface DefinitionInspectorProps {
  width: number;
  onResize: (width: number) => void;
  currentRef: DefinitionRef | null;
  detail: DefinitionDetailPayload | null;
  loading: boolean;
  loadingFull: boolean;
  error: string | null;
  variants: VariantItem[];
  variantsLoading: boolean;
  references: ReverseReferenceResponse | null;
  referencesLoading: boolean;
  pinnedDetail: DefinitionDetailPayload | null;
  pinnedLoading: boolean;
  clarityEntry: ClarityDescriptionEntry | null;
  clarityLoading: boolean;
  showClarity: boolean;
  onNavigateRef: (ref: DefinitionRef, pushToStack?: boolean, inNewTab?: boolean) => void;
  onLoadFullItem: () => void;
  onLoadPriorityTable: (table: string) => void;
  onRetry: () => void;
}

const TABS: ReadonlyArray<{ id: InspectorTab; label: string; shortLabel: string }> = [
  { id: 'pretty', label: 'Pretty', shortLabel: 'Pretty' },
  { id: 'overview', label: 'Overview', shortLabel: 'Info' },
  { id: 'variants', label: 'Variants', shortLabel: 'Vars' },
  { id: 'references', label: 'References', shortLabel: 'Refs' },
  { id: 'raw', label: 'Raw', shortLabel: 'Raw' },
  { id: 'diff', label: 'Diff', shortLabel: 'Diff' },
];

export function DefinitionInspector({
  width,
  onResize,
  currentRef,
  detail,
  loading,
  loadingFull,
  error,
  variants,
  variantsLoading,
  references,
  referencesLoading,
  pinnedDetail,
  pinnedLoading,
  clarityEntry,
  clarityLoading,
  showClarity,
  onNavigateRef,
  onLoadFullItem,
  onLoadPriorityTable,
  onRetry,
}: DefinitionInspectorProps): ReactNode {
  const sessions = useExplorerStore((s) => s.sessions);
  const activeSessionIndex = useExplorerStore((s) => s.activeSessionIndex);
  const stack = useExplorerStore((s) => s.stack);
  const stackIndex = useExplorerStore((s) => s.stackIndex);
  const activeTab = useExplorerStore((s) => s.activeTab);
  const pinnedDiffRef = useExplorerStore((s) => s.pinnedDiffRef);
  const inspectorMaximized = useExplorerStore((s) => s.inspectorMaximized);
  const switchSession = useExplorerStore((s) => s.switchSession);
  const closeSession = useExplorerStore((s) => s.closeSession);
  const toggleInspectorMaximized = useExplorerStore((s) => s.toggleInspectorMaximized);
  const navigateBack = useExplorerStore((s) => s.navigateBack);
  const navigateForward = useExplorerStore((s) => s.navigateForward);
  const jumpToStackIndex = useExplorerStore((s) => s.jumpToStackIndex);
  const closeInspector = useExplorerStore((s) => s.closeInspector);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);
  const pinForDiff = useExplorerStore((s) => s.pinForDiff);
  const clearPinnedDiff = useExplorerStore((s) => s.clearPinnedDiff);
  const pushNotice = useExplorerStore((s) => s.pushNotice);

  const collectedItems = useCollectorStore((s) => s.items);
  const toggleCollectItem = useCollectorStore((s) => s.toggleItem);

  const dragStartRef = useRef<{ x: number; startWidth: number } | null>(null);

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        pushNotice({ tone: 'info', message: label });
      } catch {
        pushNotice({ tone: 'warn', message: 'Clipboard unavailable in this browser context.' });
      }
    },
    [pushNotice],
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      dragStartRef.current = { x: event.clientX, startWidth: width };
    },
    [width],
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) {
        return;
      }
      const delta = dragStartRef.current.x - event.clientX;
      onResize(dragStartRef.current.startWidth + delta);
    },
    [onResize],
  );

  const handleResizePointerUp = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  const displayProps = detail?.data.displayProperties as
    | { name?: string; icon?: string; description?: string }
    | undefined;
  const itemName =
    (typeof displayProps?.name === 'string' && displayProps.name.trim()) ||
    (typeof detail?.data.statName === 'string' && detail.data.statName.trim()) ||
    (typeof detail?.data.progressDescription === 'string' &&
      detail.data.progressDescription.trim()) ||
    (currentRef ? `${getShortTableName(currentRef.table)} ${currentRef.hash}` : '');
  const itemSubtitle =
    (typeof detail?.data.itemTypeAndTierDisplayName === 'string' &&
      detail.data.itemTypeAndTierDisplayName) ||
    (typeof detail?.data.itemTypeDisplayName === 'string' &&
      detail.data.itemTypeDisplayName) ||
    (currentRef ? getShortTableName(currentRef.table) : '');
  const iconPath =
    typeof displayProps?.icon === 'string' ? displayProps.icon : undefined;
  const watermarkPath =
    typeof detail?.data.iconWatermark === 'string'
      ? detail.data.iconWatermark
      : undefined;
  const tierType =
    typeof (detail?.data.inventory as { tierType?: unknown } | undefined)?.tierType ===
    'number'
      ? ((detail?.data.inventory as { tierType: number }).tierType)
      : undefined;

  const unsignedHash = currentRef ? toUnsignedHash(currentRef.hash) : 0;
  const signedHash = currentRef ? toSignedHash(currentRef.hash) : 0;

  const isCollected = currentRef
    ? collectedItems.some(
        (item) => item.table === currentRef.table && item.hash === unsignedHash,
      )
    : false;

  const rawJsonText = useMemo(() => {
    if (activeTab !== 'raw' || !detail) {
      return '';
    }
    return JSON.stringify(detail.data, null, 2);
  }, [activeTab, detail]);

  const handleDownloadJson = useCallback(() => {
    if (!detail) {
      return;
    }
    const blob = new Blob([JSON.stringify(detail.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getShortTableName(detail.table)}-${detail.hash}.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushNotice({ tone: 'info', message: `Downloaded ${link.download}` });
  }, [detail, pushNotice]);

  if (!currentRef) {
    return null;
  }

  return (
    <aside
      className={`${styles.pane} ${inspectorMaximized ? styles.paneMaximized : ''}`}
      style={{ '--inspector-w': `${width}px` } as React.CSSProperties}
      aria-label="Definition inspector"
    >
      {!inspectorMaximized && (
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector pane"
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 8;
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              onResize(width + step);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              onResize(width - step);
            }
          }}
        />
      )}

      {/* Desktop open-definitions tab strip (VS Code style) */}
      {sessions.length > 1 && (
        <div className={styles.sessionBar} role="tablist" aria-label="Open definitions">
          {sessions.map((session, idx) => {
            const isActive = idx === activeSessionIndex;
            const cur = session.stack[session.stackIndex];
            return (
              <div
                key={session.id}
                className={`${styles.sessionTab} ${isActive ? styles.sessionTabActive : ''}`}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeSession(idx);
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={styles.sessionTabBtn}
                  onClick={() => switchSession(idx)}
                  title={cur ? `${cur.table}:${cur.hash}` : session.label}
                >
                  <span className={styles.sessionTabLabel}>{session.label}</span>
                </button>
                <button
                  type="button"
                  className={styles.sessionCloseBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(idx);
                  }}
                  aria-label={`Close ${session.label}`}
                  title="Close tab"
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Top navigation / breadcrumb stack bar */}
      <div className={styles.navBar}>
        <div className={styles.navButtons}>
          <button
            type="button"
            className={styles.mobileBackBtn}
            onClick={closeInspector}
            aria-label="Back to results"
            title="Back to results"
          >
            <ArrowLeftIcon size={15} />
            <span>Results</span>
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={navigateBack}
            disabled={stackIndex <= 0}
            aria-label="Previous definition"
            title="Back in stack (Alt+Left)"
          >
            <ArrowLeftIcon size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={navigateForward}
            disabled={stackIndex < 0 || stackIndex >= stack.length - 1}
            aria-label="Next definition"
            title="Forward in stack (Alt+Right)"
          >
            <ArrowRightIcon size={14} />
          </button>
        </div>

        <nav className={styles.breadcrumbs} aria-label="Inspection stack">
          {stack.slice(0, stackIndex + 1).map((entry, idx) => {
            const isLast = idx === stackIndex;
            return (
              <span key={`${entry.table}:${entry.hash}:${idx}`} className={styles.crumbItem}>
                {idx > 0 && <span className={styles.crumbSep}>/</span>}
                <button
                  type="button"
                  className={`${styles.crumbBtn} ${isLast ? styles.crumbCurrent : ''}`}
                  onClick={() => jumpToStackIndex(idx)}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {getShortTableName(entry.table)}:{entry.hash}
                </button>
              </span>
            );
          })}
        </nav>

        <button
          type="button"
          className={`${styles.iconBtn} ${styles.desktopCloseBtn}`}
          onClick={toggleInspectorMaximized}
          aria-label={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
          title={inspectorMaximized ? 'Restore split view' : 'Maximize inspector'}
        >
          {inspectorMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>

        <button
          type="button"
          className={`${styles.iconBtn} ${styles.desktopCloseBtn}`}
          onClick={() =>
            sessions.length > 1 ? closeSession(activeSessionIndex) : closeInspector()
          }
          aria-label={sessions.length > 1 ? 'Close tab' : 'Close inspector'}
          title={sessions.length > 1 ? 'Close tab (Alt+W)' : 'Close inspector (Esc)'}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Entity header */}
      <div className={styles.entityHeader}>
        <div className={styles.entityIdentity}>
          <BungieIcon
            icon={iconPath}
            watermark={watermarkPath}
            tierType={tierType}
            size={44}
          />
          <div className={styles.entityTitleGroup}>
            <div className={styles.entityNameRow}>
              <h2 className={styles.entityTitle}>{itemName}</h2>
              {detail?.isLite && (
                <span className={styles.liteTag}>
                  {loadingFull ? 'Loading full…' : 'Lite'}
                </span>
              )}
            </div>
            <div className={styles.entityMetaRow}>
              <span className={styles.tableLabel}>{currentRef.table}</span>
              {itemSubtitle && itemSubtitle !== getShortTableName(currentRef.table) && (
                <span className={styles.subLabel}>{itemSubtitle}</span>
              )}
            </div>
            <div className={styles.hashRow}>
              <button
                type="button"
                className={styles.hashBtn}
                onClick={() => copyText(String(unsignedHash), `Copied hash ${unsignedHash}`)}
                title="Copy unsigned 32-bit hash (c)"
              >
                <span className="mono">{unsignedHash}</span>
                <CopyIcon size={11} />
              </button>
              {signedHash !== unsignedHash && (
                <button
                  type="button"
                  className={styles.hashBtnMuted}
                  onClick={() => copyText(String(signedHash), `Copied signed hash ${signedHash}`)}
                  title="Copy signed int32 SQLite hash"
                >
                  <span className="mono">{signedHash}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${isCollected ? styles.actionActive : ''}`}
            onClick={() => {
              toggleCollectItem({
                table: currentRef.table,
                hash: unsignedHash,
                name: itemName,
                subtitle: itemSubtitle,
                icon: iconPath,
              });
              pushNotice({
                tone: 'info',
                message: isCollected ? 'Removed from collector' : 'Added to collector',
              });
            }}
            title={isCollected ? 'Remove from collector (a)' : 'Add to collector (a)'}
          >
            {isCollected ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
            <span>{isCollected ? 'Collected' : 'Collect'}</span>
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              pinForDiff(currentRef);
              pushNotice({ tone: 'info', message: `Pinned ${itemName} as diff baseline` });
            }}
            title="Pin as diff baseline"
          >
            <DiffIcon size={13} />
            <span>Diff</span>
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              if (detail) {
                copyText(JSON.stringify(detail.data, null, 2), 'Copied definition JSON');
              }
            }}
            disabled={!detail}
            title="Copy JSON (Shift+C)"
          >
            <CopyIcon size={13} />
            <span>JSON</span>
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => copyText(window.location.href, 'Copied direct link')}
            aria-label="Copy link"
            title="Copy shareable link"
          >
            <LinkIcon size={14} />
          </button>
        </div>

        {/* Same-hash cross-table switcher (like Deepsight's side rail) */}
        {detail && detail.coTables.length > 0 && (
          <div className={styles.coTableStrip} aria-label="Same hash in other tables">
            <span className={styles.coTableLabel}>Also in:</span>
            {detail.coTables.map((table) => (
              <button
                key={table}
                type="button"
                className={styles.coTableBtn}
                onClick={() => onNavigateRef({ table, hash: unsignedHash }, false)}
              >
                {getShortTableName(table)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Equal-width centered tabs on phones, compact left-aligned on desktop */}
      <div className={styles.tabBar} role="tablist" aria-label="Inspector views">
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          let countBadge = '';
          if (tab.id === 'variants' && variants.length > 1) {
            countBadge = ` (${variants.length})`;
          } else if (tab.id === 'references' && references) {
            countBadge = ` (${references.references.length})`;
          }
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`${styles.tabBtn} ${selected ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={styles.tabLabelFull}>
                {tab.label}
                {countBadge}
              </span>
              <span className={styles.tabLabelShort}>
                {tab.shortLabel}
                {countBadge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab panel */}
      <div className={styles.tabPanel} role="tabpanel">
        {loading && !detail ? (
          <div className={styles.loadingState}>
            <Skeleton height="1.25rem" width="55%" />
            <Skeleton height="1rem" width="80%" />
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="1rem" width="88%" />
            <Skeleton height="1rem" width="62%" />
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <p className={styles.errorMsg}>{error}</p>
            <button type="button" className={styles.actionBtn} onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : detail ? (
          <>
            {activeTab === 'pretty' && (
              <JsonTree
                data={detail.data}
                resolvedRefs={detail.resolvedRefs}
                onNavigateRef={(ref, inNewTab) => onNavigateRef(ref, true, inNewTab)}
                onCopy={copyText}
              />
            )}
            {activeTab === 'overview' && (
              <OverviewTab
                detail={detail}
                loadingFull={loadingFull}
                clarityEntry={clarityEntry}
                clarityLoading={clarityLoading}
                showClarity={showClarity}
                onNavigateRef={(ref) => onNavigateRef(ref, true)}
                onLoadFullItem={onLoadFullItem}
              />
            )}
            {activeTab === 'variants' && (
              <VariantsTab
                currentRef={currentRef}
                variants={variants}
                loading={variantsLoading}
                onNavigateRef={(ref) => onNavigateRef(ref, true)}
                onDiffVariant={(variantRef) => {
                  pinForDiff(currentRef);
                  onNavigateRef(variantRef, true);
                  setActiveTab('diff');
                }}
              />
            )}
            {activeTab === 'references' && (
              <ReferencesTab
                response={references}
                loading={referencesLoading}
                onNavigateRef={(ref) => onNavigateRef(ref, true)}
                onLoadPriorityTable={onLoadPriorityTable}
              />
            )}
            {activeTab === 'raw' && (
              <div className={styles.rawWrap}>
                <div className={styles.rawToolbar}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => copyText(rawJsonText, 'Copied raw JSON')}
                  >
                    <CopyIcon size={13} />
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleDownloadJson}
                  >
                    <DownloadIcon size={13} />
                    Download .json
                  </button>
                </div>
                <pre className={styles.rawPre}>{rawJsonText}</pre>
              </div>
            )}
            {activeTab === 'diff' && (
              <DiffTab
                current={detail}
                pinnedRef={pinnedDiffRef}
                pinnedDetail={pinnedDetail}
                pinnedLoading={pinnedLoading}
                onPinCurrent={() => pinForDiff(currentRef)}
                onClearPin={clearPinnedDiff}
                onNavigateRef={(ref) => onNavigateRef(ref, true)}
              />
            )}
          </>
        ) : (
          <div className={styles.errorState}>
            <p className={styles.errorMsg}>
              Definition {currentRef.hash} was not found in {currentRef.table}.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
