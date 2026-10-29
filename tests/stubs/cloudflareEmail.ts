/** Stand-in for `cloudflare:email` so `agents` can load under Node. */
export class EmailMessage {
  constructor(
    public from: string,
    public to: string,
    public raw: unknown,
  ) {}
}
