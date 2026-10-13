import { NextResponse } from "next/server";
import { ntfyTopic } from "@/lib/auth";

/** The message topic for talking to the worker on the PC. */
export async function GET() {
  return NextResponse.json({ topic: ntfyTopic() });
}
