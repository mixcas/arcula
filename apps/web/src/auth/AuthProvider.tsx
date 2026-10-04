// The app-wide auth provider (replaced src/context/AuthContext.tsx at the
// Phase 4 cutover): the same value shape (currentUser with the `uid` alias,
// login, logout) and the same gate (children render only once the session
// is known).
//
// The session needs no manual refetch after login/logout: the client's
// session atom listens to its own signal, which the fetch proxy bumps on
// every successful /sign-in/email, /sign-out, /change-password, …

import React, { createContext, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "./client";
import { toArculaUser, type ArculaUser } from "./user";

export interface AuthContextType {
  currentUser: ArculaUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const { data, isPending } = authClient.useSession();

  const currentUser = data?.user ? toArculaUser(data.user) : null;

  // A failed sign-in does NOT reject: better-fetch (without `throw: true`,
  // which the client does not set) resolves to { data: null, error }, where
  // error is the response body spread with status/statusText —
  // { message, code, status, statusText }. Rethrow it (lifted onto a real
  // Error, which lint's only-throw-error requires) so the LoginPage
  // mapping actually runs; a plain `await` would swallow a bad password
  // and navigate to /manage as if the login had succeeded.
  const login = async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password });
    const error = (
      result as {
        error?: { message?: string; code?: string; status?: number } | null;
      }
    ).error;
    if (error) {
      const failed = new Error(error.message ?? "Login failed");
      Object.assign(failed, { status: error.status, code: error.code });
      throw failed;
    }
  };

  const logout = async () => {
    await authClient.signOut();
    await navigate("/login");
  };

  const value = {
    currentUser,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {!isPending && children}
    </AuthContext.Provider>
  );
};
