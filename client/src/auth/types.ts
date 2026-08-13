export interface SignupResult {
  success: boolean;
  is_verified: boolean;
  message: string;
}

export interface AuthActions {
  login(email: string, password: string): Promise<void>;
  signup(email: string, username: string, password: string): Promise<SignupResult>;
  forgotPassword(email: string): Promise<string | undefined>;
  logout(): Promise<void>;
}
