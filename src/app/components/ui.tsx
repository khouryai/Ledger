import React, { useEffect, useRef, useState } from 'react';
import type { Tone } from '../../engine/decide';
import { Icon, type IconName } from './icons';

export function Badge({ tone, children, title }: { tone: Tone | 'purple'; children: React.ReactNode; title?: string }) {
  const cls = tone === 'bad' ? 'badge-bad' : tone === 'warn' ? 'badge-warn' : tone === 'good' ? 'badge-good' : tone === 'info' ? 'badge-info' : tone === 'purple' ? 'badge-purple' : 'badge-muted';
  return (
    <span className={`badge ${cls}`} title={title}>
      {children}
    </span>
  );
}

export function Hero({ eyebrow, title, sub, actions, stats }: { eyebrow: string; title: string; sub?: React.ReactNode; actions?: React.ReactNode; stats?: React.ReactNode }) {
  return (
    <div className="page-hero">
      <div className="min-w-0">
        <div className="ph-eyebrow">{eyebrow}</div>
        <h1 className="ph-title">{title}</h1>
        {sub && <div className="ph-sub">{sub}</div>}
        {stats && <div className="mt-3 flex flex-wrap gap-2">{stats}</div>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'red' | 'amber' | 'blue' | 'good' | 'muted' }) {
  return (
    <span className={`ph-stat${tone ? ` tone-${tone}` : ''}`}>
      <span className="ph-stat-lbl">{label}</span>
      <span className="ph-stat-val">{value}</span>
    </span>
  );
}

export function IconButton({ icon, label, onClick, disabled, testid }: { icon: IconName; label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      className="ico-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide, labelledBy = 'modal-title' }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], textarea, input, select, button.btn-primary');
    first?.focus();
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(860px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-h flex items-start justify-between gap-3">
          <h2 id={labelledBy} className="card-title" style={{ fontSize: 16 }}>
            {title}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-t">{title}</div>
      {children}
    </div>
  );
}

export function Section({ title, count, children, aside }: { title: string; count?: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section>
      <div className="section-h">
        <div className="flex items-baseline gap-3">
          <h2 className="section-t">{title}</h2>
          {count !== undefined && <span className="section-n">{count}</span>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A small menu that opens under a button and closes on any outside click. */
export function MenuButton({ label, icon, items, className = 'ico-btn', testid }: { label: string; icon?: IconName; items: { label: string; onClick: () => void }[]; className?: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="relative inline-block" ref={ref}>
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        data-testid={testid}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {icon ? <Icon name={icon} size={15} /> : label}
      </button>
      {open && (
        <span className="menu" style={{ right: 0, top: '100%' }} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Copy text (and, where the browser allows, HTML) to the clipboard. */
export async function copyRich(text: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Hand the browser a file to save. */
export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
