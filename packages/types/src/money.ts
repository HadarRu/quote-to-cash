import { z } from 'zod';

/** Money amount in agorot (1 ILS = 100 agorot). Always an integer; stored in `*_minor` columns. */
export const moneyMinorSchema = z.number().int().safe();
export type MoneyMinor = z.infer<typeof moneyMinorSchema>;
