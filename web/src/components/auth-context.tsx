"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getClaims, type SessionClaims, signOut as cognitoSignOut } from "@/lib/auth";

type AuthState =
  | { status: "loading"; claims: null }
  | { status: "authed"; claims: SessionClaims }
  | { status: "anonymous"; claims: null };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", claims: null });

  const refresh = useCallback(async () => {
    try {
      const claims = await getClaims();
      if (claims) setState({ status: "authed", claims });
      else setState({ status: "anonymous", claims: null });
    } catch {
      setState({ status: "anonymous", claims: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setState({ status: "anonymous", claims: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
