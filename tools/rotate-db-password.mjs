/**
 * Change the database role's own password, from here, with nothing echoed.
 *
 * Railway's «Console» tab is a shell inside the container, and its web
 * terminal cannot answer `\password`'s hidden prompt — it sits there with the
 * caret blinking and swallows what you type (Dim, 21.09.2026). Running
 * `alter role … with password '…'` instead puts the new secret in that
 * console's scrollback, which is the thing we are in the middle of trying to
 * avoid.
 *
 * There is a subtler trap behind all of this, and it is why the rotation
 * looked done when it was not: changing `POSTGRES_PASSWORD` on the Railway
 * service does NOT change the role. That variable is read by the Postgres
 * image only when it initialises an EMPTY data directory; on a volume that
 * already holds a database it is ignored for ever. So the dashboard shows the
 * new password, the database still wants the old one, and the two drift apart
 * silently. The role is the only thing that decides, and this changes the role.
 *
 *   node tools/rotate-db-password.mjs            # prompts, nothing echoed
 *   node tools/rotate-db-password.mjs --role app # some other role
 *
 * `DATABASE_URL` must hold credentials that still WORK — the old ones. The
 * new password is typed here and goes nowhere else: not into argv (which the
 * process list shows), not into the environment, not into shell history.
 */
import { Client } from "pg";
import { stdin, stdout } from "node:process";

const ROLE = (() => {
  const i = process.argv.indexOf("--role");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "postgres";
})();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Use the credentials that still work — the OLD ones.");
  process.exit(1);
}

/** A prompt that prints nothing back. Ctrl+C still gets you out. */
function secret(label) {
  return new Promise((resolve, reject) => {
    stdout.write(label);
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const done = (err, val) => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
      stdin.pause();
      stdout.write("\n");
      err ? reject(err) : resolve(val);
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return done(null, buf);
        if (ch === "") return done(new Error("cancelled"));
        // backspace / delete
        if (ch === "" || ch === "\b") { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const who = await db.query("select current_database() as db, current_user as usr, version() as v");
console.log(`connected to ${who.rows[0].db} as ${who.rows[0].usr}`);
console.log(`${who.rows[0].v.split(",")[0]}`);
console.log(`about to change the password of role: ${ROLE}\n`);

let pw;
try {
  pw = await secret("New password (nothing will appear): ");
  const again = await secret("Again: ");
  if (pw !== again) throw new Error("the two did not match");
} catch (err) {
  console.error(`\n${err.message}. Nothing was changed.`);
  await db.end();
  process.exit(1);
}

if (pw.length < 16) {
  console.error("Too short — use at least 16 characters. Nothing was changed.");
  await db.end();
  process.exit(1);
}
/* A password with one of these in it has to be percent-encoded inside a
   connection URL, and the half that gets it wrong fails with the same
   «password authentication failed» that sent us here. Refusing is kinder
   than explaining. */
if (/[@:/?#[\]%&\\ ]/.test(pw)) {
  console.error("Avoid @ : / ? # [ ] % & \\ and spaces — they have to be escaped inside DATABASE_URL.");
  console.error("Letters and digits only is the safe choice. Nothing was changed.");
  await db.end();
  process.exit(1);
}

/* Postgres quotes the literal, not this script: ALTER ROLE takes no bind
   parameter for a password, and hand-quoting somebody's secret is how you
   end up with an injection in the one statement that must not have one. */
const built = await db.query(
  "select format('alter role %I with password %L', $1::text, $2::text) as sql",
  [ROLE, pw],
);
await db.query(built.rows[0].sql);
console.log(`\nRole ${ROLE} now has the new password.`);

/* Prove it rather than assume it: a fresh connection with the new secret. */
const url = new URL(process.env.DATABASE_URL);
url.password = encodeURIComponent(pw);
const check = new Client({ connectionString: url.toString() });
try {
  await check.connect();
  await check.query("select 1");
  await check.end();
  console.log("Verified: a new connection with it works.\n");
} catch (err) {
  console.error("\nThe change went through but a new connection FAILED:", err.message);
  console.error("Do not update Vercel yet — tell someone.");
  await db.end();
  process.exit(1);
}
await db.end();

console.log("Now, and quickly — the old password stopped working the moment this ran:");
console.log("  1. Vercel → Settings → Environment Variables → DATABASE_URL → the new one → redeploy");
console.log("  2. Railway → Postgres → Variables → POSTGRES_PASSWORD → the same value");
console.log("     (that variable changes nothing by itself; it is there so the dashboard stops lying)");
console.log("  3. curl https://rempireshop.diipsolutions.eu/api/overrides/   → expect {\"ok\":true,…}");
