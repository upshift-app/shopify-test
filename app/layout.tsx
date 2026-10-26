import './globals.css';

export const metadata = { title: 'Intere', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lt">
      <body>{children}</body>
    </html>
  );
}
