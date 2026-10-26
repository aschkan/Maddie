import test from "node:test";
import assert from "node:assert/strict";

import { checkSession, cookieFrom, loginAllowed, LOGIN_MAX, makeSession, noteAttempt, sameText } from "../src/lib/auth.ts";

const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;

test("a session made now checks out, and stops checking out when it expires", () => {
  const token = makeSession(SECRET, NOW, 60);
  assert.equal(checkSession(token, SECRET, NOW), true);
  assert.equal(checkSession(token, SECRET, NOW + 61_000), false);
});

test("a tampered, re-signed or malformed token is refused", () => {
  const token = makeSession(SECRET, NOW, 60);
  const [expires, signature] = token.split(".");
  assert.equal(checkSession(`${Number(expires) + 9999}.${signature}`, SECRET, NOW), false);
  assert.equal(checkSession(token, "another-secret", NOW), false);
  assert.equal(checkSession(`${token}.x`, SECRET, NOW), false);
  assert.equal(checkSession("", SECRET, NOW), false);
  assert.equal(checkSession(null, SECRET, NOW), false);
});

test("the cookie is read out of a raw header", () => {
  assert.equal(cookieFrom("a=1; maddie_admin=abc.def; b=2"), "abc.def");
  assert.equal(cookieFrom("a=1"), null);
  assert.equal(cookieFrom(null), null);
});

test("equal-time compare: different lengths are unequal, not a throw", () => {
  assert.equal(sameText("abc", "abc"), true);
  assert.equal(sameText("abc", "abcd"), false);
});

test("login attempts are limited per client", () => {
  const store = new Map<string, number[]>();
  for (let i = 0; i < LOGIN_MAX; i++) {
    assert.equal(loginAllowed("1.2.3.4", NOW, store), true);
    noteAttempt("1.2.3.4", NOW, store);
  }
  assert.equal(loginAllowed("1.2.3.4", NOW, store), false);
  assert.equal(loginAllowed("5.6.7.8", NOW, store), true);
  assert.equal(loginAllowed("1.2.3.4", NOW + 11 * 60_000, store), true);
});
