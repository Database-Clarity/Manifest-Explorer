import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CloseIcon } from './Icons';
import styles from './ClearSearchInput.module.scss';

export interface ClearSearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the clear button, e.g. "Clear filter" or "Clear search". */
  clearLabel: string;
  /** Extra class for the positioning wrapper (flex sizing, width limits, …). */
  wrapperClassName?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * `type="search"` field with a real clear button.
 *
 * Chromium's `::-webkit-search-cancel-button` cannot be given a pointer cursor,
 * hover highlight or focus ring, so it is disabled globally (styles/global.scss
 * and the `field` mixin). This component keeps the mobile keyboard and Escape
 * semantics of `type="search"` while rendering a theme-aware `<button>` — with
 * reserved inline-end padding so typed text never slides under the glyph.
 *
 * Clearing keeps a one-shot, keyboard-only undo snapshot: `Ctrl+Z` / `Cmd+Z`
 * in the empty field restores the cleared text. Typing anything new invalidates
 * the snapshot, and manually backspacing the field empty never creates one.
 */
export function ClearSearchInput({
  value,
  onValueChange,
  clearLabel,
  wrapperClassName,
  className,
  onKeyDown,
  ...inputProps
}: ClearSearchInputProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [undoValue, setUndoValue] = useState<string | null>(null);

  // Any non-empty value means the user typed (or a parent restored) new text,
  // so the previous clear snapshot is stale.
  useEffect(() => {
    if (value.length > 0 && undoValue !== null) {
      setUndoValue(null);
    }
  }, [value, undoValue]);

  function restoreUndo(restored: string): void {
    onValueChange(restored);
    setUndoValue(null);
    const input = inputRef.current;
    input?.focus();
    window.requestAnimationFrame(() => {
      input?.setSelectionRange(restored.length, restored.length);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'z' &&
      value.length === 0 &&
      undoValue !== null
    ) {
      event.preventDefault();
      restoreUndo(undoValue);
    }
  }

  return (
    <span className={cx(styles.wrap, wrapperClassName)}>
      <input
        {...inputProps}
        ref={inputRef}
        type="search"
        className={cx(styles.input, className)}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value.length > 0 ? (
        <button
          type="button"
          className={styles.clear}
          // Clear without stealing focus: a mouse click on a button would
          // otherwise blur the field mid-edit.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setUndoValue(value);
            onValueChange('');
            inputRef.current?.focus();
          }}
          aria-label={clearLabel}
          title={clearLabel}
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
    </span>
  );
}
