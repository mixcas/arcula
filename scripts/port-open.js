// TCP connect-or-timeout probe. Usage: node scripts/port-open.js <port>
// Exits 0 if 127.0.0.1:<port> accepts a connection within 2 s, 1 otherwise.
// Used by the stack scripts to probe services that have no health endpoint
// (Mailpit's SMTP port; anything that is not HTTP). ESM: the root
// package.json is "type": "module".
import net from "node:net";

const port = Number(process.argv[2]);
const s = net.connect(port, "127.0.0.1");
const t = setTimeout(() => {
  s.destroy();
  process.exit(1);
}, 2000);
s.once("connect", () => {
  clearTimeout(t);
  process.exit(0);
});
s.once("error", () => {
  clearTimeout(t);
  process.exit(1);
});
