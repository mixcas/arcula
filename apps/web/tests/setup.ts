// Web test environment bootstrap (runs once per test file, before the file's
// module graph).
//
// Installs the stack transport: the global fetch becomes the cookie-jar
// proxy emulator, so both the Better Auth react client and the service
// layer reach the real API on the local stack the way the dev browser
// reaches it through the Vite proxy. Node-environment files get the same
// wrapper (inert for anything that is not app-origin traffic).
//
// The session cookie is dropped after each file: a file that signs in must
// not leak its session into the next file's expectations of anonymity.
import { afterAll } from "vitest";
import { installStackFetch, resetStackSession } from "./helpers/stackFetch";

installStackFetch();

afterAll(resetStackSession);
