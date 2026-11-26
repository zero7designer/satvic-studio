'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight, AudioLines, Bell, Calculator, Check, CheckCheck, ChevronDown,
  LogOut, Menu, Moon, Palette, PanelLeftClose,
  PanelLeftOpen, Plus, Sun, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { signOut } from '@/features/auth/server/actions';
import { getProduct, products, type ProductFeature, type ProductId } from '@/features/products/registry';
import { getProfileAvatarSrc } from '@/features/auth/profile-avatar';
import PendingSubmitButton from '@/features/auth/components/PendingSubmitButton';
import { startNavigationLoading } from '@/features/navigation/NavigationLoading';

const featureIcons: Record<ProductFeature['icon'], LucideIcon> = {
  plus: Plus,
  workflow: CheckCheck,
  calculator: Calculator,
};

type ProductDashboardShellProps = {
  productId: ProductId;
  accountEmail: string;
  accountAvatar?: string;
  onFeatureSelect?: (featureId: string) => void;
  initialFeatureId?: string;
  hideFeatureNavigation?: boolean;
  children: ReactNode;
};

type DashboardNotification = { id: string; title: string; description: string; kind: string; createdAt: string; href: string };
type DashboardTheme = 'sage' | 'lavender' | 'ocean' | 'terracotta';
const dashboardThemes: { id: DashboardTheme; label: string }[] = [
  { id: 'sage', label: 'Sage' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'terracotta', label: 'Terracotta' },
];

