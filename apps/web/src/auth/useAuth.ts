import { useContext } from "react";
import { AuthContext } from "./AuthProvider";

// The cutover (G1) repoints the consumers at this hook — or, more
// cheaply, flips src/hooks/useAuth.ts to re-export it. Either way the
// value shape is the old AuthContext's.
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
