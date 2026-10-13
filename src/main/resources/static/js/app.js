/**
 * PARTTIME JOB PLATFORM - MAIN APP CONTROLLER & ROUTER
 * Tagline: "Find Work. Earn More. Work Safely."
 */

const App = {
  currentView: 'home',
  cachedJobs: [],

  init() {
    this.applyTheme(localStorage.getItem('ptj_theme') || 'light');
    Auth.init();
    Notifications.init();
    Chat.init();
    this.bindGlobalEvents();
    this.loadPublicJobs();
    
    // Check initial route / user state
    const user = API.getCurrentUser();
    if (user && API.isAuthenticated()) {
      this.routeToRoleDashboard(user.role);
    } else {
      this.navigate('home');
    }
  },

  applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      const icon = button.querySelector('i');
      if (icon) icon.className = isDark ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    });
  },

  toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ptj_theme', nextTheme);
    this.applyTheme(nextTheme);
  },

  toggleNotifPanel() {
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    if (!panel || !overlay) return;
    const isOpen = !panel.classList.contains('d-none');
    if (isOpen) {
      panel.classList.add('d-none');
      overlay.classList.add('d-none');
      document.body.style.overflow = '';
    } else {
      panel.classList.remove('d-none');
      overlay.classList.remove('d-none');
      document.body.style.overflow = 'hidden';
    }
  },

  openSettingsSection(section) {
    const user = API.getCurrentUser();
    if (!user) return;
    this.navigate('settings');
    this.prepareSettingsPage();
    this.showSettingsPanel(section);
  },

  prepareSettingsPage() {
    const content = document.getElementById('settingsContent');
    if (!content || content.dataset.ready) return;
    const user = API.getCurrentUser();
    if (!user) return;
    const prefix = user.role === 'ROLE_OWNER' ? 'ow' : 'st';
    const panels = [`${prefix}-tab-profile`, `${prefix}-tab-payments`, ...(user.role === 'ROLE_STUDENT' ? ['st-tab-applications'] : []), user.role === 'ROLE_OWNER' ? 'ow-tab-complaints' : 'st-tab-reports', user.role === 'ROLE_OWNER' ? 'ow-tab-chat' : 'st-tab-chat'];
    panels.forEach(id => {
      const panel = document.getElementById(id);
      if (panel) content.appendChild(panel);
    });
    content.dataset.ready = 'true';
  },

  showSettingsPanel(section) {
    const user = API.getCurrentUser();
    if (!user) return;
    const prefix = user.role === 'ROLE_OWNER' ? 'ow' : 'st';
    const tabMap = {
      profile: `${prefix}-tab-profile`,
      payments: `${prefix}-tab-payments`,
      applications: 'st-tab-applications',
      complaints: user.role === 'ROLE_OWNER' ? 'ow-tab-complaints' : 'st-tab-reports',
      chat: user.role === 'ROLE_OWNER' ? 'ow-tab-chat' : 'st-tab-chat'
    };
    this.prepareSettingsPage();
    const target = document.getElementById(tabMap[section]);
    if (target) {
      document.querySelectorAll('#settingsContent .tab-pane').forEach(panel => {
        const active = panel === target;
        panel.hidden = !active;
        panel.style.display = active ? 'block' : 'none';
        panel.classList.toggle('d-none', !active);
        panel.classList.toggle('show', active);
        panel.classList.toggle('active', active);
      });
      document.querySelectorAll('.settings-nav').forEach(button => button.classList.toggle('active', button.dataset.settingsPanel === section));
      if (section === 'complaints' && user.role === 'ROLE_OWNER') Owner.loadComplaints();
      if (section === 'applications' && user.role === 'ROLE_STUDENT') Student.loadApplications();
      if (section === 'profile') user.role === 'ROLE_OWNER' ? Owner.loadProfile() : Student.loadProfile();
      if (section === 'payments') user.role === 'ROLE_OWNER' ? Owner.loadPayments() : Student.loadPayments();
      if (section === 'chat') Chat.loadReports(user.role === 'ROLE_OWNER' ? 'owner' : 'student');
    }
  },

  bindGlobalEvents() {
    // Quick search in hero
    const heroSearchForm = document.getElementById('heroSearchForm');
    if (heroSearchForm) {
      heroSearchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleHeroSearch();
      });
    }

    // Filter controls in Browse Jobs view
    const filterArea = document.getElementById('filterArea');
    const filterWorkType = document.getElementById('filterWorkType');
    const filterDate = document.getElementById('filterDate');
    const filterMinPay = document.getElementById('filterMinPay');
    const filterPaymentType = document.getElementById('filterPaymentType');

    [filterArea, filterWorkType, filterDate, filterMinPay, filterPaymentType].forEach(el => {
      if (el) {
        el.addEventListener('input', () => this.applyFilters());
        el.addEventListener('change', () => this.applyFilters());
      }
    });

    // Profile forms
    document.getElementById('studentProfileForm')?.addEventListener('submit', (e) => Student.updateProfile(e));
    document.getElementById('ownerProfileForm')?.addEventListener('submit', (e) => Owner.updateProfile(e));
    document.getElementById('createJobForm')?.addEventListener('submit', (e) => Owner.handleCreateJob(e));
    document.getElementById('resolveReportForm')?.addEventListener('submit', (e) => Admin.submitResolveReport(e));

    // Dispute submit form
    document.getElementById('disputeForm')?.addEventListener('submit', (e) => this.submitDispute(e));

    // Confirm payment form
    document.getElementById('confirmPaymentForm')?.addEventListener('submit', (e) => this.submitConfirmPayment(e));
  },

  navigate(viewName) {
    this.currentView = viewName;

    // Hide all view containers
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('d-none'));

    // Show target container
    const target = document.getElementById('view-' + viewName);
    if (target) {
      target.classList.remove('d-none');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Update active nav links
    document.querySelectorAll('.nav-link-custom').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('active', 'text-primary', 'fw-bold');
      } else {
        link.classList.remove('active', 'text-primary', 'fw-bold');
      }
    });

    // View specific hooks
    if (viewName === 'home') {
      this.loadPublicJobs();
    } else if (viewName === 'jobs') {
      this.loadPublicJobs();
    } else if (viewName === 'student-dashboard') {
      Student.loadDashboard();
    } else if (viewName === 'owner-dashboard') {
      Owner.loadDashboard();
    } else if (viewName === 'admin-dashboard') {
      Admin.loadDashboard();
    }
  },

  goToSection(sectionId) {
    // If not on home page, navigate there first
    if (this.currentView !== 'home') {
      this.navigate('home');
      // Wait for view to render, then scroll
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } else {
      // Already on home page, just scroll
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  routeToRoleDashboard(role) {
    if (role === 'ROLE_ADMIN') {
      this.navigate('admin-dashboard');
    } else if (role === 'ROLE_OWNER') {
      this.navigate('owner-dashboard');
    } else {
      this.navigate('student-dashboard');
    }
  },

  openRoleDashboard() {
    const user = API.getCurrentUser();
    if (user && API.isAuthenticated()) {
      this.routeToRoleDashboard(user.role);
    } else {
      this.openLoginModal();
    }
  },

  openLoginModal() {
    const modalEl = document.getElementById('loginModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  },

  openRegisterModal(role = 'ROLE_STUDENT') {
    const modalEl = document.getElementById('registerModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    document.getElementById('regVerificationId').value = '';
    document.getElementById('regEmailVerified').value = '';
    document.getElementById('regOtp').value = '';
    document.getElementById('regOtp').disabled = false;
    document.getElementById('regOtpGroup').classList.add('d-none');
    document.getElementById('verifyEmailBtn').disabled = false;
    document.getElementById('verifyEmailBtn').innerHTML = '<i class="bi bi-shield-check me-1"></i>Verify Email';
    document.getElementById('registerSubmitBtn').disabled = false;
    
    const radio = document.querySelector(`input[name="registerRole"][value="${role}"]`);
    if (radio) {
      radio.checked = true;
      Auth.toggleRegistrationFields(role);
    }
    modal.show();
  },

  async loadPublicJobs() {
    const homeContainer = document.getElementById('homeJobsList');
    const browseContainer = document.getElementById('browseJobsList');

    if (homeContainer) homeContainer.innerHTML = '<div class="col-12 text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading catering jobs...</div>';
    if (browseContainer) browseContainer.innerHTML = '<div class="col-12 text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading catering jobs...</div>';

    try {
      const jobs = await API.public.getJobs();
      this.cachedJobs = jobs || [];

      this.renderJobsToContainer(this.cachedJobs.slice(0, 6), homeContainer);
      this.renderJobsToContainer(this.cachedJobs, browseContainer);
    } catch (err) {
      if (homeContainer) homeContainer.innerHTML = `<div class="col-12 text-center text-danger p-3">Failed to load jobs: ${err.message}</div>`;
      if (browseContainer) browseContainer.innerHTML = `<div class="col-12 text-center text-danger p-3">Failed to load jobs: ${err.message}</div>`;
    }
  },

  renderJobsToContainer(jobs, container) {
    if (!container) return;

    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="col-12 text-center p-5 text-muted"><i class="bi bi-search fs-2 d-block mb-2"></i>No matching jobs found. Try adjusting your filters!</div>';
      return;
    }

    container.innerHTML = jobs.map(job => this.renderJobCard(job)).join('');
  },

  renderJobCard(job, context = 'public', isFullyBooked = false) {
    const user = API.getCurrentUser();
    const isStudent = user && user.role === 'ROLE_STUDENT';
    const isOwner = user && user.role === 'ROLE_OWNER';

    const jobFull = isFullyBooked || job.isFullyBooked || (job.workersRequired && job.workersSelected >= job.workersRequired);
    let applyBtn = '';
    if (job.userApplied) {
      applyBtn = `<button class="btn btn-sm btn-outline-success w-100" disabled><i class="bi bi-check-circle me-1"></i>Applied (${job.userApplicationStatus})</button>`;
    } else if (jobFull) {
      applyBtn = `<span class="badge bg-warning text-dark px-3 py-2 w-100 d-block text-center"><i class="bi bi-people-fill me-1"></i>Fully Booked</span>`;
    } else if (isStudent) {
      applyBtn = `<button class="btn btn-sm btn-primary-custom w-100" onclick="App.openApplyModal(${job.id}, '${App.escapeHtml(job.title)}', ${job.paymentAmount})"><i class="bi bi-send-check me-1"></i>Apply Now</button>`;
    } else if (!user) {
      applyBtn = `<button class="btn btn-sm btn-primary-custom w-100" onclick="App.openLoginModal()"><i class="bi bi-box-arrow-in-right me-1"></i>Sign In to Apply</button>`;
    } else {
      applyBtn = `<button class="btn btn-sm btn-outline-primary w-100" onclick="App.viewJobDetails(${job.id})">View Details</button>`;
    }

    return `
      <div class="col-md-6 col-lg-4 mb-4">
        <div class="job-card ${job.onSpotPayment ? 'featured' : ''}">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <span class="badge tag-worktype mb-1">${job.workTypeDisplayName || job.workType}</span>
              ${job.onSpotPayment ? '<span class="badge tag-onspot ms-1"><i class="bi bi-lightning-fill text-success"></i> On-Spot</span>' : ''}
            </div>
            <div class="job-pay-badge">
              <span>₹${job.paymentAmount}</span>
            </div>
          </div>

          <h5 class="fw-bold mb-1" style="font-size: 1.15rem;">${App.escapeHtml(job.title)}</h5>
          <div class="text-muted small mb-2 d-flex align-items-center gap-1">
            <i class="bi bi-building"></i>
            <span class="fw-semibold">${App.escapeHtml(job.cateringName)}</span>
            ${job.ownerVerified ? '<span class="verified-badge"><i class="bi bi-patch-check-fill"></i></span>' : '<span class="unverified-badge" title="Pending Verification"><i class="bi bi-shield-exclamation"></i></span>'}
          </div>

          ${job.locationPhotoUrl ? `<div class="mb-3 rounded overflow-hidden"><img src="${App.escapeHtml(job.locationPhotoUrl)}" alt="Location photo" class="img-fluid rounded" style="max-height: 160px; width: 100%; object-fit: cover;" onerror="this.style.display='none'"></div>` : ''}

          <div class="text-muted small mb-3">
            <div class="mb-1"><i class="bi bi-geo-alt-fill text-danger me-1"></i><strong>Area:</strong> ${App.escapeHtml(job.workArea)}</div>
            ${job.latitude && job.longitude ? `<div class="mb-1"><a href="https://www.google.com/maps?q=${job.latitude},${job.longitude}" target="_blank" class="text-decoration-none"><i class="bi bi-map me-1"></i><strong>View on Google Maps</strong> <i class="bi bi-box-arrow-up-right" style="font-size:0.7rem"></i></a></div>` : ''}
            <div class="mb-1"><i class="bi bi-calendar3 text-primary me-1"></i><strong>Date:</strong> ${App.formatDate(job.jobDate)}</div>
            <div><i class="bi bi-clock text-primary me-1"></i><strong>Time:</strong> ${App.formatTime(job.startTime)} - ${App.formatTime(job.endTime)}</div>
            ${job.applyDeadline ? `<div class="${new Date(job.applyDeadline) < new Date() ? 'text-danger fw-semibold' : 'text-warning'}"><i class="bi bi-hourglass-split me-1"></i><strong>Apply by:</strong> ${App.formatDate(job.applyDeadline)} ${App.formatTime(job.applyDeadline)}${new Date(job.applyDeadline) < new Date() ? ' (Expired)' : ''}</div>` : ''}
          </div>

          <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center mb-3">
            <small class="text-muted"><i class="bi bi-people me-1"></i>Slots: <strong>${job.workersSelected || 0} / ${job.workersRequired}</strong></small>
            <button class="btn btn-link btn-sm p-0 text-decoration-none" onclick="App.viewJobDetails(${job.id})">Details &rarr;</button>
          </div>

          ${applyBtn}
        </div>
      </div>
    `;
  },

  async viewJobDetails(jobId) {
    const modalEl = document.getElementById('jobDetailsModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const content = document.getElementById('jobDetailsModalContent');

    modal.show();
    content.innerHTML = '<div class="p-5 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading job details...</div>';

    try {
      const job = await API.public.getJobDetails(jobId);
      const user = API.getCurrentUser();
      const isStudent = user && user.role === 'ROLE_STUDENT';

      let applyActionHtml = '';
      if (job.userApplied) {
        applyActionHtml = `<div class="alert alert-info mb-0"><i class="bi bi-info-circle me-2"></i>You have applied for this job. Status: <strong>${job.userApplicationStatus}</strong></div>`;
      } else if (isStudent) {
        applyActionHtml = `
          <button class="btn btn-primary-custom w-100" onclick="App.openApplyModal(${job.id}, '${App.escapeHtml(job.title)}', ${job.paymentAmount}); bootstrap.Modal.getInstance(document.getElementById('jobDetailsModal')).hide();">
            <i class="bi bi-send-check me-2"></i>Apply for this Shift (₹${job.paymentAmount})
          </button>
        `;
      } else if (!user) {
        applyActionHtml = `
          <button class="btn btn-primary-custom w-100" onclick="App.openLoginModal(); bootstrap.Modal.getInstance(document.getElementById('jobDetailsModal')).hide();">
            <i class="bi bi-box-arrow-in-right me-2"></i>Sign In to Apply
          </button>
        `;
      }

      content.innerHTML = `
        <div class="modal-header border-0 pb-0">
          <div class="w-100">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="badge tag-worktype">${job.workTypeDisplayName || job.workType}</span>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <h4 class="fw-bold mb-1">${App.escapeHtml(job.title)}</h4>
            <div class="text-muted d-flex align-items-center gap-2">
              <span><i class="bi bi-building me-1"></i>${App.escapeHtml(job.cateringName)}</span>
              ${job.ownerVerified ? '<span class="verified-badge"><i class="bi bi-patch-check-fill"></i> Verified Organizer</span>' :
                '<span class="unverified-badge"><i class="bi bi-shield-exclamation"></i> Unverified Organizer</span>'}
            </div>
          </div>
        </div>

        <div class="modal-body">
          ${!job.ownerVerified ? `
            <div class="alert alert-warning d-flex align-items-center py-2 mb-3" style="font-size: 0.85rem;">
              <i class="bi bi-exclamation-triangle-fill fs-5 me-2 text-warning"></i>
              <div><strong>Safety Notice:</strong> This catering owner is awaiting administrative verification. Exercise routine diligence.</div>
            </div>
          ` : ''}

          <div class="row g-3 mb-3">
            <div class="col-6 col-md-3">
              <div class="p-3 bg-light rounded text-center">
                <div class="text-muted small">Payment</div>
                <div class="fw-bold fs-5 text-success">₹${job.paymentAmount}</div>
                <span class="badge ${job.onSpotPayment ? 'bg-success' : 'bg-secondary'} mt-1" style="font-size: 0.7rem;">${job.paymentTypeDisplayName || 'On-Spot'}</span>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="p-3 bg-light rounded text-center">
                <div class="text-muted small">Date</div>
                <div class="fw-bold text-dark">${App.formatDate(job.jobDate)}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="p-3 bg-light rounded text-center">
                <div class="text-muted small">Working Hours</div>
                <div class="fw-bold text-dark" style="font-size: 0.875rem;">${App.formatTime(job.startTime)} - ${App.formatTime(job.endTime)}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="p-3 bg-light rounded text-center">
                <div class="text-muted small">Required Staff</div>
                <div class="fw-bold text-dark">${job.workersSelected || 0} / ${job.workersRequired}</div>
              </div>
            </div>
          </div>

          ${job.applyDeadline ? `
          <div class="alert ${new Date(job.applyDeadline) < new Date() ? 'alert-danger' : 'alert-warning'} d-flex align-items-center py-2 mb-3" style="font-size: 0.85rem;">
            <i class="bi bi-hourglass-split fs-5 me-2"></i>
            <div><strong>Application Deadline:</strong> ${App.formatDate(job.applyDeadline)} at ${App.formatTime(job.applyDeadline)}${new Date(job.applyDeadline) < new Date() ? ' — <strong>Applications are closed</strong>' : ''}</div>
          </div>
          ` : ''}

          <div class="mb-3">
            <h6 class="fw-bold">Job Description & Tasks:</h6>
            <p class="text-muted" style="line-height: 1.5;">${App.escapeHtml(job.description || 'General event catering and server assistance required.')}</p>
          </div>

          ${job.requiredSkills ? `
            <div class="mb-3">
              <h6 class="fw-bold">Required Skills / Uniform:</h6>
              <p class="text-muted mb-0"><i class="bi bi-check2-circle text-success me-1"></i>${App.escapeHtml(job.requiredSkills)}</p>
            </div>
          ` : ''}

          ${job.locationPhotoUrl ? `<div class="mb-3"><h6 class="fw-bold">Location Photo:</h6><img src="${App.escapeHtml(job.locationPhotoUrl)}" alt="Location photo" class="img-fluid rounded shadow-sm" style="max-height: 300px; width: 100%; object-fit: cover;" onerror="this.parentElement.style.display='none'"></div>` : ''}

          ${job.latitude && job.longitude ? `
          <div class="mb-3">
            <h6 class="fw-bold"><i class="bi bi-geo-alt-fill text-danger me-1"></i>Job Location</h6>
            <div class="rounded overflow-hidden border mb-2" style="height:200px; background:#f0f0f0;">
              <img src="https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400&center=lonlat:${job.longitude},${job.latitude}&zoom=15&marker=lonlat:${job.longitude},${job.latitude};color:%23ff0000;size:medium&apiKey=demo" alt="Job Location Map" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<div class=\'d-flex align-items-center justify-content-center h-100 text-muted\'><i class=\'bi bi-map fs-1\'></i></div>'">
            </div>
            ${job.locationAddress ? `<div class="small text-muted mb-2"><i class="bi bi-pin-map me-1"></i>${App.escapeHtml(job.locationAddress)}</div>` : ''}
            <div class="small text-muted mb-2"><i class="bi bi-crosshair me-1"></i>Lat: ${job.latitude.toFixed(6)} | Lng: ${job.longitude.toFixed(6)}</div>
            <div class="d-flex gap-2 flex-wrap">
              <a href="https://www.google.com/maps?q=${job.latitude},${job.longitude}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-up-right me-1"></i>Open in Google Maps</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}" target="_blank" class="btn btn-sm btn-outline-success"><i class="bi bi-sign-turn-right me-1"></i>Get Directions</a>
            </div>
          </div>
          ` : ''}

          <!-- Privacy Protected Location Box -->
          <div class="mb-3">
            <h6 class="fw-bold">Location & Contact Privacy:</h6>
            ${job.locationUnlocked ? `
              <div class="sensitive-box-unlocked">
                <div class="fw-bold text-success mb-1"><i class="bi bi-unlock-fill me-1"></i>Address & Contact Unlocked (You are accepted for this job):</div>
                <div class="mb-2"><strong>Exact Venue:</strong> ${App.escapeHtml(job.detailedLocation)}</div>
                <div><i class="bi bi-telephone-fill me-1"></i><strong>Direct Phone:</strong> <a href="tel:${job.contactPhone}">${job.contactPhone}</a></div>
                ${job.contactEmail ? `<div><i class="bi bi-envelope-fill me-1"></i><strong>Email:</strong> ${job.contactEmail}</div>` : ''}
              </div>
            ` : `
              <div class="sensitive-box-locked">
                <div class="fw-bold mb-1"><i class="bi bi-shield-lock-fill me-1"></i>General Work Area: <strong>${App.escapeHtml(job.workArea)}</strong></div>
                <div class="small">To protect organizer privacy, the complete venue address and contact numbers are revealed immediately after your application is accepted by the catering owner.</div>
              </div>
            `}
          </div>
        </div>

        <div class="modal-footer border-0 pt-0">
          ${applyActionHtml}
        </div>
      `;
    } catch (err) {
      content.innerHTML = `<div class="p-4 text-center text-danger">Failed to load job details: ${err.message}</div>`;
    }
  },

  handleHeroSearch() {
    const area = document.getElementById('heroAreaInput')?.value.trim();
    const workType = document.getElementById('heroWorkTypeSelect')?.value;

    this.navigate('jobs');

    if (area && document.getElementById('filterArea')) {
      document.getElementById('filterArea').value = area;
    }
    if (workType && document.getElementById('filterWorkType')) {
      document.getElementById('filterWorkType').value = workType;
    }

    this.applyFilters();
  },

  applyFilters() {
    const area = document.getElementById('filterArea')?.value.toLowerCase().trim() || '';
    const workType = document.getElementById('filterWorkType')?.value || '';
    const date = document.getElementById('filterDate')?.value || '';
    const minPay = parseFloat(document.getElementById('filterMinPay')?.value) || 0;
    const paymentType = document.getElementById('filterPaymentType')?.value || '';

    const filtered = this.cachedJobs.filter(j => {
      const matchArea = !area || (j.workArea && j.workArea.toLowerCase().includes(area));
      const matchType = !workType || j.workType === workType;
      const matchDate = !date || j.jobDate === date;
      const matchPay = !minPay || (j.paymentAmount >= minPay);
      const matchPayType = !paymentType || j.paymentType === paymentType;
      return matchArea && matchType && matchDate && matchPay && matchPayType;
    });

    const browseContainer = document.getElementById('browseJobsList');
    this.renderJobsToContainer(filtered, browseContainer);
  },

  openApplyModal(jobId, jobTitle, amount) {
    document.getElementById('applyJobId').value = jobId;
    document.getElementById('applyJobTitle').innerText = jobTitle;
    document.getElementById('applyJobAmount').innerText = '₹' + amount;
    document.getElementById('applyNotes').value = '';

    const modal = new bootstrap.Modal(document.getElementById('applyModal'));
    modal.show();
  },

  async handleApplySubmit(e) {
    e.preventDefault();
    const jobId = document.getElementById('applyJobId').value;
    const notes = document.getElementById('applyNotes').value.trim();
    const btn = document.getElementById('applySubmitBtn');

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

      await API.student.applyForJob(jobId, notes);
      App.showToast('Application submitted successfully! The owner will review your application.', 'success');

      const modalEl = document.getElementById('applyModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      await this.loadPublicJobs();
      if (this.currentView === 'student-dashboard') {
        await Student.loadDashboard();
      }
    } catch (err) {
      App.showToast(err.message || 'Application failed', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-check me-2"></i>Submit Application';
    }
  },

  openConfirmPaymentModal(appId, jobTitle, amount) {
    document.getElementById('confirmPayAppId').value = appId;
    document.getElementById('confirmPayJobTitle').innerText = jobTitle;
    document.getElementById('confirmPayAmount').innerText = '₹' + amount;
    document.getElementById('confirmPayNotes').value = '';

    const modal = new bootstrap.Modal(document.getElementById('confirmPaymentModal'));
    modal.show();
  },

  async submitConfirmPayment(e) {
    e.preventDefault();
    const appId = document.getElementById('confirmPayAppId').value;
    const notes = document.getElementById('confirmPayNotes').value.trim();
    const btn = document.getElementById('confirmPaySubmitBtn');

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Confirming...';

      await API.student.confirmPayment(appId, notes);
      App.showToast('Payment confirmed successfully! Thank you for your work.', 'success');

      const modalEl = document.getElementById('confirmPaymentModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      if (this.currentView === 'student-dashboard') {
        await Student.loadDashboard();
      }
    } catch (err) {
      App.showToast(err.message || 'Failed to confirm payment', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Confirm Receipt';
    }
  },

  openDisputeModal(jobId, appId, jobTitle, expectedAmount) {
    document.getElementById('disputeJobId').value = jobId;
    document.getElementById('disputeAppId').value = appId;
    document.getElementById('disputeJobTitle').innerText = jobTitle;
    document.getElementById('disputeExpectedAmount').value = expectedAmount || '';
    document.getElementById('disputeReceivedAmount').value = '0';
    document.getElementById('disputeDescription').value = '';
    document.getElementById('disputeEvidence').value = '';
    this.toggleComplaintAmounts(document.getElementById('disputeTypeSelect').value);

    const modal = new bootstrap.Modal(document.getElementById('disputeModal'));
    modal.show();
  },

  toggleComplaintAmounts(reportType) {
    const amountsRow = document.getElementById('disputeAmountsRow');
    const expectedAmount = document.getElementById('disputeExpectedAmount');
    const receivedAmount = document.getElementById('disputeReceivedAmount');
    const isPaymentComplaint = reportType === 'PAYMENT_NOT_RECEIVED' || reportType === 'PAYMENT_PARTIALLY_RECEIVED';
    amountsRow?.classList.toggle('d-none', !isPaymentComplaint);
    if (!isPaymentComplaint) {
      if (expectedAmount) expectedAmount.value = '';
      if (receivedAmount) receivedAmount.value = '0';
    }
  },

  async submitDispute(e) {
    e.preventDefault();
    const jobId = document.getElementById('disputeJobId').value;
    const appId = document.getElementById('disputeAppId').value;
    const reportType = document.getElementById('disputeTypeSelect').value;
    const description = document.getElementById('disputeDescription').value.trim();
    const expectedAmount = parseFloat(document.getElementById('disputeExpectedAmount').value) || null;
    const receivedAmount = parseFloat(document.getElementById('disputeReceivedAmount').value) || 0;
    const evidenceNotes = document.getElementById('disputeEvidence').value.trim();
    const btn = document.getElementById('disputeSubmitBtn');

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting Dispute...';

      const payload = {
        jobId: jobId ? parseInt(jobId, 10) : null,
        applicationId: appId ? parseInt(appId, 10) : null,
        reportType,
        description,
        expectedAmount,
        receivedAmount,
        evidenceNotes
      };

      await API.reports.create(payload);
      App.showToast('Complaint sent to the owner and platform administrators.', 'warning');

      const modalEl = document.getElementById('disputeModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      if (this.currentView === 'student-dashboard') {
        await Student.loadDashboard();
      }
    } catch (err) {
      App.showToast(err.message || 'Failed to submit dispute', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-fill-exclamation me-2"></i>File Complaint';
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white bg-${type === 'danger' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'dark' : 'primary'} border-0 shadow-lg`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body fw-semibold">
          <i class="bi ${type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill'} me-2"></i>
          ${App.escapeHtml(message)}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    `;

    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 4500 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  },

  formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  previewProfilePhoto(input, previewId) {
    const preview = document.getElementById(previewId);
    if (!preview) return;
    const img = preview.querySelector('img');
    if (input.files && input.files[0] && img) {
      if (input.files[0].size > 5 * 1024 * 1024) {
        this.showToast('Photo too large. Max 5MB.', 'warning');
        input.value = '';
        preview.classList.add('d-none');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; preview.classList.remove('d-none'); };
      reader.readAsDataURL(input.files[0]);
    } else {
      preview.classList.add('d-none');
    }
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
