import type { ReactNode } from 'react';

/** Telemóvel (app nativa): o Modal do React Native já começa uma lista nova; não há nada a fazer. Ver ListReset.web.tsx. */
export function ListReset({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
