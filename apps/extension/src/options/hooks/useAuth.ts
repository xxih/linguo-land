import { useCallback, useEffect, useState } from 'react';
import {
  isAuthenticated,
  logout,
  getCurrentUser,
} from '../../background/api/authApi';

interface User {
  id: number;
  email: string;
}

export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const checkLoginStatus = useCallback(async () => {
    const loggedIn = await isAuthenticated();
    setIsLoggedIn(loggedIn);
    if (loggedIn) {
      const user = await getCurrentUser();
      setCurrentUser(user);
    } else {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    void checkLoginStatus();
  }, [checkLoginStatus]);

  const handleLoginSuccess = useCallback(async () => {
    await checkLoginStatus();
  }, [checkLoginStatus]);

  const handleLogout = useCallback(async () => {
    await logout();
    setIsLoggedIn(false);
    setCurrentUser(null);
  }, []);

  return {
    isLoggedIn,
    currentUser,
    handleLoginSuccess,
    handleLogout,
  };
}
