import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { UserProfile, UserRole } from './types';
import { loginUser, fetchCurrentUser, logoutUser, changeOwnPassword, getAuthToken, setAuthToken, fetchKioskSession } from './api';

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (u: string, p: string) => Promise<UserProfile>;
  logout: () => void;
  changePassword: (oldP: string, newP: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    // 1. Check for URL token (?token=... or ?kiosk_token=...)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token') || urlParams.get('kiosk_token');
      if (queryToken) {
        setAuthToken(queryToken);
        urlParams.delete('token');
        urlParams.delete('kiosk_token');
        const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : '';
        window.history.replaceState({}, '', `${window.location.pathname}${newQuery}`);
      }
    } catch {
      // Ignore URL parsing errors
    }

    const token = getAuthToken();
    if (!token) {
      // 2. Check if host system provides kiosk auto-login session (localhost only)
      try {
        const kioskRes = await fetchKioskSession();
        setUser(kioskRes.user);
        setIsLoading(false);
        return;
      } catch {
        // Not a kiosk or auto-login not enabled
        setUser(null);
        setIsLoading(false);
        return;
      }
    }
    try {
      const profile = await fetchCurrentUser();
      setUser(profile);
    } catch {
      logoutUser();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();

    const handleUnauthorized = () => {
      logoutUser();
      setUser(null);
    };

    window.addEventListener('auth_unauthorized', handleUnauthorized);
    window.addEventListener('auth_logout', handleUnauthorized);

    return () => {
      window.removeEventListener('auth_unauthorized', handleUnauthorized);
      window.removeEventListener('auth_logout', handleUnauthorized);
    };
  }, [loadUser]);

  const login = async (u: string, p: string) => {
    const res = await loginUser(u, p);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  const changePassword = async (oldP: string, newP: string) => {
    await changeOwnPassword(oldP, newP);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
