import { NextRequest } from "next/server";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type Call = {
  method?: string;
  url?: string;
  body?: unknown;
  form?: FormData;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
};

export type CallResult = { status: number; json: any; text: string; cookie?: string; res: Response }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Invoke a route handler directly with a NextRequest (no server needed). */
export async function call(handler: unknown, opts: Call = {}): Promise<CallResult> {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", `vf_session=${opts.cookie}`);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const req = new NextRequest(new URL(opts.url ?? "/api/test", "http://localhost:3000"), {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.clone().text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = /vf_session=([^;]*)/.exec(setCookie)?.[1];
  return { status: res.status, json, text, cookie, res };
}
