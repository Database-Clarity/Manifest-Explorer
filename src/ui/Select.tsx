import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { applyPlacement, followPlacement, placeAnchored, visibleArea } from './anchorPlacement';
import { ClearSearchInput } from './ClearSearchInput';
import styles from './Select.module.scss';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional secondary text or search keywords (for example, a version id). */
  keywords?: string;
  disabled?: boolean;
  /** Custom popup content; the closed trigger continues to use `label`. */
  renderOption?: (
    option: SelectOption<T>,
    state: { active: boolean; current: boolean },
  ) => ReactNode;
}

export interface SelectGroup<T extends string = string> {
  label: string;
  options: readonly SelectOption<T>[];
}

export type SelectSection<T extends string = string> =
  | SelectGroup<T>
  | { label?: never; options: readonly SelectOption<T>[] };

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options?: readonly SelectOption<T>[];
  groups?: readonly SelectGroup<T>[];
  /** Ordered flat or grouped sections; when provided, takes precedence over options/groups. */
  sections?: readonly SelectSection<T>[];
  id?: string;
  className?: string;
  popupClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  title?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
  /** Minimum popup width in CSS pixels or a CSS length such as `15rem`. */
  minPopupWidth?: number | string;
  /** Maximum popup width in CSS pixels. */
  maxPopupWidth?: number;
  /** Defaults to enabled for lists with 321 or more options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptySearchText?: string;
  /** Closed-trigger text override; the selected option still supplies its title. */
  displayLabel?: string;
  onTriggerKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onOpenChange?: (open: boolean) => void;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function minimumWidthInPixels(value: number | string | undefined): number {
  if (typeof value === 'number') return Math.max(0, value);
  if (!value) return 0;

  const match = value.trim().match(/^([\d.]+)\s*(px|rem|em|vw|vh)?$/i);
  if (!match?.[1]) return 0;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'px';
  if (unit === 'rem') {
    return amount * Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
  }
  if (unit === 'em') return amount * 16;
  if (unit === 'vw') return (amount / 100) * window.innerWidth;
  if (unit === 'vh') return (amount / 100) * window.innerHeight;
  return amount;
}

