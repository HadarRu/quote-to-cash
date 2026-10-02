import '@fontsource-variable/heebo';
import './globals.css';
import { strings, themeCss } from '@q2c/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: strings.app.name,
  description: strings.app.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <style>{themeCss()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
