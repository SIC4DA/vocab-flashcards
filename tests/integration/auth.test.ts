import { describe, expect, it } from "vitest";
import * as register from "@/app/api/auth/register/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import * as password from "@/app/api/account/password/route";
import * as settings from "@/app/api/account/settings/route";
import { resolveSettings } from "@/lib/validation";
import { call } from "../support/route";
import { verifySessionToken } from "@/lib/session";

describe("register", () => {
  it("creates a user, sets an HttpOnly session cookie and logs in", async () => {
    const r = await call(register.POST, { body: { username: "Maria_G", password: "password123" } });
    expect(r.status).toBe(201);
    expect(r.json.user.username).toBe("Maria_G");
    expect(r.json.user.passwordHash).toBeUndefined();
    const setCookie = r.res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const session = await verifySessionToken(r.cookie);
    expect(session?.sub).toBe(r.json.user.id);
    expect(session!.exp - session!.iat).toBe(30 * 24 * 3600);
    const who = await call(me.GET, { cookie: r.cookie });
    expect(who.json.user.username).toBe("Maria_G");
  });

  it("rejects a duplicate username with different case", async () => {
    await call(register.POST, { body: { username: "DupUser", password: "password123" } });
    const r = await call(register.POST, { body: { username: "dupuser", password: "password123" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("username_taken");
    expect(r.json.error.fields.username).toBeTruthy();
  });

  it("validates input with the standard error shape", async () => {
    const r = await call(register.POST, { body: { username: "a", password: "short" } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatchObject({ code: "validation_error" });
    expect(Object.keys(r.json.error.fields)).toEqual(expect.arrayContaining(["username", "password"]));
  });

  it("can be disabled with ALLOW_SIGNUPS=false", async () => {
    process.env.ALLOW_SIGNUPS = "false";
    try {
      const r = await call(register.POST, { body: { username: "nobody", password: "password123" } });
      expect(r.status).toBe(403);
    } finally {
      delete process.env.ALLOW_SIGNUPS;
    }
  });
});

describe("login", () => {
  it("logs in case-insensitively and rejects bad passwords generically", async () => {
    await call(register.POST, { body: { username: "Carlos", password: "password123" } });
    const ok = await call(login.POST, { body: { username: "CARLOS", password: "password123" } });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toBeTruthy();
    const bad = await call(login.POST, { body: { username: "carlos", password: "nope-nope" } });
    expect(bad.status).toBe(401);
    expect(bad.json.error.message).toBe("Invalid username or password");
    const unknown = await call(login.POST, { body: { username: "ghost", password: "nope-nope" } });
    expect(unknown.json.error.message).toBe("Invalid username or password");
  });

  it("locks a username after 10 failures within 15 minutes", async () => {
    await call(register.POST, { body: { username: "victim", password: "password123" } });
    for (let i = 0; i < 10; i++) {
      const r = await call(login.POST, { body: { username: "victim", password: `wrong-${i}-pass` } });
      expect(r.status).toBe(401);
    }
    const locked = await call(login.POST, { body: { username: "victim", password: "password123" } });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe("locked_out");
    // Other usernames are unaffected
    await call(register.POST, { body: { username: "bystander", password: "password123" } });
    expect((await call(login.POST, { body: { username: "bystander", password: "password123" } })).status).toBe(200);
  });

  it("logout clears the cookie", async () => {
    const r = await call(logout.POST, { method: "POST", body: {} });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("set-cookie")).toMatch(/vf_session=;.*Max-Age=0/i);
  });

  it("protected routes reject missing or forged sessions", async () => {
    expect((await call(me.GET)).status).toBe(401);
    expect((await call(me.GET, { cookie: "not-a-jwt" })).status).toBe(401);
  });
});

describe("account", () => {
  it("changes the password only with the current password", async () => {
    const { cookie } = await call(register.POST, { body: { username: "pwuser", password: "password123" } });
    const bad = await call(password.PATCH, { method: "PATCH", cookie, body: { currentPassword: "wrongpass", newPassword: "newpassword1" } });
    expect(bad.status).toBe(400);
    const ok = await call(password.PATCH, { method: "PATCH", cookie, body: { currentPassword: "password123", newPassword: "newpassword1" } });
    expect(ok.status).toBe(200);
    expect((await call(login.POST, { body: { username: "pwuser", password: "newpassword1" } })).status).toBe(200);
  });

  it("updates settings with validation", async () => {
    const { cookie } = await call(register.POST, { body: { username: "setuser", password: "password123" } });
    const r = await call(settings.PATCH, { method: "PATCH", cookie, body: { soundEffects: false, theme: "dark" } });
    expect(r.json.settings).toMatchObject({ soundEffects: false, theme: "dark", speechRate: 0.9 });
    const bad = await call(settings.PATCH, { method: "PATCH", cookie, body: { speechRate: 9 } });
    expect(bad.status).toBe(400);
    // Study pacing and recordings are fixed: they can't be changed.
    const fixed = await call(settings.PATCH, { method: "PATCH", cookie, body: { stepsPerDay: 5 } });
    expect(fixed.status).toBe(400);
  });

  it("ignores old stored values of settings that are no longer editable", () => {
    const s = resolveSettings({ stepsPerDay: 5, useRecordings: false, ignoreArticles: true, soundEffects: false });
    expect(s).toMatchObject({ stepsPerDay: 2, useRecordings: true, ignoreArticles: false, soundEffects: false });
  });
});
