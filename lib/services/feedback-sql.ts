// Aliases are code-owned constants, never request input. These expressions keep
// browser/MCP responses and atomic replay receipts on the same data contract.
export function feedbackJson(alias = 'f') {
  return `json_object('id',${alias}.id,'projectId',${alias}.project_id,'revision',${alias}.revision,'contentRevision',${alias}.content_revision,'refinedContentRevision',${alias}.refined_content_revision,'needsRefinement',json(CASE WHEN ${alias}.refined_content_revision=${alias}.content_revision THEN 'false' ELSE 'true' END),'createdAt',${alias}.created_at,'updatedAt',${alias}.updated_at)`;
}
export function attachmentJson(alias = 'a') {
  const url = `'/api/projects/'||${alias}.project_id||'/feedback/'||${alias}.feedback_id||'/attachments/'||${alias}.id`;
  return `json_object('id',${alias}.id,'projectId',${alias}.project_id,'feedbackId',${alias}.feedback_id,'entryId',${alias}.entry_id,'name',${alias}.filename,'mimeType',COALESCE(${alias}.actual_mime_type,${alias}.declared_mime_type),'size',COALESCE(${alias}.actual_size,${alias}.declared_size),'status',${alias}.status,'revision',${alias}.revision,'sha256',${alias}.sha256,'createdAt',${alias}.created_at,'readyAt',${alias}.ready_at,'mediaUrl',${url},'downloadUrl',${url}||'?download=1')`;
}
export function entryJson(alias = 'e') {
  return `json_object('id',${alias}.id,'feedbackId',${alias}.feedback_id,'kind',${alias}.kind,'text',${alias}.text,'position',${alias}.position,'createdAt',${alias}.created_at,'attachments',json((SELECT json_group_array(json(data)) FROM (SELECT ${attachmentJson('a')} AS data FROM feedback_attachments a WHERE a.entry_id=${alias}.id ORDER BY a.position,a.id))))`;
}
export function refinementJson(alias = 'r') {
  return `json_patch(json_object('id',${alias}.id,'feedbackId',${alias}.feedback_id,'inputContentRevision',${alias}.input_content_revision,'createdAt',${alias}.created_at),json(${alias}.input_json))`;
}
