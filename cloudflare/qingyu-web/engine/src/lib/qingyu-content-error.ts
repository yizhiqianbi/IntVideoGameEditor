/** Only these application-owned messages may cross a generation handler boundary. */
export class ContentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'QingyuContentError';
  }
}