function firstEnabledIndex<T extends string>(
  options: readonly SelectOption<T>[],
  start = 0,
): number {
  for (let index = Math.max(0, start); index < options.length; index += 1) {
    if (!options[index]?.disabled) return index;
  }
  for (let index = Math.min(start - 1, options.length - 1); index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function lastEnabledIndex<T extends string>(options: readonly SelectOption<T>[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

/**
 * A select-only combobox with a portalled listbox. Focus stays on the trigger
 * unless searchable mode is active, when it moves to the popup search field.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  groups,
  sections: providedSections,
  id,
  className,
  popupClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  title,
  disabled = false,
  align = 'start',
  minPopupWidth,
  maxPopupWidth,
  searchable,
  searchPlaceholder = 'Search options',
  emptySearchText = 'No matching options',
  displayLabel,
  onTriggerKeyDown,
  onOpenChange,
}: SelectProps<T>): ReactNode {
  const generatedId = useId();
  const baseId = id ?? `select-${generatedId.replaceAll(':', '')}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const wasOpen = useRef(false);

  const normalizedSections = useMemo<readonly SelectSection<T>[]>(() => {
    if (providedSections) return providedSections;
    const result: SelectSection<T>[] = [];
    if (options?.length) result.push({ options });
    if (groups?.length) result.push(...groups);
    return result;
  }, [groups, options, providedSections]);

  const allOptions = useMemo(
    () => normalizedSections.flatMap((section) => section.options),
    [normalizedSections],
  );
  const isSearchable = searchable ?? allOptions.length >= 321;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState({ index: -1, scroll: true });

  const visibleSections = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return normalizedSections
      .map((section) => ({
        ...section,
        options: section.options.filter((option) => {
          if (!needle) return true;
          return `${option.label} ${option.keywords ?? ''}`.toLocaleLowerCase().includes(needle);
        }),
      }))
      .filter((section) => section.options.length > 0);
  }, [normalizedSections, search]);
  const visibleOptions = useMemo(
    () => visibleSections.flatMap((section) => section.options),
    [visibleSections],
  );
  const selected = allOptions.find((option) => option.value === value);
  const selectedIndex = visibleOptions.findIndex((option) => option.value === value);
  const activeOption = visibleOptions[highlight.index];
  const listId = `${baseId}-listbox`;

  const notifyOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  useEffect(() => {
    if (wasOpen.current !== open) {
      wasOpen.current = open;
      onOpenChange?.(open);
    }
  }, [open, onOpenChange]);

  const show = useCallback(
    (index = selectedIndex) => {
      if (disabled || allOptions.length === 0) return;
      setSearch('');
      const initial = firstEnabledIndex(allOptions, index >= 0 ? index : 0);
      setHighlight({ index: initial, scroll: true });
      notifyOpen(true);
    },
    [allOptions, disabled, notifyOpen, selectedIndex],
  );

  const close = useCallback(
    (returnFocus = false) => {
      notifyOpen(false);
      setSearch('');
      if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [notifyOpen],
  );

  const choose = useCallback(
    (index: number) => {
      const option = visibleOptions[index];
      if (!option || option.disabled) return;
      close(true);
      if (option.value !== value) onChange(option.value);
    },
    [close, onChange, value, visibleOptions],
  );

  const place = useCallback(() => {
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const area = visibleArea(window);
    const requestedWidth = minimumWidthInPixels(minPopupWidth);
    const naturalWidth = Math.min(
      Math.max(triggerRect.width, requestedWidth),
      maxPopupWidth === undefined ? Number.POSITIVE_INFINITY : Math.max(0, maxPopupWidth),
    );
    const searchHeight =
      popup.querySelector<HTMLElement>('[data-select-search-wrap]')?.offsetHeight ?? 0;
    const listHeight = listRef.current?.scrollHeight ?? 0;
    const naturalHeight = searchHeight + listHeight + 2;
    const placement = placeAnchored({
      trigger: triggerRect,
      area,
      width: naturalWidth,
      height: naturalHeight,
      gap: 2,
      align,
    });
    applyPlacement(popup, placement);
    popup.style.visibility = 'visible';
  }, [align, maxPopupWidth, minPopupWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    return followPlacement(() => popupRef.current, place);
  }, [open, place, visibleOptions.length]);

  useLayoutEffect(() => {
    if (!open) return;
    if (isSearchable) {
      popupRef.current?.querySelector<HTMLInputElement>('[data-select-search]')?.focus();
    }
  }, [isSearchable, open]);

  useLayoutEffect(() => {
    if (!open || !highlight.scroll || highlight.index < 0) return;
    const list = listRef.current;
    const row = document.getElementById(`${baseId}-option-${highlight.index}`);
    if (!list || !row || !list.contains(row)) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = rowRect.top - listRect.top + list.scrollTop;
    const bottom = rowRect.bottom - listRect.top + list.scrollTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [baseId, highlight, open, visibleOptions.length]);

  useEffect(() => {
    if (!open) {
      typed.current = { text: '', at: 0 };
      return;
    }
    if (highlight.index >= visibleOptions.length || visibleOptions[highlight.index]?.disabled) {
      setHighlight({
        index: firstEnabledIndex(visibleOptions),
        scroll: true,
      });
    }
  }, [highlight.index, open, visibleOptions]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('mousedown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('mousedown', outside, true);
    };
  }, [close, open]);

  const move = useCallback(
    (from: number, delta: number, page = false) => {
      if (visibleOptions.length === 0) return -1;
      const step = page ? 10 : 1;
      let next = Math.max(0, Math.min(visibleOptions.length - 1, from + delta * step));
      const direction = delta < 0 ? -1 : 1;
      while (visibleOptions[next]?.disabled && next >= 0 && next < visibleOptions.length) {
        const candidate = next + direction;
        if (candidate < 0 || candidate >= visibleOptions.length) break;
        next = candidate;
      }
      if (visibleOptions[next]?.disabled) return firstEnabledIndex(visibleOptions);
      return next;
    },
    [visibleOptions],
  );

  const typeAhead = useCallback(
    (key: string, at: number, from: number): number => {
      const state = typed.current;
      state.text = at - state.at > 700 ? key : state.text + key;
      state.at = at;
      const text = state.text.toLocaleLowerCase();
      const repeated = [...text].every((letter) => letter === text[0]);
      const start = repeated ? 1 : 0;
      const needle = (repeated ? text[0] : text) ?? '';
      for (let offset = 0; offset < visibleOptions.length; offset += 1) {
        const index = (Math.max(0, from) + start + offset) % visibleOptions.length;
        const option = visibleOptions[index];
        if (
          option &&
          !option.disabled &&
          option.label.toLocaleLowerCase().startsWith(needle)
        ) {
          return index;
        }
      }
      return -1;
    },
    [visibleOptions],
  );

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    source: 'trigger' | 'popup',
  ): void => {
    if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const { key } = event;
    const stop = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (!open) {
      if (source !== 'trigger') return;
      if (event.altKey) {
        if (key === 'ArrowDown') {
          stop();
          show();
        }
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        stop();
        show();
      } else if (key === 'Home' || key === 'End') {
        stop();
        show(key === 'Home' ? 0 : lastEnabledIndex(allOptions));
      } else if (key.length === 1 && !event.altKey) {
        const index = typeAhead(key, event.timeStamp, selectedIndex);
        if (index >= 0) {
          stop();
          setHighlight({ index, scroll: true });
          show(index);
        }
      }
      return;
    }

    if (key === 'Escape') {
      stop();
      close(true);
      return;
    }
    if (key === 'Tab') {
      close();
      return;
    }
    if (event.altKey) {
      if (key === 'ArrowUp') {
        stop();
        choose(highlight.index);
      }
      return;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      stop();
      setHighlight({
        index: move(highlight.index, key === 'ArrowDown' ? 1 : -1),
        scroll: true,
      });
    } else if (key === 'PageDown' || key === 'PageUp') {
      stop();
      setHighlight({
        index: move(highlight.index, key === 'PageDown' ? 1 : -1, true),
        scroll: true,
      });
    } else if (key === 'Home' || key === 'End') {
      stop();
      setHighlight({
        index: key === 'Home' ? firstEnabledIndex(visibleOptions) : lastEnabledIndex(visibleOptions),
        scroll: true,
      });
    } else if (key === 'Enter' || (source === 'trigger' && key === ' ')) {
      stop();
      choose(highlight.index);
    } else if (source === 'trigger' && key.length === 1) {
      const currentTyped = performance.now() - typed.current.at <= 700 ? typed.current.text : '';
      if (key === ' ' && !currentTyped) {
        stop();
        choose(highlight.index);
      } else {
        const index = typeAhead(key, event.timeStamp, highlight.index);
        stop();
        if (index >= 0) setHighlight({ index, scroll: true });
      }
    }
  };

  const onSearchChange = (nextSearch: string): void => {
    setSearch(nextSearch);
    setHighlight({ index: 0, scroll: true });
  };

  const onPopupBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      (popupRef.current?.contains(nextTarget) || triggerRef.current?.contains(nextTarget))
    ) {
      return;
    }
    close();
  };

  let rowIndex = 0;
  const renderOption = (option: SelectOption<T>): ReactNode => {
    const index = rowIndex;
    rowIndex += 1;
    const current = option.value === value;
    const active = index === highlight.index;
    return (
      <li
        key={option.value}
        id={`${baseId}-option-${index}`}
        role="option"
        aria-selected={current}
        aria-disabled={option.disabled || undefined}
        data-value={option.value}
        data-active={active || undefined}
        data-current={current || undefined}
        data-custom-option={option.renderOption ? '' : undefined}
        className={option.renderOption ? `${styles.option} ${styles.customOption}` : styles.option}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (!option.disabled && index !== highlight.index) {
            setHighlight({ index, scroll: false });
          }
        }}
        onClick={() => choose(index)}
      >
        {option.renderOption ? (
          <span className={styles.customContent}>
            {option.renderOption(option, { active, current })}
          </span>
        ) : (
          <span className={styles.label}>{option.label}</span>
        )}
      </li>
    );
  };

  const listContent = visibleSections.map((section, sectionIndex) => {
    if (section.label) {
      const headingId = `${baseId}-group-${sectionIndex}`;
      return (
        <li
          key={`group-${sectionIndex}`}
          role="group"
          aria-labelledby={headingId}
          className={styles.section}
        >
          <div id={headingId} role="presentation" className={styles.heading}>
            {section.label}
          </div>
          <ul role="presentation">{section.options.map(renderOption)}</ul>
        </li>
      );
    }
    return section.options.map(renderOption);
  });

  const selectedLabel = selected?.label ?? '';

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && !isSearchable && activeOption
            ? `${baseId}-option-${highlight.index}`
            : undefined
        }
        data-select-trigger=""
        data-value={value}
        title={title ?? selectedLabel}
        disabled={disabled || allOptions.length === 0}
        className={cx(styles.trigger, className)}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          onTriggerKeyDown?.(event);
          if (!event.defaultPrevented) handleKeyDown(event, 'trigger');
        }}
        onBlur={() => {
          if (!isSearchable) close();
        }}
      >
        <span className={styles.value}>{displayLabel ?? selectedLabel}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className={cx(styles.popup, popupClassName)}
            data-select-popup=""
            data-select-open=""
            style={{ visibility: 'hidden' }}
            onKeyDown={(event) => handleKeyDown(event, 'popup')}
            onBlur={onPopupBlur}
            onMouseDown={(event) => event.preventDefault()}
          >
            {isSearchable ? (
              <div className={styles.searchBar} data-select-search-wrap="">
                <ClearSearchInput
                  value={search}
                  onValueChange={onSearchChange}
                  clearLabel="Clear search"
                  placeholder={searchPlaceholder}
                  aria-label={ariaLabel ? `${ariaLabel} search` : searchPlaceholder}
                  aria-controls={open ? listId : undefined}
                  aria-activedescendant={
                    activeOption ? `${baseId}-option-${highlight.index}` : undefined
                  }
                  aria-haspopup="listbox"
                  data-select-search=""
                  className={styles.searchInput}
                  wrapperClassName={styles.searchWrap}
                />
              </div>
            ) : null}
            {visibleOptions.length > 0 ? (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledby}
                tabIndex={-1}
                className={styles.listbox}
              >
                {listContent}
              </ul>
            ) : (
              <div className={styles.empty} role="status">
                {emptySearchText}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
