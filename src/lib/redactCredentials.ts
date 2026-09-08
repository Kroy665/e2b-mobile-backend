/** Strips any embedded credentials (https://user:token@host) from text before it's returned to a client. */
export function redactCredentials(text: string): string {
  return text.replace(/https:\/\/[^@\s'"]+@/g, 'https://');
}
