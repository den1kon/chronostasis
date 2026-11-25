export class AuthenticationUnavailableError extends Error {
  constructor() {
    super('Service unavailable');
    this.name = 'AuthenticationUnavailableError';
  }
}
