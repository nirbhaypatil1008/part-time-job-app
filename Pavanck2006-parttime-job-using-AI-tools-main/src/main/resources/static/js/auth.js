/**
 * PARTTIME JOB PLATFORM - AUTHENTICATION & SESSION MANAGEMENT
 */

const Auth = {
  init() {
    this.bindEvents();
    this.updateNavigation();
  },

  bindEvents() {
    // Login form submission
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleLogin();
      });
    }

    // Register form submission
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleRegister();
      });
    }

    // Role switcher in registration
    const roleRadios = document.querySelectorAll('input[name="registerRole"]');
    roleRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.toggleRegistrationFields(e.target.value);
      });
    });

    // Quick Fill demo buttons
    document.querySelectorAll('.quick-fill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const email = e.currentTarget.getAttribute('data-email');
        const pass = e.currentTarget.getAttribute('data-pass');
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = pass;
      });
    });
  },

  toggleRegistrationFields(role) {
    const studentFields = document.getElementById('studentRegisterFields');
    const ownerFields = document.getElementById('ownerRegisterFields');

    if (role === 'ROLE_STUDENT') {
      studentFields?.classList.remove('d-none');
      ownerFields?.classList.add('d-none');
    } else {
      studentFields?.classList.add('d-none');
      ownerFields?.classList.remove('d-none');
    }
  },

  async handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginSubmitBtn');

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logging in...';

      const authData = await API.auth.login(email, password);
      API.setAuthData(authData);

      App.showToast('Welcome back, ' + authData.fullName + '!', 'success');
      
      // Close modal
      const modalEl = document.getElementById('loginModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      this.updateNavigation();
      App.routeToRoleDashboard(authData.role);
    } catch (err) {
      App.showToast(err.message || 'Login failed', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Sign In';
    }
  },

  _otpCooldownInterval: null,

  async handleRegister() {
    const role = document.querySelector('input[name="registerRole"]:checked').value;
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const phone = document.getElementById('regPhone').value.trim();
    const btn = document.getElementById('registerSubmitBtn');
    const payload = {
      fullName,
      email,
      password,
      phone,
      role
    };

    if (!document.getElementById('regVerificationId').value) {
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending Code...';
      const otp = await API.auth.requestOtp({email});
      document.getElementById('regVerificationId').value = otp.verificationId;
      document.getElementById('regOtpGroup').classList.remove('d-none');
      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-person-check me-2"></i>Create Account';
      this._startOtpCooldown();
      App.showToast('Verification code sent by email. Check your inbox.', 'info');
    } catch (err) {
      btn.disabled = false;
      const msg = err.message || 'Could not send verification code';
      if (msg.includes('not configured') || msg.includes('SMTP')) {
        App.showToast('Email verification is not configured. Please contact the administrator or set SMTP settings in the server .env file.', 'danger');
      } else {
        App.showToast(msg, 'danger');
      }
    }
      return;
    }
    if (document.getElementById('regEmailVerified').value !== 'true') {
      App.showToast('Verify your email before creating the account.', 'warning');
      return;
    }
    payload.verificationId = document.getElementById('regVerificationId').value;

    if (role === 'ROLE_STUDENT') {
      payload.preferredArea = document.getElementById('regPrefArea').value.trim();
      payload.skills = Array.from(document.querySelectorAll('.reg-skill:checked'))
        .map(skill => skill.value)
        .join(', ');
    } else {
      payload.cateringName = document.getElementById('regCateringName').value.trim();
      payload.businessAddress = document.getElementById('regBusinessAddress').value.trim();
      payload.businessPhone = document.getElementById('regBusinessPhone').value.trim() || phone;
    }

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating Account...';

      const authData = await API.auth.register(payload);
      API.setAuthData(authData);

      App.showToast('Account created successfully! Welcome to PartTime Job.', 'success');

      // Close modal
      const modalEl = document.getElementById('registerModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      this.updateNavigation();
      App.routeToRoleDashboard(authData.role);
    } catch (err) {
      App.showToast(err.message || 'Registration failed', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-person-check me-2"></i>Create Account';
    }
  },

  async handleVerifyEmail() {
    const email = document.getElementById('regEmail').value.trim();
    const otp = document.getElementById('regOtp').value.trim();
    const btn = document.getElementById('verifyEmailBtn');
    if (!email) return App.showToast('Enter your email address first.', 'warning');
    if (!/^\d{6}$/.test(otp)) return App.showToast('Enter the complete 6-digit OTP.', 'warning');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Verifying...';
      const result = await API.auth.verifyOtp({email, otp});
      document.getElementById('regVerificationId').value = result?.verificationId || '';
      document.getElementById('regEmailVerified').value = 'true';
      document.getElementById('regOtp').disabled = true;
      document.getElementById('regOtpGroup').classList.add('d-none');
      document.getElementById('registerSubmitBtn').disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Email Verified';
      App.showToast(result?.message || 'Email verified successfully.', 'success');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-check me-1"></i>Verify Email';
      App.showToast(err.message || 'Email verification failed', 'danger');
    }
  },

  resendOtp() {
    document.getElementById('regVerificationId').value = '';
    document.getElementById('regEmailVerified').value = '';
    document.getElementById('regOtp').value = '';
    document.getElementById('regOtp').disabled = false;
    document.getElementById('regOtpGroup').classList.add('d-none');
    document.getElementById('verifyEmailBtn').disabled = false;
    document.getElementById('verifyEmailBtn').innerHTML = '<i class="bi bi-shield-check me-1"></i>Verify Email';
    document.getElementById('registerForm').requestSubmit();
  },

  _startOtpCooldown(seconds = 60) {
    this._stopOtpCooldown();
    const resendBtn = document.getElementById('resendOtpBtn');
    const timerEl = document.getElementById('otpCooldownTimer');
    if (!resendBtn) return;
    let remaining = seconds;
    resendBtn.disabled = true;
    resendBtn.classList.add('d-none');
    if (timerEl) {
      timerEl.classList.remove('d-none');
      timerEl.textContent = `Resend OTP in ${remaining}s`;
    }
    this._otpCooldownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        this._stopOtpCooldown();
        resendBtn.disabled = false;
        resendBtn.classList.remove('d-none');
        if (timerEl) timerEl.classList.add('d-none');
      } else if (timerEl) {
        timerEl.textContent = `Resend OTP in ${remaining}s`;
      }
    }, 1000);
  },

  _stopOtpCooldown() {
    if (this._otpCooldownInterval) {
      clearInterval(this._otpCooldownInterval);
      this._otpCooldownInterval = null;
    }
  },


  logout() {
    API.clearAuthData();
    App.showToast('You have been logged out.', 'info');
    this.updateNavigation();
    App.navigate('home');
  },

  updateNavigation() {
    const user = API.getCurrentUser();
    const guestNav = document.getElementById('guestNav');
    const authNav = document.getElementById('authNav');
    const userDisplayName = document.getElementById('userDisplayName');
    const userRoleBadge = document.getElementById('userRoleBadge');
    const dashboardNavBtn = document.getElementById('dashboardNavBtn');
    const studentApplicationsSetting = document.getElementById('studentApplicationsSetting');

    if (user && API.isAuthenticated()) {
      guestNav?.classList.add('d-none');
      authNav?.classList.remove('d-none');
      dashboardNavBtn?.classList.remove('d-none');
      studentApplicationsSetting?.classList.toggle('d-none', user.role !== 'ROLE_STUDENT');
      // Hide How It Works / Safety / FAQ after login
      document.getElementById('navHowItWorks')?.classList.add('d-none');
      document.getElementById('navSafety')?.classList.add('d-none');
      document.getElementById('navFaq')?.classList.add('d-none');

      if (userDisplayName) userDisplayName.innerText = user.fullName;

      if (userRoleBadge) {
        if (user.role === 'ROLE_ADMIN') {
          userRoleBadge.className = 'badge bg-danger ms-1';
          userRoleBadge.innerText = 'Admin';
        } else if (user.role === 'ROLE_OWNER') {
          userRoleBadge.className = 'badge bg-primary ms-1';
          userRoleBadge.innerText = user.cateringName || 'Owner';
        } else {
          userRoleBadge.className = 'badge bg-success ms-1';
          userRoleBadge.innerText = 'Student';
        }
      }

      // Load profile photo for navbar
      this.loadNavPhoto(user.role);

      // Start notification polling
      Notifications.startPolling();
    } else {
      // Reset nav photo
      const navPhoto = document.getElementById('navUserPhoto');
      const navPhotoIcon = document.getElementById('navUserPhotoIcon');
      if (navPhoto) navPhoto.classList.add('d-none');
      if (navPhotoIcon) navPhotoIcon.classList.remove('d-none');

      guestNav?.classList.remove('d-none');
      authNav?.classList.add('d-none');
      // Show How It Works / Safety / FAQ when logged out
      document.getElementById('navHowItWorks')?.classList.remove('d-none');
      document.getElementById('navSafety')?.classList.remove('d-none');
      document.getElementById('navFaq')?.classList.remove('d-none');
      dashboardNavBtn?.classList.add('d-none');
      studentApplicationsSetting?.classList.add('d-none');
      Notifications.stopPolling();
    }
  },

  async loadNavPhoto(role) {
    try {
      const navPhoto = document.getElementById('navUserPhoto');
      const navPhotoIcon = document.getElementById('navUserPhotoIcon');
      if (!navPhoto || !navPhotoIcon) return;

      let profile = null;
      if (role === 'ROLE_STUDENT') {
        profile = await API.student.getProfile();
      } else if (role === 'ROLE_OWNER') {
        profile = await API.owner.getProfile();
      }

      if (profile && profile.profilePhotoUrl) {
        navPhoto.src = profile.profilePhotoUrl;
        navPhoto.classList.remove('d-none');
        navPhotoIcon.classList.add('d-none');
      } else {
        navPhoto.classList.add('d-none');
        navPhotoIcon.classList.remove('d-none');
      }
    } catch (e) {
      console.warn('Failed to load nav photo', e);
    }
  },

  showForgotPassword() {
    // Hide login modal, show forgot password modal
    bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
    document.getElementById('fpStep1')?.classList.remove('d-none');
    document.getElementById('fpStep2')?.classList.add('d-none');
    document.getElementById('fpStep3')?.classList.add('d-none');
    document.getElementById('fpEmail').value = '';
    document.getElementById('fpOtp').value = '';
    document.getElementById('fpNewPassword').value = '';
    document.getElementById('fpConfirmPassword').value = '';
    setTimeout(() => {
      new bootstrap.Modal(document.getElementById('forgotPasswordModal')).show();
    }, 400);
  },

  async forgotPasswordSendCode() {
    const email = document.getElementById('fpEmail').value.trim();
    if (!email) { App.showToast('Please enter your email', 'warning'); return; }
    const btn = document.getElementById('fpSendCodeBtn');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';
      const data = await API.request('/auth/forgot-password', {method: 'POST', body: JSON.stringify({email})});
      document.getElementById('fpVerificationId').value = data.verificationId;
      document.getElementById('fpStep1').classList.add('d-none');
      document.getElementById('fpStep2').classList.remove('d-none');
      App.showToast('Verification code sent to your email!', 'success');
    } catch (e) {
      App.showToast(e.message || 'Failed to send reset code', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send me-2"></i>Send Reset Code';
    }
  },

  async forgotPasswordVerifyOtp() {
    const otp = document.getElementById('fpOtp').value.trim();
    const verificationId = document.getElementById('fpVerificationId').value;
    if (!otp || otp.length !== 6) { App.showToast('Enter the 6-digit code', 'warning'); return; }
    const btn = document.getElementById('fpVerifyBtn');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Verifying...';
      await API.request('/auth/forgot-password/verify', {method: 'POST', body: JSON.stringify({verificationId, otp})});
      document.getElementById('fpStep2').classList.add('d-none');
      document.getElementById('fpStep3').classList.remove('d-none');
      App.showToast('Email verified! Set your new password.', 'success');
    } catch (e) {
      App.showToast(e.message || 'Verification failed', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-check me-2"></i>Verify Code';
    }
  },

  async forgotPasswordReset() {
    const password = document.getElementById('fpNewPassword').value;
    const confirm = document.getElementById('fpConfirmPassword').value;
    const verificationId = document.getElementById('fpVerificationId').value;
    if (!password || password.length < 6) { App.showToast('Password must be at least 6 characters', 'warning'); return; }
    if (password !== confirm) { App.showToast('Passwords do not match', 'warning'); return; }
    const btn = document.getElementById('fpResetBtn');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Resetting...';
      await API.request('/auth/forgot-password/reset', {method: 'POST', body: JSON.stringify({verificationId, password})});
      bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal'))?.hide();
      App.showToast('Password reset successful! You can now sign in.', 'success');
      setTimeout(() => { App.showLogin(); }, 500);
    } catch (e) {
      App.showToast(e.message || 'Failed to reset password', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Reset Password';
    }
  },

  async deleteAccount() {
    if (!confirm('Are you sure you want to permanently delete your account? This cannot be undone!')) return;
    const password = prompt('Enter your password to confirm account deletion:');
    if (!password) return;
    try {
      await API.request('/account', {method: 'DELETE', body: JSON.stringify({password})});
      App.showToast('Account deleted successfully.', 'success');
      setTimeout(() => { Auth.logout(); }, 1000);
    } catch (e) {
      App.showToast(e.message || 'Failed to delete account', 'danger');
    }
  }
};
