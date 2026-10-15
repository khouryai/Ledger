/**
 * Outlook's own .msg files (what classic Outlook saves when a message is dragged
 * into a folder), read with msgreader into the same shape a pasted email takes.
 */
import MsgReader from '@kenjiuno/msgreader';
import { cleanBody, parseSentDate, type Message } from '../engine/email';
import { cleanName } from '../engine/people';

export function parseMsg(bytes: ArrayBuffer): Message {
  const data = new MsgReader(bytes).getFileData();
  const recips = data.recipients ?? [];
  const addr = (r: { name?: string; email?: string; smtpAddress?: string }) => ({ name: cleanName(r.name ?? r.email ?? ''), email: (r.smtpAddress ?? r.email)?.toLowerCase() });
  const sent = data.clientSubmitTime ?? data.messageDeliveryTime ?? data.creationTime;
  return {
    from: data.senderName || data.senderEmail ? { name: cleanName(data.senderName ?? data.senderEmail ?? ''), email: (data.senderSmtpAddress ?? data.senderEmail)?.toLowerCase() } : undefined,
    to: recips.filter((r) => r.recipType !== 'cc' && r.recipType !== 'bcc').map(addr),
    cc: recips.filter((r) => r.recipType === 'cc').map(addr),
    date: sent ? parseSentDate(sent) : undefined,
    sentText: sent,
    subject: data.subject,
    body: cleanBody(data.body ?? ''),
  };
}
