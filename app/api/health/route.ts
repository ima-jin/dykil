import { NextResponse } from 'next/server';
import { isAppClaimed } from '@/lib/auth/signing-identity';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'dykil',
    timestamp: new Date().toISOString(),
    // Unclaimed boot mode (imajin-ai#2427): false until an operator pastes a
    // claim code at /dykil/claim, or boot re-authenticates an existing keystore.
    claimed: isAppClaimed(),
  });
}
