import { mediaGet, mediaPut } from '@/lib/http/media';
type Context = {
  params: Promise<{
    projectId: string;
    feedbackId: string;
    attachmentId: string;
  }>;
};
export async function GET(request: Request, context: Context) {
  return mediaGet(request, await context.params);
}
export async function PUT(request: Request, context: Context) {
  return mediaPut(request, await context.params);
}
