import { useState, useCallback } from 'react';
import OrdersPage from './pages/OrdersPage';
import PoolPage from './pages/PoolPage';
import MenuPage from './pages/MenuPage';
import ReportsPage from './pages/ReportsPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import { SessionProvider, useSession } from './context/SessionContext';
import ShiftGate from './components/ShiftGate';
import CloseShiftModal from './components/CloseShiftModal';
import { formatTime } from './utils/time';

type Page = 'orders' | 'pool' | 'menu' | 'history' | 'reports' | 'settings';

const NAV: { id: Page; label: string }[] = [
  { id: 'orders',   label: 'Orders'   },
  { id: 'pool',     label: 'Pool'     },
  { id: 'menu',     label: 'Menu'     },
  { id: 'history',  label: 'History'  },
  { id: 'reports',  label: 'Reports'  },
  { id: 'settings', label: 'Settings' },
];

function AppInner() {
  const [page, setPage]           = useState<Page>('orders');
  const [jumpTabId, setJumpTabId] = useState<number | null>(null);
  const [showClose, setShowClose] = useState(false);
  const { session } = useSession();

  const openTab = useCallback((tabId: number) => {
    setJumpTabId(tabId);
    setPage('orders');
  }, []);

  const consumeJump = useCallback(() => setJumpTabId(null), []);

  return (
    <div>
      <nav className="nav">
        <span className="nav__brand">Downtown</span>
        <div className="nav__links">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              className={`nav__link${page === id ? ' nav__link--active' : ''}`}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {session?.status === 'open' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              shift seit {formatTime(session.opened_at)}
            </span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowClose(true)}
            >
              Close Shift
            </button>
          </div>
        )}
      </nav>
      <main className="main">
        <div style={{ display: page === 'orders'   ? undefined : 'none' }}><OrdersPage jumpTabId={jumpTabId} onJumpConsumed={consumeJump} /></div>
        <div style={{ display: page === 'pool'     ? undefined : 'none' }}><PoolPage onOpenTab={openTab} /></div>
        <div style={{ display: page === 'menu'     ? undefined : 'none' }}><MenuPage /></div>
        <div style={{ display: page === 'history'  ? undefined : 'none' }}><HistoryPage /></div>
        <div style={{ display: page === 'reports'  ? undefined : 'none' }}><ReportsPage /></div>
        <div style={{ display: page === 'settings' ? undefined : 'none' }}><SettingsPage /></div>
      </main>
      {showClose && <CloseShiftModal onClose={() => setShowClose(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ShiftGate>
        <AppInner />
      </ShiftGate>
    </SessionProvider>
  );
}