export default function ProductDashboardShell({
  productId,
  accountEmail,
  accountAvatar = 'sage',
  onFeatureSelect,
  initialFeatureId,
  hideFeatureNavigation = false,
  children,
}: ProductDashboardShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const product = getProduct(productId)!;
  const [navOpen, setNavOpen] = useState(false);
  const [productRailCollapsed, setProductRailCollapsed] = useState(false);
  const [featureRailCollapsed, setFeatureRailCollapsed] = useState(false);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [appThemeOpen, setAppThemeOpen] = useState(false);
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>('sage');
  const [dashboardMode, setDashboardMode] = useState<'light' | 'dark'>('light');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [followingNotificationId, setFollowingNotificationId] = useState<string | null>(null);
  const [activeFeatureId, setActiveFeatureId] = useState(initialFeatureId ?? product.groups[0].features[1]?.id ?? product.groups[0].features[0].id);

  useEffect(() => {
    const savedTheme = dashboardThemes.find(option => option.id === window.localStorage.getItem('satvic-studio-dashboard-theme'));
    const savedMode = window.localStorage.getItem('satvic-studio-dashboard-mode');
    if (savedTheme) setDashboardTheme(savedTheme.id);
    if (savedMode === 'dark' || savedMode === 'light') setDashboardMode(savedMode);
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem('satvic-studio-dashboard-theme', dashboardTheme);
    window.localStorage.setItem('satvic-studio-dashboard-mode', dashboardMode);
  }, [dashboardMode, dashboardTheme, preferencesLoaded]);

  useEffect(() => {
    const root = document.documentElement;
    const previousColorScheme = root.style.colorScheme;
    const previousDashboardMode = root.dataset.dashboardMode;
    const previousBodyBackground = document.body.style.backgroundColor;
    root.style.colorScheme = dashboardMode;
    root.dataset.dashboardMode = dashboardMode;
    document.body.style.backgroundColor = dashboardMode === 'dark' ? '#0d1117' : '';
    return () => {
      root.style.colorScheme = previousColorScheme;
      if (previousDashboardMode === undefined) delete root.dataset.dashboardMode;
      else root.dataset.dashboardMode = previousDashboardMode;
      document.body.style.backgroundColor = previousBodyBackground;
    };
  }, [dashboardMode]);

  useEffect(() => {
    const requested = searchParams.get('feature') || (productId === 'satvic-fluid' && searchParams.has('qaRunId') ? 'start-review' : null);
    if (requested && product.groups.some(group => group.features.some(feature => feature.id === requested))) {
      setActiveFeatureId(requested);
      onFeatureSelect?.(requested);
    }
  }, [onFeatureSelect, product.groups, productId, searchParams]);

  useEffect(() => {
    if (!accountMenuOpen) {
      setAppThemeOpen(false);
      return;
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.account-menu, .account-trigger, .rail-account, .rail-account-collapsed, .drawer-account')) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);

  const chooseFeature = (feature: ProductFeature) => {
    setNotificationOpen(false);
    setActiveFeatureId(feature.id);
    onFeatureSelect?.(feature.id);
    setNavOpen(false);
  };

  useEffect(() => {
    if (!productMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.product-rail')) setProductMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProductMenuOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [productMenuOpen]);

  const navigateToProduct = (href: string) => {
    setNotificationOpen(false);
    setProductMenuOpen(false);
    if (new URL(href, window.location.origin).pathname !== window.location.pathname) startNavigationLoading();
    router.push(href);
  };

  const accountName = accountEmail
    ? accountEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    : 'Account';
  const workspaceName = accountName === 'Account' ? 'Satvic Studio Workspace' : `${accountName}'s Workspace`;
  const visibleProducts = products;
  const visibleNotifications = notifications;

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load notifications.');
      setNotifications(Array.isArray(body.notifications) ? body.notifications : []);
      setNotificationError('');
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Could not load notifications.');
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const onFocus = () => { void loadNotifications(); };
    window.addEventListener('focus', onFocus);
    const timer = notificationOpen ? window.setInterval(() => { void loadNotifications(); }, 60_000) : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (timer) window.clearInterval(timer);
    };
  }, [loadNotifications, notificationOpen]);

  async function dismissNotification(item: DashboardNotification) {
    setFollowingNotificationId(item.id);
    setNotificationError('');
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not remove this notification.');
      setNotifications(current => current.filter(notification => notification.id !== item.id));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Could not remove this notification.');
    } finally {
      setFollowingNotificationId(null);
    }
  }

  function openNotification(item: DashboardNotification) {
    setNotificationOpen(false);
    if (new URL(item.href, window.location.origin).pathname !== window.location.pathname) startNavigationLoading();
    router.push(item.href);
  }

  return (
    <main className={`app-shell product-${productId}${productRailCollapsed ? ' product-rail-collapsed' : ''}${featureRailCollapsed ? ' feature-rail-collapsed' : ''}${hideFeatureNavigation ? ' dashboard-home-shell' : ''}`} data-theme={dashboardTheme} data-mode={dashboardMode}>
      <nav className={`product-rail${productMenuOpen ? ' product-rail-expanded' : ''}`} aria-label="Satvic products">
        <button type="button" className="rail-workspace" aria-label="Open product menu" aria-haspopup="true" aria-expanded={productMenuOpen} title="Satvic Studio and tools" onClick={() => { setProductMenuOpen(open => !open); setAccountMenuOpen(false); setNotificationOpen(false); }}>
          <span className="rail-workspace-mark"><img className="satvic-org-mark" src="https://satvicmovement.org/images/favicon.png" alt="" aria-hidden="true" /></span>
        </button>
        <div className="rail-product-list" aria-label="Products">
          {visibleProducts.map(item => <button key={item.id} type="button" aria-current={!hideFeatureNavigation && item.id === productId ? 'page' : undefined} className={`rail-product${!hideFeatureNavigation && item.id === productId ? ' active' : ''}`} onClick={() => navigateToProduct(item.href)} title={item.name}>
            <span className="rail-product-icon"><AudioLines size={19} /></span>
          </button>)}
        </div>
        <div className="rail-spacer" />
        <button type="button" className="rail-notifications" aria-label={`Notifications, ${visibleNotifications.length} items`} aria-expanded={notificationOpen} title="Notifications" onClick={() => { setProductMenuOpen(false); setAccountMenuOpen(false); setNotificationOpen(true); }}>
          <Bell size={19}/>{visibleNotifications.length > 0 && <span>{visibleNotifications.length > 9 ? '9+' : visibleNotifications.length}</span>}
        </button>
        <button type="button" className="rail-account" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => { setProductMenuOpen(false); setAccountMenuOpen(open => !open); }} title={accountName}>
          <span className="account-trigger-avatar"><img src={getProfileAvatarSrc(accountAvatar)} alt=""/></span>
        </button>
        <section className="product-drawer" aria-label="Satvic Studio and product switcher">
          <div className="drawer-workspace drawer-workspace-static" aria-label="Satvic Studio workspace">
            <span className="rail-workspace-mark"><img className="satvic-org-mark" src="https://satvicmovement.org/images/favicon.png" alt="" aria-hidden="true" /></span>
            <span><b>Satvic Studio</b><small>{workspaceName}</small></span>
          </div>
          <div className="drawer-product-list" aria-label="Products">
            {visibleProducts.map(item => <button key={item.id} type="button" aria-current={!hideFeatureNavigation && item.id === productId ? 'page' : undefined} className={`drawer-product${!hideFeatureNavigation && item.id === productId ? ' active' : ''}`} onClick={() => navigateToProduct(item.href)}>
              <span className="product-menu-icon"><AudioLines size={19} /></span><span><b>{item.name}</b><small>{item.description}</small></span>
            </button>)}
          </div>
          <button type="button" className="drawer-account" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}>
            <span className="account-trigger-avatar"><img src={getProfileAvatarSrc(accountAvatar)} alt=""/></span>
            <span>{accountName}</span>
            <ChevronDown size={16} />
          </button>
        </section>
      </nav>

      <aside className={`sidebar${navOpen ? ' sidebar-open' : ''}`}>
        {!hideFeatureNavigation && <><div className="workspace-heading"><div className="workspace-product">{product.name}</div><div className="workspace-heading-actions"><button className="sidebar-shrink icon-btn" onClick={() => {const collapse = !featureRailCollapsed;setFeatureRailCollapsed(collapse);setProductRailCollapsed(collapse);}} aria-label={featureRailCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={featureRailCollapsed ? 'Expand navigation' : 'Collapse navigation'}>{featureRailCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button className="icon-btn mobile-close" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div></div>
        {product.groups.map(group => <div className="product-nav-group" key={group.label || product.id}>{group.label && <div className="nav-label nav-label-spaced">{group.label}</div>}<nav className="main-nav">{group.features.map(feature => {const Icon = featureIcons[feature.icon];return <button key={feature.id} title={feature.label} className={`nav-item${activeFeatureId === feature.id ? ' active' : ''}`} onClick={() => chooseFeature(feature)}><Icon size={18} /><span>{feature.label}</span></button>})}</nav></div>)}</>}
        <div className="sidebar-spacer" />
        {featureRailCollapsed && <button type="button" className="rail-account feature-rail-account" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)} title={accountName}><span className="account-trigger-avatar"><img src={getProfileAvatarSrc(accountAvatar)} alt=""/></span></button>}
      </aside>

      {accountMenuOpen && <div className="account-menu account-menu-rail" role="menu">
        <button type="button" role="menuitem" className="account-menu-option" aria-expanded={appThemeOpen} aria-controls={appThemeOpen ? 'account-app-theme-options' : undefined} onClick={() => setAppThemeOpen(open => !open)}><Palette size={17}/><span>App theme</span><ChevronDown className={appThemeOpen ? 'account-theme-chevron open' : 'account-theme-chevron'} size={15}/></button>
        {appThemeOpen && <div className="account-theme-options" id="account-app-theme-options" role="radiogroup" aria-label="Choose an app color theme">{dashboardThemes.map(option => <button type="button" role="radio" aria-checked={dashboardTheme === option.id} className="account-theme-option" key={option.id} onClick={() => setDashboardTheme(option.id)} aria-label={`${option.label} app theme`} title={option.label}><span className={`account-theme-swatch ${option.id}`}>{dashboardTheme === option.id && <Check size={11}/>}</span></button>)}</div>}
        <button type="button" role="switch" aria-checked={dashboardMode === 'dark'} className="account-menu-option account-mode-option" onClick={() => setDashboardMode(mode => mode === 'dark' ? 'light' : 'dark')}><span className="account-mode-icon">{dashboardMode === 'dark' ? <Moon size={16}/> : <Sun size={16}/>}</span><span>{dashboardMode === 'dark' ? 'Dark mode' : 'Light mode'}</span><span className={`account-mode-switch${dashboardMode === 'dark' ? ' active' : ''}`} aria-hidden="true"><i/></span></button>
        <form action={signOut}><PendingSubmitButton role="menuitem" className="account-logout" pendingText="Logging out…"><LogOut size={17} /><span>Log out</span></PendingSubmitButton></form>
      </div>}

      <section className="main-area">
        <header className="topbar"><button className="icon-btn menu-trigger" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button></header>
        <div className="content-wrap">{notificationOpen ? <section className="notification-dashboard">
          <header className="notification-dashboard-header"><div><span className="section-kicker">SATVIC STUDIO</span><h1>Notifications</h1><p>Deadlines, completed reviews, and work that needs your attention.</p></div><button type="button" className="icon-btn" aria-label="Close notifications" onClick={() => setNotificationOpen(false)}><X size={18}/></button></header>
          {notificationError && <div className="notification-error"><span>{notificationError}</span><button type="button" onClick={() => void loadNotifications()}>Retry</button></div>}
          {notificationsLoading && visibleNotifications.length === 0 ? <div className="notification-empty">Loading notifications...</div> : visibleNotifications.length === 0 ? <div className="notification-empty"><Bell size={22}/><b>You are all caught up</b><span>New deadlines and completed video reviews will appear here.</span></div> : <div className="notification-list">{visibleNotifications.map(item => <article className="notification-card" key={item.id}>
            <div className="notification-card-copy"><div className="notification-card-meta"><span>{item.kind}</span><time>{new Date(item.createdAt).toLocaleString()}</time></div><h2>{item.title}</h2><p>{item.description}</p></div>
            <div className="notification-actions"><button type="button" className="notification-delete" aria-label={`Delete notification: ${item.title}`} title="Delete notification" disabled={followingNotificationId === item.id} aria-busy={followingNotificationId === item.id} onClick={() => void dismissNotification(item)}>{followingNotificationId === item.id ? <span className="action-spinner" aria-hidden="true"/> : <Trash2 size={16}/>}</button><button type="button" className="notification-open" aria-label={`Open ${item.title}`} title="Open notification" onClick={() => openNotification(item)}><ArrowRight size={19}/></button></div>
          </article>)}</div>}
        </section> : children}</div>
      </section>
    </main>
  );
}
