// The Better Auth provider — the stand-in for
// src/context/AuthContext.tsx at the Phase 4 cutover (G1): the same value
// shape (currentUser with the `uid` alias, login, logout) and the same
// gate (children render only once the session is known).
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

  // A failed sign-in rejects with Better Auth's native error:
  // { status, statusText, error: { message, code } } — Phase 4's
  // LoginPage maps error.code (INVALID_EMAIL_OR_PASSWORD, …) in place of
  // the old Firebase code map.
  const login = async (email: string, password: string) => {
    await authClient.signIn.email({ email, password });
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
