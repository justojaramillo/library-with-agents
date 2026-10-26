import { NextRequest } from "next/server";
import { GET as infoRoute } from "@/api/books/[id]/digital/route";
import { PATCH as copiesRoute } from "@/api/books/[id]/digital/copies/route";
import { PUT as contentRoute } from "@/api/books/[id]/digital/content/route";
import { ApiErrorSchema } from "@/shared/schema";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const SAME_ORIGIN_JSON = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
export const CROSS_SITE_JSON = { "content-type": "application/json", "sec-fetch-site": "cross-site" };

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function url(id: string, tail: string): string {
  return `http://localhost/api/books/${encodeURIComponent(id)}/digital${tail}`;
}

type Init = { method: string; headers: Record<string, string>; body?: string };

function build(method: string, address: string, rawBody: string | null, headers: Record<string, string>) {
  const init: Init = { method, headers };
  if (rawBody !== null) {
    init.body = rawBody;
  }
  return new NextRequest(address, init);
}

export function getInfo(id = "libro-1") {
  return infoRoute(new NextRequest(url(id, ""), { method: "GET" }), contextFor(id));
}

export function patchCopiesRaw(id: string, rawBody: string | null, headers: Record<string, string> = SAME_ORIGIN_JSON) {
  return copiesRoute(build("PATCH", url(id, "/copies"), rawBody, headers), contextFor(id));
}

export function patchCopies(id: string, body: Json, headers: Record<string, string> = SAME_ORIGIN_JSON) {
  return patchCopiesRaw(id, JSON.stringify(body), headers);
}

export function putContentRaw(id: string, rawBody: string | null, headers: Record<string, string> = SAME_ORIGIN_JSON) {
  return contentRoute(build("PUT", url(id, "/content"), rawBody, headers), contextFor(id));
}

export function putContent(id: string, markdown: string, headers: Record<string, string> = SAME_ORIGIN_JSON) {
  return putContentRaw(id, JSON.stringify({ markdown }), headers);
}

export async function errorOf(response: Response): Promise<string> {
  return ApiErrorSchema.parse(await response.json()).error;
}
