// The user shape the web app consumes.
//
// `uid` is the session user's id alias: every owner-side consumer reads
// `currentUser.uid`, so the mapping in `toArculaUser` is what keeps that
// name stable across the app.

export interface ArculaUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

// The core fields of a Better Auth session user. The custom columns
// (tier, settings, first/last name) do not ride the session — the
// profile surface reads them from /api/v1/me.
export interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export function toArculaUser(user: SessionUser): ArculaUser {
  return {
    uid: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.name,
  };
}
