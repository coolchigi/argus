"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getClaims, type SessionClaims, signOut as cognitoSignOut } from "@/lib/auth";
import { GUEST_CLAIMS, isGuest, setGuest } from "@/lib/guest";

// A guest counts as authed, so the app shell renders, and `guest` marks the
// read-only demo view. A real session always wins over the guest flag.
type AuthState =
  | { status: "loading"; claims: null; guest: false }
  | { status: "authed"; claims: SessionClaims; guest: boolean }
  | { status: "anonymous"; claims: null; guest: false };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  enterGuest: () => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", claims: null, guest: false });

  const refresh = useCallback(async () => {
    let claims: SessionClaims | null = null;
    try {
      claims = await getClaims();
    } catch {
      claims = null;
    }
    if (claims) {
      if (isGuest()) {
        setGuest(false);
        queryClient.clear();
      }
      setState({ status: "authed", claims, guest: false });
    } else if (isGuest()) {
      setState({ status: "authed", claims: GUEST_CLAIMS, guest: true });
    } else {
      setState({ status: "anonymous", claims: null, guest: false });
    }
  }, [queryClient]);

  const enterGuest = useCallback(() => {
    setGuest(true);
    queryClient.clear();
    setState({ status: "authed", claims: GUEST_CLAIMS, guest: true });
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setGuest(false);
    queryClient.clear();
    setState({ status: "anonymous", claims: null, guest: false });
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, enterGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
