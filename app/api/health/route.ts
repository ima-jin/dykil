import { NextResponse } from 'next/server';
import { isAppClaimed } from '@/lib/auth/signing-identity';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'dykil',
    timestamp: new Date().toISOString(),
    // Unclaimed boot mode (imajin-ai#2427): false until an operator pastes a
    // claim code at /claim (or IMAJIN_APP_CLAIM_CODE resolves it at boot).
    claimed: isAppClaimed(),
  });
}
