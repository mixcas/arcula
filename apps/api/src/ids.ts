// A fresh row id: a UUID with its hyphens removed.
//
// The hyphen-free shape is load-bearing, not cosmetic. Routes carry the id in
// a `{urlizedName}-{id}` segment, and the client recovers it by cutting at the
// LAST hyphen (`parseId` in `packages/shared`) — a hyphenated id would put that
// cut inside the id itself and the recovered "id" would be its last segment.
// The client mints the same shape for the artwork ids it supplies, so both
// sides of a route segment obey one rule.
export const mintId = (): string => crypto.randomUUID().replace(/-/g, "");
