import { useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { LOGO_BUCKET } from './setup';

/** The business logo through a short-lived signed URL (the bucket is private). */
export function useLogoUrl(logoPath: string | null): string | null {
  const [logo, setLogo] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!logoPath) return;
    let cancelled = false;
    getSupabase()
      .storage.from(LOGO_BUCKET)
      .createSignedUrl(logoPath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setLogo({ path: logoPath, url: data?.signedUrl ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [logoPath]);

  return logo && logo.path === logoPath ? logo.url : null;
}
