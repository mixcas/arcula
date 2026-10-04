import { useContext } from "react";
import { AuthContext } from "./AuthProvider";

// The value shape is the old AuthContext's (src/hooks/useAuth.ts
// re-exports this hook, so the call sites are unchanged).
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
