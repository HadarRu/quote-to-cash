import { z } from 'zod';

/** Email address, trimmed and lower-cased. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('email_invalid'));
