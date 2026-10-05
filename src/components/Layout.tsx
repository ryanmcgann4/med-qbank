import { BarChart3, BookOpenCheck, Database, Home, Library, Monitor, Moon, PlusCircle, Sun } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTheme, type Theme } from '../hooks/useTheme';
import { BackupBanner } from './BackupBanner';
import { UpdateToast } from './UpdateToast';
import { cn } from './ui';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/quiz/new', label: 'Quiz', icon: BookOpenCheck, end: false },
  { to: '/add', label: 'Add', icon: PlusCircle, end: false },
  { to: '/library', label: 'Library', icon: Library, end: false },
  { to: '/stats', label: 'Stats', icon: BarChart3, end: false },
];

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

export function Layout() {
  const [theme, setTheme] = useTheme();
  const { pathname } = useLocation();
  // The quiz runner is full-focus: no bottom nav eating screen space on phones.
  const inQuiz = /^\/quiz\/(?!new)[^/]+$/.test(pathname);
  const ThemeIcon = THEME_ICON[theme];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="./favicon.svg" alt="" className="h-7 w-7" />
            <span>Q-Bank</span>
          </NavLink>
          <nav className="ml-4 hidden gap-1 sm:flex">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium',
                    isActive
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/data"
            title="Backup, restore & export"
            className={({ isActive }) =>
              cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
                isActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              )
            }
          >
            <Database className="h-4 w-4" />
            <span className="hidden sm:inline">Data</span>
          </NavLink>
          <button
            type="button"
            onClick={() => setTheme(THEME_NEXT[theme])}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title={`Theme: ${theme} (click to change)`}
          >
            <ThemeIcon className="h-4 w-4" />
            <span className="hidden capitalize sm:inline">{theme}</span>
          </button>
        </div>
      </header>
      {!inQuiz && <BackupBanner />}

      <main className={cn('mx-auto max-w-5xl px-4 py-6', !inQuiz && 'pb-24 sm:pb-10')}>
        <Outlet />
      </main>

      {!inQuiz && <UpdateToast />}

      {!inQuiz && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/95">
          <div className="grid grid-cols-5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 py-2 text-xs font-medium',
                    isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400',
                  )
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
