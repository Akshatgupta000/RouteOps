const baseUrl = import.meta.env.VITE_API_URL?.replace(/\/+$/, '');
const API_URL = `${baseUrl}/auth`;

const authService = {
  login: async (email, password) => {
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.message || `Login failed with status ${response.status}`);
        error.data = errorData;
        throw error;
      }
      return response.json();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Auth] Login error:', err);
      }
      throw err;
    }
  },

  register: async (name, email, password) => {
    try {
      const response = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.message || `Registration failed with status ${response.status}`);
        error.data = errorData;
        throw error;
      }
      return response.json();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Auth] Registration error:', err);
      }
      throw err;
    }
  },

  forgotPassword: async (email) => {
    const response = await fetch(`${API_URL}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.json();
  },

  verifyOtp: async (email, otp) => {
    const response = await fetch(`${API_URL}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    return response.json();
  },

  resetPassword: async (email, otp, password, password_confirmation) => {
    const response = await fetch(`${API_URL}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password, password_confirmation }),
    });
    return response.json();
  },
};

export default authService;
