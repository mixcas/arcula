// Phase 4 cutover: the consumer-facing hook is now the Better Auth
// provider's own hook. Kept at this path so the ~20 owner-side call sites
// (all of which read `useAuth()` off `@/hooks/useAuth`) need no changes.
export { useAuth } from "@/auth/useAuth";
