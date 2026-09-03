#!/usr/bin/env node
/**
 * Makes the value for ADMIN_PASSWORD_HASH.
 *
 *   node tools/hash-password.mjs
 *   → asks for the password on stdin (nothing lands in the shell history)
 *
 *   echo 'the password' | node tools/hash-password.mjs
 *
 * Copy the printed line into .env.local and into the Vercel project settings.
 * The password itself is never stored anywhere — only this scrypt digest,
 * which src/lib/auth.ts verifies. Keep the format in step with hashPassword()
 * there: scrypt$N$r$p$salt$key, salt and key base64.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

function hash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

function prompt() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question("Admin password: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const fromArgv = process.argv[2];
const password = fromArgv || (process.stdin.isTTY ? await prompt() : await readStdin());

if (!password) {
  console.error("No password given.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Too short — use at least 10 characters.");
  process.exit(1);
}

console.log(`ADMIN_PASSWORD_HASH=${hash(password)}`);
