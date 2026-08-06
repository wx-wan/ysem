import { create } from 'zustand';

interface UserInfo {
  id: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  avatar: string;
  role: { id: string; name: string; code: string } | null;
  departmentId: string;
  permissions?: string[];
}

interface AuthState {
  user: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  permissions: string[];
  setAuth: (user: UserInfo, accessToken: string, refreshToken: string) => void;
  setPermissions: (permissions: string[]) => void;
  logout: () => void;
  restoreAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  permissions: JSON.parse(localStorage.getItem('permissions') || '[]'),

  setAuth: (user, accessToken, refreshToken) => {
    const permissions = user.permissions ?? [];
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ user, accessToken, refreshToken, permissions, isAuthenticated: true });
  },

  setPermissions: (permissions) => {
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ permissions });
  },

  logout: () => {
    localStorage.clear();
    set({ user: null, accessToken: null, refreshToken: null, permissions: [], isAuthenticated: false });
  },

  restoreAuth: () => {
    const token = localStorage.getItem('accessToken');
    const permissions = JSON.parse(localStorage.getItem('permissions') || '[]');
    set({ accessToken: token, permissions, isAuthenticated: !!token });
  },
}));
