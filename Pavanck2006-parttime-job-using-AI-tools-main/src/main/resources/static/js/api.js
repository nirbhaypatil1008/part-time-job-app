/**
 * PARTTIME JOB PLATFORM - REST API CLIENT
 * Handles JWT Token injection, Error handling, and REST requests
 */

const API_BASE = '/api';

const API = {
  getToken() {
    return localStorage.getItem('ptj_token');
  },

  setAuthData(data) {
    localStorage.setItem('ptj_token', data.token);
    localStorage.setItem('ptj_user', JSON.stringify(data));
  },

  clearAuthData() {
    localStorage.removeItem('ptj_token');
    localStorage.removeItem('ptj_user');
  },

  getCurrentUser() {
    const userStr = localStorage.getItem('ptj_user');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      return null;
    }
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      const result = isJson ? await response.json() : null;

      if (!response.ok) {
        // Handle 401 Unauthorized
        if (response.status === 401 && !endpoint.includes('/auth/login')) {
          this.clearAuthData();
          window.location.reload();
        }

        const errorMessage = result?.message || result?.error || `Request failed with status ${response.status}`;
        throw new Error(errorMessage);
      }

      return result?.data !== undefined ? result.data : result;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth Endpoints
  auth: {
    requestOtp(payload) {
      return API.request('/auth/request-otp', { method: 'POST', body: JSON.stringify(payload) });
    },
    verifyOtp(payload) {
      return API.request('/auth/verify-otp', { method: 'POST', body: JSON.stringify(payload) });
    },
    login(email, password) {
      return API.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
    },
    register(payload) {
      return API.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    resendOtp(payload) {
      return API.request('/auth/resend-otp', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  },

  // Public Endpoints
  public: {
    getJobs(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request(`/public/jobs${query ? '?' + query : ''}`);
    },
    getRecommendedJobs() {
      return API.request('/public/jobs/recommended');
    },
    getFullJobs() {
      return API.request('/public/jobs/full');
    },
    getJobDetails(id) {
      return API.request(`/public/jobs/${id}`);
    }
  },

  // Student Endpoints
  student: {
    getProfile() {
      return API.request('/student/profile');
    },
    updateProfile(payload) {
      return API.request('/student/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    },
    getDashboardStats() {
      return API.request('/student/dashboard');
    },
    getJobs(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request(`/student/jobs${query ? '?' + query : ''}`);
    },
    applyForJob(jobId, notes = '') {
      return API.request(`/student/jobs/${jobId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ notes })
      });
    },
    getMyApplications() {
      return API.request('/student/applications');
    },
    getAcceptedJobs() {
      return API.request('/student/applications/accepted');
    },
    getCompletedJobs() {
      return API.request('/student/applications/completed');
    },
    cancelApplication(id) {
      return API.request(`/student/applications/${id}`, {
        method: 'DELETE'
      });
    },
    confirmPayment(appId, notes = '') {
      return API.request(`/student/applications/${appId}/confirm-payment`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CONFIRMED', notes })
      });
    },
    getDeletionRequests() {
      return API.request('/student/deletion-requests');
    },
    acceptDeletionRequest(id) {
      return API.request(`/student/deletion-requests/${id}/accept`, { method: 'POST' });
    },
    rejectDeletionRequest(id) {
      return API.request(`/student/deletion-requests/${id}/reject`, { method: 'POST' });
    },
    getPayments() {
      return API.request('/student/payments');
    },
    getRazorpayTransactions() {
      return API.request('/student/razorpay/transactions');
    },
    getRazorpayTransaction(id) {
      return API.request('/student/razorpay/transactions/' + id);
    },
    createRazorpayOrder(paymentRecordId) {
      return API.request('/student/razorpay/create-order', { method: 'POST', body: JSON.stringify({paymentRecordId}) });
    },
    verifyRazorpayPayment(payload) {
      return API.request('/student/razorpay/verify', { method: 'POST', body: JSON.stringify(payload) });
    },
    cancelRazorpayPayment(paymentRecordId) {
      return API.request('/student/razorpay/cancel', { method: 'POST', body: JSON.stringify({paymentRecordId}) });
    }
  },

  // Owner Endpoints
  owner: {
    getProfile() {
      return API.request('/owner/profile');
    },
    updateProfile(payload) {
      return API.request('/owner/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    },
    getMyJobs() {
      return API.request('/owner/jobs');
    },
    makeDecision(jobId, decision) {
      return API.request('/owner/jobs/' + jobId + '/decision', {
        method: 'PUT',
        body: JSON.stringify({ decision })
      });
    },
    removeJob(jobId) {
      return API.request('/owner/jobs/' + jobId + '/remove', {
        method: 'PUT'
      });
    },
    getClosedJobs() {
      return API.request('/owner/jobs/closed');
    },
    getJob(id) {
      return API.request(`/owner/jobs/${id}`);
    },
    createJob(payload) {
      return API.request('/owner/jobs', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    updateJob(id, payload) {
      return API.request(`/owner/jobs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    },
    cancelJob(id) {
      return API.request(`/owner/jobs/${id}`, {
        method: 'DELETE'
      });
    },
    getJobApplications(jobId) {
      return API.request(`/owner/jobs/${jobId}/applications`);
    },
    acceptApplicant(appId) {
      return API.request(`/owner/applications/${appId}/accept`, {
        method: 'PUT'
      });
    },
    rejectApplicant(appId) {
      return API.request(`/owner/applications/${appId}/reject`, {
        method: 'PUT'
      });
    },

    markAttendance(appId, attendanceStatus, workCompletionStatus = 'COMPLETED') {
      return API.request(`/owner/applications/${appId}/attendance`, {
        method: 'PUT',
        body: JSON.stringify({ attendanceStatus, workCompletionStatus })
      });
    },
    completeJob(jobId) {
      return API.request(`/owner/jobs/${jobId}/complete`, {
        method: 'PUT'
      });
    },
    markPaymentPaid(appId, notes = '') {
      return API.request(`/owner/applications/${appId}/payment`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'PAID', notes })
      });
    },
    getPayments() {
      return API.request('/owner/payments');
    },
    getComplaints() {
      return API.request('/owner/complaints');
    },
    getRazorpayTransactions() {
      return API.request('/owner/razorpay/transactions');
    },
    getRazorpayTransaction(id) {
      return API.request('/owner/razorpay/transactions/' + id);
    }
  },

  // Admin Endpoints
  admin: {
    getDashboardStats() {
      return API.request('/admin/dashboard');
    },
    getUsers() {
      return API.request('/admin/users');
    },
    getStudents() {
      return API.request('/admin/students');
    },
    getOwners() {
      return API.request('/admin/owners');
    },
    verifyOwner(ownerId, verified = true) {
      return API.request(`/admin/owners/${ownerId}/verify?verified=${verified}`, {
        method: 'PUT'
      });
    },
    setUserSuspension(userId, suspended = true, reason = '') {
      return API.request(`/admin/users/${userId}/suspend?suspended=${suspended}&reason=${encodeURIComponent(reason)}`, {
        method: 'PUT'
      });
    },
    getAllJobs() {
      return API.request('/admin/jobs');
    },
    deleteJob(jobId, reason = '') {
      return API.request(`/admin/jobs/${jobId}?reason=${encodeURIComponent(reason)}`, {
        method: 'DELETE'
      });
    },
    getAllReports() {
      return API.request('/admin/reports');
    },
    getTransactions(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request(`/admin/razorpay/transactions${query ? '?' + query : ''}`);
    },
    getTransaction(id) {
      return API.request(`/admin/razorpay/transactions/${id}`);
    },
    getTransactionFilterOptions() {
      return API.request('/admin/razorpay/transactions/filter-options');
    },
    resolveReport(reportId, status, adminRemarks) {
      return API.request(`/admin/reports/${reportId}/resolve`, {
        method: 'PUT',
        body: JSON.stringify({ status, adminRemarks })
      });
    }
  },

  // Reports
  reports: {
    create(payload) {
      return API.request('/reports', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    getMyReports() {
      return API.request('/reports/my-reports');
    },
    withdraw(reportId) {
      return API.request(`/reports/${reportId}`, {
        method: 'DELETE'
      });
    }
  },

  chat: {
    getMessages(reportId) {
      return API.request(`/chat/${reportId}/messages`);
    },
    sendMessage(reportId, message) {
      return API.request(`/chat/${reportId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message })
      });
    }
  },

  // Notifications
  notifications: {
    getMyNotifications() {
      return API.request('/notifications');
    },
    getUnreadCount() {
      return API.request('/notifications/unread-count');
    },
    markAsRead(id) {
      return API.request(`/notifications/${id}/read`, {
        method: 'PUT'
      });
    },
    markAllAsRead() {
      return API.request('/notifications/read-all', {
        method: 'PUT'
      });
    }
  }
};
