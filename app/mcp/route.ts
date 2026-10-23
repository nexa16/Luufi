import { env } from 'cloudflare:workers';
import { dispatchMcp } from '@/lib/mcp/route';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return dispatchMcp(request, env);
}
export function GET(request: Request) {
  return dispatchMcp(request, env);
}
export function PUT(request: Request) {
  return dispatchMcp(request, env);
}
export function PATCH(request: Request) {
  return dispatchMcp(request, env);
}
export function DELETE(request: Request) {
  return dispatchMcp(request, env);
}
export function OPTIONS(request: Request) {
  return dispatchMcp(request, env);
}
export function HEAD(request: Request) {
  return dispatchMcp(request, env);
}
