import { useState, useEffect, useCallback } from 'react';

export type MainTab = 'dashboard' | 'ventilation' | 'schedules' | 'admin';
export type AdminSubTab = 'system' | 'zones' | 'interlocks' | 'clock' | 'setback' | 'licenses' | 'security' | 'diagnostics' | 'debug';
export type ScheduleSubTab = 'schedules' | 'matrix' | 'overview' | 'new' | 'review' | 'programs' | 'planner';

export interface RouteState {
  path: string;
  tab: MainTab;
  adminSubTab?: AdminSubTab;
  scheduleSubTab?: ScheduleSubTab;
  groupId?: number;
  dashboardFilter?: string;
  params: URLSearchParams;
}

export function parseLocation(): RouteState {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const dashboardFilter = params.get('floor') || undefined;
  
  // 1. Check Zone Direct Modal link: /zone/:id or /dashboard/zone/:id
  const zoneMatch = path.match(/^\/(?:dashboard\/)?zone\/(\d+)/);
  if (zoneMatch) {
    return {
      path,
      tab: 'dashboard',
      groupId: parseInt(zoneMatch[1], 10),
      dashboardFilter,
      params,
    };
  }

  // 2. Ventilation: /ventilation
  if (path.startsWith('/ventilation')) {
    return {
      path,
      tab: 'ventilation',
      params,
    };
  }

  // 3. Schedules: /schedules (default 'schedules'), /schedules/matrix
  if (path.startsWith('/schedules')) {
    const rawSub = path.split('/')[2];
    const scheduleSubTab: ScheduleSubTab = rawSub === 'matrix' ? 'matrix' : 'schedules';
    return {
      path,
      tab: 'schedules',
      scheduleSubTab,
      params,
    };
  }

  // 4. Admin: /admin, /admin/system, /admin/zones, /admin/interlocks, /admin/clock, /admin/setback, /admin/licenses, /admin/security, /admin/diagnostics
  if (path.startsWith('/admin')) {
    const rawSub = path.split('/')[2];
    const validSubs: AdminSubTab[] = [
      'system', 'zones', 'interlocks', 'clock', 'setback', 'licenses', 'security', 'diagnostics', 'debug'
    ];
    const adminSubTab: AdminSubTab = validSubs.includes(rawSub as any) ? (rawSub as AdminSubTab) : 'system';
    return {
      path,
      tab: 'admin',
      adminSubTab,
      params,
    };
  }

  // 5. Default: / or /dashboard
  return {
    path: '/',
    tab: 'dashboard',
    dashboardFilter,
    params,
  };
}

export function navigate(to: string, replace = false) {
  if (replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  window.dispatchEvent(new Event('appnavigation'));
}

export function useAppRouter() {
  const [route, setRoute] = useState<RouteState>(parseLocation);

  useEffect(() => {
    const handleNavigation = () => {
      setRoute(parseLocation());
    };

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('appnavigation', handleNavigation);

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('appnavigation', handleNavigation);
    };
  }, []);

  const goTo = useCallback((to: string, replace = false) => {
    navigate(to, replace);
  }, []);

  return { route, goTo };
}
