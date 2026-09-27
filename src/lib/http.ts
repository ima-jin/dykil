import { NextResponse } from 'next/server';
import { corsHeaders as configCorsHeaders, corsOptions as configCorsOptions } from '@ima-jin/config';

export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function errorResponse(message: string, status = 400, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

export const corsHeaders = configCorsHeaders;
export const corsOptions = configCorsOptions;
