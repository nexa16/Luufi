export const attachmentMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;
export type AttachmentMime = (typeof attachmentMimeTypes)[number];
export const imageMaxBytes = 10_000_000;
export const videoMaxBytes = 15_000_000;
export type AttachmentManifest = {
  name: string;
  mimeType: AttachmentMime;
  size: number;
};
export type Attachment = {
  id: string;
  projectId: string;
  feedbackId: string;
  entryId: string;
  name: string;
  mimeType: AttachmentMime;
  size: number;
  status: 'pending' | 'ready' | 'expired';
  revision: number;
  sha256: string | null;
  createdAt: string;
  readyAt: string | null;
  mediaUrl: string;
  downloadUrl: string;
};
export type Feedback = {
  id: string;
  projectId: string;
  revision: number;
  contentRevision: number;
  refinedContentRevision: number | null;
  needsRefinement: boolean;
  createdAt: string;
  updatedAt: string;
};
export type FeedbackSummary = Feedback & {
  originalPreview: string;
  entryCount: number;
  attachmentCount: number;
  pendingAttachmentCount: number;
};
export type FeedbackEntry = {
  id: string;
  feedbackId: string;
  kind: 'original' | 'addition';
  text: string;
  position: number;
  createdAt: string;
  attachments: Attachment[];
};
export type FeedbackInput = {
  text: string;
  attachments?: AttachmentManifest[];
};
export type FeedbackSaved = { feedback: Feedback; entry: FeedbackEntry };
export type RefinementInput = {
  repositoryCommit: string;
  documentationPolicy: string;
  planningPolicy: string;
  summary: string;
  orderIds?: string[];
  questions?: string[];
  deferredReason?: string;
  rejectedReason?: string;
};
export type Refinement = Omit<
  RefinementInput,
  'orderIds' | 'questions' | 'deferredReason' | 'rejectedReason'
> & {
  id: string;
  feedbackId: string;
  inputContentRevision: number;
  createdAt: string;
  orderIds: string[];
  questions: string[];
  deferredReason: string;
  rejectedReason: string;
};
export type FeedbackSource = {
  feedbackId: string;
  refinementId: string;
  inputContentRevision: number;
  summary: string;
  createdAt: string;
};
