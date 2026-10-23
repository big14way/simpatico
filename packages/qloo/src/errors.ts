/** Thrown when a caller asks Simpatico to score without a working Qloo connection. */
export class QlooRequiredError extends Error {
  constructor(message = "Simpatico doesn't guess. Connect Qloo.") {
    super(message);
    this.name = 'QlooRequiredError';
  }
}
