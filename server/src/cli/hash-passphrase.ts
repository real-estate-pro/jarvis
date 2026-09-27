/**
 * npm run hash-passphrase
 * Prompts for the dashboard passphrase (twice, hidden), prints its argon2id hash, and
 * offers to write it (plus a SESSION_SECRET if missing) into server/.env.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { hash } from "@node-rs/argon2";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
const MIN_LENGTH = 12;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the prompt, then swallow the echoed keystrokes.
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question)) write.call(rl, question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolveAnswer(answer);
    });
  });
}

/** Sets KEY=value in a .env file, replacing an existing line or appending one. */
function setEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
}

async function main() {
  const first = await ask("New dashboard passphrase: ", true);
  if (first.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters (a few random words works well).`);
    process.exit(1);
  }
  const second = await ask("Type it again: ", true);
  if (first !== second) {
    console.error("The two entries don't match. Nothing was changed.");
    process.exit(1);
  }

  const hashed = await hash(first); // argon2id, OWASP-recommended defaults
  // Single quotes keep the $-separated hash literal in the .env file.
  const value = `'${hashed}'`;
  console.log(`\nDASHBOARD_PASSPHRASE_HASH=${value}\n`);

  if (!existsSync(envPath)) {
    console.log(`No ${envPath} yet. Copy .env.example to .env and paste the line above into it.`);
    return;
  }
  const save = (await ask(`Save it to ${envPath}? [Y/n] `)).trim().toLowerCase();
  if (save && save !== "y" && save !== "yes") {
    console.log("Not saved. Paste the line above into server/.env yourself.");
    return;
  }
  let env = readFileSync(envPath, "utf8");
  env = setEnv(env, "DASHBOARD_PASSPHRASE_HASH", value);
  const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim();
  if (!secret) {
    env = setEnv(env, "SESSION_SECRET", randomBytes(32).toString("hex"));
    console.log("Also generated a SESSION_SECRET.");
  }
  writeFileSync(envPath, env);
  chmodSync(envPath, 0o600); // it holds secrets: owner-only
  console.log("Saved. Restart jarvis-web for it to take effect (existing sessions are signed out).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
