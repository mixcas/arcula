// The user shape the web app has consumed since the Firebase days.
//
// `uid` is the Firebase id field kept as an alias: every owner-side
// consumer reads `currentUser.uid`, so keeping it is what makes the Phase
// 4 cutover (G1) a provider swap instead of a find-and-replace.

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
