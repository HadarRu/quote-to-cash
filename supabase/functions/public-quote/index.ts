// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
// Public: customers open their link without signing in (verify_jwt = false in config.toml).
import { createClient } from '@supabase/supabase-js';
import { handlePublicQuote, type DbView } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false },
  },
);
const SIGNED_URL_SECONDS = 60 * 60;

Deno.serve((req) =>
  handlePublicQuote(req, {
    tokenPepper: Deno.env.get('TOKEN_PEPPER') ?? '',
    async hitRateLimit(bucket, limit, windowSeconds) {
      const { data, error } = await admin.rpc('hit_rate_limit', {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw error;
      return data === true;
    },
    async open(tokenHash, ip) {
      const { data, error } = await admin.rpc('public_quote_open', {
        p_token_hash: tokenHash,
        p_ip: ip,
      });
      return { data: data as DbView | null, error };
    },
    async respond(tokenHash, action, name, reason, ip) {
      const { data, error } = await admin.rpc('public_quote_respond', {
        p_token_hash: tokenHash,
        p_action: action,
        p_name: name,
        p_reason: reason,
        p_ip: ip,
      });
      return { data: data as DbView | null, error };
    },
    async comment(tokenHash, body, ip) {
      const { data, error } = await admin.rpc('public_quote_comment', {
        p_token_hash: tokenHash,
        p_body: body,
        p_ip: ip,
      });
      return { data: data as boolean | null, error };
    },
    async schedule(tokenHash, slotId, ip) {
      const { data, error } = await admin.rpc('public_quote_schedule', {
        p_token_hash: tokenHash,
        p_slot_id: slotId,
        p_ip: ip,
      });
      return { data: data as DbView | null, error };
    },
    async signUrls(logoPath, photoPaths) {
      const logo = logoPath
        ? await admin.storage.from('business-assets').createSignedUrl(logoPath, SIGNED_URL_SECONDS)
        : null;
      const photos = photoPaths.length
        ? await admin.storage.from('quote-photos').createSignedUrls(photoPaths, SIGNED_URL_SECONDS)
        : null;
      return {
        logoUrl: logo?.data?.signedUrl ?? null,
        photoUrls: (photos?.data ?? []).flatMap((p) => (p.signedUrl ? [p.signedUrl] : [])),
      };
    },
  }),
);
