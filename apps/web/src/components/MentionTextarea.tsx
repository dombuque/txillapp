import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { api } from '../lib/api';
import { Avatar } from './ui';

// O @ a meio de uma palavra (e-mail) não conta; só um @ no início ou depois de espaço/pontuação.
const TOKEN = /(?<![\w.])([@#])([\p{L}\p{N}_.]{0,30})$/u;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  /** Uma linha (campo normal) em vez de caixa de texto. */
  single?: boolean;
  /** Abre a lista por cima (campos colados ao fundo do ecrã). */
  up?: boolean;
  /** Lista dentro do cartão (empurra o conteúdo) em vez de flutuar por cima. */
  inline?: boolean;
  wrapperClassName?: string;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
};

/** Caixa de texto com sugestões de @menções: quem sigo e contas públicas que aceitam menções. */
export default function MentionTextarea({ value, onChange, single, up, inline, wrapperClassName = '', inputRef, ...rest }: Props) {
  const ref = useRef<(HTMLTextAreaElement & HTMLInputElement) | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(true);
  const token = TOKEN.exec(value.slice(0, caret));
  const kind = token ? (token[1] as '@' | '#') : null;
  const term = token ? token[2] : null;

  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (term === null) return;
    const t = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(t);
  }, [term]);

  const found = useQuery({
    queryKey: ['mentionable', debounced],
    queryFn: () => api.mentionable(debounced),
    enabled: kind === '@' && open,
    staleTime: 60_000,
    retry: false,
  });
  const tagsFound = useQuery({
    queryKey: ['tag-complete', debounced],
    queryFn: () => api.searchTags(debounced),
    enabled: kind === '#' && open && debounced.length >= 1,
    staleTime: 60_000,
    retry: false,
  });
  const list = kind === '@' && open ? (found.data ?? []) : [];
  const tagList = kind === '#' && open ? (tagsFound.data?.tags ?? []) : [];

  function pick(name: string, mark: '@' | '#' = '@') {
    const start = caret - (token![0].length);
    const next = `${value.slice(0, start)}${mark}${name} ${value.slice(caret)}`;
    const pos = start + name.length + 2;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      {(() => {
        const common = {
          ...rest,
          value,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setOpen(true);
          },
          onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => setCaret(e.currentTarget.selectionStart ?? 0),
          onKeyDown: (e: React.KeyboardEvent) => e.key === 'Escape' && list.length > 0 && (e.stopPropagation(), setOpen(false)),
          ref: (el: (HTMLTextAreaElement & HTMLInputElement) | null) => {
            ref.current = el;
            if (inputRef) inputRef.current = el;
          },
        };
        return single ? <input {...(common as object)} type="text" autoComplete="off" /> : <textarea {...(common as object)} />;
      })()}
      {tagList.length > 0 && (
        <ul
          role="listbox"
          aria-label="Hashtags"
          className={`max-h-60 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            inline
              ? '-mx-5 mt-3 border-t border-zinc-100 px-2 pt-1.5'
              : `absolute inset-x-0 z-20 rounded-2xl bg-white p-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.22)] ring-1 ring-zinc-100 ${up ? 'bottom-full mb-2' : 'top-full mt-1'}`
          }`}
        >
          {tagList.map((t) => (
            <li key={t.tag} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t.tag, '#')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-zinc-100">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-lg font-bold text-brand" aria-hidden>#</span>
                <span className="min-w-0 flex-1 truncate font-semibold">#{t.tag}</span>
                <span className="text-sm text-zinc-500">{t.posts} {t.posts === 1 ? 'publicação' : 'publicações'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <ul
          role="listbox"
          aria-label="Pessoas para mencionar"
          className={`max-h-60 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            inline
              ? '-mx-5 mt-3 border-t border-zinc-100 px-2 pt-1.5'
              : `absolute inset-x-0 z-20 rounded-2xl bg-white p-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.22)] ring-1 ring-zinc-100 ${up ? 'bottom-full mb-2' : 'top-full mt-1'}`
          }`}
        >
          {list.map((p) => (
            <li key={p.username} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p.username)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-zinc-100">
                <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={36} ring={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{p.displayName}</span>
                  <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
