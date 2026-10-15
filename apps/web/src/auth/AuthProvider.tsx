// The app-wide auth provider: the value shape (currentUser with the `uid`
// alias, login, logout) and the gate (children render only once the session
// is known).
//
// The session needs no manual refetch after login/logout: the client's
// session atom listens to its own signal, which the fetch proxy bumps on
// every successful /sign-in/email, /sign-out, /change-password, …

import React, { createContext, ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type SessionUserRead } from "@arcula/shared";
import { meService } from "../services/meService";
import { authClient } from "./client";
import { toAuthError } from "./errors";
import { toArculaUser, type ArculaUser } from "./user";

export interface AuthContextType {
  currentUser: ArculaUser | null;
  /**
   * The /me read: the custom columns the session does not carry (tier,
   * first/last name, settings). `null` while the session is unknown, while
   * it is loading, or when the read failed — tier-dependent UI falls back
   * the way the API does (an unknown tier is the free tier), so a failed
   * read degrades to a missing number rather than blocking the app.
   */
  me: SessionUserRead | null;
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
  const [me, setMe] = useState<SessionUserRead | null>(null);

  // The session decides whose profile this is; the custom fields ride /me
  // (the session carries the core fields only). Keyed on the uid so a
  // different account re-fetches; the cleanup both drops a late read from a
  // departed account and clears the profile, so signing out never leaves the
  // previous account's name in the menu.
  const uid = currentUser?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    meService
      .getMe()
      .then((row) => {
        if (!cancelled) setMe(row);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching profile:", err);
        setMe(null);
      });
    return () => {
      cancelled = true;
      setMe(null);
    };
  }, [uid]);

  // A failed sign-in does NOT reject: better-fetch (without `throw: true`)
  // resolves to { data: null, error }. `toAuthError` lifts it onto a real
  // Error carrying status/code so the LoginPage mapping runs; a plain
  // `await` would swallow a bad password and navigate to /manage as if the
  // login had succeeded.
  const login = async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password });
    const failed = toAuthError(result, "Login failed");
    if (failed) throw failed;
  };

  const logout = async () => {
    await authClient.signOut();
    await navigate("/login");
  };

  const value = {
    currentUser,
    me,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {!isPending && children}
    </AuthContext.Provider>
  );
};
