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
}

interface AuthState {
  user: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: UserInfo, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  restoreAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, accessToken, refreshToken, isAuthenticated: true });
  },

  logout: () => {
    localStorage.clear();
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  },

  restoreAuth: () => {
    const token = localStorage.getItem('accessToken');
    set({ accessToken: token, isAuthenticated: !!token });
  },
}));
