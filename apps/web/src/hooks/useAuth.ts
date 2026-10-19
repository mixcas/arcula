// The consumer-facing hook: the Better Auth provider's own hook, re-exported.
// Kept at this path so the owner-side call sites (all of which read
// `useAuth()` off `@/hooks/useAuth`) need no changes.
export { useAuth } from "@/auth/useAuth";
