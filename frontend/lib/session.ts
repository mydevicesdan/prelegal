/**
 * Placeholder session for the fake login: there is no authentication yet, the
 * email is only remembered (per tab) so the app can show who "signed in".
 */
const SESSION_KEY = "prelegal.session";

export function startSession(email: string): void {
  sessionStorage.setItem(SESSION_KEY, email);
}

export function endSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** The signed-in email, or null when there is no session. */
export function readSession(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}
