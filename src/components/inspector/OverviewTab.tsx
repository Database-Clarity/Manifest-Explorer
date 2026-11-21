import type { ReactNode } from 'react';
import type {
  ClarityDescriptionEntry,
  DefinitionDetailPayload,
  DefinitionRef,
} from '../../types/manifest';
import { bungieAssetUrl } from '../../manifest/hash';
import { getShortTableName } from '../../manifest/tables';
import { BungieIcon } from '../BungieIcon';
import { Skeleton } from '../../ui/Skeleton';
import styles from './InspectorTabs.module.scss';

export interface OverviewTabProps {
  detail: DefinitionDetailPayload;
  loadingFull: boolean;
  clarityEntry: ClarityDescriptionEntry | null;
  clarityLoading: boolean;
  showClarity: boolean;
  onNavigateRef: (ref: DefinitionRef) => void;
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
                <dd>{overview.tierName}</dd>
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
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={() =>
                      onNavigateRef({
                        table: 'DestinyDamageTypeDefinition',
                        hash: overview.damageType!.hash,
                      })
                    }
                  >
                    {overview.damageType.name}
                  </button>
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
                    <button
                      key={cat.hash}
                      type="button"
                      className={styles.inlineLink}
                      onClick={() =>
                        onNavigateRef({
                          table: 'DestinyItemCategoryDefinition',
                          hash: cat.hash,
                        })
                      }
                    >
                      {cat.name}
                    </button>
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
                  <button
                    type="button"
                    className={styles.statName}
                    onClick={() =>
                      onNavigateRef({
                        table: 'DestinyStatDefinition',
                        hash: stat.statHash,
                      })
                    }
                    title={stat.description}
                  >
                    {stat.name}
                  </button>
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
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Sockets</h3>
          {overview.socketCategories.map((cat) => (
            <div key={cat.categoryHash} className={styles.socketCategory}>
              <div className={styles.socketCatHeader}>
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() =>
                    onNavigateRef({
                      table: 'DestinySocketCategoryDefinition',
                      hash: cat.categoryHash,
                    })
                  }
                >
                  {cat.name}
                </button>
                <span className={styles.socketCatCount}>
                  {cat.sockets.length} {cat.sockets.length === 1 ? 'socket' : 'sockets'}
                </span>
              </div>
              <div className={styles.socketList}>
                {cat.sockets.map((socket) => (
                  <div key={socket.socketIndex} className={styles.socketGroup}>
                    <div className={styles.socketMeta}>
                      <span className={styles.socketIdx}>#{socket.socketIndex}</span>
                      <span>{socket.socketTypeName}</span>
                      {socket.plugSetHash && (
                        <button
                          type="button"
                          className={styles.inlineLink}
                          onClick={() =>
                            onNavigateRef({
                              table: 'DestinyPlugSetDefinition',
                              hash: socket.plugSetHash!,
                            })
                          }
                        >
                          PlugSet {socket.plugSetHash}
                        </button>
                      )}
                    </div>
                    <div className={styles.plugList}>
                      {socket.plugs.map((plug) => (
                        <button
                          key={`${socket.socketIndex}-${plug.hash}`}
                          type="button"
                          className={styles.entityRow}
                          onClick={() =>
                            onNavigateRef({
                              table: 'DestinyInventoryItemDefinition',
                              hash: plug.hash,
                            })
                          }
                          title={plug.description || plug.name}
                        >
                          <BungieIcon
                            icon={plug.icon}
                            tierType={plug.tierType}
                            size={28}
                          />
                          <span className={styles.entityText}>
                            <span className={styles.entityName}>
                              {plug.name || `Item ${plug.hash}`}
                              {plug.isDefault && (
                                <span className={styles.tagMuted}> (default)</span>
                              )}
                              {plug.currentlyCanRoll === false && (
                                <span className={styles.tagMuted}> (retired)</span>
                              )}
                            </span>
                            {plug.itemTypeDisplayName && (
                              <span className={styles.entitySub}>
                                {plug.itemTypeDisplayName}
                              </span>
                            )}
                          </span>
                          <span className={styles.entityHash}>{plug.hash}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {overview?.perks && overview.perks.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Sandbox perks</h3>
          <div className={styles.entityList}>
            {overview.perks.map((perk) => (
              <button
                key={perk.perkHash}
                type="button"
                className={styles.entityRow}
                onClick={() =>
                  onNavigateRef({
                    table: 'DestinySandboxPerkDefinition',
                    hash: perk.perkHash,
                  })
                }
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
              </button>
            ))}
          </div>
        </section>
      )}

      {overview?.collectible && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Collectible</h3>
          <button
            type="button"
            className={styles.entityRow}
            onClick={() =>
              onNavigateRef({
                table: 'DestinyCollectibleDefinition',
                hash: overview.collectible!.hash,
              })
            }
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
          </button>
        </section>
      )}

      {overview?.lore && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Lore —{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() =>
                onNavigateRef({
                  table: 'DestinyLoreDefinition',
                  hash: overview.lore!.loreHash,
                })
              }
            >
              {overview.lore.name || `Lore ${overview.lore.loreHash}`}
            </button>
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
              <button
                key={`${ent.table}-${ent.hash}-${idx}`}
                type="button"
                className={styles.entityRow}
                onClick={() => onNavigateRef({ table: ent.table, hash: ent.hash })}
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
              </button>
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
