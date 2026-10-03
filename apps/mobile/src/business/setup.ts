import { BusinessLogoSchema, BusinessSetupSchema, type BusinessSetup } from '@q2c/types';
import type { ErrorKey } from '@q2c/ui';
import type { AppSupabaseClient } from '../lib/supabase';

export const LOGO_BUCKET = 'business-assets';

export interface PickedLogo {
  uri: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SetupFormValues {
  businessId: string;
  name: string;
  trade: string | null;
  taxStatus: string | null;
}

export type FieldErrors = Partial<Record<'name' | 'trade' | 'taxStatus' | 'logo', ErrorKey>>;

/** Client-side validation with the same schemas the Edge Function and Storage enforce. */
export function validateSetup(
  values: SetupFormValues,
  logo: PickedLogo | null,
): { ok: true; data: BusinessSetup } | { ok: false; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  const parsed = BusinessSetupSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'trade') fieldErrors.trade ??= 'trade_required';
      else if (field === 'taxStatus') fieldErrors.taxStatus ??= 'tax_status_required';
      else if (field === 'name') fieldErrors.name ??= issue.message as ErrorKey;
    }
  }
  if (logo) {
    const logoResult = BusinessLogoSchema.safeParse({
      mimeType: logo.mimeType,
      sizeBytes: logo.sizeBytes,
    });
    if (!logoResult.success) fieldErrors.logo = logoResult.error.issues[0]?.message as ErrorKey;
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: parsed.data };
}

export function logoPath(businessId: string, mimeType: string): string {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType] ?? 'img';
  return `${businessId}/logo.${ext}`;
}

/** The parts of the Supabase client this service uses (narrowed for testing). */
export interface SetupClient {
  functions: {
    invoke(
      name: 'business-setup',
      options: { body: BusinessSetup },
    ): Promise<{
      data: { businessId?: string } | null;
      error: { name?: string; context?: unknown } | null;
    }>;
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: ArrayBuffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: unknown }>;
    };
  };
  from(table: 'business'): {
    update(values: { logo_path: string }): {
      eq(column: 'id', value: string): PromiseLike<{ error: unknown }>;
    };
  };
}

/** Adapts the app's Supabase client to the narrow interface above. */
export function setupClient(supabase: AppSupabaseClient): SetupClient {
  return {
    functions: {
      invoke: (name, options) => supabase.functions.invoke<{ businessId?: string }>(name, options),
    },
    storage: {
      from: (bucket) => ({
        upload: (path, body, options) => supabase.storage.from(bucket).upload(path, body, options),
      }),
    },
    from: (table) => ({
      update: (values) => ({
        eq: (column, value) => supabase.from(table).update(values).eq(column, value),
      }),
    }),
  };
}

export type SetupResult = { ok: true; businessId: string } | { ok: false; error: ErrorKey };

function mapFunctionError(error: { name?: string; context?: unknown }): ErrorKey {
  if (error.name === 'FunctionsFetchError') return 'network';
  const status = (error.context as { status?: number } | undefined)?.status;
  if (status === 401) return 'not_authenticated';
  if (status === 403) return 'forbidden';
  return 'generic';
}

/**
 * Creates the business through the business-setup Edge Function, then uploads
 * the logo. Every step is idempotent (client-generated id, upsert to a fixed
 * path), so after a failure the whole submit can simply run again.
 */
export async function submitBusinessSetup(
  client: SetupClient,
  input: BusinessSetup,
  logo: PickedLogo | null,
  readFile: (uri: string) => Promise<ArrayBuffer> = (uri) =>
    fetch(uri).then((r) => r.arrayBuffer()),
): Promise<SetupResult> {
  let invoked;
  try {
    invoked = await client.functions.invoke('business-setup', { body: input });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (invoked.error) return { ok: false, error: mapFunctionError(invoked.error) };
  const businessId = invoked.data?.businessId ?? input.businessId;

  if (logo) {
    try {
      const path = logoPath(businessId, logo.mimeType);
      const bytes = await readFile(logo.uri);
      const uploaded = await client.storage
        .from(LOGO_BUCKET)
        .upload(path, bytes, { contentType: logo.mimeType, upsert: true });
      if (uploaded.error) return { ok: false, error: 'logo_upload_failed' };
      const updated = await client
        .from('business')
        .update({ logo_path: path })
        .eq('id', businessId);
      if (updated.error) return { ok: false, error: 'logo_upload_failed' };
    } catch {
      return { ok: false, error: 'logo_upload_failed' };
    }
  }
  return { ok: true, businessId };
}
