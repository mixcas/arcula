import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { auth } from "./firebase";

export const authService = {
  // Login user
  async login(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      return userCredential.user;
    } catch (error) {
      console.error("Error logging in:", error);
      throw error;
    }
  },

  // Logout user
  async logout(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error logging out:", error);
      throw error;
    }
  },

  // Listen to authentication state changes
  onAuthChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  },
};
