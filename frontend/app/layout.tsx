import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { Settings, Video, Search, Layers, Megaphone } from 'lucide-react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'VoyageAI Video Demo',
  description: 'Multimodal video embeddings with voyage-multimodal-3.5 and MongoDB Atlas',
};

const navItems = [
  { href: '/search', label: 'Search', icon: Search },
  { href: '/videos', label: 'Videos', icon: Video },
  { href: '/ads', label: 'Ads', icon: Megaphone },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen bg-background">
          {/* Sidebar */}
          <aside className="w-56 border-r bg-card flex flex-col py-6 px-3 gap-2 shrink-0">
            <div className="px-3 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-5 w-5 text-primary" />
                <span className="font-semibold text-sm tracking-tight">VoyageAI Video</span>
              </div>
              <p className="text-xs text-muted-foreground">voyage-multimodal-3.5</p>
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
