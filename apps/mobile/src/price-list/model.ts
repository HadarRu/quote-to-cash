import type { ServiceUnit } from '@q2c/types';
import { textMatches } from '@q2c/utils';

export interface PriceListCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PriceListService {
  id: string;
  name: string;
  /** null when the service has no category or its category was deleted. */
  categoryId: string | null;
  categoryName: string | null;
  unit: ServiceUnit;
  priceMinor: number;
  vatIncluded: boolean;
  isFavorite: boolean;
  lastUsedAt: string | null;
}

export interface PriceList {
  categories: PriceListCategory[];
  services: PriceListService[];
}

const collator = new Intl.Collator('he');

/** Favorites first, then the most recently used, then by name (Hebrew order). */
export function sortServices(services: readonly PriceListService[]): PriceListService[] {
  return [...services].sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
      collator.compare(a.name, b.name),
  );
}

export type CategoryFilter =
  { kind: 'all' } | { kind: 'favorites' } | { kind: 'category'; id: string | null };

/** Search (Hebrew-aware, name or category) within the chosen filter, keeping the sort order. */
export function filterServices(
  services: readonly PriceListService[],
  query: string,
  filter: CategoryFilter = { kind: 'all' },
): PriceListService[] {
  return sortServices(services).filter((s) => {
    if (filter.kind === 'favorites' && !s.isFavorite) return false;
    if (filter.kind === 'category' && s.categoryId !== filter.id) return false;
    return textMatches(`${s.name} ${s.categoryName ?? ''}`, query);
  });
}

/** Shekels text for the price editor: 25050 -> "250.5", 25000 -> "250". */
export function priceInputValue(priceMinor: number): string {
  return String(priceMinor / 100);
}
