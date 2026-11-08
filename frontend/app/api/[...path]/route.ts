// Runtime proxy: browser -> Next.js /api/* -> FastAPI backend (BACKEND_URL).
// Keeps a single public URL and no CORS issues. Read at request time, so it
// works on Railway without rebuilding when the backend URL changes.
// Streams the response body through (needed for the agent loop's NDJSON events).
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `${BACKEND.replace(/\/$/, "")}/api/${path.join("/")}${req.nextUrl.search}`;
  const isStream = path[0] === "agent" && path[1] === "run";
  try {
    const r = await fetch(url, {
      cache: "no-store",
      // Agent runs make several Claude calls; give them up to 15 min. Data calls: 45 s.
      signal: isStream ? req.signal : AbortSignal.timeout(45_000),
    });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") ?? "application/json",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    return Response.json({ detail: `backend unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
